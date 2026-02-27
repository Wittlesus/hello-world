import { useTauriData } from './useTauriData.js';

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
}

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface DailyTokens {
  date: string;
  totalTokens: number;
  byModel: Record<string, number>;
}

export interface WebUsageBucket {
  utilization: number;
  resetsAt: string;
}

export interface WebExtraUsage {
  isEnabled: boolean;
  monthlyLimit: number;
  usedCredits: number;
  utilization: number;
}

export interface WebUsage {
  fetchedAt: string;
  fiveHour: WebUsageBucket;
  sevenDay: WebUsageBucket;
  sevenDaySonnet: WebUsageBucket | null;
  extraUsage: WebExtraUsage | null;
}

export interface ClaudeUsageData {
  generatedAt: string;
  lastComputedDate: string;
  totalSessions: number;
  totalMessages: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  modelBreakdown: Record<string, ModelUsage>;
  dailyActivity: DailyActivity[];
  dailyTokens: DailyTokens[];
  firstSessionDate?: string;
  hourCounts: Record<string, number>;
  webUsage?: WebUsage;
}

/**
 * Hook to read Claude usage data from .hello-world/claude-usage.json.
 * Uses the standard useTauriData pattern with get_claude_usage Rust command.
 */
export function useClaudeUsage(projectPath: string) {
  return useTauriData<ClaudeUsageData>('get_claude_usage', projectPath);
}
