import Anthropic from '@anthropic-ai/sdk';
import { ChatroomStore } from './chatroom-state.js';
import { AGENT_DEFINITIONS } from './agent-definitions.js';
import type { ChatMessage } from './types.js';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;
const INPUT_WINDOW_MS = 5_000;  // 5 seconds between rounds for Pat to type
const BETWEEN_AGENT_DELAY_MS = 800;  // brief pause between agents for readability

// Active runner state — one runner per project (singleton per MCP process)
let activeRunner: AbortController | null = null;

function buildMessages(history: ChatMessage[], topic: string): Anthropic.MessageParam[] {
  const msgs: Anthropic.MessageParam[] = [];

  // Open with topic context
  msgs.push({
    role: 'user',
    content: `You are participating in a deliberation about: "${topic}"\n\nConversation so far:\n${
      history
        .filter(m => m.type !== 'thinking')
        .map(m => {
          if (m.type === 'system') return `[System: ${m.text}]`;
          if (m.type === 'pat') return `[Pat: ${m.text}]`;
          if (m.type === 'claude') return `[Claude: ${m.text}]`;
          const agentDef = AGENT_DEFINITIONS[m.agentId];
          const name = agentDef?.name ?? m.agentId;
          return `[${name}: ${m.text}]`;
        })
        .join('\n')
    }\n\nNow give your response. Be concise (2-4 sentences). Stay in character.`,
  });

  return msgs;
}

async function runSingleAgent(
  client: Anthropic,
  store: ChatroomStore,
  agentId: string,
  notify: (files: string[]) => void,
  abortSignal: AbortSignal,
): Promise<void> {
  if (abortSignal.aborted) return;

  const def = AGENT_DEFINITIONS[agentId];
  if (!def) return;

  // Set thinking
  store.updateAgentStatus(agentId, 'thinking', '...');
  notify(['chatroom.json']);

  const state = store.read();
  if (state.session.status !== 'active') return;

  const messages = buildMessages(state.messages, state.session.topic);

  let fullText = '';

  try {
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: def.systemPrompt,
      messages,
    });

    store.updateAgentStatus(agentId, 'responding', '');
    notify(['chatroom.json']);

    for await (const chunk of stream) {
      if (abortSignal.aborted) return;
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        fullText += chunk.delta.text;
        // Update currentThought as tokens stream in (throttled — only write every ~20 chars)
        if (fullText.length % 20 < 3) {
          store.updateAgentStatus(agentId, 'responding', fullText.slice(-80));
          notify(['chatroom.json']);
        }
      }
    }

    if (abortSignal.aborted) return;

    // Append completed message
    store.appendMessage(agentId, fullText.trim(), 'message');
    store.updateAgentStatus(agentId, 'idle', '');
    notify(['chatroom.json']);

  } catch (err: unknown) {
    if (abortSignal.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    store.appendMessage(agentId, `[Error: ${msg}]`, 'message');
    store.updateAgentStatus(agentId, 'idle', '');
    notify(['chatroom.json']);
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });
}

export async function runDeliberation(
  store: ChatroomStore,
  notify: (files: string[]) => void,
): Promise<void> {
  // Cancel any existing runner
  if (activeRunner) activeRunner.abort();
  const ctrl = new AbortController();
  activeRunner = ctrl;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    store.appendMessage('system', 'Error: ANTHROPIC_API_KEY not set. Cannot run agents.', 'system');
    store.setSessionStatus('paused');
    notify(['chatroom.json']);
    return;
  }

  const client = new Anthropic({ apiKey });

  try {
    while (!ctrl.signal.aborted) {
      const state = store.read();
      if (state.session.status !== 'active') break;

      store.incrementRound();
      notify(['chatroom.json']);

      // Run all agents in randomized order
      const agentIds = shuffle(state.agents.map(a => a.id));
      for (const agentId of agentIds) {
        if (ctrl.signal.aborted) break;
        await runSingleAgent(client, store, agentId, notify, ctrl.signal);
        // Brief pause between agents
        try { await sleep(BETWEEN_AGENT_DELAY_MS, ctrl.signal); } catch { break; }
      }

      if (ctrl.signal.aborted) break;

      // Open input window for Pat
      store.setWaitingForInput(true);
      notify(['chatroom.json']);

      try {
        await sleep(INPUT_WINDOW_MS, ctrl.signal);
      } catch { break; }

      // Check if Pat posted a message during the window
      const afterWait = store.read();
      if (afterWait.session.pendingPatMessage) {
        store.appendMessage('pat', afterWait.session.pendingPatMessage, 'pat');
        store.setPendingPatMessage(undefined);
        notify(['chatroom.json']);
      }

      store.setWaitingForInput(false);
      notify(['chatroom.json']);

      // Check status again (Pat may have paused/concluded)
      if (store.read().session.status !== 'active') break;
    }
  } catch {
    // Runner stopped
  } finally {
    if (activeRunner === ctrl) activeRunner = null;
  }
}

export function stopDeliberation(): void {
  if (activeRunner) {
    activeRunner.abort();
    activeRunner = null;
  }
}
