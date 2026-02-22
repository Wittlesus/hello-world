import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useProjectPath } from '../hooks/useProjectPath.js';

export function TerminalView() {
  const projectPath = useProjectPath();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create xterm instance
    const term = new Terminal({
      theme: {
        background: '#0d0d14',
        foreground: '#e2e8f0',
        cursor: '#818cf8',
        selectionBackground: '#3730a3',
        black: '#1e1e2e',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#89dceb',
        white: '#cdd6f4',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#89dceb',
        brightWhite: '#ffffff',
      },
      fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Send keystrokes to PTY
    term.onData((data) => {
      invoke('write_pty_input', { data }).catch(() => {});
    });

    // Listen for PTY output — raw bytes arrive as base64
    const unlistenPty = listen<string>('pty-data', (event) => {
      const binary = atob(event.payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      term.write(bytes);
      setStatus('ready');

      // Auto-init: once Claude's welcome banner arrives, send a greeting prompt
      if (!initializedRef.current) {
        initializedRef.current = true;
        setTimeout(() => {
          invoke('write_pty_input', {
            data: 'hw_get_context() — greet Pat with project name, workflow phase, and active tasks.\n',
          }).catch(() => {});
        }, 2000);
      }
    });

    // Start the PTY session (spawns claude with project context injected)
    invoke('start_pty_session', { projectPath })
      .catch((e) => {
        setStatus('error');
        setError(String(e));
      });

    // Handle resize
    const observer = new ResizeObserver(() => {
      fit.fit();
      invoke('resize_pty', { rows: term.rows, cols: term.cols }).catch(() => {});
    });
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      unlistenPty.then((fn) => fn());
      observer.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between shrink-0 bg-[#0d0d14]">
        <span className="text-sm font-semibold text-gray-200">⌨ Terminal</span>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${status === 'ready' ? 'bg-green-400' : status === 'error' ? 'bg-red-400' : 'bg-yellow-400 animate-pulse'}`} />
          <span className={`text-xs ${status === 'ready' ? 'text-green-400' : status === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
            {status === 'ready' ? 'Claude running' : status === 'error' ? 'Error' : 'Starting...'}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800/50 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* xterm.js container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 p-2 bg-[#0d0d14]"
        style={{ overflow: 'hidden' }}
      />
    </div>
  );
}
