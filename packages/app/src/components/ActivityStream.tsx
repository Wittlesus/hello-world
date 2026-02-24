import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useThemeStore, getTheme } from '../stores/theme.js';

interface ActivityEvent {
  id: string;
  type: string;
  description: string;
  details: string;
  timestamp: string;
}

interface ActivityData {
  activities: ActivityEvent[];
}

const TYPE_CONFIG: Record<string, { label: string; badge: string; color: string; bg: string }> = {
  context_loaded:      { label: 'START',   badge: 'SS', color: 'text-gray-400',   bg: 'bg-gray-500/15' },
  session_end:         { label: 'END',     badge: 'SE', color: 'text-gray-400',   bg: 'bg-gray-500/15' },
  memory_stored:       { label: 'MEMORY',  badge: 'MS', color: 'text-green-400',  bg: 'bg-green-500/15' },
  memory_retrieved:    { label: 'RECALL',  badge: 'MR', color: 'text-teal-400',   bg: 'bg-teal-500/15' },
  task_added:          { label: 'TASK+',   badge: 'T+', color: 'text-blue-400',   bg: 'bg-blue-500/15' },
  task_updated:        { label: 'TASK',    badge: 'TK', color: 'text-blue-400',   bg: 'bg-blue-500/15' },
  decision_recorded:   { label: 'DECIDE',  badge: 'DC', color: 'text-orange-400', bg: 'bg-orange-500/15' },
  approval_requested:  { label: 'BLOCK',   badge: '!!', color: 'text-red-400',    bg: 'bg-red-500/15' },
  approval_auto:       { label: 'AUTO',    badge: 'OK', color: 'text-gray-400',   bg: 'bg-gray-500/15' },
  strike_recorded:     { label: 'STRIKE',  badge: 'S1', color: 'text-yellow-400', bg: 'bg-yellow-500/15' },
  strike_halt:         { label: 'HALT',    badge: 'S2', color: 'text-red-400',    bg: 'bg-red-500/15' },
  question_added:      { label: 'QUEST',   badge: 'Q+', color: 'text-purple-400', bg: 'bg-purple-500/15' },
  question_answered:   { label: 'ANSWR',   badge: 'QA', color: 'text-purple-400', bg: 'bg-purple-500/15' },
};

const DEFAULT_CONFIG = { label: 'EVENT', badge: 'EV', color: 'text-gray-400', bg: 'bg-gray-500/15' };

function getConfig(type: string) {
  return TYPE_CONFIG[type] ?? DEFAULT_CONFIG;
}

const BRACKET_COLORS: Record<string, string> = {
  DONE:        '#4ade80',
  IN_PROGRESS: '#fbbf24',
  BLOCKED:     '#f87171',
  TODO:        '#94a3b8',
  STARTED:     '#60a5fa',
  SCOPE:       '#a78bfa',
  PLAN:        '#818cf8',
  BUILD:       '#22d3ee',
  VERIFY:      '#fb923c',
  SHIP:        '#4ade80',
  HALT:        '#f87171',
  STRIKE:      '#fbbf24',
  BLOCK:       '#f87171',
  AUTO:        '#94a3b8',
};

function colorBrackets(text: string, accent: string): ReactNode {
  const bracketRegex = /\[([A-Z_]+)\]/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = bracketRegex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const label = match[1];
    const color = BRACKET_COLORS[label] ?? accent;
    parts.push(
      <span key={key++} style={{ color, fontWeight: 600 }}>[{label}]</span>
    );
    last = bracketRegex.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 0 ? parts : text;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return timestamp;
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function ActivityRow({ item, accent }: { item: ActivityEvent; accent: string }) {
  const [expanded, setExpanded] = useState(false);
  const config = getConfig(item.type);
  const hasDetails = item.details && item.details.trim().length > 0;

  return (
    <div
      className={`border-b border-gray-800/50 ${hasDetails ? 'cursor-pointer' : ''}`}
      onClick={hasDetails ? () => setExpanded((prev) => !prev) : undefined}
    >
      <div className="flex items-start gap-3 px-4 py-2.5 group">
        <span className="shrink-0 text-xs font-mono text-gray-500 leading-5 select-none pt-px">
          {formatTime(item.timestamp)}
        </span>
        <span
          className={`shrink-0 inline-flex items-center justify-center w-8 h-5 rounded text-[10px] font-bold font-mono leading-none select-none ${config.color} ${config.bg}`}
        >
          {config.badge}
        </span>
        <span className="flex-1 text-sm text-gray-200 leading-5 break-words">
          {colorBrackets(item.description, accent)}
        </span>
        {hasDetails && (
          <span className="shrink-0 text-xs text-gray-600 group-hover:text-gray-400 transition-colors select-none leading-5 pt-px">
            {expanded ? '[-]' : '[+]'}
          </span>
        )}
      </div>
      {expanded && hasDetails && (
        <div className="px-4 pb-3 pl-[6.75rem]">
          <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap break-words leading-relaxed bg-[#08080d] rounded p-3 border border-gray-800/60">
            {item.details}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ActivityStream() {
  const projectPath = useProjectPath();
  const themeId = useThemeStore((s) => s.themeId);
  const accent = getTheme(themeId).accent;
  const { data, loading } = useTauriData<ActivityData>('get_activity', projectPath);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Activities from file are newest-first (ActivityStore.getAll() reverses)
  // The file stores chronologically but we read it and reverse in the store
  // However get_activity reads raw JSON — we need to reverse here
  const activities = data?.activities ? [...data.activities].reverse() : [];

  useEffect(() => {
    if (activities.length > prevCountRef.current && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    prevCountRef.current = activities.length;
  }, [activities.length]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f]">
        <p className="text-sm text-gray-500">Loading activity...</p>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f]">
        <p className="text-sm text-gray-500">No activity yet. Activity appears here as Claude uses MCP tools during sessions.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto bg-[#0a0a0f]">
      {activities.map((item) => (
        <ActivityRow key={item.id} item={item} accent={accent} />
      ))}
    </div>
  );
}
