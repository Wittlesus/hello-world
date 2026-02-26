#!/usr/bin/env node
/**
 * Hello World -- Crash Safety Sentinel
 *
 * A hidden detached process spawned by Buddy on app startup.
 * Polls the Tauri app PID. When the PID dies (crash or clean exit),
 * runs crash recovery: backup state files, write crash-marker.json.
 *
 * Usage: node sentinel.mjs <projectPath> <appPid>
 *
 * Writes its own PID to .hello-world/sentinel.json for health checks.
 * Buddy checks this PID to show shield indicator (lit = active, dark = dead).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const projectPath = process.argv[2];
const appPid = parseInt(process.argv[3], 10);

if (!projectPath || !appPid || isNaN(appPid)) {
  process.exit(1);
}

const hwDir = join(projectPath, '.hello-world');
const sentinelPath = join(hwDir, 'sentinel.json');
const crashMarkerPath = join(hwDir, 'crash-marker.json');
const backupDir = join(hwDir, 'crash-backup');

// Write sentinel PID so buddy can health-check us
writeFileSync(sentinelPath, JSON.stringify({
  pid: process.pid,
  appPid,
  startedAt: new Date().toISOString(),
  status: 'polling',
}));

// Detach from parent stdio so we survive cleanly
if (process.stdin) {
  try { process.stdin.unref(); } catch { /* ignore */ }
}

const POLL_INTERVAL = 2500; // 2.5s

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = existence check, doesn't kill
    return true;
  } catch {
    return false;
  }
}

function runCrashRecovery() {
  // Backup state files
  const filesToBackup = [
    'tasks.json', 'decisions.json', 'questions.json', 'memories.json',
    'sessions.json', 'activity.json', 'workflow.json', 'direction.json',
    'approvals.json', 'chatroom.json', 'mode.json',
  ];

  try {
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

    for (const file of filesToBackup) {
      const src = join(hwDir, file);
      if (existsSync(src)) {
        copyFileSync(src, join(backupDir, file));
      }
    }
  } catch {
    // Best effort -- don't crash the sentinel itself
  }

  // Determine if this was a clean exit or crash
  // Clean exit: sessions.json has the latest session with an endedAt timestamp
  // Crash: latest session has no endedAt
  let wasCrash = true;
  try {
    const sessions = JSON.parse(readFileSync(join(hwDir, 'sessions.json'), 'utf8'));
    const allSessions = sessions?.sessions ?? [];
    if (allSessions.length > 0) {
      const latest = allSessions[allSessions.length - 1];
      if (latest.endedAt) wasCrash = false;
    }
  } catch {
    // Can't read sessions = assume crash
  }

  // Write crash marker
  writeFileSync(crashMarkerPath, JSON.stringify({
    detectedAt: new Date().toISOString(),
    appPid,
    wasCrash,
    backupDir,
    recovered: false,
  }));

  // Update sentinel status
  writeFileSync(sentinelPath, JSON.stringify({
    pid: process.pid,
    appPid,
    startedAt: new Date().toISOString(),
    status: wasCrash ? 'crash-detected' : 'clean-exit',
    detectedAt: new Date().toISOString(),
  }));
}

// Poll loop
function poll() {
  if (isProcessAlive(appPid)) {
    setTimeout(poll, POLL_INTERVAL);
  } else {
    // App is dead -- run recovery and exit
    runCrashRecovery();
    process.exit(0);
  }
}

poll();
