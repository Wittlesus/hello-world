import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BuddyState = 'idle' | 'thinking' | 'working' | 'error';

export interface BuddyAvatarProps {
  state: BuddyState;
  size?: number;
  /** Theme accent color (idle color). Falls back to #60a5fa. */
  color?: string;
  /** Active/working color. Falls back to #4ade80. */
  activeColor?: string;
}

export type AvatarId = 'default' | 'pixel' | 'cat' | 'ghost' | 'cube' | 'flame';

export interface AvatarEntry {
  id: AvatarId;
  name: string;
  component: React.FC<BuddyAvatarProps>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function stateColor(
  state: BuddyState,
  idle: string,
  active: string,
): string {
  if (state === 'error') return '#f87171';
  if (state === 'working') return active;
  if (state === 'thinking') return active;
  return idle;
}

/** Generates a unique id prefix for SVG defs to avoid collisions */
let _counter = 0;
function useUniqueId(prefix: string): string {
  const [id] = useState(() => `${prefix}-${++_counter}`);
  return id;
}

// ---------------------------------------------------------------------------
// Shared keyframe styles -- injected once
// ---------------------------------------------------------------------------

const SHARED_KEYFRAMES = `
@keyframes ba-breathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.05); }
}
@keyframes ba-float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-3px); }
}
@keyframes ba-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}
@keyframes ba-spin {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes ba-shake {
  0%, 100% { transform: translateX(0); }
  15%  { transform: translateX(-3px); }
  30%  { transform: translateX(3px); }
  45%  { transform: translateX(-2px); }
  60%  { transform: translateX(2px); }
  75%  { transform: translateX(-1px); }
}
@keyframes ba-bounce {
  0%, 100% { transform: translateY(0); }
  40%      { transform: translateY(-5px); }
  60%      { transform: translateY(-2px); }
}
@keyframes ba-blink {
  0%, 85%, 100% { transform: scaleY(1); }
  90%            { transform: scaleY(0.1); }
}
@keyframes ba-wiggle {
  0%, 100% { transform: rotate(0deg); }
  25%      { transform: rotate(-4deg); }
  75%      { transform: rotate(4deg); }
}
@keyframes ba-flicker {
  0%, 100% { opacity: 1; transform: scaleY(1) scaleX(1); }
  20%  { opacity: 0.9; transform: scaleY(1.04) scaleX(0.96); }
  40%  { opacity: 1;   transform: scaleY(0.96) scaleX(1.04); }
  60%  { opacity: 0.85; transform: scaleY(1.06) scaleX(0.94); }
  80%  { opacity: 1;   transform: scaleY(0.98) scaleX(1.02); }
}
@keyframes ba-ear-twitch-l {
  0%, 80%, 100% { transform: rotate(0deg); }
  85%           { transform: rotate(-12deg); }
  90%           { transform: rotate(0deg); }
  95%           { transform: rotate(-6deg); }
}
@keyframes ba-ear-twitch-r {
  0%, 75%, 100% { transform: rotate(0deg); }
  80%           { transform: rotate(12deg); }
  87%           { transform: rotate(0deg); }
  93%           { transform: rotate(8deg); }
}
@keyframes ba-tail-sway {
  0%, 100% { transform: rotate(-15deg); }
  50%      { transform: rotate(15deg); }
}
@keyframes ba-ghost-float {
  0%, 100% { transform: translateY(0) scaleX(1); }
  25%      { transform: translateY(-4px) scaleX(0.97); }
  50%      { transform: translateY(-2px) scaleX(1.03); }
  75%      { transform: translateY(-5px) scaleX(0.98); }
}
@keyframes ba-cube-rotate {
  0%   { transform: rotateY(0deg); }
  100% { transform: rotateY(360deg); }
}
@keyframes ba-cube-tilt {
  0%, 100% { transform: rotate(0deg); }
  25%      { transform: rotate(2deg); }
  75%      { transform: rotate(-2deg); }
}
@keyframes ba-flame-dance {
  0%, 100% { transform: scaleY(1) scaleX(1) translateY(0); }
  15%  { transform: scaleY(1.08) scaleX(0.94) translateY(-1px); }
  30%  { transform: scaleY(0.95) scaleX(1.06) translateY(1px); }
  50%  { transform: scaleY(1.1) scaleX(0.92) translateY(-2px); }
  70%  { transform: scaleY(0.97) scaleX(1.04) translateY(0px); }
  85%  { transform: scaleY(1.05) scaleX(0.97) translateY(-1px); }
}
`;

let _stylesInjected = false;
function useSharedStyles() {
  useEffect(() => {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const el = document.createElement('style');
    el.textContent = SHARED_KEYFRAMES;
    document.head.appendChild(el);
    return () => {
      // Don't remove -- other avatars may still need them
    };
  }, []);
}

function animForState(state: BuddyState): string {
  switch (state) {
    case 'idle':     return 'ba-breathe 3s ease infinite';
    case 'thinking': return 'ba-pulse 1.2s ease infinite';
    case 'working':  return 'ba-bounce 0.6s ease infinite';
    case 'error':    return 'ba-shake 0.4s ease infinite';
  }
}

// ---------------------------------------------------------------------------
// 1. DEFAULT -- friendly circle bot
// ---------------------------------------------------------------------------

export const DefaultAvatar: React.FC<BuddyAvatarProps> = ({
  state,
  size = 64,
  color = '#60a5fa',
  activeColor = '#4ade80',
}) => {
  useSharedStyles();
  const fill = stateColor(state, color, activeColor);
  const r = size / 2;
  const eyeR = size * 0.065;
  const eyeY = r * 0.85;
  const eyeSpread = r * 0.32;

  // Mouth shape changes with state
  const mouthY = r * 1.18;
  let mouth: React.ReactNode;
  if (state === 'error') {
    // Frown
    mouth = (
      <path
        d={`M ${r - size * 0.12} ${mouthY + size * 0.04} Q ${r} ${mouthY - size * 0.04} ${r + size * 0.12} ${mouthY + size * 0.04}`}
        fill="none"
        stroke="#0a0a0f"
        strokeWidth={size * 0.04}
        strokeLinecap="round"
      />
    );
  } else if (state === 'working') {
    // Open mouth (excited)
    mouth = (
      <ellipse
        cx={r}
        cy={mouthY}
        rx={size * 0.08}
        ry={size * 0.06}
        fill="#0a0a0f"
      />
    );
  } else {
    // Smile
    mouth = (
      <path
        d={`M ${r - size * 0.1} ${mouthY} Q ${r} ${mouthY + size * 0.08} ${r + size * 0.1} ${mouthY}`}
        fill="none"
        stroke="#0a0a0f"
        strokeWidth={size * 0.035}
        strokeLinecap="round"
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ animation: animForState(state), transformOrigin: 'center center' }}
    >
      {/* Body */}
      <circle cx={r} cy={r} r={r * 0.82} fill={fill} opacity={0.9} />
      {/* Highlight */}
      <circle cx={r - r * 0.25} cy={r - r * 0.3} r={r * 0.15} fill="#ffffff" opacity={0.3} />

      {/* Eyes */}
      <g style={{ animation: 'ba-blink 4s ease infinite', transformOrigin: `${r}px ${eyeY}px` }}>
        <circle cx={r - eyeSpread} cy={eyeY} r={eyeR} fill="#0a0a0f" />
        <circle cx={r + eyeSpread} cy={eyeY} r={eyeR} fill="#0a0a0f" />
      </g>

      {/* Mouth */}
      {mouth}

      {/* Antenna */}
      <line
        x1={r}
        y1={r * 0.2}
        x2={r}
        y2={r * 0.05}
        stroke={fill}
        strokeWidth={size * 0.035}
        strokeLinecap="round"
      />
      <circle cx={r} cy={r * 0.03} r={size * 0.04} fill={fill} opacity={state === 'thinking' ? 0.5 : 1}>
        {state === 'thinking' && (
          <animate attributeName="opacity" values="1;0.3;1" dur="0.8s" repeatCount="indefinite" />
        )}
      </circle>
    </svg>
  );
};

