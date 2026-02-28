import { invoke } from '@tauri-apps/api/core';
import { useCallback, useState } from 'react';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { EmptyState } from './LoadingState.js';
import { ViewShell } from './ViewShell.js';

interface CopySpec {
  from: string;
  to: string;
}

interface WatcherConfig {
  copies: CopySpec[];
  label: string;
  timeoutMinutes: number;
}

interface WatcherEntry {
  id: string;
  type: string;
  label: string;
  pid: number;
  spawnedAt: string;
  status: 'active' | 'completed' | 'failed' | 'killed' | 'timed_out';
  config: WatcherConfig;
  completedAt?: string;
  resultSummary?: string;
}

interface WatchersData {
  active: WatcherEntry[];
  completed: WatcherEntry[];
}

function elapsed(from: string, to?: string): string {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  const secs = Math.round((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function shortPath(p: string): string {
  return p.replace(/\\/g, '/').split('/').slice(-3).join('/');
}

const STATUS_STYLE: Record<string, string> = {
  active: 'text-cyan-300 bg-cyan-500/15',
  completed: 'text-green-300 bg-green-500/15',
  failed: 'text-red-300 bg-red-500/15',
  killed: 'text-gray-400 bg-gray-500/15',
  timed_out: 'text-orange-300 bg-orange-500/15',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'active',
  completed: 'done',
  failed: 'failed',
  killed: 'killed',
  timed_out: 'timed out',
};

function WatcherCard({
  watcher,
  onKill,
  killing,
}: {
  watcher: WatcherEntry;
  onKill?: (id: string) => void;
  killing?: boolean;
}) {
  const isActive = watcher.status === 'active';
  const statusStyle = STATUS_STYLE[watcher.status] ?? 'text-gray-400 bg-gray-500/15';
  const statusLabel = STATUS_LABEL[watcher.status] ?? watcher.status;

  return (
    <div
      className={`bg-[#1a1a24] border rounded-lg overflow-hidden ${isActive ? 'border-cyan-800/50' : 'border-gray-800'}`}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <span className="font-mono text-sm text-white font-medium truncate">{watcher.id}</span>
        <div className="flex items-center gap-2 shrink-0">
          {isActive && onKill && (
            <button
              onClick={() => onKill(watcher.id)}
              disabled={killing}
              className="text-[10px] text-red-700 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              {killing ? '...' : 'Kill'}
            </button>
          )}
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusStyle}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Active progress bar */}
      {isActive && (
        <div className="h-1 bg-gray-800 mx-4 mb-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-500/70 rounded-full"
            style={{ animation: 'progress-slide 2s ease-in-out infinite' }}
          />
        </div>
      )}

      {/* Body */}
      <div className="px-4 pb-3 space-y-2">
        <p className="text-xs text-gray-300 leading-relaxed">{watcher.label}</p>

        {/* File copies */}
        {watcher.config.copies?.length > 0 && (
          <div className="space-y-1">
            {watcher.config.copies.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] font-mono text-gray-600">
                <span className="text-cyan-900 shrink-0">copy</span>
                <span className="truncate text-gray-500" title={c.from}>
                  {shortPath(c.from)}
                </span>
                <span className="text-gray-700 shrink-0">→</span>
                <span className="truncate text-gray-500" title={c.to}>
                  {shortPath(c.to)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-3 text-[10px] text-gray-700 pt-1">
          <span>spawned {elapsed(watcher.spawnedAt)} ago</span>
          {watcher.completedAt && (
            <span>ran {elapsed(watcher.spawnedAt, watcher.completedAt)}</span>
          )}
          {watcher.resultSummary && <span className="text-gray-500">{watcher.resultSummary}</span>}
          <span className="ml-auto">pid {watcher.pid}</span>
        </div>
      </div>
    </div>
  );
}

export function WatchersView() {
  const projectPath = useProjectPath();
  const { data, refetch } = useTauriData<WatchersData>('get_watchers', projectPath);
  const [killing, setKilling] = useState<Set<string>>(new Set());

  const handleKill = useCallback(
    async (watcherId: string) => {
      setKilling((prev) => new Set(prev).add(watcherId));
      try {
        await invoke('kill_watcher', { projectPath, watcherId });
        refetch();
      } catch (err) {
        console.error('kill_watcher failed:', err);
      } finally {
        setKilling((prev) => {
          const s = new Set(prev);
          s.delete(watcherId);
          return s;
        });
      }
    },
    [projectPath, refetch],
  );

  const active = data?.active ?? [];
  const completed = [...(data?.completed ?? [])].reverse().slice(0, 10);
  const totalDesc = `${active.length} active · ${data?.completed?.length ?? 0} completed`;

  return (
    <ViewShell title="Agents & Watchers" description={totalDesc}>
      <style>{`
        @keyframes progress-slide {
          0%   { width: 0%;   margin-left: 0; }
          50%  { width: 60%;  margin-left: 20%; }
          100% { width: 0%;   margin-left: 100%; }
        }
      `}</style>

      {active.length > 0 && (
        <section className="mb-6">
          <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">Active</p>
          <div className="space-y-3">
            {active.map((w) => (
              <WatcherCard key={w.id} watcher={w} onKill={handleKill} killing={killing.has(w.id)} />
            ))}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section>
          <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">Recent</p>
          <div className="space-y-3">
            {completed.map((w) => (
              <WatcherCard key={w.id} watcher={w} />
            ))}
          </div>
        </section>
      )}

      {active.length === 0 && completed.length === 0 && (
        <EmptyState message="No watchers running. Use hw_spawn_watcher to start a background process that fires on app shutdown." />
      )}
    </ViewShell>
  );
}
WatchersView.displayName = 'WatchersView';
