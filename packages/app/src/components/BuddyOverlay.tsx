import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { currentMonitor, getCurrentWindow, LogicalPosition } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import { getTheme } from '../stores/theme.js';

type ActivityState = 'waiting' | 'responding' | 'shocked' | 'happy';
type VisualState = ActivityState | 'error';

interface RecapData {
  sessionNumber: number;
  completedTasks: string[];
  decisions: string[];
  highlights: string[];
}

function RecapBubble({ data, onDismiss }: { data: RecapData; onDismiss: () => void }) {
  const [displayedLines, setDisplayedLines] = useState<string[]>([]);
  const [charIndex, setCharIndex] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build lines from recap data
  const allLines = (() => {
    const lines: string[] = [`Session ${data.sessionNumber} recap:`];
    if (data.completedTasks.length > 0) {
      data.completedTasks.slice(0, 4).forEach((t) => lines.push(`- ${t.slice(0, 40)}`));
    }
    if (data.decisions.length > 0) {
      data.decisions.slice(0, 2).forEach((d) => lines.push(`* ${d.slice(0, 40)}`));
    }
    if (lines.length === 1) {
      lines.push('(quiet session)');
    }
    return lines;
  })();

  // Character-by-character typing effect
  useEffect(() => {
    if (lineIndex >= allLines.length) {
      // All lines typed -- start auto-dismiss timer
      dismissTimer.current = setTimeout(onDismiss, 12000);
      return () => {
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
      };
    }

    const currentLine = allLines[lineIndex];
    if (charIndex >= currentLine.length) {
      // Line complete -- move to next line
      setDisplayedLines((prev) => [...prev, currentLine]);
      setLineIndex((i) => i + 1);
      setCharIndex(0);
      return;
    }

    const speed = charIndex === 0 ? 80 : 25; // Pause at line start
    const timer = setTimeout(() => setCharIndex((c) => c + 1), speed);
    return () => clearTimeout(timer);
  }, [lineIndex, charIndex, allLines.length]);

  const partialLine = lineIndex < allLines.length ? allLines[lineIndex].slice(0, charIndex) : '';

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginBottom: '8px',
        background: '#1a1a2e',
        border: '2px solid #4a4a6a',
        borderRadius: '8px',
        padding: '8px 10px',
        minWidth: '180px',
        maxWidth: '260px',
        animation: 'bubble-in 0.3s ease-out forwards',
        cursor: 'pointer',
        zIndex: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      }}
    >
      {/* Speech bubble tail */}
      <div
        style={{
          position: 'absolute',
          bottom: '-8px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '8px solid transparent',
          borderRight: '8px solid transparent',
          borderTop: '8px solid #4a4a6a',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-5px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid #1a1a2e',
        }}
      />
      {/* Text content */}
      <div
        style={{
          fontFamily: '"Courier New", monospace',
          fontSize: '10px',
          lineHeight: '1.4',
          color: '#c8c8e0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {displayedLines.map((line, i) => (
          <div key={i} style={{ color: i === 0 ? '#8b8bdb' : '#c8c8e0' }}>
            {line}
          </div>
        ))}
        {partialLine && (
          <div>
            {partialLine}
            <span style={{ animation: 'buddy-pulse 0.8s ease infinite' }}>_</span>
          </div>
        )}
      </div>
    </div>
  );
}

function playDoneSound() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    const voices: [number, number, number, number, number][] = [
      [0.0, 659.25, 0.18, 0.012, 0.9],
      [0.0, 1318.5, 0.06, 0.01, 0.5],
      [0.09, 1108.73, 0.15, 0.015, 1.5],
      [0.09, 2217.46, 0.04, 0.012, 0.65],
      [0.09, 1663.09, 0.02, 0.01, 0.4],
    ];
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    voices.forEach(([t0, freq, peak, attackS, decayS]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(g);
      g.connect(comp);
      const start = t + t0;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(peak, start + attackS);
      g.gain.exponentialRampToValueAtTime(0.0001, start + attackS + decayS);
      osc.start(start);
      osc.stop(start + attackS + decayS + 0.05);
    });
  } catch {
    /* non-fatal */
  }
}