// ---------------------------------------------------------------------------
// 2. PIXEL -- retro 8-bit robot
// ---------------------------------------------------------------------------

export const PixelAvatar: React.FC<BuddyAvatarProps> = ({
  state,
  size = 64,
  color = '#60a5fa',
  activeColor = '#4ade80',
}) => {
  useSharedStyles();
  const fill = stateColor(state, color, activeColor);
  const p = size / 16; // pixel unit

  // 16x16 grid robot body
  // Row definitions (y, xStart, xEnd)
  const bodyPixels: [number, number, number][] = [
    // Head top
    [2, 4, 12],
    [3, 3, 13],
    [4, 3, 13],
    [5, 3, 13],
    [6, 3, 13],
    [7, 3, 13],
    // Neck
    [8, 6, 10],
    // Body
    [9, 4, 12],
    [10, 4, 12],
    [11, 4, 12],
    [12, 4, 12],
    // Legs
    [13, 4, 7],
    [13, 9, 12],
    [14, 4, 7],
    [14, 9, 12],
  ];

  // Eye positions (change with state)
  const eyeColor = '#0a0a0f';
  const leftEyeX = state === 'working' ? 5 : 5;
  const rightEyeX = state === 'working' ? 10 : 10;
  const eyeY = 5;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        animation: animForState(state),
        transformOrigin: 'center center',
        imageRendering: 'pixelated',
      }}
    >
      {/* Body pixels */}
      {bodyPixels.map(([y, x1, x2]) =>
        Array.from({ length: x2 - x1 }, (_, i) => (
          <rect
            key={`${y}-${x1 + i}`}
            x={(x1 + i) * p}
            y={y * p}
            width={p}
            height={p}
            fill={fill}
            opacity={0.9}
          />
        )),
      )}

      {/* Antenna */}
      <rect x={7 * p} y={0 * p} width={p * 2} height={p} fill={fill} />
      <rect x={7.5 * p} y={1 * p} width={p} height={p} fill={fill} />

      {/* Eyes */}
      <rect x={leftEyeX * p} y={eyeY * p} width={p * 2} height={p} fill={eyeColor} />
      <rect x={rightEyeX * p} y={eyeY * p} width={p * 2} height={p} fill={eyeColor} />

      {/* Mouth -- varies by state */}
      {state === 'error' ? (
        // X mouth
        <>
          <rect x={6 * p} y={6.5 * p} width={p} height={p * 0.8} fill={eyeColor} />
          <rect x={7 * p} y={7 * p} width={p} height={p * 0.6} fill={eyeColor} />
          <rect x={8 * p} y={7 * p} width={p} height={p * 0.6} fill={eyeColor} />
          <rect x={9 * p} y={6.5 * p} width={p} height={p * 0.8} fill={eyeColor} />
        </>
      ) : state === 'working' ? (
        // Open square mouth
        <rect x={6 * p} y={6.5 * p} width={p * 4} height={p * 1.5} fill={eyeColor} rx={1} />
      ) : (
        // Line mouth
        <rect x={6 * p} y={6.8 * p} width={p * 4} height={p * 0.6} fill={eyeColor} />
      )}

      {/* Pixel "glow" scanlines when thinking */}
      {state === 'thinking' && (
        <g opacity={0.3}>
          <rect x={3 * p} y={4 * p} width={10 * p} height={p * 0.3} fill="#ffffff">
            <animate attributeName="y" values={`${4 * p};${12 * p};${4 * p}`} dur="1.5s" repeatCount="indefinite" />
          </rect>
        </g>
      )}

      {/* Arms */}
      <rect x={2 * p} y={9.5 * p} width={p * 2} height={p} fill={fill} opacity={0.7} />
      <rect x={12 * p} y={9.5 * p} width={p * 2} height={p} fill={fill} opacity={0.7} />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// 3. CAT -- blinks and twitches ears
