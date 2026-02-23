import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import type { ChatroomState, ChatAgent, ChatMessage, SessionStatus, DeliberationPhase, ChatReaction } from './types.js';
import { EMPTY_CHATROOM } from './types.js';

function uid(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

export class ChatroomStore {
  private path: string;
  private deliberationsDir: string;

  constructor(projectRoot: string) {
    this.path = join(projectRoot, '.hello-world', 'chatroom.json');
    this.deliberationsDir = join(projectRoot, '.hello-world', 'deliberations');
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
        deliberationPhase: 'frame',
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
      reactions: [],
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

  setDeliberationPhase(phase: DeliberationPhase): void {
    this.update(state => ({
      ...state,
      session: { ...state.session, deliberationPhase: phase },
    }));
  }

  appendReaction(agentId: string, emoji: string): ChatReaction {
    const reaction: ChatReaction = {
      id: uid('rxn'),
      agentId,
      emoji,
      timestamp: new Date().toISOString(),
    };
    const cutoff = new Date(Date.now() - 30_000).toISOString();
    this.update(state => ({
      ...state,
      reactions: [
        ...(state.reactions ?? []).filter(r => r.timestamp > cutoff),
        reaction,
      ],
    }));
    return reaction;
  }

  setPendingPatMessage(message: string | undefined): void {
    this.update(state => ({
      ...state,
      session: { ...state.session, pendingPatMessage: message },
    }));
  }

  // Archive the current session to deliberations/ and reset chatroom to idle.
  // No-op if session is already idle or has no messages.
  archiveAndReset(): string | null {
    const state = this.read();
    if (state.session.status === 'idle' || state.messages.length === 0) return null;

    mkdirSync(this.deliberationsDir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    const slug = state.session.topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    const filename = `${date}-${slug || state.session.id}.json`;
    const archivePath = join(this.deliberationsDir, filename);

    writeFileSync(archivePath, JSON.stringify(state, null, 2), 'utf-8');
    this.write(structuredClone(EMPTY_CHATROOM));

    return filename;
  }
}
