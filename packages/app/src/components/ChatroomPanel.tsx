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

interface ChatReaction {
  id: string;
  agentId: string;
  emoji: string;
  timestamp: string;
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
  reactions?: ChatReaction[];
}

interface Position { x: number; y: number; }
interface Floater  { id: string; emoji: string; agentId: string; }

const PHASE_COLORS: Record<string, string> = {
  frame: '#818cf8', deliberate: '#4ade80', synthesis: '#fb923c', patinput: '#facc15', decision: '#f472b6',
};

// yMin set high so speech bubbles above agents never clip at top edge
const BOUNDS = { xMin: 4, xMax: 88, yMin: 32, yMax: 72 };
const MIN_DIST = 22;

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
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  catch { return ''; }
}

function seedPosition(index: number, total: number): Position {
  const cols  = Math.ceil(Math.sqrt(total));
  const col   = index % cols;
  const row   = Math.floor(index / cols);
  const xSpan = BOUNDS.xMax - BOUNDS.xMin - 10;
  const ySpan = BOUNDS.yMax - BOUNDS.yMin - 10;
  return {
    x: BOUNDS.xMin + 5 + (col / Math.max(cols - 1, 1)) * xSpan,
    y: BOUNDS.yMin + 5 + (row / Math.max(Math.ceil(total / cols) - 1, 1)) * ySpan,
  };
}

function resolveCollisions(pos: Record<string, Position>): Record<string, Position> {
  const r   = { ...pos };
  const ids = Object.keys(r);
  for (let iter = 0; iter < 6; iter++) {
    let overlap = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = r[ids[i]], b = r[ids[j]];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_DIST && dist > 0.01) {
          overlap = true;
          const push = (MIN_DIST - dist) / 2 + 0.5;
          const nx = dx / dist, ny = dy / dist;
          r[ids[i]] = { x: Math.max(BOUNDS.xMin, Math.min(BOUNDS.xMax, a.x - nx * push)), y: Math.max(BOUNDS.yMin, Math.min(BOUNDS.yMax, a.y - ny * push)) };
          r[ids[j]] = { x: Math.max(BOUNDS.xMin, Math.min(BOUNDS.xMax, b.x + nx * push)), y: Math.max(BOUNDS.yMin, Math.min(BOUNDS.yMax, b.y + ny * push)) };
        }
      }
    }
    if (!overlap) break;
  }
  return r;
}

