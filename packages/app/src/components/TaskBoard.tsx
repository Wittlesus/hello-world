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

interface StateData {
  tasks: Task[];
}

type Status = Task['status'];

const COLUMNS: { status: Status; label: string; color: string; headerBg: string; badgeBg: string }[] = [
  { status: 'todo', label: 'Todo', color: 'border-yellow-500/60', headerBg: 'bg-yellow-500/10', badgeBg: 'bg-yellow-500/20 text-yellow-300' },
  { status: 'in_progress', label: 'In Progress', color: 'border-blue-500/60', headerBg: 'bg-blue-500/10', badgeBg: 'bg-blue-500/20 text-blue-300' },
  { status: 'done', label: 'Done', color: 'border-green-500/60', headerBg: 'bg-green-500/10', badgeBg: 'bg-green-500/20 text-green-300' },
  { status: 'blocked', label: 'Blocked', color: 'border-red-500/60', headerBg: 'bg-red-500/10', badgeBg: 'bg-red-500/20 text-red-300' },
];

const TAG_COLORS = [
  'bg-violet-500/20 text-violet-300',
  'bg-cyan-500/20 text-cyan-300',
  'bg-amber-500/20 text-amber-300',
  'bg-rose-500/20 text-rose-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-fuchsia-500/20 text-fuchsia-300',
  'bg-sky-500/20 text-sky-300',
  'bg-orange-500/20 text-orange-300',
];

function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

function TaskCard({ task, tasks }: { task: Task; tasks: Task[] }) {
  const [expanded, setExpanded] = useState(false);

  const dependencyCount = task.dependsOn.length;
  const resolvedDeps = task.dependsOn.map((depId) => {
    const dep = tasks.find((t) => t.id === depId);
    return { id: depId, title: dep?.title ?? depId, status: dep?.status };
  });

  return (
    <button
      type="button"
      onClick={() => setExpanded((prev) => !prev)}
      className="w-full text-left bg-[#1a1a24] border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-gray-100 leading-snug">{task.title}</span>
        {dependencyCount > 0 && (
          <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
            {dependencyCount} dep{dependencyCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {task.tags.map((tag) => (
            <span key={tag} className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${tagColor(tag)}`}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-800">
          {task.description ? (
            <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">{task.description}</p>
          ) : (
            <p className="text-xs text-gray-600 italic">No description.</p>
          )}

          {resolvedDeps.length > 0 && (
            <div className="mt-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Dependencies</span>
              <ul className="mt-1 space-y-0.5">
                {resolvedDeps.map((dep) => (
                  <li key={dep.id} className="flex items-center gap-1.5 text-xs text-gray-400">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        dep.status === 'done' ? 'bg-green-500' : dep.status === 'blocked' ? 'bg-red-500' : 'bg-gray-500'
                      }`}
                    />
                    {dep.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

export function TaskBoard() {
  const projectPath = useProjectPath();
  const { data, loading, error, refetch } = useTauriData<StateData>('get_state', projectPath);
  const tasks = data?.tasks ?? [];

  if (loading) return <LoadingState label="Loading tasks..." />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-gray-500 text-center max-w-md">
          No tasks yet. Claude creates tasks automatically via MCP tools, or use <code className="text-gray-400 bg-gray-800 px-1 rounded">hw_add_task</code> to add one manually.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex gap-4 p-4 overflow-x-auto min-w-0">
      {COLUMNS.map((col) => {
        const columnTasks = tasks.filter((t) => t.status === col.status);

        return (
          <div key={col.status} className="flex flex-col min-w-[240px] w-[280px] shrink-0">
            <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg border-t-2 ${col.color} ${col.headerBg}`}>
              <span className="text-sm font-semibold text-gray-200">{col.label}</span>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full ${col.badgeBg}`}>
                {columnTasks.length}
              </span>
            </div>

            <div className="flex-1 flex flex-col gap-2 p-2 bg-[#111118]/50 rounded-b-lg border border-t-0 border-gray-800/50">
              {columnTasks.length === 0 ? (
                <div className="flex-1 flex items-center justify-center min-h-[80px] border border-dashed border-gray-800 rounded-lg">
                  <span className="text-xs text-gray-600">(empty)</span>
                </div>
              ) : (
                columnTasks.map((task) => (
                  <TaskCard key={task.id} task={task} tasks={tasks} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
