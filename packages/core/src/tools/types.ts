/**
 * Tool definition compatible with Anthropic's tool_use API.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export type ToolExecutor = (input: Record<string, unknown>) => Promise<ToolResult>;

export interface Tool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}
