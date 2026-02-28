import { ChatroomPanel } from './ChatroomPanel.js';

export function AgentsView() {
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#030310]">
      <ChatroomPanel fullHeight />
    </div>
  );
}
AgentsView.displayName = 'AgentsView';
