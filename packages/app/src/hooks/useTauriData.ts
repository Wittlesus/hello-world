import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Map commands to the JSON files they read
const COMMAND_FILE_MAP: Record<string, string[]> = {
  get_config: ['config.json'],
  save_config: ['config.json'],
  get_state: ['state.json'],
  get_memories: ['memories.json'],
  get_sessions: ['sessions.json'],
  get_brain_state: ['brain-state.json'],
  get_activity: ['activity.json'],
  get_approvals: ['approvals.json'],
  get_workflow: ['workflow.json'],
  get_direction: ['direction.json'],
  get_timeline: ['timeline.md'],
  get_watchers: ['watchers.json'],
};

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

  useEffect(() => { fetchData(); }, [fetchData]);

  // Listen for file changes and refetch when our files change
  useEffect(() => {
    if (!projectPath) return;
    const relevantFiles = COMMAND_FILE_MAP[command] ?? [];
    if (relevantFiles.length === 0) return;

    const unlisten = listen<string[]>('hw-files-changed', (event) => {
      const changed = event.payload;
      const shouldRefetch = relevantFiles.some((f) => changed.includes(f));
      if (shouldRefetch) {
        invoke<T>(command, { projectPath })
          .then(setData)
          .catch((err) => setError(String(err)));
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [command, projectPath]);

  // 10-second polling fallback — catches anything the event listener misses
  useEffect(() => {
    if (!projectPath) return;
    const id = setInterval(() => {
      invoke<T>(command, { projectPath }).then(setData).catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  }, [command, projectPath]);

  return { data, loading, error, refetch: fetchData };
}
