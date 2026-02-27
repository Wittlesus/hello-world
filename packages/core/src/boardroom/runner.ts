import { AGENT_DEFINITIONS } from '../chatroom/agent-definitions.js';
import type { Boardroom, BoardroomAgent } from './types.js';
import { CHAT_CHAR_LIMIT } from './types.js';
import { postChat, writeWhiteboard, readBoardroom } from './store.js';
import { recordUsage } from './usage.js';

// Qwen API config (shared with chatroom agent-runner)
const QWEN_MODEL = process.env['QWEN_MODEL'] ?? 'Qwen/Qwen3-235B-A22B-Instruct-2507-TEE';
const QWEN_BASE_URL = process.env['QWEN_BASE_URL'] ?? 'https://llm.chutes.ai/v1';
const QWEN_API_KEY = process.env['QWEN_API_KEY'] ?? '';

const BETWEEN_AGENT_MS = 800;
const MAX_ROUNDS = 8;

let activeRunner: AbortController | null = null;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

async function callQwenBoardroom(
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal,
  thinking = false,
): Promise<string> {
  if (!QWEN_API_KEY) throw new Error('QWEN_API_KEY not set');

  const resp = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: QWEN_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: thinking ? 2000 : 400,
      temperature: 0.7,
      chat_template_kwargs: { enable_thinking: thinking },
    }),
    signal,
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Qwen ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  // Track usage
  const usage = json.usage;
  if (usage) {
    try {
      const projectRoot = process.env['HW_PROJECT_ROOT'] ?? '';
      if (projectRoot) {
        recordUsage(projectRoot, QWEN_MODEL, 'qwen', usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, 'boardroom');
      }
    } catch { /* non-fatal */ }
  }

  return (json.choices?.[0]?.message?.content ?? '').trim();
}

