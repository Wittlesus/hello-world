#!/usr/bin/env node
/**
 * Hello World — PostToolUse hook (Edit|Write|Bash|Read matcher)
 * Generates a human-readable summary and POSTs it to the loopback HTTP listener,
 * which emits hw-tool-summary → Claude Buddy speech bubble updates in real time.
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

// Get loopback port from sync.json
const sync = safeRead(join(HW, 'sync.json'));
if (!sync?.port) process.exit(0);

// Read tool call info from env
const toolName = process.env.CLAUDE_TOOL_NAME ?? '';
let toolInput = {};
try {
  const envInput = process.env.CLAUDE_TOOL_INPUT;
  if (envInput) toolInput = JSON.parse(envInput);
} catch { /* ignore */ }

function basename(p) {
  return (p ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
}

function summarize(name, input) {
  switch (name) {
    case 'Edit':  return `editing ${basename(input.file_path)}`;
    case 'Write': return `writing ${basename(input.file_path)}`;
    case 'Read':  return `reading ${basename(input.file_path)}`;
    case 'Bash':  return `$ ${(input.command ?? '').trim().slice(0, 50)}`;
    default:      return null;
  }
}

const summary = summarize(toolName, toolInput);
if (!summary) process.exit(0);

// Fire-and-forget POST to loopback
const body = JSON.stringify({ summary, files: [] });
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
