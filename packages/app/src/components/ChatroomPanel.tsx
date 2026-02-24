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
  deliberationPhase?: string;
  introRevealedCount?: number;
}

interface ChatroomState {
  session: ChatSession;
  agents: ChatAgent[];
  messages: ChatMessage[];
  reactions?: ChatReaction[];
}

interface Position { x: number; y: number; }
interface Floater  { id: string; emoji: string; agentId: string; }

// ── Round table geometry ───────────────────────────────────────
// Claude at 12 o'clock, agents evenly distributed around an ellipse.
const CX = 50, CY = 52, RX = 38, RY = 27;

function tablePositions(agentIds: string[]): Record<string, Position> {
  const total = agentIds.length + 1; // +1 for Claude
  const step  = (2 * Math.PI) / total;
  const start = -Math.PI / 2; // 12 o'clock

  const pos: Record<string, Position> = {};
  pos['claude'] = { x: CX, y: CY + RY * Math.sin(start) };
  agentIds.forEach((id, i) => {
    const angle = start + step * (i + 1);
    pos[id] = { x: CX + RX * Math.cos(angle), y: CY + RY * Math.sin(angle) };
  });
  return pos;
}

// ── Helpers ────────────────────────────────────────────────────
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

// ── Web Audio chatter ──────────────────────────────────────────
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (!_audioCtx) {
    try {
      const W = window as unknown as { webkitAudioContext?: typeof AudioContext };
      _audioCtx = new (window.AudioContext ?? W.webkitAudioContext!)();
    } catch { return null; }
  }
  return _audioCtx;
}

function playChatterTick(pitch: number): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = pitch;
    gain.gain.setValueAtTime(0.02, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.042);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.042);
  } catch { /* ignore */ }
}

