// Boardroom: collaborative workspace for agent teams.
// Different from deliberations (binding decisions with mediator).
// Boardrooms are for teams to work together -- short messages, shared whiteboard.

export interface BoardroomAgent {
  id: string;
  name: string;
  provider: 'claude' | 'qwen';
  thinking?: boolean; // Qwen thinking mode -- true for deep work, false for fast chat
  role: string; // one-line role description
  color: string;
}

export interface BoardroomMessage {
  id: string;
  agentId: string;
  text: string; // enforced 160-char limit
  timestamp: string;
}

export interface WhiteboardEntry {
  id: string;
  agentId: string;
  section: string; // e.g., "findings", "blockers", "proposals"
  content: string;
  timestamp: string;
}

export interface Boardroom {
  id: string;
  topic: string;
  status: 'active' | 'paused' | 'closed';
  createdAt: string;
  agents: BoardroomAgent[];
  chat: BoardroomMessage[];
  whiteboard: WhiteboardEntry[];
}

export const CHAT_CHAR_LIMIT = 160;

export const EMPTY_BOARDROOM: Boardroom = {
  id: '',
  topic: '',
  status: 'active',
  createdAt: '',
  agents: [],
  chat: [],
  whiteboard: [],
};
