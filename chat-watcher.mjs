#!/usr/bin/env node
/**
 * chat-watcher.mjs
 *
 * Polls the Hello World chat bridge (port 3456) every second.
 * When a message is queued, injects "CHATPING" into the Windows Terminal
 * tab running Claude Code — waking it up to call hw_await_message.
 *
 * Usage: node chat-watcher.mjs
 * Keep running in a separate terminal while using the Hello World app.
 */

import { execFileSync } from 'child_process';

const HEALTH_URL = 'http://127.0.0.1:3456/health';
const POLL_MS = 1000;
const CODEWORD = 'CHATPING';

// PowerShell args (array — no shell injection possible)
function makePsArgs() {
  const script = [
    `$wshell = New-Object -ComObject WScript.Shell`,
    `if ($wshell.AppActivate('claude-hw')) {`,
    `  Start-Sleep -Milliseconds 200`,
    `  $wshell.SendKeys('${CODEWORD}{ENTER}')`,
    `}`,
  ].join('; ');
  return ['-NoProfile', '-NonInteractive', '-Command', script];
}

let lastQueueLength = 0;
let pingInFlight = false;

async function poll() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return;
    const { queueLength } = await res.json();

    // Only ping when queue grows (new message arrived), not repeatedly
    if (queueLength > 0 && queueLength >= lastQueueLength && !pingInFlight) {
      pingInFlight = true;
      console.log(`[chat-watcher] Message detected (queue: ${queueLength}) — sending ping`);
      execFileSync('powershell.exe', makePsArgs(), { stdio: 'ignore' });
      // Debounce: don't ping again for 3s
      setTimeout(() => { pingInFlight = false; }, 3000);
    }

    lastQueueLength = queueLength;
  } catch {
    // Bridge not up yet or poll failed — ignore silently
  }

  setTimeout(poll, POLL_MS);
}

console.log('[chat-watcher] Started. Polling http://127.0.0.1:3456 every 1s');
console.log('[chat-watcher] When you type in the Hello World app, Claude Code wakes up automatically.');
console.log('[chat-watcher] Ctrl+C to stop.\n');

poll();
