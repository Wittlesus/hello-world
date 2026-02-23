import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';

interface Task { id: string; title: string; description?: string; status: string }
interface StateData { tasks: Task[] }
interface ActivityEvent { id: string; type: string; description: string; timestamp: string }
interface ActivityData { activities: ActivityEvent[] }
interface WorkflowData { phase: string }
interface Session { id: string; startedAt: string; endedAt?: string; tasksCompleted: string[] }
interface SessionsData { sessions: Session[] }

const PHASE_DOT: Record<string, string> = {
  idle: 'bg-gray-500', scope: 'bg-yellow-400', plan: 'bg-blue-400',
  build: 'bg-indigo-400', verify: 'bg-orange-400', ship: 'bg-green-400',
};

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatDuration(start: string, end?: string): string {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  if (isNaN(s.getTime())) return '';
  const mins = Math.floor((e.getTime() - s.getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h${mins % 60 ? `${mins % 60}m` : ''}`;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function SidePanel() {
  const projectPath = useProjectPath();
  const { data: stateData }    = useTauriData<StateData>('get_state', projectPath);
  const { data: activityData } = useTauriData<ActivityData>('get_activity', projectPath);
  const { data: workflowData } = useTauriData<WorkflowData>('get_workflow', projectPath);
  const { data: sessionsData } = useTauriData<SessionsData>('get_sessions', projectPath);

  const tasks      = stateData?.tasks ?? [];
  const activeTask = tasks.find((t) => t.status === 'in_progress');
  const todoTasks  = tasks.filter((t) => t.status === 'todo');
  const phase      = workflowData?.phase ?? 'idle';
  const phaseDot   = PHASE_DOT[phase] ?? 'bg-gray-500';

  const activities = activityData?.activities
    ? [...activityData.activities].reverse().slice(0, 8)
    : [];

  const allSessions    = sessionsData?.sessions ?? [];
  const recentSessions = [...allSessions].reverse().slice(0, 5);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const toggleSession = useCallback((id: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="w-64 flex flex-col border-l border-gray-800 bg-[#0d0d14] shrink-0 overflow-hidden">
      {/* Phase */}
      <div className="px-3 py-2 border-b border-gray-800/60 flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${phaseDot}`} />
        <span className="text-[10px] font-mono uppercase text-gray-500">{phase}</span>
      </div>

      {/* Active task */}
      <div className="px-3 py-3 border-b border-gray-800/60">
        <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1.5">Active</p>
        {activeTask ? (
          <>
            <p className="text-xs text-white leading-snug font-medium">{activeTask.title}</p>
            {activeTask.description && (
              <p className="text-[10px] text-gray-500 mt-1 leading-relaxed line-clamp-2">{activeTask.description}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-600 italic">No active task</p>
        )}
      </div>

      {/* Up next */}
      {todoTasks.length > 0 && (
        <div className="px-3 py-3 border-b border-gray-800/60">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1.5">Up Next</p>
          <div className="flex flex-col gap-1.5">
            {todoTasks.slice(0, 3).map((t) => (
              <p key={t.id} className="text-[10px] text-gray-400 leading-snug">
                <span className="text-gray-700 mr-1">·</span>{t.title}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Recent sessions */}
      {recentSessions.length > 0 && (
        <div className="px-3 py-3 border-b border-gray-800/60">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1.5">Sessions</p>
          <div className="flex flex-col gap-0.5">
            {recentSessions.map((s, i) => {
              const sessionNum = allSessions.length - i;
              const isActive   = !s.endedAt;
              const isExpanded = expandedSessions.has(s.id);
              const hasTasks   = s.tasksCompleted.length > 0;
              const duration   = formatDuration(s.startedAt, s.endedAt);
              return (
                <div key={s.id}>
                  <button
                    onClick={() => hasTasks && toggleSession(s.id)}
                    className={`w-full flex items-center gap-1 text-left py-0.5 ${hasTasks ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className="text-[9px] text-gray-700 shrink-0 w-2">
                      {hasTasks ? (isExpanded ? '▼' : '▶') : '\u00a0'}
                    </span>
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 animate-pulse" />}
                    <span className="text-[10px] text-gray-500 font-mono shrink-0">#{sessionNum}</span>
                    <span className="text-[10px] text-gray-600 font-mono shrink-0 ml-1">{formatSessionDate(s.startedAt)}</span>
                    <span className="text-[10px] text-gray-700 ml-auto shrink-0 font-mono">
                      {hasTasks ? `${s.tasksCompleted.length}t` : '\u2014'} · {duration}
                    </span>
                  </button>
                  {isExpanded && hasTasks && (
                    <div className="ml-3.5 mb-1 flex flex-col gap-0.5 border-l border-gray-800/80 pl-2">
                      {s.tasksCompleted.map((tid) => {
                        const task = tasks.find((t) => t.id === tid);
                        return (
                          <p key={tid} className="text-[10px] text-gray-500 truncate">
                            {'\u21b3'} {task ? task.title : tid}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-2">Activity</p>
        <div className="flex flex-col gap-2">
          {activities.map((a) => (
            <div key={a.id} className="flex items-start gap-2">
              <span className="text-[9px] text-gray-700 shrink-0 mt-px w-5">{formatTime(a.timestamp)}</span>
              <span className="text-[10px] text-gray-400 leading-snug">{a.description}</span>
            </div>
          ))}
          {activities.length === 0 && (
            <p className="text-[10px] text-gray-700 italic">No activity yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function TerminalView() {
  const projectPath = useProjectPath();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0d0d14',
        foreground: '#e2e8f0',
        cursor: '#818cf8',
        selectionBackground: '#3730a3',
        black: '#1e1e2e',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#89dceb',
        white: '#cdd6f4',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#89dceb',
        brightWhite: '#ffffff',
      },
      fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    term.onData((data) => {
      invoke('write_pty_input', { data }).catch(() => {});
    });

    let unlistenData: (() => void) | null = null;
    let unlistenDied: (() => void) | null = null;

    const startSession = async () => {
      // Await listener registration BEFORE spawning PTY — prevents dropped startup events
      unlistenData = await listen<string>('pty-data', (event) => {
        const binary = atob(event.payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        term.write(bytes);
        setStatus('ready');

        if (!initializedRef.current) {
          initializedRef.current = true;
          setTimeout(() => {
            invoke('write_pty_input', {
              data: 'hw_get_context() — greet Pat with project name, workflow phase, and active tasks.\n',
            }).catch(() => {});
          }, 2000);
        }
      });

      unlistenDied = await listen('pty-died', () => {
        setStatus('starting');
        // Auto-respawn after brief delay
        setTimeout(() => {
          invoke('start_pty_session', { projectPath }).catch((e: unknown) => {
            setStatus('error');
            setError(String(e));
          });
        }, 1000);
      });

      // Returns false if session already running — set ready immediately
      const spawned = await invoke<boolean>('start_pty_session', { projectPath });
      if (!spawned) setStatus('ready');
    };

    startSession().catch((e) => {
      setStatus('error');
      setError(String(e));
    });

    const observer = new ResizeObserver(() => {
      fit.fit();
      invoke('resize_pty', { rows: term.rows, cols: term.cols }).catch(() => {});
    });
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      unlistenData?.();
      unlistenDied?.();
      observer.disconnect();
      term.dispose();
    };
  }, []);

  // Refit when panel opens/closes
  useEffect(() => {
    setTimeout(() => {
      fitRef.current?.fit();
      const t = termRef.current;
      if (t) invoke('resize_pty', { rows: t.rows, cols: t.cols }).catch(() => {});
    }, 150);
  }, [panelOpen]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between shrink-0 bg-[#0d0d14]">
        <span className="text-sm font-semibold text-gray-200">⌨ Terminal</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${status === 'ready' ? 'bg-green-400' : status === 'error' ? 'bg-red-400' : 'bg-yellow-400 animate-pulse'}`} />
            <span className={`text-xs ${status === 'ready' ? 'text-green-400' : status === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
              {status === 'ready' ? 'Claude running' : status === 'error' ? 'Error' : 'Starting...'}
            </span>
          </div>
          <button
            onClick={() => setPanelOpen((p) => !p)}
            className="text-[11px] px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors font-mono"
            title="Toggle context panel"
          >
            {panelOpen ? 'hide ctx' : 'show ctx'}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800/50 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Terminal + optional side panel */}
      <div className="flex-1 flex min-h-0">
        <div
          ref={containerRef}
          className="flex-1 min-h-0 min-w-0 p-2 bg-[#0d0d14]"
          style={{ overflow: 'hidden' }}
        />
        {panelOpen && <SidePanel />}
      </div>

    </div>
  );
}
