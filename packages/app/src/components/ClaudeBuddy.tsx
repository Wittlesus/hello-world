import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Volume2, VolumeX } from 'lucide-react';
import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';

function playDoneSound() {
  try {
    const ctx = new AudioContext();
    // C5 harmonic bell: fundamental + natural overtone series.
    // Higher partials decay faster, leaving the fundamental resonating —
    // like a small crystal singing bowl settling after being struck.
    const partials: [freq: number, gain: number, decay: number][] = [
      [523.25, 0.20, 1.8],  // C5 — fundamental, long sustain
      [1046.5, 0.09, 1.0],  // C6 — octave
      [1568.0, 0.05, 0.65], // G6 — perfect fifth harmonic
      [2093.0, 0.03, 0.40], // C7 — two octaves up
    ];
    partials.forEach(([freq, peak, decay]) => {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(peak, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + decay);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + decay);
    });
  } catch { /* AudioContext unavailable — non-fatal */ }
}

interface WorkflowData { phase: string }
interface Task        { id: string; title: string; status: string }
interface StateData   { tasks: Task[] }

type BuddyState = 'Coding' | 'Responding' | 'Waiting';

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

export function ClaudeBuddy() {
  const projectPath = useProjectPath();
  const { data: workflowData } = useTauriData<WorkflowData>('get_workflow', projectPath);
  const { data: stateData }    = useTauriData<StateData>('get_state', projectPath);

  const [collapsed, setCollapsed]     = useState(false);
  const [buddyState, setBuddyState]   = useState<BuddyState>('Waiting');
  const [muted, setMuted]             = useState(false);
  const mutedRef                      = useRef(false);
  const cleanupRef                    = useRef<(() => void)[]>([]);
  const lastFilesChanged              = useRef<number>(0);
  const lastPtyLine                   = useRef<number>(0);
  // True once we've seen any activity this cycle — so the chime only fires
  // after real work, not on a cold Waiting state at startup.
  const hadActivityRef                = useRef(false);

  const toggleMute = () => setMuted(m => { mutedRef.current = !m; return !m; });

  const phase       = workflowData?.phase ?? 'idle';
  const activeTask  = stateData?.tasks.find((t) => t.status === 'in_progress');
  const eyeColor    = PHASE_COLOR[phase] ?? '#4b5563';
  const borderClass = PHASE_BORDER[phase] ?? 'border-gray-700';
  const isActive    = phase !== 'idle';

  useEffect(() => {
    // PTY lines — real-time terminal output from Claude
    const ptyPromise = listen<string>('hw-pty-line', (event) => {
      if (!event.payload) return;
      lastPtyLine.current = Date.now();
      hadActivityRef.current = true;
    });

    // Files changed — Claude is executing Edit/Write tools
    const filesPromise = listen<string[]>('hw-files-changed', () => {
      lastFilesChanged.current = Date.now();
      hadActivityRef.current = true;
    });

    // Stop hook — Claude definitively finished its turn.
    // This is the authoritative Waiting signal — no timeout needed.
    const summaryPromise = listen<{ type: string; summary: string }>(
      'hw-tool-summary',
      (event) => {
        if (event.payload?.type !== 'awaiting') return;
        // Reset timestamps so the fallback poller doesn't fight us
        lastPtyLine.current      = 0;
        lastFilesChanged.current = 0;
        setBuddyState('Waiting');
        if (hadActivityRef.current && !mutedRef.current) playDoneSound();
        hadActivityRef.current = false;
      }
    );

    cleanupRef.current = [
      () => ptyPromise.then((fn) => fn()),
      () => filesPromise.then((fn) => fn()),
      () => summaryPromise.then((fn) => fn()),
    ];
    return () => cleanupRef.current.forEach((fn) => fn());
  }, []);

  // Fallback poller: drives Coding/Responding labels and catches the rare
  // case where the Stop hook fails to fire (crash/timeout edge case).
  // The Stop hook owns the Waiting transition — this only steps in after
  // 10s of total silence from both channels.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const next: BuddyState =
        now - lastFilesChanged.current < 3000 ? 'Coding' :
        now - lastPtyLine.current      < 4000 ? 'Responding' :
        'Waiting';

      if (next !== 'Waiting') {
        setBuddyState(next);
      } else {
        // Only override to Waiting via fallback after 10s of total silence
        const lastActivity = Math.max(lastPtyLine.current, lastFilesChanged.current);
        if (lastActivity > 0 && now - lastActivity > 10_000) {
          setBuddyState('Waiting');
          if (hadActivityRef.current && !mutedRef.current) playDoneSound();
          hadActivityRef.current   = false;
          lastPtyLine.current      = 0;
          lastFilesChanged.current = 0;
        }
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  const headAnim =
    phase === 'build'  ? 'buddy-twitch 0.45s ease infinite' :
    phase === 'ship'   ? 'buddy-bob 0.55s ease infinite' :
    phase === 'verify' ? 'buddy-bob 1.2s ease infinite' :
                         'buddy-bob 3.5s ease infinite';

  const stateDotStyle: CSSProperties =
    buddyState === 'Coding'
      ? { backgroundColor: '#fb923c', animation: 'dot-pulse 0.8s ease infinite' }
      : buddyState === 'Responding'
      ? { backgroundColor: '#60a5fa', animation: 'cursor-blink 1s step-end infinite' }
      : { backgroundColor: '#374151' };

  const stateTextColor =
    buddyState === 'Coding'     ? '#fb923c' :
    buddyState === 'Responding' ? '#60a5fa' :
    '#4b5563';

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
        @keyframes glow-pulse {
          0%, 100% { opacity: 0.7; }
          50%       { opacity: 1; }
        }
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.75); }
        }
      `}</style>

      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2 select-none pointer-events-none">

        {/* Status panel */}
        {!collapsed && (
          <div
            className="bg-[#09090f] border border-gray-800/80 rounded px-2.5 py-2 w-[160px] shadow-xl shadow-black/70 pointer-events-auto"
          >
            {/* Phase dot */}
            <div className="flex items-center gap-1.5 mb-2">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor: eyeColor,
                  animation: isActive ? 'glow-pulse 1.4s ease infinite' : 'none',
                }}
              />
              <span className="text-[9px] font-mono uppercase tracking-widest text-gray-600">
                {phase}
              </span>
            </div>

            {/* State pill + mute toggle */}
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={stateDotStyle}
              />
              <span
                className="text-[11px] font-mono flex-1"
                style={{ color: stateTextColor }}
              >
                {buddyState}
              </span>
              <button
                onClick={toggleMute}
                title={muted ? 'Unmute sound' : 'Mute sound'}
                className="text-gray-700 hover:text-gray-500 transition-colors"
              >
                {muted
                  ? <VolumeX size={10} />
                  : <Volume2 size={10} />}
              </button>
            </div>

            {/* Active task */}
            {activeTask && (
              <p
                className="text-[9px] text-gray-700 mt-2 font-mono truncate border-t border-gray-800/60 pt-1.5"
                title={activeTask.title}
              >
                {'\u21b3'} {activeTask.title}
              </p>
            )}

            {/* Bubble tail */}
            <div className="absolute -bottom-[7px] right-[18px] w-3 h-3 bg-[#09090f] border-r border-b border-gray-800/80 rotate-45" />
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
