import { useTauriData } from '../hooks/useTauriData.js';
import { useProjectPath } from '../hooks/useProjectPath.js';

function renderLine(line: string, index: number): React.ReactElement | null {
  if (!line.trim()) return null;

  if (line === '---') {
    return <hr key={index} className="border-gray-800/50 my-3" />;
  }

  if (line.startsWith('# ')) {
    return (
      <h1 key={index} className="text-base font-semibold text-white mb-3">
        {line.slice(2)}
      </h1>
    );
  }

  if (line.startsWith('## ')) {
    return (
      <h2 key={index} className="text-sm font-semibold text-indigo-400 mt-6 mb-1.5 pt-1">
        {line.slice(3)}
      </h2>
    );
  }

  if (line.startsWith('### ')) {
    return (
      <h3 key={index} className="text-[10px] uppercase tracking-widest text-gray-500 mt-3 mb-1">
        {line.slice(4)}
      </h3>
    );
  }

  if (line.startsWith('- ')) {
    const content = line.slice(2);
    const parts = content.split(/\*\*(.*?)\*\*/g);
    return (
      <li key={index} className="text-xs text-gray-400 leading-relaxed ml-4 list-disc">
        {parts.map((part, i) =>
          i % 2 === 1 ? <strong key={i} className="text-gray-300">{part}</strong> : part
        )}
      </li>
    );
  }

  // Table separator row — skip
  if (/^\|[-| :]+\|$/.test(line)) return null;

  // Table row
  if (line.startsWith('| ') && line.endsWith(' |')) {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    return (
      <div key={index} className="flex gap-4 text-[11px] text-gray-500 font-mono">
        {cells.map((c, i) => (
          <span key={i} className="truncate">{c}</span>
        ))}
      </div>
    );
  }

  // Bold-only line (commit title)
  if (line.startsWith('**') && line.endsWith('**')) {
    return (
      <p key={index} className="text-xs font-semibold text-gray-300 mt-2">
        {line.slice(2, -2)}
      </p>
    );
  }

  // Italic (session meta)
  if (line.startsWith('*') && line.endsWith('*')) {
    return (
      <p key={index} className="text-[11px] text-gray-600 italic">
        {line.slice(1, -1)}
      </p>
    );
  }

  // Line with inline bold
  const parts = line.split(/\*\*(.*?)\*\*/g);
  if (parts.length > 1) {
    return (
      <p key={index} className="text-xs text-gray-500 leading-relaxed">
        {parts.map((part, i) =>
          i % 2 === 1 ? <strong key={i} className="text-gray-300">{part}</strong> : part
        )}
      </p>
    );
  }

  return (
    <p key={index} className="text-xs text-gray-500 leading-relaxed">
      {line}
    </p>
  );
}

export function TimelineView() {
  const projectPath = useProjectPath();
  const { data: raw, loading, error } = useTauriData<string>('get_timeline', projectPath);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f]">
        <span className="text-sm text-gray-600">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0f]">
        <span className="text-sm text-red-500">{error}</span>
      </div>
    );
  }

  const lines = (raw ?? '').split('\n');
  // Count sessions (## headings that start with "Session")
  const sessionCount = lines.filter((l) => l.startsWith('## Session')).length;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0a0a0f]">
      <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800/70 bg-[#0d0d14] shrink-0">
        <span className="text-[11px] font-semibold text-gray-300">Timeline</span>
        <div className="h-3 w-px bg-gray-800" />
        <span className="text-[11px] text-gray-600">{sessionCount} sessions logged</span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {lines.map((line, i) => renderLine(line, i))}
      </div>
    </div>
  );
}
