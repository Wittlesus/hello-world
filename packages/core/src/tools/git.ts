import { execFileSync } from 'node:child_process';
import type { Tool, ToolResult } from './types.js';
import type { GitStatus, GitCommit } from '../types.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
}

export const gitStatusTool: Tool = {
  definition: {
    name: 'git_status',
    description: 'Get the current git status including staged, modified, and untracked files.',
    input_schema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repository directory' },
      },
      required: ['cwd'],
    },
  },
  execute: async (input): Promise<ToolResult> => {
    const cwd = input.cwd as string;
    try {
      const raw = git(['status', '--porcelain'], cwd);
      const branch = git(['branch', '--show-current'], cwd);

      const staged: string[] = [];
      const modified: string[] = [];
      const untracked: string[] = [];

      for (const line of raw.split('\n').filter(Boolean)) {
        const index = line[0];
        const work = line[1];
        const file = line.slice(3);
        if (index === '?' && work === '?') untracked.push(file);
        else if (index !== ' ' && index !== '?') staged.push(file);
        if (work === 'M') modified.push(file);
      }

      const status: GitStatus = { staged, modified, untracked, branch, ahead: 0, behind: 0 };
      return { success: true, output: JSON.stringify(status, null, 2) };
    } catch (err: unknown) {
      return { success: false, output: '', error: (err as Error).message };
    }
  },
};

export const gitDiffTool: Tool = {
  definition: {
    name: 'git_diff',
    description: 'Show the diff of changes in the repository.',
    input_schema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repository directory' },
        staged: { type: 'boolean', description: 'Show staged changes (default: false)' },
      },
      required: ['cwd'],
    },
  },
  execute: async (input): Promise<ToolResult> => {
    const cwd = input.cwd as string;
    const staged = input.staged as boolean | undefined;
    try {
      const args = staged ? ['diff', '--staged'] : ['diff'];
      const output = git(args, cwd);
      return { success: true, output: output || '(no changes)' };
    } catch (err: unknown) {
      return { success: false, output: '', error: (err as Error).message };
    }
  },
};

export const gitLogTool: Tool = {
  definition: {
    name: 'git_log',
    description: 'Show recent git commits.',
    input_schema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repository directory' },
        count: { type: 'number', description: 'Number of commits to show (default: 10)' },
      },
      required: ['cwd'],
    },
  },
  execute: async (input): Promise<ToolResult> => {
    const cwd = input.cwd as string;
    const count = (input.count as number | undefined) ?? 10;
    try {
      const raw = git(['log', `--max-count=${count}`, '--format=%H|%s|%an|%ai'], cwd);
      const commits: GitCommit[] = raw.split('\n').filter(Boolean).map(line => {
        const [hash, message, author, date] = line.split('|');
        return { hash, message, author, date };
      });
      return { success: true, output: JSON.stringify(commits, null, 2) };
    } catch (err: unknown) {
      return { success: false, output: '', error: (err as Error).message };
    }
  },
};

export const gitCommitTool: Tool = {
  definition: {
    name: 'git_commit',
    description: 'Stage specific files and create a git commit.',
    input_schema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repository directory' },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to stage (relative to cwd)',
        },
        message: { type: 'string', description: 'Commit message' },
      },
      required: ['cwd', 'files', 'message'],
    },
  },
  execute: async (input): Promise<ToolResult> => {
    const cwd = input.cwd as string;
    const files = input.files as string[];
    const message = input.message as string;
    try {
      git(['add', ...files], cwd);
      const output = git(['commit', '-m', message], cwd);
      return { success: true, output };
    } catch (err: unknown) {
      return { success: false, output: '', error: (err as Error).message };
    }
  },
};
