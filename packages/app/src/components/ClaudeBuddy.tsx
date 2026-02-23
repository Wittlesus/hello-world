import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';

interface WorkflowData  { phase: string }
interface Task          { id: string; title: string; status: string }
interface StateData     { tasks: Task[] }

interface Thought {
  id: string;
  text: string;
  fresh: boolean; // true for ~600ms after arrival, drives flash highlight
}

const PHASE_COLOR: Record<string, string> = {
  idle:   '#4b5563',
  scope:  '#facc15',
  plan:   '#60a5fa',
  build:  '#818cf8',
  verify: '#fb923c',
  ship:   '#4ade80',
};

const PHASE_BORDER: Record<string, string> = {
  idle:   'border-gray-700',
  scope:  'border-yellow-500/60',
  plan:   'border-blue-500/60',
  build:  'border-indigo-500/60',
  verify: 'border-orange-500/60',
  ship:   'border-green-500/60',
};

const PHASE_LABEL: Record<string, string> = {
  idle:   'idle',
  scope:  'scoping',
  plan:   'planning',
  build:  'building',
  verify: 'verifying',
  ship:   'shipping',
};

const PHASES = ['scope', 'plan', 'build', 'verify', 'ship'] as const;

// Opacity for each position in the stream: [newest, ...oldest]
const STREAM_OPACITIES = [1, 0.55, 0.35, 0.2, 0.12];
const MAX_THOUGHTS = 5;

