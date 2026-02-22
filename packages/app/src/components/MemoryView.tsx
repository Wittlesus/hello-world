import { useState } from 'react';
import { useTauriData } from '../hooks/useTauriData.js';
import { ViewShell } from './ViewShell.js';
import { LoadingState, ErrorState, EmptyState } from './LoadingState.js';

interface Memory {
  id: string;
  projectId: string;
  type: 'pain' | 'win' | 'fact' | 'decision' | 'architecture';
  title: string;
  content: string;
  rule: string;
  tags: string[];
  severity: 'low' | 'medium' | 'high';
  synapticStrength: number;
  accessCount: number;
  lastAccessed?: string;
  createdAt: string;
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

type MemoryType = Memory['type'] | 'all';

const TYPE_STYLE: Record<string, string> = {
  pain: 'bg-red-500/20 text-red-300',
  win: 'bg-green-500/20 text-green-300',
  fact: 'bg-blue-500/20 text-blue-300',
  decision: 'bg-orange-500/20 text-orange-300',
  architecture: 'bg-violet-500/20 text-violet-300',
};

const SEVERITY_STYLE: Record<string, string> = {
  high: 'bg-red-500/20 text-red-300',
  medium: 'bg-yellow-500/20 text-yellow-300',
  low: 'bg-gray-500/20 text-gray-400',
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

const PHASE_STYLE: Record<string, string> = {
  early: 'bg-green-500',
  mid: 'bg-yellow-500',
  late: 'bg-red-500',
};

function MemoryCard({ memory }: { memory: Memory }) {
  const [expanded, setExpanded] = useState(false);
  const strengthPercent = Math.min(100, Math.max(0, (memory.synapticStrength / 2) * 100));

  return (
    <button
      type="button"
      onClick={() => setExpanded((prev) => !prev)}
      className="w-full text-left bg-[#1a1a24] border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${TYPE_STYLE[memory.type]}`}>
            {memory.type}
          </span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${SEVERITY_STYLE[memory.severity]}`}>
            {memory.severity}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-gray-600" title="Access count">{memory.accessCount}x</span>
          <div className="w-12 h-1.5 bg-gray-800 rounded-full overflow-hidden" title={`Synaptic strength: ${memory.synapticStrength.toFixed(2)}`}>
            <div className="h-full bg-emerald-500/60 rounded-full" style={{ width: `${strengthPercent}%` }} />
          </div>
        </div>
      </div>

      <span className="block text-sm font-medium text-gray-100 mt-2 leading-snug">{memory.title}</span>

      {memory.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {memory.tags.map((tag) => (
            <span key={tag} className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${tagColor(tag)}`}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-800 space-y-2">
          {memory.content && (
            <p className="text-xs text-gray-400 leading-relaxed">{memory.content}</p>
          )}
          {memory.rule && (
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded px-3 py-2">
              <span className="text-[10px] uppercase tracking-wider text-yellow-500/80 font-semibold">Rule</span>
              <p className="text-xs text-yellow-300/80 mt-0.5">{memory.rule}</p>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

export function MemoryView() {
  const { data: memoriesData, loading: memLoading, error: memError, refetch: memRefetch } = useTauriData<MemoriesData>('get_memories');
  const { data: brainData, loading: brainLoading, error: brainError } = useTauriData<BrainState>('get_brain_state');
  const [filter, setFilter] = useState<MemoryType>('all');

  if (memLoading || brainLoading) return <LoadingState />;
  if (memError) return <ErrorState message={memError} onRetry={memRefetch} />;
  if (brainError) return <ErrorState message={brainError} />;

  const memories = memoriesData?.memories ?? [];
  const brain = brainData?.state;
  const filtered = filter === 'all' ? memories : memories.filter((m) => m.type === filter);
  const types: MemoryType[] = ['all', 'pain', 'win', 'fact', 'decision', 'architecture'];

  return (
    <ViewShell title="Memory" description={`${memories.length} memories stored in the brain`}>
      {brain && (
        <div className="flex items-center gap-4 mb-6 px-4 py-3 bg-[#1a1a24] border border-gray-800 rounded-lg">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${PHASE_STYLE[brain.contextPhase] ?? 'bg-gray-500'}`} />
            <span className="text-xs text-gray-400">Phase: <span className="text-gray-200">{brain.contextPhase}</span></span>
          </div>
          <div className="text-xs text-gray-400">Messages: <span className="text-gray-200">{brain.messageCount}</span></div>
          <div className="text-xs text-gray-400">Active traces: <span className="text-gray-200">{brain.activeTraces.length}</span></div>
          <div className="text-xs text-gray-400">
            Hot tags: <span className="text-gray-200">
              {Object.entries(brain.firingFrequency).filter(([, v]) => (v as number) >= 3).length}
            </span>
          </div>
        </div>
      )}

      <div className="flex gap-1 mb-4">
        {types.map((t) => {
          const count = t === 'all' ? memories.length : memories.filter((m) => m.type === t).length;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(t)}
              className={`text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer ${
                filter === t
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
              }`}
            >
              {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)} ({count})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyState message={filter === 'all' ? 'No memories stored yet' : `No ${filter} memories`} />
      ) : (
        <div className="space-y-3 max-w-3xl">
          {filtered.map((m) => (
            <MemoryCard key={m.id} memory={m} />
          ))}
        </div>
      )}
    </ViewShell>
  );
}
