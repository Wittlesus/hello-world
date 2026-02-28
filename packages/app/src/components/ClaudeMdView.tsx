import { invoke } from '@tauri-apps/api/core';
import { useCallback, useMemo, useState } from 'react';
import { useProjectPath } from '../hooks/useProjectPath.js';
import { useTauriData } from '../hooks/useTauriData.js';
import { useAppStore } from '../stores/app.js';
import { ViewShell } from './ViewShell.js';

// Parse CLAUDE.md into structured sections
interface Section {
  level: number; // 1 = h1, 2 = h2, 3 = h3
  title: string;
  content: string;
  icon: string;
  accent: string;
}

const SECTION_STYLES: Record<string, { icon: string; accent: string }> = {
  'vision': { icon: '\u25C8', accent: 'border-indigo-500/40 bg-indigo-500/5' },
  'core loop': { icon: '\u21BB', accent: 'border-cyan-500/40 bg-cyan-500/5' },
  'stack': { icon: '\u25A6', accent: 'border-emerald-500/40 bg-emerald-500/5' },
  'commands': { icon: '\u25B6', accent: 'border-green-500/40 bg-green-500/5' },
  'key file paths': { icon: '\u2750', accent: 'border-amber-500/40 bg-amber-500/5' },
  'mcp tools': { icon: '\u2699', accent: 'border-violet-500/40 bg-violet-500/5' },
  'handoff format': { icon: '\u270D', accent: 'border-orange-500/40 bg-orange-500/5' },
  'architecture': { icon: '\u2302', accent: 'border-blue-500/40 bg-blue-500/5' },
  'app views': { icon: '\u25A3', accent: 'border-teal-500/40 bg-teal-500/5' },
  "what's built": { icon: '\u2714', accent: 'border-green-500/40 bg-green-500/5' },
  "what's in progress": { icon: '\u2026', accent: 'border-yellow-500/40 bg-yellow-500/5' },
  'direction capture': { icon: '\u2691', accent: 'border-rose-500/40 bg-rose-500/5' },
  'deliberation rules': { icon: '\u2696', accent: 'border-purple-500/40 bg-purple-500/5' },
  'coding rules': { icon: '\u2261', accent: 'border-sky-500/40 bg-sky-500/5' },
  "pat's preferences": { icon: '\u2605', accent: 'border-pink-500/40 bg-pink-500/5' },
  'context & memory': { icon: '\u2B22', accent: 'border-violet-500/40 bg-violet-500/5' },
  'tasks': { icon: '\u2610', accent: 'border-cyan-500/40 bg-cyan-500/5' },
  'workflow': { icon: '\u21C4', accent: 'border-emerald-500/40 bg-emerald-500/5' },
  'decisions': { icon: '\u2318', accent: 'border-amber-500/40 bg-amber-500/5' },
  'direction notes': { icon: '\u2709', accent: 'border-rose-500/40 bg-rose-500/5' },
  'notifications': { icon: '\u2709', accent: 'border-orange-500/40 bg-orange-500/5' },
  'crash safety': { icon: '\u26A0', accent: 'border-red-500/40 bg-red-500/5' },
};

function getStyle(title: string): { icon: string; accent: string } {
  const lower = title.toLowerCase();
  for (const [key, style] of Object.entries(SECTION_STYLES)) {
    if (lower.includes(key)) return style;
  }
  return { icon: '\u25CB', accent: 'border-gray-700/60 bg-gray-800/30' };
}

