import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useProjectPath } from '../hooks/useProjectPath.js';

interface ChatAgent {
  id: string;
  name: string;
  color: string;
  status: 'idle' | 'thinking' | 'responding';
  currentThought: string;
}

interface ChatMessage {
  id: string;
  agentId: string;
  text: string;
  timestamp: string;
  type: 'message' | 'thinking' | 'system' | 'pat' | 'claude';
}

interface ChatSession {
  id: string;
  topic: string;
  status: 'idle' | 'active' | 'paused' | 'concluded';
  startedAt: string;
  startedBy: 'claude' | 'pat';
  waitingForInput: boolean;
  roundNumber: number;
  pendingPatMessage?: string;
  deliberationPhase?: 'frame' | 'deliberate' | 'synthesis' | 'patinput' | 'decision';
}

interface ChatroomState {
  session: ChatSession;
  agents: ChatAgent[];
  messages: ChatMessage[];
}

interface Position { x: number; y: number; }

const PHASE_COLORS: Record<string, string> = {
  frame:      '#818cf8',
  deliberate: '#4ade80',
  synthesis:  '#fb923c',
  patinput:   '#facc15',
  decision:   '#f472b6',
};

const MIN_DIST = 22; // minimum % distance between agent centers
const BOUNDS = { xMin: 4, xMax: 88, yMin: 8, yMax: 68 };

function agentColor(agentId: string, agents: ChatAgent[]): string {
  if (agentId === 'claude') return '#fbbf24';
  if (agentId === 'pat')    return '#94a3b8';
  if (agentId === 'system') return '#374151';
  return agents.find(a => a.id === agentId)?.color ?? '#6b7280';
}

function agentDisplayName(agentId: string, agents: ChatAgent[]): string {
  if (agentId === 'claude') return 'Claude';
  if (agentId === 'pat')    return 'Pat';
  return agents.find(a => a.id === agentId)?.name ?? agentId;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ''; }
}

function seedPosition(index: number, total: number): Position {
  // Spread agents across the space in a grid-ish pattern
  const cols = Math.ceil(Math.sqrt(total));
  const col = index % cols;
  const row = Math.floor(index / cols);
  const xSpan = BOUNDS.xMax - BOUNDS.xMin - 10;
  const ySpan = BOUNDS.yMax - BOUNDS.yMin - 10;
  return {
    x: BOUNDS.xMin + 5 + (col / Math.max(cols - 1, 1)) * xSpan,
    y: BOUNDS.yMin + 5 + (row / Math.max(Math.ceil(total / cols) - 1, 1)) * ySpan,
  };
}

// Push agents apart until no pair is closer than MIN_DIST
function resolveCollisions(pos: Record<string, Position>): Record<string, Position> {
  const result = { ...pos };
  const ids = Object.keys(result);
  for (let iter = 0; iter < 5; iter++) {
    let anyOverlap = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = result[ids[i]];
        const b = result[ids[j]];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_DIST && dist > 0.01) {
          anyOverlap = true;
          const push = (MIN_DIST - dist) / 2 + 0.5;
          const nx = dx / dist;
          const ny = dy / dist;
          result[ids[i]] = {
            x: Math.max(BOUNDS.xMin, Math.min(BOUNDS.xMax, a.x - nx * push)),
            y: Math.max(BOUNDS.yMin, Math.min(BOUNDS.yMax, a.y - ny * push)),
          };
          result[ids[j]] = {
            x: Math.max(BOUNDS.xMin, Math.min(BOUNDS.xMax, b.x + nx * push)),
            y: Math.max(BOUNDS.yMin, Math.min(BOUNDS.yMax, b.y + ny * push)),
          };
        }
      }
    }
    if (!anyOverlap) break;
  }
  return result;
}

