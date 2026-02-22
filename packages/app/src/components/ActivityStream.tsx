import { useState, useRef, useEffect } from 'react';
import { useActivityStore, type ActivityItem } from '../stores/activity';

const TYPE_CONFIG: Record<string, { label: string; badge: string; color: string; bg: string }> = {
  file_read:        { label: 'READ',    badge: 'FR', color: 'text-blue-400',   bg: 'bg-blue-500/15' },
  file_write:       { label: 'WRITE',   badge: 'FW', color: 'text-blue-400',   bg: 'bg-blue-500/15' },
  command_run:      { label: 'CMD',     badge: 'CR', color: 'text-yellow-400', bg: 'bg-yellow-500/15' },
  tool_call:        { label: 'TOOL',    badge: 'TC', color: 'text-purple-400', bg: 'bg-purple-500/15' },
  decision:         { label: 'DECIDE',  badge: 'DC', color: 'text-orange-400', bg: 'bg-orange-500/15' },
  approval_request: { label: 'APPROVE', badge: 'AR', color: 'text-orange-400', bg: 'bg-orange-500/15' },
  error:            { label: 'ERROR',   badge: '!!', color: 'text-red-400',    bg: 'bg-red-500/15' },
  memory_stored:    { label: 'MEMORY',  badge: 'MS', color: 'text-green-400',  bg: 'bg-green-500/15' },
  session_start:    { label: 'START',   badge: 'SS', color: 'text-gray-400',   bg: 'bg-gray-500/15' },
  session_end:      { label: 'END',     badge: 'SE', color: 'text-gray-400',   bg: 'bg-gray-500/15' },
};

const DEFAULT_CONFIG = { label: 'EVENT', badge: 'EV', color: 'text-gray-400', bg: 'bg-gray-500/15' };

function getConfig(type: string) {
  return TYPE_CONFIG[type] ?? DEFAULT_CONFIG;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [expanded, setExpanded] = useState(false);
  const config = getConfig(item.type);
  const hasDetails = item.details && item.details.trim().length > 0;

  return (
    <div
      className={`border-b border-gray-800/50 ${hasDetails ? 'cursor-pointer' : ''}`}
      onClick={hasDetails ? () => setExpanded((prev) => !prev) : undefined}
    >
      <div className="flex items-start gap-3 px-4 py-2.5 group">
        {/* Timestamp */}
        <span className="shrink-0 text-xs font-mono text-gray-500 leading-5 select-none pt-px">
          {formatTime(item.timestamp)}
        </span>

        {/* Type badge */}
        <span
          className={`shrink-0 inline-flex items-center justify-center w-8 h-5 rounded text-[10px] font-bold font-mono leading-none select-none ${config.color} ${config.bg}`}
        >
          {config.badge}
        </span>

        {/* Description */}
        <span className="flex-1 text-sm text-gray-200 leading-5 break-words">
          {item.description}
        </span>

        {/* Expand indicator */}
        {hasDetails && (
          <span className="shrink-0 text-xs text-gray-600 group-hover:text-gray-400 transition-colors select-none leading-5 pt-px">
            {expanded ? '[-]' : '[+]'}
          </span>
        )}
      </div>

      {/* Expanded details */}
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
  const activities = useActivityStore((s) => s.activities);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(activities.length);

  // Auto-scroll to top when new items arrive (newest first, so top = newest)
  useEffect(() => {
    if (activities.length > prevCountRef.current && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    prevCountRef.current = activities.length;
  }, [activities.length]);

  if (activities.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f]">
        <p className="text-sm text-gray-500">No activity yet. Start a session to see Claude work.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto bg-[#0a0a0f]">
      {activities.map((item) => (
        <ActivityRow key={item.id} item={item} />
      ))}
    </div>
  );
}
