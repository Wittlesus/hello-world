import { useState, useEffect, useRef } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWindow, currentMonitor, LogicalPosition } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { getTheme } from '../stores/theme.js';

type ActivityState = 'waiting' | 'responding' | 'shocked' | 'happy';
type VisualState = ActivityState | 'error';

function playDoneSound() {
  try {
    const ctx = new AudioContext();
    const t   = ctx.currentTime;
    const voices: [number, number, number, number, number][] = [
      [0.000,  659.25, 0.18, 0.012, 0.90],
      [0.000, 1318.50, 0.06, 0.010, 0.50],
      [0.090, 1108.73, 0.15, 0.015, 1.50],
      [0.090, 2217.46, 0.04, 0.012, 0.65],
      [0.090, 1663.09, 0.02, 0.010, 0.40],
    ];
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    comp.connect(ctx.destination);
    voices.forEach(([t0, freq, peak, attackS, decayS]) => {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      osc.connect(g); g.connect(comp);
      const start = t + t0;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(peak, start + attackS);
      g.gain.exponentialRampToValueAtTime(0.0001, start + attackS + decayS);
      osc.start(start); osc.stop(start + attackS + decayS + 0.05);
    });
  } catch { /* non-fatal */ }
}

export function BuddyOverlay() {
  const win = getCurrentWindow();

  const [activity, setActivity]   = useState<ActivityState>('waiting');
  const [hasError, setHasError]   = useState(false);
  const [themeId, setThemeId]     = useState('void-protocol');
  const [muted, setMuted]         = useState(false);
  const mutedRef                  = useRef(false);
  const activityRef               = useRef<ActivityState>('waiting');
  const shockTimer                = useRef<ReturnType<typeof setTimeout> | null>(null);
  const happyTimer                = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer               = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectPathRef            = useRef<string | null>(null);

  const setAct = (s: ActivityState) => { activityRef.current = s; setActivity(s); };

  const theme: ReturnType<typeof getTheme> = getTheme(themeId);
  const visual: VisualState = hasError ? 'error' : activity;

  // Position bottom-right and show
  useEffect(() => {
    (async () => {
      try {
        const mon = await currentMonitor();
        if (mon) {
          const sw = mon.size.width / mon.scaleFactor;
          const sh = mon.size.height / mon.scaleFactor;
          await win.setPosition(new LogicalPosition(sw - 110, sh - 145));
        }
      } catch { /* ignore — window stays at default position */ }
      await win.show().catch(() => {});
    })();
  }, []);

  // Get project path for approvals check
  useEffect(() => {
    invoke<string | null>('get_app_project_path')
      .then((p) => { projectPathRef.current = p; })
      .catch(() => {});
  }, []);

  // Sync theme from main window
  useEffect(() => {
    const u = listen<string>('hw-theme-changed', (e) => setThemeId(e.payload));
    return () => { u.then((fn) => fn()); };
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
      } catch { /* ignore */ }
    });

    const summaryU = listen<{ type: string }>('hw-tool-summary', (e) => {
      const type = e.payload?.type;
      if (type === 'typing') {
        if (safetyTimer.current) clearTimeout(safetyTimer.current);
        if (shockTimer.current)  clearTimeout(shockTimer.current);
        if (happyTimer.current)  clearTimeout(happyTimer.current);
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
      if (shockTimer.current)  clearTimeout(shockTimer.current);
      if (happyTimer.current)  clearTimeout(happyTimer.current);
    };
  }, []);

  // Emit theme for initial sync (request from main window)
  useEffect(() => {
    const u = listen<void>('hw-buddy-sync-request', () => {
      emit('hw-theme-changed', themeId).catch(() => {});
    });
    return () => { u.then((fn) => fn()); };
  }, [themeId]);

  const handleMouseDown = async () => {
    try { await win.startDragging(); } catch { /* ignore */ }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMuted((m) => { mutedRef.current = !m; return !m; });
  };

  // Colors
  const eyeColor =
    visual === 'error'      ? '#f87171' :
    visual === 'responding' ? theme.buddyActive :
    visual === 'shocked'    ? '#ffffff' :
    visual === 'happy'      ? theme.buddyIdle :
    theme.buddyIdle;  // waiting

  const glowColor =
    visual === 'error' ? 'rgba(248,113,113,0.7)' :
    visual === 'happy' ? `${theme.buddyIdle}cc` :
    `${eyeColor}99`;

  // Animation on the face container
  const faceAnim =
    visual === 'responding' ? 'buddy-twitch 0.28s ease infinite' :
    visual === 'happy'      ? 'buddy-bounce 0.45s ease infinite' :
    visual === 'error'      ? 'buddy-pulse 1.4s ease infinite' :
    'buddy-bob 3.5s ease infinite';  // waiting + shocked

  // Eye shape
  const eyeScaleY =
    visual === 'responding' ? 0.55 :
    visual === 'happy'      ? 0.25 :
    1.0;

  // Blink animation — no blink when responding or happy
  const blinkAnim = (delay: number) =>
    visual === 'responding' || visual === 'happy' || visual === 'shocked'
      ? 'none'
      : `buddy-blink 4.5s ease infinite ${delay}ms`;

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { overflow: hidden; user-select: none; background: ${theme.bg}; }
        @keyframes buddy-bob {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-4px); }
        }
        @keyframes buddy-twitch {
          0%, 100% { transform: translate(0,0) rotate(0deg); }
          15%  { transform: translate(-2px,-1px) rotate(-1.2deg); }
          30%  { transform: translate(2px,1px) rotate(1.2deg); }
          50%  { transform: translate(-1px,2px) rotate(-0.6deg); }
          65%  { transform: translate(2px,-1px) rotate(0.6deg); }
          80%  { transform: translate(-2px,0) rotate(-1deg); }
        }
        @keyframes buddy-bounce {
          0%, 100% { transform: translateY(0) scale(1); }
          50%       { transform: translateY(-7px) scale(1.06); }
        }
        @keyframes buddy-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.45; }
        }
        @keyframes buddy-blink {
          0%, 87%, 100% { transform: scaleY(1); }
          92%            { transform: scaleY(0.06); }
        }
        @keyframes exclaim-pop {
          0%   { transform: scale(0) translateY(6px); opacity: 0; }
          55%  { transform: scale(1.35) translateY(-3px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes happy-glow {
          0%, 100% { filter: drop-shadow(0 0 3px ${glowColor}); }
          50%       { filter: drop-shadow(0 0 9px ${glowColor}); }
        }
      `}</style>

      <div
        style={{
          width: '90px',
          height: '120px',
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
        {/* Exclamation mark — shocked state */}
        {visual === 'shocked' && (
          <div style={{
            position: 'absolute',
            top: '16px',
            fontSize: '22px',
            fontWeight: '900',
            fontFamily: 'monospace',
            color: '#ffffff',
            filter: 'drop-shadow(0 0 8px #ffffff)',
            animation: 'exclaim-pop 0.18s ease-out forwards',
            lineHeight: 1,
            pointerEvents: 'none',
          }}>!</div>
        )}

        {/* Face — animated container */}
        <div style={{ animation: faceAnim }}>
          {/* Eyes */}
          <div style={{ display: 'flex', gap: '22px', alignItems: 'center' }}>
            {[0, 260].map((delay) => (
              <div
                key={delay}
                style={{
                  width: '13px',
                  height: '13px',
                  borderRadius: '50%',
                  backgroundColor: eyeColor,
                  filter: visual === 'happy'
                    ? `drop-shadow(0 0 3px ${glowColor})`
                    : `drop-shadow(0 0 3px ${eyeColor}99)`,
                  transform: `scaleY(${eyeScaleY})`,
                  transformOrigin: 'center',
                  animation: visual === 'happy'
                    ? `happy-glow 0.9s ease infinite ${delay}ms`
                    : blinkAnim(delay),
                  transition: 'transform 0.12s ease, background-color 0.25s ease',
                }}
              />
            ))}
          </div>
        </div>

        {/* Mute dot */}
        {muted && (
          <div style={{
            position: 'absolute',
            bottom: '7px',
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            backgroundColor: '#374151',
          }} />
        )}
      </div>
    </>
  );
}
