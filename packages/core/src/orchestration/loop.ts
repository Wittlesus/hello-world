/**
 * Claude Session Execution Loop
 *
 * The main orchestration that ties everything together:
 * 1. Compile context → inject into Claude
 * 2. Claude responds with text or tool calls
 * 3. Execute tools, check approval gates, log activity
 * 4. Track cost, check strikes, brain checkpoints
 * 5. Loop until task complete or halted
 */

import type { ActivityEvent, ActivityType } from '../types.js';
import { generateId, now } from '../utils.js';
import { ClaudeClient, type ClaudeMessage, type ClaudeResponse } from '../agent/client.js';
import { SessionCostTracker } from '../agent/cost.js';
import { BUILT_IN_TOOLS, toolMap } from '../tools/index.js';
import type { Tool } from '../tools/types.js';
import { ApprovalGates } from './approvals.js';
import { TwoStrikeEngine } from './strikes.js';
import { WorkflowEngine } from './workflow.js';
import { SessionManager, type ContextSnapshot } from './session.js';
import { MemoryStore } from '../brain/store.js';
import { StateManager } from '../state.js';
import {
  tickMessageCount,
  recordSynapticActivity,
  recordMemoryTraces,
  shouldCheckpoint,
  applySynapticPlasticity,
} from '../brain/state.js';
import { retrieveMemories } from '../brain/engine.js';

export interface LoopConfig {
  projectRoot: string;
  projectName: string;
  apiKey?: string;
  model?: string;
  dailyBudget?: number;
  onActivity?: (event: ActivityEvent) => void;
  onApprovalNeeded?: (request: { id: string; action: string; description: string }) => Promise<boolean>;
  onText?: (text: string) => void;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  onCostUpdate?: (totalUsd: number, stepCount: number) => void;
  onHalt?: (reason: string) => void;
}

export class SessionLoop {
  private claude: ClaudeClient;
  private costTracker: SessionCostTracker;
  private approvals: ApprovalGates;
  private strikes: TwoStrikeEngine;
  private workflow: WorkflowEngine;
  private sessions: SessionManager;
  private memoryStore: MemoryStore;
  private stateManager: StateManager;
  private messages: ClaudeMessage[] = [];
  private activityLog: ActivityEvent[] = [];
  private config: LoopConfig;
  private running = false;

  constructor(config: LoopConfig) {
    this.config = config;
    this.claude = new ClaudeClient({
      apiKey: config.apiKey,
      model: config.model,
    });
    this.costTracker = new SessionCostTracker();
    this.approvals = new ApprovalGates();
    this.strikes = new TwoStrikeEngine();
    this.workflow = new WorkflowEngine();
    this.sessions = new SessionManager(config.projectRoot);
    this.memoryStore = new MemoryStore(config.projectRoot, config.projectName);
    this.stateManager = new StateManager(config.projectRoot);
  }

  /**
   * Start a session. Compiles context, returns the snapshot Claude will see.
   */
  start(): ContextSnapshot {
    this.sessions.start();
    const context = this.sessions.compileContext(
      this.config.projectName,
      this.stateManager,
      this.memoryStore,
      this.config.dailyBudget ?? 5.0,
    );

    this.claude.setSystemPrompt(this.buildSystemPrompt(context));
    this.messages = [];
    this.running = true;
    this.logActivity('session_start', `Session started for ${this.config.projectName}`);

    return context;
  }

