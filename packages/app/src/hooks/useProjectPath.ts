import { useAppStore } from '../stores/app.js';

export function useProjectPath(): string {
  return useAppStore((s) => s.projectPath) ?? '';
}
