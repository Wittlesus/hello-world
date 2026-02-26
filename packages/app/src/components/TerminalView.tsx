import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
}
interface StateData {
  tasks: Task[];
}
interface ActivityEvent {
  id: string;
  type: string;
  description: string;
  timestamp: string;
}
interface ActivityData {
  activities: ActivityEvent[];
}
interface WorkflowData {
  phase: string;
}
interface Memory {
  id: string;
  type: 'pain' | 'win' | 'fact' | 'decision' | 'architecture';
  title: string;
  severity: 'low' | 'medium' | 'high';
  createdAt: string;
  links?: Array<{ targetId: string; type: string }>;
  qualityScore?: number;
}
interface MemoriesData {
  memories: Memory[];
}
interface ApprovalsData {
  pending: Array<{ id: string; status: string }>;
  resolved: Array<{ id: string }>;
}

const PHASE_DOT: Record<string, string> = {
  idle: 'bg-gray-500',
  scope: 'bg-yellow-400',
  plan: 'bg-blue-400',
  build: 'bg-indigo-400',
  verify: 'bg-orange-400',
  ship: 'bg-green-400',
};

// -- Dual-panel bottom flowchart types --

interface ToolSummaryPayload {
  type: string;
  files?: string[];
  events?: Array<{ tool: string; summary: string }>;
  summary?: string;
}

// Map filenames to system node IDs
const FILE_TO_SYS_NODE: Record<string, string> = {
  'tasks.json': 'sys-tasks',
  'memories.json': 'sys-memory',
  'workflow.json': 'sys-workflow',
  'approvals.json': 'sys-approvals',
  'brain-state.json': 'sys-brainstate',
  'cortex-learned.json': 'sys-cortexlearn',
  'learned-rules.json': 'sys-rules',
};

// Map filenames to brain node IDs
const FILE_TO_BRAIN_NODE: Record<string, string> = {
  'memories.json': 'brain-linker',
  'brain-state.json': 'brain-health',
  'cortex-learned.json': 'brain-cortex',
  'learned-rules.json': 'brain-rules',
  'memories-archive.json': 'brain-pruner',
};

// CSS injected once for glow animations
const DUAL_FLOW_CSS = `
@keyframes node-glow {
  0%, 100% { box-shadow: 0 0 12px var(--glow-color, rgba(0,229,255,0.3)); }
  50% { box-shadow: 0 0 24px var(--glow-color, rgba(0,229,255,0.5)); }
}
@keyframes pain-pulse {
  0%, 100% { box-shadow: 0 0 15px rgba(255,45,85,0.35); }
  50% { box-shadow: 0 0 30px rgba(255,45,85,0.55); }
}
`;

interface FlowNodeProps {
  label: string;
  accent: string;
  active: boolean;
  stat?: string;
  pulse?: 'glow' | 'pain';
}

function FlowNode({ label, accent, active, stat, pulse }: FlowNodeProps) {
  const baseBg = active ? `${accent}26` : '#0a0a0f';
  const borderColor = active ? accent : '#1a1a30';
  const animation = active && pulse === 'pain'
    ? 'pain-pulse 1.5s ease-in-out infinite'
    : active && pulse === 'glow'
      ? 'node-glow 1.5s ease-in-out infinite'
      : 'none';

  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 4,
        fontSize: 8,
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontFamily: 'monospace',
        border: `1px solid ${borderColor}`,
        background: baseBg,
        color: active ? accent : '#5a5a72',
        transition: 'all 0.4s ease',
        animation,
        ['--glow-color' as string]: `${accent}50`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        minWidth: 52,
      }}
    >
      <span>{label}</span>
      {stat != null && (
        <span style={{ fontSize: 6, opacity: 0.6, color: active ? accent : '#3a3a52' }}>
          {stat}
        </span>
      )}
    </div>
  );
}

function FlowArrow({ direction, active }: { direction: 'right' | 'down'; active: boolean }) {
  const ch = direction === 'right' ? '\u2192' : '\u2193';
  return (
    <span
      style={{
        color: active ? '#00e5ff' : '#5a5a72',
        fontSize: 10,
        fontFamily: 'monospace',
        transition: 'color 0.4s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: direction === 'right' ? '0 2px' : '2px 0',
      }}
    >
      {ch}
    </span>
  );
}