export function ClaudeBuddy() {
  const projectPath = useProjectPath();
  const { data: workflowData } = useTauriData<WorkflowData>('get_workflow', projectPath);
  const { data: stateData }    = useTauriData<StateData>('get_state', projectPath);

  const [collapsed, setCollapsed] = useState(false);
  const [thoughts, setThoughts]   = useState<Thought[]>([]);
  const [awaiting, setAwaiting]   = useState(true);
  const freshTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const phase      = workflowData?.phase ?? 'idle';
  const activeTask = stateData?.tasks.find((t) => t.status === 'in_progress');
  const eyeColor   = PHASE_COLOR[phase] ?? '#4b5563';
  const borderClass = PHASE_BORDER[phase] ?? 'border-gray-700';
  const isActive   = phase !== 'idle';
  const currentIdx = PHASES.indexOf(phase as typeof PHASES[number]);

  useEffect(() => {
    const unlisten = listen<{ summary: string; type?: string }>('hw-tool-summary', (event) => {
      const { summary, type } = event.payload ?? {};
      if (!summary) return;

      if (type === 'awaiting') {
        setAwaiting(true);
        return;
      }

      setAwaiting(false);
      const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);

      setThoughts((prev) => {
        const next: Thought[] = [{ id, text: summary, fresh: true }, ...prev].slice(0, MAX_THOUGHTS);
        return next;
      });

      // Clear fresh flag after 600ms
      const timer = setTimeout(() => {
        setThoughts((prev) => prev.map((t) => t.id === id ? { ...t, fresh: false } : t));
        freshTimers.current.delete(id);
      }, 600);
      freshTimers.current.set(id, timer);
    });

    return () => {
      unlisten.then((fn) => fn());
      freshTimers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  // Animation speed: twitch when building, slow bob otherwise
  const headAnim =
    phase === 'build'  ? 'buddy-twitch 0.45s ease infinite' :
    phase === 'ship'   ? 'buddy-bob 0.55s ease infinite' :
    phase === 'verify' ? 'buddy-bob 1.2s ease infinite' :
                         'buddy-bob 3.5s ease infinite';

  return (
    <>
      <style>{`
        @keyframes buddy-blink {
          0%, 88%, 100% { transform: scaleY(1); }
          93%            { transform: scaleY(0.08); }
        }
        @keyframes buddy-bob {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-3px); }
        }
        @keyframes buddy-twitch {
          0%, 100% { transform: translate(0, 0); }
          20%       { transform: translate(-1px, -1px); }
          40%       { transform: translate(1px, 1px); }
          60%       { transform: translate(-1px, 0); }
          80%       { transform: translate(1px, -1px); }
        }
        @keyframes bubble-in {
          from { opacity: 0; transform: scale(0.92) translateY(6px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        @keyframes glow-pulse {
          0%, 100% { opacity: 0.7; }
          50%       { opacity: 1; }
        }
        @keyframes await-pulse {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 1; }
        }
        @keyframes thought-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2 select-none pointer-events-none">
        {/* Speech bubble */}
        {!collapsed && (
          <div
            className="relative bg-[#0f0f18] border border-gray-700/90 rounded-2xl px-3.5 py-2.5 w-[230px] shadow-xl shadow-black/60 pointer-events-auto"
            style={{ animation: 'bubble-in 0.18s ease-out' }}
          >
            {/* Phase row */}
            <div className="flex items-center gap-1.5 mb-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor: eyeColor,
                  animation: isActive ? 'glow-pulse 1.4s ease infinite' : 'none',
                }}
              />
              <span className="text-[9px] font-mono uppercase tracking-widest text-gray-600">
                {PHASE_LABEL[phase] ?? phase}
              </span>
            </div>

            {/* Phase progress bar */}
            <div className="flex gap-[3px] mb-2.5">
              {PHASES.map((p, idx) => {
                const isPast    = idx < currentIdx;
                const isCurrent = idx === currentIdx;
                const color     = PHASE_COLOR[p];
                return (
                  <div
                    key={p}
                    className="h-[3px] flex-1 rounded-full transition-all duration-300"
                    style={{
                      backgroundColor: isCurrent ? color : isPast ? color + '55' : '#1f2937',
                      boxShadow: isCurrent ? `0 0 5px ${color}` : 'none',
                    }}
                  />
                );
              })}
            </div>

            {/* Thought stream — newest on top, fades toward bottom */}
            <div className="flex flex-col gap-[3px] min-h-[16px]">
              {thoughts.length === 0 && !awaiting && (
                <p className="text-[10px] text-gray-700 italic font-mono">ready</p>
              )}
              {thoughts.map((t, i) => (
                <p
                  key={t.id}
                  className="text-[11px] font-mono leading-snug truncate transition-opacity duration-300"
                  style={{
                    opacity: STREAM_OPACITIES[i] ?? 0.08,
                    color: t.fresh ? '#a5b4fc' : '#d1d5db',
                    animation: i === 0 ? 'thought-in 0.12s ease-out' : 'none',
                  }}
                >
                  {t.text}
                </p>
              ))}
            </div>

            {/* Awaiting response indicator */}
            {awaiting && (
              <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-800/60">
                <span
                  className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"
                  style={{ animation: 'await-pulse 1.2s ease infinite' }}
                />
                <span className="text-[10px] font-mono text-green-500/80">Awaiting response...</span>
              </div>
            )}

            {/* Active task */}
            {activeTask && (
              <p className="text-[9px] text-gray-600 mt-1.5 font-mono truncate" title={activeTask.title}>
                {'\u21b3'} {activeTask.title}
              </p>
            )}

            {/* Bubble tail */}
            <div className="absolute -bottom-[7px] right-[18px] w-3 h-3 bg-[#0f0f18] border-r border-b border-gray-700/90 rotate-45" />
          </div>
        )}

        {/* Head */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Show Claude status' : 'Collapse'}
          className={`pointer-events-auto w-11 h-11 rounded-full bg-[#0f0f18] border-2 ${borderClass} flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 shadow-lg shadow-black/60`}
          style={{ animation: headAnim }}
        >
          <div className="flex gap-[5px] items-center">
            {[0, 160].map((delay) => (
              <div
                key={delay}
                className="w-[5px] h-[5px] rounded-full"
                style={{
                  backgroundColor: eyeColor,
                  animation: `buddy-blink 4.2s ease infinite ${delay}ms`,
                  ...(isActive ? { filter: `drop-shadow(0 0 2px ${eyeColor})` } : {}),
                }}
              />
            ))}
          </div>
        </button>
      </div>
    </>
  );
}
