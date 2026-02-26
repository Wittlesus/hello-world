import { execFileSync } from 'node:child_process';
import type { Tool, ToolResult } from './types.js';

export const runCommandTool: Tool = {
  definition: {
    name: 'run_command',
    description:
      'Execute a shell command and return its output. Use for builds, tests, git operations, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['command'],
    },
  },
  execute: async (input): Promise<ToolResult> => {
    const command = input.command as string;
    const cwd = (input.cwd as string | undefined) ?? process.cwd();
    const timeout = (input.timeout_ms as number | undefined) ?? 30000;

    // Split command into executable and args for execFileSync (prevents shell injection)
    const shell = process.platform === 'win32' ? 'cmd' : 'bash';
    const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

    try {
      const output = execFileSync(shell, shellArgs, {
        cwd,
        timeout,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: output.trim() };
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
      const stderr = e.stderr ?? '';
      const stdout = e.stdout ?? '';
      return {
        success: false,
        output: stdout,
        error: `Exit code ${e.status ?? 'unknown'}: ${stderr || e.message}`,
      };
    }
  },
};
