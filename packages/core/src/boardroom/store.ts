import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import type { Boardroom, BoardroomAgent, BoardroomMessage, WhiteboardEntry } from './types.js';
import { CHAT_CHAR_LIMIT } from './types.js';

function boardroomDir(projectPath: string): string {
  return join(projectPath, '.hello-world', 'boardrooms');
}

function boardroomFile(projectPath: string, boardroomId: string): string {
  return join(boardroomDir(projectPath), `${boardroomId}.json`);
}

function genId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

export function createBoardroom(
  projectPath: string,
  topic: string,
  agents: BoardroomAgent[],
): Boardroom {
  const dir = boardroomDir(projectPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const boardroom: Boardroom = {
    id: genId('br'),
    topic,
    status: 'active',
    createdAt: new Date().toISOString(),
    agents,
    chat: [],
    whiteboard: [],
  };

  writeFileSync(boardroomFile(projectPath, boardroom.id), JSON.stringify(boardroom, null, 2));
  return boardroom;
}

export function readBoardroom(projectPath: string, boardroomId: string): Boardroom | null {
  const file = boardroomFile(projectPath, boardroomId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as Boardroom;
}

export function listBoardrooms(projectPath: string): Boardroom[] {
  const dir = boardroomDir(projectPath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Boardroom)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function saveBoardroom(projectPath: string, boardroom: Boardroom): void {
  writeFileSync(boardroomFile(projectPath, boardroom.id), JSON.stringify(boardroom, null, 2));
}

export function postChat(
  projectPath: string,
  boardroomId: string,
  agentId: string,
  text: string,
): BoardroomMessage | null {
  const boardroom = readBoardroom(projectPath, boardroomId);
  if (!boardroom || boardroom.status !== 'active') return null;

  // Enforce 160-char limit -- truncate, don't reject
  const truncated = text.length > CHAT_CHAR_LIMIT ? text.slice(0, CHAT_CHAR_LIMIT) : text;

  const msg: BoardroomMessage = {
    id: genId('msg'),
    agentId,
    text: truncated,
    timestamp: new Date().toISOString(),
  };

  boardroom.chat.push(msg);
  saveBoardroom(projectPath, boardroom);
  return msg;
}

export function writeWhiteboard(
  projectPath: string,
  boardroomId: string,
  agentId: string,
  section: string,
  content: string,
): WhiteboardEntry | null {
  const boardroom = readBoardroom(projectPath, boardroomId);
  if (!boardroom || boardroom.status !== 'active') return null;

  const entry: WhiteboardEntry = {
    id: genId('wb'),
    agentId,
    section,
    content,
    timestamp: new Date().toISOString(),
  };

  boardroom.whiteboard.push(entry);
  saveBoardroom(projectPath, boardroom);
  return entry;
}

export function closeBoardroom(projectPath: string, boardroomId: string): boolean {
  const boardroom = readBoardroom(projectPath, boardroomId);
  if (!boardroom) return false;
  boardroom.status = 'closed';
  saveBoardroom(projectPath, boardroom);
  return true;
}
