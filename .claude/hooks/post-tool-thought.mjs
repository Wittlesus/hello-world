#!/usr/bin/env node
/**
 * Hello World — PostToolUse hook
 * Generates a human-readable thought and POSTs it to the loopback HTTP listener.
 * Buddy renders a live stream of recent thoughts.
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

const toolName = process.env.CLAUDE_TOOL_NAME ?? '';
let toolInput = {};
try {
  const envInput = process.env.CLAUDE_TOOL_INPUT;
  if (envInput) toolInput = JSON.parse(envInput);
} catch {
  /* ignore */
}

// Return last N path segments relative to project root
function shortPath(p, segments = 2) {
  if (!p) return '';
  const rel = (p + '').replace(/\\/g, '/').replace(PROJECT.replace(/\\/g, '/'), '');
  const parts = rel.replace(/^\//, '').split('/').filter(Boolean);
  return parts.length <= segments ? parts.join('/') : parts.slice(-segments).join('/');
}

function basename(p) {
  return (p ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
}

function parentDir(p) {
  const parts = (p ?? '').replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] + '/' : '';
}

function summarize(name, input) {
  switch (name) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return `editing ${parentDir(input.file_path)}${basename(input.file_path)}`;
    case 'Read':
      return `reading ${shortPath(input.file_path)}`;
    case 'Bash': {
      const cmd = (input.command ?? '').trim();
      const npmRun = cmd.match(/npm run (\S+)/);
      if (npmRun) return `running ${npmRun[1]}`;
      const gitOp = cmd.match(/git (\S+)/);
      if (gitOp) return `git ${gitOp[1]}`;
      if (/\btsc\b/.test(cmd)) return 'type-checking';
      const cargoOp = cmd.match(/cargo (\S+)/);
      if (cargoOp) return `cargo ${cargoOp[1]}`;
      return `$ ${cmd.slice(0, 45)}`;
    }
    case 'Glob': {
      const pat = (input.pattern ?? '')
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/^[/.]/, '');
      const inDir = input.path ? ` in ${shortPath(input.path, 1)}` : '';
      return `scanning${inDir} for ${pat || input.pattern}`;
    }
    case 'Grep': {
      const pat = (input.pattern ?? '').slice(0, 28);
      const where = input.path ? shortPath(input.path, 1) : (input.glob ?? 'project');
      return `searching ${where} for ${pat}`;
    }
    case 'Task':
      return `spawning ${(input.subagent_type ?? 'agent').replace(/-/g, ' ')}`;
    default:
      return null;
  }
}

const summary = summarize(toolName, toolInput);
if (!summary) process.exit(0);

const body = JSON.stringify({ summary, type: 'thought', files: [] });
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
