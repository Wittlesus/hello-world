import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string | number;
}

interface ChatHistory {
  messages: ChatMsg[];
}

function formatTime(ts: string | number): string {
  const d = new Date(typeof ts === 'number' ? ts : ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function ChatView() {
  const projectPath = useProjectPath();
  const { data } = useTauriData<ChatHistory>('get_chat_history', projectPath);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Listen for streaming chunks from Rust
  useEffect(() => {
    const unlisten = listen<{ text: string; done: boolean }>('hw-chat-chunk', (event) => {
      if (event.payload.done) {
        setStreamText('');
        setThinking(false);
      } else {
        setStreamText((prev) => prev + event.payload.text);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Auto-scroll to bottom on new messages or stream updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages?.length, streamText]);

  async function sendMessage() {
    if (!input.trim() || thinking || !projectPath) return;
    const msgText = input.trim();
    setInput('');
    setError(null);
    setThinking(true);

    try {
      // Persist user message immediately so it appears in chat
      await invoke('append_chat_message', { projectPath, role: 'user', text: msgText });
      // Spawn streaming claude subprocess — chunks arrive via hw-chat-chunk events,
      // full response written to chat-out.json on completion → file watcher → UI refetch
      await invoke('send_claude_message', { projectPath, message: msgText });
    } catch (err) {
      setError(String(err));
      setThinking(false);
    } finally {
      textareaRef.current?.focus();
    }
  }

  async function resetChat() {
    await invoke('reset_chat_session');
    // Clear local history file by writing an empty messages array
    await invoke('append_chat_message', {
      projectPath,
      role: 'assistant',
      text: '— New conversation started —',
    }).catch(() => {});
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const messages = data?.messages ?? [];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between shrink-0 bg-[#0d0d14]">
        <span className="text-sm font-semibold text-gray-200">💬 Chat</span>
        <div className="flex items-center gap-3">
          {thinking && (
            <span className="text-xs text-purple-400 animate-pulse">Claude is thinking...</span>
          )}
          <button
            onClick={resetChat}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            title="Start new conversation"
          >
            new chat
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800/50 text-xs text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <span className="text-4xl">💬</span>
            <p className="text-sm text-gray-300 font-medium">Chat with Claude</p>
            <p className="text-xs text-gray-500 max-w-xs">
              Type a message below. Claude responds directly — no terminal needed.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <span className="shrink-0 w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-[10px] font-bold text-purple-300 mt-0.5">
                C
              </span>
            )}
            <div className={`max-w-[78%] flex flex-col gap-0.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                msg.role === 'user'
                  ? 'bg-blue-600/25 text-blue-100 border border-blue-500/25 rounded-tr-sm'
                  : 'bg-[#1a1a24] text-gray-100 border border-gray-800 rounded-tl-sm'
              }`}>
                {msg.text}
              </div>
              <span className="text-[10px] text-gray-600 px-1">{formatTime(msg.timestamp)}</span>
            </div>
            {msg.role === 'user' && (
              <span className="shrink-0 w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-[10px] font-bold text-blue-300 mt-0.5">
                P
              </span>
            )}
          </div>
        ))}

        {/* Streaming response bubble — shows live as chunks arrive */}
        {thinking && (
          <div className="flex gap-2 justify-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-[10px] font-bold text-purple-300 mt-0.5">
              C
            </span>
            <div className="max-w-[78%] bg-[#1a1a24] border border-gray-800 rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-gray-100 leading-relaxed whitespace-pre-wrap break-words">
              {streamText || (
                <div className="flex gap-1 py-0.5">
                  <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 p-3 flex gap-2 items-end shrink-0">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={thinking ? 'Claude is thinking...' : 'Message Claude... (Enter to send, Shift+Enter for newline)'}
          disabled={thinking}
          rows={1}
          className="flex-1 bg-[#1a1a24] border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-100 resize-none outline-none focus:border-blue-500/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ minHeight: '38px', maxHeight: '120px' }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
          }}
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || thinking}
          className="shrink-0 px-4 py-2 bg-blue-600/25 text-blue-300 border border-blue-500/25 rounded-xl text-sm font-medium hover:bg-blue-600/35 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {thinking ? '...' : '↑'}
        </button>
      </div>
    </div>
  );
}
