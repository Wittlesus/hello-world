import { invoke } from '@tauri-apps/api/core';
import { useCallback, useMemo, useState } from 'react';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { ActivityStream } from './ActivityStream.js';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
}

interface StateData {
  tasks: Task[];
}

interface WorkflowData {
  phase: string;
  strikes: number;
  currentTaskId: string | null;
}

interface Session {
  id: string;
  startedAt: string;
  endedAt?: string;
  summary?: string;
  tasksCompleted: string[];
  costUsd: number;
}

interface SessionsData {
  sessions: Session[];
}

interface DirectionNote {
  id: string;
  text: string;
  source: string;
  read: boolean;
  capturedAt: string;
}

interface DirectionData {
  vision?: string;
  scope?: Array<{ area: string; decision: string; rationale: string }>;
  notes?: DirectionNote[];
}

interface Memory {
  id: string;
  type: string;
  title: string;
  synapticStrength: number;
  accessCount: number;
  createdAt: string;
}

interface MemoriesData {
  memories: Memory[];
}

interface BrainStateData {
  state: {
    sessionStart: string;
    messageCount: number;
    contextPhase: string;
    synapticActivity: Record<string, { count: number }>;
    significantEventsSinceCheckpoint?: number;
  } | null;
}

type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

function computeSimplifiedGrade(
  memories: Memory[] | undefined,
  brainState: BrainStateData | null,
): HealthGrade {
  if (!memories || memories.length === 0) return 'F';
  let score = 100;
  const total = memories.length;

  // No brain state
  if (!brainState?.state) score -= 10;

  // Memory count thresholds
  if (total < 5) score -= 30;
  else if (total < 20) score -= 15;
  else if (total < 50) score -= 5;

  // Check for stale memories (no access in 7+ days)
  const now = Date.now();
  const staleCount = memories.filter((m) => {
    const age = now - new Date(m.createdAt).getTime();
    return age > 7 * 24 * 60 * 60 * 1000 && m.accessCount <= 1;
  }).length;
  const staleRatio = total > 0 ? staleCount / total : 0;
  if (staleRatio > 0.3) score -= 20;
  else if (staleRatio > 0.15) score -= 10;

  // Low synaptic activity
  const tagCount = brainState?.state?.synapticActivity
    ? Object.keys(brainState.state.synapticActivity).length
    : 0;
  if (tagCount < 5) score -= 10;

  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

const GRADE_STYLE: Record<HealthGrade, string> = {
  A: 'text-green-400 bg-green-500/15 border-green-500/30',
  B: 'text-blue-400 bg-blue-500/15 border-blue-500/30',
  C: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
  D: 'text-red-400 bg-red-500/15 border-red-500/30',
  F: 'text-red-400 bg-red-500/15 border-red-500/30',
};

const PHASE_ORDER = ['idle', 'scope', 'plan', 'build', 'verify', 'ship'];

const PHASE_COLOR: Record<string, string> = {
  idle: 'text-gray-500',
  scope: 'text-yellow-400',
  plan: 'text-blue-400',
  build: 'text-indigo-400',
  verify: 'text-orange-400',
  ship: 'text-green-400',
};

const PHASE_BG: Record<string, string> = {
  idle: 'bg-gray-500/10',
  scope: 'bg-yellow-500/10',
  plan: 'bg-blue-500/10',
  build: 'bg-indigo-500/10',
  verify: 'bg-orange-500/10',
  ship: 'bg-green-500/10',
};

function formatSessionDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDuration(startedAt: string, endedAt?: string): string {
  if (!endedAt) return 'active';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return '< 1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function Dashboard() {
  const projectPath = useProjectPath();
  const { data: stateData } = useTauriData<StateData>('get_state', projectPath);
  const { data: workflowData } = useTauriData<WorkflowData>('get_workflow', projectPath);
  const { data: sessionsData } = useTauriData<SessionsData>('get_sessions', projectPath);
  const { data: directionData, refetch: refetchDirection } = useTauriData<DirectionData>(
    'get_direction',
    projectPath,
  );
  const { data: memoriesData } = useTauriData<MemoriesData>('get_memories', projectPath);
  const { data: brainStateData } = useTauriData<BrainStateData>('get_brain_state', projectPath);

  const [markingRead, setMarkingRead] = useState<Set<string>>(new Set());
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  const tasks = stateData?.tasks ?? [];
  const phase = workflowData?.phase ?? 'idle';
  const strikes = workflowData?.strikes ?? 0;

  const activeTask = tasks.find((t) => t.status === 'in_progress');
  const todoTasks = tasks.filter((t) => t.status === 'todo');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  const memoryCount = memoriesData?.memories?.length ?? 0;
  const brainGrade = useMemo(
    () => computeSimplifiedGrade(memoriesData?.memories, brainStateData),
    [memoriesData, brainStateData],
  );
  const gradeStyle = GRADE_STYLE[brainGrade];

  const phaseIdx = PHASE_ORDER.indexOf(phase);
  const phaseColor = PHASE_COLOR[phase] ?? 'text-gray-400';
  const phaseBg = PHASE_BG[phase] ?? 'bg-gray-500/10';

  const unreadNotes = (directionData?.notes ?? []).filter((n) => !n.read);
  const allSessions = sessionsData?.sessions ?? [];
  const recentSessions = [...allSessions].reverse().slice(0, 5);

  const toggleSession = useCallback((id: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const markRead = useCallback(
    async (noteId: string) => {
      setMarkingRead((prev) => new Set(prev).add(noteId));
      try {
        await invoke('mark_direction_note_read', { projectPath, noteId });
        refetchDirection();
      } finally {
        setMarkingRead((prev) => {
          const s = new Set(prev);
          s.delete(noteId);
          return s;
        });
      }
    },
    [projectPath, refetchDirection],
  );

  const markAllRead = useCallback(async () => {
    for (const note of unreadNotes) {
      await invoke('mark_direction_note_read', { projectPath, noteId: note.id });
    }
    refetchDirection();
  }, [projectPath, unreadNotes, refetchDirection]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0f]">
      {/* Header strip */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800/70 bg-[#0d0d14] shrink-0">
        <span className="text-[11px] font-semibold text-gray-300">Dashboard</span>
        <div className="h-3 w-px bg-gray-800" />
        <span className={`text-[11px] font-mono uppercase ${phaseColor}`}>{phase}</span>
        {strikes > 0 && <span className="text-[11px] text-yellow-500">{strikes}/2 strikes</span>}
        {unreadNotes.length > 0 && (
          <span className="text-[11px] text-amber-400 font-medium">
            {unreadNotes.length} unread {unreadNotes.length === 1 ? 'note' : 'notes'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-blue-400">{todoTasks.length} todo</span>
          <span className="text-[11px] text-gray-500">{doneTasks.length} done</span>
        </div>
      </div>

      {/* Status bar — 4 compact stat blocks */}
      <div className="shrink-0 grid grid-cols-4 gap-px bg-gray-800/30 border-b border-gray-800/70">
        {/* Brain Health */}
        <div className="bg-[#0d0d14] px-4 py-2 flex items-center gap-2.5">
          <span className="text-[10px] uppercase tracking-widest text-gray-600">Brain</span>
          <span
            className={`text-[13px] font-bold font-mono px-1.5 py-0.5 rounded border ${gradeStyle}`}
          >
            {brainGrade}
          </span>
        </div>

        {/* Memory Count */}
        <div className="bg-[#0d0d14] px-4 py-2 flex items-center gap-2.5">
          <span className="text-[10px] uppercase tracking-widest text-gray-600">Memories</span>
          <span className="text-[13px] font-mono font-medium text-purple-400">
            {memoryCount > 0 ? memoryCount : '--'}
          </span>
        </div>

        {/* Active Task */}
        <div className="bg-[#0d0d14] px-4 py-2 flex items-center gap-2.5 min-w-0">
          <span className="text-[10px] uppercase tracking-widest text-gray-600 shrink-0">Task</span>
          {activeTask ? (
            <span className="text-[11px] text-white truncate">{activeTask.title}</span>
          ) : (
            <span className="text-[11px] text-gray-600 italic">No active task</span>
          )}
        </div>

        {/* Workflow Phase */}
        <div className="bg-[#0d0d14] px-4 py-2 flex items-center gap-2.5">
          <span className="text-[10px] uppercase tracking-widest text-gray-600">Phase</span>
          <span
            className={`text-[11px] font-mono uppercase px-1.5 py-0.5 rounded ${phaseColor} ${phaseBg}`}
          >
            {phase}
          </span>
        </div>
      </div>

      {/* Direction notes — always shown; content varies by unread count */}
      <div
        className={`shrink-0 border-b ${unreadNotes.length > 0 ? 'border-amber-900/40 bg-amber-950/20' : 'border-gray-800/40 bg-[#0d0d14]'}`}
      >
        <div
          className={`flex items-center justify-between px-4 py-2 ${unreadNotes.length > 0 ? 'border-b border-amber-900/30' : ''}`}
        >
          <p
            className={`text-[10px] uppercase tracking-widest font-semibold ${unreadNotes.length > 0 ? 'text-amber-600' : 'text-gray-700'}`}
          >
            Direction from Pat
          </p>
          {unreadNotes.length > 0 && (
            <button
              onClick={markAllRead}
              className="text-[10px] text-amber-700 hover:text-amber-400 transition-colors"
            >
              Dismiss all
            </button>
          )}
        </div>
        {unreadNotes.length === 0 ? (
          <p className="px-4 py-2 text-[11px] text-gray-600">
            No unread notes. Pat can send direction notes via Discord — they appear here for review.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-amber-900/20">
            {unreadNotes.map((note) => (
              <div key={note.id} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-amber-200 leading-relaxed">{note.text}</p>
                  <p className="text-[10px] text-amber-800 mt-1 font-mono">
                    {note.source} · {new Date(note.capturedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => markRead(note.id)}
                  disabled={markingRead.has(note.id)}
                  className="shrink-0 text-[10px] text-amber-700 hover:text-amber-400 transition-colors disabled:opacity-40 mt-0.5"
                >
                  {markingRead.has(note.id) ? '...' : 'Dismiss'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top info pane — 3 columns */}
      <div className="shrink-0 grid grid-cols-3 gap-px bg-gray-800/40 border-b border-gray-800/70">
        {/* Active task */}
        <div className="col-span-1 bg-[#0a0a0f] p-4">
          <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Active Task</p>
          {activeTask ? (
            <>
              <p className="text-sm font-medium text-white leading-snug">{activeTask.title}</p>
              {activeTask.description && (
                <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">
                  {activeTask.description}
                </p>
              )}
              <p className="text-[10px] text-gray-700 mt-2 font-mono">{activeTask.id}</p>
            </>
          ) : (
            <p className="text-sm text-gray-600 italic">No active task</p>
          )}
        </div>

        {/* Phase + queue */}
        <div className="bg-[#0a0a0f] p-4 flex flex-col gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Phase</p>
            <div className="flex gap-1 flex-wrap">
              {PHASE_ORDER.map((p, i) => (
                <span
                  key={p}
                  className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                    i === phaseIdx
                      ? `${phaseColor} ${phaseBg} ring-1 ring-current/30`
                      : i < phaseIdx
                        ? 'text-gray-600 bg-gray-800/30'
                        : 'text-gray-700'
                  }`}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>

          {todoTasks.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Up Next</p>
              <div className="flex flex-col gap-1">
                {todoTasks.slice(0, 3).map((t) => (
                  <p key={t.id} className="text-[11px] text-gray-400 truncate leading-snug">
                    <span className="text-gray-700 mr-1">·</span>
                    {t.title}
                  </p>
                ))}
                {todoTasks.length > 3 && (
                  <p className="text-[10px] text-gray-600">+{todoTasks.length - 3} more</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Recent sessions */}
        <div className="bg-[#0a0a0f] p-4">
          <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">
            Recent Sessions
          </p>
          {recentSessions.length === 0 ? (
            <p className="text-xs text-gray-600 italic">No sessions yet</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {recentSessions.map((s, i) => {
                const sessionNum = allSessions.length - i;
                const isActive = !s.endedAt;
                const isExpanded = expandedSessions.has(s.id);
                const hasTasks = s.tasksCompleted.length > 0;
                const duration = formatDuration(s.startedAt, s.endedAt);
                return (
                  <div key={s.id}>
                    <button
                      onClick={() => hasTasks && toggleSession(s.id)}
                      className={`w-full flex items-center gap-1.5 text-left py-0.5 ${hasTasks ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <span className="text-[9px] text-gray-700 shrink-0 w-2">
                        {hasTasks ? (isExpanded ? '▼' : '▶') : '\u00a0'}
                      </span>
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 animate-pulse" />
                      )}
                      <span className="text-[10px] text-gray-500 font-mono shrink-0">
                        #{sessionNum}
                      </span>
                      <span className="text-[10px] text-gray-600 font-mono shrink-0">
                        {formatSessionDate(s.startedAt)}
                      </span>
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
          )}
        </div>
      </div>

      {/* Activity stream */}
      <ActivityStream />
    </div>
  );
}
