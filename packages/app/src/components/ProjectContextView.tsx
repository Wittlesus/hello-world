import { useMemo } from 'react';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';

// -- Direction types --

interface ScopeEntry {
  area: string;
  decision: 'in' | 'out';
  rationale: string;
  capturedAt: string;
}

interface DirectionNote {
  id: string;
  text: string;
  source: string;
  read: boolean;
  capturedAt: string;
  actionTaken?: string;
  actionId?: string;
}

interface DirectionData {
  vision?: string;
  scope?: ScopeEntry[];
  notes?: DirectionNote[];
}

// -- Decision types --

interface Decision {
  id: string;
  title: string;
  context?: string;
  chosen: string;
  rationale?: string;
  decidedAt: string;
  decidedBy?: string;
}

interface StateData {
  decisions?: Decision[];
}

// -- Memory types --

interface Memory {
  id: string;
  type: string;
  title: string;
  content?: string;
  rule?: string;
  severity?: string;
  createdAt: string;
}

interface MemoriesData {
  memories: Memory[];
}

// -- Sessions types --

interface Session {
  id: string;
  startedAt: string;
  endedAt?: string;
  tasksCompleted?: number;
  decisionsMade?: number;
  summary?: string;
}

interface SessionsData {
  sessions: Session[];
}

