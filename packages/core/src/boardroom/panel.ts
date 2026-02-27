/**
 * Qwen Panel v2 -- simple parallel calls with file injection.
 * No rounds, no char limit, no whiteboard. Just parallel Qwen calls
 * with full context and merged output.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { recordUsage } from './usage.js';

// Qwen API config -- OpenRouter (Qwen 3.5)
const QWEN_MODEL = process.env['QWEN_MODEL'] ?? 'qwen/qwen3.5-plus-02-15';
const QWEN_BASE_URL = process.env['QWEN_BASE_URL'] ?? 'https://openrouter.ai/api/v1';
const QWEN_API_KEY = process.env['OPENROUTER_API_KEY'] ?? process.env['QWEN_API_KEY'] ?? '';

export interface PanelAgent {
  id: string;
  name: string;
  role: string;
}

export interface PanelResult {
  id: string;
  topic: string;
  agents: PanelAgent[];
  responses: Array<{
    agentId: string;
    agentName: string;
    content: string;
    tokens: { prompt: number; completion: number };
    durationMs: number;
    error?: string;
  }>;
  injectedFiles: string[];
  totalTokens: number;
  totalCostUsd: number;
  durationMs: number;
  createdAt: string;
}

function genId(): string {
  return `panel_${randomBytes(4).toString('hex')}`;
}

async function callQwen(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  if (!QWEN_API_KEY) throw new Error('QWEN_API_KEY not set');

  const resp = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: QWEN_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    signal,
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Qwen ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    content: (json.choices?.[0]?.message?.content ?? '').trim(),
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
  };
}

function buildContext(
  files: Array<{ path: string; content: string }>,
  facts?: string[],
): string {
  const parts: string[] = [];

  if (files.length > 0) {
    parts.push('INJECTED CODEBASE CONTEXT');
    parts.push('========================');
    for (const f of files) {
      parts.push(`--- FILE: ${f.path} ---`);
      parts.push(f.content);
      parts.push('');
    }
    parts.push('========================');
  }

  if (facts && facts.length > 0) {
    parts.push('');
    parts.push('KNOWN FACTS:');
    for (const fact of facts) {
      parts.push(`- ${fact}`);
    }
  }

  return parts.join('\n');
}

export async function runPanel(
  projectPath: string,
  topic: string,
  agents: PanelAgent[],
  options?: {
    filePaths?: string[];
    facts?: string[];
    questions?: string[];
    maxTokens?: number;
    timeoutMs?: number;
  },
): Promise<PanelResult> {
  const startTime = Date.now();
  const maxTokens = options?.maxTokens ?? 4000;
  const timeoutMs = options?.timeoutMs ?? 120_000;

  // Read files
  const files: Array<{ path: string; content: string }> = [];
  for (const fp of (options?.filePaths ?? [])) {
    try {
      const content = readFileSync(fp, 'utf8');
      files.push({ path: fp, content: content.slice(0, 12000) });
    } catch {
      files.push({ path: fp, content: '(file not found)' });
    }
  }

  const contextBlock = buildContext(files, options?.facts);

  // Build user message
  const userParts: string[] = [`TOPIC: ${topic}`];
  if (contextBlock) userParts.push('', contextBlock);
  if (options?.questions && options.questions.length > 0) {
    userParts.push('', 'REQUIRED QUESTIONS (address each one):');
    for (let i = 0; i < options.questions.length; i++) {
      userParts.push(`${i + 1}. ${options.questions[i]}`);
    }
  }
  userParts.push('', 'Provide a thorough analysis. Be specific and cite evidence from the injected files where relevant.');
  const userMessage = userParts.join('\n');

  // Call all agents in parallel
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

  const promises = agents.map(async (agent) => {
    const agentStart = Date.now();
    try {
      const result = await callQwen(
        `You are ${agent.name}. ${agent.role}`,
        userMessage,
        maxTokens,
        ctrl.signal,
      );

      // Track usage
      try {
        recordUsage(projectPath, QWEN_MODEL, 'qwen', result.promptTokens, result.completionTokens, 'panel');
      } catch { /* non-fatal */ }

      return {
        agentId: agent.id,
        agentName: agent.name,
        content: result.content,
        tokens: { prompt: result.promptTokens, completion: result.completionTokens },
        durationMs: Date.now() - agentStart,
      };
    } catch (err: unknown) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        content: '',
        tokens: { prompt: 0, completion: 0 },
        durationMs: Date.now() - agentStart,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const responses = await Promise.all(promises);
  clearTimeout(timeout);

  // Compute totals
  let totalTokens = 0;
  const totalCostUsd = 0;
  for (const r of responses) {
    totalTokens += r.tokens.prompt + r.tokens.completion;
  }

  const result: PanelResult = {
    id: genId(),
    topic,
    agents,
    responses,
    injectedFiles: files.map(f => f.path),
    totalTokens,
    totalCostUsd,
    durationMs: Date.now() - startTime,
    createdAt: new Date().toISOString(),
  };

  // Save to disk
  const dir = join(projectPath, '.hello-world', 'panels');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${result.id}.json`), JSON.stringify(result, null, 2));

  return result;
}

export function formatPanelResult(result: PanelResult): string {
  const lines: string[] = [];
  lines.push(`Panel: ${result.topic}`);
  lines.push(`Agents: ${result.agents.length} | Tokens: ${result.totalTokens} | Time: ${(result.durationMs / 1000).toFixed(1)}s`);
  lines.push('');

  for (const r of result.responses) {
    lines.push(`--- ${r.agentName} ---`);
    if (r.error) {
      lines.push(`[ERROR: ${r.error}]`);
    } else {
      lines.push(r.content);
    }
    lines.push('');
  }

  return lines.join('\n');
}
