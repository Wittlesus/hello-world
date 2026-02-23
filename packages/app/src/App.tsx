import { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Sidebar } from './components/Sidebar.js';
import { Dashboard } from './components/Dashboard.js';
import { TaskBoard } from './components/TaskBoard.js';
import { ApprovalQueue } from './components/ApprovalQueue.js';
import { DecisionsView } from './components/DecisionsView.js';
import { QuestionsView } from './components/QuestionsView.js';
import { MemoryView } from './components/MemoryView.js';
import { CostView } from './components/CostView.js';
import { SettingsView } from './components/SettingsView.js';
import { SkillsView } from './components/SkillsView.js';
import { WatchersView } from './components/WatchersView.js';
import { ProjectContextView } from './components/ProjectContextView.js';
import { TerminalView } from './components/TerminalView.js';
import { ProjectSetup } from './components/ProjectSetup.js';
import { ClaudeBuddy } from './components/ClaudeBuddy.js';
import { HelpModal } from './components/HelpModal.js';
import { HistoryView } from './components/HistoryView.js';
import { AgentsView } from './components/AgentsView.js';
import { useAppStore, type View } from './stores/app.js';

const KEY_MAP: Record<string, View> = {
  '1': 'dashboard',
  '2': 'tasks',
  '3': 'decisions',
  '4': 'questions',
  '5': 'memory',
  '7': 'cost',
  '8': 'settings',
  't': 'terminal',
  'a': 'approvals',
  'g': 'agents',
  'h': 'history',
  'k': 'skills',
  'p': 'context',
  'w': 'watchers',
};

function MainContent() {
  const view = useAppStore((s) => s.activeView);

  return (
    <>
      {view === 'dashboard'  && <Dashboard />}
      {view === 'tasks'      && <TaskBoard />}
      {view === 'decisions'  && <DecisionsView />}
      {view === 'questions'  && <QuestionsView />}
      {view === 'memory'     && <MemoryView />}
      {view === 'history'    && <HistoryView />}
      {view === 'agents'     && <AgentsView />}
      {view === 'cost'       && <CostView />}
      {view === 'settings'   && <SettingsView />}
      {view === 'skills'     && <SkillsView />}
      {view === 'watchers'   && <WatchersView />}
      {view === 'context'    && <ProjectContextView />}

      {/* Approvals as standalone full view */}
      {view === 'approvals'  && (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4">
          <ApprovalQueue standalone />
        </div>
      )}

      {/* Terminal stays mounted always — PTY + xterm survive tab switches */}
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
  const [showHelp, setShowHelp] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '?') { setShowHelp(true); return; }
    const view = KEY_MAP[e.key.toLowerCase()];
    if (view) setView(view);
  }, [setView]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    invoke<string | null>('get_app_project_path')
      .then((path) => { if (path) setProject(path, ''); })
      .catch(() => {})
      .finally(() => setBootstrapping(false));
  }, []);

  useEffect(() => {
    if (!projectPath) return;
    invoke('start_watching', { projectPath }).catch(console.error);
    invoke<{ config: { name: string } }>('get_config', { projectPath })
      .then((data) => setProject(projectPath, data.config.name))
      .catch(() => {});
  }, [projectPath]);

  // Auto-navigate to Agents tab when a deliberation session starts
  const prevDelibStatus = useRef<string>('idle');
  useEffect(() => {
    if (!projectPath) return;
    const unlisten = listen<string[]>('hw-files-changed', async (e) => {
      if (!e.payload.includes('chatroom.json')) return;
      try {
        const raw = await invoke<string>('get_chatroom', { projectPath });
        const cr = JSON.parse(raw) as { session: { status: string } };
        const status = cr.session.status;
        if (prevDelibStatus.current === 'idle' && status === 'active') {
          setView('agents');
        }
        prevDelibStatus.current = status;
      } catch { /* ignore */ }
    });
    return () => { unlisten.then(fn => fn()); };
  }, [projectPath, setView]);

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
        <Sidebar onShowHelp={() => setShowHelp(true)} />
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <MainContent />
        </main>
      </div>
      <ApprovalQueue />
      <ClaudeBuddy />
      <HelpModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
