import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sidebar } from './components/Sidebar.js';
import { Dashboard } from './components/Dashboard.js';
import { TaskBoard } from './components/TaskBoard.js';
import { ApprovalQueue } from './components/ApprovalQueue.js';
import { DecisionsView } from './components/DecisionsView.js';
import { QuestionsView } from './components/QuestionsView.js';
import { MemoryView } from './components/MemoryView.js';
import { SessionsView } from './components/SessionsView.js';
import { CostView } from './components/CostView.js';
import { SettingsView } from './components/SettingsView.js';
import { useAppStore } from './stores/app.js';
import { PROJECT_PATH } from './config.js';

function MainContent() {
  const view = useAppStore((s) => s.activeView);

  switch (view) {
    case 'dashboard':
      return <Dashboard />;
    case 'tasks':
      return <TaskBoard />;
    case 'decisions':
      return <DecisionsView />;
    case 'questions':
      return <QuestionsView />;
    case 'memory':
      return <MemoryView />;
    case 'sessions':
      return <SessionsView />;
    case 'cost':
      return <CostView />;
    case 'settings':
      return <SettingsView />;
    default:
      return <Dashboard />;
  }
}

export function App() {
  useEffect(() => {
    invoke('start_watching', { projectPath: PROJECT_PATH }).catch(console.error);
  }, []);

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
