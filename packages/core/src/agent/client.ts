import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '../tools/types.js';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | Anthropic.ContentBlock[];
}

export interface ClaudeToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeResponse {
  text: string;
  toolCalls: ClaudeToolCall[];
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ClaudeClientConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
}

export class ClaudeClient {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private systemPrompt: string;

  constructor(config: ClaudeClientConfig = {}) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? 'claude-sonnet-4-6';
    this.maxTokens = config.maxTokens ?? 4096;
    this.systemPrompt = config.systemPrompt ?? '';
  }

  /**
   * Send a message to Claude with optional tools.
   * Returns the response with text, tool calls, and token usage.
   */
  async chat(
    messages: ClaudeMessage[],
    tools: Tool[] = [],
    systemOverride?: string,
  ): Promise<ClaudeResponse> {
    const anthropicTools: Anthropic.Tool[] = tools.map(t => ({
      name: t.definition.name,
      description: t.definition.description,
      input_schema: t.definition.input_schema as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemOverride ?? this.systemPrompt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content as string,
      })),
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const toolCalls: ClaudeToolCall[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map(b => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      }));

    return {
      text,
      toolCalls,
      stopReason: response.stop_reason ?? 'end_turn',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  /**
   * Send a tool result back to Claude after executing a tool call.
   */
  async sendToolResult(
    messages: ClaudeMessage[],
    toolCallId: string,
    result: string,
    tools: Tool[] = [],
  ): Promise<ClaudeResponse> {
    const fullMessages = [
      ...messages,
      {
        role: 'user' as const,
        content: [{
          type: 'tool_result' as const,
          tool_use_id: toolCallId,
          content: result,
        }],
      },
    ];

    return this.chat(fullMessages as ClaudeMessage[], tools);
  }

  setModel(model: string): void {
    this.model = model;
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }
}
