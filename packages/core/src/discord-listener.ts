/**
 * Discord DM listener — runs as a background process alongside the app.
 * Watches for Pat's approval replies and direction messages, writes results
 * directly to .hello-world/approvals.json and .hello-world/direction.json.
 *
 * Commands Pat can send:
 *   approve <id>          — approve a pending request
 *   reject <id>           — reject a pending request
 *   reject <id> <reason>  — reject with reason
 *   note <text>           — leave a direction note for next session
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const BOT_TOKEN = 'MTQ3NTI3NjQ3OTY4MzIzNTk0Mg.GMInN0.NxGNJTClBjBfSx8Jde5UXC3QT4-lVg1Yjzlr1o';
const PAT_USER_ID = '403706305144946690';
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const DISCORD_API = 'https://discord.com/api/v10';
const PROJECT_ROOT = process.env.HW_PROJECT_ROOT ?? 'C:/Users/Patri/CascadeProjects/hello-world';
const HW_DIR = join(PROJECT_ROOT, '.hello-world');

// ── Discord REST ─────────────────────────────────────────────────

async function discordFetch(path: string, options: RequestInit = {}) {
  return fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

async function sendDM(userId: string, content: string) {
  const dmRes = await discordFetch('/users/@me/channels', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: userId }),
  });
  const dm = await dmRes.json() as { id?: string };
  if (!dm.id) return;
  await discordFetch(`/channels/${dm.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

// ── Approvals file ───────────────────────────────────────────────

interface ApprovalRequest {
  id: string;
  action: string;
  description: string;
  status?: string;
  resolution?: string;
  resolvedAt?: string;
}

interface ApprovalsData {
  pending: ApprovalRequest[];
  resolved: ApprovalRequest[];
}

function readApprovals(): ApprovalsData {
  const path = join(HW_DIR, 'approvals.json');
  if (!existsSync(path)) return { pending: [], resolved: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeApprovals(data: ApprovalsData) {
  writeFileSync(join(HW_DIR, 'approvals.json'), JSON.stringify(data, null, 2));
}

function resolveApproval(id: string, decision: 'approved' | 'rejected', notes = ''): ApprovalRequest | null {
  const data = readApprovals();
  const idx = data.pending.findIndex(r => r.id === id);
  if (idx === -1) return null;

  const [request] = data.pending.splice(idx, 1);
  const resolved: ApprovalRequest = {
    ...request,
    status: decision,
    resolution: notes,
    resolvedAt: new Date().toISOString(),
  };
  data.resolved.push(resolved);
  writeApprovals(data);
  return resolved;
}

// ── Direction notes ──────────────────────────────────────────────

interface DirectionFile {
  vision?: string;
  scope?: unknown[];
  notes?: { id: string; text: string; source: string; read: boolean; capturedAt: string }[];
}

function appendDirection(text: string) {
  const path = join(HW_DIR, 'direction.json');
  let data: DirectionFile = { vision: '', scope: [], notes: [] };
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      // Support old array format (migrate on the fly)
      data = Array.isArray(parsed)
        ? { vision: '', scope: [], notes: parsed.map((n: { text: string; ts: string }) => ({
            id: `n_discord_${Date.now()}`, text: n.text, source: 'discord', read: false, capturedAt: n.ts,
          })) }
        : parsed;
    } catch { /* ok */ }
  }
  if (!Array.isArray(data.notes)) data.notes = [];
  data.notes.push({
    id: `n_discord_${Date.now()}`,
    text,
    source: 'discord',
    read: false,
    capturedAt: new Date().toISOString(),
  });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ── Command handler ──────────────────────────────────────────────

