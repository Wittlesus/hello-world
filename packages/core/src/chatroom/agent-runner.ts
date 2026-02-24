import { spawn } from 'child_process';
import { ChatroomStore } from './chatroom-state.js';
import { AGENT_DEFINITIONS } from './agent-definitions.js';
import type { ChatMessage } from './types.js';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_ROUNDS = 5;
const BETWEEN_AGENT_MS = 1400;
const INTRO_DELAY_MS = 2800;
const INPUT_WINDOW_MS = 8_000;

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
  pragmatist:
    'Pragmatist: cuts through theory. What can actually ship with the resources we have right now?',
  uxdesigner:
    'UX Designer: evaluates user flows, friction points, and cognitive load. Every extra click is a cost the user pays.',
  backendarch:
    'Backend Architect: thinks in data models, system boundaries, and failure modes. Systems fail at boundaries.',
  productmgr:
    'Product Manager: ruthlessly cuts scope to the minimum that delivers core value. What should we say no to?',
  costanalyst:
    'Cost Analyst: evaluates token spend, resource costs, and ROI. Every feature has a recurring cost.',
  devops:
    'DevOps: focuses on reliability, observability, and deploy safety. If you can not observe it, you can not operate it.',
  security:
    'Security: finds trust boundaries, data exposure, and attack surface. The simplest attack is the most common.',
  newuser:
    'New User: first-time impressions. Where does a real user get confused, stuck, or bounce?',
  poweruser:
    'Power User: months of experience. Strong opinions on what should be faster, simpler, or more powerful.',
};

let activeRunner: AbortController | null = null;

// Strip markdown formatting and agent name prefixes from responses.
// Agents sometimes output **Bold**, ## Headers, or prefix with their name.
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,4}\s+/gm, '')           // ## Headers
    .replace(/\*\*([^*]+)\*\*/g, '$1')      // **bold**
    .replace(/\*([^*]+)\*/g, '$1')          // *italic*
    .replace(/^[-*]\s+/gm, '')              // - bullet points
    .replace(/^\d+\.\s+/gm, '')            // 1. numbered lists
    .replace(/^>\s+/gm, '')                // > blockquotes
    .replace(/`([^`]+)`/g, '$1')           // `inline code`
    .replace(/^(Contrarian|Pre-mortem|First Principles|Steelman|Analogist|Constraint|Pragmatist|UX Designer|Backend Architect|Product Manager|Cost Analyst|DevOps|Security|New User|Power User)(\s*(responds?|synthesizes?|observes?|notes?|adds?|counters?|replies?|clarifies?|argues?|warns?|concludes?|opens?|challenges?|asks?|—[^:]*)?)\s*:\s*/im, '')
    .trim();
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });
}

// Spawn claude CLI subprocess with CLAUDECODE unset to allow nesting.
// Uses existing Claude Code OAuth — no separate API key needed.
// Pipes prompt via stdin to avoid all Windows cmd.exe escaping issues.
function callClaude(systemPrompt: string, userMessage: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('aborted')); return; }

    const env = { ...process.env };
    delete env['CLAUDECODE'];
    delete env['CLAUDE_CODE_ENTRYPOINT'];
    env['HW_AGENT_MODE'] = '1'; // prevent session-start hook from firing + wiping chatroom

    const prompt = `${systemPrompt}\n\n${userMessage}`;

    // shell:true so Windows finds claude.cmd in PATH
    // stdin piped so we can write the prompt directly — no temp files, no escaping
    const child = spawn(
      'claude',
      ['--print', '--model', MODEL, '--output-format', 'text', '--max-turns', '1', '--dangerously-skip-permissions'],
      { env, stdio: ['pipe', 'pipe', 'pipe'], shell: true },
    );

    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('agent timed out after 45s'));
    }, 45_000);

    const onAbort = () => { clearTimeout(timeout); child.kill(); reject(new Error('aborted')); };
    signal.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err: Error) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) return;
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.slice(0, 300) || `claude exited with code ${code}`));
    });
  });
}

function buildConversation(history: ChatMessage[], topic: string): string {
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

  return `Topic: "${topic}"\n\nDiscussion so far:\n${conversation}\n\nRespond now. HARD RULE: 4 sentences maximum. Stay in your assigned role.`;
}

async function runSingleAgent(
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

  try {
    const raw = await callClaude(def.systemPrompt, buildConversation(state.messages, state.session.topic), signal);
    if (signal.aborted) return;
    store.appendMessage(agentId, stripMarkdown(raw), 'message');
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

    store.setIntroRevealedCount(i + 1);
    notify(['chatroom.json']);

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

async function checkConsensus(messages: ChatMessage[], topic: string): Promise<boolean> {
  const recent = messages
    .filter(m => m.type === 'message')
    .slice(-10)
    .map(m => `${AGENT_DEFINITIONS[m.agentId]?.name ?? m.agentId}: ${m.text.slice(0, 120)}`)
    .join('\n');

  if (!recent) return false;

  const ctrl = new AbortController();
  try {
    const answer = await callClaude(
      'You are a neutral observer. Answer YES or NO only. No other text.',
      `Topic: "${topic}"\n\nRecent discussion:\n${recent}\n\nHave a majority of participants converged on a shared answer or direction? Answer YES or NO only.`,
      ctrl.signal,
    );
    return answer.toUpperCase().startsWith('YES');
  } catch {
    return false;
  }
}

async function runSynthesis(
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
    const synthesis = await callClaude(
      'You are Claude, moderating a deliberation. Be direct and concise.',
      `Deliberation topic: "${state.session.topic}"\n\nFull discussion:\n${discussion}\n\nWrite a synthesis: state the core question, note points of agreement, surface key tensions, give a concrete recommendation. 100-150 words maximum. Be direct.`,
      signal,
    );
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

  try {
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

      const agentIds = state.agents.map(a => a.id);
      for (const agentId of agentIds) {
        if (ctrl.signal.aborted) break;
        await runSingleAgent(store, agentId, notify, ctrl.signal);
        try { await sleep(BETWEEN_AGENT_MS, ctrl.signal); } catch { break; }
      }

      if (ctrl.signal.aborted) break;

      const afterRound = store.read();
      if (afterRound.session.roundNumber >= 2) {
        const hasConsensus = await checkConsensus(afterRound.messages, afterRound.session.topic);
        consecutiveConsensus = hasConsensus ? consecutiveConsensus + 1 : 0;
      }

      if (consecutiveConsensus >= 2 || store.read().session.roundNumber >= MAX_ROUNDS) {
        await runSynthesis(store, notify, ctrl.signal);
        break;
      }

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
