import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { PROJECT_PATH } from '../config.js';

// Map commands to the JSON files they read
const COMMAND_FILE_MAP: Record<string, string[]> = {
  get_config: ['config.json'],
  get_state: ['state.json'],
  get_memories: ['memories.json'],
  get_sessions: ['sessions.json'],
  get_brain_state: ['brain-state.json'],
  get_activity: ['activity.json'],
};

interface TauriDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useTauriData<T>(command: string): TauriDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    invoke<T>(command, { projectPath: PROJECT_PATH })
      .then(setData)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [command]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Listen for file changes and refetch when our files change
  useEffect(() => {
    const relevantFiles = COMMAND_FILE_MAP[command] ?? [];
    if (relevantFiles.length === 0) return;

    const unlisten = listen<string[]>('hw-files-changed', (event) => {
      const changed = event.payload;
      const shouldRefetch = relevantFiles.some((f) => changed.includes(f));
      if (shouldRefetch) {
        invoke<T>(command, { projectPath: PROJECT_PATH })
          .then(setData)
          .catch((err) => setError(String(err)));
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [command]);

  return { data, loading, error, refetch: fetchData };
}
