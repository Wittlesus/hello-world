import { type ReactNode } from 'react';

interface ViewShellProps {
  title: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
}

export function ViewShell({ title, description, children, actions }: ViewShellProps) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">{title}</h1>
          <p className="text-sm text-gray-400 mt-1">{description}</p>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {children}
      </div>
    </div>
  );
}
