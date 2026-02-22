import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { ActivityStream } from './ActivityStream.js';

interface BrainState {
  state: {
    messageCount: number;
    contextPhase: 'early' | 'mid' | 'late';
    activeTraces: string[];
  };
}

interface StateData {
  tasks: Array<{ status: string }>;
}

interface SessionsData {
  sessions: Array<{ id: string; endedAt?: string }>;
}

const PHASE_DOT: Record<string, string> = {
  early: 'bg-green-500',
  mid: 'bg-yellow-500',
  late: 'bg-red-500',
};

export function Dashboard() {
  const projectPath = useProjectPath();
  const { data: brainData } = useTauriData<BrainState>('get_brain_state', projectPath);
  const { data: stateData } = useTauriData<StateData>('get_state', projectPath);
  const { data: sessionsData } = useTauriData<SessionsData>('get_sessions', projectPath);

  const brain = brainData?.state;
  const tasks = stateData?.tasks ?? [];
  const sessions = sessionsData?.sessions ?? [];

  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const todo = tasks.filter((t) => t.status === 'todo').length;
  const currentSession = sessions.filter((s) => !s.endedAt).length > 0
    ? sessions.length
    : null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Status bar */}
      <div className="flex items-center gap-5 px-4 py-2 border-b border-gray-800/70 bg-[#0d0d14]">
        <span className="text-[11px] font-semibold text-gray-300">Dashboard</span>
        <div className="h-3 w-px bg-gray-800" />

        {brain ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${PHASE_DOT[brain.contextPhase] ?? 'bg-gray-500'}`} />
              <span className="text-[11px] text-gray-500">{brain.contextPhase} phase</span>
            </div>
            <span className="text-[11px] text-gray-500">{brain.messageCount} msgs</span>
            {brain.activeTraces.length > 0 && (
              <span className="text-[11px] text-gray-500">{brain.activeTraces.length} traces</span>
            )}
          </>
        ) : (
          <span className="text-[11px] text-gray-600">brain idle</span>
        )}

        <div className="h-3 w-px bg-gray-800" />

        {inProgress > 0 && (
          <span className="text-[11px] text-blue-400">{inProgress} in progress</span>
        )}
        {todo > 0 && (
          <span className="text-[11px] text-gray-500">{todo} todo</span>
        )}
        {currentSession && (
          <span className="text-[11px] text-gray-500">session #{currentSession}</span>
        )}
      </div>

      <ActivityStream />
    </div>
  );
}
