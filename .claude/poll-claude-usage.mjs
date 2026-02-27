#!/usr/bin/env node
/**
 * Background poller: fetches claude.ai web usage via Chrome DevTools Protocol.
 * Requires Chrome started with --remote-debugging-port=9222
 * Merges webUsage into .hello-world/claude-usage.json every 60s.
 * Exits silently if CDP unavailable. Zero dependencies (Node 22+ built-ins).
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const USAGE_FILE = join(PROJECT, '.hello-world', 'claude-usage.json');
const PID_FILE = join(PROJECT, '.hello-world', '.usage-poller-pid');
const CDP_PORT = 9222;
const ORG_UUID = '1e24e55c-ca57-4cda-a02d-9d6ae0cd68b3';
const API_PATH = `/api/organizations/${ORG_UUID}/usage`;
const POLL_MS = 60_000;

/** Send a CDP command over WebSocket, return the result. */
function cdpEval(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 10000);
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          if (msg.result?.result?.value) resolve(msg.result.result.value);
          else reject(new Error('eval failed'));
        }
      } catch {}
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
    ws.onclose = () => { clearTimeout(timer); };
  });
}

/** Convert API snake_case to our camelCase format and merge into file. */
function mergeWebUsage(api) {
  const webUsage = {
    fetchedAt: new Date().toISOString(),
    fiveHour: { utilization: api.five_hour?.utilization ?? 0, resetsAt: api.five_hour?.resets_at ?? '' },
    sevenDay: { utilization: api.seven_day?.utilization ?? 0, resetsAt: api.seven_day?.resets_at ?? '' },
    sevenDaySonnet: api.seven_day_sonnet
      ? { utilization: api.seven_day_sonnet.utilization, resetsAt: api.seven_day_sonnet.resets_at }
      : null,
    extraUsage: api.extra_usage
      ? { isEnabled: api.extra_usage.is_enabled, monthlyLimit: api.extra_usage.monthly_limit,
          usedCredits: api.extra_usage.used_credits, utilization: api.extra_usage.utilization }
      : null,
  };

  let existing = {};
  try { existing = JSON.parse(readFileSync(USAGE_FILE, 'utf8')); } catch {}
  existing.webUsage = webUsage;

  const tmp = USAGE_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(existing, null, 2), 'utf8');
  renameSync(tmp, USAGE_FILE);
}

async function poll() {
  try {
    // Find a claude.ai tab via CDP
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(3000) });
    const targets = await res.json();
    const tab = targets.find(t => t.type === 'page' && t.url?.includes('claude.ai'));
    if (!tab?.webSocketDebuggerUrl) return;

    // Fetch usage API from within the tab (same-origin, cookies included)
    const js = `(async()=>{const r=await fetch('${API_PATH}',{credentials:'include'});return await r.json()})()`;
    const data = await cdpEval(tab.webSocketDebuggerUrl, js);
    if (data?.five_hour) mergeWebUsage(data);
  } catch {
    // CDP not available or no claude.ai tab -- silent
  }
}

// Write PID, poll immediately, then every 60s
try { writeFileSync(PID_FILE, String(process.pid), 'utf8'); } catch {}
poll();
setInterval(poll, POLL_MS);

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