// ---------------------------------------------------------------------------

export const CatAvatar: React.FC<BuddyAvatarProps> = ({
  state,
  size = 64,
  color = '#60a5fa',
  activeColor = '#4ade80',
}) => {
  useSharedStyles();
  const fill = stateColor(state, color, activeColor);
  const s = size;
  const cx = s / 2;
  const cy = s / 2 + s * 0.06;

  const earAnim = state === 'idle'
    ? 'ba-ear-twitch-l 5s ease infinite'
    : state === 'thinking'
      ? 'ba-ear-twitch-l 1.5s ease infinite'
      : 'none';
  const earAnimR = state === 'idle'
    ? 'ba-ear-twitch-r 5s ease infinite'
    : state === 'thinking'
      ? 'ba-ear-twitch-r 1.5s ease infinite'
      : 'none';

  const pupilDx = state === 'working' ? s * 0.02 : 0;

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      style={{ animation: animForState(state), transformOrigin: 'center center' }}
    >
      {/* Left ear */}
      <polygon
        points={`${cx - s * 0.28},${cy - s * 0.18} ${cx - s * 0.12},${cy - s * 0.38} ${cx - s * 0.02},${cy - s * 0.18}`}
        fill={fill}
        opacity={0.85}
        style={{
          animation: earAnim,
          transformOrigin: `${cx - s * 0.15}px ${cy - s * 0.18}px`,
        }}
      />
      {/* Right ear */}
      <polygon
        points={`${cx + s * 0.02},${cy - s * 0.18} ${cx + s * 0.12},${cy - s * 0.38} ${cx + s * 0.28},${cy - s * 0.18}`}
        fill={fill}
        opacity={0.85}
        style={{
          animation: earAnimR,
          transformOrigin: `${cx + s * 0.15}px ${cy - s * 0.18}px`,
        }}
      />
      {/* Inner ears */}
      <polygon
        points={`${cx - s * 0.22},${cy - s * 0.17} ${cx - s * 0.12},${cy - s * 0.3} ${cx - s * 0.05},${cy - s * 0.17}`}
        fill={fill}
        opacity={0.4}
        style={{
          animation: earAnim,
          transformOrigin: `${cx - s * 0.15}px ${cy - s * 0.18}px`,
        }}
      />
      <polygon
        points={`${cx + s * 0.05},${cy - s * 0.17} ${cx + s * 0.12},${cy - s * 0.3} ${cx + s * 0.22},${cy - s * 0.17}`}
        fill={fill}
        opacity={0.4}
        style={{
          animation: earAnimR,
          transformOrigin: `${cx + s * 0.15}px ${cy - s * 0.18}px`,
        }}
      />

      {/* Head */}
      <ellipse cx={cx} cy={cy} rx={s * 0.36} ry={s * 0.32} fill={fill} opacity={0.9} />

      {/* Highlight */}
      <ellipse cx={cx - s * 0.12} cy={cy - s * 0.14} rx={s * 0.08} ry={s * 0.06} fill="#ffffff" opacity={0.2} />

      {/* Eyes */}
      <g style={{ animation: 'ba-blink 3.5s ease infinite', transformOrigin: `${cx}px ${cy - s * 0.04}px` }}>
        {/* Eye whites (slitted shape) */}
        <ellipse cx={cx - s * 0.13 + pupilDx} cy={cy - s * 0.04} rx={s * 0.07} ry={s * 0.06} fill="#0a0a0f" />
        <ellipse cx={cx + s * 0.13 + pupilDx} cy={cy - s * 0.04} rx={s * 0.07} ry={s * 0.06} fill="#0a0a0f" />
        {/* Pupils */}
        <ellipse cx={cx - s * 0.13 + pupilDx} cy={cy - s * 0.04} rx={s * 0.03} ry={s * 0.055} fill="#1e293b" />
        <ellipse cx={cx + s * 0.13 + pupilDx} cy={cy - s * 0.04} rx={s * 0.03} ry={s * 0.055} fill="#1e293b" />
        {/* Glints */}
        <circle cx={cx - s * 0.11 + pupilDx} cy={cy - s * 0.06} r={s * 0.015} fill="#ffffff" opacity={0.7} />
        <circle cx={cx + s * 0.15 + pupilDx} cy={cy - s * 0.06} r={s * 0.015} fill="#ffffff" opacity={0.7} />
      </g>

      {/* Nose */}
      <polygon
        points={`${cx},${cy + s * 0.04} ${cx - s * 0.025},${cy + s * 0.065} ${cx + s * 0.025},${cy + s * 0.065}`}
        fill="#0a0a0f"
        opacity={0.7}
      />

      {/* Mouth */}
      {state === 'error' ? (
        <path
          d={`M ${cx - s * 0.08} ${cy + s * 0.13} Q ${cx} ${cy + s * 0.08} ${cx + s * 0.08} ${cy + s * 0.13}`}
          fill="none"
          stroke="#0a0a0f"
          strokeWidth={s * 0.02}
          strokeLinecap="round"
        />
      ) : (
        <>
          <path
            d={`M ${cx} ${cy + s * 0.065} L ${cx - s * 0.06} ${cy + s * 0.11}`}
            fill="none"
            stroke="#0a0a0f"
            strokeWidth={s * 0.018}
            strokeLinecap="round"
          />
          <path
            d={`M ${cx} ${cy + s * 0.065} L ${cx + s * 0.06} ${cy + s * 0.11}`}
            fill="none"
            stroke="#0a0a0f"
            strokeWidth={s * 0.018}
            strokeLinecap="round"
          />
        </>
      )}

      {/* Whiskers */}
      <g opacity={0.4}>
        <line x1={cx - s * 0.15} y1={cy + s * 0.04} x2={cx - s * 0.38} y2={cy + s * 0.01} stroke={fill} strokeWidth={s * 0.012} />
        <line x1={cx - s * 0.15} y1={cy + s * 0.07} x2={cx - s * 0.38} y2={cy + s * 0.08} stroke={fill} strokeWidth={s * 0.012} />
        <line x1={cx + s * 0.15} y1={cy + s * 0.04} x2={cx + s * 0.38} y2={cy + s * 0.01} stroke={fill} strokeWidth={s * 0.012} />
        <line x1={cx + s * 0.15} y1={cy + s * 0.07} x2={cx + s * 0.38} y2={cy + s * 0.08} stroke={fill} strokeWidth={s * 0.012} />
      </g>

      {/* Tail (bottom right) */}
      <path
        d={`M ${cx + s * 0.3} ${cy + s * 0.28} Q ${cx + s * 0.42} ${cy + s * 0.15} ${cx + s * 0.38} ${cy + s * 0.35}`}
        fill="none"
        stroke={fill}
        strokeWidth={s * 0.04}
        strokeLinecap="round"
        opacity={0.6}
        style={{
          animation: 'ba-tail-sway 2s ease infinite',
          transformOrigin: `${cx + s * 0.3}px ${cy + s * 0.28}px`,
        }}
      />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// 4. GHOST -- cute floating ghost
// ---------------------------------------------------------------------------

export const GhostAvatar: React.FC<BuddyAvatarProps> = ({
  state,
  size = 64,
  color = '#60a5fa',
  activeColor = '#4ade80',
}) => {
  useSharedStyles();
  const fill = stateColor(state, color, activeColor);
  const s = size;
  const cx = s / 2;

  const floatAnim = state === 'error'
    ? 'ba-shake 0.4s ease infinite'
    : state === 'working'
      ? 'ba-bounce 0.5s ease infinite'
      : state === 'thinking'
        ? 'ba-ghost-float 2s ease infinite'
        : 'ba-ghost-float 4s ease infinite';

  // Ghost body path: rounded top, wavy bottom
  const topY = s * 0.12;
  const botY = s * 0.82;
  const w = s * 0.36;
  const waveH = s * 0.06;

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      style={{ animation: floatAnim, transformOrigin: 'center center' }}
    >
      {/* Ghost body */}
      <path
        d={`
          M ${cx - w} ${s * 0.45}
          Q ${cx - w} ${topY} ${cx} ${topY}
          Q ${cx + w} ${topY} ${cx + w} ${s * 0.45}
          L ${cx + w} ${botY}
          Q ${cx + w * 0.65} ${botY - waveH} ${cx + w * 0.33} ${botY}
          Q ${cx} ${botY + waveH} ${cx - w * 0.33} ${botY}
          Q ${cx - w * 0.65} ${botY - waveH} ${cx - w} ${botY}
          Z
        `}
        fill={fill}
        opacity={0.85}
      />

      {/* Translucent overlay for ghostly feel */}
      <path
        d={`
          M ${cx - w + s * 0.04} ${s * 0.48}
          Q ${cx - w + s * 0.04} ${topY + s * 0.05} ${cx} ${topY + s * 0.05}
          Q ${cx + w - s * 0.04} ${topY + s * 0.05} ${cx + w - s * 0.04} ${s * 0.48}
          L ${cx + w - s * 0.04} ${s * 0.38}
          Z
        `}
        fill="#ffffff"
        opacity={0.15}
      />

      {/* Eyes */}
      <g style={{ animation: 'ba-blink 4.5s ease infinite', transformOrigin: `${cx}px ${s * 0.38}px` }}>
        <ellipse cx={cx - s * 0.1} cy={s * 0.38} rx={s * 0.055} ry={s * 0.065} fill="#0a0a0f" />
        <ellipse cx={cx + s * 0.1} cy={s * 0.38} rx={s * 0.055} ry={s * 0.065} fill="#0a0a0f" />
        {/* Glints */}
        <circle cx={cx - s * 0.08} cy={s * 0.36} r={s * 0.02} fill="#ffffff" opacity={0.5} />
        <circle cx={cx + s * 0.12} cy={s * 0.36} r={s * 0.02} fill="#ffffff" opacity={0.5} />
      </g>

      {/* Mouth */}
      {state === 'error' ? (
        <ellipse cx={cx} cy={s * 0.52} rx={s * 0.06} ry={s * 0.05} fill="#0a0a0f" opacity={0.7} />
      ) : state === 'working' ? (
        <ellipse cx={cx} cy={s * 0.5} rx={s * 0.04} ry={s * 0.035} fill="#0a0a0f" opacity={0.5} />
      ) : (
        <path
          d={`M ${cx - s * 0.05} ${s * 0.49} Q ${cx} ${s * 0.54} ${cx + s * 0.05} ${s * 0.49}`}
          fill="none"
          stroke="#0a0a0f"
          strokeWidth={s * 0.02}
          strokeLinecap="round"
          opacity={0.6}
        />
      )}

      {/* Blush spots */}
      <circle cx={cx - s * 0.16} cy={s * 0.46} r={s * 0.035} fill={fill} opacity={0.3} />
      <circle cx={cx + s * 0.16} cy={s * 0.46} r={s * 0.035} fill={fill} opacity={0.3} />

      {/* Sparkle particles when thinking */}
      {state === 'thinking' && (
        <g opacity={0.6}>
          <circle cx={cx - s * 0.25} cy={s * 0.25} r={s * 0.015} fill="#ffffff">
            <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0s" />
          </circle>
          <circle cx={cx + s * 0.2} cy={s * 0.15} r={s * 0.012} fill="#ffffff">
            <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="0.5s" />
          </circle>
          <circle cx={cx + s * 0.28} cy={s * 0.35} r={s * 0.01} fill="#ffffff">
            <animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" begin="1s" />
          </circle>
        </g>
      )}
    </svg>
  );
};

