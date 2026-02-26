export { listDirectoryTool, readFileTool, writeFileTool } from './filesystem.js';
export { gitCommitTool, gitDiffTool, gitLogTool, gitStatusTool } from './git.js';
export { runCommandTool } from './terminal.js';
export type { Tool, ToolDefinition, ToolExecutor, ToolResult } from './types.js';

import { listDirectoryTool, readFileTool, writeFileTool } from './filesystem.js';
import { gitCommitTool, gitDiffTool, gitLogTool, gitStatusTool } from './git.js';
import { runCommandTool } from './terminal.js';
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
export const toolMap = new Map(BUILT_IN_TOOLS.map((t) => [t.definition.name, t]));
