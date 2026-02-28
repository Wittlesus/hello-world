import { invoke } from '@tauri-apps/api/core';
import {
  Bot,
  BookOpen,
  Brain,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Plus,
  Rocket,
  Settings2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';

// ── Types ────────────────────────────────────────────────────────

type ContextMode = 'full' | 'smart' | 'fresh';
type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

interface PresetAgent {
  id: string;
  name: string;
  description: string;
  purpose: string;
  icon: 'book' | 'search' | 'brain' | 'bot';
  color: string;
  contextMode: ContextMode;
  agency: string;
  restrictions: string;
}

interface FactoryRun {
  id: string;
  agentId: string;
  agentName: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  summary?: string;
  changelog?: string[];
  error?: string;
}

interface CustomAgent {
  id: string;
  name: string;
  purpose: string;
  agency: string;
  restrictions: string;
  persona: string;
  contextMode: ContextMode;
  createdAt: string;
}

interface FactoryState {
  runs: FactoryRun[];
  customAgents: CustomAgent[];
}

// ── Preset Agents ────────────────────────────────────────────────

const PRESETS: PresetAgent[] = [
  {
    id: 'janitor',
    name: 'CLAUDE.md Janitor',
    description: 'Audits CLAUDE.md against actual project state. Finds stale paths, outdated sections, missing features.',
    purpose: 'Keep CLAUDE.md accurate and current. Compare documented state against actual codebase, fix drift.',
    icon: 'book',
    color: '#6366f1',
    contextMode: 'full',
    agency: 'Can read all project files. Proposes edits to CLAUDE.md only.',
    restrictions: 'Do not modify any file other than CLAUDE.md. Do not change project code.',
  },
  {
    id: 'auditor',
    name: 'Codebase Auditor',
    description: 'Reviews code quality, finds dead code, checks for anti-patterns, verifies consistency.',
    purpose: 'Audit codebase for quality issues, dead code, inconsistencies, and anti-patterns. Report findings.',
    icon: 'search',
    color: '#f59e0b',
    contextMode: 'full',
    agency: 'Read-only access to all source files. Produces a findings report.',
    restrictions: 'Do not modify any files. Report only -- changes require separate approval.',
  },
  {
    id: 'gardener',
    name: 'Memory Gardener',
    description: 'Prunes stale memories, resolves contradictions, merges duplicates, maintains brain health.',
    purpose: 'Maintain brain memory health. Find stale, contradictory, or duplicate memories and clean them up.',
    icon: 'brain',
    color: '#10b981',
    contextMode: 'full',
    agency: 'Can read and modify memories via MCP tools. Can prune, merge, and update.',
    restrictions: 'Never delete memories without archiving. Prefer merge over delete. Document all changes.',
  },
];

// ── Icon component ───────────────────────────────────────────────

function AgentIcon({ icon, color, size = 20 }: { icon: string; color: string; size?: number }) {
  const props = { size, style: { color } };
  switch (icon) {
    case 'book': return <BookOpen {...props} />;
    case 'search': return <FileSearch {...props} />;
    case 'brain': return <Brain {...props} />;
    case 'bot': return <Bot {...props} />;
    default: return <Bot {...props} />;
  }
}

// ── Status badge ─────────────────────────────────────────────────

const STATUS_STYLES: Record<RunStatus, string> = {
  queued: 'bg-gray-700 text-gray-300',
  running: 'bg-blue-500/20 text-blue-300',
  completed: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-red-500/20 text-red-300',
  cancelled: 'bg-gray-600/20 text-gray-400',
};

function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

// ── Context mode selector ────────────────────────────────────────

const CONTEXT_LABELS: Record<ContextMode, { label: string; desc: string }> = {
  full: { label: 'Full', desc: 'Inject complete project context' },
  smart: { label: 'Smart', desc: 'Inject relevant context based on purpose' },
  fresh: { label: 'Fresh', desc: 'No context injection -- agent starts clean' },
};

function ContextModeSelect({
  value,
  onChange,
}: {
  value: ContextMode;
  onChange: (mode: ContextMode) => void;
}) {
  return (
    <div className="flex gap-1">
      {(Object.keys(CONTEXT_LABELS) as ContextMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          title={CONTEXT_LABELS[mode].desc}
          className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
            value === mode
              ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-500/40'
              : 'bg-gray-800/50 text-gray-500 border border-gray-700/50 hover:text-gray-300'
          }`}
        >
          {CONTEXT_LABELS[mode].label}
        </button>
      ))}
    </div>
  );
}

// ── Preset agent card ────────────────────────────────────────────

function PresetCard({
  agent,
  onDeploy,
  onEdit,
}: {
  agent: PresetAgent;
  onDeploy: (agent: PresetAgent) => void;
  onEdit: (agent: PresetAgent) => void;
}) {
  return (
    <div className="bg-[#12121c] border border-gray-800/60 rounded-lg p-4 hover:border-gray-700/60 transition-colors group">
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${agent.color}15` }}
        >
          <AgentIcon icon={agent.icon} color={agent.color} size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-100">{agent.name}</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">
              {agent.contextMode}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{agent.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-800/40">
        <button
          type="button"
          onClick={() => onDeploy(agent)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-indigo-500/20 text-indigo-300 rounded hover:bg-indigo-500/30 transition-colors"
        >
          <Rocket size={12} />
          Deploy
        </button>
        <button
          type="button"
          onClick={() => onEdit(agent)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-gray-500 rounded hover:text-gray-300 hover:bg-gray-800/50 transition-colors"
        >
          <Settings2 size={12} />
          Edit
        </button>
      </div>
    </div>
  );
}

// ── Custom builder form ──────────────────────────────────────────

interface BuilderForm {
  name: string;
  purpose: string;
  agency: string;
  restrictions: string;
  persona: string;
  contextMode: ContextMode;
}

const EMPTY_FORM: BuilderForm = {
  name: '',
  purpose: '',
  agency: '',
  restrictions: '',
  persona: '',
  contextMode: 'full',
};

function CustomBuilder({
  open,
  onClose,
  onDeploy,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onDeploy: (form: BuilderForm) => void;
  initial?: BuilderForm;
}) {
  const [form, setForm] = useState<BuilderForm>(initial ?? EMPTY_FORM);

  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);

  if (!open) return null;

  const canDeploy = form.name.trim() && form.purpose.trim();

  return (
    <div className="bg-[#12121c] border border-gray-800/60 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/40">
        <div className="flex items-center gap-2">
          <Plus size={14} className="text-indigo-400" />
          <span className="text-sm font-medium text-gray-200">Custom Agent Builder</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-600 hover:text-gray-300 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">
            Name
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., Test Writer, Dependency Updater"
            className="w-full bg-[#0a0a14] border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-700 focus:border-indigo-500/50 focus:outline-none"
          />
        </div>

        {/* Purpose */}
        <div>
          <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">
            Purpose
          </label>
          <textarea
            value={form.purpose}
            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            placeholder="What should this agent accomplish? Be specific."
            rows={2}
            className="w-full bg-[#0a0a14] border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-700 focus:border-indigo-500/50 focus:outline-none resize-none"
          />
        </div>

        {/* Agency + Restrictions side by side */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">
              Agency
            </label>
            <textarea
              value={form.agency}
              onChange={(e) => setForm({ ...form, agency: e.target.value })}
              placeholder="What can this agent do?"
              rows={2}
              className="w-full bg-[#0a0a14] border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-700 focus:border-indigo-500/50 focus:outline-none resize-none"
            />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">
              Restrictions
            </label>
            <textarea
              value={form.restrictions}
              onChange={(e) => setForm({ ...form, restrictions: e.target.value })}
              placeholder="What should it NOT do?"
              rows={2}
              className="w-full bg-[#0a0a14] border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-700 focus:border-indigo-500/50 focus:outline-none resize-none"
            />
          </div>
        </div>

        {/* Persona */}
        <div>
          <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">
            Persona / Character / Bias{' '}
            <span className="text-gray-700 normal-case tracking-normal">
              (experimental -- how does personality affect decisions?)
            </span>
          </label>
          <input
            type="text"
            value={form.persona}
            onChange={(e) => setForm({ ...form, persona: e.target.value })}
            placeholder="e.g., Skeptical senior engineer, Optimistic product manager"
            className="w-full bg-[#0a0a14] border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-700 focus:border-indigo-500/50 focus:outline-none"
          />
        </div>

        {/* Context mode */}
        <div>
          <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">
            Context Mode
          </label>
          <ContextModeSelect
            value={form.contextMode}
            onChange={(mode) => setForm({ ...form, contextMode: mode })}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => onDeploy(form)}
            disabled={!canDeploy}
            className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium rounded transition-colors ${
              canDeploy
                ? 'bg-indigo-500/30 text-indigo-200 hover:bg-indigo-500/40'
                : 'bg-gray-800/50 text-gray-600 cursor-not-allowed'
            }`}
          >
            <Rocket size={13} />
            Deploy Agent
          </button>
          <button
            type="button"
            onClick={() => setForm(EMPTY_FORM)}
            className="px-3 py-2 text-[12px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Run list item ────────────────────────────────────────────────

function RunItem({ run }: { run: FactoryRun }) {
  const [expanded, setExpanded] = useState(run.status === 'running');
  const elapsed = run.completedAt
    ? formatDuration(new Date(run.startedAt), new Date(run.completedAt))
    : run.status === 'running'
      ? 'running...'
      : '';

  return (
    <div className="bg-[#12121c] border border-gray-800/60 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-gray-600 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-gray-600 shrink-0" />
        )}
        <span className="text-sm text-gray-200 flex-1 truncate">{run.agentName}</span>
        <span className="text-[10px] text-gray-600 font-mono mr-2">{elapsed}</span>
        <StatusBadge status={run.status} />
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-gray-800/30">
          {run.summary && (
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">{run.summary}</p>
          )}
          {run.changelog && run.changelog.length > 0 && (
            <div className="mt-2">
              <span className="text-[10px] text-gray-600 uppercase tracking-wider">Changelog</span>
              <ul className="mt-1 space-y-0.5">
                {run.changelog.map((entry, i) => (
                  <li key={i} className="text-xs text-gray-500 pl-2 border-l border-gray-800">
                    {entry}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {run.error && (
            <p className="text-xs text-red-400/80 mt-2">{run.error}</p>
          )}
          {!run.summary && !run.error && (
            <p className="text-xs text-gray-600 mt-2 italic">No output yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${remainSecs}s`;
}

function generateId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── Main view ────────────────────────────────────────────────────

export function AgentFactoryView() {
  const projectPath = useProjectPath();
  const { data: factoryData } = useTauriData<FactoryState>('get_factory', projectPath);
  const [runs, setRuns] = useState<FactoryRun[]>([]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderInitial, setBuilderInitial] = useState<BuilderForm | undefined>(undefined);
  const initializedRef = useRef(false);

  // Load persisted runs from factory.json on first data load
  useEffect(() => {
    if (factoryData?.runs && !initializedRef.current) {
      setRuns(factoryData.runs);
      initializedRef.current = true;
    }
  }, [factoryData]);

  // Persist runs to factory.json whenever they change (after initial load)
  const persistRuns = useCallback(
    (newRuns: FactoryRun[]) => {
      if (!projectPath) return;
      const state: FactoryState = {
        runs: newRuns,
        customAgents: factoryData?.customAgents ?? [],
      };
      invoke('save_factory', { projectPath, data: state }).catch(() => {
        // Rust command may not exist yet -- silently ignore until app restart
      });
    },
    [projectPath, factoryData?.customAgents],
  );

  const handleDeployPreset = useCallback((agent: PresetAgent) => {
    const run: FactoryRun = {
      id: generateId(),
      agentId: agent.id,
      agentName: agent.name,
      status: 'queued',
      startedAt: new Date().toISOString(),
    };
    setRuns((prev) => {
      const updated = [run, ...prev];
      persistRuns(updated);
      return updated;
    });
  }, [persistRuns]);

  const handleEditPreset = useCallback((agent: PresetAgent) => {
    setBuilderInitial({
      name: agent.name,
      purpose: agent.purpose,
      agency: agent.agency,
      restrictions: agent.restrictions,
      persona: '',
      contextMode: agent.contextMode,
    });
    setBuilderOpen(true);
  }, []);

  const handleDeployCustom = useCallback((form: BuilderForm) => {
    const run: FactoryRun = {
      id: generateId(),
      agentId: `custom_${Date.now().toString(36)}`,
      agentName: form.name,
      status: 'queued',
      startedAt: new Date().toISOString(),
    };
    setRuns((prev) => {
      const updated = [run, ...prev];
      persistRuns(updated);
      return updated;
    });
    setBuilderOpen(false);
    setBuilderInitial(undefined);
  }, [persistRuns]);

  const activeRuns = runs.filter((r) => r.status === 'running' || r.status === 'queued');
  const completedRuns = runs.filter(
    (r) => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled',
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white">Agent Factory</h1>
          <p className="text-sm text-gray-400 mt-1">
            Deploy single-agent missions with full context and accountability
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!builderOpen && (
            <button
              type="button"
              onClick={() => {
                setBuilderInitial(undefined);
                setBuilderOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-indigo-500/20 text-indigo-300 rounded hover:bg-indigo-500/30 transition-colors"
            >
              <Plus size={14} />
              Custom Agent
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-6 space-y-6">
          {/* Custom builder (when open) */}
          {builderOpen && (
            <CustomBuilder
              open={builderOpen}
              onClose={() => {
                setBuilderOpen(false);
                setBuilderInitial(undefined);
              }}
              onDeploy={handleDeployCustom}
              initial={builderInitial}
            />
          )}

          {/* Pre-built agents */}
          <div>
            <h2 className="text-[11px] uppercase tracking-widest text-gray-500 font-semibold mb-3">
              Pre-built Agents
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {PRESETS.map((agent) => (
                <PresetCard
                  key={agent.id}
                  agent={agent}
                  onDeploy={handleDeployPreset}
                  onEdit={handleEditPreset}
                />
              ))}
            </div>
          </div>

          {/* Active missions */}
          {activeRuns.length > 0 && (
            <div>
              <h2 className="text-[11px] uppercase tracking-widest text-gray-500 font-semibold mb-3">
                Active Missions ({activeRuns.length})
              </h2>
              <div className="space-y-2">
                {activeRuns.map((run) => (
                  <RunItem key={run.id} run={run} />
                ))}
              </div>
            </div>
          )}

          {/* Completed missions */}
          {completedRuns.length > 0 && (
            <div>
              <h2 className="text-[11px] uppercase tracking-widest text-gray-500 font-semibold mb-3">
                Completed ({completedRuns.length})
              </h2>
              <div className="space-y-2">
                {completedRuns.map((run) => (
                  <RunItem key={run.id} run={run} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {runs.length === 0 && !builderOpen && (
            <div className="text-center py-12">
              <Rocket size={32} className="text-gray-700 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No missions deployed yet.</p>
              <p className="text-xs text-gray-600 mt-1">
                Deploy a pre-built agent or create a custom one above.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
