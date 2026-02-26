import { X } from 'lucide-react';
import { useEffect } from 'react';

const SHORTCUTS = [
  { key: '1', view: 'Dashboard' },
  { key: '2', view: 'Tasks' },
  { key: '3', view: 'Decisions' },
  { key: '4', view: 'Questions' },
  { key: '5', view: 'Memory' },
  { key: '6', view: 'Sessions' },
  { key: '7', view: 'Cost' },
  { key: '8', view: 'Settings' },
  { key: 'T', view: 'Terminal' },
  { key: 'K', view: 'Skills' },
  { key: 'W', view: 'Watchers' },
  { key: 'P', view: 'Project Context' },
  { key: 'L', view: 'Timeline' },
  { key: '?', view: 'This help menu' },
];

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function HelpModal({ open, onClose }: HelpModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a24] border border-gray-700 rounded-lg shadow-2xl w-80 p-5 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-300 transition-colors"
          title="Close"
        >
          <X size={16} />
        </button>

        <h2 className="text-sm font-semibold text-white mb-4">Keyboard Shortcuts</h2>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-500 uppercase tracking-wide">
              <th className="text-left pb-2 font-medium w-12">Key</th>
              <th className="text-left pb-2 font-medium">View</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map(({ key, view }) => (
              <tr key={key} className="border-t border-gray-800/60">
                <td className="py-1.5 pr-4">
                  <kbd className="inline-block bg-gray-800 text-gray-300 text-xs font-mono px-1.5 py-0.5 rounded border border-gray-700 min-w-[1.5rem] text-center">
                    {key}
                  </kbd>
                </td>
                <td className="py-1.5 text-gray-300">{view}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
