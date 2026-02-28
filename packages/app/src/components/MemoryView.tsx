import { useState, useMemo } from 'react';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { EmptyState, ErrorState, LoadingState } from './LoadingState.js';
import { ViewShell } from './ViewShell.js';

interface MemoryLink {
  targetId: string;
  relationship: string;
  createdAt: string;
}

interface Memory {
  id: string;
  projectId: string;
  type: 'pain' | 'win' | 'fact' | 'decision' | 'architecture' | 'reflection' | 'skill';
  title: string;
  content: string;
  rule: string;
  tags: string[];
  severity: 'low' | 'medium' | 'high';
  synapticStrength: number;
  accessCount: number;
  lastAccessed?: string;
  createdAt: string;
  qualityScore?: number;
  fingerprint?: string;
  links?: MemoryLink[];
  supersededBy?: string;
}

interface BrainState {
  state: {
    sessionStart: string;
    messageCount: number;
    contextPhase: 'early' | 'mid' | 'late';
    synapticActivity: Record<string, unknown>;
    memoryTraces: Record<string, unknown>;
    firingFrequency: Record<string, number>;
    activeTraces: string[];
  };
}

interface MemoriesData {
  memories: Memory[];
}

const MEMORY_TYPES = ['pain', 'win', 'fact', 'decision', 'architecture', 'reflection', 'skill'] as const;
type MemoryType = (typeof MEMORY_TYPES)[number];

const TYPE_CONFIG: Record<
  MemoryType,
  { label: string; badge: string; section: string; dot: string; indicator: string }
> = {
  pain: {
    label: 'Pain',
    badge: 'bg-red-500/20 text-red-300 border border-red-500/20',
    section: 'border-red-900/40 bg-red-950/10',
    dot: 'bg-red-500',
    indicator: 'border-l-red-700/60',
  },
  win: {
    label: 'Win',
    badge: 'bg-green-500/20 text-green-300 border border-green-500/20',
    section: 'border-green-900/40 bg-green-950/10',
    dot: 'bg-green-500',
    indicator: 'border-l-green-700/60',
  },
  fact: {
    label: 'Fact',
    badge: 'bg-blue-500/20 text-blue-300 border border-blue-500/20',
    section: 'border-blue-900/40 bg-blue-950/10',
    dot: 'bg-blue-500',
    indicator: 'border-l-blue-700/60',
  },
  decision: {
    label: 'Decision',
    badge: 'bg-orange-500/20 text-orange-300 border border-orange-500/20',
    section: 'border-orange-900/40 bg-orange-950/10',
    dot: 'bg-orange-500',
    indicator: 'border-l-orange-700/60',
  },
  architecture: {
    label: 'Architecture',
    badge: 'bg-violet-500/20 text-violet-300 border border-violet-500/20',
    section: 'border-violet-900/40 bg-violet-950/10',
    dot: 'bg-violet-500',
    indicator: 'border-l-violet-700/60',
  },
  reflection: {
    label: 'Reflection',
    badge: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/20',
    section: 'border-indigo-900/40 bg-indigo-950/10',
    dot: 'bg-indigo-500',
    indicator: 'border-l-indigo-700/60',
  },
  skill: {
    label: 'Skill',
    badge: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/20',
    section: 'border-cyan-900/40 bg-cyan-950/10',
    dot: 'bg-cyan-500',
    indicator: 'border-l-cyan-700/60',
  },
};

const SEVERITY_BADGE: Record<string, string> = {
  high: 'bg-red-500/15 text-red-400 border border-red-500/20',
  medium: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20',
  low: 'bg-gray-700/40 text-gray-500 border border-gray-700/40',
};

const TAG_COLORS = [
  'bg-violet-500/20 text-violet-300',
  'bg-cyan-500/20 text-cyan-300',
  'bg-amber-500/20 text-amber-300',
  'bg-rose-500/20 text-rose-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-fuchsia-500/20 text-fuchsia-300',
  'bg-sky-500/20 text-sky-300',
  'bg-orange-500/20 text-orange-300',
];

function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0;
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

function qualityBadge(score: number): string {
  if (score >= 0.8) return 'bg-green-500/15 text-green-400 border border-green-500/20';
  if (score >= 0.5) return 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20';
  return 'bg-red-500/15 text-red-400 border border-red-500/20';
}

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const CONTENT_TRUNCATE = 160;

