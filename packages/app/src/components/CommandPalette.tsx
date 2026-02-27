import { invoke } from '@tauri-apps/api/core';
import { Command, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app.js';

interface SlashCommand {
  cmd: string;
  desc: string;
  category: 'session' | 'audit' | 'social' | 'content' | 'dev';
}

const COMMANDS: SlashCommand[] = [
  // Session
  { cmd: '/clean-quit', desc: 'End session cleanly: handoff, memory review, commit', category: 'session' },
  { cmd: '/reset', desc: 'Save context summary and restart Claude Code', category: 'session' },
  { cmd: '/resume', desc: 'Continue the AI CEO experiment', category: 'session' },

  // Audit
  { cmd: '/fullsweep', desc: 'Full system audit: 5 parallel agents audit everything', category: 'audit' },
  { cmd: '/memory-gardener:garden', desc: 'Audit all memory files for staleness and bloat', category: 'audit' },
  { cmd: '/memory-gardener:prune', desc: 'Auto-remove stale entries from memory files', category: 'audit' },
  { cmd: '/audit', desc: 'Full product audit across all deployed products', category: 'audit' },

  // Social
  { cmd: '/social-engine:engage twitter', desc: 'Twitter engagement session as @WSDevGuy', category: 'social' },
  { cmd: '/social-engine:engage reddit', desc: 'Reddit engagement session as WSDevGuy', category: 'social' },
  { cmd: '/social-engine:journal', desc: 'View social media account states', category: 'social' },
  { cmd: '/pulse', desc: 'Unified metrics: Stripe + GitHub + social', category: 'social' },
  { cmd: '/pulse:revenue', desc: 'Quick Stripe revenue check', category: 'social' },

  // Content
  { cmd: '/content-pipeline:scan', desc: 'Scan AI news, generate takes, output briefing', category: 'content' },
  { cmd: '/content-pipeline:adapt', desc: 'Adapt content for multiple platforms', category: 'content' },
  { cmd: '/content-pipeline:thread', desc: 'Turn content into a Twitter thread', category: 'content' },
  { cmd: '/content-writer', desc: 'Write blog posts, articles, docs, copy', category: 'content' },
  { cmd: '/last30days', desc: 'Research a topic from last 30 days across platforms', category: 'content' },

  // Dev
  { cmd: '/commit', desc: 'Create a git commit', category: 'dev' },
  { cmd: '/commit-commands:commit-push-pr', desc: 'Commit, push, and open a PR', category: 'dev' },
  { cmd: '/code-review:code-review', desc: 'Code review a pull request', category: 'dev' },
  { cmd: '/market-intel:research', desc: 'Competitive validation for a product idea', category: 'dev' },
  { cmd: '/deploy', desc: 'Deploy a project to Vercel', category: 'dev' },
];

const CATEGORY_LABELS: Record<string, string> = {
  session: 'Session',
  audit: 'Audit & Health',
  social: 'Social & Metrics',
  content: 'Content & Research',
  dev: 'Dev & Deploy',
};

const CATEGORY_ORDER = ['session', 'audit', 'social', 'content', 'dev'];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [filter, setFilter] = useState('');
  const setView = useAppStore((s) => s.setView);

  useEffect(() => {
    if (!open) return;
    setFilter('');
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const filtered = filter
    ? COMMANDS.filter(
        (c) =>
          c.cmd.toLowerCase().includes(filter.toLowerCase()) ||
          c.desc.toLowerCase().includes(filter.toLowerCase()),
      )
    : COMMANDS;

  const handleClick = (cmd: string) => {
    // Switch to terminal and write the command
    setView('terminal');
    onClose();
    // Small delay to let terminal focus, then write
    setTimeout(() => {
      invoke('write_pty_input', { data: cmd + '\n' }).catch(() => {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(cmd).catch(() => {});
      });
    }, 150);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a24] border border-gray-700 rounded-lg shadow-2xl w-[480px] max-h-[70vh] flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <Command size={14} className="text-indigo-400" />
          <h2 className="text-sm font-semibold text-white flex-1">Commands</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 pb-3">
          <input
            type="text"
            placeholder="Filter commands..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-[#12121a] border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500/50"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
          {CATEGORY_ORDER.map((cat) => {
            const items = filtered.filter((c) => c.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} className="mb-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">
                  {CATEGORY_LABELS[cat]}
                </div>
                {items.map((c) => (
                  <button
                    key={c.cmd}
                    onClick={() => handleClick(c.cmd)}
                    className="w-full text-left flex items-baseline gap-3 py-1.5 px-2 -mx-2 rounded hover:bg-indigo-500/10 transition-colors group"
                  >
                    <code className="text-[12px] text-indigo-400 group-hover:text-indigo-300 font-mono whitespace-nowrap">
                      {c.cmd}
                    </code>
                    <span className="text-[12px] text-gray-500 group-hover:text-gray-400 truncate">
                      {c.desc}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-sm text-gray-600 text-center py-6">No matching commands</div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-800 text-[10px] text-gray-600">
          Click to run in terminal. Esc to close.
        </div>
      </div>
    </div>
  );
}
