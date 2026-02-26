#!/usr/bin/env node
/**
 * PostToolUse hook — runs cargo check after any .rs edit in a worktree.
 * Outputs compile errors immediately so Claude can fix them before moving on.
 * Only fires on worktree Rust edits (main workspace is hard-blocked by pre-tool-gate.mjs).
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

let toolInput;
try {
  const parsed = JSON.parse(raw);
  toolInput = parsed.tool_input ?? parsed.input ?? {};
} catch {
  process.exit(0);
}

const filePath = (toolInput.file_path ?? toolInput.path ?? '').replace(/\\/g, '/');

// Only care about .rs files in a worktree
if (!filePath.endsWith('.rs') || !filePath.includes('/.claude/worktrees/')) {
  process.exit(0);
}

// Walk up from the edited file to find the directory containing Cargo.toml
function findCargoDir(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'Cargo.toml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const cargoDir = findCargoDir(dirname(filePath));
if (!cargoDir) {
  process.stdout.write('[HW RUST CHECK] Could not find Cargo.toml — skipping check\n');
  process.exit(0);
}

const shortDir = cargoDir.replace(/\\/g, '/').split('/').slice(-3).join('/');
process.stdout.write(`[HW RUST CHECK] Running cargo check in ${shortDir}...\n`);

const result = spawnSync('cargo', ['check'], {
  cwd: cargoDir,
  timeout: 110_000,
  encoding: 'utf8',
});

// cargo check writes diagnostics to stderr
const output = (result.stderr ?? '') + (result.stdout ?? '');

if (result.status === 0) {
  process.stdout.write('[HW RUST CHECK] OK — no compile errors\n');
} else {
  const lines = output.split('\n');
  const trimmed = lines.length > 80 ? ['...truncated...', ...lines.slice(-80)] : lines;
  process.stdout.write('[HW RUST CHECK] COMPILE ERRORS — fix before declaring done:\n\n');
  process.stdout.write(trimmed.join('\n') + '\n');
}
