import { useState } from 'react';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';

// ── Types ────────────────────────────────────────────────────────

interface DelibMessage {
  id: string;
  agentId: string;
  text: string;
  timestamp: string;
  phase?: string;
}

interface DelibSession {
  id: string;
  topic: string;
  status: string;
  startedAt: string;
  deliberationPhase?: string;
}

interface Deliberation {
  session: DelibSession;
  agents: { id: string; name: string; role?: string }[];
  messages: DelibMessage[];
}

interface ResearchFinding {
  agent: string;
  role: string;
  summary: string;
  keyPoints: string[];
  synthesis?: string;
}

interface ResearchSession {
  sessionId: string;
  date: string;
  topic: string;
  findings: ResearchFinding[];
}

interface ResearchData {
  extractedAt: string;
  sessions: ResearchSession[];
}

type SubTab = 'deliberations' | 'research';

// ── Deliberation Detail ──────────────────────────────────────────

function DelibDetail({ delib, onBack }: { delib: Deliberation; onBack: () => void }) {
  const msgs = (delib.messages ?? []).filter(m => m.agentId !== 'system');
  const agentMap = Object.fromEntries((delib.agents ?? []).map(a => [a.id, a]));

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800/70 bg-[#0d0d14] shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
        >
          &larr; Back
        </button>
        <div className="h-3 w-px bg-gray-800" />
        <span className="text-[11px] font-semibold text-gray-300 truncate flex-1">
          {delib.session.topic}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          delib.session.status === 'concluded'
            ? 'bg-emerald-900/40 text-emerald-400'
            : 'bg-amber-900/40 text-amber-400'
        }`}>
          {delib.session.status}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {msgs.length === 0 ? (
          <p className="text-xs text-gray-600 text-center mt-8">No messages in this deliberation.</p>
        ) : (
          msgs.map((m) => {
            const agent = agentMap[m.agentId];
            const name = agent?.name ?? m.agentId;
            const isMediator = name.toLowerCase().includes('mediator');
            return (
              <div key={m.id} className="group">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className={`text-[10px] font-semibold ${
                    isMediator ? 'text-violet-400' : 'text-cyan-400'
                  }`}>
                    {name}
                  </span>
                  {agent?.role && (
                    <span className="text-[9px] text-gray-600">{agent.role}</span>
                  )}
                  <span className="text-[9px] text-gray-700 ml-auto">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed pl-0 whitespace-pre-wrap">
                  {m.text}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Research Detail ──────────────────────────────────────────────

function ResearchDetail({ session, onBack }: { session: ResearchSession; onBack: () => void }) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800/70 bg-[#0d0d14] shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
        >
          &larr; Back
        </button>
        <div className="h-3 w-px bg-gray-800" />
        <span className="text-[11px] font-semibold text-gray-300 truncate flex-1">
          {session.topic}
        </span>
        <span className="text-[10px] text-gray-600">{session.date}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {(session.findings ?? []).map((f, i) => (
          <div key={i} className="border border-gray-800/50 rounded-lg p-3">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-[11px] font-semibold text-cyan-400">{f.agent}</span>
              {f.role && <span className="text-[10px] text-gray-600">{f.role}</span>}
            </div>
            <p className="text-xs text-gray-400 mb-2">{f.summary}</p>
            {f.keyPoints?.length > 0 && (
              <ul className="space-y-1 ml-3">
                {f.keyPoints.map((kp, j) => (
                  <li key={j} className="text-[11px] text-gray-500 list-disc leading-relaxed">
                    {kp}
                  </li>
                ))}
              </ul>
            )}
            {f.synthesis && (
              <div className="mt-2 pt-2 border-t border-gray-800/50">
                <span className="text-[10px] uppercase tracking-widest text-gray-600">Synthesis</span>
                <p className="text-xs text-gray-400 mt-1">{f.synthesis}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main View ────────────────────────────────────────────────────

export function TranscriptsView() {
  const projectPath = useProjectPath();
  const { data: deliberations, loading: dLoad } = useTauriData<Deliberation[]>('get_deliberations', projectPath);
  const { data: research, loading: rLoad } = useTauriData<ResearchData>('get_extracted_research', projectPath);

  const [subTab, setSubTab] = useState<SubTab>('deliberations');
  const [selectedDelib, setSelectedDelib] = useState<Deliberation | null>(null);
  const [selectedResearch, setSelectedResearch] = useState<ResearchSession | null>(null);

  const loading = dLoad || rLoad;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f]">
        <span className="text-sm text-gray-600">Loading transcripts...</span>
      </div>
    );
  }

  // Detail views
  if (selectedDelib) {
    return <DelibDetail delib={selectedDelib} onBack={() => setSelectedDelib(null)} />;
  }
  if (selectedResearch) {
    return <ResearchDetail session={selectedResearch} onBack={() => setSelectedResearch(null)} />;
  }

  const delibs = deliberations ?? [];
  const sessions = research?.sessions ?? [];

  // Sort deliberations newest first
  const sortedDelibs = [...delibs].sort(
    (a, b) => new Date(b.session.startedAt).getTime() - new Date(a.session.startedAt).getTime()
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0f]">
      {/* Sub-tab toggle */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800/70 bg-[#0d0d14] shrink-0">
        {(['deliberations', 'research'] as SubTab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setSubTab(t)}
            className={`px-2.5 py-0.5 text-[10px] font-medium rounded transition-colors capitalize ${
              subTab === t ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
          </button>
        ))}
        <div className="h-3 w-px bg-gray-800" />
        <span className="text-[10px] text-gray-600">
          {subTab === 'deliberations'
            ? `${sortedDelibs.length} archived`
            : `${sessions.length} sessions`
          }
        </span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {subTab === 'deliberations' ? (
          sortedDelibs.length === 0 ? (
            <p className="text-xs text-gray-600 text-center mt-12">No archived deliberations yet.</p>
          ) : (
            <div className="divide-y divide-gray-800/50">
              {sortedDelibs.map((d) => {
                const msgCount = (d.messages ?? []).filter(m => m.agentId !== 'system').length;
                const agentCount = (d.agents ?? []).length;
                const date = new Date(d.session.startedAt);
                return (
                  <button
                    key={d.session.id}
                    type="button"
                    onClick={() => setSelectedDelib(d)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-800/30 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-300 font-medium truncate">
                          {d.session.topic}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-gray-600">
                            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="text-[10px] text-gray-700">|</span>
                          <span className="text-[10px] text-gray-600">
                            {agentCount} agents, {msgCount} messages
                          </span>
                        </div>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                        d.session.status === 'concluded'
                          ? 'bg-emerald-900/30 text-emerald-500'
                          : 'bg-amber-900/30 text-amber-500'
                      }`}>
                        {d.session.status}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        ) : (
          sessions.length === 0 ? (
            <p className="text-xs text-gray-600 text-center mt-12">No research data extracted yet.</p>
          ) : (
            <div className="divide-y divide-gray-800/50">
              {sessions.map((s) => {
                const findingCount = (s.findings ?? []).length;
                const keyPointCount = (s.findings ?? []).reduce((sum, f) => sum + (f.keyPoints?.length ?? 0), 0);
                return (
                  <button
                    key={s.sessionId}
                    type="button"
                    onClick={() => setSelectedResearch(s)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-800/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-300 font-medium truncate">
                        {s.topic}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-gray-600">{s.date}</span>
                        <span className="text-[10px] text-gray-700">|</span>
                        <span className="text-[10px] text-gray-600">
                          {findingCount} findings, {keyPointCount} key points
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