async function handleMessage(content: string, authorId: string) {
  if (authorId !== PAT_USER_ID) return; // only respond to Pat

  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();

  // approve <id>
  if (lower.startsWith('approve ')) {
    const id = trimmed.slice(8).trim();
    const resolved = resolveApproval(id, 'approved');
    if (resolved) {
      await sendDM(PAT_USER_ID, `Approved: **${resolved.action}** (${id}). Claude can proceed.`);
    } else {
      await sendDM(PAT_USER_ID, `No pending request found with ID: ${id}`);
    }
    return;
  }

  // reject <id> [reason]
  if (lower.startsWith('reject ')) {
    const rest = trimmed.slice(7).trim();
    const [id, ...reasonParts] = rest.split(' ');
    const reason = reasonParts.join(' ');
    const resolved = resolveApproval(id, 'rejected', reason);
    if (resolved) {
      await sendDM(PAT_USER_ID, `Rejected: **${resolved.action}** (${id}).${reason ? ` Reason: ${reason}` : ''}`);
    } else {
      await sendDM(PAT_USER_ID, `No pending request found with ID: ${id}`);
    }
    return;
  }

  // note <text> — direction for next session
  if (lower.startsWith('note ')) {
    const text = trimmed.slice(5).trim();
    appendDirection(text);
    await sendDM(PAT_USER_ID, `Direction noted. Claude will see it at next session start.`);
    return;
  }

  // list — show pending approvals
  if (lower === 'list') {
    const data = readApprovals();
    if (data.pending.length === 0) {
      await sendDM(PAT_USER_ID, 'No pending approvals.');
    } else {
      const lines = data.pending.map(r => `\`${r.id}\` **${r.action}** — ${r.description}`).join('\n');
      await sendDM(PAT_USER_ID, `Pending approvals:\n${lines}`);
    }
    return;
  }

  // help
  if (lower === 'help') {
    await sendDM(PAT_USER_ID, [
      '**Hello World bot commands:**',
      '`approve <id>` — approve a pending request',
      '`reject <id> [reason]` — reject a pending request',
      '`note <text>` — leave direction for next Claude session',
      '`list` — show pending approvals',
    ].join('\n'));
  }
}

// ── Discord Gateway ──────────────────────────────────────────────

const INTENTS = 1 << 12; // DIRECT_MESSAGES

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let sequence: number | null = null;

function connect() {
  const ws = new WebSocket(GATEWAY_URL);

  ws.addEventListener('open', () => {
    console.log('[discord-listener] Connected to gateway');
  });

  ws.addEventListener('message', async (event) => {
    const payload = JSON.parse(event.data as string) as {
      op: number;
      d?: unknown;
      s?: number;
      t?: string;
    };

    if (payload.s != null) sequence = payload.s;

    switch (payload.op) {
      case 10: { // HELLO — start heartbeat and identify
        const d = payload.d as { heartbeat_interval: number };
        heartbeatInterval = setInterval(() => {
          ws.send(JSON.stringify({ op: 1, d: sequence }));
        }, d.heartbeat_interval);

        ws.send(JSON.stringify({
          op: 2, // IDENTIFY
          d: {
            token: BOT_TOKEN,
            intents: INTENTS,
            properties: { os: 'windows', browser: 'hw-bot', device: 'hw-bot' },
          },
        }));
        break;
      }

      case 0: { // DISPATCH
        if (payload.t === 'MESSAGE_CREATE') {
          const msg = payload.d as {
            content: string;
            author: { id: string };
            guild_id?: string;
          };
          // Only handle DMs (no guild_id) from Pat
          if (!msg.guild_id && msg.author.id === PAT_USER_ID) {
            await handleMessage(msg.content, msg.author.id);
          }
        }
        break;
      }

      case 7:  // RECONNECT
      case 9:  // INVALID SESSION
        ws.close();
        break;
    }
  });

  ws.addEventListener('close', (event) => {
    console.log(`[discord-listener] Disconnected (${event.code}), reconnecting in 5s...`);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    setTimeout(connect, 5000);
  });

  ws.addEventListener('error', (err) => {
    console.error('[discord-listener] WebSocket error:', err);
  });
}

console.log('[discord-listener] Starting...');
connect();
