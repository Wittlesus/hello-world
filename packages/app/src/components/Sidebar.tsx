import {
  LayoutDashboard, CheckSquare, BookOpen, HelpCircle, Brain,
  Clock, DollarSign, Zap, Terminal, Eye, FolderOpen, GitBranch,
  Settings,
} from 'lucide-react';
import { useAppStore, type View } from '../stores/app.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';

interface NavItem {
  view: View;
  label: string;
  key: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { view: 'dashboard',  label: 'Dashboard',       key: '1', Icon: LayoutDashboard },
  { view: 'terminal',   label: 'Terminal',         key: 'T', Icon: Terminal },
  { view: 'tasks',      label: 'Tasks',            key: '2', Icon: CheckSquare },
  { view: 'decisions',  label: 'Decisions',        key: '3', Icon: BookOpen },
  { view: 'questions',  label: 'Questions',        key: '4', Icon: HelpCircle },
  { view: 'memory',     label: 'Memory',           key: '5', Icon: Brain },
  { view: 'sessions',   label: 'Sessions',         key: '6', Icon: Clock },
  { view: 'cost',       label: 'Cost',             key: '7', Icon: DollarSign },
  { view: 'settings',   label: 'Settings',         key: '8', Icon: Settings },
  { view: 'skills',     label: 'Skills',           key: 'K', Icon: Zap },
  { view: 'watchers',   label: 'Agents',           key: 'W', Icon: Eye },
  { view: 'context',    label: 'Context',          key: 'P', Icon: FolderOpen },
  { view: 'timeline',   label: 'Timeline',         key: 'L', Icon: GitBranch },
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

interface SidebarProps {
  onShowHelp?: () => void;
}

export function Sidebar({ onShowHelp }: SidebarProps) {
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
        {NAV_ITEMS.map(({ view, label, key, Icon }) => (
          <button
            key={view}
            onClick={() => setView(view)}
            title={`${label} (${key})`}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
              activeView === view
                ? 'bg-gray-800/60 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/30'
            }`}
          >
            <span className="w-6 flex items-center justify-center shrink-0">
              <Icon size={16} />
            </span>
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

      {/* Help button */}
      {onShowHelp && (
        <button
          onClick={onShowHelp}
          title="Keyboard shortcuts (?)"
          className="px-3 py-2 text-gray-500 hover:text-gray-300 text-xs border-t border-gray-800 flex items-center gap-2"
        >
          <span className="w-6 flex items-center justify-center">
            <HelpCircle size={14} />
          </span>
          {!sidebarCollapsed && <span>Shortcuts</span>}
        </button>
      )}

      <button
        onClick={toggleSidebar}
        className="px-3 py-2 text-gray-500 hover:text-gray-300 text-xs border-t border-gray-800"
      >
        {sidebarCollapsed ? '>>' : '<< Collapse'}
      </button>
    </aside>
  );
}