export function ChatroomPanel() {
  const projectPath = useProjectPath();
  const [state, setState] = useState<ChatroomState | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [inputText, setInputText] = useState('');
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const logEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchState = useCallback(async () => {
    if (!projectPath) return;
    try {
      const raw = await invoke<string>('get_chatroom', { projectPath });
      setState(JSON.parse(raw) as ChatroomState);
    } catch {
      setState(null);
    }
  }, [projectPath]);

  useEffect(() => { fetchState(); }, [fetchState]);

  useEffect(() => {
    if (!projectPath) return;
    const unlisten = listen<string[]>('hw-files-changed', (event) => {
      if (event.payload.includes('chatroom.json')) fetchState();
    });
    return () => { unlisten.then(fn => fn()); };
  }, [projectPath, fetchState]);

  // Initialize positions when agent list changes
  useEffect(() => {
    if (!state?.agents) return;
    const allIds = [...state.agents.map(a => a.id), 'claude'];
    setPositions(prev => {
      const next = { ...prev };
      let changed = false;
      allIds.forEach((id, i) => {
        if (!next[id]) {
          next[id] = seedPosition(i, allIds.length);
          changed = true;
        }
      });
      if (!changed) return prev;
      return resolveCollisions(next);
    });
  }, [state?.agents.length]);

  // Wander + collision resolve every 4s
  useEffect(() => {
    if (!state || state.session.status === 'idle') return;
    const interval = setInterval(() => {
      setPositions(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(id => {
          const dx = (Math.random() - 0.5) * 12;
          const dy = (Math.random() - 0.5) * 9;
          next[id] = {
            x: Math.max(BOUNDS.xMin, Math.min(BOUNDS.xMax, next[id].x + dx)),
            y: Math.max(BOUNDS.yMin, Math.min(BOUNDS.yMax, next[id].y + dy)),
          };
        });
        return resolveCollisions(next);
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [state?.session.status]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state?.messages.length]);

  useEffect(() => {
    if (state?.session.waitingForInput) setTimeout(() => inputRef.current?.focus(), 100);
  }, [state?.session.waitingForInput]);

  const submitPatMessage = async () => {
    if (!inputText.trim() || !projectPath) return;
    const msg = inputText.trim();
    setInputText('');
    try {
      await invoke('post_pat_chatroom_message', { projectPath, message: msg });
    } catch { /* no-op */ }
  };

  const isActive = state?.session.status === 'active' || state?.session.status === 'paused';

  if (!isActive && !state?.messages.length) {
    return (
      <div className="h-8 flex items-center gap-2 px-3 border-t border-gray-800/50 bg-[#09090f] shrink-0">
        <span className="text-[9px] font-mono text-gray-700 uppercase tracking-widest">Deliberation</span>
        <span className="text-[9px] text-gray-700">— idle. Start with hw_start_deliberation()</span>
      </div>
    );
  }

  const phase = state?.session.deliberationPhase;
  const phaseColor = phase ? (PHASE_COLORS[phase] ?? '#4b5563') : '#4b5563';

  // Last message per agent
  const lastMsg: Record<string, ChatMessage> = {};
  (state?.messages ?? []).forEach(m => {
    if (m.type !== 'system') lastMsg[m.agentId] = m;
  });

  // All floating buddies (agents + Claude always present)
  const allBuddies = [
    ...(state?.agents ?? []),
    { id: 'claude', name: 'Claude', color: '#fbbf24', status: 'idle' as const, currentThought: '' },
  ];

  // Chat log messages (non-system, non-thinking)
  const logMessages = (state?.messages ?? []).filter(m => m.type !== 'system' && m.type !== 'thinking');

  return (
    <>
      <style>{`
        @keyframes buddy-blink {
          0%, 88%, 100% { transform: scaleY(1); }
          93%            { transform: scaleY(0.08); }
        }
        @keyframes buddy-bob {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-2px); }
        }
        @keyframes buddy-twitch {
          0%, 100% { transform: translate(0,0); }
          20%       { transform: translate(-1px,-1px); }
          40%       { transform: translate(1px,1px); }
          60%       { transform: translate(-1px,0); }
          80%       { transform: translate(1px,-1px); }
        }
        @keyframes bubble-pop {
          from { opacity: 0; transform: translateY(3px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div
        className="shrink-0 border-t border-gray-800/60 bg-[#09090f] flex flex-col"
        style={{ height: collapsed ? 32 : 380 }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 h-8 shrink-0 border-b border-gray-800/40">
          <button
            onClick={() => setCollapsed(c => !c)}
            className="text-[9px] font-mono text-gray-600 hover:text-gray-400 uppercase tracking-widest"
          >
            {collapsed ? '▲' : '▼'} Deliberation
          </button>

          {state?.session.topic && (
            <>
              <div className="h-3 w-px bg-gray-800" />
              <span className="text-[9px] text-gray-600 font-mono truncate max-w-[200px]">
                {state.session.topic}
              </span>
            </>
          )}

          {phase && (
            <>
              <div className="h-3 w-px bg-gray-800" />
              <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: phaseColor }}>
                {phase}
              </span>
            </>
          )}

          <div className="h-3 w-px bg-gray-800" />
          <span
            className="text-[9px] font-mono"
            style={{
              color: state?.session.status === 'active'    ? '#4ade80' :
                     state?.session.status === 'paused'    ? '#facc15' :
                     state?.session.status === 'concluded' ? '#818cf8' : '#4b5563',
            }}
          >
            {state?.session.status ?? 'idle'}
          </span>

          {state?.session.waitingForInput && (
            <>
              <div className="h-3 w-px bg-gray-800" />
              <span className="text-[9px] text-amber-400 font-mono animate-pulse">your turn</span>
            </>
          )}
        </div>

        {!collapsed && (
          <div className="flex flex-1 min-h-0">

            {/* In-game chat log — left side */}
            <div
              className="shrink-0 flex flex-col border-r border-gray-800/50"
              style={{ width: 220, background: 'rgba(4, 4, 14, 0.92)' }}
            >
              {/* Chat log header */}
              <div
                className="px-2 py-1 border-b flex items-center gap-1.5 shrink-0"
                style={{ borderColor: '#ffffff08' }}
              >
                <div className="w-1 h-1 rounded-full" style={{ background: '#4ade8060' }} />
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#2d4a3a', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  All
                </span>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-2">
                {logMessages.length === 0 && (
                  <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#1f1f2e' }}>no messages yet</span>
                )}
                {logMessages.map(msg => {
                  const color = agentColor(msg.agentId, state?.agents ?? []);
                  const name  = agentDisplayName(msg.agentId, state?.agents ?? []);
                  const isGolden = msg.agentId === 'claude';
                  return (
                    <div key={msg.id}>
                      <div className="flex items-baseline gap-1 mb-0.5">
                        <span style={{
                          fontSize: 8,
                          fontFamily: 'monospace',
                          color,
                          fontWeight: isGolden ? 'bold' : 'normal',
                          flexShrink: 0,
                        }}>
                          {isGolden ? '✦ ' : ''}{name}
                        </span>
                        <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#1a1a2e' }}>
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>
                      <span style={{
                        fontSize: 8,
                        fontFamily: 'monospace',
                        color: '#434360',
                        lineHeight: 1.45,
                        display: 'block',
                      }}>
                        {msg.text}
                      </span>
                    </div>
                  );
                })}
                <div ref={logEndRef} />
              </div>

              {/* Pat input */}
              <div
                className="px-2 py-1.5 border-t shrink-0 flex gap-1.5 items-center"
                style={{ borderColor: '#ffffff08' }}
              >
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#94a3b8', flexShrink: 0 }}>
                  Pat:
                </span>
                <input
                  ref={inputRef}
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitPatMessage(); }}
                  placeholder={state?.session.waitingForInput ? 'your turn...' : 'steer...'}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    fontSize: 8,
                    fontFamily: 'monospace',
                    color: '#94a3b8',
                    outline: 'none',
                    border: 'none',
                  }}
                />
              </div>
            </div>

            {/* Floating canvas */}
            <div className="flex-1 relative overflow-hidden" style={{ background: '#05050d' }}>
              {allBuddies.map(agent => {
                const pos = positions[agent.id];
                if (!pos) return null;

                const isGolden = agent.id === 'claude';
                const color    = isGolden ? '#fbbf24' : agent.color;
                const size     = isGolden ? 44 : 34;
                const msg      = lastMsg[agent.id];
                const msgAge   = msg ? Date.now() - new Date(msg.timestamp).getTime() : Infinity;
                // Full message in bubble — no truncation up to 670 chars
                const bubbleTxt = msg?.text ?? null;
                const bubbleOp  = msgAge < 8000 ? 1 : msgAge < 25000 ? 0.65 : 0.2;

                return (
                  <div
                    key={agent.id}
                    style={{
                      position: 'absolute',
                      left: `${pos.x}%`,
                      top: `${pos.y}%`,
                      transform: 'translate(-50%, -50%)',
                      transition: 'left 3s ease, top 3s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 3,
                      zIndex: 10,
                    }}
                  >
                    {/* Speech bubble — full text, no truncation */}
                    {bubbleTxt && (
                      <div
                        style={{
                          maxWidth: 190,
                          padding: '5px 8px',
                          borderRadius: 6,
                          background: `${color}10`,
                          border: `1px solid ${color}25`,
                          color: isGolden ? '#fde68a' : color,
                          fontSize: 8,
                          fontFamily: 'monospace',
                          lineHeight: 1.5,
                          wordBreak: 'break-word',
                          textAlign: 'left',
                          opacity: bubbleOp,
                          animation: 'bubble-pop 0.15s ease',
                          marginBottom: 2,
                          pointerEvents: 'none',
                          // Subtle tail indicator
                          boxShadow: `0 2px 8px ${color}08`,
                        }}
                      >
                        {bubbleTxt}
                      </div>
                    )}

                    {/* Head */}
                    <div
                      style={{
                        width: size,
                        height: size,
                        borderRadius: '50%',
                        background: '#0c0c18',
                        border: `2px solid ${color}35`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        animation: agent.status === 'thinking'
                          ? 'buddy-twitch 0.45s ease infinite'
                          : 'buddy-bob 3.5s ease infinite',
                        boxShadow: isGolden ? `0 0 12px ${color}25` : undefined,
                        flexShrink: 0,
                      }}
                    >
                      <div style={{ display: 'flex', gap: isGolden ? 5 : 4 }}>
                        {[0, 140].map(delay => (
                          <div
                            key={delay}
                            style={{
                              width: isGolden ? 5 : 4,
                              height: isGolden ? 5 : 4,
                              borderRadius: '50%',
                              backgroundColor: color,
                              animation: `buddy-blink 4.2s ease infinite ${delay}ms`,
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Name tag */}
                    <div style={{
                      fontSize: 7,
                      fontFamily: 'monospace',
                      color: isGolden ? '#fbbf2480' : '#ffffff20',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}>
                      {agent.name}
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        )}
      </div>
    </>
  );
}
