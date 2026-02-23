import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import type { ChatroomState, ChatAgent, ChatMessage, SessionStatus } from './types.js';
import { EMPTY_CHATROOM } from './types.js';

function uid(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

export class ChatroomStore {
  private path: string;

  constructor(projectRoot: string) {
    this.path = join(projectRoot, '.hello-world', 'chatroom.json');
  }

  read(): ChatroomState {
    try {
      return JSON.parse(readFileSync(this.path, 'utf-8')) as ChatroomState;
    } catch {
      return structuredClone(EMPTY_CHATROOM);
    }
  }

  write(state: ChatroomState): void {
    writeFileSync(this.path, JSON.stringify(state, null, 2), 'utf-8');
  }

  update(fn: (state: ChatroomState) => ChatroomState): ChatroomState {
    const next = fn(this.read());
    this.write(next);
    return next;
  }

  startSession(topic: string, agentIds: string[], startedBy: 'claude' | 'pat', agentDefs: Record<string, { id: string; name: string; color: string }>): ChatroomState {
    const agents: ChatAgent[] = agentIds
      .filter(id => agentDefs[id])
      .map(id => ({
        id,
        name: agentDefs[id].name,
        color: agentDefs[id].color,
        status: 'idle',
        currentThought: '',
      }));

    const state: ChatroomState = {
      session: {
        id: uid('chat'),
        topic,
        status: 'active',
        startedAt: new Date().toISOString(),
        startedBy,
        waitingForInput: false,
        roundNumber: 0,
      },
      agents,
      messages: [
        {
          id: uid('msg'),
          agentId: 'system',
          text: `Deliberation started: "${topic}"`,
          timestamp: new Date().toISOString(),
          type: 'system',
        },
      ],
    };

    this.write(state);
    return state;
  }

  appendMessage(agentId: string, text: string, type: ChatMessage['type'] = 'message'): void {
    this.update(state => ({
      ...state,
      messages: [
        ...state.messages,
        { id: uid('msg'), agentId, text, timestamp: new Date().toISOString(), type },
      ],
    }));
  }

  updateAgentStatus(agentId: string, status: ChatAgent['status'], currentThought = ''): void {
    this.update(state => ({
      ...state,
      agents: state.agents.map(a =>
        a.id === agentId ? { ...a, status, currentThought } : a
      ),
    }));
  }

  setSessionStatus(status: SessionStatus, waitingForInput = false): void {
    this.update(state => ({
      ...state,
      session: { ...state.session, status, waitingForInput },
    }));
  }

  incrementRound(): void {
    this.update(state => ({
      ...state,
      session: { ...state.session, roundNumber: state.session.roundNumber + 1, waitingForInput: false },
    }));
  }

  setWaitingForInput(waiting: boolean): void {
    this.update(state => ({
      ...state,
      session: { ...state.session, waitingForInput: waiting },
    }));
  }

  setPendingPatMessage(message: string | undefined): void {
    this.update(state => ({
      ...state,
      session: { ...state.session, pendingPatMessage: message },
    }));
  }
}
