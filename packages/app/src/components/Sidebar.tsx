import { invoke } from '@tauri-apps/api/core';
import { Brain, CheckSquare, Command, HelpCircle, Settings } from 'lucide-react';
import { useCallback } from 'react';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { useAppStore, type View } from '../stores/app.js';
import { UsageBars } from './UsageBars.js';

// Anthropic A-mark — matches Lucide stroke style at small sizes
function AnthropicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 13L8 3L13.5 13" />
      <path d="M5.2 9.5H10.8" />
    </svg>
  );
}

type Section = 'claude' | 'tasks' | 'brain' | 'settings';

interface SubTab {
  view: View;
  label: string;
  key: string;
}
interface SectionDef {
  id: Section;
  label: string;
  defaultView: View;
  Icon: React.ComponentType<{ size?: number }>;
  tabs: SubTab[];
}

const SECTIONS: SectionDef[] = [
  {
    id: 'claude',
    label: 'Claude',
    defaultView: 'terminal',
    Icon: AnthropicIcon,
    tabs: [
      { view: 'terminal', label: 'Terminal', key: 'T' },
      { view: 'agents', label: 'Deliberation Room', key: 'D' },
      { view: 'dashboard', label: 'Dashboard', key: '1' },
      { view: 'files', label: 'Files', key: 'F' },
    ],
  },
  {
    id: 'tasks',
    label: 'Tasks',
    defaultView: 'tasks',
    Icon: CheckSquare,
    tabs: [
      { view: 'tasks', label: 'Board', key: '2' },
      { view: 'decisions', label: 'Decisions', key: '3' },
    ],
  },
  {
    id: 'brain',
    label: 'Brain',
    defaultView: 'memory',
    Icon: Brain,
    tabs: [
      { view: 'memory', label: 'Memory', key: '4' },
      { view: 'bible', label: 'Bible', key: 'B' },
      { view: 'context', label: 'Context', key: 'P' },
      { view: 'history', label: 'History', key: '5' },
      { view: 'sweep', label: 'Sweep', key: 'S' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    defaultView: 'settings',
    Icon: Settings,
    tabs: [
      { view: 'settings', label: 'Config', key: '7' },
      { view: 'cost', label: 'Cost', key: '6' },
      { view: 'skills', label: 'Skills', key: 'K' },
      { view: 'watchers', label: 'Watchers', key: 'W' },
    ],
  },
];

function getSection(view: View): Section {
  if (['terminal', 'agents', 'dashboard', 'files'].includes(view)) return 'claude';
  if (['tasks', 'decisions'].includes(view)) return 'tasks';
  if (['memory', 'context', 'history', 'sweep', 'bible'].includes(view)) return 'brain';
  return 'settings';
}

const PHASE_COLOR: Record<string, string> = {
  idle: 'text-gray-500',
  scope: 'text-yellow-400',
  plan: 'text-blue-400',
  build: 'text-indigo-400',
  verify: 'text-orange-400',
  ship: 'text-green-400',
};
const PHASE_DOT: Record<string, string> = {
  idle: 'bg-gray-500',
  scope: 'bg-yellow-400',
  plan: 'bg-blue-400',
  build: 'bg-indigo-400',
  verify: 'bg-orange-400',
  ship: 'bg-green-400',
};

interface WorkflowData {
  phase: string;
  strikes: number;
}

interface SidebarProps {
  onShowHelp?: () => void;
  onShowCommands?: () => void;
}

interface ModeData {
  overdrive?: boolean;
}

export function Sidebar({ onShowHelp, onShowCommands }: SidebarProps) {
  const { activeView, setView, projectName, sidebarCollapsed, toggleSidebar } = useAppStore();
  const projectPath = useProjectPath();
  const { data: workflowData } = useTauriData<WorkflowData>('get_workflow', projectPath);
  const { data: modeData } = useTauriData<ModeData>('get_mode', projectPath);

  const phase = workflowData?.phase ?? 'idle';
  const strikes = workflowData?.strikes ?? 0;
  const isOverdrive = modeData?.overdrive === true;
  const phaseColor = isOverdrive ? 'text-amber-400' : (PHASE_COLOR[phase] ?? 'text-gray-400');
  const phaseDot = isOverdrive ? 'bg-amber-400' : (PHASE_DOT[phase] ?? 'bg-gray-500');
  const activeSection = getSection(activeView);

  const toggleOverdrive = useCallback(() => {
    if (!projectPath) return;
    invoke('set_mode', { projectPath, overdrive: !isOverdrive }).catch(() => {});
  }, [projectPath, isOverdrive]);

  return (
    <aside
      className={`flex flex-col bg-[#0d0d14] border-r border-gray-800/70 transition-all duration-200 ${sidebarCollapsed ? 'w-14' : 'w-48'}`}
    >
      {/* Project name */}
      <div className="h-9 flex items-center px-3 border-b border-gray-800/70 drag-region shrink-0">
        {!sidebarCollapsed && (
          <span className="text-[11px] font-semibold text-white/70 truncate tracking-wide">
            {projectName ?? 'Hello World'}
          </span>
        )}
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto py-2 min-h-0">
        {SECTIONS.map((section, si) => {
          const isActiveSection = activeSection === section.id;
          const { Icon } = section;

          return (
            <div key={section.id} className={si > 0 ? 'mt-1' : ''}>
              {/* Section header */}
              <button
                type="button"
                onClick={() => setView(section.defaultView)}
                title={sidebarCollapsed ? section.label : undefined}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 transition-colors group ${
                  isActiveSection ? 'text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <span className="w-5 flex items-center justify-center shrink-0">
                  <Icon size={14} />
                </span>
                {!sidebarCollapsed && (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">
                    {section.label}
                  </span>
                )}
              </button>

              {/* Subtabs (expanded only, active section only) */}
              {!sidebarCollapsed && isActiveSection && (
                <div className="mb-1">
                  {section.tabs.map(({ view, label, key }) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setView(view)}
                      className={`w-full flex items-center justify-between pl-8 pr-3 py-[5px] text-xs transition-colors ${
                        activeView === view
                          ? 'text-white bg-white/[0.07] border-l-2 border-white/20'
                          : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03] border-l-2 border-transparent'
                      }`}
                    >
                      <span>{label}</span>
                      <span className="text-[10px] font-mono text-gray-700">{key}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Command palette button */}
      {onShowCommands && (
        <button
          onClick={onShowCommands}
          title="Commands (/)"
          className="border-t border-indigo-500/20 px-3 py-2.5 shrink-0 w-full text-left transition-colors bg-indigo-500/[0.06] hover:bg-indigo-500/[0.12] group"
        >
          {sidebarCollapsed ? (
            <div className="flex justify-center">
              <Command size={14} className="text-indigo-400 group-hover:text-indigo-300" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Command size={13} className="text-indigo-400 group-hover:text-indigo-300" />
              <span className="text-[11px] text-indigo-400 group-hover:text-indigo-300 font-medium">Commands</span>
              <kbd className="ml-auto text-[9px] text-indigo-500/60 bg-indigo-500/10 px-1 rounded font-mono">/</kbd>
            </div>
          )}
        </button>
      )}

      {/* Phase indicator + overdrive toggle */}
      <button
        type="button"
        onClick={toggleOverdrive}
        title={isOverdrive ? 'Click to disable overdrive' : 'Click to enable overdrive'}
        className={`border-t px-3 py-2 shrink-0 w-full text-left transition-colors ${isOverdrive ? 'border-amber-900/40 bg-amber-950/20 hover:bg-amber-950/30' : 'border-gray-800/60 hover:bg-white/[0.02]'}`}
      >
        {sidebarCollapsed ? (
          <div
            className="flex justify-center"
            title={isOverdrive ? 'OVERDRIVE (click to toggle)' : `Phase: ${phase} (click for overdrive)`}
          >
            <span className={`w-2 h-2 rounded-full ${phaseDot} ${isOverdrive ? 'animate-pulse' : ''}`} />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${phaseDot} ${isOverdrive ? 'animate-pulse' : ''}`} />
            {isOverdrive ? (
              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400">
                overdrive
              </span>
            ) : (
              <span className={`text-[10px] font-mono uppercase tracking-wider ${phaseColor}`}>
                {phase}
              </span>
            )}
            {strikes > 0 && (
              <span className="ml-auto text-[10px] text-yellow-500">{strikes}/2</span>
            )}
          </div>
        )}
      </button>

      {/* Usage bars */}
      <UsageBars collapsed={sidebarCollapsed} />

      {/* Help + collapse */}
      {onShowHelp && (
        <button
          onClick={onShowHelp}
          title="Keyboard shortcuts (?)"
          className="px-3 py-2 text-gray-600 hover:text-gray-400 border-t border-gray-800/60 flex items-center gap-2 shrink-0"
        >
          <span className="w-5 flex items-center justify-center">
            <HelpCircle size={13} />
          </span>
          {!sidebarCollapsed && <span className="text-[11px]">Shortcuts</span>}
        </button>
      )}

      <button
        onClick={toggleSidebar}
        className="px-3 py-2 text-gray-600 hover:text-gray-400 text-[11px] border-t border-gray-800/60 shrink-0 text-left"
      >
        {sidebarCollapsed ? '>>' : '<< Collapse'}
      </button>
    </aside>
  );
}
