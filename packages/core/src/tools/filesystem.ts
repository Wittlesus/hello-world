import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Tool, ToolResult } from './types.js';

export const readFileTool: Tool = {
  definition: {
    name: 'read_file',
    description: 'Read the contents of a file at the given path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path' },
      },
      required: ['path'],
    },
  },
  execute: async (input): Promise<ToolResult> => {
    const path = input.path as string;
    if (!existsSync(path)) return { success: false, output: '', error: `File not found: ${path}` };
    const content = readFileSync(path, 'utf-8');
    return { success: true, output: content };
  },
};

export const writeFileTool: Tool = {
  definition: {
    name: 'write_file',
    description: 'Write content to a file, creating directories if needed. Overwrites existing files.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  execute: async (input): Promise<ToolResult> => {
    const path = input.path as string;
    const content = input.content as string;
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, content, 'utf-8');
    return { success: true, output: `Written ${content.length} bytes to ${path}` };
  },
};

export const listDirectoryTool: Tool = {
  definition: {
    name: 'list_directory',
    description: 'List files and directories at the given path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
      },
      required: ['path'],
    },
  },
  execute: async (input): Promise<ToolResult> => {
    const path = input.path as string;
    if (!existsSync(path)) return { success: false, output: '', error: `Directory not found: ${path}` };
    const entries = readdirSync(path).map(name => {
      const full = join(path, name);
      const isDir = statSync(full).isDirectory();
      return `${isDir ? 'd' : 'f'} ${name}`;
    });
    return { success: true, output: entries.join('\n') };
  },
};
