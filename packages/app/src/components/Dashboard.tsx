import { ActivityStream } from './ActivityStream';

export function Dashboard() {
  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 py-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold text-white">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">Real-time activity feed of Claude's operations</p>
      </div>
      <ActivityStream />
    </div>
  );
}
