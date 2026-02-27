#!/usr/bin/env node
/**
 * PostToolUse hook: verify deliberation MCP tools still exist in server.ts
 *
 * Fires after Edit/Write on server.ts. If any deliberation tool registration
 * is missing, BLOCKS the edit and tells Claude to restore them.
 *
 * This exists because Session 48 accidentally deleted all deliberation tools
 * during a large refactor. Never again.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Only check when server.ts was edited
const input = JSON.parse(await new Promise(resolve => {
  let data = '';
  process.stdin.on('data', chunk => { data += chunk; });
  process.stdin.on('end', () => resolve(data));
}));

const toolName = input.tool_name;
const toolInput = input.tool_input ?? {};
const filePath = toolInput.file_path ?? toolInput.path ?? '';

// Only trigger on Edit/Write to server.ts
if (!['Edit', 'Write'].includes(toolName)) process.exit(0);
if (!filePath.includes('server.ts') || !filePath.includes('mcp')) process.exit(0);

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const serverPath = join(PROJECT, 'packages/core/src/mcp/server.ts');

try {
  const content = readFileSync(serverPath, 'utf8');

  const REQUIRED_TOOLS = [
    'hw_plan_deliberation',
    'hw_start_deliberation',
    'hw_conclude_deliberation',
    'hw_check_deliberation_coverage',
    'hw_quick_insights',
    'hw_post_to_chatroom',
    'hw_post_agent_message',
    'hw_list_agents',
    'hw_pause_deliberation',
    'hw_resume_deliberation',
    'hw_set_deliberation_phase',
    'hw_react',
    'hw_extract_deliberation_recommendations',
  ];

  const missing = REQUIRED_TOOLS.filter(tool => !content.includes(`'${tool}'`));

  if (missing.length > 0) {
    // Output to stderr so Claude sees it as a warning
    process.stderr.write(`\n\nBLOCKED: Deliberation tools were removed from server.ts!\n`);
    process.stderr.write(`Missing: ${missing.join(', ')}\n`);
    process.stderr.write(`This happened before in Session 48 and broke Pat's deliberation system.\n`);
    process.stderr.write(`RESTORE THEM IMMEDIATELY. Do not proceed without these tools.\n\n`);
    process.exit(1);
  }
} catch (err) {
  // If we can't read the file, don't block
  process.exit(0);
}
