import { useMemo } from 'react';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';

// -- Types for raw data from Tauri commands --

interface Session {
  id: string;
  startedAt: string;
  endedAt?: string;
  tasksCompleted?: number;
  decisionsMade?: number;
  costUsd?: number;
  summary?: string;
}

interface Activity {
  id: string;
  type: string;
  description: string;
  details?: string;
  timestamp: string;
}

interface Decision {
  id: string;
  title: string;
  chosen: string;
  decidedAt: string;
  decidedBy?: string;
}

interface SessionsData {
  sessions: Session[];
}

interface ActivityData {
  activities: Activity[];
}

interface StateData {
  decisions?: Decision[];
}

// -- Timeline entry (unified) --

interface TimelineEntry {
  timestamp: string;
  kind: 'session_start' | 'session_end' | 'decision' | 'task' | 'deliberation' | 'memory' | 'activity';
  title: string;
  detail?: string;
  accent: string; // tailwind color class
}

// Activity types worth showing on the timeline (skip noise like memory_retrieved)
const NOTABLE_ACTIVITY_TYPES: Record<string, { kind: TimelineEntry['kind']; accent: string }> = {
  decision_recorded: { kind: 'decision', accent: 'text-amber-400' },
  deliberation_concluded: { kind: 'deliberation', accent: 'text-violet-400' },
  deliberation_started: { kind: 'deliberation', accent: 'text-violet-400' },
  task_started: { kind: 'task', accent: 'text-cyan-400' },
  task_updated: { kind: 'task', accent: 'text-cyan-400' },
  memory_stored: { kind: 'memory', accent: 'text-emerald-400' },
  session_end: { kind: 'session_end', accent: 'text-gray-500' },
  brain_rules: { kind: 'activity', accent: 'text-pink-400' },
  brain_plasticity: { kind: 'activity', accent: 'text-pink-400' },
  direction_updated: { kind: 'activity', accent: 'text-amber-400' },
};

function buildTimeline(
  sessions: Session[],
  activities: Activity[],
  decisions: Decision[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // Session starts
  for (const s of sessions) {
    entries.push({
      timestamp: s.startedAt,
      kind: 'session_start',
      title: `Session ${s.id.substring(0, 8)} started`,
      detail: s.summary || undefined,
      accent: 'text-indigo-400',
    });
  }

  // Decisions (from decisions.json, not activity -- richer data)
  for (const d of decisions) {
    entries.push({
      timestamp: d.decidedAt,
      kind: 'decision',
      title: d.title,
      detail: d.chosen,
      accent: 'text-amber-400',
    });
  }

  // Notable activities (skip task_updated that just says "done" -- too noisy)
  for (const a of activities) {
    const meta = NOTABLE_ACTIVITY_TYPES[a.type];
    if (!meta) continue;
    // Skip task_updated noise, only show completions
    if (a.type === 'task_updated' && !a.details?.includes('done')) continue;
    // Skip decision_recorded since we already have decisions from decisions.json
    if (a.type === 'decision_recorded') continue;
    entries.push({
      timestamp: a.timestamp,
      kind: meta.kind,
      title: a.description,
      detail: a.details || undefined,
      accent: meta.accent,
    });
  }

  // Sort newest first
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return entries;
}

// Group entries by date
function groupByDate(entries: TimelineEntry[]): Map<string, TimelineEntry[]> {
  const groups = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    const date = new Date(e.timestamp).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const list = groups.get(date) ?? [];
    list.push(e);
    groups.set(date, list);
  }
  return groups;
}

const KIND_LABELS: Record<TimelineEntry['kind'], string> = {
  session_start: 'SESSION',
  session_end: 'END',
  decision: 'DECISION',
  task: 'TASK',
  deliberation: 'DELIB',
  memory: 'MEMORY',
  activity: 'BRAIN',
};

export function TimelineView() {
  const projectPath = useProjectPath();
  const { data: sessionsData, loading: sLoad } = useTauriData<SessionsData>('get_sessions', projectPath);
  const { data: activityData, loading: aLoad } = useTauriData<ActivityData>('get_activity', projectPath);
  const { data: stateData, loading: dLoad } = useTauriData<StateData>('get_state', projectPath);

  const loading = sLoad || aLoad || dLoad;

  const entries = useMemo(() => {
    if (!sessionsData && !activityData && !stateData) return [];
    return buildTimeline(
      sessionsData?.sessions ?? [],
      activityData?.activities ?? [],
      stateData?.decisions ?? [],
    );
  }, [sessionsData, activityData, stateData]);

  const grouped = useMemo(() => groupByDate(entries), [entries]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f]">
        <span className="text-sm text-gray-600">Loading...</span>
      </div>
    );
  }

  const sessionCount = sessionsData?.sessions?.length ?? 0;
  const decisionCount = stateData?.decisions?.length ?? 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0f]">
      <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800/70 bg-[#0d0d14] shrink-0">
        <span className="text-[11px] font-semibold text-gray-300">Timeline</span>
        <div className="h-3 w-px bg-gray-800" />
        <span className="text-[11px] text-gray-600">
          {sessionCount} sessions, {decisionCount} decisions, {entries.length} events
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="text-sm text-gray-500 text-center mt-16">
            No timeline data yet. Events appear as Claude works.
          </p>
        ) : (
          Array.from(grouped.entries()).map(([date, items]) => (
            <div key={date}>
              {/* Date header */}
              <div className="sticky top-0 z-10 px-4 py-1.5 bg-[#0d0d14]/95 backdrop-blur-sm border-b border-gray-800/40">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  {date}
                </span>
              </div>

              {/* Events for this date */}
              <div className="relative pl-8 pr-4">
                {/* Vertical line */}
                <div className="absolute left-[18px] top-0 bottom-0 w-px bg-gray-800/50" />

                {items.map((entry, i) => (
                  <div key={`${entry.timestamp}-${i}`} className="relative py-2 group">
                    {/* Dot on the line */}
                    <div className={`absolute left-[-14px] top-[12px] w-1.5 h-1.5 rounded-full ${
                      entry.kind === 'session_start' ? 'bg-indigo-500' :
                      entry.kind === 'decision' ? 'bg-amber-500' :
                      entry.kind === 'deliberation' ? 'bg-violet-500' :
                      entry.kind === 'task' ? 'bg-cyan-500' :
                      entry.kind === 'memory' ? 'bg-emerald-500' :
                      'bg-gray-600'
                    }`} />

                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className={`text-[9px] font-mono uppercase tracking-wider ${entry.accent}`}>
                        {KIND_LABELS[entry.kind]}
                      </span>
                      <span className="text-[9px] text-gray-700">
                        {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p className="text-xs text-gray-300 leading-relaxed">{entry.title}</p>

                    {entry.detail && (
                      <p className="text-[11px] text-gray-600 leading-relaxed mt-0.5 line-clamp-2">
                        {entry.detail}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
