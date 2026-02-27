import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';

// Map commands to the JSON files they read
const COMMAND_FILE_MAP: Record<string, string[]> = {
  get_config: ['config.json'],
  save_config: ['config.json'],
  get_state: ['tasks.json', 'decisions.json', 'questions.json'],
  get_memories: ['memories.json'],
  get_sessions: ['sessions.json'],
  get_brain_state: ['brain-state.json'],
  get_activity: ['activity.json'],
  get_approvals: ['approvals.json'],
  get_workflow: ['workflow.json'],
  get_direction: ['direction.json'],
  get_timeline: ['timeline.md'],
  get_watchers: ['watchers.json'],
  get_chatroom: ['chatroom.json'],
  get_mode: ['mode.json'],
  get_deliberations: [],
  get_extracted_research: ['extracted-research.json'],
};

// ── Shared polling heartbeat ──────────────────────────────────────
// One single 30s interval for ALL hooks, instead of per-hook 10s intervals.
// Subscribers register their refetch callback; the heartbeat calls all of them.

type RefetchFn = () => void;
const pollSubscribers = new Set<RefetchFn>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function subscribePoll(fn: RefetchFn) {
  pollSubscribers.add(fn);
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      pollSubscribers.forEach((f) => f());
    }, 30_000);
  }
  return () => {
    pollSubscribers.delete(fn);
    if (pollSubscribers.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

// ── Debounce file watcher events ──────────────────────────────────
// When MCP writes 3 files rapidly, batch the events so components
// re-render once instead of 3 times within a short window.

const pendingRefetches = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 150;

function debouncedRefetch(command: string, fn: () => void) {
  const existing = pendingRefetches.get(command);
  if (existing) clearTimeout(existing);
  pendingRefetches.set(
    command,
    setTimeout(() => {
      pendingRefetches.delete(command);
      fn();
    }, DEBOUNCE_MS),
  );
}

// ──────────────────────────────────────────────────────────────────

interface TauriDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useTauriData<T>(command: string, projectPath: string): TauriDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    invoke<T>(command, { projectPath })
      .then(setData)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [command, projectPath]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for file changes and refetch when our files change (debounced)
  useEffect(() => {
    if (!projectPath) return;
    const relevantFiles = COMMAND_FILE_MAP[command] ?? [];
    if (relevantFiles.length === 0) return;

    const unlisten = listen<string[]>('hw-files-changed', (event) => {
      const changed = event.payload;
      const shouldRefetch = relevantFiles.some((f) => changed.includes(f));
      if (shouldRefetch) {
        debouncedRefetch(command, () => {
          invoke<T>(command, { projectPath })
            .then(setData)
            .catch((err) => setError(String(err)));
        });
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [command, projectPath]);

  // Shared 30s polling fallback — one global timer for all hooks
  const refetchRef = useRef<RefetchFn>(() => {});
  refetchRef.current = () => {
    if (!projectPath) return;
    invoke<T>(command, { projectPath })
      .then(setData)
      .catch(() => {});
  };

  useEffect(() => {
    const fn: RefetchFn = () => refetchRef.current();
    return subscribePoll(fn);
  }, []);

  return { data, loading, error, refetch: fetchData };
}
