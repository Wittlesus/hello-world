import { create } from 'zustand';

export type View = 'dashboard' | 'tasks' | 'decisions' | 'questions' | 'memory' | 'sessions' | 'cost' | 'settings' | 'terminal' | 'skills';

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
  activeView: 'dashboard',
  projectPath: null,
  projectName: null,
  sidebarCollapsed: false,
  setView: (view) => set({ activeView: view }),
  setProject: (path, name) => set({ projectPath: path, projectName: name }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