export function ChatroomPanel({ fullHeight = false }: { fullHeight?: boolean }) {
  const projectPath = useProjectPath();
  const [state,       setState]       = useState<ChatroomState | null>(null);
  const [collapsed,   setCollapsed]   = useState(false);
  const [inputText,   setInputText]   = useState('');
  const [positions,   setPositions]   = useState<Record<string, Position>>({});
  const [floaters,    setFloaters]    = useState<Floater[]>([]);
  const [typewriters, setTypewriters] = useState<Record<string, { msgId: string; revealed: number }>>({});

  const twIntervals      = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const lastSeenMsgId    = useRef<Record<string, string>>({});
  const seenReactions    = useRef<Set<string>>(new Set());
  const positionsRef     = useRef<Record<string, Position>>({});
  const logEndRef        = useRef<HTMLDivElement>(null);
  const inputRef         = useRef<HTMLInputElement>(null);

  useEffect(() => { positionsRef.current = positions; }, [positions]);

  const fetchState = useCallback(async () => {
    if (!projectPath) return;
    try { setState(JSON.parse(await invoke<string>('get_chatroom', { projectPath })) as ChatroomState); }
    catch { setState(null); }
  }, [projectPath]);

  useEffect(() => { fetchState(); }, [fetchState]);

  useEffect(() => {
    if (!projectPath) return;
    const u = listen<string[]>('hw-files-changed', e => { if (e.payload.includes('chatroom.json')) fetchState(); });
    return () => { u.then(fn => fn()); };
  }, [projectPath, fetchState]);

  // Init agent positions
  useEffect(() => {
    if (!state?.agents) return;
    const allIds = [...state.agents.map(a => a.id), 'claude'];
    setPositions(prev => {
      const next = { ...prev };
      let changed = false;
      allIds.forEach((id, i) => { if (!next[id]) { next[id] = seedPosition(i, allIds.length); changed = true; } });
      return changed ? resolveCollisions(next) : prev;
    });
  }, [state?.agents.length]);

  // Wander + repel every 4s
  useEffect(() => {
    if (!state || state.session.status === 'idle') return;
    const iv = setInterval(() => {
      setPositions(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(id => {
          next[id] = {
            x: Math.max(BOUNDS.xMin, Math.min(BOUNDS.xMax, next[id].x + (Math.random() - 0.5) * 12)),
            y: Math.max(BOUNDS.yMin, Math.min(BOUNDS.yMax, next[id].y + (Math.random() - 0.5) * 9)),
          };
        });
        return resolveCollisions(next);
      });
    }, 4000);
    return () => clearInterval(iv);
  }, [state?.session.status]);

  // Typewriter — start on every new message
  useEffect(() => {
    if (!state) return;
    const msgByAgent: Record<string, ChatMessage> = {};
    state.messages.forEach(m => { if (m.type !== 'system' && m.type !== 'thinking') msgByAgent[m.agentId] = m; });
    Object.entries(msgByAgent).forEach(([agentId, msg]) => {
      if (lastSeenMsgId.current[agentId] === msg.id) return;
      lastSeenMsgId.current[agentId] = msg.id;
      if (twIntervals.current[agentId]) { clearInterval(twIntervals.current[agentId]); delete twIntervals.current[agentId]; }
      let revealed = 0;
      const total = msg.text.length;
      setTypewriters(prev => ({ ...prev, [agentId]: { msgId: msg.id, revealed: 0 } }));
      const iv = setInterval(() => {
        revealed = Math.min(revealed + 3, total);
        setTypewriters(prev => ({ ...prev, [agentId]: { msgId: msg.id, revealed } }));
        if (revealed >= total) { clearInterval(iv); delete twIntervals.current[agentId]; }
      }, 20);
      twIntervals.current[agentId] = iv;
    });
  }, [state?.messages.length, state]);

  useEffect(() => () => { Object.values(twIntervals.current).forEach(clearInterval); }, []);

  // Emoji floaters
  useEffect(() => {
    if (!state?.reactions?.length) return;
    const fresh = state.reactions.filter(r => !seenReactions.current.has(r.id));
    if (!fresh.length) return;
    fresh.forEach(r => {
      seenReactions.current.add(r.id);
      const f: Floater = { id: r.id, emoji: r.emoji, agentId: r.agentId };
      setFloaters(prev => [...prev, f]);
      setTimeout(() => setFloaters(prev => prev.filter(x => x.id !== r.id)), 2400);
    });
  }, [state?.reactions?.length, state]);

  // Auto-scroll log
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [state?.messages.length]);
  useEffect(() => { if (state?.session.waitingForInput) setTimeout(() => inputRef.current?.focus(), 100); }, [state?.session.waitingForInput]);

  const submitPatMessage = async () => {
    if (!inputText.trim() || !projectPath) return;
    const msg = inputText.trim();
    setInputText('');
    try { await invoke('post_pat_chatroom_message', { projectPath, message: msg }); } catch { /* no-op */ }
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
  const lastMsg: Record<string, ChatMessage> = {};
  (state?.messages ?? []).forEach(m => { if (m.type !== 'system') lastMsg[m.agentId] = m; });
  const allBuddies   = [...(state?.agents ?? []), { id: 'claude', name: 'Claude', color: '#fbbf24', status: 'idle' as const, currentThought: '' }];
  const logMessages  = (state?.messages ?? []).filter(m => m.type !== 'system' && m.type !== 'thinking');

  return (
    <>
      <style>{`
        @keyframes buddy-blink  { 0%,88%,100%{transform:scaleY(1)} 93%{transform:scaleY(0.08)} }
        @keyframes buddy-bob    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
        @keyframes buddy-twitch { 0%,100%{transform:translate(0,0)} 20%{transform:translate(-1px,-1px)} 40%{transform:translate(1px,1px)} 60%{transform:translate(-1px,0)} 80%{transform:translate(1px,-1px)} }
        @keyframes bubble-pop   { from{opacity:0;transform:translateY(3px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes combat-float { 0%{opacity:1;transform:translate(-50%,0) scale(1)} 15%{opacity:1;transform:translate(-50%,-10px) scale(1.2)} 100%{opacity:0;transform:translate(-50%,-55px) scale(0.85)} }
        .hw-chat-scroll::-webkit-scrollbar       { width: 3px; }
        .hw-chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .hw-chat-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 2px; }
        .hw-chat-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
      `}</style>

      <div className={fullHeight ? 'flex-1 min-h-0 bg-[#09090f] flex flex-col' : 'shrink-0 border-t border-gray-800/60 bg-[#09090f] flex flex-col'} style={fullHeight ? undefined : { height: collapsed ? 32 : 380 }}>

        {/* Header */}
        <div className="flex items-center gap-2 px-3 h-8 shrink-0 border-b border-gray-800/40">
          <button onClick={() => setCollapsed(c => !c)} className="text-[9px] font-mono text-gray-600 hover:text-gray-400 uppercase tracking-widest">
            {collapsed ? '▲' : '▼'} Deliberation
          </button>
          {state?.session.topic && <><div className="h-3 w-px bg-gray-800" /><span className="text-[9px] text-gray-600 font-mono truncate max-w-[200px]">{state.session.topic}</span></>}
          {phase && <><div className="h-3 w-px bg-gray-800" /><span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: phaseColor }}>{phase}</span></>}
          <div className="h-3 w-px bg-gray-800" />
          <span className="text-[9px] font-mono" style={{ color: state?.session.status === 'active' ? '#4ade80' : state?.session.status === 'paused' ? '#facc15' : state?.session.status === 'concluded' ? '#818cf8' : '#4b5563' }}>
            {state?.session.status ?? 'idle'}
          </span>
          {state?.session.waitingForInput && <><div className="h-3 w-px bg-gray-800" /><span className="text-[9px] text-amber-400 font-mono animate-pulse">your turn</span></>}
        </div>

        {!collapsed && (
          <div className="flex flex-1 min-h-0">

            {/* In-game chat log — left */}
            <div className="shrink-0 flex flex-col border-r" style={{ width: 220, background: 'rgba(3,3,12,0.96)', borderColor: '#ffffff06' }}>
              <div className="px-2 py-1 border-b shrink-0 flex items-center gap-1.5" style={{ borderColor: '#ffffff06' }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#4ade8020' }} />
                <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#122218', letterSpacing: '0.12em', textTransform: 'uppercase' }}>All</span>
              </div>

              <div className="hw-chat-scroll flex-1 overflow-y-auto px-2 py-1.5 space-y-2">
                {logMessages.length === 0 && <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#0d0d1a' }}>no messages yet</span>}
                {logMessages.map(msg => {
                  const color = agentColor(msg.agentId, state?.agents ?? []);
                  const name  = agentDisplayName(msg.agentId, state?.agents ?? []);
                  return (
                    <div key={msg.id}>
                      <div className="flex items-baseline gap-1 mb-0.5">
                        <span style={{ fontSize: 8, fontFamily: 'monospace', color, flexShrink: 0, fontWeight: msg.agentId === 'claude' ? 'bold' : 'normal' }}>
                          {msg.agentId === 'claude' ? '✦ ' : ''}{name}
                        </span>
                        <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#10101e' }}>{formatTime(msg.timestamp)}</span>
                      </div>
                      <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#30304a', lineHeight: 1.5, display: 'block' }}>{msg.text}</span>
                    </div>
                  );
                })}
                <div ref={logEndRef} />
              </div>

              <div className="px-2 py-1.5 border-t shrink-0 flex gap-1.5 items-center" style={{ borderColor: '#ffffff06' }}>
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#94a3b840', flexShrink: 0 }}>Pat:</span>
                <input ref={inputRef} value={inputText} onChange={e => setInputText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitPatMessage(); }}
                  placeholder={state?.session.waitingForInput ? 'your turn...' : 'steer...'}
                  style={{ flex: 1, background: 'transparent', fontSize: 8, fontFamily: 'monospace', color: '#94a3b8', outline: 'none', border: 'none' }}
                />
              </div>
            </div>

            {/* Floating canvas */}
            <div className="flex-1 relative overflow-hidden" style={{ background: '#030310' }}>

              {allBuddies.map(agent => {
                const pos      = positions[agent.id];
                if (!pos) return null;
                const isGolden = agent.id === 'claude';
                const color    = isGolden ? '#fbbf24' : agent.color;
                const size     = isGolden ? 44 : 34;
                const msg      = lastMsg[agent.id];
                const tw       = msg ? typewriters[agent.id] : null;
                const msgAge   = msg ? Date.now() - new Date(msg.timestamp).getTime() : Infinity;
                const bubbleOp = msgAge < 8000 ? 1 : msgAge < 25000 ? 0.55 : 0.15;

                let bubbleTxt: string | null = null;
                if (msg) {
                  bubbleTxt = tw?.msgId === msg.id
                    ? msg.text.slice(0, tw.revealed) + (tw.revealed < msg.text.length ? '▋' : '')
                    : msg.text;
                }

                return (
                  <div key={agent.id} style={{
                    position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`,
                    transform: 'translate(-50%, -50%)', transition: 'left 3s ease, top 3s ease',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  }}>
                    {bubbleTxt !== null && (
                      <div style={{
                        maxWidth: 190, padding: '5px 8px', borderRadius: 6,
                        background: `${color}0d`, border: `1px solid ${color}1e`,
                        color: isGolden ? '#fde68a' : color,
                        fontSize: 8, fontFamily: 'monospace', lineHeight: 1.5,
                        wordBreak: 'break-word', opacity: bubbleOp,
                        animation: 'bubble-pop 0.15s ease', marginBottom: 2, pointerEvents: 'none',
                      }}>
                        {bubbleTxt}
                      </div>
                    )}

                    <div style={{
                      width: size, height: size, borderRadius: '50%', background: '#0c0c18',
                      border: `2px solid ${color}28`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      animation: agent.status === 'thinking' ? 'buddy-twitch 0.45s ease infinite' : 'buddy-bob 3.5s ease infinite',
                      boxShadow: isGolden ? `0 0 12px ${color}1a` : undefined, flexShrink: 0,
                    }}>
                      <div style={{ display: 'flex', gap: isGolden ? 5 : 4 }}>
                        {[0, 140].map(d => (
                          <div key={d} style={{ width: isGolden ? 5 : 4, height: isGolden ? 5 : 4, borderRadius: '50%', backgroundColor: color, animation: `buddy-blink 4.2s ease infinite ${d}ms` }} />
                        ))}
                      </div>
                    </div>

                    <div style={{ fontSize: 7, fontFamily: 'monospace', color: `${color}30`, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      {agent.name}
                    </div>
                  </div>
                );
              })}

              {/* Combat-text emoji floaters */}
              {floaters.map(f => {
                const pos = positionsRef.current[f.agentId];
                if (!pos) return null;
                return (
                  <div key={f.id} style={{
                    position: 'absolute', left: `${pos.x}%`, top: `calc(${pos.y}% - 18px)`,
                    fontSize: 15, lineHeight: 1, pointerEvents: 'none',
                    animation: 'combat-float 2.4s ease-out forwards', zIndex: 20,
                  }}>
                    {f.emoji}
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
