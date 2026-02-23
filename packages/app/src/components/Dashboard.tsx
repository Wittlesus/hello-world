import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';
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

interface DecisionsData {
  decisions: Array<{ id: string; title: string; chosen: string; decidedAt: string }>;
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

const PHASE_ORDER = ['idle', 'scope', 'plan', 'build', 'verify', 'ship'];

const PHASE_COLOR: Record<string, string> = {
  idle:   'text-gray-500',
  scope:  'text-yellow-400',
  plan:   'text-blue-400',
  build:  'text-indigo-400',
  verify: 'text-orange-400',
  ship:   'text-green-400',
};

const PHASE_BG: Record<string, string> = {
  idle:   'bg-gray-500/10',
  scope:  'bg-yellow-500/10',
  plan:   'bg-blue-500/10',
  build:  'bg-indigo-500/10',
  verify: 'bg-orange-500/10',
  ship:   'bg-green-500/10',
};

export function Dashboard() {
  const projectPath = useProjectPath();
  const { data: stateData }     = useTauriData<StateData>('get_state', projectPath);
  const { data: workflowData }  = useTauriData<WorkflowData>('get_workflow', projectPath);
  const { data: decisionsData } = useTauriData<DecisionsData>('get_state', projectPath);
  const { data: directionData, refetch: refetchDirection } = useTauriData<DirectionData>('get_direction', projectPath);

  const [markingRead, setMarkingRead] = useState<Set<string>>(new Set());

  const tasks    = stateData?.tasks ?? [];
  const phase    = workflowData?.phase ?? 'idle';
  const strikes  = workflowData?.strikes ?? 0;

  const activeTask = tasks.find((t) => t.status === 'in_progress');
  const todoTasks  = tasks.filter((t) => t.status === 'todo');
  const doneTasks  = tasks.filter((t) => t.status === 'done');

  const phaseIdx   = PHASE_ORDER.indexOf(phase);
  const phaseColor = PHASE_COLOR[phase] ?? 'text-gray-400';
  const phaseBg    = PHASE_BG[phase] ?? 'bg-gray-500/10';

  const recentDecisions = (decisionsData as any)?.decisions
    ? [...(decisionsData as any).decisions].slice(-3).reverse()
    : [];

  const unreadNotes = (directionData?.notes ?? []).filter((n) => !n.read);

  const markRead = useCallback(async (noteId: string) => {
    setMarkingRead((prev) => new Set(prev).add(noteId));
    try {
      await invoke('mark_direction_note_read', { projectPath, noteId });
      refetchDirection();
    } finally {
      setMarkingRead((prev) => { const s = new Set(prev); s.delete(noteId); return s; });
    }
  }, [projectPath, refetchDirection]);

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
        {strikes > 0 && (
          <span className="text-[11px] text-yellow-500">{strikes}/2 strikes</span>
        )}
        {unreadNotes.length > 0 && (
          <span className="text-[11px] text-amber-400 font-medium">
            {unreadNotes.length} unread direction {unreadNotes.length === 1 ? 'note' : 'notes'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-blue-400">{todoTasks.length} todo</span>
          <span className="text-[11px] text-gray-500">{doneTasks.length} done</span>
        </div>
      </div>

      {/* Direction notes — only shown when unread exist */}
      {unreadNotes.length > 0 && (
        <div className="shrink-0 border-b border-amber-900/40 bg-amber-950/20">
          <div className="flex items-center justify-between px-4 py-2 border-b border-amber-900/30">
            <p className="text-[10px] uppercase tracking-widest text-amber-600 font-semibold">Direction from Pat</p>
            <button
              onClick={markAllRead}
              className="text-[10px] text-amber-700 hover:text-amber-400 transition-colors"
            >
              Dismiss all
            </button>
          </div>
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
                  {markingRead.has(note.id) ? '...' : 'Mark read'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top info pane */}
      <div className="shrink-0 grid grid-cols-3 gap-px bg-gray-800/40 border-b border-gray-800/70">

        {/* Active task */}
        <div className="col-span-2 bg-[#0a0a0f] p-4">
          <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Active Task</p>
          {activeTask ? (
            <>
              <p className="text-sm font-medium text-white leading-snug">{activeTask.title}</p>
              {activeTask.description && (
                <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">{activeTask.description}</p>
              )}
              <p className="text-[10px] text-gray-700 mt-2 font-mono">{activeTask.id}</p>
            </>
          ) : (
            <p className="text-sm text-gray-600 italic">No active task — call hw_update_task</p>
          )}
        </div>

        {/* Phase + queue */}
        <div className="bg-[#0a0a0f] p-4 flex flex-col gap-3">
          {/* Workflow phase */}
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

          {/* Queue */}
          {todoTasks.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-1.5">Up Next</p>
              <div className="flex flex-col gap-1">
                {todoTasks.slice(0, 3).map((t) => (
                  <p key={t.id} className="text-[11px] text-gray-400 truncate leading-snug">
                    <span className="text-gray-700 mr-1">·</span>{t.title}
                  </p>
                ))}
                {todoTasks.length > 3 && (
                  <p className="text-[10px] text-gray-600">+{todoTasks.length - 3} more</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Activity stream */}
      <ActivityStream />
    </div>
  );
}
