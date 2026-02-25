export type AgentStatus = 'idle' | 'thinking' | 'responding';
export type SessionStatus = 'idle' | 'active' | 'paused' | 'concluded';
export type MessageType = 'message' | 'thinking' | 'system' | 'pat' | 'claude';

export interface ChatAgent {
  id: string;
  name: string;
  color: string;
  status: AgentStatus;
  currentThought: string;
}

export interface ChatMessage {
  id: string;
  agentId: string;  // 'pat' | 'claude' | agent id
  text: string;
  timestamp: string;
  type: MessageType;
}

export type DeliberationPhase = 'frame' | 'deliberate' | 'synthesis' | 'patinput' | 'decision';

export type CoverageQuality = 'pending' | 'consensus' | 'tension' | 'shifted';

export interface SubQuestion {
  id: number;
  text: string;
  status: 'pending' | 'addressed' | 'lumped';  // legacy compat
  quality?: CoverageQuality;  // consensus = fast agreement, tension = real disagreement, shifted = position changed
  addressedBy?: string[];  // agent IDs that substantively addressed it
  resolution?: string;     // one-line summary of what was decided
}

export interface BalanceNote {
  agentId: string;
  risk: string;           // e.g. "will push to cut scope"
  counterbalance: string; // e.g. "steelman anything they dismiss without specific engagement"
}

export interface DeliberationPlan {
  subQuestions: SubQuestion[];
  balanceNotes?: BalanceNote[];  // optional -- mediator handles bias correction on the fly
}

export interface ChatSession {
  id: string;
  topic: string;
  status: SessionStatus;
  startedAt: string;
  startedBy: 'claude' | 'pat';
  waitingForInput: boolean;
  roundNumber: number;
  pendingPatMessage?: string;
  deliberationPhase?: DeliberationPhase;
  introRevealedCount?: number;  // undefined = no intro mode; 0..N = agents revealed so far
  plan?: DeliberationPlan;      // mediator guardrails: sub-questions + balance assessment
}

export interface ChatReaction {
  id: string;
  agentId: string;
  emoji: string;
  timestamp: string;
}

export interface ChatroomState {
  session: ChatSession;
  agents: ChatAgent[];
  messages: ChatMessage[];
  reactions: ChatReaction[];
}

export const EMPTY_CHATROOM: ChatroomState = {
  session: {
    id: '',
    topic: '',
    status: 'idle',
    startedAt: '',
    startedBy: 'claude',
    waitingForInput: false,
    roundNumber: 0,
  },
  agents: [],
  messages: [],
  reactions: [],
};