export function ProjectContextView() {
  const projectPath = useProjectPath();
  const { data: direction, loading: dirLoad } = useTauriData<DirectionData>('get_direction', projectPath);
  const { data: state, loading: stLoad } = useTauriData<StateData>('get_state', projectPath);
  const { data: memoriesData, loading: mLoad } = useTauriData<MemoriesData>('get_memories', projectPath);
  const { data: sessionsData, loading: sesLoad } = useTauriData<SessionsData>('get_sessions', projectPath);

  const loading = dirLoad || stLoad || mLoad || sesLoad;

  // Key architectural decisions (sorted newest first)
  const decisions = useMemo(() => {
    const decs = state?.decisions ?? [];
    return [...decs].sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime());
  }, [state]);

  // Active pain rules (things Claude must never repeat)
  const painRules = useMemo(() => {
    const mems = memoriesData?.memories ?? [];
    return mems
      .filter((m) => m.type === 'pain' && m.rule)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);
  }, [memoriesData]);

  // Architectural facts
  const archFacts = useMemo(() => {
    const mems = memoriesData?.memories ?? [];
    return mems
      .filter((m) => m.type === 'architecture' || m.type === 'fact')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);
  }, [memoriesData]);

  // Session stats
  const sessionStats = useMemo(() => {
    const sessions = sessionsData?.sessions ?? [];
    return {
      total: sessions.length,
      totalTasks: sessions.reduce((sum, s) => sum + (s.tasksCompleted ?? 0), 0),
      totalDecisions: sessions.reduce((sum, s) => sum + (s.decisionsMade ?? 0), 0),
    };
  }, [sessionsData]);

  // Memory stats
  const memoryStats = useMemo(() => {
    const mems = memoriesData?.memories ?? [];
    const byType: Record<string, number> = {};
    for (const m of mems) {
      byType[m.type] = (byType[m.type] ?? 0) + 1;
    }
    return { total: mems.length, byType };
  }, [memoriesData]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f]">
        <span className="text-sm text-gray-600">Loading...</span>
      </div>
    );
  }

  const vision = direction?.vision ?? '';
  const scope = direction?.scope ?? [];
  const notes = direction?.notes ?? [];
  const unread = notes.filter((n) => !n.read);
  const processed = notes.filter((n) => n.read);
  const inScope = scope.filter((s) => s.decision === 'in');
  const outScope = scope.filter((s) => s.decision === 'out');

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800/70 bg-[#0d0d14] shrink-0">
        <span className="text-[11px] font-semibold text-gray-300">Project Context</span>
        <div className="h-3 w-px bg-gray-800" />
        <span className="text-[11px] text-gray-600">
          {sessionStats.total} sessions, {decisions.length} decisions, {memoryStats.total} memories
        </span>
        {unread.length > 0 && (
          <>
            <div className="h-3 w-px bg-gray-800" />
            <span className="text-[11px] text-amber-400">{unread.length} unread</span>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Vision */}
        <section className="px-5 py-4 border-b border-gray-800/40">
          <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Vision</p>
          {vision ? (
            <p className="text-sm text-gray-300 leading-relaxed">{vision}</p>
          ) : (
            <p className="text-sm text-gray-600 italic">
              No vision captured yet.
            </p>
          )}
        </section>

        {/* Stats bar */}
        <section className="px-5 py-3 border-b border-gray-800/40 flex gap-6">
          <div>
            <p className="text-[10px] text-gray-600">Sessions</p>
            <p className="text-lg font-semibold text-gray-300">{sessionStats.total}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-600">Tasks Done</p>
            <p className="text-lg font-semibold text-gray-300">{sessionStats.totalTasks}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-600">Decisions</p>
            <p className="text-lg font-semibold text-gray-300">{decisions.length}</p>
          </div>
          {Object.entries(memoryStats.byType).map(([type, count]) => (
            <div key={type}>
              <p className="text-[10px] text-gray-600 capitalize">{type}</p>
              <p className="text-lg font-semibold text-gray-300">{count}</p>
            </div>
          ))}
        </section>

        {/* Unread notes */}
        {unread.length > 0 && (
          <section className="px-5 py-4 border-b border-amber-900/30 bg-amber-950/10">
            <p className="text-[10px] uppercase tracking-widest text-amber-600 mb-3">
              Unread Notes from Pat
            </p>
            <div className="flex flex-col gap-3">
              {unread.map((note) => (
                <div key={note.id} className="flex flex-col gap-0.5">
                  <p className="text-sm text-amber-200 leading-relaxed">{note.text}</p>
                  <p className="text-[10px] text-amber-800 font-mono">
                    {note.id} -- {note.source} -- {new Date(note.capturedAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Scope: in */}
        {inScope.length > 0 && (
          <section className="px-5 py-4 border-b border-gray-800/40">
            <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">In Scope</p>
            <div className="flex flex-col gap-2.5">
              {inScope.map((entry, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded mt-0.5 text-green-400 bg-green-500/10">
                    IN
                  </span>
                  <div>
                    <p className="text-sm text-gray-300 font-medium leading-snug">{entry.area}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{entry.rationale}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Scope: out */}
        {outScope.length > 0 && (
          <section className="px-5 py-4 border-b border-gray-800/40">
            <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">Out of Scope</p>
            <div className="flex flex-col gap-2.5">
              {outScope.map((entry, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded mt-0.5 text-red-400 bg-red-500/10">
                    OUT
                  </span>
                  <div>
                    <p className="text-sm text-gray-300 font-medium leading-snug">{entry.area}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{entry.rationale}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Key Decisions */}
        {decisions.length > 0 && (
          <section className="px-5 py-4 border-b border-gray-800/40">
            <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">
              Architectural Decisions ({decisions.length})
            </p>
            <div className="flex flex-col gap-3">
              {decisions.map((d) => (
                <div key={d.id} className="group">
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="text-[9px] font-mono text-amber-500/70">
                      {new Date(d.decidedAt).toLocaleDateString()}
                    </span>
                    {d.decidedBy && (
                      <span className="text-[9px] text-gray-700">{d.decidedBy}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-300 font-medium">{d.title}</p>
                  <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5 line-clamp-2">
                    {d.chosen}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Pain Rules */}
        {painRules.length > 0 && (
          <section className="px-5 py-4 border-b border-gray-800/40">
            <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">
              Pain Rules (never repeat)
            </p>
            <div className="flex flex-col gap-2">
              {painRules.map((m) => (
                <div key={m.id} className="flex items-start gap-2">
                  <span className="shrink-0 text-[9px] font-mono text-red-500/60 mt-0.5">!</span>
                  <div>
                    <p className="text-xs text-gray-400">{m.title}</p>
                    {m.rule && (
                      <p className="text-[11px] text-red-400/60 mt-0.5">{m.rule}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Architecture Facts */}
        {archFacts.length > 0 && (
          <section className="px-5 py-4 border-b border-gray-800/40">
            <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">
              Architecture & Facts
            </p>
            <div className="flex flex-col gap-2">
              {archFacts.map((m) => (
                <div key={m.id} className="flex items-start gap-2">
                  <span className="shrink-0 text-[9px] font-mono text-blue-500/60 mt-0.5">i</span>
                  <p className="text-xs text-gray-400">{m.title}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Processed notes log */}
        {processed.length > 0 && (
          <section className="px-5 py-4">
            <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">Note History</p>
            <div className="flex flex-col gap-2">
              {[...processed].reverse().map((note) => (
                <div key={note.id} className="flex items-start gap-3">
                  {note.actionTaken && (
                    <span className="shrink-0 text-[9px] font-mono uppercase px-1 py-0.5 rounded bg-gray-800 text-gray-500 mt-0.5">
                      {note.actionTaken}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 leading-relaxed">{note.text}</p>
                    <p className="text-[10px] text-gray-700 font-mono mt-0.5">
                      {new Date(note.capturedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
ProjectContextView.displayName = 'ProjectContextView';
