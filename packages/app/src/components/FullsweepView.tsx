import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { ViewShell } from './ViewShell.js';

interface AreaGrade {
  area: string;
  grade: string;
  change: 'up' | 'down' | 'same' | 'new';
}

interface SweepNumbers {
  criticalIssues: number;
  tasksCreated: number;
  tasksCleaned: number;
  staleMemories: number;
  directionProcessed: number;
  patCallNeeded: number;
}

interface ActionItem {
  priority: number;
  text: string;
}

interface ChangeItem {
  text: string;
  severity?: 'critical' | 'warning' | 'info';
}

interface FullsweepData {
  date: string;
  session: number;
  overall: string;
  scoreboard: AreaGrade[];
  numbers: SweepNumbers;
  broke: ChangeItem[];
  improved: ChangeItem[];
  topActions: ActionItem[];
  patCall: string[];
}

const GRADE_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  A: { text: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' },
  'A-': { text: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' },
  'B+': { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  B: { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  'B-': { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  'C+': { text: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  C: { text: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  'C-': { text: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  D: { text: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  'D+': { text: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  F: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
};

function gradeStyle(grade: string) {
  return GRADE_COLORS[grade] ?? GRADE_COLORS.F;
}

const CHANGE_ARROWS: Record<string, { symbol: string; color: string }> = {
  up: { symbol: '\u25B2', color: 'text-green-400' },
  down: { symbol: '\u25BC', color: 'text-red-400' },
  same: { symbol: '\u2013', color: 'text-gray-600' },
  new: { symbol: '\u2605', color: 'text-blue-400' },
};

function GradeCard({ area, grade, change }: AreaGrade) {
  const g = gradeStyle(grade);
  const arrow = CHANGE_ARROWS[change] ?? CHANGE_ARROWS.same;
  return (
    <div className={`${g.bg} border ${g.border} rounded-lg p-3 flex items-center justify-between`}>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{area}</span>
        <span className={`text-2xl font-mono font-bold mt-0.5 ${g.text}`}>{grade}</span>
      </div>
      <span className={`text-sm font-mono ${arrow.color}`} title={change}>
        {arrow.symbol}
      </span>
    </div>
  );
}

function NumberStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`text-xl font-mono font-bold ${color}`}>{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-gray-600 mt-0.5">{label}</span>
    </div>
  );
}

function SeverityDot({ severity }: { severity?: string }) {
  if (severity === 'critical') return <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />;
  if (severity === 'warning') return <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 shrink-0" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0" />;
}

export function FullsweepView() {
  const projectPath = useProjectPath();
  const { data } = useTauriData<FullsweepData>('get_fullsweep', projectPath);

  if (!data) {
    return (
      <ViewShell title="Sweep" description="System health report">
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-gray-600 text-sm">No sweep data yet.</span>
          <span className="text-gray-700 text-xs font-mono">Run /fullsweep in the terminal to generate a report.</span>
        </div>
      </ViewShell>
    );
  }

  const n = data.numbers;
  const overall = gradeStyle(data.overall);

  return (
    <ViewShell title="Sweep" description="System health report">
      {/* Header with date + overall grade */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
            Last sweep
          </span>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-gray-300 font-mono">
              {new Date(data.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="text-xs text-gray-600 font-mono">Session #{data.session}</span>
          </div>
        </div>
        <div className={`${overall.bg} border ${overall.border} rounded-xl px-5 py-3 flex flex-col items-center`}>
          <span className="text-[9px] uppercase tracking-widest text-gray-500">Overall</span>
          <span className={`text-4xl font-mono font-black ${overall.text}`}>{data.overall}</span>
        </div>
      </div>

      {/* Scoreboard grid */}
      <div className="grid grid-cols-5 gap-2 mb-6">
        {data.scoreboard.map((s) => (
          <GradeCard key={s.area} {...s} />
        ))}
      </div>

      {/* Numbers row */}
      <div className="bg-[#1a1a24] border border-gray-800 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-around">
          <NumberStat label="Critical" value={n.criticalIssues} color={n.criticalIssues > 0 ? 'text-red-400' : 'text-green-400'} />
          <div className="h-8 w-px bg-gray-800" />
          <NumberStat label="Created" value={n.tasksCreated} color="text-blue-400" />
          <div className="h-8 w-px bg-gray-800" />
          <NumberStat label="Cleaned" value={n.tasksCleaned} color="text-emerald-400" />
          <div className="h-8 w-px bg-gray-800" />
          <NumberStat label="Stale Mems" value={n.staleMemories} color={n.staleMemories > 10 ? 'text-yellow-400' : 'text-gray-400'} />
          <div className="h-8 w-px bg-gray-800" />
          <NumberStat label="Direction" value={n.directionProcessed} color="text-purple-400" />
          <div className="h-8 w-px bg-gray-800" />
          <NumberStat label="Pat's Call" value={n.patCallNeeded} color={n.patCallNeeded > 0 ? 'text-amber-400' : 'text-gray-500'} />
        </div>
      </div>

      {/* Two-column: Broke / Improved */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* What Broke */}
        <div className="bg-[#1a1a24] border border-gray-800 rounded-lg p-4">
          <h3 className="text-[10px] uppercase tracking-wider text-red-500/70 font-semibold mb-3">
            What Broke Since Last Sweep
          </h3>
          {data.broke.length === 0 ? (
            <p className="text-xs text-gray-600 italic">Nothing new broke.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.broke.map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <SeverityDot severity={item.severity} />
                  <span className="text-xs text-gray-300 leading-relaxed">{item.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* What Improved */}
        <div className="bg-[#1a1a24] border border-gray-800 rounded-lg p-4">
          <h3 className="text-[10px] uppercase tracking-wider text-green-500/70 font-semibold mb-3">
            What Got Better
          </h3>
          {data.improved.length === 0 ? (
            <p className="text-xs text-gray-600 italic">Baseline established.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.improved.map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 mt-1" />
                  <span className="text-xs text-gray-300 leading-relaxed">{item.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top 3 Actions */}
      <div className="bg-[#1a1a24] border border-gray-800 rounded-lg p-4 mb-6">
        <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-3">
          Top Actions
        </h3>
        <div className="flex flex-col gap-2">
          {data.topActions.map((action, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className={`text-sm font-mono font-bold shrink-0 w-6 text-right ${
                i === 0 ? 'text-amber-400' : i === 1 ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {action.priority}.
              </span>
              <span className="text-xs text-gray-300 leading-relaxed">{action.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Pat's Call */}
      {data.patCall.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-900/40 rounded-lg p-4 mb-6">
          <h3 className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold mb-3">
            Pat's Call Needed
          </h3>
          <div className="flex flex-col gap-1.5">
            {data.patCall.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-amber-700 text-xs shrink-0">?</span>
                <span className="text-xs text-amber-200 leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-[9px] text-gray-700 font-mono">
        Generated by /fullsweep. Run again to refresh.
      </div>
    </ViewShell>
  );
}
