export type { Tool, ToolDefinition, ToolResult, ToolExecutor } from './types.js';
export { readFileTool, writeFileTool, listDirectoryTool } from './filesystem.js';
export { runCommandTool } from './terminal.js';
export { gitStatusTool, gitDiffTool, gitLogTool, gitCommitTool } from './git.js';

import { readFileTool, writeFileTool, listDirectoryTool } from './filesystem.js';
import { runCommandTool } from './terminal.js';
import { gitStatusTool, gitDiffTool, gitLogTool, gitCommitTool } from './git.js';
import type { Tool } from './types.js';

/** All built-in tools */
export const BUILT_IN_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  runCommandTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
];

/** Tool lookup by name */
export const toolMap = new Map(BUILT_IN_TOOLS.map(t => [t.definition.name, t]));