export function BuddyOverlay() {
  const win = getCurrentWindow();

  const [activity, setActivity] = useState<ActivityState>('waiting');
  const [hasError, setHasError] = useState(false);
  const [themeId, setThemeId] = useState(() => {
    // Read persisted theme from localStorage on mount (same key as zustand persist)
    try {
      const stored = localStorage.getItem('hw-theme');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.state?.themeId) return parsed.state.themeId as string;
      }
    } catch {
      /* fall through */
    }
    return 'void-protocol';
  });
  const [muted, setMuted] = useState(false);
  const [recap, setRecap] = useState<RecapData | null>(null);
  const mutedRef = useRef(false);
  const activityRef = useRef<ActivityState>('waiting');
  const shockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const happyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectPathRef = useRef<string | null>(null);

  const setAct = (s: ActivityState) => {
    activityRef.current = s;
    setActivity(s);
  };

  const theme = getTheme(themeId);
  const visual: VisualState = hasError ? 'error' : activity;

  // Body color follows state
  const bodyColor =
    visual === 'error'
      ? '#f87171'
      : visual === 'responding'
        ? theme.buddyActive
        : visual === 'shocked'
          ? '#e2e8f0'
          : theme.buddyIdle; // waiting + happy

  const glowColor = `${bodyColor}55`;

  const bodyAnim =
    visual === 'responding'
      ? 'buddy-twitch 0.28s ease infinite'
      : visual === 'happy'
        ? 'buddy-bounce 0.45s ease infinite, happy-glow 0.9s ease infinite'
        : visual === 'error'
          ? 'buddy-pulse 1.4s ease infinite'
          : 'buddy-bob 3.5s ease infinite';

  // Position bottom-right and show
  useEffect(() => {
    (async () => {
      try {
        const mon = await currentMonitor();
        if (mon) {
          const sw = mon.size.width / mon.scaleFactor;
          const sh = mon.size.height / mon.scaleFactor;
          await win.setPosition(new LogicalPosition(sw - 120, sh - 150));
        }
      } catch {
        /* ignore */
      }
      await win.show().catch(() => {});
    })();
  }, []);

  // Get project path for approvals check
  useEffect(() => {
    invoke<string | null>('get_app_project_path')
      .then((p) => {
        projectPathRef.current = p;
      })
      .catch(() => {});
  }, []);

  // Sync theme from main window
  useEffect(() => {
    const u = listen<string>('hw-theme-changed', (e) => setThemeId(e.payload));
    return () => {
      u.then((fn) => fn());
    };
  }, []);

  // State machine
  useEffect(() => {
    const filesU = listen<string[]>('hw-files-changed', async (e) => {
      if (!e.payload.includes('approvals.json')) return;
      const pp = projectPathRef.current;
      if (!pp) return;
      try {
        const raw = await invoke<string>('get_approvals', { projectPath: pp });
        const arr = JSON.parse(raw) as Array<{ status: string }>;
        setHasError(arr.some((a) => a.status === 'pending'));
      } catch {
        /* ignore */
      }
    });

    const summaryU = listen<{ type: string }>('hw-tool-summary', (e) => {
      const type = e.payload?.type;
      if (type === 'typing') {
        if (safetyTimer.current) clearTimeout(safetyTimer.current);
        if (shockTimer.current) clearTimeout(shockTimer.current);
        if (happyTimer.current) clearTimeout(happyTimer.current);
        setAct('responding');
        safetyTimer.current = setTimeout(() => setAct('waiting'), 3 * 60 * 1000);
      } else if (type === 'awaiting') {
        if (safetyTimer.current) clearTimeout(safetyTimer.current);
        if (!mutedRef.current) playDoneSound();
        setAct('shocked');
        shockTimer.current = setTimeout(() => {
          setAct('happy');
          happyTimer.current = setTimeout(() => setAct('waiting'), 3000);
        }, 500);
      }
    });

    return () => {
      filesU.then((fn) => fn());
      summaryU.then((fn) => fn());
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
      if (shockTimer.current) clearTimeout(shockTimer.current);
      if (happyTimer.current) clearTimeout(happyTimer.current);
    };
  }, []);

  // Listen for recap data on startup
  useEffect(() => {
    const u = listen<RecapData>('hw-buddy-recap', (e) => {
      if (e.payload?.sessionNumber) setRecap(e.payload);
    });
    return () => {
      u.then((fn) => fn());
    };
  }, []);

  // Emit theme for initial sync (request from main window)
  useEffect(() => {
    const u = listen<void>('hw-buddy-sync-request', () => {
      emit('hw-theme-changed', themeId).catch(() => {});
    });
    return () => {
      u.then((fn) => fn());
    };
  }, [themeId]);

  const handleMouseDown = async () => {
    try {
      await win.startDragging();
    } catch {
      /* ignore */
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMuted((m) => {
      mutedRef.current = !m;
      return !m;
    });
  };

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { overflow: hidden; user-select: none; background: transparent; }

        @keyframes buddy-bob {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-4px); }
        }
        @keyframes buddy-twitch {
          0%, 100% { transform: translate(0,0) rotate(0deg); }
          15%  { transform: translate(-2px,-1px) rotate(-1.5deg); }
          30%  { transform: translate(2px,1px)  rotate(1.5deg); }
          50%  { transform: translate(-1px,2px) rotate(-0.8deg); }
          65%  { transform: translate(2px,-1px) rotate(0.8deg); }
          80%  { transform: translate(-2px,0)   rotate(-1.2deg); }
        }
        @keyframes buddy-bounce {
          0%, 100% { transform: translateY(0) scale(1); }
          50%       { transform: translateY(-8px) scale(1.07); }
        }
        @keyframes buddy-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        @keyframes buddy-blink {
          0%, 87%, 100% { transform: scaleY(1); }
          92%            { transform: scaleY(0.08); }
        }
        @keyframes exclaim-pop {
          0%   { transform: scale(0) translateY(4px); opacity: 0; }
          55%  { transform: scale(1.4) translateY(-2px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes happy-glow {
          0%, 100% { filter: drop-shadow(0 0 4px ${glowColor}); }
          50%       { filter: drop-shadow(0 0 12px ${bodyColor}88); }
        }
        @keyframes dot-bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30%            { transform: translateY(-5px); }
        }
        @keyframes bubble-in {
          from { opacity: 0; transform: scale(0.8) translateY(4px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div
        style={{
          width: '110px',
          height: '140px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          position: 'relative',
        }}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        title={muted ? 'Muted — right-click to unmute' : 'Right-click to mute'}
      >
        {/* Recap speech bubble */}
        {recap && <RecapBubble data={recap} onDismiss={() => setRecap(null)} />}

        {/* Typing indicator dots — responding state */}
        {visual === 'responding' && (
          <div
            style={{
              position: 'absolute',
              top: '18px',
              display: 'flex',
              gap: '4px',
              alignItems: 'center',
              animation: 'bubble-in 0.2s ease-out forwards',
              pointerEvents: 'none',
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  backgroundColor: bodyColor,
                  display: 'inline-block',
                  animation: 'dot-bounce 0.9s ease infinite',
                  animationDelay: `${i * 0.18}s`,
                }}
              />
            ))}
          </div>
        )}

        {/* Exclamation mark — shocked state */}
        {visual === 'shocked' && (
          <div
            style={{
              position: 'absolute',
              top: '14px',
              fontSize: '20px',
              fontWeight: '900',
              fontFamily: 'monospace',
              color: '#ffffff',
              filter: 'drop-shadow(0 0 8px #ffffff)',
              animation: 'exclaim-pop 0.18s ease-out forwards',
              lineHeight: 1,
              pointerEvents: 'none',
            }}
          >
            !
          </div>
        )}

        {/* Block-art avatar — animated container */}
        <div style={{ animation: bodyAnim }}>
          <div
            style={{
              fontFamily: '"Courier New", Courier, monospace',
              fontSize: '15px',
              lineHeight: '0.95',
              color: bodyColor,
              transition: 'color 0.25s ease',
              whiteSpace: 'pre',
              textAlign: 'left',
            }}
          >{`▐▛███▜▌\n▝▜█████▛▘\n  ▘▘ ▝▝  `}</div>
        </div>

        {/* Mute dot */}
        {muted && (
          <div
            style={{
              position: 'absolute',
              bottom: '8px',
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              backgroundColor: '#374151',
            }}
          />
        )}
      </div>
    </>
  );
}
