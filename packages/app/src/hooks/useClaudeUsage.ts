import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';

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
}

/**
 * Hook to read Claude usage data from .hello-world/claude-usage.json.
 * Tries the Rust command first. Refreshes when the file changes.
 * Falls back gracefully if the command doesn't exist yet.
 */
export function useClaudeUsage(projectPath: string) {
  const [data, setData] = useState<ClaudeUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    if (!projectPath) return;
    setLoading(true);
    // Try the Rust command (will work after app restart when get_claude_usage is added)
    invoke<ClaudeUsageData>('get_claude_usage', { projectPath })
      .then(setData)
      .catch(() => {
        // Fallback: try reading via get_config-style generic read
        // For now, try reading the raw JSON through a fetch to the loopback
        readViaLoopback(projectPath)
          .then(setData)
          .catch((err) => setError(String(err)));
      })
      .finally(() => setLoading(false));
  }, [projectPath]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for file changes
  useEffect(() => {
    if (!projectPath) return;
    const unlisten = listen<string[]>('hw-files-changed', (event) => {
      if (event.payload.includes('claude-usage.json')) {
        fetchData();
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [projectPath, fetchData]);

  // Poll every 60s as fallback
  const refetchRef = useRef<() => void>(() => {});
  refetchRef.current = fetchData;
  useEffect(() => {
    const timer = setInterval(() => refetchRef.current(), 60_000);
    return () => clearInterval(timer);
  }, []);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Read claude-usage.json via the loopback HTTP port (sync.json).
 * POSTs a request to the Rust notify listener asking it to read a file.
 * If the listener doesn't support this, falls back to null.
 */
async function readViaLoopback(projectPath: string): Promise<ClaudeUsageData | null> {
  // Read sync.json to get the loopback port
  try {
    const syncData = await invoke<{ port: number; pid: number }>('get_sync_info', { projectPath });
    if (!syncData?.port) return null;

    // POST to loopback requesting claude-usage.json content
    const res = await fetch(`http://127.0.0.1:${syncData.port}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readFile: 'claude-usage.json' }),
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 2) return JSON.parse(text);
    }
  } catch {
    // Loopback not available or doesn't support read
  }
  return null;
}
