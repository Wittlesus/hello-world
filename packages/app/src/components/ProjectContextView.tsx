import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';

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

export function ProjectContextView() {
  const projectPath = useProjectPath();
  const { data, loading } = useTauriData<DirectionData>('get_direction', projectPath);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f]">
        <span className="text-sm text-gray-600">Loading...</span>
      </div>
    );
  }

  const vision      = data?.vision ?? '';
  const scope       = data?.scope ?? [];
  const notes       = data?.notes ?? [];
  const unread      = notes.filter((n) => !n.read);
  const processed   = notes.filter((n) => n.read);

  const inScope  = scope.filter((s) => s.decision === 'in');
  const outScope = scope.filter((s) => s.decision === 'out');

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800/70 bg-[#0d0d14] shrink-0">
        <span className="text-[11px] font-semibold text-gray-300">Project Context</span>
        <div className="h-3 w-px bg-gray-800" />
        <span className="text-[11px] text-gray-600">{scope.length} scope decisions</span>
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
            <p className="text-sm text-gray-600 italic">No vision captured — use hw_update_direction(vision: "...")</p>
          )}
        </section>

        {/* Scope: in */}
        {inScope.length > 0 && (
          <section className="px-5 py-4 border-b border-gray-800/40">
            <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-3">In Scope</p>
            <div className="flex flex-col gap-2.5">
              {inScope.map((entry, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded mt-0.5 text-green-400 bg-green-500/10">IN</span>
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
                  <span className="shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded mt-0.5 text-red-400 bg-red-500/10">OUT</span>
                  <div>
                    <p className="text-sm text-gray-300 font-medium leading-snug">{entry.area}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{entry.rationale}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Unread notes */}
        {unread.length > 0 && (
          <section className="px-5 py-4 border-b border-amber-900/30 bg-amber-950/10">
            <p className="text-[10px] uppercase tracking-widest text-amber-600 mb-3">Unread Notes from Pat</p>
            <div className="flex flex-col gap-3">
              {unread.map((note) => (
                <div key={note.id} className="flex flex-col gap-0.5">
                  <p className="text-sm text-amber-200 leading-relaxed">{note.text}</p>
                  <p className="text-[10px] text-amber-800 font-mono">
                    {note.id} · {note.source} · {new Date(note.capturedAt).toLocaleDateString()}
                  </p>
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