// ---------------------------------------------------------------------------
// 5. CUBE -- isometric 3D cube with a face
// ---------------------------------------------------------------------------

export const CubeAvatar: React.FC<BuddyAvatarProps> = ({
  state,
  size = 64,
  color = '#60a5fa',
  activeColor = '#4ade80',
}) => {
  useSharedStyles();
  const fill = stateColor(state, color, activeColor);
  const s = size;
  const cx = s / 2;
  const cy = s / 2;

  // Isometric cube vertices
  const hw = s * 0.3;  // half-width
  const hh = s * 0.18; // half-height (vertical squeeze for iso)
  const depth = s * 0.22;

  // Top face
  const topFace = `${cx},${cy - depth - hh} ${cx + hw},${cy - depth} ${cx},${cy - depth + hh} ${cx - hw},${cy - depth}`;
  // Front-left face
  const leftFace = `${cx - hw},${cy - depth} ${cx},${cy - depth + hh} ${cx},${cy + hh} ${cx - hw},${cy}`;
  // Front-right face
  const rightFace = `${cx + hw},${cy - depth} ${cx},${cy - depth + hh} ${cx},${cy + hh} ${cx + hw},${cy}`;

  const cubeAnim = state === 'error'
    ? 'ba-shake 0.4s ease infinite'
    : state === 'working'
      ? 'ba-wiggle 0.5s ease infinite'
      : state === 'thinking'
        ? 'ba-cube-tilt 2s ease infinite'
        : 'ba-breathe 3s ease infinite';

  // Face is on the front-right panel
  const faceX = cx + s * 0.04;
  const faceY = cy - depth * 0.3;

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      style={{ animation: cubeAnim, transformOrigin: 'center center' }}
    >
      {/* Shadow */}
      <ellipse cx={cx} cy={cy + hh + s * 0.08} rx={hw * 0.7} ry={s * 0.04} fill="#000000" opacity={0.15} />

      {/* Left face (darker) */}
      <polygon points={leftFace} fill={fill} opacity={0.55} />
      {/* Right face (medium) */}
      <polygon points={rightFace} fill={fill} opacity={0.75} />
      {/* Top face (lightest) */}
      <polygon points={topFace} fill={fill} opacity={0.95} />

      {/* Edges */}
      <polygon points={topFace} fill="none" stroke={fill} strokeWidth={s * 0.015} opacity={0.4} />
      <polygon points={leftFace} fill="none" stroke={fill} strokeWidth={s * 0.012} opacity={0.3} />
      <polygon points={rightFace} fill="none" stroke={fill} strokeWidth={s * 0.012} opacity={0.3} />

      {/* Face on right panel */}
      {/* Eyes */}
      <g style={{ animation: 'ba-blink 4s ease infinite', transformOrigin: `${faceX}px ${faceY - s * 0.02}px` }}>
        <circle cx={faceX - s * 0.06} cy={faceY - s * 0.02} r={s * 0.028} fill="#0a0a0f" />
        <circle cx={faceX + s * 0.06} cy={faceY - s * 0.02} r={s * 0.028} fill="#0a0a0f" />
      </g>

      {/* Mouth */}
      {state === 'error' ? (
        <line
          x1={faceX - s * 0.05}
          y1={faceY + s * 0.06}
          x2={faceX + s * 0.05}
          y2={faceY + s * 0.06}
          stroke="#0a0a0f"
          strokeWidth={s * 0.025}
          strokeLinecap="round"
        />
      ) : (
        <path
          d={`M ${faceX - s * 0.04} ${faceY + s * 0.04} Q ${faceX} ${faceY + s * 0.08} ${faceX + s * 0.04} ${faceY + s * 0.04}`}
          fill="none"
          stroke="#0a0a0f"
          strokeWidth={s * 0.02}
          strokeLinecap="round"
        />
      )}

      {/* Thinking gear icon on top face */}
      {state === 'thinking' && (
        <g
          style={{
            animation: 'ba-spin 3s linear infinite',
            transformOrigin: `${cx}px ${cy - depth - hh * 0.3}px`,
          }}
        >
          <circle
            cx={cx}
            cy={cy - depth - hh * 0.3}
            r={s * 0.04}
            fill="none"
            stroke="#0a0a0f"
            strokeWidth={s * 0.015}
            opacity={0.5}
          />
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <line
              key={deg}
              x1={cx}
              y1={cy - depth - hh * 0.3 - s * 0.04}
              x2={cx}
              y2={cy - depth - hh * 0.3 - s * 0.055}
              stroke="#0a0a0f"
              strokeWidth={s * 0.012}
              opacity={0.4}
              transform={`rotate(${deg} ${cx} ${cy - depth - hh * 0.3})`}
            />
          ))}
        </g>
      )}
    </svg>
  );
};

