import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { TaskBoard } from './components/TaskBoard';
import { ApprovalQueue } from './components/ApprovalQueue';
import { PlaceholderView } from './components/PlaceholderView';
import { useAppStore } from './stores/app';

function MainContent() {
  const view = useAppStore((s) => s.activeView);

  switch (view) {
    case 'dashboard':
      return <Dashboard />;
    case 'tasks':
      return <TaskBoard />;
    case 'decisions':
      return <PlaceholderView title="Decisions" description="Architecture decisions and rationale — wired in next step" />;
    case 'memory':
      return <PlaceholderView title="Memory" description="Brain state, hot tags, and memory dashboard — wired in next step" />;
    case 'sessions':
      return <PlaceholderView title="Sessions" description="Session history and cost tracking — wired in next step" />;
    case 'cost':
      return <PlaceholderView title="Cost" description="Spending by model, session, and project — wired in next step" />;
    case 'settings':
      return <PlaceholderView title="Settings" description="Project configuration, MCP servers, budgets — wired in next step" />;
    default:
      return <Dashboard />;
  }
}

export function App() {
  return (
    <div className="h-screen flex flex-col bg-[#0a0a0f] text-gray-200">
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <MainContent />
        </main>
      </div>
      <ApprovalQueue />
    </div>
  );
}