// ---- Brain Pipeline (Magnum Opus S48-S51) ----

function BrainPipeline({
  memories,
  phase,
}: {
  memories: Memory[];
  phase: string;
}) {
  const [activeNodes, setActiveNodes] = useState<Set<string>>(new Set());
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const activateNode = useCallback((nodeId: string, durationMs = 4000) => {
    setActiveNodes((prev) => {
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
    const existing = timeoutsRef.current.get(nodeId);
    if (existing) clearTimeout(existing);
    const tid = setTimeout(() => {
      setActiveNodes((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
      timeoutsRef.current.delete(nodeId);
    }, durationMs);
    timeoutsRef.current.set(nodeId, tid);
  }, []);

  const activateSequence = useCallback((nodes: string[], delayMs = 150, holdMs = 4000) => {
    const staggerTimeouts: ReturnType<typeof setTimeout>[] = [];
    nodes.forEach((nodeId, i) => {
      const tid = setTimeout(() => activateNode(nodeId, holdMs), i * delayMs);
      staggerTimeouts.push(tid);
    });
    const cleanupKey = `_seq_${Date.now()}`;
    timeoutsRef.current.set(cleanupKey, setTimeout(() => {
      timeoutsRef.current.delete(cleanupKey);
    }, nodes.length * delayMs + holdMs));
    staggerTimeouts.forEach((t, i) => timeoutsRef.current.set(`_stg_${i}_${Date.now()}`, t));
  }, [activateNode]);

  useEffect(() => {
    const unlistenPromise = listen<ToolSummaryPayload>('hw-tool-summary', (event) => {
      const payload = event.payload;
      const events = payload.events ?? [];
      const hasRetrieval = events.some((e) =>
        e.tool === 'hw_retrieve_memories' || e.tool === 'auto_cue'
      );
      const isBrainRetrieval = hasRetrieval || (payload as unknown as Record<string, unknown>).type === 'brain_retrieval';
      const hasStore = events.some((e) => e.tool === 'hw_store_memory');
      const hasEndSession = events.some((e) => e.tool === 'hw_end_session');
      const hasHealth = events.some((e) => e.tool === 'hw_brain_health');

      if (isBrainRetrieval) {
        activateSequence([
          'brain-engine', 'brain-arrow-e-l', 'brain-linker',
          'brain-arrow-l-c', 'brain-cortex', 'brain-arrow-c-out', 'brain-scorer',
        ], 120, 5000);
      }
      if (hasStore) {
        activateSequence([
          'brain-qgate', 'brain-arrow-q-l', 'brain-linker',
          'brain-arrow-l-s', 'brain-scorer',
        ], 120, 5000);
      }
      if (hasEndSession) {
        activateSequence(['brain-rules', 'brain-pruner'], 200, 5000);
      }
      if (hasHealth) {
        activateSequence(['brain-health', 'brain-scorer'], 150, 4000);
      }
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [activateSequence]);

  useEffect(() => {
    const unlistenPromise = listen<string[]>('hw-files-changed', (event) => {
      for (const f of event.payload) {
        const nodeId = FILE_TO_BRAIN_NODE[f];
        if (nodeId) activateNode(nodeId, 3000);
      }
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [activateNode]);

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const tid of timeouts.values()) clearTimeout(tid);
      timeouts.clear();
    };
  }, []);

  const a = (id: string) => activeNodes.has(id);
  const painCount = memories.filter((m) => m.type === 'pain').length;
  const linkedCount = memories.filter((m) => m.links && m.links.length > 0).length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '8px 12px', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 2, color: '#f778ba', fontFamily: 'monospace', opacity: 0.7 }}>
        Brain Engine
        <span style={{ fontSize: 7, color: '#5a5a72', marginLeft: 8 }}>Magnum Opus</span>
      </span>

      {/* Row 1 (Store path): QGate -> Linker -> Scorer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 6, color: '#5a5a72', fontFamily: 'monospace', width: 36, textAlign: 'right', marginRight: 4 }}>STORE</span>
        <FlowNode label="Q.Gate" accent="#f778ba" active={a('brain-qgate')} stat="dedup" />
        <FlowArrow direction="right" active={a('brain-arrow-q-l')} />
        <FlowNode label="Linker" accent="#00bcd4" active={a('brain-linker')} stat={`${linkedCount} linked`} pulse="glow" />
        <FlowArrow direction="right" active={a('brain-arrow-l-s')} />
        <FlowNode label="Scorer" accent="#ffb300" active={a('brain-scorer')} stat={`${memories.length} mem`} />
      </div>

      {/* Row 2 (Retrieve path): Engine -> Linker -> Cortex -> Scorer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 6, color: '#5a5a72', fontFamily: 'monospace', width: 36, textAlign: 'right', marginRight: 4 }}>FETCH</span>
        <FlowNode label="Engine" accent="#7c4dff" active={a('brain-engine')} stat="9-stage" />
        <FlowArrow direction="right" active={a('brain-arrow-e-l')} />
        <FlowNode label="Linker" accent="#00bcd4" active={a('brain-linker')} stat="traverse" />
        <FlowArrow direction="right" active={a('brain-arrow-l-c')} />
        <FlowNode label="Cortex" accent="#00e5ff" active={a('brain-cortex')} stat="learn" pulse="glow" />
        <FlowArrow direction="right" active={a('brain-arrow-c-out')} />
        <FlowNode label="Scorer" accent="#ffb300" active={a('brain-scorer')} stat="rank" />
      </div>

      {/* Row 3 (Maintenance + Monitoring) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
        <FlowNode label="Rules" accent="#10b981" active={a('brain-rules')} stat="extract" />
        <FlowNode label="Pruner" accent="#ef4444" active={a('brain-pruner')} stat="archive" />
        <FlowNode label="Health" accent="#3b82f6" active={a('brain-health')} stat={phase} />
        <FlowNode label="Pain" accent="#ff2d55" active={a('brain-qgate') || a('brain-engine')} stat={`${painCount}`} pulse="pain" />
      </div>
    </div>
  );
}

// ---- System Infrastructure ----

function SystemInfrastructure({
  tasks,
  memories,
  phase,
  pendingApprovals,
}: {
  tasks: Task[];
  memories: Memory[];
  phase: string;
  pendingApprovals: number;
}) {
  const [activeNodes, setActiveNodes] = useState<Set<string>>(new Set());
  const [lastTool, setLastTool] = useState<string>('idle');
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const activateNode = useCallback((nodeId: string, durationMs = 4000) => {
    setActiveNodes((prev) => {
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
    const existing = timeoutsRef.current.get(nodeId);
    if (existing) clearTimeout(existing);
    const tid = setTimeout(() => {
      setActiveNodes((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
      timeoutsRef.current.delete(nodeId);
    }, durationMs);
    timeoutsRef.current.set(nodeId, tid);
  }, []);

  // Staggered activation
  const activateSequence = useCallback((nodes: string[], delayMs = 150, holdMs = 4000) => {
    nodes.forEach((nodeId, i) => {
      const tid = setTimeout(() => activateNode(nodeId, holdMs), i * delayMs);
      timeoutsRef.current.set(`_stg_${nodeId}_${Date.now()}`, tid);
    });
  }, [activateNode]);

  // Listen for hw-tool-summary
  useEffect(() => {
    const unlistenPromise = listen<ToolSummaryPayload>('hw-tool-summary', (event) => {
      const payload = event.payload;
      if (payload.events && payload.events.length > 0) {
        setLastTool(payload.events[0].tool.replace(/^hw_/, ''));
      } else if (payload.summary) {
        setLastTool(payload.summary.slice(0, 16));
      }

      // Build cascade: Claude -> MCP -> relevant stores
      const sequence = ['sys-claude', 'sys-arrow-claude-mcp', 'sys-mcp'];
      if (payload.files) {
        // Add hooks node when tools fire
        sequence.push('sys-hooks');
        for (const f of payload.files) {
          const nodeId = FILE_TO_SYS_NODE[f];
          if (nodeId) sequence.push(nodeId);
        }
        // File watcher picks up the writes
        sequence.push('sys-filewatcher');
      }
      activateSequence(sequence, 120, 4500);
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [activateSequence]);

  // Listen for hw-files-changed
  useEffect(() => {
    const unlistenPromise = listen<string[]>('hw-files-changed', (event) => {
      const fileNodes = event.payload
        .map((f) => FILE_TO_SYS_NODE[f])
        .filter(Boolean);
      activateSequence(['sys-filewatcher', ...fileNodes], 100, 3000);
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [activateSequence]);

  // Cleanup on unmount
  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const tid of timeouts.values()) clearTimeout(tid);
      timeouts.clear();
    };
  }, []);

  const a = (id: string) => activeNodes.has(id);
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '8px 12px', gap: 6, minWidth: 0, borderLeft: '1px solid #1a1a30' }}>
      <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 2, color: '#5a5a72', fontFamily: 'monospace' }}>
        System Infrastructure
      </span>

      {/* Row 1: Claude PTY -> Hooks */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <FlowNode label="Claude PTY" accent="#818cf8" active={a('sys-claude')} stat="pty" />
        <FlowArrow direction="right" active={a('sys-arrow-claude-mcp')} />
        <FlowNode label="Hooks" accent="#10b981" active={a('sys-hooks')} stat={a('sys-hooks') ? 'firing' : 'every msg'} />
      </div>

      {/* Row 2: MCP Server -> File Watcher */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <FlowNode label="MCP Server" accent="#a78bfa" active={a('sys-mcp')} stat={lastTool} />
        <FlowArrow direction="right" active={a('sys-filewatcher')} />
        <FlowNode label="File Watcher" accent="#3b82f6" active={a('sys-filewatcher')} stat={a('sys-filewatcher') ? 'changed' : 'watching'} />
      </div>

      {/* Row 3: core stores */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
        <FlowNode label="Tasks" accent="#6366f1" active={a('sys-tasks')} stat={`${inProgressCount} active`} />
        <FlowNode label="Memory" accent="#f59e0b" active={a('sys-memory')} stat={`${memories.length} stored`} />
        <FlowNode label="Workflow" accent="#10b981" active={a('sys-workflow')} stat={phase} />
        <FlowNode label="Approvals" accent="#ef4444" active={a('sys-approvals')} stat={`${pendingApprovals} pending`} />
      </div>

      {/* Row 4: brain stores + sentinel */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
        <FlowNode label="Brain St." accent="#f778ba" active={a('sys-brainstate')} stat="neural" />
        <FlowNode label="Cortex" accent="#00e5ff" active={a('sys-cortexlearn')} stat="tags" />
        <FlowNode label="Rules" accent="#10b981" active={a('sys-rules')} stat="learned" />
        <FlowNode label="Sentinel" accent="#4ade80" active={a('sys-sentinel')} stat="alive" />
      </div>
    </div>
  );
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function SidePanel() {
  const projectPath = useProjectPath();
  const { data: stateData } = useTauriData<StateData>('get_state', projectPath);
  const { data: activityData } = useTauriData<ActivityData>('get_activity', projectPath);
  const { data: workflowData } = useTauriData<WorkflowData>('get_workflow', projectPath);
  const tasks = stateData?.tasks ?? [];
  const activeTask = tasks.find((t) => t.status === 'in_progress');
  const todoTasks = tasks.filter((t) => t.status === 'todo');
  const phase = workflowData?.phase ?? 'idle';
  const phaseDot = PHASE_DOT[phase] ?? 'bg-gray-500';

  const activities = useMemo(
    () => activityData?.activities
      ? [...activityData.activities].reverse().slice(0, 8)
      : [],
    [activityData],
  );

  return (
    <div className="w-64 flex flex-col border-l border-gray-800 bg-[#0d0d14] shrink-0 overflow-hidden">
      {/* Phase */}
      <div className="px-3 py-2 border-b border-gray-800/60 flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${phaseDot}`} />
        <span className="text-[10px] font-mono uppercase text-gray-500">{phase}</span>
      </div>

      {/* Active task */}
      <div className="px-3 py-3 border-b border-gray-800/60">
        <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1.5">Active</p>
        {activeTask ? (
          <>
            <p className="text-xs text-white leading-snug font-medium">{activeTask.title}</p>
            {activeTask.description && (
              <p className="text-[10px] text-gray-500 mt-1 leading-relaxed line-clamp-2">
                {activeTask.description}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-600 italic">No active task</p>
        )}
      </div>

      {/* Up next */}
      {todoTasks.length > 0 && (
        <div className="px-3 py-3 border-b border-gray-800/60">
          <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-1.5">Up Next</p>
          <div className="flex flex-col gap-1.5">
            {todoTasks.slice(0, 3).map((t) => (
              <p key={t.id} className="text-[10px] text-gray-400 leading-snug">
                <span className="text-gray-700 mr-1">·</span>
                {t.title}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-2">Activity</p>
        <div className="flex flex-col gap-2">
          {activities.map((a) => (
            <div key={a.id} className="flex items-start gap-2">
              <span className="text-[9px] text-gray-700 shrink-0 mt-px w-5">
                {formatTime(a.timestamp)}
              </span>
              <span className="text-[10px] text-gray-400 leading-snug">{a.description}</span>
            </div>
          ))}
          {activities.length === 0 && (
            <p className="text-[10px] text-gray-700 italic">No activity yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Inject CSS once at module scope
let _cssInjected = false;
function injectDualFlowCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement('style');
  style.textContent = DUAL_FLOW_CSS;
  document.head.appendChild(style);
}

function BottomPanel({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const projectPath = useProjectPath();
  const { data: stateData } = useTauriData<StateData>('get_state', projectPath);
  const { data: workflowData } = useTauriData<WorkflowData>('get_workflow', projectPath);
  const { data: memoriesData } = useTauriData<MemoriesData>('get_memories', projectPath);
  const { data: approvalsData } = useTauriData<ApprovalsData>('get_approvals', projectPath);

  const tasks = stateData?.tasks ?? [];
  const memories = memoriesData?.memories ?? [];
  const phase = workflowData?.phase ?? 'idle';
  const pendingApprovals = approvalsData?.pending?.length ?? 0;
  const painCount = memories.filter((m) => m.type === 'pain').length;
  const winCount = memories.filter((m) => m.type === 'win').length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;

  useEffect(() => {
    injectDualFlowCSS();
  }, []);

  if (!expanded) {
    // Compact bar -- clickable to expand
    return (
      <button
        type="button"
        onClick={onToggle}
        className="border-t border-gray-800 bg-[#0a0a12] hover:bg-[#0e0e1a] transition-colors shrink-0 w-full"
        style={{ height: 32, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: 1.5, color: '#5a5a72', fontFamily: 'monospace' }}>
          Systems
        </span>
        {/* Compact node dots */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {[
            { label: 'Engine', color: '#f778ba', stat: `${memories.length} mem` },
            { label: 'Pain', color: '#ff2d55', stat: `${painCount}` },
            { label: 'Wins', color: '#ffb300', stat: `${winCount}` },
            { label: 'MCP', color: '#a78bfa', stat: phase },
            { label: 'Tasks', color: '#6366f1', stat: `${inProgress}` },
            { label: 'Sentinel', color: '#4ade80', stat: '' },
          ].map((n) => (
            <div key={n.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: n.color, opacity: 0.7, display: 'inline-block' }} />
              <span style={{ fontSize: 7, color: '#4a4a62', fontFamily: 'monospace' }}>{n.label}</span>
              {n.stat && <span style={{ fontSize: 7, color: n.color, fontFamily: 'monospace', opacity: 0.5 }}>{n.stat}</span>}
            </div>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 8, color: '#3a3a52', fontFamily: 'monospace' }}>click to expand</span>
      </button>
    );
  }

  // Expanded view -- full dual flowchart
  return (
    <div className="border-t border-gray-800 bg-[#0a0a12] shrink-0" style={{ height: 220, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header bar with collapse button */}
      <button
        type="button"
        onClick={onToggle}
        className="hover:bg-[#0e0e1a] transition-colors shrink-0 w-full border-b border-gray-800/40"
        style={{ height: 24, display: 'flex', alignItems: 'center', padding: '0 12px', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: 1.5, color: '#5a5a72', fontFamily: 'monospace' }}>
          Systems
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 8, color: '#3a3a52', fontFamily: 'monospace' }}>collapse</span>
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        <BrainPipeline memories={memories} phase={phase} />
        <SystemInfrastructure
          tasks={tasks}
          memories={memories}
          phase={phase}
          pendingApprovals={pendingApprovals}
        />
      </div>
    </div>
  );
}

export function TerminalView() {
  const projectPath = useProjectPath();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [systemsExpanded, setSystemsExpanded] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0d0d14',
        foreground: '#e2e8f0',
        cursor: '#818cf8',
        selectionBackground: '#3730a3',
        black: '#1e1e2e',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#89dceb',
        white: '#cdd6f4',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#89dceb',
        brightWhite: '#ffffff',
      },
      fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
      fontSize: 11,
      lineHeight: 1.3,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    term.onData((data) => {
      invoke('write_pty_input', { data }).catch(() => {});
    });

    let unlistenData: (() => void) | null = null;
    let unlistenDied: (() => void) | null = null;

    const startSession = async () => {
      // Await listener registration BEFORE spawning PTY — prevents dropped startup events
      unlistenData = await listen<string>('pty-data', (event) => {
        const binary = atob(event.payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        term.write(bytes);
        setStatus('ready');

        if (!initializedRef.current) {
          initializedRef.current = true;
          setTimeout(() => {
            invoke('write_pty_input', {
              data: 'hw_get_context() — greet Pat with project name, workflow phase, and active tasks.\n',
            }).catch(() => {});
          }, 2000);
        }
      });

      unlistenDied = await listen('pty-died', () => {
        setStatus('starting');
        // Auto-respawn after brief delay
        setTimeout(() => {
          invoke('start_pty_session', { projectPath }).catch((e: unknown) => {
            setStatus('error');
            setError(String(e));
          });
        }, 1000);
      });

      // Returns false if session already running — set ready immediately
      const spawned = await invoke<boolean>('start_pty_session', { projectPath });
      if (!spawned) setStatus('ready');
    };

    startSession().catch((e) => {
      setStatus('error');
      setError(String(e));
    });

    const observer = new ResizeObserver(() => {
      fit.fit();
      invoke('resize_pty', { rows: term.rows, cols: term.cols }).catch(() => {});
    });
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      unlistenData?.();
      unlistenDied?.();
      observer.disconnect();
      term.dispose();
    };
  }, []);

  // Refit when panel opens/closes or layout changes
  useEffect(() => {
    const timer = setTimeout(() => {
      fitRef.current?.fit();
      const t = termRef.current;
      if (t) invoke('resize_pty', { rows: t.rows, cols: t.cols }).catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [panelOpen, systemsExpanded]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between shrink-0 bg-[#0d0d14]">
        <span className="text-sm font-semibold text-gray-200">⌨ Terminal</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${status === 'ready' ? 'bg-green-400' : status === 'error' ? 'bg-red-400' : 'bg-yellow-400 animate-pulse'}`}
            />
            <span
              className={`text-xs ${status === 'ready' ? 'text-green-400' : status === 'error' ? 'text-red-400' : 'text-yellow-400'}`}
            >
              {status === 'ready' ? 'Claude running' : status === 'error' ? 'Error' : 'Starting...'}
            </span>
          </div>
          <button
            onClick={() => setPanelOpen((p) => !p)}
            className="text-[11px] px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors font-mono"
            title="Toggle context panel"
          >
            {panelOpen ? 'hide ctx' : 'show ctx'}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800/50 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Terminal + side panel -- takes remaining space */}
      <div className="flex flex-1 min-h-0">
        <div
          ref={containerRef}
          className="flex-1 min-h-0 min-w-0 p-1 bg-[#0d0d14]"
          style={{ overflow: 'hidden' }}
        />
        {panelOpen && <SidePanel />}
      </div>

      {/* Bottom: systems bar (compact) or expanded flowchart */}
      <BottomPanel expanded={systemsExpanded} onToggle={() => setSystemsExpanded((p) => !p)} />
    </div>
  );
}
