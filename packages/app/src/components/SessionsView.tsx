import { useState } from 'react';
import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { ViewShell } from './ViewShell.js';
import { LoadingState, ErrorState, EmptyState } from './LoadingState.js';

interface Session {
  id: string;
  startedAt: string;
  endedAt?: string;
  tasksCompleted: string[];
  decisionsMade: string[];
  costUsd: number;
  tokensUsed: number;
  summary: string;
}

interface ActivityEvent {
  id: string;
  type: string;
  description: string;
  details: string;
  timestamp: string;
}

interface SessionsData { sessions: Session[]; }
interface ActivityData { activities: ActivityEvent[]; }

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(startIso: string, endIso?: string): string {
  if (!endIso) return 'ongoing';
  const mins = Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const TYPE_STYLES: Record<string, { dot: string; label: string }> = {
  session_start:     { dot: 'bg-green-500',  label: 'Start' },
  session_end:       { dot: 'bg-gray-500',   label: 'End' },
  task_added:        { dot: 'bg-blue-400',   label: 'Task' },
  task_updated:      { dot: 'bg-blue-600',   label: 'Task' },
  decision_recorded: { dot: 'bg-purple-400', label: 'Decision' },
  memory_stored:     { dot: 'bg-yellow-500', label: 'Memory' },
  memory_retrieved:  { dot: 'bg-yellow-700', label: 'Memory' },
  approval_requested:{ dot: 'bg-orange-400', label: 'Approval' },
  approval_auto:     { dot: 'bg-gray-600',   label: 'Auto' },
  approval_resolved: { dot: 'bg-green-600',  label: 'Resolved' },
  strike_recorded:   { dot: 'bg-red-400',    label: 'Strike' },
  strike_halt:       { dot: 'bg-red-600',    label: 'HALT' },
  question_added:    { dot: 'bg-cyan-400',   label: 'Question' },
  question_answered: { dot: 'bg-cyan-600',   label: 'Answered' },
  context_loaded:    { dot: 'bg-indigo-400', label: 'Context' },
  handoff_written:   { dot: 'bg-amber-400',  label: 'Handoff' },
  handoff_loaded:    { dot: 'bg-amber-600',  label: 'Handoff' },
};

function ActivityRow({ event }: { event: ActivityEvent }) {
  const [expanded, setExpanded] = useState(false);
  const style = TYPE_STYLES[event.type] ?? { dot: 'bg-gray-500', label: event.type };
  const hasDetails = Boolean(event.details);

  return (
    <div
      className={`flex gap-2 py-1.5 rounded px-2 -mx-2 transition-colors ${hasDetails ? 'cursor-pointer hover:bg-white/5' : ''}`}
      onClick={() => hasDetails && setExpanded((v) => !v)}
    >
      <div className={`w-1.5 h-1.5 rounded-full mt-[5px] shrink-0 ${style.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-gray-600 font-mono shrink-0">{formatTime(event.timestamp)}</span>
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider shrink-0">{style.label}</span>
          <span className="text-xs text-gray-300">{event.description}</span>
        </div>
        {expanded && event.details && (
          <pre className="text-[11px] text-gray-400 mt-1.5 whitespace-pre-wrap font-mono leading-relaxed pl-3 border-l border-gray-700">
            {event.details}
          </pre>
        )}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  num,
  isActive,
  events,
}: {
  session: Session;
  num: number;
  isActive: boolean;
  events: ActivityEvent[];
}) {
  const [expanded, setExpanded] = useState(isActive);

  const start = new Date(session.startedAt).getTime();
  const end = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
  const sessionEvents = events.filter((e) => {
    const t = new Date(e.timestamp).getTime();
    return t >= start && t <= end;
  });

  return (
    <div className="bg-[#1a1a24] border border-gray-800 rounded-lg overflow-hidden">
      {/* Clickable header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-mono font-semibold text-gray-300 shrink-0">#{num}</span>
          {isActive && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 shrink-0">Active</span>
          )}
          <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
            <span>{formatDateTime(session.startedAt)}</span>
            <span className="text-gray-700">·</span>
            <span>{formatDuration(session.startedAt, session.endedAt)}</span>
            <span className="text-gray-700">·</span>
            <span>{sessionEvents.length} events</span>
            {session.tasksCompleted.length > 0 && (
              <><span className="text-gray-700">·</span><span className="text-blue-400">{session.tasksCompleted.length}t</span></>
            )}
            {session.decisionsMade.length > 0 && (
              <><span className="text-gray-700">·</span><span className="text-purple-400">{session.decisionsMade.length}d</span></>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {session.costUsd > 0 && (
            <span className="text-xs text-gray-600">${session.costUsd.toFixed(3)}</span>
          )}
          <span className="text-gray-700 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Collapsed: show summary snippet */}
      {!expanded && session.summary && (
        <div className="px-4 pb-3 text-xs text-gray-500 truncate border-t border-gray-800/40 pt-2">{session.summary}</div>
      )}

      {/* Expanded: summary + full activity timeline */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-800/60">
          {session.summary && (
            <p className="text-xs text-gray-400 py-3 leading-relaxed border-b border-gray-800/40 mb-2">{session.summary}</p>
          )}
          {sessionEvents.length === 0 ? (
            <p className="text-xs text-gray-600 py-3">No activity recorded for this session.</p>
          ) : (
            <div className="mt-1 space-y-0.5">
              {sessionEvents.map((e) => (
                <ActivityRow key={e.id} event={e} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SessionsView() {
  const projectPath = useProjectPath();
  const { data: sessionsData, loading, error, refetch } = useTauriData<SessionsData>('get_sessions', projectPath);
  const { data: activityData } = useTauriData<ActivityData>('get_activity', projectPath);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const sessions = [...(sessionsData?.sessions ?? [])].reverse();
  const activities = activityData?.activities ?? [];

  return (
    <ViewShell
      title="Sessions"
      description={`${sessions.length} session${sessions.length !== 1 ? 's' : ''} · click to expand`}
    >
      {sessions.length === 0 ? (
        <EmptyState message="No sessions recorded yet" />
      ) : (
        <div className="space-y-2">
          {sessions.map((s, i) => (
            <SessionCard
              key={s.id}
              session={s}
              num={sessions.length - i}
              isActive={!s.endedAt}
              events={activities}
            />
          ))}
        </div>
      )}
    </ViewShell>
  );
}