// ---------------------------------------------------------------------------
// 6. FLAME -- animated fire spirit
// ---------------------------------------------------------------------------

export const FlameAvatar: React.FC<BuddyAvatarProps> = ({
  state,
  size = 64,
  color = '#60a5fa',
  activeColor = '#4ade80',
}) => {
  useSharedStyles();
  const uid = useUniqueId('flame');
  const fill = stateColor(state, color, activeColor);
  const s = size;
  const cx = s / 2;

  const flameAnim = state === 'error'
    ? 'ba-shake 0.4s ease infinite'
    : state === 'working'
      ? 'ba-flame-dance 0.4s ease infinite'
      : state === 'thinking'
        ? 'ba-flame-dance 0.8s ease infinite'
        : 'ba-flame-dance 2s ease infinite';

  // Derive inner color (brighter/lighter version)
  const innerColor = state === 'error' ? '#fca5a5' : '#ffffff';

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      style={{ animation: flameAnim, transformOrigin: `${cx}px ${s * 0.85}px` }}
    >
      <defs>
        <radialGradient id={`${uid}-grad`} cx="50%" cy="70%" r="50%">
          <stop offset="0%" stopColor={innerColor} stopOpacity={0.9} />
          <stop offset="45%" stopColor={fill} stopOpacity={0.85} />
          <stop offset="100%" stopColor={fill} stopOpacity={0.4} />
        </radialGradient>
        <filter id={`${uid}-glow`}>
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Glow halo */}
      <ellipse cx={cx} cy={s * 0.55} rx={s * 0.28} ry={s * 0.35} fill={fill} opacity={0.08} />

      {/* Outer flame */}
      <path
        d={`
          M ${cx} ${s * 0.08}
          Q ${cx + s * 0.06} ${s * 0.2} ${cx + s * 0.22} ${s * 0.35}
          Q ${cx + s * 0.32} ${s * 0.52} ${cx + s * 0.26} ${s * 0.68}
          Q ${cx + s * 0.2} ${s * 0.82} ${cx} ${s * 0.88}
          Q ${cx - s * 0.2} ${s * 0.82} ${cx - s * 0.26} ${s * 0.68}
          Q ${cx - s * 0.32} ${s * 0.52} ${cx - s * 0.22} ${s * 0.35}
          Q ${cx - s * 0.06} ${s * 0.2} ${cx} ${s * 0.08}
          Z
        `}
        fill={`url(#${uid}-grad)`}
        filter={`url(#${uid}-glow)`}
      />

      {/* Inner flame (brighter core) */}
      <path
        d={`
          M ${cx} ${s * 0.28}
          Q ${cx + s * 0.04} ${s * 0.36} ${cx + s * 0.12} ${s * 0.46}
          Q ${cx + s * 0.16} ${s * 0.58} ${cx + s * 0.1} ${s * 0.7}
          Q ${cx + s * 0.05} ${s * 0.78} ${cx} ${s * 0.82}
          Q ${cx - s * 0.05} ${s * 0.78} ${cx - s * 0.1} ${s * 0.7}
          Q ${cx - s * 0.16} ${s * 0.58} ${cx - s * 0.12} ${s * 0.46}
          Q ${cx - s * 0.04} ${s * 0.36} ${cx} ${s * 0.28}
          Z
        `}
        fill={innerColor}
        opacity={0.3}
      >
        <animate attributeName="opacity" values="0.2;0.45;0.2" dur="1.2s" repeatCount="indefinite" />
      </path>

      {/* Eyes */}
      <g style={{ animation: 'ba-blink 5s ease infinite', transformOrigin: `${cx}px ${s * 0.48}px` }}>
        <ellipse cx={cx - s * 0.08} cy={s * 0.48} rx={s * 0.04} ry={s * 0.05} fill="#0a0a0f" opacity={0.7} />
        <ellipse cx={cx + s * 0.08} cy={s * 0.48} rx={s * 0.04} ry={s * 0.05} fill="#0a0a0f" opacity={0.7} />
        {/* Glints */}
        <circle cx={cx - s * 0.065} cy={s * 0.465} r={s * 0.012} fill="#ffffff" opacity={0.5} />
        <circle cx={cx + s * 0.095} cy={s * 0.465} r={s * 0.012} fill="#ffffff" opacity={0.5} />
      </g>

      {/* Mouth */}
      {state === 'error' ? (
        <path
          d={`M ${cx - s * 0.05} ${s * 0.6} Q ${cx} ${s * 0.56} ${cx + s * 0.05} ${s * 0.6}`}
          fill="none"
          stroke="#0a0a0f"
          strokeWidth={s * 0.018}
          strokeLinecap="round"
          opacity={0.5}
        />
      ) : (
        <path
          d={`M ${cx - s * 0.04} ${s * 0.57} Q ${cx} ${s * 0.62} ${cx + s * 0.04} ${s * 0.57}`}
          fill="none"
          stroke="#0a0a0f"
          strokeWidth={s * 0.018}
          strokeLinecap="round"
          opacity={0.4}
        />
      )}

      {/* Sparks when working */}
      {state === 'working' && (
        <g opacity={0.7}>
          <circle cx={cx - s * 0.2} cy={s * 0.2} r={s * 0.012} fill={fill}>
            <animate attributeName="cy" values={`${s * 0.25};${s * 0.1};${s * 0.25}`} dur="0.6s" repeatCount="indefinite" begin="0s" />
            <animate attributeName="opacity" values="1;0;1" dur="0.6s" repeatCount="indefinite" begin="0s" />
          </circle>
          <circle cx={cx + s * 0.18} cy={s * 0.18} r={s * 0.01} fill={fill}>
            <animate attributeName="cy" values={`${s * 0.22};${s * 0.08};${s * 0.22}`} dur="0.6s" repeatCount="indefinite" begin="0.2s" />
            <animate attributeName="opacity" values="1;0;1" dur="0.6s" repeatCount="indefinite" begin="0.2s" />
          </circle>
          <circle cx={cx + s * 0.05} cy={s * 0.12} r={s * 0.008} fill={fill}>
            <animate attributeName="cy" values={`${s * 0.15};${s * 0.02};${s * 0.15}`} dur="0.6s" repeatCount="indefinite" begin="0.4s" />
            <animate attributeName="opacity" values="1;0;1" dur="0.6s" repeatCount="indefinite" begin="0.4s" />
          </circle>
        </g>
      )}
    </svg>
  );
};

