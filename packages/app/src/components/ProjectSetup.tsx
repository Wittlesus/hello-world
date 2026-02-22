import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  onProjectSet: (path: string) => void;
}

export function ProjectSetup({ onProjectSet }: Props) {
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const trimmed = path.trim();
    if (!trimmed) return;
    setSaving(true);
    setError('');
    try {
      await invoke('set_app_project_path', { projectPath: trimmed });
      onProjectSet(trimmed);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-[#0a0a0f]">
      <div className="w-full max-w-md px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">Hello World</h1>
          <p className="text-sm text-gray-400">
            Point to a project initialized with <code className="text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded">hello-world init</code>
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">
              Project directory
            </label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              placeholder="C:/Users/you/your-project"
              className="w-full bg-[#1a1a24] border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-blue-500/50 transition-colors font-mono"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={!path.trim() || saving}
            className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors cursor-pointer"
          >
            {saving ? 'Checking...' : 'Open Project'}
          </button>

          <p className="text-[11px] text-gray-600 text-center">
            The path is saved to <code>~/.hello-world-app.json</code> and remembered across restarts.
          </p>
        </div>
      </div>
    </div>
  );
}
