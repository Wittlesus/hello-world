import { useState } from 'react';
import { useTaskStore, type TaskItem } from '../stores/tasks';

type Status = TaskItem['status'];

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

function TaskCard({ task, tasks }: { task: TaskItem; tasks: TaskItem[] }) {
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

function AddTaskForm() {
  const [active, setActive] = useState(false);
  const [title, setTitle] = useState('');
  const addTask = useTaskStore((s) => s.addTask);

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;

    addTask({
      id: crypto.randomUUID(),
      title: trimmed,
      description: '',
      status: 'todo',
      tags: [],
      dependsOn: [],
    });

    setTitle('');
    setActive(false);
  }

  if (!active) {
    return (
      <button
        type="button"
        onClick={() => setActive(true)}
        className="w-full text-xs text-gray-500 hover:text-gray-300 border border-dashed border-gray-800 hover:border-gray-600 rounded-lg py-2 transition-colors cursor-pointer"
      >
        + Add Task
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2"
    >
      <input
        autoFocus
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setTitle('');
            setActive(false);
          }
        }}
        onBlur={() => {
          if (!title.trim()) {
            setActive(false);
          }
        }}
        placeholder="Task title..."
        className="w-full bg-[#1a1a24] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-yellow-500/50"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          className="text-xs px-3 py-1 rounded bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 transition-colors cursor-pointer"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setTitle('');
            setActive(false);
          }}
          className="text-xs px-3 py-1 rounded text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function TaskBoard() {
  const tasks = useTaskStore((s) => s.tasks);

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
              {col.status === 'todo' && <AddTaskForm />}

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
