import { create } from 'zustand';

export type View =
  | 'terminal' | 'dashboard' | 'approvals' | 'files'
  | 'tasks' | 'decisions' | 'questions' | 'agents'
  | 'memory' | 'context' | 'history'
  | 'settings' | 'cost' | 'skills' | 'watchers';

interface AppState {
  activeView: View;
  projectPath: string | null;
  projectName: string | null;
  sidebarCollapsed: boolean;
  setView: (view: View) => void;
  setProject: (path: string, name: string) => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeView: 'terminal',
  projectPath: null,
  projectName: null,
  sidebarCollapsed: false,
  setView: (view) => set({ activeView: view }),
  setProject: (path, name) => set({ projectPath: path, projectName: name }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
