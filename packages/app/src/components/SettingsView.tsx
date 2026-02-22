import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTauriData } from '../hooks/useTauriData.js';
import { ViewShell } from './ViewShell.js';
import { LoadingState, ErrorState } from './LoadingState.js';
import { PROJECT_PATH } from '../config.js';

interface ProjectConfig {
  name: string;
  version: string;
  description: string;
  gitIntegration: boolean;
  defaultModel: string;
  dailyBudgetUsd: number;
  createdAt: string;
  updatedAt: string;
}

interface ConfigData {
  config: ProjectConfig;
}

const MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'gpt-4o',
  'gpt-4o-mini',
  'gemini-2.0-flash',
];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function SettingsView() {
  const { data, loading, error, refetch } = useTauriData<ConfigData>('get_config');
  const [form, setForm] = useState<ProjectConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.config) setForm({ ...data.config });
  }, [data]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!form) return <LoadingState />;

  const isDirty = data?.config && (
    form.name !== data.config.name ||
    form.description !== data.config.description ||
    form.defaultModel !== data.config.defaultModel ||
    form.dailyBudgetUsd !== data.config.dailyBudgetUsd ||
    form.gitIntegration !== data.config.gitIntegration
  );

  function update<K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K]) {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev);
    setSaved(false);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const updated = { ...form, updatedAt: new Date().toISOString() };
      await invoke('save_config', { projectPath: PROJECT_PATH, config: { config: updated } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      refetch();
    } catch (err) {
      alert(`Save failed: ${err}`);
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'w-full bg-[#1a1a24] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500/50 transition-colors';
  const labelClass = 'block text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5';

  return (
    <ViewShell
      title="Settings"
      description="Project configuration"
      actions={
        <button
          type="button"
          onClick={save}
          disabled={!isDirty || saving}
          className={`text-xs px-4 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
            saved
              ? 'bg-green-500/20 text-green-300'
              : isDirty
                ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
                : 'bg-gray-800 text-gray-600 cursor-not-allowed'
          }`}
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
        </button>
      }
    >
      <div className="max-w-2xl space-y-8">
        <section>
          <h2 className="text-sm font-semibold text-gray-200 mb-4">Project</h2>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Name</label>
              <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Version</label>
              <input type="text" value={form.version} disabled className={`${inputClass} opacity-50 cursor-not-allowed`} />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                rows={2}
                className={`${inputClass} resize-none`}
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-200 mb-4">Agent Configuration</h2>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Default Model</label>
              <select
                value={form.defaultModel}
                onChange={(e) => update('defaultModel', e.target.value)}
                className={inputClass}
              >
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Daily Budget (USD)</label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={form.dailyBudgetUsd}
                onChange={(e) => update('dailyBudgetUsd', parseFloat(e.target.value) || 0)}
                className={inputClass}
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-200 mb-4">Integration</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.gitIntegration}
              onChange={(e) => update('gitIntegration', e.target.checked)}
              className="w-4 h-4 rounded border-gray-700 bg-[#1a1a24] text-blue-500 focus:ring-blue-500/50"
            />
            <span className="text-sm text-gray-300">Git integration</span>
          </label>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-200 mb-4">Metadata</h2>
          <div className="space-y-2 text-xs text-gray-400">
            <div>Created: <span className="text-gray-300">{formatDateTime(form.createdAt)}</span></div>
            <div>Updated: <span className="text-gray-300">{formatDateTime(form.updatedAt)}</span></div>
            <div>Path: <span className="text-gray-300 font-mono">{PROJECT_PATH}</span></div>
          </div>
        </section>
      </div>
    </ViewShell>
  );
}
