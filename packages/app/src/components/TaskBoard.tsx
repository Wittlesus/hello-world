import { useState } from 'react';
import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { LoadingState, ErrorState } from './LoadingState.js';

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  tags: string[];
  dependsOn: string[];
  createdAt: string;
  updatedAt: string;
}

interface StateData { tasks: Task[] }
interface WorkflowData { phase: string }

const PHASE_COLORS: Record<string, { bg: string; text: string }> = {
  idle:   { bg: 'bg-gray-800',      text: 'text-gray-400' },
  scope:  { bg: 'bg-yellow-900/50', text: 'text-yellow-300' },
  plan:   { bg: 'bg-blue-900/50',   text: 'text-blue-300' },
  build:  { bg: 'bg-indigo-900/50', text: 'text-indigo-300' },
  verify: { bg: 'bg-orange-900/50', text: 'text-orange-300' },
  ship:   { bg: 'bg-green-900/50',  text: 'text-green-300' },
};

const TAG_COLORS = [
  'bg-violet-500/20 text-violet-300',
  'bg-cyan-500/20 text-cyan-300',
  'bg-amber-500/20 text-amber-300',
  'bg-rose-500/20 text-rose-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-sky-500/20 text-sky-300',
];

function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

function isStale(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > 7 * 24 * 60 * 60 * 1000;
}

function relativeAge(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return '1d';
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function TodoRow({ task, index, expanded, onToggle }: {
  task: Task; index: number; expanded: boolean; onToggle: () => void;
}) {
  const stale = isStale(task.createdAt);
  return (
    <div className={`border-b border-gray-800/40 last:border-0 ${expanded ? 'bg-white/[0.03]' : 'hover:bg-white/[0.02]'} transition-colors`}>
      <button type="button" onClick={onToggle} className="w-full flex items-start gap-3 px-4 py-2.5 text-left">
        <span className={`shrink-0 text-[11px] font-mono mt-0.5 w-5 text-right ${stale ? 'text-gray-700' : 'text-gray-600'}`}>
          {index}.
        </span>
        <div className="flex-1 min-w-0">
          <span className={`text-sm leading-snug ${stale ? 'text-gray-600' : 'text-gray-300'}`}>
            {task.title}
          </span>
          {task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {task.tags.map((tag) => (
                <span key={tag} className={`text-[10px] font-medium px-1.5 py-px rounded-full ${stale ? 'opacity-40' : ''} ${tagColor(tag)}`}>
                  {tag}
                </span>
              ))}
            </div>
          )}
          {expanded && task.description && (
            <p className="text-xs text-gray-500 mt-2 leading-relaxed whitespace-pre-wrap">{task.description}</p>
          )}
        </div>
        <span className="shrink-0 text-[10px] font-mono mt-0.5 text-gray-700">
          {relativeAge(task.createdAt)}
        </span>
      </button>
    </div>
  );
}

