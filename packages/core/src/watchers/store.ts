import { JsonStore } from '../storage.js';
import { generateWatcherName, now } from '../utils.js';

export type WatcherType = 'app_shutdown_copy';

const TYPE_TAGS: Record<WatcherType, string> = {
  app_shutdown_copy: 'copy',
};
export type WatcherStatus = 'active' | 'completed' | 'failed' | 'killed' | 'timed_out';

export interface CopySpec {
  from: string;
  to: string;
}

export interface AppShutdownConfig {
  copies: CopySpec[];
  label: string;
  timeoutMinutes: number;
}

export interface WatcherEntry {
  id: string;
  type: WatcherType;
  label: string;
  pid: number;
  spawnedAt: string;
  status: WatcherStatus;
  config: AppShutdownConfig;
  completedAt?: string;
  resultSummary?: string;
}

interface WatchersData {
  active: WatcherEntry[];
  completed: WatcherEntry[];
}

export class WatcherStore {
  private store: JsonStore<WatchersData>;

  constructor(projectRoot: string) {
    this.store = new JsonStore<WatchersData>(projectRoot, 'watchers.json', {
      active: [],
      completed: [],
    });
  }

  add(entry: Omit<WatcherEntry, 'spawnedAt' | 'status'> & { id?: string }): WatcherEntry {
    const existing = this.listAllIds();
    const tag = TYPE_TAGS[entry.type] ?? 'watch';
    const watcher: WatcherEntry = {
      ...entry,
      id: entry.id ?? generateWatcherName(tag, existing),
      spawnedAt: now(),
      status: 'active',
    };
    this.store.update((d) => ({ ...d, active: [...d.active, watcher] }));
    return watcher;
  }

  private listAllIds(): string[] {
    const d = this.store.read();
    return [...d.active, ...d.completed].map((w) => w.id);
  }

  generateName(type: WatcherType): string {
    const tag = TYPE_TAGS[type] ?? 'watch';
    return generateWatcherName(tag, this.listAllIds());
  }

  kill(watcherId: string): 'killed' | 'not_found' | 'already_terminated' {
    const data = this.store.read();
    const watcher = data.active.find((w) => w.id === watcherId);
    if (!watcher) {
      return data.completed.find((w) => w.id === watcherId) ? 'already_terminated' : 'not_found';
    }
    try {
      process.kill(watcher.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    this.store.update((d) => ({
      active: d.active.filter((w) => w.id !== watcherId),
      completed: [...d.completed, { ...watcher, status: 'killed', completedAt: now() }],
    }));
    return 'killed';
  }

  listActive(): WatcherEntry[] {
    // Reconcile: if a watcher's PID is gone but status is still active, mark failed
    const data = this.store.read();
    const stale: string[] = [];
    for (const w of data.active) {
      try {
        process.kill(w.pid, 0);
      } catch {
        stale.push(w.id);
      }
    }
    if (stale.length > 0) {
      this.store.update((d) => ({
        active: d.active.filter((w) => !stale.includes(w.id)),
        completed: [
          ...d.completed,
          ...d.active
            .filter((w) => stale.includes(w.id))
            .map((w) => ({
              ...w,
              status: 'failed' as WatcherStatus,
              completedAt: now(),
              resultSummary: 'Process died unexpectedly',
            })),
        ],
      }));
    }
    return this.store.read().active;
  }

  listRecent(limit = 20): WatcherEntry[] {
    const d = this.store.read();
    return [...d.active, ...d.completed.slice(-limit)];
  }
}
