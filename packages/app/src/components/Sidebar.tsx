import { useAppStore, type View } from '../stores/app';

const NAV_ITEMS: { view: View; label: string; icon: string }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: 'HW' },
  { view: 'tasks', label: 'Tasks', icon: 'TK' },
  { view: 'decisions', label: 'Decisions', icon: 'DC' },
  { view: 'memory', label: 'Memory', icon: 'BR' },
  { view: 'sessions', label: 'Sessions', icon: 'SS' },
  { view: 'cost', label: 'Cost', icon: '$' },
  { view: 'settings', label: 'Settings', icon: 'ST' },
];

export function Sidebar() {
  const { activeView, setView, projectName, sidebarCollapsed, toggleSidebar } = useAppStore();

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

      <button
        onClick={toggleSidebar}
        className="px-3 py-2 text-gray-500 hover:text-gray-300 text-xs border-t border-gray-800"
      >
        {sidebarCollapsed ? '>>' : '<< Collapse'}
      </button>
    </aside>
  );
}