function parseSections(raw: string): Section[] {
  const lines = raw.split('\n');
  const sections: Section[] = [];
  let current: Section | null = null;
  let contentLines: string[] = [];

  for (const line of lines) {
    const h1 = line.match(/^# (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);

    if (h1 || h2 || h3) {
      if (current) {
        current.content = contentLines.join('\n').trim();
        sections.push(current);
      }
      const title = (h1?.[1] ?? h2?.[1] ?? h3?.[1]) as string;
      const level = h1 ? 1 : h2 ? 2 : 3;
      const style = getStyle(title);
      current = { level, title, content: '', ...style };
      contentLines = [];
    } else if (current) {
      contentLines.push(line);
    }
  }
  if (current) {
    current.content = contentLines.join('\n').trim();
    sections.push(current);
  }
  return sections;
}

// Render markdown content with basic formatting
function ContentBlock({ content }: { content: string }) {
  const parts = useMemo(() => {
    const result: Array<{ type: 'text' | 'code' | 'table' | 'list'; content: string }> = [];
    const lines = content.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block
      if (line.startsWith('```')) {
        const lang = line.slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        result.push({ type: 'code', content: (lang ? `[${lang}]\n` : '') + codeLines.join('\n') });
        i++;
        continue;
      }

      // Table
      if (line.includes('|') && line.trim().startsWith('|')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        result.push({ type: 'table', content: tableLines.join('\n') });
        continue;
      }

      // List
      if (line.match(/^[-*] /) || line.match(/^\d+\. /)) {
        const listLines: string[] = [];
        while (i < lines.length && (lines[i].match(/^[-*] /) || lines[i].match(/^\d+\. /) || lines[i].match(/^  /))) {
          listLines.push(lines[i]);
          i++;
        }
        result.push({ type: 'list', content: listLines.join('\n') });
        continue;
      }

      // Regular text
      if (line.trim()) {
        result.push({ type: 'text', content: line });
      }
      i++;
    }
    return result;
  }, [content]);

  return (
    <div className="space-y-2">
      {parts.map((part, idx) => {
        if (part.type === 'code') {
          return (
            <pre key={idx} className="bg-gray-900/80 border border-gray-800 rounded-lg px-4 py-3 text-[12px] text-gray-300 overflow-x-auto font-mono leading-relaxed">
              {part.content}
            </pre>
          );
        }
        if (part.type === 'table') {
          return <TableBlock key={idx} raw={part.content} />;
        }
        if (part.type === 'list') {
          return (
            <div key={idx} className="space-y-1 pl-1">
              {part.content.split('\n').map((item, j) => {
                const bullet = item.match(/^[-*] (.*)/);
                const numbered = item.match(/^(\d+)\. (.*)/);
                const indented = item.match(/^  [-*] (.*)/);
                if (indented) {
                  return (
                    <div key={j} className="flex gap-2 pl-5 text-[13px] text-gray-400">
                      <span className="text-gray-600 shrink-0">-</span>
                      <span><InlineFormat text={indented[1]} /></span>
                    </div>
                  );
                }
                if (bullet) {
                  return (
                    <div key={j} className="flex gap-2 text-[13px] text-gray-300">
                      <span className="text-gray-500 shrink-0">-</span>
                      <span><InlineFormat text={bullet[1]} /></span>
                    </div>
                  );
                }
                if (numbered) {
                  return (
                    <div key={j} className="flex gap-2 text-[13px] text-gray-300">
                      <span className="text-gray-500 shrink-0 w-5 text-right">{numbered[1]}.</span>
                      <span><InlineFormat text={numbered[2]} /></span>
                    </div>
                  );
                }
                return <div key={j} className="text-[13px] text-gray-400 pl-5"><InlineFormat text={item} /></div>;
              })}
            </div>
          );
        }
        return <p key={idx} className="text-[13px] text-gray-300 leading-relaxed"><InlineFormat text={part.content} /></p>;
      })}
    </div>
  );
}

