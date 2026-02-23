import { useState } from 'react';
import { SessionsView } from './SessionsView.js';
import { TimelineView } from './TimelineView.js';

type Tab = 'sessions' | 'timeline';

export function HistoryView() {
  const [tab, setTab] = useState<Tab>('sessions');

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab toggle */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-800/70 bg-[#0d0d14] shrink-0">
        {(['sessions', 'timeline'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1 text-[11px] font-medium rounded transition-colors capitalize ${
              tab === t
                ? 'bg-gray-800 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0">
        {tab === 'sessions' ? <SessionsView /> : <TimelineView />}
      </div>
    </div>
  );
}
