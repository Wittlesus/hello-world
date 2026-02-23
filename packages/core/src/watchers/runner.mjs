#!/usr/bin/env node
/**
 * Hello World — Watcher Runner
 * Standalone ESM script. Spawned detached by hw_spawn_watcher.
 * Polls for a condition, executes an action, writes results, exits.
 *
 * Usage: node runner.mjs <watcherId> <projectRoot> <configJson>
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';

const [,, watcherId, projectRoot, configJson] = process.argv;

if (!watcherId || !projectRoot || !configJson) {
  process.stderr.write('Usage: runner.mjs <watcherId> <projectRoot> <configJson>\n');
  process.exit(1);
}

const config = JSON.parse(configJson);
const hwDir = join(projectRoot, '.hello-world');

const POLL_MS = 2000;
const timeoutMs = (config.timeoutMinutes ?? 60) * 60 * 1000;
const startedAt = Date.now();

// ── Helpers ───────────────────────────────────────────────────────

function safeRead(file) {
  try { return JSON.parse(readFileSync(join(hwDir, file), 'utf8')); }
  catch { return null; }
}

function safeWrite(file, data) {
  try { writeFileSync(join(hwDir, file), JSON.stringify(data, null, 2), 'utf8'); }
  catch { /* non-fatal */ }
}

function getTrackedPid() {
  try {
    const raw = readFileSync(join(hwDir, 'app.pid'), 'utf8').trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch { return null; }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true; // no throw = alive
  } catch (err) {
    if (err.code === 'EPERM') return true; // alive, different owner
    return false; // ESRCH = gone
  }
}

function fallbackAliveCheck() {
  // No user input — hardcoded args, no injection risk
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq hello-world.exe', '/NH'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toLowerCase().includes('hello-world.exe');
  } catch { return false; }
}

function writeResults(status, appliedCopies, errorMsg) {
  const completedAt = new Date().toISOString();

  // Update watchers.json
  try {
    const data = safeRead('watchers.json') ?? { active: [], completed: [] };
    const entry = data.active.find((w) => w.id === watcherId);
    data.active = data.active.filter((w) => w.id !== watcherId);
    if (entry) {
      data.completed.push({
        ...entry,
        status,
        completedAt,
        resultSummary: errorMsg ?? `Applied ${appliedCopies.filter(c => c.status === 'ok').length}/${appliedCopies.length} file(s)`,
      });
    }
    safeWrite('watchers.json', data);
  } catch { /* non-fatal */ }

  // Write crash-report.json
  const lastContext = safeRead('last-context.json');
  safeWrite('crash-report.json', {
    reportedAt: completedAt,
    watcherId,
    triggerType: 'app_shutdown_copy',
    appExitedAt: completedAt,
    appliedCopies,
    pendingChangesDescription: config.label ?? 'Rust file changes',
    lastContextFile: lastContext?.file ?? null,
    lastContextTask: lastContext?.task ?? null,
  });

  // Append to watcher-results.json
  try {
    let results = [];
    try { results = JSON.parse(readFileSync(join(hwDir, 'watcher-results.json'), 'utf8')); } catch {}
    results.push({ watcherId, status, completedAt, label: config.label, copies: appliedCopies });
    writeFileSync(join(hwDir, 'watcher-results.json'), JSON.stringify(results, null, 2), 'utf8');
  } catch { /* non-fatal */ }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  // Wait up to 10s for app.pid to appear (app may still be starting)
  let pid = null;
  for (let i = 0; i < 5; i++) {
    pid = getTrackedPid();
    if (pid) break;
    await sleep(2000);
  }

  // Poll until app process is gone
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      writeResults('timed_out', [], 'Watcher timed out — app never exited');
      process.exit(0);
    }

    await sleep(POLL_MS);

    const alive = pid ? isProcessAlive(pid) : fallbackAliveCheck();
    if (!alive) break;
  }

  // App has exited — execute file copies
  const appliedCopies = [];
  for (const { from, to } of (config.copies ?? [])) {
    if (!existsSync(from)) {
      appliedCopies.push({ from, to, status: 'error', errorMessage: 'source not found' });
      continue;
    }
    try {
      copyFileSync(from, to);
      appliedCopies.push({ from, to, status: 'ok' });
    } catch (err) {
      appliedCopies.push({ from, to, status: 'error', errorMessage: String(err.message) });
    }
  }

  writeResults('completed', appliedCopies, null);
  process.exit(0);
}

main().catch((err) => {
  writeResults('failed', [], String(err.message));
  process.exit(1);
});
