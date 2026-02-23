import type { CSSProperties } from 'react';

interface AgentBuddyProps {
  id: string;
  name: string;
  color: string;
  status: 'idle' | 'thinking' | 'responding';
  currentThought: string;
  isGolden?: boolean;  // Claude's special appearance
}

const ANIMATIONS = {
  idle:       'buddy-bob 3.5s ease infinite',
  thinking:   'buddy-twitch 0.45s ease infinite',
  responding: 'buddy-bob 0.7s ease infinite',
};

export function AgentBuddy({ name, color, status, currentThought, isGolden = false }: AgentBuddyProps) {
  const eyeColor = isGolden ? '#fbbf24' : color;
  const size     = isGolden ? 52 : 40;
  const borderW  = isGolden ? 2.5 : 2;

  const headStyle: CSSProperties = {
    width:  size,
    height: size,
    borderRadius: '50%',
    background: '#0f0f18',
    border: `${borderW}px solid ${eyeColor}40`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: ANIMATIONS[status],
    flexShrink: 0,
    boxShadow: isGolden ? `0 0 12px ${eyeColor}40` : undefined,
  };

  const hasThought = currentThought.trim().length > 0;
  const displayThought = currentThought.length > 55
    ? currentThought.slice(-55) + '...'
    : currentThought;

  return (
    <div className="flex flex-col items-center gap-1" style={{ minWidth: 64 }}>
      {/* Speech bubble — above head */}
      <div
        className="text-[9px] font-mono text-center px-1.5 py-0.5 rounded max-w-[80px] transition-all duration-200"
        style={{
          color: eyeColor,
          background: `${eyeColor}12`,
          border: `1px solid ${eyeColor}25`,
          minHeight: 18,
          opacity: hasThought ? 1 : 0.2,
          wordBreak: 'break-word',
          lineHeight: '1.3',
        }}
      >
        {hasThought ? displayThought : (status === 'idle' ? '...' : '')}
      </div>

      {/* Head */}
      <div style={headStyle}>
        <div className="flex gap-[4px] items-center">
          {[0, 140].map((delay) => (
            <div
              key={delay}
              style={{
                width: isGolden ? 6 : 5,
                height: isGolden ? 6 : 5,
                borderRadius: '50%',
                backgroundColor: eyeColor,
                animation: `buddy-blink 4.2s ease infinite ${delay}ms`,
                filter: status !== 'idle' ? `drop-shadow(0 0 2px ${eyeColor})` : undefined,
              }}
            />
          ))}
        </div>
      </div>

      {/* Name */}
      <div
        className="text-[9px] font-mono tracking-wide text-center truncate max-w-[72px]"
        style={{ color: isGolden ? '#fbbf24' : '#9ca3af' }}
      >
        {isGolden ? '✦ ' : ''}{name}
      </div>

      {/* Status dot */}
      <div
        className="w-1 h-1 rounded-full"
        style={{
          backgroundColor:
            status === 'thinking'   ? '#fb923c' :
            status === 'responding' ? eyeColor   :
            '#374151',
          animation:
            status === 'thinking'   ? 'dot-pulse 0.8s ease infinite' :
            status === 'responding' ? 'glow-pulse 1s ease infinite' :
            'none',
        }}
      />
    </div>
  );
}
