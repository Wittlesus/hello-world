import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Pricing per 1M tokens (USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenRouter -- Qwen 3.5
  'qwen/qwen3.5-plus-02-15': { input: 0.40, output: 2.40 },
  // Chutes.ai (legacy, kept for historical entries)
  'Qwen/Qwen3.5-397B-A17B-TEE': { input: 0.30, output: 1.20 },
  'Qwen/Qwen3-235B-A22B-Instruct-2507-TEE': { input: 0.08, output: 0.55 },
  'Qwen/Qwen3-235B-A22B-Instruct-2507': { input: 0.08, output: 0.55 },
  'Qwen/Qwen3-Coder-Next-TEE': { input: 0.12, output: 0.75 },
  'Qwen/Qwen3-235B-A22B-Thinking-2507': { input: 0.11, output: 0.60 },
  'Qwen/Qwen3-32B': { input: 0.08, output: 0.24 },
  'Qwen/Qwen3-30B-A3B': { input: 0.06, output: 0.22 },
  // Claude pricing (for unified tracking)
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-opus-4-6': { input: 15.00, output: 75.00 },
};

export interface UsageEntry {
  timestamp: string;
  model: string;
  provider: 'claude' | 'qwen';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  context?: string; // e.g., "boardroom", "deliberation", "signal-detector"
}

export interface UsageSummary {
  totalCostUsd: number;
  totalTokens: number;
  claudeCostUsd: number;
  claudeTokens: number;
  qwenCostUsd: number;
  qwenTokens: number;
  sessionCostUsd: number;
  sessionTokens: number;
  entries: number;
  lastUpdated: string;
  byContext: Record<string, { costUsd: number; tokens: number }>;
}

interface UsageFile {
  entries: UsageEntry[];
  sessionStart?: string;
}

function usagePath(projectPath: string): string {
  return join(projectPath, '.hello-world', 'qwen-usage.json');
}

function readUsageFile(projectPath: string): UsageFile {
  const path = usagePath(projectPath);
  if (!existsSync(path)) return { entries: [], sessionStart: new Date().toISOString() };
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as UsageFile;
  } catch {
    return { entries: [], sessionStart: new Date().toISOString() };
  }
}

function writeUsageFile(projectPath: string, data: UsageFile): void {
  writeFileSync(usagePath(projectPath), JSON.stringify(data, null, 2));
}

export function computeCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;
}

export function recordUsage(
  projectPath: string,
  model: string,
  provider: 'claude' | 'qwen',
  promptTokens: number,
  completionTokens: number,
  context?: string,
): UsageEntry {
  const costUsd = computeCost(model, promptTokens, completionTokens);
  const entry: UsageEntry = {
    timestamp: new Date().toISOString(),
    model,
    provider,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd,
    context,
  };

  const file = readUsageFile(projectPath);
  file.entries.push(entry);

  // Keep last 1000 entries to prevent unbounded growth
  if (file.entries.length > 1000) {
    file.entries = file.entries.slice(-1000);
  }

  writeUsageFile(projectPath, file);
  return entry;
}

export function getUsageSummary(projectPath: string): UsageSummary {
  const file = readUsageFile(projectPath);
  const sessionStart = file.sessionStart ?? '2000-01-01';

  let totalCostUsd = 0;
  let totalTokens = 0;
  let claudeCostUsd = 0;
  let claudeTokens = 0;
  let qwenCostUsd = 0;
  let qwenTokens = 0;
  let sessionCostUsd = 0;
  let sessionTokens = 0;
  const byContext: Record<string, { costUsd: number; tokens: number }> = {};

  for (const e of file.entries) {
    totalCostUsd += e.costUsd;
    totalTokens += e.totalTokens;

    if (e.provider === 'claude') {
      claudeCostUsd += e.costUsd;
      claudeTokens += e.totalTokens;
    } else {
      qwenCostUsd += e.costUsd;
      qwenTokens += e.totalTokens;
    }

    if (e.timestamp >= sessionStart) {
      sessionCostUsd += e.costUsd;
      sessionTokens += e.totalTokens;
    }

    if (e.context) {
      if (!byContext[e.context]) byContext[e.context] = { costUsd: 0, tokens: 0 };
      byContext[e.context].costUsd += e.costUsd;
      byContext[e.context].tokens += e.totalTokens;
    }
  }

  return {
    totalCostUsd,
    totalTokens,
    claudeCostUsd,
    claudeTokens,
    qwenCostUsd,
    qwenTokens,
    sessionCostUsd,
    sessionTokens,
    entries: file.entries.length,
    lastUpdated: file.entries[file.entries.length - 1]?.timestamp ?? '',
    byContext,
  };
}

export function resetSessionUsage(projectPath: string): void {
  const file = readUsageFile(projectPath);
  file.sessionStart = new Date().toISOString();
  writeUsageFile(projectPath, file);
}
