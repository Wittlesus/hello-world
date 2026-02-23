import { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';

interface ActivityEvent { id: string; description: string; timestamp: string }
interface ActivityData  { activities: ActivityEvent[] }
interface WorkflowData  { phase: string }
interface Task          { id: string; title: string; status: string }
interface StateData     { tasks: Task[] }

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

function truncate(text: string, words = 9): string {
  const w = text.split(/\s+/);
  return w.length <= words ? text : w.slice(0, words).join(' ') + '\u2026';
}

export function ClaudeBuddy() {
  const projectPath = useProjectPath();
  const { data: activityData } = useTauriData<ActivityData>('get_activity', projectPath);
  const { data: workflowData } = useTauriData<WorkflowData>('get_workflow', projectPath);
  const { data: stateData }    = useTauriData<StateData>('get_state', projectPath);

  const [collapsed, setCollapsed]   = useState(false);
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping]     = useState(false);
  const lastIdRef = useRef<string>('');
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phase      = workflowData?.phase ?? 'idle';
  const activities = activityData?.activities ?? [];
  const latest     = activities.length > 0 ? activities[activities.length - 1] : null;
  const activeTask = stateData?.tasks.find((t) => t.status === 'in_progress');

  const eyeColor    = PHASE_COLOR[phase] ?? '#4b5563';
  const borderClass = PHASE_BORDER[phase] ?? 'border-gray-700';
  const isActive    = phase !== 'idle';
  const currentIdx  = PHASES.indexOf(phase as typeof PHASES[number]);

  const typeText = useCallback((text: string) => {
    if (typingRef.current) clearTimeout(typingRef.current);
    setIsTyping(true);
    setDisplayText('');
    let i = 0;
    const tick = () => {
      i++;
      setDisplayText(text.slice(0, i));
      if (i < text.length) {
        typingRef.current = setTimeout(tick, 22);
      } else {
        setIsTyping(false);
      }
    };
    typingRef.current = setTimeout(tick, 22);
  }, []);

  // Primary: live tool summaries from MCP server via loopback HTTP → Tauri event
  useEffect(() => {
    const unlisten = listen<{ summary: string }>('hw-tool-summary', (event) => {
      const summary = event.payload?.summary;
      if (summary) {
        lastIdRef.current = '__live__' + Date.now();
        typeText(truncate(summary, 12));
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [typeText]);

  // Fallback: retype whenever a new activity arrives (covers non-MCP writes)
  useEffect(() => {
    const incoming = latest?.id ?? '';
    if (incoming && incoming === lastIdRef.current) return;
    // Don't overwrite a live summary for 3 seconds
    if (lastIdRef.current.startsWith('__live__')) return;
    lastIdRef.current = incoming;

    const text = latest
      ? truncate(latest.description)
      : activeTask
        ? truncate('working on: ' + activeTask.title)
        : PHASE_LABEL[phase] ?? phase;

    typeText(text);
  }, [latest?.id, phase, activeTask?.id, typeText]);

  // Character bob / twitch / ship animation
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
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes bubble-in {
          from { opacity: 0; transform: scale(0.92) translateY(6px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 3px currentColor; }
          50%       { box-shadow: 0 0 7px currentColor; }
        }
      `}</style>

      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2 select-none pointer-events-none">
        {/* Speech bubble */}
        {!collapsed && (
          <div
            className="relative bg-[#0f0f18] border border-gray-700/90 rounded-2xl px-3.5 py-2.5 max-w-[220px] shadow-xl shadow-black/60 pointer-events-auto"
            style={{ animation: 'bubble-in 0.18s ease-out' }}
          >
            {/* Phase indicator */}
            <div className="flex items-center gap-1.5 mb-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor: eyeColor,
                  color: eyeColor,
                  animation: isActive ? 'glow-pulse 1.4s ease infinite' : 'none',
                }}
              />
              <span className="text-[9px] font-mono uppercase tracking-widest text-gray-600">
                {PHASE_LABEL[phase] ?? phase}
              </span>
            </div>

            {/* Phase progress bar */}
            <div className="flex gap-[3px] mb-2">
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

            {/* Activity text */}
            <p className="text-[11px] text-gray-300 leading-relaxed min-h-[16px]">
              {displayText}
              {isTyping && (
                <span
                  className="inline-block w-px h-[11px] bg-indigo-400 ml-[1px] align-text-bottom"
                  style={{ animation: 'cursor-blink 0.55s step-end infinite' }}
                />
              )}
            </p>

            {/* Active task name */}
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
