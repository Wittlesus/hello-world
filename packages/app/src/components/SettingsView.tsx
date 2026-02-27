import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { THEMES, useThemeStore } from '../stores/theme.js';
import { AvatarPicker, getSavedAvatarId, saveAvatarId, type AvatarId } from './buddy-avatars.js';
import { ErrorState, LoadingState } from './LoadingState.js';
import { ViewShell } from './ViewShell.js';

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
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SettingsView() {
  const projectPath = useProjectPath();
  const { data, loading, error, refetch } = useTauriData<ConfigData>('get_config', projectPath);
  const [form, setForm] = useState<ProjectConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { themeId, setTheme } = useThemeStore();
  const [currentAvatar, setCurrentAvatar] = useState<AvatarId>(getSavedAvatarId);

  useEffect(() => {
    if (data?.config) setForm({ ...data.config });
  }, [data]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!form) return <LoadingState />;

  const isDirty =
    data?.config &&
    (form.name !== data.config.name ||
      form.description !== data.config.description ||
      form.defaultModel !== data.config.defaultModel ||
      form.dailyBudgetUsd !== data.config.dailyBudgetUsd ||
      form.gitIntegration !== data.config.gitIntegration);

  function update<K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const updated = { ...form, updatedAt: new Date().toISOString() };
      await invoke('save_config', { projectPath, config: { config: updated } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      refetch();
    } catch (err) {
      alert(`Save failed: ${err}`);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full bg-[#1a1a24] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500/50 transition-colors';
  const labelClass =
    'block text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5';

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
      <div className="max-w-3xl space-y-8">
        {/* Appearance */}
        <section>
          <h2 className="text-sm font-semibold text-gray-200 mb-4">Appearance</h2>
          <div className={labelClass}>Theme</div>
          <div className="grid grid-cols-5 gap-2">
            {THEMES.map((t) => {
              const active = themeId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  className={`relative flex flex-col items-center gap-2 p-3 rounded-lg border transition-all cursor-pointer ${
                    active
                      ? 'border-current bg-[#1a1a24]'
                      : 'border-gray-800 bg-[#0f0f18] hover:border-gray-600'
                  }`}
                  style={
                    active ? { borderColor: t.accent, boxShadow: `0 0 8px ${t.accent}40` } : {}
                  }
                >
                  {/* Mini block-art buddy preview */}
                  <div
                    style={{
                      fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
                      fontSize: '7px',
                      lineHeight: '1.15',
                      color: t.buddyIdle,
                      whiteSpace: 'pre',
                      textShadow: `0 0 4px ${t.buddyIdle}88`,
                      letterSpacing: '0',
                    }}
                  >
                    {'▐▛██▜▌\n▝▜●  ●▛▘\n ▘▘ ▝▝'}
                  </div>
                  <span
                    className="text-[9px] font-medium text-center leading-tight"
                    style={{ color: active ? t.accent : '#6b7280' }}
                  >
                    {t.name}
                  </span>
                  {active && (
                    <div
                      className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: t.accent }}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-600 mt-2">
            Changes buddy color and UI accent. Right-click buddy to mute/unmute.
          </p>

          <div className="mt-6">
            <div className={labelClass}>Buddy Avatar</div>
            <AvatarPicker
              selected={currentAvatar}
              onSelect={(id) => {
                saveAvatarId(id);
                setCurrentAvatar(id);
                emit('hw-avatar-changed', id).catch(() => {});
              }}
            />
            <p className="text-[10px] text-gray-600 mt-2">
              Pick a buddy character. Changes apply instantly.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-200 mb-4">Project</h2>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Version</label>
              <input
                type="text"
                value={form.version}
                disabled
                className={`${inputClass} opacity-50 cursor-not-allowed`}
              />
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
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
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
            <div>
              Created: <span className="text-gray-300">{formatDateTime(form.createdAt)}</span>
            </div>
            <div>
              Updated: <span className="text-gray-300">{formatDateTime(form.updatedAt)}</span>
            </div>
            <div>
              Path: <span className="text-gray-300 font-mono">{projectPath}</span>
            </div>
          </div>
        </section>
      </div>
    </ViewShell>
  );
}