  /**
   * Send a message to Claude and process the response.
   * Handles tool calls, approval gates, cost tracking, and memory.
   */
  async send(userMessage: string): Promise<{
    text: string;
    toolsExecuted: string[];
    costUsd: number;
    halted: boolean;
    haltReason?: string;
  }> {
    if (!this.running) throw new Error('Session not started. Call start() first.');

    this.messages.push({ role: 'user', content: userMessage });

    let response: ClaudeResponse;
    const toolsExecuted: string[] = [];
    let iterations = 0;
    const maxIterations = 20; // Safety limit

    while (iterations < maxIterations) {
      iterations++;

      response = await this.claude.chat(this.messages, BUILT_IN_TOOLS);

      // Track cost
      const step = this.costTracker.addStep(
        this.config.model ?? 'claude-sonnet-4-6',
        response.inputTokens,
        response.outputTokens,
      );
      this.config.onCostUpdate?.(this.costTracker.getTotal().totalCostUsd, this.costTracker.getTotal().stepCount);

      // Update brain state
      let brainState = this.memoryStore.getBrainState();
      if (brainState) {
        brainState = tickMessageCount(brainState);
        this.memoryStore.saveBrainState(brainState);

        // Memory checkpoint
        if (shouldCheckpoint(brainState)) {
          const { state: boosted } = applySynapticPlasticity(brainState);
          this.memoryStore.saveBrainState(boosted);
        }
      }

      // Handle text output
      if (response.text) {
        this.config.onText?.(response.text);
        this.messages.push({ role: 'assistant', content: response.text });
      }

      // If no tool calls, we're done
      if (response.toolCalls.length === 0) {
        break;
      }

      // Handle tool calls
      for (const call of response.toolCalls) {
        this.config.onToolCall?.(call.name, call.input);

        // Check approval gate
        const tier = this.approvals.classifyAction(call.name);
        if (tier === 'block') {
          const approved = await this.requestApproval(call.name, call.input);
          if (!approved) {
            this.logActivity('approval_resolved', `Rejected: ${call.name}`);
            // Send rejection as tool result
            this.messages.push({
              role: 'assistant',
              content: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }] as any,
            });
            this.messages.push({
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: call.id, content: 'REJECTED by human. Choose a different approach.' }] as any,
            });
            continue;
          }
        }

        // Execute the tool
        const tool = toolMap.get(call.name);
        if (!tool) {
          this.messages.push({
            role: 'assistant',
            content: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }] as any,
          });
          this.messages.push({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: call.id, content: `Unknown tool: ${call.name}` }] as any,
          });
          continue;
        }

        const result = await tool.execute(call.input);
        toolsExecuted.push(call.name);

        // Log the activity
        const activityType = this.getActivityType(call.name);
        this.logActivity(activityType, `${call.name}: ${JSON.stringify(call.input).slice(0, 100)}`);

        // Check for errors (strike tracking)
        if (!result.success && this.workflow.getState().currentTaskId) {
          const taskId = this.workflow.getState().currentTaskId!;
          const check = this.strikes.recordFailure(taskId, result.error ?? 'unknown', call.name);
          if (check.shouldHalt) {
            const reason = this.strikes.getAlternatives(taskId);
            this.config.onHalt?.(reason);
            this.running = false;
            return {
              text: response.text,
              toolsExecuted,
              costUsd: this.costTracker.getTotal().totalCostUsd,
              halted: true,
              haltReason: reason,
            };
          }
        }

        // Send tool result back to Claude
        this.messages.push({
          role: 'assistant',
          content: [{ type: 'tool_use', id: call.id, name: call.name, input: call.input }] as any,
        });
        this.messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: call.id, content: result.output || result.error || '' }] as any,
        });
      }

      // Check budget
      const budget = this.costTracker.checkBudget(this.config.dailyBudget ?? 5.0);
      if (!budget.ok) {
        this.config.onHalt?.('Budget exceeded');
        this.running = false;
        return {
          text: response.text!,
          toolsExecuted,
          costUsd: this.costTracker.getTotal().totalCostUsd,
          halted: true,
          haltReason: `Budget exceeded: $${this.costTracker.getTotal().totalCostUsd.toFixed(4)} spent of $${this.config.dailyBudget ?? 5.0} limit`,
        };
      }

      // If stop reason is 'end_turn', break out of the loop
      if (response.stopReason === 'end_turn') break;
    }

    // Run memory retrieval on the response for auto-learning
    if (response!.text) {
      this.autoExtractMemories(response!.text);
    }

    return {
      text: response!.text,
      toolsExecuted,
      costUsd: this.costTracker.getTotal().totalCostUsd,
      halted: false,
    };
  }

  /**
   * End the session. Saves cost, applies plasticity, generates summary.
   */
  end(summary?: string): void {
    const total = this.costTracker.getTotal();
    this.sessions.end(
      summary ?? `${total.stepCount} steps, ${this.activityLog.length} activities`,
      total.totalCostUsd,
      total.totalTokens,
    );

    // Apply synaptic plasticity (strengthen used memories)
    const brainState = this.memoryStore.getBrainState();
    if (brainState) {
      const { state: boosted } = applySynapticPlasticity(brainState);
      this.memoryStore.saveBrainState(boosted);
    }

    this.logActivity('session_end', `Session ended. Cost: $${total.totalCostUsd.toFixed(4)}`);
    this.running = false;
  }

  getActivityLog(): ActivityEvent[] {
    return [...this.activityLog];
  }

  getCostSummary() {
    return this.costTracker.getTotal();
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Private helpers ──────────────────────────────────────────

  private buildSystemPrompt(context: ContextSnapshot): string {
    return [
      'You are Claude, operating within Hello World — an autonomous AI workspace.',
      'You have tools for filesystem operations, terminal commands, and git.',
      'Execute tasks autonomously. Stop at decision points and present options.',
      '',
      '--- Project Context ---',
      context.compiledText,
      '--- End Context ---',
    ].join('\n');
  }

  private async requestApproval(action: string, input: Record<string, unknown>): Promise<boolean> {
    const description = `${action}: ${JSON.stringify(input).slice(0, 200)}`;
    this.logActivity('approval_request', description);

    if (this.config.onApprovalNeeded) {
      return this.config.onApprovalNeeded({ id: generateId('apr'), action, description });
    }

    // Default: block (no auto-approve for blocked actions without a handler)
    return false;
  }

  private logActivity(type: ActivityType, description: string, details = ''): void {
    const event: ActivityEvent = {
      id: generateId('act'),
      type,
      description,
      details,
      sessionId: this.sessions.getCurrent()?.id ?? 'unknown',
      timestamp: now(),
    };
    this.activityLog.push(event);
    this.config.onActivity?.(event);
  }

  private getActivityType(toolName: string): ActivityType {
    if (toolName.startsWith('read') || toolName === 'list_directory') return 'file_read';
    if (toolName.startsWith('write')) return 'file_write';
    if (toolName === 'run_command') return 'command_run';
    if (toolName.startsWith('git')) return 'tool_call';
    return 'tool_call';
  }

  private autoExtractMemories(text: string): void {
    const lower = text.toLowerCase();

    // Detect errors/problems → store as pain
    if (lower.includes('error') || lower.includes('failed') || lower.includes('bug')) {
      const firstLine = text.split('\n')[0].slice(0, 100);
      if (firstLine.length > 20) {
        this.memoryStore.storeMemory({
          type: 'pain',
          title: firstLine,
          content: text.slice(0, 500),
          tags: ['auto-extracted'],
        });
        this.logActivity('memory_stored', `Pain memory: ${firstLine}`);
      }
    }

    // Detect completions → store as win
    if (lower.includes('done') || lower.includes('completed') || lower.includes('shipped') || lower.includes('passing')) {
      const firstLine = text.split('\n')[0].slice(0, 100);
      if (firstLine.length > 20) {
        this.memoryStore.storeMemory({
          type: 'win',
          title: firstLine,
          content: text.slice(0, 500),
          tags: ['auto-extracted'],
        });
        this.logActivity('memory_stored', `Win memory: ${firstLine}`);
      }
    }
  }
}
