import Anthropic from '@anthropic-ai/sdk';
import { ChatroomStore } from './chatroom-state.js';
import { AGENT_DEFINITIONS } from './agent-definitions.js';
import type { ChatMessage } from './types.js';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 120;          // hard limit — enforces 4-sentence brevity
const MAX_ROUNDS = 5;            // auto-synthesize after this many rounds
const BETWEEN_AGENT_MS = 1400;  // pause between agents
const INTRO_DELAY_MS = 2800;    // pause between agent introductions
const INPUT_WINDOW_MS = 8_000;  // how long Pat has to type each round

const AGENT_INTROS: Record<string, string> = {
  contrarian:
    'Contrarian: challenges everything that seems obvious. If the room is converging, they find the real objection — the one that actually matters.',
  premortem:
    'Pre-mortem: already watched this fail. They trace back from the wreckage to the exact decision that caused it.',
  firstprinciples:
    'First Principles: strips convention away and rebuilds from what is actually true. No inherited assumptions.',
  steelman:
    'Steelman: makes the strongest possible case for whatever the room dismissed. No idea dies without a fair hearing.',
  analogist:
    'Analogist: imports solved problems from other domains. The best insight is always one this room has never seen.',
  constraint:
    'Constraint: applies radical limits — 1/10th the time, 1/10th the complexity — to find what actually matters.',
};

let activeRunner: AbortController | null = null;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });
}

function buildMessages(history: ChatMessage[], topic: string): Anthropic.MessageParam[] {
  const conversation = history
    .filter(m => m.type !== 'thinking')
    .slice(-16)
    .map(m => {
      if (m.type === 'system') return `[System: ${m.text}]`;
      if (m.type === 'pat')    return `[Pat: ${m.text}]`;
      if (m.type === 'claude') return `[Claude: ${m.text}]`;
      const def = AGENT_DEFINITIONS[m.agentId];
      return `[${def?.name ?? m.agentId}: ${m.text}]`;
    })
    .join('\n');

  return [{
    role: 'user',
    content: `Topic: "${topic}"\n\nDiscussion so far:\n${conversation}\n\nRespond now. HARD RULE: 4 sentences maximum. Cut anything beyond 4 sentences before posting. Stay in your assigned role.`,
  }];
}

async function runSingleAgent(
  client: Anthropic,
  store: ChatroomStore,
  agentId: string,
  notify: (files: string[]) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;

  const def = AGENT_DEFINITIONS[agentId];
  if (!def) return;

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
      if (signal.aborted) return;
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullText += chunk.delta.text;
        if (fullText.length % 25 < 3) {
          store.updateAgentStatus(agentId, 'responding', fullText.slice(-80));
          notify(['chatroom.json']);
        }
      }
    }

    if (signal.aborted) return;

    store.appendMessage(agentId, fullText.trim(), 'message');
    store.updateAgentStatus(agentId, 'idle', '');
    notify(['chatroom.json']);

  } catch (err: unknown) {
    if (signal.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    store.appendMessage(agentId, `[Error: ${msg}]`, 'message');
    store.updateAgentStatus(agentId, 'idle', '');
    notify(['chatroom.json']);
  }
}

async function runIntroSequence(
  store: ChatroomStore,
  notify: (files: string[]) => void,
  signal: AbortSignal,
): Promise<void> {
  const state = store.read();
  const agents = state.agents;

  store.appendMessage('claude', `Starting deliberation: "${state.session.topic}". Bringing in the panel.`, 'claude');
  notify(['chatroom.json']);

  try { await sleep(INTRO_DELAY_MS, signal); } catch { return; }

  for (let i = 0; i < agents.length; i++) {
    if (signal.aborted) return;

    const agent = agents[i];
    const introLine = AGENT_INTROS[agent.id] ?? `${agent.name} joins the deliberation.`;

    // Reveal this agent in the UI
    store.setIntroRevealedCount(i + 1);
    notify(['chatroom.json']);

    // Brief pause so avatar entrance plays before Claude narrates
    try { await sleep(700, signal); } catch { return; }

    store.appendMessage('claude', introLine, 'claude');
    notify(['chatroom.json']);

    try { await sleep(INTRO_DELAY_MS, signal); } catch { return; }
  }

  store.clearIntroMode();
  store.appendMessage('claude', `Panel assembled. Round 1 — what does each of you make of this?`, 'claude');
  notify(['chatroom.json']);

  try { await sleep(1200, signal); } catch { return; }
}

