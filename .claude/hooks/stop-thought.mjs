#!/usr/bin/env node
/**
 * Hello World — Stop hook
 * Fires when Claude finishes a turn.
 * 1. Detects significant signals in Claude's response (auto-capture pipeline)
 * 2. POSTs type:'awaiting' to loopback so Buddy transitions state.
 */

import { readFileSync } from 'fs';
import { request } from 'http';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read active project from app config; fall back to hello-world
const DEFAULT_PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const PROJECT = (() => {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.hello-world-app.json'), 'utf8'));
    return cfg?.projectPath || DEFAULT_PROJECT;
  } catch {
    return DEFAULT_PROJECT;
  }
})();
const HW = join(PROJECT, '.hello-world');

function safeRead(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// ── Signal Detection (auto-capture pipeline) ─────────────────────

try {
  // Read stdin for last_assistant_message
  let lastMessage = '';
  try {
    const raw = readFileSync(0, 'utf8');
    const parsed = JSON.parse(raw);
    lastMessage = parsed?.last_assistant_message ?? '';
  } catch {
    lastMessage = '';
  }

  if (lastMessage.length >= 50) {
    const {
      detectAssistantSignals,
      validateSignals,
      enqueueSignals,
    } = await import(pathToFileURL(join(__dirname, 'signal-detector.mjs')).href);

    // Layer 1: regex pre-filter
    const rawSignals = detectAssistantSignals(lastMessage);

    if (rawSignals.length > 0) {
      // Layer 2: structural validation (check recent user message for pushback context)
      // Read last user message from signal-queue metadata if available
      const queue = safeRead(join(HW, 'signal-queue.json'));
      const recentUserText = queue?.lastUserMessage ?? '';
      const validated = validateSignals(rawSignals, recentUserText);

      // Queue validated signals
      enqueueSignals(validated);

      process.stderr.write(
        `[signal-detector] ${validated.length} signal(s): ${validated.map(s => s.type).join(', ')}\n`
      );
    }
  }
} catch (err) {
  // Signal detection is non-fatal, but log errors for debugging
  process.stderr.write(`[signal-detector] Error: ${err.message}\n`);
}

// ── Buddy signal: awaiting response ─────────────────────────────

const sync = safeRead(join(HW, 'sync.json'));
if (!sync?.port) process.exit(0);

const body = JSON.stringify({ summary: 'Awaiting response...', type: 'awaiting', files: [] });

// Fire-and-forget HTTP, but don't exit until it completes or times out
const done = new Promise(resolve => {
  const req = request(
    {
      hostname: '127.0.0.1',
      port: sync.port,
      method: 'POST',
      path: '/',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Connection: 'close',
      },
    },
    () => resolve(),
  );
  req.setTimeout(1500, () => { req.destroy(); resolve(); });
  req.on('error', () => resolve());
  req.write(body);
  req.end();
});

await done;
process.exit(0);