// ---------------------------------------------------------------------------
// 7. Lizard -- a cute gecko with blinking eyes, swaying tail, tongue flick
// ---------------------------------------------------------------------------

const LizardAvatar: React.FC<BuddyAvatarProps> = ({ state, size = 48, color, activeColor }) => {
  const s = size;
  const idle = color ?? '#60a5fa';
  const active = activeColor ?? '#4ade80';
  const fill = colorForState(state, idle, active);
  const anim = animForState(state);
  const cx = s / 2;
  const cy = s / 2;

  // Tail sway speed based on state
  const tailDur = state === 'working' ? '0.4s' : state === 'thinking' ? '0.8s' : '2s';

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ animation: anim, display: 'block' }}>
      {/* Tail -- curving line that sways */}
      <path
        d={`M${cx - s * 0.15} ${cy + s * 0.15} Q${cx - s * 0.35} ${cy + s * 0.25} ${cx - s * 0.4} ${cy + s * 0.1}`}
        fill="none"
        stroke={fill}
        strokeWidth={s * 0.04}
        strokeLinecap="round"
        opacity={0.7}
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          values={`0 ${cx - s * 0.15} ${cy + s * 0.15};-15 ${cx - s * 0.15} ${cy + s * 0.15};15 ${cx - s * 0.15} ${cy + s * 0.15};0 ${cx - s * 0.15} ${cy + s * 0.15}`}
          dur={tailDur}
          repeatCount="indefinite"
        />
      </path>

      {/* Body -- rounded oval */}
      <ellipse cx={cx} cy={cy + s * 0.05} rx={s * 0.22} ry={s * 0.18} fill={fill} opacity={0.9} />

      {/* Head -- slightly larger circle on top */}
      <circle cx={cx} cy={cy - s * 0.12} r={s * 0.16} fill={fill} />

      {/* Snout bump */}
      <ellipse cx={cx} cy={cy - s * 0.22} rx={s * 0.1} ry={s * 0.06} fill={fill} />

      {/* Eyes -- large and friendly with vertical slit pupils */}
      <circle cx={cx - s * 0.08} cy={cy - s * 0.15} r={s * 0.055} fill="#1a1a24" />
      <circle cx={cx + s * 0.08} cy={cy - s * 0.15} r={s * 0.055} fill="#1a1a24" />
      {/* Pupils -- vertical slits */}
      <ellipse cx={cx - s * 0.08} cy={cy - s * 0.15} rx={s * 0.015} ry={s * 0.04} fill={fill}>
        <animateTransform attributeName="transform" type="scale" values="1 1;1 0.1;1 1" dur="3.5s" repeatCount="indefinite" begin="2s" />
      </ellipse>
      <ellipse cx={cx + s * 0.08} cy={cy - s * 0.15} rx={s * 0.015} ry={s * 0.04} fill={fill}>
        <animateTransform attributeName="transform" type="scale" values="1 1;1 0.1;1 1" dur="3.5s" repeatCount="indefinite" begin="2s" />
      </ellipse>
      {/* Eye glints */}
      <circle cx={cx - s * 0.065} cy={cy - s * 0.165} r={s * 0.012} fill="#ffffff" opacity={0.6} />
      <circle cx={cx + s * 0.095} cy={cy - s * 0.165} r={s * 0.012} fill="#ffffff" opacity={0.6} />

      {/* Nostrils */}
      <circle cx={cx - s * 0.03} cy={cy - s * 0.24} r={s * 0.008} fill="#1a1a24" opacity={0.4} />
      <circle cx={cx + s * 0.03} cy={cy - s * 0.24} r={s * 0.008} fill="#1a1a24" opacity={0.4} />

      {/* Smile line */}
      <path
        d={`M${cx - s * 0.05} ${cy - s * 0.08} Q${cx} ${cy - s * 0.04} ${cx + s * 0.05} ${cy - s * 0.08}`}
        fill="none"
        stroke="#1a1a24"
        strokeWidth={s * 0.012}
        strokeLinecap="round"
        opacity={0.3}
      />

      {/* Front legs */}
      <line x1={cx - s * 0.15} y1={cy + s * 0.05} x2={cx - s * 0.28} y2={cy + s * 0.18}
        stroke={fill} strokeWidth={s * 0.035} strokeLinecap="round" opacity={0.8} />
      <line x1={cx + s * 0.15} y1={cy + s * 0.05} x2={cx + s * 0.28} y2={cy + s * 0.18}
        stroke={fill} strokeWidth={s * 0.035} strokeLinecap="round" opacity={0.8} />

      {/* Back legs */}
      <line x1={cx - s * 0.12} y1={cy + s * 0.18} x2={cx - s * 0.25} y2={cy + s * 0.3}
        stroke={fill} strokeWidth={s * 0.035} strokeLinecap="round" opacity={0.8} />
      <line x1={cx + s * 0.12} y1={cy + s * 0.18} x2={cx + s * 0.25} y2={cy + s * 0.3}
        stroke={fill} strokeWidth={s * 0.035} strokeLinecap="round" opacity={0.8} />

      {/* Tiny toes */}
      {[[-0.28, 0.18], [0.28, 0.18], [-0.25, 0.3], [0.25, 0.3]].map(([ox, oy], i) => (
        <g key={i}>
          <circle cx={cx + s * ox - s * 0.015} cy={cy + s * oy} r={s * 0.008} fill={fill} opacity={0.7} />
          <circle cx={cx + s * ox + s * 0.015} cy={cy + s * oy} r={s * 0.008} fill={fill} opacity={0.7} />
          <circle cx={cx + s * ox} cy={cy + s * oy + s * 0.012} r={s * 0.008} fill={fill} opacity={0.7} />
        </g>
      ))}

      {/* Tongue flick -- appears when thinking/working */}
      {(state === 'thinking' || state === 'working') && (
        <line
          x1={cx} y1={cy - s * 0.06}
          x2={cx} y2={cy - s * 0.02}
          stroke="#f87171" strokeWidth={s * 0.015} strokeLinecap="round"
        >
          <animate attributeName="y2" values={`${cy - s * 0.02};${cy + s * 0.06};${cy - s * 0.02}`}
            dur="0.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;1;1;0" dur="0.6s" repeatCount="indefinite" />
        </line>
      )}

      {/* Dorsal spots/scales */}
      <circle cx={cx - s * 0.05} cy={cy - s * 0.02} r={s * 0.018} fill={fill} opacity={0.4} />
      <circle cx={cx + s * 0.06} cy={cy + s * 0.02} r={s * 0.015} fill={fill} opacity={0.4} />
      <circle cx={cx - s * 0.02} cy={cy + s * 0.1} r={s * 0.012} fill={fill} opacity={0.4} />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Avatar registry