// ── Component ──────────────────────────────────────────────────
export function ChatroomPanel({ fullHeight = false }: { fullHeight?: boolean }) {
  const projectPath = useProjectPath();
  const [state,       setState]       = useState<ChatroomState | null>(null);
  const [collapsed,   setCollapsed]   = useState(false);
  const [inputText,   setInputText]   = useState('');
  const [positions,   setPositions]   = useState<Record<string, Position>>({});
  const [floaters,    setFloaters]    = useState<Floater[]>([]);
  const [typewriters, setTypewriters] = useState<Record<string, { msgId: string; revealed: number }>>({});
  const [showSummary, setShowSummary] = useState(false);

  const twIntervals   = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const lastSeenMsgId = useRef<Record<string, string>>({});
  const seenReactions = useRef<Set<string>>(new Set());
  const agentPitch    = useRef<Record<string, number>>({});
  const logEndRef     = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLInputElement>(null);

  const fetchState = useCallback(async () => {
    if (!projectPath) return;
    try { setState(JSON.parse(await invoke<string>('get_chatroom', { projectPath })) as ChatroomState); }
    catch (err) { console.error('[ChatroomPanel] fetchState error:', err); setState(null); }
  }, [projectPath]);

  useEffect(() => { fetchState(); }, [fetchState]);

  useEffect(() => {
    if (!projectPath) return;
    const u = listen<string[]>('hw-files-changed', e => {
      if (e.payload.includes('chatroom.json')) fetchState();
    });
    return () => { u.then(fn => fn()); };
  }, [projectPath, fetchState]);

  // Recompute fixed round-table positions when agent list changes
  useEffect(() => {
    if (!state?.agents) return;
    const agentIds = state.agents.map(a => a.id);
    setPositions(tablePositions(agentIds));
    // Assign stable pitch offsets per agent for audio variety
    agentIds.forEach((id, i) => {
      if (!agentPitch.current[id]) agentPitch.current[id] = 320 + i * 130 + Math.random() * 40;
    });
    if (!agentPitch.current['claude']) agentPitch.current['claude'] = 720;
  }, [state?.agents.length]);

  // Typewriter + chatter sound
  useEffect(() => {
    if (!state) return;
    const msgByAgent: Record<string, ChatMessage> = {};
    state.messages.forEach(m => { if (m.type !== 'system' && m.type !== 'thinking') msgByAgent[m.agentId] = m; });
    Object.entries(msgByAgent).forEach(([agentId, msg]) => {
      if (lastSeenMsgId.current[agentId] === msg.id) return;
      lastSeenMsgId.current[agentId] = msg.id;
      if (twIntervals.current[agentId]) { clearInterval(twIntervals.current[agentId]); delete twIntervals.current[agentId]; }
      let revealed = 0;
      const total  = msg.text.length;
      const pitch  = agentPitch.current[agentId] ?? 500;
      setTypewriters(prev => ({ ...prev, [agentId]: { msgId: msg.id, revealed: 0 } }));
      const iv = setInterval(() => {
        revealed = Math.min(revealed + 3, total);
        setTypewriters(prev => ({ ...prev, [agentId]: { msgId: msg.id, revealed } }));
        if (revealed % 5 < 3) playChatterTick(pitch + (Math.random() - 0.5) * 90);
        if (revealed >= total) { clearInterval(iv); delete twIntervals.current[agentId]; }
      }, 22);
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
      setFloaters(prev => [...prev, { id: r.id, emoji: r.emoji, agentId: r.agentId }]);
      setTimeout(() => setFloaters(prev => prev.filter(x => x.id !== r.id)), 2400);
    });
  }, [state?.reactions?.length, state]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [state?.messages.length]);
  useEffect(() => { if (state?.session.waitingForInput) setTimeout(() => inputRef.current?.focus(), 100); }, [state?.session.waitingForInput]);

  const submitPatMessage = async () => {
    if (!inputText.trim() || !projectPath) return;
    const msg = inputText.trim();
    setInputText('');
    try { await invoke('post_pat_chatroom_message', { projectPath, message: msg }); } catch { /* no-op */ }
  };

  const isActive = state?.session.status === 'active' || state?.session.status === 'paused' || state?.session.status === 'concluded';

  if (!isActive && !state?.messages.length) {
    return (
      <div className="h-8 flex items-center gap-2 px-3 border-t border-gray-800/50 bg-[#09090f] shrink-0">
        <span className="text-[9px] font-mono text-gray-700 uppercase tracking-widest">Deliberation</span>
        <span className="text-[9px] text-gray-700">— idle. Start with hw_start_deliberation()</span>
      </div>
    );
  }

  const phase      = state?.session.deliberationPhase;
  const introCount = state?.session.introRevealedCount;
  const inIntro    = typeof introCount === 'number';

  const lastMsg: Record<string, ChatMessage> = {};
  (state?.messages ?? []).forEach(m => { if (m.type !== 'system') lastMsg[m.agentId] = m; });

  const allBuddies = [
    ...(state?.agents ?? []),
    { id: 'claude', name: 'Claude', color: '#fbbf24', status: 'idle' as const, currentThought: '' },
  ];

  const logMessages = (state?.messages ?? []).filter(m => m.type !== 'system' && m.type !== 'thinking');

  // Track which agents are actively typewriting for shake animation
  const typingNow = new Set<string>();
  allBuddies.forEach(a => {
    const msg = lastMsg[a.id];
    const tw  = msg ? typewriters[a.id] : null;
    if (tw && tw.msgId === msg?.id && tw.revealed < (msg?.text.length ?? 0)) typingNow.add(a.id);
  });

  const PHASE_COLORS: Record<string, string> = {
    frame: '#818cf8', deliberate: '#4ade80', synthesis: '#fb923c', patinput: '#facc15', decision: '#f472b6',
  };
  const phaseColor  = phase ? (PHASE_COLORS[phase] ?? '#4b5563') : '#4b5563';
  const statusColor =
    state?.session.status === 'active'    ? '#4ade80' :
    state?.session.status === 'paused'    ? '#facc15' :
    state?.session.status === 'concluded' ? '#818cf8' : '#4b5563';

  return (
    <>
      <style>{`
        @keyframes buddy-blink  { 0%,88%,100%{transform:scaleY(1)} 93%{transform:scaleY(0.08)} }
        @keyframes buddy-bob    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
        @keyframes buddy-twitch { 0%,100%{transform:translate(0,0) rotate(0deg)} 15%{transform:translate(-2px,-1px) rotate(-2deg)} 30%{transform:translate(2px,1px) rotate(2deg)} 50%{transform:translate(-1px,2px) rotate(-1deg)} 70%{transform:translate(1px,-2px) rotate(1.5deg)} 85%{transform:translate(-2px,0) rotate(-1deg)} }
        @keyframes bubble-pop   { from{opacity:0;transform:translateY(4px) scale(0.95)} to{opacity:1;transform:translateY(0) scale(1)} }
        @keyframes agent-enter  { from{opacity:0;transform:translate(-50%,-50%) scale(0.35)} 65%{transform:translate(-50%,-50%) scale(1.1)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
        @keyframes combat-float { 0%{opacity:1;transform:translate(-50%,0) scale(1)} 15%{opacity:1;transform:translate(-50%,-10px) scale(1.2)} 100%{opacity:0;transform:translate(-50%,-55px) scale(0.85)} }
        .hw-chat-scroll::-webkit-scrollbar       { width: 3px; }
        .hw-chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .hw-chat-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 2px; }
      `}</style>

      <div
        className={fullHeight ? 'flex-1 min-h-0 bg-[#09090f] flex flex-col' : 'shrink-0 border-t border-gray-800/60 bg-[#09090f] flex flex-col'}
        style={fullHeight ? undefined : { height: collapsed ? 32 : 400 }}
      >
        {/* Header bar */}
        <div className="flex items-center gap-2 px-3 h-8 shrink-0 border-b border-gray-800/40">
          <button onClick={() => setCollapsed(c => !c)} className="text-[9px] font-mono text-gray-600 hover:text-gray-400 uppercase tracking-widest">
            {collapsed ? '▲' : '▼'} Deliberation
          </button>
          {state?.session.topic && (
            <><div className="h-3 w-px bg-gray-800" />
            <span className="text-[9px] text-gray-600 font-mono truncate max-w-[200px]">{state.session.topic}</span></>
          )}
          {phase && (
            <><div className="h-3 w-px bg-gray-800" />
            <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: phaseColor }}>{phase}</span></>
          )}
          <div className="h-3 w-px bg-gray-800" />
          <span className="text-[9px] font-mono" style={{ color: statusColor }}>
            {state?.session.status ?? 'idle'}
          </span>
          {inIntro && (
            <><div className="h-3 w-px bg-gray-800" />
            <span className="text-[9px] text-violet-400 font-mono animate-pulse">intro</span></>
          )}
          {state?.session.waitingForInput && (
            <><div className="h-3 w-px bg-gray-800" />
            <span className="text-[9px] text-amber-400 font-mono animate-pulse">your turn</span></>
          )}
          {(state?.session.roundNumber ?? 0) > 0 && (
            <><div className="h-3 w-px bg-gray-800" />
            <span className="text-[9px] font-mono text-gray-700">R{state?.session.roundNumber}</span></>
          )}
        </div>

        {!collapsed && (
          <div className="flex flex-1 min-h-0">

            {/* ── Twitch-style chat log ──────────────────────────────── */}
            <div
              className="shrink-0 flex flex-col"
              style={{ width: 248, background: '#08080f', borderRight: '1px solid rgba(255,255,255,0.04)' }}
            >
              <div
                className="px-2 py-1 shrink-0 flex items-center gap-1.5"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
              >
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor, opacity: 0.6 }} />
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#282838', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  Chat
                </span>
              </div>

              <div className="hw-chat-scroll flex-1 overflow-y-auto py-1">
                {logMessages.length === 0 && (
                  <div style={{ padding: '4px 8px', fontSize: 8, fontFamily: 'monospace', color: '#181828' }}>
                    waiting...
                  </div>
                )}
                {logMessages.map((msg, idx) => {
                  const color = agentColor(msg.agentId, state?.agents ?? []);
                  const name  = agentDisplayName(msg.agentId, state?.agents ?? []);
                  const isGold = msg.agentId === 'claude';
                  const prevAgent = idx > 0 ? logMessages[idx - 1].agentId : null;
                  const isNewSpeaker = prevAgent !== null && prevAgent !== msg.agentId;
                  return (
                    <div key={msg.id}>
                      {isNewSpeaker && (
                        <div style={{ height: 1, margin: '3px 8px', background: 'rgba(255,255,255,0.03)' }} />
                      )}
                      <div style={{ padding: isNewSpeaker ? '3px 8px 2px' : '1px 8px 2px', lineHeight: 1.45, wordBreak: 'break-word' }}>
                        <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#252535', marginRight: 4 }}>
                          {formatTime(msg.timestamp)}
                        </span>
                        <span style={{
                          fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color,
                          marginRight: 3,
                          textShadow: isGold ? `0 0 6px ${color}50` : undefined,
                        }}>
                          {name}:
                        </span>
                        <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#c0c0d5' }}>
                          {msg.text}
                        </span>
                      </div>
                    </div>
                  );
                })}
                <div ref={logEndRef} />
              </div>

              {/* Pat input */}
              <div
                className="px-2 py-1.5 shrink-0 flex gap-1.5 items-center"
                style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
              >
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#3a3a58', flexShrink: 0 }}>Pat</span>
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#222235', marginRight: 2 }}>▸</span>
                <input
                  ref={inputRef}
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitPatMessage(); }}
                  placeholder={state?.session.waitingForInput ? 'your turn...' : 'steer...'}
                  style={{
                    flex: 1, background: 'transparent',
                    fontSize: 9, fontFamily: 'monospace', color: '#9090b0',
                    outline: 'none', border: 'none',
                  }}
                />
              </div>
            </div>

            {/* ── Round table canvas ─────────────────────────────────── */}
            <div className="flex-1 relative overflow-hidden" style={{ background: '#030310' }}>

              {/* Elliptical table surface */}
              <div style={{
                position: 'absolute',
                left: `${CX}%`, top: `${CY}%`,
                transform: 'translate(-50%, -50%)',
                width: `${RX * 1.75}%`, height: `${RY * 2.1}%`,
                borderRadius: '50%',
                background: 'radial-gradient(ellipse, rgba(255,255,255,0.013) 0%, rgba(255,255,255,0.003) 65%, transparent 100%)',
                border: '1px solid rgba(255,255,255,0.032)',
                pointerEvents: 'none',
              }} />

              {/* Topic watermark */}
              <div style={{
                position: 'absolute', left: `${CX}%`, top: `${CY}%`,
                transform: 'translate(-50%, -50%)',
                fontSize: 6.5, fontFamily: 'monospace', color: 'rgba(255,255,255,0.045)',
                letterSpacing: '0.12em', textTransform: 'uppercase',
                pointerEvents: 'none', userSelect: 'none', textAlign: 'center', maxWidth: '30%',
                lineHeight: 1.4,
              }}>
                {state?.session.topic?.slice(0, 36) ?? ''}
              </div>

              {/* Agent buddies */}
              {allBuddies.map(agent => {
                const pos      = positions[agent.id];
                if (!pos) return null;

                const isGolden = agent.id === 'claude';
                const color    = isGolden ? '#fbbf24' : agent.color;
                const size     = isGolden ? 44 : 34;
                const isTyping = typingNow.has(agent.id);

                // Intro visibility
                const agentOwnIndex = isGolden ? -1 : (state?.agents ?? []).findIndex(a => a.id === agent.id);
                const isRevealed     = !inIntro || isGolden || (introCount !== undefined && agentOwnIndex < introCount);
                const isJustRevealed = inIntro && !isGolden && introCount !== undefined && agentOwnIndex === introCount - 1;

                if (!isRevealed) {
                  return (
                    <div key={agent.id} style={{
                      position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`,
                      transform: 'translate(-50%, -50%)',
                      width: size * 0.5, height: size * 0.5, borderRadius: '50%',
                      background: 'rgba(255,255,255,0.015)',
                      border: '1px dashed rgba(255,255,255,0.04)',
                    }} />
                  );
                }

                const msg    = lastMsg[agent.id];
                const tw     = msg ? typewriters[agent.id] : null;
                const msgAge = msg ? Date.now() - new Date(msg.timestamp).getTime() : Infinity;
                const bubbleOp = msgAge < 6000 ? 1 : msgAge < 20000 ? 0.5 : 0.12;

                let bubbleTxt: string | null = null;
                if (msg) {
                  const raw = tw?.msgId === msg.id
                    ? msg.text.slice(0, tw.revealed) + (tw.revealed < msg.text.length ? '▋' : '')
                    : msg.text;
                  bubbleTxt = raw.length > 85 ? raw.slice(0, 85) + '…' : raw;
                }

                return (
                  <div
                    key={agent.id}
                    style={{
                      position: 'absolute',
                      left: `${pos.x}%`, top: `${pos.y}%`,
                      transform: 'translate(-50%, -50%)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                      animation: isJustRevealed ? 'agent-enter 0.6s cubic-bezier(0.34,1.56,0.64,1) forwards' : undefined,
                    }}
                  >
                    {/* Speech bubble */}
                    {bubbleTxt !== null && (
                      <div style={{
                        maxWidth: 165, padding: '4px 7px', borderRadius: 5,
                        background: `${color}0e`, border: `1px solid ${color}20`,
                        color: isGolden ? '#fde68a' : color,
                        fontSize: 7.5, fontFamily: 'monospace', lineHeight: 1.45,
                        wordBreak: 'break-word', opacity: bubbleOp,
                        animation: 'bubble-pop 0.12s ease', marginBottom: 2,
                        pointerEvents: 'none',
                      }}>
                        {bubbleTxt}
                      </div>
                    )}

                    {/* Head */}
                    <div style={{
                      width: size, height: size, borderRadius: '50%',
                      background: '#0c0c18',
                      border: `2px solid ${color}${isJustRevealed ? '55' : '26'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      animation: isTyping ? 'buddy-twitch 0.28s ease infinite' : 'buddy-bob 3.5s ease infinite',
                      boxShadow: isJustRevealed
                        ? `0 0 22px 4px ${color}45`
                        : isGolden
                        ? `0 0 12px ${color}1e`
                        : undefined,
                      flexShrink: 0,
                    }}>
                      <div style={{ display: 'flex', gap: isGolden ? 5 : 4 }}>
                        {[0, 140].map(d => (
                          <div key={d} style={{
                            width: isGolden ? 5 : 4, height: isGolden ? 5 : 4,
                            borderRadius: '50%', backgroundColor: color,
                            animation: `buddy-blink 4.2s ease infinite ${d}ms`,
                            filter: isTyping ? `drop-shadow(0 0 3px ${color})` : undefined,
                          }} />
                        ))}
                      </div>
                    </div>

                    {/* Name */}
                    <div style={{
                      fontSize: 7, fontFamily: 'monospace', letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: isGolden ? '#fbbf2460' : `${color}45`,
                    }}>
                      {agent.name}
                    </div>

                    {/* Active status dot */}
                    {agent.status !== 'idle' && (
                      <div style={{
                        width: 4, height: 4, borderRadius: '50%',
                        background: agent.status === 'thinking' ? '#fb923c' : color,
                        boxShadow: `0 0 5px ${agent.status === 'thinking' ? '#fb923c' : color}`,
                      }} />
                    )}
                  </div>
                );
              })}

              {/* Emoji floaters */}
              {floaters.map(f => {
                const pos = positions[f.agentId];
                if (!pos) return null;
                return (
                  <div key={f.id} style={{
                    position: 'absolute',
                    left: `${pos.x}%`, top: `calc(${pos.y}% - 18px)`,
                    fontSize: 14, lineHeight: 1, pointerEvents: 'none',
                    animation: 'combat-float 2.4s ease-out forwards', zIndex: 20,
                  }}>
                    {f.emoji}
                  </div>
                );
              })}

              {/* Concluded banner */}
              {state?.session.status === 'concluded' && (
                <div style={{
                  position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                }}>
                  <div style={{
                    padding: '4px 14px', borderRadius: 4,
                    background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.22)',
                    fontSize: 8, fontFamily: 'monospace', color: '#818cf8',
                    letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                  }}>
                    deliberation concluded -- return to terminal to discuss results
                  </div>
                  <button
                    onClick={() => setShowSummary(s => !s)}
                    style={{
                      padding: '3px 10px', borderRadius: 3,
                      background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.18)',
                      fontSize: 7.5, fontFamily: 'monospace', color: '#818cf8',
                      letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
                    }}
                  >
                    {showSummary ? 'hide summary' : 'view summary'}
                  </button>
                </div>
              )}

              {/* Summary overlay */}
              {showSummary && state?.session.status === 'concluded' && (
                <div
                  className="hw-chat-scroll"
                  style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(3,3,16,0.95)',
                    overflowY: 'auto', padding: '12px 16px',
                    zIndex: 30,
                  }}
                >
                  <div style={{
                    fontSize: 8, fontFamily: 'monospace', color: '#818cf8',
                    letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10,
                  }}>
                    Deliberation Summary: {state.session.topic}
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ fontSize: 7.5, fontFamily: 'monospace', color: '#3a3a58', textAlign: 'left', padding: '2px 6px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Time</th>
                        <th style={{ fontSize: 7.5, fontFamily: 'monospace', color: '#3a3a58', textAlign: 'left', padding: '2px 6px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Agent</th>
                        <th style={{ fontSize: 7.5, fontFamily: 'monospace', color: '#3a3a58', textAlign: 'left', padding: '2px 6px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logMessages.map(msg => {
                        const color = agentColor(msg.agentId, state?.agents ?? []);
                        const name  = agentDisplayName(msg.agentId, state?.agents ?? []);
                        return (
                          <tr key={msg.id}>
                            <td style={{ fontSize: 7.5, fontFamily: 'monospace', color: '#252535', padding: '3px 6px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                              {formatTime(msg.timestamp)}
                            </td>
                            <td style={{ fontSize: 8, fontFamily: 'monospace', fontWeight: 700, color, padding: '3px 6px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                              {name}
                            </td>
                            <td style={{ fontSize: 8, fontFamily: 'monospace', color: '#c0c0d5', padding: '3px 6px', lineHeight: 1.45, wordBreak: 'break-word' }}>
                              {msg.text}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
