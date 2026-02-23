import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AgentBuddy } from './AgentBuddy.js';
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
}

interface ChatroomState {
  session: ChatSession;
  agents: ChatAgent[];
  messages: ChatMessage[];
}

// Map agentId to display name for messages
function agentLabel(agentId: string, agents: ChatAgent[]): { name: string; color: string } {
  if (agentId === 'system') return { name: 'System', color: '#4b5563' };
  if (agentId === 'pat')    return { name: 'Pat', color: '#94a3b8' };
  if (agentId === 'claude') return { name: 'Claude', color: '#fbbf24' };
  const a = agents.find(a => a.id === agentId);
  return { name: a?.name ?? agentId, color: a?.color ?? '#6b7280' };
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch { return ''; }
}

export function ChatroomPanel() {
  const projectPath = useProjectPath();
  const [state, setState] = useState<ChatroomState | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchState = useCallback(async () => {
    if (!projectPath) return;
    try {
      const raw = await invoke<string>('get_chatroom', { projectPath });
      const parsed = JSON.parse(raw) as ChatroomState;
      setState(parsed);
    } catch {
      setState(null);
    }
  }, [projectPath]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Listen for file changes
  useEffect(() => {
    if (!projectPath) return;
    const unlisten = listen<string[]>('hw-files-changed', (event) => {
      if (event.payload.includes('chatroom.json')) fetchState();
    });
    return () => { unlisten.then(fn => fn()); };
  }, [projectPath, fetchState]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state?.messages.length]);

  // Auto-focus input when it's Pat's turn
  useEffect(() => {
    if (state?.session.waitingForInput) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [state?.session.waitingForInput]);

  const submitPatMessage = async () => {
    if (!inputText.trim() || !projectPath) return;
    const msg = inputText.trim();
    setInputText('');
    // Write via Tauri command (which writes to chatroom.json pendingPatMessage)
    try {
      await invoke('post_pat_chatroom_message', { projectPath, message: msg });
    } catch {
      // Fallback: file write directly not available from frontend — show error
    }
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
          0%, 100% { transform: translate(0, 0); }
          20%       { transform: translate(-1px, -1px); }
          40%       { transform: translate(1px, 1px); }
          60%       { transform: translate(-1px, 0); }
          80%       { transform: translate(1px, -1px); }
        }
        @keyframes dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.75); }
        }
        @keyframes glow-pulse {
          0%, 100% { opacity: 0.7; }
          50%       { opacity: 1; }
        }
      `}</style>

      <div
        className="shrink-0 border-t border-gray-800/60 bg-[#09090f] flex flex-col"
        style={{ height: collapsed ? 32 : 220 }}
      >
        {/* Header bar */}
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

          <div className="h-3 w-px bg-gray-800" />
          <span
            className="text-[9px] font-mono"
            style={{
              color: state?.session.status === 'active' ? '#4ade80' :
                     state?.session.status === 'paused' ? '#facc15' :
                     state?.session.status === 'concluded' ? '#818cf8' : '#4b5563',
            }}
          >
            {state?.session.status ?? 'idle'}
          </span>

          {state?.session.roundNumber ? (
            <>
              <div className="h-3 w-px bg-gray-800" />
              <span className="text-[9px] text-gray-700 font-mono">round {state.session.roundNumber}</span>
            </>
          ) : null}

          {state?.session.waitingForInput && (
            <>
              <div className="h-3 w-px bg-gray-800" />
              <span className="text-[9px] text-amber-400 font-mono animate-pulse">your turn</span>
            </>
          )}
        </div>

        {!collapsed && (
          <div className="flex flex-1 min-h-0">
            {/* Agent avatar column */}
            <div className="w-[280px] shrink-0 border-r border-gray-800/40 flex items-start gap-3 px-3 py-2 overflow-x-auto">
              {state?.agents.map(agent => (
                <AgentBuddy
                  key={agent.id}
                  id={agent.id}
                  name={agent.name}
                  color={agent.color}
                  status={agent.status}
                  currentThought={agent.currentThought}
                  isGolden={false}
                />
              ))}
              {/* Claude golden buddy — shown if any 'claude' type message exists */}
              {state?.messages.some(m => m.type === 'claude') && (
                <AgentBuddy
                  id="claude"
                  name="Claude"
                  color="#fbbf24"
                  status="idle"
                  currentThought=""
                  isGolden={true}
                />
              )}
            </div>

            {/* Message feed */}
            <div className="flex flex-col flex-1 min-w-0 min-h-0">
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
                {state?.messages.map(msg => {
                  const { name, color } = agentLabel(msg.agentId, state.agents);
                  const isPat = msg.type === 'pat';
                  const isClaude = msg.type === 'claude';
                  const isSystem = msg.type === 'system';

                  return (
                    <div key={msg.id} className={`flex items-start gap-1.5 ${isPat || isClaude ? 'flex-row-reverse' : ''}`}>
                      <span
                        className="text-[9px] font-mono shrink-0 mt-0.5"
                        style={{ color: isClaude ? '#fbbf24' : color }}
                      >
                        {isClaude ? '✦ ' : ''}{name}
                      </span>
                      <span
                        className={`text-[10px] font-mono leading-relaxed ${isSystem ? 'italic' : ''}`}
                        style={{
                          color: isSystem ? '#4b5563' : isClaude ? '#fde68a' : '#9ca3af',
                        }}
                      >
                        {msg.text}
                      </span>
                      <span className="text-[8px] text-gray-800 font-mono shrink-0 mt-0.5 self-end">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Pat input */}
              <div className="px-3 py-1.5 border-t border-gray-800/40 flex gap-2 items-center shrink-0">
                <input
                  ref={inputRef}
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitPatMessage(); }}
                  placeholder={state?.session.waitingForInput ? 'your turn...' : 'type to join...'}
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
            </div>
          </div>
        )}
      </div>
    </>
  );
}