export function TaskBoard() {
  const projectPath = useProjectPath();
  const { data, loading, error, refetch } = useTauriData<StateData>('get_state', projectPath);
  const { data: wf } = useTauriData<WorkflowData>('get_workflow', projectPath);
  const [expandedTodo, setExpandedTodo] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [expandedDone, setExpandedDone] = useState<string | null>(null);

  if (loading) return <LoadingState label="Loading tasks..." />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const tasks   = data?.tasks ?? [];
  const phase   = wf?.phase ?? 'idle';
  const ps      = PHASE_COLORS[phase] ?? PHASE_COLORS.idle;
  const blocked = tasks.filter((t) => t.status === 'blocked');
  const active  = tasks.filter((t) => t.status === 'in_progress');
  const todo    = tasks.filter((t) => t.status === 'todo');
  const done    = tasks.filter((t) => t.status === 'done');

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-gray-600 text-center max-w-sm">
          No tasks yet. Claude creates tasks via{' '}
          <code className="text-gray-500 bg-gray-800/60 px-1 rounded">hw_add_task</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0f]">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/70 bg-[#0d0d14] shrink-0">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">Tasks</span>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-gray-700">{todo.length} queued</span>
          {done.length > 0 && (
            <button
              type="button"
              onClick={() => setDoneOpen((v) => !v)}
              className="text-[10px] font-mono text-gray-600 hover:text-gray-400 transition-colors"
            >
              {done.length} done {doneOpen ? '▲' : '▼'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">

        {/* Zone 1: Blocked banner */}
        {blocked.length > 0 && (
          <div className="mx-4 mt-4 rounded-lg border border-red-800/50 bg-red-950/20 px-4 py-3">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-red-400">
                Blocked
              </span>
            </div>
            <div className="space-y-2">
              {blocked.map((t) => (
                <div key={t.id} className="pl-3.5">
                  <span className="text-sm text-red-300/80 leading-snug">{t.title}</span>
                  {t.description && (
                    <p className="text-xs text-red-400/40 mt-0.5 leading-relaxed">{t.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Zone 2: Active tasks */}
        <div className="px-4 mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Active</div>
          {active.length > 0 ? (
            <div className="rounded-lg border border-gray-700/50 bg-[#111118] overflow-hidden">
              {active.map((task, i) => (
                <div key={task.id} className={`flex items-start gap-3 px-3 py-2.5 ${i > 0 ? 'border-t border-gray-800/50' : ''}`}>
                  {i === 0 && (
                    <span className={`shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wide mt-0.5 ${ps.bg} ${ps.text}`}>
                      {phase}
                    </span>
                  )}
                  {i > 0 && <span className="shrink-0 w-[38px]" />}
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm leading-snug ${i === 0 ? 'text-white' : 'text-gray-400'}`}>{task.title}</span>
                    {task.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {task.tags.map((tag) => (
                          <span key={tag} className={`text-[10px] font-medium px-1.5 py-px rounded-full ${i === 0 ? tagColor(tag) : 'bg-gray-800/60 text-gray-600'}`}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-2.5 rounded-lg border border-gray-800/40 bg-[#111118]/40">
              <span className="text-xs text-gray-600 italic">No active task</span>
            </div>
          )}
        </div>

        {/* Zone 3: Todo queue */}
        {todo.length > 0 && (
          <div className="px-4 mt-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Queue</div>
            <div className="rounded-lg border border-gray-800/60 bg-[#111118] overflow-hidden">
              {todo.map((task, i) => (
                <TodoRow
                  key={task.id}
                  task={task}
                  index={i + 1}
                  expanded={expandedTodo === task.id}
                  onToggle={() => setExpandedTodo((v) => v === task.id ? null : task.id)}
                />
              ))}
            </div>
            {todo.some((t) => isStale(t.createdAt)) && (
              <p className="text-[10px] text-gray-700 mt-1.5 px-1">Faded items queued 7+ days.</p>
            )}
          </div>
        )}

        {/* Done — expanded via header badge */}
        {doneOpen && done.length > 0 && (
          <div className="px-4 mt-5 mb-4">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Done</div>
            <div className="rounded-lg border border-gray-800/40 bg-[#0e0e16] overflow-hidden">
              {done.map((task) => (
                <div key={task.id} className={`border-b border-gray-800/30 last:border-0 ${expandedDone === task.id ? 'bg-white/[0.02]' : ''}`}>
                  <button
                    type="button"
                    onClick={() => setExpandedDone((v) => v === task.id ? null : task.id)}
                    className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-green-800/60 shrink-0" />
                    <span className="text-xs text-gray-600 flex-1 leading-snug">{task.title}</span>
                    <span className="text-[10px] font-mono text-gray-700 shrink-0">{relativeAge(task.updatedAt)}</span>
                  </button>
                  {expandedDone === task.id && task.description && (
                    <p className="text-xs text-gray-600 px-4 pb-2.5 pl-9 leading-relaxed">{task.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="h-4" />
      </div>
    </div>
  );
}
