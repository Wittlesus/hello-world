#!/usr/bin/env node
/**
 * Hello World — Stop hook
 * Fires when Claude finishes a turn. POSTs type:'awaiting' to loopback
 * so Buddy transitions to "Awaiting response..." state.
 */

import { readFileSync } from 'fs';
import { request } from 'http';
import { homedir } from 'os';
import { join } from 'path';

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

const sync = safeRead(join(HW, 'sync.json'));
if (!sync?.port) process.exit(0);

const body = JSON.stringify({ summary: 'Awaiting response...', type: 'awaiting', files: [] });
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
  () => {
    process.exit(0);
  },
);
req.on('error', () => {
  process.exit(0);
});
req.write(body);
req.end();