// Claude call for boardroom (reuses spawn pattern from chatroom)
async function callClaudeBoardroom(
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal,
): Promise<string> {
  const { spawn } = await import('child_process');
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('aborted')); return; }

    const env = { ...process.env };
    delete env['CLAUDECODE'];
    delete env['CLAUDE_CODE_ENTRYPOINT'];
    env['HW_AGENT_MODE'] = '1';

    const prompt = `${systemPrompt}\n\n${userMessage}`;
    const child = spawn(
      'claude',
      ['--print', '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text', '--max-turns', '1', '--dangerously-skip-permissions'],
      { env, stdio: ['pipe', 'pipe', 'pipe'], shell: true },
    );

    child.stdin.write(prompt);
    child.stdin.end();

    let stdout = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });

    const timeout = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 30_000);
    const onAbort = () => { clearTimeout(timeout); child.kill(); reject(new Error('aborted')); };
    signal.addEventListener('abort', onAbort, { once: true });

    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) return;
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`claude exited ${code}`));
    });
    child.on('error', (err: Error) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

function buildBoardroomPrompt(agent: BoardroomAgent, boardroom: Boardroom, round: number, maxRounds: number): string {
  // Get deliberation-style system prompt if it exists, otherwise use role
  const delibDef = AGENT_DEFINITIONS[agent.id];
  const roleDesc = delibDef?.systemPrompt ?? `You are ${agent.name}. Role: ${agent.role}`;

  // Phase guidance based on round number
  const phase = round < 1
    ? 'Introduce your key perspective on this topic.'
    : round >= maxRounds - 2
      ? 'Converge. Synthesize what the team has discussed into a concrete recommendation.'
      : 'Build on what has been said. Challenge or extend, don\'t repeat.';

  // Agent's own last message (prevents repetition)
  const ownLast = [...boardroom.chat].reverse().find(m => m.agentId === agent.id);
  const ownLastLine = ownLast ? `\nYour last message: "${ownLast.text}"` : '';

  const recentChat = boardroom.chat
    .slice(-20)
    .map((m) => {
      const a = boardroom.agents.find((x) => x.id === m.agentId);
      return `[${a?.name ?? m.agentId}] ${m.text}`;
    })
    .join('\n');

  const whiteboardSummary = boardroom.whiteboard.length > 0
    ? '\n\nWhiteboard:\n' + boardroom.whiteboard
        .slice(-10)
        .map((w) => {
          const a = boardroom.agents.find((x) => x.id === w.agentId);
          return `[${w.section} by ${a?.name ?? w.agentId}] ${w.content.slice(0, 300)}`;
        })
        .join('\n')
    : '';

  return `${roleDesc}

BOARDROOM RULES (these override everything else):
- You are in a team boardroom, not a debate. Collaborate, don't argue.
- MAX ${CHAT_CHAR_LIMIT} CHARACTERS. Your entire response must be under ${CHAT_CHAR_LIMIT} chars. This is a hard limit.
- Be direct. No filler. No "I think" or "In my opinion". Just say the thing.
- Build on what others said. Reference teammates by name.
- To share detailed findings, say "posting to whiteboard:" followed by your content on the next line(s).

Round ${round + 1} of ${maxRounds}. ${phase}

Topic: "${boardroom.topic}"
${ownLastLine}

Recent chat:
${recentChat || '(empty -- you are first to speak)'}${whiteboardSummary}

Respond now. Under ${CHAT_CHAR_LIMIT} characters. Plain text only.`;
}

async function runAgentTurn(
  projectPath: string,
  boardroom: Boardroom,
  agent: BoardroomAgent,
  signal: AbortSignal,
  round: number,
  maxRounds: number,
): Promise<void> {
  if (signal.aborted) return;

  const prompt = buildBoardroomPrompt(agent, boardroom, round, maxRounds);
  try {
    const raw = agent.provider === 'qwen'
      ? await callQwenBoardroom('', prompt, signal, agent.thinking ?? false)
      : await callClaudeBoardroom('', prompt, signal);
    if (signal.aborted) return;

    // Check if agent wants to post to whiteboard
    const wbMatch = raw.match(/posting to whiteboard[:\s]*([\s\S]+)/i);
    if (wbMatch) {
      writeWhiteboard(projectPath, boardroom.id, agent.id, 'findings', wbMatch[1].trim());
      postChat(projectPath, boardroom.id, agent.id, raw.slice(0, CHAT_CHAR_LIMIT));
    } else {
      postChat(projectPath, boardroom.id, agent.id, raw.slice(0, CHAT_CHAR_LIMIT));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    postChat(projectPath, boardroom.id, agent.id, `[error: ${msg.slice(0, 120)}]`);
  }
}

export async function runBoardroom(
  projectPath: string,
  boardroomId: string,
  notify?: (files?: string[]) => void,
  rounds?: number,
): Promise<void> {
  if (activeRunner) activeRunner.abort();
  const ctrl = new AbortController();
  activeRunner = ctrl;

  const maxRounds = rounds ?? MAX_ROUNDS;

  try {
    for (let round = 0; round < maxRounds; round++) {
      const boardroom = readBoardroom(projectPath, boardroomId);
      if (!boardroom || boardroom.status !== 'active' || ctrl.signal.aborted) break;

      for (const agent of boardroom.agents) {
        if (ctrl.signal.aborted) break;

        // Re-read to get latest chat
        const current = readBoardroom(projectPath, boardroomId);
        if (!current || current.status !== 'active') break;

        await runAgentTurn(projectPath, current, agent, ctrl.signal, round, maxRounds);
        notify?.([`boardrooms/${boardroomId}.json`]);

        try { await sleep(BETWEEN_AGENT_MS, ctrl.signal); } catch { break; }
      }
    }
  } catch {
    // Runner stopped
  } finally {
    if (activeRunner === ctrl) activeRunner = null;
  }
}

export function stopBoardroom(): void {
  if (activeRunner) {
    activeRunner.abort();
    activeRunner = null;
  }
}
