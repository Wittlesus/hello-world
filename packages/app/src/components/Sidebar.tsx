import { useAppStore, type View } from '../stores/app.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';

const NAV_ITEMS: { view: View; label: string; icon: string }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: 'HW' },
  { view: 'terminal', label: 'Terminal', icon: '⌨' },
  { view: 'tasks', label: 'Tasks', icon: 'TK' },
  { view: 'decisions', label: 'Decisions', icon: 'DC' },
  { view: 'questions', label: 'Questions', icon: 'Q?' },
  { view: 'memory', label: 'Memory', icon: 'BR' },
  { view: 'sessions', label: 'Sessions', icon: 'SS' },
  { view: 'cost', label: 'Cost', icon: '$' },
  { view: 'skills', label: 'Skills', icon: 'SK' },
  { view: 'watchers', label: 'Agents', icon: 'AG' },
  { view: 'context', label: 'Context', icon: 'CX' },
  { view: 'timeline', label: 'Timeline', icon: 'TL' },
  { view: 'settings', label: 'Settings', icon: 'ST' },
];

const PHASE_COLOR: Record<string, string> = {
  idle:   'text-gray-500',
  scope:  'text-yellow-400',
  plan:   'text-blue-400',
  build:  'text-indigo-400',
  verify: 'text-orange-400',
  ship:   'text-green-400',
};

const PHASE_DOT: Record<string, string> = {
  idle:   'bg-gray-500',
  scope:  'bg-yellow-400',
  plan:   'bg-blue-400',
  build:  'bg-indigo-400',
  verify: 'bg-orange-400',
  ship:   'bg-green-400',
};

interface WorkflowData { phase: string; strikes: number }

export function Sidebar() {
  const { activeView, setView, projectName, sidebarCollapsed, toggleSidebar } = useAppStore();
  const projectPath = useProjectPath();
  const { data: workflowData } = useTauriData<WorkflowData>('get_workflow', projectPath);

  const phase   = workflowData?.phase ?? 'idle';
  const strikes = workflowData?.strikes ?? 0;
  const phaseColor = PHASE_COLOR[phase] ?? 'text-gray-400';
  const phaseDot   = PHASE_DOT[phase] ?? 'bg-gray-500';

  return (
    <aside className={`flex flex-col bg-[#111118] border-r border-gray-800 transition-all ${sidebarCollapsed ? 'w-14' : 'w-52'}`}>
      <div className="h-9 flex items-center px-3 border-b border-gray-800 drag-region">
        {!sidebarCollapsed && (
          <span className="text-sm font-semibold text-white truncate">{projectName ?? 'Hello World'}</span>
        )}
      </div>

      <nav className="flex-1 py-2">
        {NAV_ITEMS.map(({ view, label, icon }) => (
          <button
            key={view}
            onClick={() => setView(view)}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
              activeView === view
                ? 'bg-gray-800/60 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/30'
            }`}
          >
            <span className="w-6 text-center text-xs font-mono opacity-60">{icon}</span>
            {!sidebarCollapsed && <span>{label}</span>}
          </button>
        ))}
      </nav>

      {/* Workflow phase indicator */}
      <div className="border-t border-gray-800/60 px-3 py-2.5">
        {sidebarCollapsed ? (
          <div className="flex justify-center" title={`Phase: ${phase}${strikes > 0 ? ` (${strikes}/2 strikes)` : ''}`}>
            <span className={`w-2 h-2 rounded-full ${phaseDot}`} />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${phaseDot}`} />
            <span className={`text-[11px] font-mono uppercase ${phaseColor}`}>{phase}</span>
            {strikes > 0 && (
              <span className="ml-auto text-[10px] text-yellow-500">{strikes}/2</span>
            )}
          </div>
        )}
      </div>

      <button
        onClick={toggleSidebar}
        className="px-3 py-2 text-gray-500 hover:text-gray-300 text-xs border-t border-gray-800"
      >
        {sidebarCollapsed ? '>>' : '<< Collapse'}
      </button>
    </aside>
  );
}
