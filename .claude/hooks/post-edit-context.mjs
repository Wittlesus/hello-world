#!/usr/bin/env node
/**
 * PostToolUse hook — captures last-edited file + active task after Write/Edit.
 * Written to .hello-world/last-context.json so SessionStart can surface it.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');

// Read tool input from stdin
let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

let toolName, toolInput;
try {
  const parsed = JSON.parse(raw);
  toolName = parsed.tool_name ?? parsed.tool ?? '';
  toolInput = parsed.tool_input ?? parsed.input ?? {};
} catch {
  process.exit(0);
}

// Only care about Write and Edit
if (!['Write', 'Edit'].includes(toolName)) process.exit(0);

const filePath = toolInput.file_path ?? toolInput.path ?? '';
if (!filePath) process.exit(0);

// Get current in-progress task from state.json
let task = null;
try {
  const state = JSON.parse(readFileSync(join(HW, 'state.json'), 'utf8'));
  const inProgress = (state.tasks ?? []).find(t => t.status === 'in_progress');
  if (inProgress) task = inProgress.title;
} catch { /* no state yet */ }

// Write context snapshot
const ctx = {
  file: filePath,
  task,
  ts: new Date().toISOString(),
};

try {
  writeFileSync(join(HW, 'last-context.json'), JSON.stringify(ctx, null, 2));
} catch { /* ignore write errors */ }
