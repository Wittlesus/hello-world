import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Activity, useCallback, useEffect, useRef, useState } from 'react';
import { AgentsView } from './components/AgentsView.js';
import { ClaudeBuddy } from './components/ClaudeBuddy.js';
import { CommandPalette } from './components/CommandPalette.js';
import { CostView } from './components/CostView.js';
import { Dashboard } from './components/Dashboard.js';
import { DecisionsView } from './components/DecisionsView.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { FilesView } from './components/FilesView.js';
import { FullsweepView } from './components/FullsweepView.js';
import { HelpModal } from './components/HelpModal.js';
import { HistoryView } from './components/HistoryView.js';
import { MemoryView } from './components/MemoryView.js';
import { ProjectContextView } from './components/ProjectContextView.js';
import { ProjectSetup } from './components/ProjectSetup.js';
import { SettingsView } from './components/SettingsView.js';
import { Sidebar } from './components/Sidebar.js';
import { SkillsView } from './components/SkillsView.js';
import { TaskBoard } from './components/TaskBoard.js';
import { TerminalView } from './components/TerminalView.js';
import { WatchersView } from './components/WatchersView.js';
import { ClaudeMdView } from './components/ClaudeMdView.js';
import { useAppStore, type View } from './stores/app.js';

const KEY_MAP: Record<string, View> = {
  '1': 'dashboard',
  '2': 'tasks',
  '3': 'decisions',
  '4': 'memory',
  '5': 'history',
  '6': 'cost',
  '7': 'settings',
  t: 'terminal',
  g: 'agents',
  h: 'history',
  k: 'skills',
  p: 'context',
  w: 'watchers',
  f: 'files',
  s: 'sweep',
  b: 'bible',
};

function MainContent() {
  const view = useAppStore((s) => s.activeView);

  return (
    <>
      <Activity mode={view === 'dashboard' ? 'visible' : 'hidden'}><Dashboard /></Activity>
      <Activity mode={view === 'tasks' ? 'visible' : 'hidden'}><TaskBoard /></Activity>
      <Activity mode={view === 'decisions' ? 'visible' : 'hidden'}><DecisionsView /></Activity>
      <Activity mode={view === 'memory' ? 'visible' : 'hidden'}><MemoryView /></Activity>
      <Activity mode={view === 'history' ? 'visible' : 'hidden'}><HistoryView /></Activity>
      <Activity mode={view === 'agents' ? 'visible' : 'hidden'}>
        <ErrorBoundary label="agents"><AgentsView /></ErrorBoundary>
      </Activity>
      <Activity mode={view === 'cost' ? 'visible' : 'hidden'}><CostView /></Activity>
      <Activity mode={view === 'settings' ? 'visible' : 'hidden'}><SettingsView /></Activity>
      <Activity mode={view === 'skills' ? 'visible' : 'hidden'}><SkillsView /></Activity>
      <Activity mode={view === 'watchers' ? 'visible' : 'hidden'}><WatchersView /></Activity>
      <Activity mode={view === 'context' ? 'visible' : 'hidden'}><ProjectContextView /></Activity>
      <Activity mode={view === 'files' ? 'visible' : 'hidden'}><FilesView /></Activity>
      <Activity mode={view === 'sweep' ? 'visible' : 'hidden'}><FullsweepView /></Activity>
      <Activity mode={view === 'bible' ? 'visible' : 'hidden'}><ClaudeMdView /></Activity>
      <Activity mode={view === 'terminal' ? 'visible' : 'hidden'}>
        <TerminalView />
      </Activity>
    </>
  );
}

export function App() {
  const { projectPath, setProject } = useAppStore();
  const setView = useAppStore((s) => s.setView);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [showCommands, setShowCommands] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') {
        setShowHelp(true);
        return;
      }
      if (e.key === '/') {
        setShowCommands(true);
        return;
      }
      const view = KEY_MAP[e.key.toLowerCase()];
      if (view) setView(view);
    },
    [setView],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    invoke<string | null>('get_app_project_path')
      .then((path) => {
        if (path) setProject(path, '');
      })
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
        if (prevDelibStatus.current !== 'active' && status === 'active') {
          setView('agents');
        }
        prevDelibStatus.current = status;
      } catch {
        /* ignore */
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [projectPath, setView]);

  if (bootstrapping) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0a0f] flex-col gap-3">
        <div className="w-6 h-6 border-2 border-gray-700 border-t-indigo-500 rounded-full animate-spin" />
        <span className="text-[13px] text-gray-500">Hello World</span>
      </div>
    );
  }

  if (!projectPath) {
    return <ProjectSetup onProjectSet={(path) => setProject(path, '')} />;
  }

  return (
    <ErrorBoundary label="app">
      <div className="h-screen flex flex-col bg-[#0a0a0f] text-gray-200">
        <div className="flex-1 flex min-h-0">
          <Sidebar onShowHelp={() => setShowHelp(true)} onShowCommands={() => setShowCommands(true)} />
          <main className="flex-1 flex flex-col min-w-0 min-h-0">
            <MainContent />
          </main>
        </div>
        <ClaudeBuddy />
        <HelpModal open={showHelp} onClose={() => setShowHelp(false)} />
        <CommandPalette open={showCommands} onClose={() => setShowCommands(false)} />
      </div>
    </ErrorBoundary>
  );
}
