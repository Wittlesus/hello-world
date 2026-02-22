import { useEffect, useState, useCallback } from 'react';
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
import { TerminalView } from './components/TerminalView.js';
import { ProjectSetup } from './components/ProjectSetup.js';
import { useAppStore, type View } from './stores/app.js';

const KEY_MAP: Record<string, View> = {
  '1': 'dashboard',
  '2': 'tasks',
  '3': 'decisions',
  '4': 'questions',
  '5': 'memory',
  '6': 'sessions',
  '7': 'cost',
  '8': 'settings',
  't': 'terminal',
};

function MainContent() {
  const view = useAppStore((s) => s.activeView);

  return (
    <>
      {/* Standard views — mount/unmount normally */}
      {view === 'dashboard'  && <Dashboard />}
      {view === 'tasks'      && <TaskBoard />}
      {view === 'decisions'  && <DecisionsView />}
      {view === 'questions'  && <QuestionsView />}
      {view === 'memory'     && <MemoryView />}
      {view === 'sessions'   && <SessionsView />}
      {view === 'cost'       && <CostView />}
      {view === 'settings'   && <SettingsView />}

      {/* Terminal stays mounted always — hidden when not active so PTY and xterm.js survive tab switches */}
      <div className="flex-1 flex flex-col min-h-0" style={{ display: view === 'terminal' ? 'flex' : 'none' }}>
        <TerminalView />
      </div>
    </>
  );
}

export function App() {
  const { projectPath, setProject } = useAppStore();
  const setView = useAppStore((s) => s.setView);
  const [bootstrapping, setBootstrapping] = useState(true);

  // Global keyboard shortcuts — number keys and letters switch views
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't intercept when user is typing in inputs
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const view = KEY_MAP[e.key];
    if (view) setView(view);
  }, [setView]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    invoke<string | null>('get_app_project_path')
      .then((path) => {
        if (path) setProject(path, '');
      })
      .catch(() => {}) // no stored path → show setup screen
      .finally(() => setBootstrapping(false));
  }, []);

  // Once we have a path, start the file watcher and load project name
  useEffect(() => {
    if (!projectPath) return;
    invoke('start_watching', { projectPath }).catch(console.error);
    invoke<{ config: { name: string } }>('get_config', { projectPath })
      .then((data) => setProject(projectPath, data.config.name))
      .catch(() => {});
  }, [projectPath]);

  if (bootstrapping) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0a0f]">
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    );
  }

  if (!projectPath) {
    return <ProjectSetup onProjectSet={(path) => setProject(path, '')} />;
  }

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0f] text-gray-200">
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <MainContent />
        </main>
      </div>
      <ApprovalQueue />
    </div>
  );
}