// ---------------------------------------------------------------------------

export const BUDDY_AVATARS: AvatarEntry[] = [
  { id: 'default', name: 'Bot',    component: DefaultAvatar },
  { id: 'pixel',   name: 'Pixel',  component: PixelAvatar },
  { id: 'cat',     name: 'Cat',    component: CatAvatar },
  { id: 'ghost',   name: 'Ghost',  component: GhostAvatar },
  { id: 'cube',    name: 'Cube',   component: CubeAvatar },
  { id: 'flame',   name: 'Flame',  component: FlameAvatar },
  { id: 'lizard',  name: 'Lizard', component: LizardAvatar },
];

export function getAvatarById(id: AvatarId): AvatarEntry {
  return BUDDY_AVATARS.find((a) => a.id === id) ?? BUDDY_AVATARS[0];
}

export function getSavedAvatarId(): AvatarId {
  try {
    const stored = localStorage.getItem('hw-buddy-avatar');
    if (stored && BUDDY_AVATARS.some((a) => a.id === stored)) {
      return stored as AvatarId;
    }
  } catch {
    /* ignore */
  }
  return 'default';
}

export function saveAvatarId(id: AvatarId): void {
  try {
    localStorage.setItem('hw-buddy-avatar', id);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// AvatarPicker -- thumbnail grid for selecting an avatar
// ---------------------------------------------------------------------------

export function AvatarPicker({
  selected,
  onSelect,
  previewState = 'idle',
}: {
  selected: AvatarId;
  onSelect: (id: AvatarId) => void;
  previewState?: BuddyState;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {BUDDY_AVATARS.map((entry) => {
        const Comp = entry.component;
        const isActive = entry.id === selected;
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              saveAvatarId(entry.id);
              onSelect(entry.id);
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              padding: '8px',
              border: isActive ? '2px solid currentColor' : '2px solid transparent',
              borderRadius: '8px',
              background: isActive ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
              cursor: 'pointer',
              transition: 'background 0.15s ease, border-color 0.15s ease',
              color: 'inherit',
              opacity: isActive ? 1 : 0.65,
            }}
            title={entry.name}
          >
            <Comp state={previewState} size={40} />
            <span
              style={{
                fontSize: '10px',
                fontFamily: '"Courier New", monospace',
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
              }}
            >
              {entry.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
