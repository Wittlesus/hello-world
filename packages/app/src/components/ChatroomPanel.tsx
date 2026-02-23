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

function agentColor(agentId: string, agents: ChatAgent[]): string {
  if (agentId === 'claude') return '#fbbf24';
  if (agentId === 'pat')    return '#94a3b8';
  if (agentId === 'system') return '#374151';
  return agents.find(a => a.id === agentId)?.color ?? '#6b7280';
}

function agentName(agentId: string, agents: ChatAgent[]): string {
  if (agentId === 'claude') return 'Claude';
  if (agentId === 'pat')    return 'Pat';
  return agents.find(a => a.id === agentId)?.name ?? agentId;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ''; }
}

function seedPosition(agentId: string, index: number, total: number): Position {
  const x = 10 + (index / Math.max(total - 1, 1)) * 78;
  const y = 20 + (agentId.charCodeAt(0) % 45);
  return { x, y };
}

export function ChatroomPanel() {
  const projectPath = useProjectPath();
  const [state, setState] = useState<ChatroomState | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [inputText, setInputText] = useState('');
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [showLog, setShowLog] = useState(false);
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

  // Initialize positions for new agents
  useEffect(() => {
    if (!state?.agents) return;
    const allIds = [
      ...state.agents.map(a => a.id),
      'claude',
    ];
    setPositions(prev => {
      const next = { ...prev };
      allIds.forEach((id, i) => {
        if (!next[id]) next[id] = seedPosition(id, i, allIds.length);
      });
      return next;
    });
  }, [state?.agents.length]);

  // Wander every 4s when active
  useEffect(() => {
    if (!state || state.session.status === 'idle') return;
    const interval = setInterval(() => {
      setPositions(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(id => {
          const dx = (Math.random() - 0.5) * 10;
          const dy = (Math.random() - 0.5) * 8;
          next[id] = {
            x: Math.max(5, Math.min(87, next[id].x + dx)),
            y: Math.max(8, Math.min(70, next[id].y + dy)),
          };
        });
        return next;
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [state?.session.status]);

  useEffect(() => {
    if (showLog) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state?.messages.length, showLog]);

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

  // Last message per agent (drives speech bubbles)
  const lastMsg: Record<string, ChatMessage> = {};
  (state?.messages ?? []).forEach(m => {
    if (m.type !== 'system') lastMsg[m.agentId] = m;
  });

  // All floating buddies
  const allBuddies = [
    ...(state?.agents ?? []),
    { id: 'claude', name: 'Claude', color: '#fbbf24', status: 'idle' as const, currentThought: '' },
  ];

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
          from { opacity: 0; transform: translateY(4px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div
        className="shrink-0 border-t border-gray-800/60 bg-[#09090f] flex flex-col"
        style={{ height: collapsed ? 32 : 320 }}
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
              <span className="text-[9px] text-gray-600 font-mono truncate max-w-[180px]">
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

          <div className="flex-1" />
          <button
            onClick={() => setShowLog(s => !s)}
            className="text-[9px] font-mono text-gray-700 hover:text-gray-500"
          >
            {showLog ? 'hide log' : 'log'}
          </button>
        </div>

        {!collapsed && (
          <div className="flex flex-1 min-h-0">
            {/* Open space canvas */}
            <div className="flex-1 relative overflow-hidden" style={{ background: '#06060e' }}>
              {allBuddies.map(agent => {
                const pos = positions[agent.id];
                if (!pos) return null;

                const isGolden = agent.id === 'claude';
                const color    = isGolden ? '#fbbf24' : agent.color;
                const size     = isGolden ? 46 : 36;
                const msg      = lastMsg[agent.id];
                const msgAge   = msg ? Date.now() - new Date(msg.timestamp).getTime() : Infinity;
                const bubbleOp = msgAge < 6000 ? 1 : msgAge < 18000 ? 0.55 : 0.2;
                const bubbleTxt = msg
                  ? (msg.text.length > 90 ? msg.text.slice(0, 87) + '...' : msg.text)
                  : null;

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
                    }}
                  >
                    {/* Speech bubble */}
                    {bubbleTxt && (
                      <div
                        style={{
                          maxWidth: 148,
                          padding: '4px 8px',
                          borderRadius: 7,
                          background: `${color}12`,
                          border: `1px solid ${color}28`,
                          color: isGolden ? '#fde68a' : color,
                          fontSize: 9,
                          fontFamily: 'monospace',
                          lineHeight: 1.45,
                          wordBreak: 'break-word',
                          textAlign: 'center',
                          opacity: bubbleOp,
                          animation: 'bubble-pop 0.18s ease',
                          marginBottom: 2,
                          pointerEvents: 'none',
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
                        background: '#0f0f18',
                        border: `2px solid ${color}40`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        animation: agent.status === 'thinking'
                          ? 'buddy-twitch 0.45s ease infinite'
                          : 'buddy-bob 3.5s ease infinite',
                        boxShadow: isGolden ? `0 0 14px ${color}30` : undefined,
                        flexShrink: 0,
                      }}
                    >
                      <div style={{ display: 'flex', gap: isGolden ? 5 : 4 }}>
                        {[0, 140].map(delay => (
                          <div
                            key={delay}
                            style={{
                              width: isGolden ? 6 : 5,
                              height: isGolden ? 6 : 5,
                              borderRadius: '50%',
                              backgroundColor: color,
                              animation: `buddy-blink 4.2s ease infinite ${delay}ms`,
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Name */}
                    <div style={{
                      fontSize: 8,
                      fontFamily: 'monospace',
                      color: isGolden ? '#fbbf24' : '#4b5563',
                      letterSpacing: '0.05em',
                    }}>
                      {isGolden ? '✦ ' : ''}{agent.name}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Log overlay */}
            {showLog && (
              <div
                className="shrink-0 border-l border-gray-800/40 overflow-y-auto"
                style={{ width: 230, background: '#08080ddd' }}
              >
                <div className="px-2 py-2 space-y-2">
                  {(state?.messages ?? [])
                    .filter(m => m.type !== 'system')
                    .map(msg => {
                      const color = agentColor(msg.agentId, state?.agents ?? []);
                      const name  = agentName(msg.agentId, state?.agents ?? []);
                      return (
                        <div key={msg.id}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span style={{ fontSize: 8, fontFamily: 'monospace', color }}>{name}</span>
                            <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#2d2d3d' }}>{formatTime(msg.timestamp)}</span>
                          </div>
                          <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#555570', lineHeight: 1.4 }}>
                            {msg.text}
                          </span>
                        </div>
                      );
                    })}
                  <div ref={logEndRef} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pat input */}
        {!collapsed && (
          <div className="px-3 py-1.5 border-t border-gray-800/40 flex gap-2 items-center shrink-0">
            <input
              ref={inputRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitPatMessage(); }}
              placeholder={state?.session.waitingForInput ? 'your turn...' : 'steer the deliberation...'}
              className="flex-1 bg-transparent text-[10px] font-mono text-gray-300 placeholder-gray-700 outline-none"
            />
            <button
              onClick={submitPatMessage}
              disabled={!inputText.trim()}
              className="text-[9px] font-mono text-gray-700 hover:text-gray-400 disabled:opacity-30"
            >
              send
            </button>
          </div>
        )}
      </div>
    </>
  );
}
