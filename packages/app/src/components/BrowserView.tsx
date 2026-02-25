import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Globe, RotateCw, X, ExternalLink, Lock, Unlock } from 'lucide-react';
import { useProjectPath } from '../hooks/useProjectPath.js';

interface BrowserState {
  open: boolean;
  url: string;
  title: string;
  status: string;
  lockHolder: string | null;
  historyLength: number;
  history: Array<{ url: string; title: string; visited_at: number }>;
  extractedPreview: string;
}

const EMPTY_STATE: BrowserState = {
  open: false,
  url: '',
  title: '',
  status: 'idle',
  lockHolder: null,
  historyLength: 0,
  history: [],
  extractedPreview: '',
};

export function BrowserView() {
  const projectPath = useProjectPath();
  const [state, setState] = useState<BrowserState>(EMPTY_STATE);
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const boundsSet = useRef(false);

  // Fetch browser state
  const refreshState = async () => {
    try {
      const s = await invoke<BrowserState>('browser_get_state');
      setState(s);
    } catch {
      setState(EMPTY_STATE);
    }
  };

  // Send bounds of the content area to Rust so the webview is positioned correctly
  const updateBounds = useCallback(async () => {
    if (!contentRef.current) return;
    const rect = contentRef.current.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    try {
      await invoke('browser_set_bounds', {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
      boundsSet.current = true;
    } catch {
      // Browser not open yet, that's fine
    }
  }, []);

  // Show/hide webview when this tab becomes active/inactive
  useEffect(() => {
    // When BrowserView mounts (tab is active), show the webview and update bounds
    if (state.open) {
      invoke('browser_set_visible', { visible: true }).catch(() => {});
      updateBounds();
    }

    // When BrowserView unmounts (tab switches away), hide the webview
    return () => {
      invoke('browser_set_visible', { visible: false }).catch(() => {});
    };
  }, [state.open, updateBounds]);

  // Observe size changes on the content area
  useEffect(() => {
    if (!contentRef.current) return;
    const observer = new ResizeObserver(() => {
      if (state.open) updateBounds();
    });
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [state.open, updateBounds]);

  useEffect(() => {
    refreshState();
    const unsub1 = listen('hw-browser-opened', () => {
      refreshState();
      // Small delay to let React render, then send bounds
      setTimeout(updateBounds, 100);
    });
    const unsub2 = listen('hw-browser-closed', () => {
      setState(EMPTY_STATE);
      boundsSet.current = false;
    });
    const unsub3 = listen<string[]>('hw-files-changed', refreshState);
    const interval = setInterval(refreshState, 2000);
    return () => {
      unsub1.then(fn => fn());
      unsub2.then(fn => fn());
      unsub3.then(fn => fn());
      clearInterval(interval);
    };
  }, [updateBounds]);

  const handleNavigate = async () => {
    if (!urlInput.trim()) return;
    setLoading(true);
    setError('');
    let url = urlInput.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    try {
      if (state.open) {
        await invoke('browser_navigate', { url });
      } else {
        await invoke('browser_open', { projectPath, url });
      }
      setUrlInput('');
      setTimeout(refreshState, 500);
      // After opening, send bounds so the webview appears in the right spot
      setTimeout(updateBounds, 200);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    try {
      await invoke('browser_close');
      setState(EMPTY_STATE);
      boundsSet.current = false;
    } catch (e) {
      setError(String(e));
    }
  };

  const handleExtract = async () => {
    setLoading(true);
    try {
      await invoke('browser_extract_content', { selector: null, maxChars: 8000 });
      setTimeout(refreshState, 1000);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const statusColor = {
    idle: 'text-gray-500',
    loading: 'text-yellow-400',
    ready: 'text-green-400',
    error: 'text-red-400',
  }[state.status] || 'text-gray-500';

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <Globe size={18} className="text-blue-400 shrink-0" />
        <h2 className="text-sm font-semibold text-white">Safe Browser</h2>
        <span className={`text-[10px] uppercase font-mono ${statusColor}`}>
          {state.status}
        </span>
        {state.lockHolder && (
          <span className="flex items-center gap-1 text-[10px] text-orange-400">
            <Lock size={10} /> {state.lockHolder}
          </span>
        )}
        {state.open && !state.lockHolder && (
          <span className="flex items-center gap-1 text-[10px] text-gray-500">
            <Unlock size={10} /> available
          </span>
        )}
        {state.open && state.title && (
          <span className="text-[10px] text-gray-400 truncate ml-auto max-w-[300px]">
            {state.title}
          </span>
        )}
      </div>

      {/* URL bar */}
      <div className="flex gap-2 shrink-0">
        <input
          type="text"
          value={urlInput || state.url}
          onChange={(e) => setUrlInput(e.target.value)}
          onFocus={() => { if (!urlInput) setUrlInput(state.url); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleNavigate(); }}
          placeholder="Enter URL (https://...)"
          className="flex-1 bg-[#1a1a2e] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none font-mono text-xs"
        />
        <button
          onClick={handleNavigate}
          disabled={loading}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-xs rounded font-medium"
        >
          Go
        </button>
        {state.open && (
          <>
            <button onClick={handleExtract} disabled={loading} className="p-1.5 hover:bg-gray-800 rounded" title="Re-extract content">
              <RotateCw size={14} className="text-gray-400" />
            </button>
            <button onClick={handleClose} className="p-1.5 hover:bg-gray-800 rounded" title="Close browser">
              <X size={14} className="text-red-400" />
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2 shrink-0">
          {error}
        </div>
      )}

      {/* Browser content area -- this is where the embedded webview renders */}
      <div
        ref={contentRef}
        className="flex-1 min-h-0 relative rounded overflow-hidden"
        style={{ background: state.open ? '#fff' : undefined }}
      >
        {/* Empty state -- shown when no browser is open */}
        {!state.open && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d0d1a] border border-gray-800 rounded">
            <div className="text-center text-gray-600">
              <Globe size={32} className="mx-auto mb-3 opacity-30" />
              <div className="text-sm mb-1">No browser window open</div>
              <div className="text-xs">Enter a URL above or use hw_browser_navigate from MCP</div>
            </div>
          </div>
        )}
        {/* When open, the Tauri child webview overlays this div.
            The white background prevents flash-of-dark while loading. */}
      </div>

      {/* History */}
      {state.history.length > 0 && (
        <div className="max-h-24 overflow-y-auto shrink-0">
          <div className="text-[10px] text-gray-500 uppercase font-semibold mb-1 tracking-wider">
            History ({state.historyLength})
          </div>
          <div className="space-y-0.5">
            {state.history.map((h, i) => (
              <button
                key={i}
                onClick={() => { setUrlInput(h.url); }}
                className="w-full text-left text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 rounded px-2 py-0.5 truncate flex items-center gap-2"
              >
                <ExternalLink size={10} className="shrink-0 opacity-40" />
                <span className="truncate">{h.title || h.url}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Security info */}
      <div className="text-[9px] text-gray-600 border-t border-gray-800 pt-2 shrink-0">
        Embedded browser -- no Tauri IPC access. Downloads blocked. Navigation guard active.
      </div>
    </div>
  );
}