// Inline formatting: **bold**, `code`, *italic*
function InlineFormat({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="text-white font-medium">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="bg-gray-800 text-amber-300 px-1.5 py-0.5 rounded text-[12px] font-mono">{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
          return <em key={i} className="text-gray-400 italic">{part.slice(1, -1)}</em>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// Table renderer
function TableBlock({ raw }: { raw: string }) {
  const rows = raw.split('\n').filter(r => r.trim().length > 0);
  if (rows.length < 2) return null;

  const parseRow = (row: string) =>
    row.split('|').map(c => c.trim()).filter(c => c.length > 0);

  const header = parseRow(rows[0]);
  // Skip separator row (row[1] with dashes)
  const dataRows = rows.slice(2).map(parseRow);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-gray-800/60">
            {header.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left text-gray-400 font-medium border-b border-gray-700">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-gray-900/30' : 'bg-gray-900/10'}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-1.5 text-gray-300 border-b border-gray-800/50">
                  <InlineFormat text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Edit intent input -- appears when user clicks the edit button on a section
function EditIntent({ sectionTitle, onSend, onCancel }: { sectionTitle: string; onSend: (msg: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');

  return (
    <div className="mt-2 mx-4 mb-3 border border-indigo-500/30 rounded-lg bg-indigo-500/5 p-3">
      <div className="text-[11px] text-indigo-400 mb-2">
        Edit "{sectionTitle}" -- describe what you want changed:
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) onSend(text.trim());
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="e.g. add a new coding rule about..."
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-[13px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/50"
          autoFocus
        />
        <button
          type="button"
          onClick={() => text.trim() && onSend(text.trim())}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] rounded transition-colors"
        >
          Send
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1.5 text-gray-500 hover:text-gray-300 text-[12px] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Collapsible section card
function SectionCard({ section, defaultOpen, onEditIntent }: { section: Section; defaultOpen: boolean; onEditIntent: (sectionTitle: string, instruction: string) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);
  const isH1 = section.level === 1;

  if (isH1) {
    // H1 = project title, render as banner
    return (
      <div className="mb-6 pb-4 border-b border-gray-800">
        <h1 className="text-2xl font-bold text-white tracking-tight">{section.title}</h1>
        {section.content && (
          <div className="mt-3">
            <ContentBlock content={section.content} />
          </div>
        )}
      </div>
    );
  }

  const isSubsection = section.level === 3;

  return (
    <div className={`rounded-xl border ${section.accent} transition-all duration-200 ${isSubsection ? 'ml-4' : ''}`}>
      <div className="flex items-center">
        <button
          type="button"
          className="flex-1 px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors"
          onClick={() => setOpen(!open)}
        >
          <span className={`text-base ${open ? 'text-white' : 'text-gray-500'} transition-colors`}>
            {section.icon}
          </span>
          <span className={`font-medium ${isSubsection ? 'text-[13px]' : 'text-[14px]'} ${open ? 'text-white' : 'text-gray-300'} flex-1`}>
            {section.title}
          </span>
          <span className={`text-gray-600 text-xs transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
            {'\u25B6'}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setEditing(!editing); if (!open) setOpen(true); }}
          title="Edit this section"
          className="px-3 py-3 text-gray-600 hover:text-indigo-400 transition-colors text-[12px]"
        >
          {'\u270E'}
        </button>
      </div>
      {editing && (
        <EditIntent
          sectionTitle={section.title}
          onSend={(instruction) => {
            onEditIntent(section.title, instruction);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      {open && section.content && (
        <div className="px-4 pb-4 pt-1">
          <ContentBlock content={section.content} />
        </div>
      )}
    </div>
  );
}

export function ClaudeMdView() {
  const projectPath = useProjectPath();
  const setView = useAppStore((s) => s.setView);
  const { data, loading } = useTauriData<string>('get_claude_md', projectPath);

  const handleEditIntent = useCallback((sectionTitle: string, instruction: string) => {
    const msg = `In CLAUDE.md, under the "${sectionTitle}" section: ${instruction}`;
    setView('terminal');
    setTimeout(() => {
      invoke('write_pty_input', { data: msg + '\n' }).catch(() => {
        navigator.clipboard.writeText(msg).catch(() => {});
      });
    }, 200);
  }, [setView]);

  const sections = useMemo(() => {
    if (!data) return [];
    return parseSections(data);
  }, [data]);

  // Count stats for the header
  const stats = useMemo(() => {
    if (!data) return { lines: 0, sections: 0, words: 0 };
    const lines = data.split('\n').length;
    const words = data.split(/\s+/).length;
    return { lines, sections: sections.length, words };
  }, [data, sections]);

  if (loading) {
    return (
      <ViewShell title="Project Bible" description="Loading CLAUDE.md...">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-4 h-4 border-2 border-gray-700 border-t-indigo-500 rounded-full animate-spin" />
          Loading...
        </div>
      </ViewShell>
    );
  }

  if (!data) {
    return (
      <ViewShell title="Project Bible" description="CLAUDE.md not found">
        <p className="text-gray-500 text-sm">No CLAUDE.md found at the project root.</p>
      </ViewShell>
    );
  }

  return (
    <ViewShell
      title="Project Bible"
      description="CLAUDE.md -- the project's source of truth"
      actions={
        <div className="flex items-center gap-4 text-[11px] text-gray-500">
          <span>{stats.sections} sections</span>
          <span>{stats.lines} lines</span>
          <span>{stats.words.toLocaleString()} words</span>
        </div>
      }
    >
      <div className="max-w-4xl space-y-3">
        {sections.map((section, i) => (
          <SectionCard
            key={`${section.title}-${i}`}
            section={section}
            defaultOpen={section.level === 1 || i < 4}
            onEditIntent={handleEditIntent}
          />
        ))}
      </div>
    </ViewShell>
  );
}
