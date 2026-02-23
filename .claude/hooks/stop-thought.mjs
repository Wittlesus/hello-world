#!/usr/bin/env node
/**
 * Hello World — Stop hook
 * Fires when Claude finishes a turn. POSTs type:'awaiting' to loopback
 * so Buddy transitions to "Awaiting response..." state.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { request } from 'http';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');

function safeRead(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
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
      'Connection': 'close',
    },
  },
  () => { process.exit(0); }
);
req.on('error', () => { process.exit(0); });
req.write(body);
req.end();