async function checkConsensus(
  client: Anthropic,
  messages: ChatMessage[],
  topic: string,
): Promise<boolean> {
  const recent = messages
    .filter(m => m.type === 'message')
    .slice(-10)
    .map(m => `${AGENT_DEFINITIONS[m.agentId]?.name ?? m.agentId}: ${m.text.slice(0, 120)}`)
    .join('\n');

  if (!recent) return false;

  try {
    const result = await client.messages.create({
      model: MODEL,
      max_tokens: 8,
      messages: [{
        role: 'user',
        content: `Topic: "${topic}"\n\nRecent discussion:\n${recent}\n\nHave a majority of participants converged on a shared answer or direction? Answer YES or NO only.`,
      }],
    });
    const answer = ((result.content[0] as { type: string; text?: string })?.text ?? '').trim().toUpperCase();
    return answer.startsWith('YES');
  } catch {
    return false;
  }
}

async function runSynthesis(
  client: Anthropic,
  store: ChatroomStore,
  notify: (files: string[]) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;

  store.setDeliberationPhase('synthesis');
  store.appendMessage('claude', 'Consensus reached. Writing synthesis.', 'claude');
  notify(['chatroom.json']);

  const state = store.read();
  const discussion = state.messages
    .filter(m => m.type === 'message' || m.type === 'claude')
    .map(m => {
      const def = AGENT_DEFINITIONS[m.agentId];
      const name = m.agentId === 'claude' ? 'Claude' : (def?.name ?? m.agentId);
      return `${name}: ${m.text}`;
    })
    .join('\n\n');

  try {
    const result = await client.messages.create({
      model: MODEL,
      max_tokens: 350,
      messages: [{
        role: 'user',
        content: `You are Claude, moderating a deliberation on: "${state.session.topic}"\n\nFull discussion:\n${discussion}\n\nWrite a synthesis document: state the core question, note points of agreement, surface key tensions, and give a concrete recommendation. 100-150 words maximum. Be direct.`,
      }],
    });

    const synthesis = ((result.content[0] as { type: string; text?: string })?.text ?? '').trim();
    store.appendMessage('claude', synthesis, 'claude');
    store.setSessionStatus('concluded');
    notify(['chatroom.json']);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    store.appendMessage('claude', `Synthesis error: ${msg}`, 'claude');
    store.setSessionStatus('concluded');
    notify(['chatroom.json']);
  }
}

export async function runDeliberation(
  store: ChatroomStore,
  notify: (files: string[]) => void,
): Promise<void> {
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
    // Run intro if freshly started
    const initialState = store.read();
    if (typeof initialState.session.introRevealedCount === 'number') {
      await runIntroSequence(store, notify, ctrl.signal);
    }

    if (ctrl.signal.aborted) return;

    let consecutiveConsensus = 0;

    while (!ctrl.signal.aborted) {
      const state = store.read();
      if (state.session.status !== 'active') break;

      store.incrementRound();
      notify(['chatroom.json']);

      // Fixed turn order — round table, clockwise
      const agentIds = state.agents.map(a => a.id);
      for (const agentId of agentIds) {
        if (ctrl.signal.aborted) break;
        await runSingleAgent(client, store, agentId, notify, ctrl.signal);
        try { await sleep(BETWEEN_AGENT_MS, ctrl.signal); } catch { break; }
      }

      if (ctrl.signal.aborted) break;

      // Consensus check after round 2+
      const afterRound = store.read();
      if (afterRound.session.roundNumber >= 2) {
        const hasConsensus = await checkConsensus(client, afterRound.messages, afterRound.session.topic);
        consecutiveConsensus = hasConsensus ? consecutiveConsensus + 1 : 0;
      }

      // Synthesize on 2 consecutive consensus rounds OR hitting max rounds
      if (consecutiveConsensus >= 2 || store.read().session.roundNumber >= MAX_ROUNDS) {
        await runSynthesis(client, store, notify, ctrl.signal);
        break;
      }

      // Pat input window
      store.setWaitingForInput(true);
      notify(['chatroom.json']);

      try { await sleep(INPUT_WINDOW_MS, ctrl.signal); } catch { break; }

      const afterWait = store.read();
      if (afterWait.session.pendingPatMessage) {
        store.appendMessage('pat', afterWait.session.pendingPatMessage, 'pat');
        store.setPendingPatMessage(undefined);
        notify(['chatroom.json']);
      }

      store.setWaitingForInput(false);
      notify(['chatroom.json']);

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