function MemoryRow({ memory, cfg }: { memory: Memory; cfg: (typeof TYPE_CONFIG)[MemoryType] }) {
  const [expanded, setExpanded] = useState(false);
  const [contentExpanded, setContentExpanded] = useState(false);
  const isLong = memory.content.length > CONTENT_TRUNCATE;
  const displayContent =
    contentExpanded || !isLong ? memory.content : `${memory.content.slice(0, CONTENT_TRUNCATE)}...`;

  return (
    <div
      className={`border-b border-gray-800/50 last:border-0 border-l-2 ${cfg.indicator} transition-colors ${expanded ? 'bg-white/[0.025]' : 'hover:bg-white/[0.015]'}`}
    >
      {/* Header row -- always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 cursor-pointer"
      >
        {/* Quality score badge */}
        <div className="shrink-0 mt-0.5 w-10 text-right">
          {memory.qualityScore != null ? (
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${qualityBadge(memory.qualityScore)}`}
              title={`Quality: ${memory.qualityScore.toFixed(3)}`}
            >
              {memory.qualityScore.toFixed(1)}
            </span>
          ) : (
            <span className="text-[10px] font-mono text-gray-700">--</span>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-100 leading-snug">{memory.title}</span>
            {memory.severity !== 'low' && (
              <span
                className={`text-[10px] font-medium px-1.5 py-px rounded ${SEVERITY_BADGE[memory.severity]}`}
              >
                {memory.severity}
              </span>
            )}
            {(memory.links?.length ?? 0) > 0 && (
              <span
                className="text-[10px] font-mono text-cyan-600"
                title={`${memory.links!.length} linked memories`}
              >
                {memory.links!.length}L
              </span>
            )}
          </div>

          {/* Tags */}
          {memory.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {memory.tags.map((tag) => (
                <span
                  key={tag}
                  className={`text-[10px] font-medium px-1.5 py-px rounded-full ${tagColor(tag)}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right meta */}
        <div className="shrink-0 flex flex-col items-end gap-1">
          <span className="text-[10px] font-mono text-gray-600">{relativeDate(memory.createdAt)}</span>
          <span className="text-[10px] text-gray-700">{memory.accessCount}x</span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-2.5 border-t border-gray-800/40">
          {/* Content */}
          {memory.content && (
            <div>
              <p className="text-xs text-gray-400 leading-relaxed">{displayContent}</p>
              {isLong && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setContentExpanded((v) => !v);
                  }}
                  className="text-[10px] text-gray-600 hover:text-gray-400 mt-1 transition-colors cursor-pointer"
                >
                  {contentExpanded ? 'show less' : 'show more'}
                </button>
              )}
            </div>
          )}

          {/* Rule */}
          {memory.rule && (
            <div className="bg-yellow-500/5 border border-yellow-500/15 rounded px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-yellow-600 font-semibold mb-0.5">
                Rule
              </div>
              <p className="text-xs text-yellow-300/80 leading-relaxed">{memory.rule}</p>
            </div>
          )}

          {/* Links */}
          {(memory.links?.length ?? 0) > 0 && (
            <div className="bg-cyan-500/5 border border-cyan-500/15 rounded px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-cyan-600 font-semibold mb-1">
                Links ({memory.links!.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {memory.links!.map((link, i) => (
                  <span
                    key={i}
                    className="text-[10px] text-cyan-400/80 bg-cyan-500/10 px-1.5 py-0.5 rounded font-mono"
                  >
                    {link.relationship} {link.targetId.slice(0, 10)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Superseded notice */}
          {memory.supersededBy && (
            <p className="text-[10px] text-gray-600 italic">
              Superseded by{' '}
              <span className="font-mono text-gray-500">{memory.supersededBy.slice(0, 12)}</span>
            </p>
          )}

          {/* Footer meta */}
          <div className="flex gap-4 text-[10px] font-mono text-gray-700 pt-0.5">
            <span>{memory.id.slice(0, 12)}</span>
            {memory.fingerprint && <span>fp:{memory.fingerprint.slice(0, 8)}</span>}
            {memory.lastAccessed && (
              <span>accessed {relativeDate(memory.lastAccessed)}</span>
            )}
            <span>
              strength{' '}
              <span className="text-gray-600">{memory.synapticStrength.toFixed(2)}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function MemorySection({
  type,
  memories,
  defaultOpen,
}: {
  type: MemoryType;
  memories: Memory[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const cfg = TYPE_CONFIG[type];
  const sorted = useMemo(
    () => [...memories].sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0)),
    [memories],
  );

  const avgQ =
    memories.length > 0
      ? memories.reduce((s, m) => s + (m.qualityScore ?? 0), 0) / memories.length
      : 0;

  return (
    <div className={`rounded-lg border overflow-hidden ${cfg.section}`}>
      {/* Section header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-300 flex-1 text-left">
          {cfg.label}
        </span>
        <span className="text-[10px] font-mono text-gray-600">{memories.length}</span>
        {memories.length > 0 && (
          <span
            className={`text-[10px] font-mono px-1.5 py-px rounded ${qualityBadge(avgQ)}`}
            title={`Average quality: ${avgQ.toFixed(2)}`}
          >
            avg {avgQ.toFixed(1)}
          </span>
        )}
        <span className="text-[10px] text-gray-700 ml-1">{open ? '▲' : '▼'}</span>
      </button>

      {/* Memory rows */}
      {open && sorted.length > 0 && (
        <div className="border-t border-gray-800/40">
          {sorted.map((m) => (
            <MemoryRow key={m.id} memory={m} cfg={cfg} />
          ))}
        </div>
      )}

      {open && sorted.length === 0 && (
        <div className="border-t border-gray-800/40 px-4 py-3">
          <span className="text-xs text-gray-600 italic">None stored yet</span>
        </div>
      )}
    </div>
  );
}

const PHASE_DOT: Record<string, string> = {
  early: 'bg-green-500',
  mid: 'bg-yellow-500',
  late: 'bg-red-500',
};

export function MemoryView() {
  const projectPath = useProjectPath();
  const {
    data: memoriesData,
    loading: memLoading,
    error: memError,
    refetch: memRefetch,
  } = useTauriData<MemoriesData>('get_memories', projectPath);
  const {
    data: brainData,
    loading: brainLoading,
    error: brainError,
  } = useTauriData<BrainState>('get_brain_state', projectPath);

  const [search, setSearch] = useState('');

  const memories = memoriesData?.memories ?? [];
  const brain = brainData?.state;
  const q = search.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      q
        ? memories.filter(
            (m) =>
              m.title.toLowerCase().includes(q) ||
              m.content.toLowerCase().includes(q) ||
              m.rule.toLowerCase().includes(q) ||
              m.tags.some((t) => t.toLowerCase().includes(q)),
          )
        : memories,
    [memories, q],
  );

  const byType = useMemo(() => {
    const groups: Partial<Record<MemoryType, Memory[]>> = {};
    for (const type of MEMORY_TYPES) {
      groups[type] = filtered.filter((m) => m.type === type);
    }
    return groups as Record<MemoryType, Memory[]>;
  }, [filtered]);

  const sortedTypes = useMemo(
    () => [...MEMORY_TYPES].sort((a, b) => byType[b].length - byType[a].length),
    [byType],
  );

  const totalFiltered = filtered.length;

  if (memLoading || brainLoading) return <LoadingState />;
  if (memError) return <ErrorState message={memError} onRetry={memRefetch} />;
  if (brainError) return <ErrorState message={brainError} />;

  return (
    <ViewShell
      title="Memory"
      description={
        q
          ? `${totalFiltered} of ${memories.length} memories`
          : `${memories.length} memories in the brain`
      }
    >
      {/* Brain state bar */}
      {brain && (
        <div className="flex items-center gap-5 mb-5 px-4 py-2.5 bg-[#1a1a24] border border-gray-800 rounded-lg">
          <div className="flex items-center gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${PHASE_DOT[brain.contextPhase] ?? 'bg-gray-500'}`}
            />
            <span className="text-[11px] text-gray-400">
              Phase{' '}
              <span className="text-gray-200 font-medium">{brain.contextPhase}</span>
            </span>
          </div>
          <div className="text-[11px] text-gray-400">
            Msgs{' '}
            <span className="text-gray-200 font-medium font-mono">{brain.messageCount}</span>
          </div>
          <div className="text-[11px] text-gray-400">
            Traces{' '}
            <span className="text-gray-200 font-medium font-mono">{brain.activeTraces.length}</span>
          </div>
          <div className="text-[11px] text-gray-400">
            Hot tags{' '}
            <span className="text-gray-200 font-medium font-mono">
              {Object.values(brain.firingFrequency).filter((v) => v >= 3).length}
            </span>
          </div>
        </div>
      )}

      {/* Memory capacity bar */}
      <div className="mb-5 px-4 py-2.5 bg-[#1a1a24] border border-gray-800 rounded-lg">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-gray-400">Memory Capacity</span>
          <span className="text-[11px] font-mono text-gray-300">
            {memories.length} / 1000
          </span>
        </div>
        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              memories.length >= 1000
                ? 'bg-red-500'
                : memories.length >= 800
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.min(100, (memories.length / 1000) * 100)}%` }}
          />
        </div>
        {memories.length >= 1000 && (
          <div className="text-[10px] text-red-400 mt-1">
            At capacity. Run /clean-quit or prune memories.
          </div>
        )}
      </div>

      {/* Search */}
      <div className="mb-5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, content, rule, tags..."
          className="w-full bg-[#1a1a24] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors font-sans"
        />
      </div>

      {memories.length === 0 ? (
        <EmptyState message="No memories stored yet. Claude auto-captures pain, win, and decision memories as it works. You can also call hw_store_memory directly." />
      ) : totalFiltered === 0 ? (
        <EmptyState message={`No memories match "${search}"`} />
      ) : (
        <div className="space-y-3">
          {sortedTypes.map((type) => (
            <MemorySection
              key={type}
              type={type}
              memories={byType[type]}
              defaultOpen={byType[type].length > 0}
            />
          ))}
        </div>
      )}
    </ViewShell>
  );
}
