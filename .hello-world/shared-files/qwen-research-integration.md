# Qwen Integration Research — Hello World Boardrooms

**Date**: 2026-02-26
**Context**: Hello World uses a chatroom/deliberation system (`packages/core/src/chatroom/`) where agents run via `callClaude()` -- spawning `claude` CLI subprocesses. We want Qwen agents as first-class boardroom participants alongside Claude agents.

---

## 1. HOW TO CALL QWEN FROM NODE.JS/TYPESCRIPT

### Primary approach: OpenAI-compatible client (drop-in)

Qwen's DashScope API is fully OpenAI-compatible. The `openai` npm package works without modification -- just change the base URL and API key.

```typescript
import OpenAI from 'openai';

const qwen = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  // US region: https://dashscope-us.aliyuncs.com/compatible-mode/v1
  // China:     https://dashscope.aliyuncs.com/compatible-mode/v1
});

const response = await qwen.chat.completions.create({
  model: 'qwen-max',               // or qwen3-coder-plus, qwen-turbo, etc.
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ],
  max_tokens: 512,
});
const text = response.choices[0].message.content ?? '';
```

This is the cleanest fit for Hello World. The existing `callClaude()` in `agent-runner.ts` spawns a subprocess; a `callQwen()` function would be a direct HTTP call -- faster and no subprocess overhead.

### Alternative: Vercel AI SDK (@ai-sdk/openai-compatible)

The Vercel AI SDK has a community Qwen provider and an `@ai-sdk/openai-compatible` package. It abstracts provider differences behind a single interface:

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

const qwenProvider = createOpenAICompatible({
  name: 'qwen',
  baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY,
});

const { text } = await generateText({
  model: qwenProvider('qwen-max'),
  system: systemPrompt,
  prompt: userMessage,
});
```

The AI SDK v5/v6 supports switching providers with a single line change and has a global provider registry (`'qwen/qwen-max'` style references). This would let the boardroom system be provider-agnostic by design.

### Alternative: LiteLLM proxy

LiteLLM is a Python-based unified gateway that normalizes 100+ LLM providers to a single OpenAI-format endpoint. You run it as a sidecar:

```
litellm --model qwen/qwen-max --port 4000
```

Then call it from TypeScript as if it were a local OpenAI endpoint. Handles cost tracking, load balancing, retries, and error format normalization. Overkill for a single Qwen addition, but useful if the boardroom eventually uses DeepSeek, Gemini, etc. simultaneously.

### Model selection guide (current pricing, Feb 2026)

| Model | Use case | Cost (input/output per 1M tokens) |
|---|---|---|
| qwen-turbo | Fast, cheap, lower quality | ~$0.05 / $0.20 |
| qwen-plus | Balanced | ~$0.40 / $1.20 |
| qwen-max | Best quality | ~$1.60 / $6.40 |
| qwen3-coder-plus | Agentic coding, SWE-bench 69.6% | varies |
| qwen3-8b | Light reasoning | ~$0.05 / $0.40 |

Qwen3-Max released Sept 2025: $1.20 / $6.00 per 1M. Context caching brings input cost to ~$0.02-0.05 per 1M cached tokens.

For boardroom deliberation (short turns, low latency), `qwen-turbo` or `qwen-plus` are the right picks. For a Qwen coding agent reviewing actual code, `qwen3-coder-plus`.

---

## 2. TOOL CALLING FORMAT

### Qwen3 / Qwen2.5 tool calling is OpenAI-compatible

Qwen uses the Hermes-style tool call format internally, but exposes it as standard OpenAI function calling via the API. The format is identical:

```typescript
// Define tools exactly as you would for OpenAI
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the project',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
        },
        required: ['path'],
      },
    },
  },
];

const response = await qwen.chat.completions.create({
  model: 'qwen-max',
  messages,
  tools,
  tool_choice: 'auto',
});

// Handle tool calls exactly as with OpenAI
if (response.choices[0].finish_reason === 'tool_calls') {
  const toolCalls = response.choices[0].message.tool_calls ?? [];
  for (const call of toolCalls) {
    const args = JSON.parse(call.function.arguments);
    const result = await executeLocalTool(call.function.name, args);
    messages.push({ role: 'tool', tool_call_id: call.id, content: result });
  }
}
```

**Caveat**: Qwen tool calling has known reliability issues at the edges. GitHub issues on qwen-code report cases where the assistant message with `tool_calls` is not followed by the correct tool response sequence, causing format errors. The fix is strict input validation and retry logic (see Section 4).

For vLLM self-hosted Qwen, you must explicitly enable tool calling:
```
vllm serve Qwen/Qwen3-8B --enable-auto-tool-choice --tool-call-parser hermes
```

---

## 3. MULTI-MODEL ORCHESTRATION FRAMEWORKS

### What exists (and why most don't fit Hello World)

| Framework | Language | Multi-model | Boardroom style | Notes |
|---|---|---|---|---|
| AutoGen (Microsoft) | Python | Yes | Yes -- conversation-style | Merged with Semantic Kernel in Oct 2025. Python only. |
| CrewAI | Python | Partial | Role-based teams | Python, 60% Fortune 500, not TypeScript |
| LangGraph | Python/JS | Yes | Graph nodes | JS version exists but limited |
| MetaGPT | Python/TS | Yes | Software company roles | TS port exists (`@louloulinx/metagpt`) |
| Mastra | TypeScript | Yes | Workflow-based | Best TS-native option, built on Vercel AI SDK |
| Microsoft Agent Framework | Python | Yes | Production-grade | Oct 2025, Python only |

**Conclusion for Hello World**: None of these fit cleanly. Hello World already has a working boardroom in `chatroom/agent-runner.ts`. The right move is to extend that system rather than adopt a framework.

### Boardroom collaboration patterns (from research)

Three patterns seen in production multi-agent systems:

**1. Sequential assembly line** (MetaGPT, current Hello World per-agent loop)
Each agent fires in turn. Simple, predictable, no parallelism. Current `agent-runner.ts` does this.

**2. Role-based team with shared context** (CrewAI, BusiAgent)
Agents have defined personas (CEO, CFO, CTO). Each gets a subset of context. A coordinator routes messages. Closest to the current Hello World "deliberation panel" design.

**3. Graph-based workflow** (LangGraph, Mastra)
Agents are nodes, edges define message routing. Best for complex conditional flows. Overkill for conversational deliberation.

For boardrooms, pattern 2 is the right one. Hello World already implements it with Claude agents. Adding Qwen is a matter of swapping `callClaude()` for `callQwen()` per agent definition.

---

## 4. HOW TO INTEGRATE INTO THE EXISTING SYSTEM

### Current architecture

`agent-runner.ts` uses `callClaude()` which spawns a `claude` subprocess. Every agent (contrarian, steelman, etc.) in `AGENT_DEFINITIONS` runs through the same function. The system is already role-based and sequential.

### Minimal integration: add a `callQwen()` function

```typescript
// In agent-runner.ts (or a new agent-providers.ts)
async function callQwen(
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal,
  model = 'qwen-plus',
): Promise<string> {
  if (signal.aborted) throw new Error('aborted');

  const qwen = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  });

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await qwen.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 512,
        temperature: 0.7,
      },
      { signal: controller.signal },
    );
    return response.choices[0].message.content?.trim() ?? '';
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
```

### Add provider field to agent definitions

```typescript
// In agent-definitions.ts
export interface AgentDefinition {
  id: string;
  name: string;
  color: string;
  systemPrompt: string;
  provider: 'claude' | 'qwen';   // new field
  model?: string;                  // optional override, e.g. 'qwen-turbo'
}
```

### Route calls by provider in runSingleAgent

```typescript
async function runSingleAgent(
  store: ChatroomStore,
  agentId: string,
  notify: (files: string[]) => void,
  signal: AbortSignal,
): Promise<void> {
  const def = AGENT_DEFINITIONS[agentId];
  if (!def) return;

  store.updateAgentStatus(agentId, 'thinking', '...');
  notify(['chatroom.json']);

  const state = store.read();
  if (state.session.status !== 'active') return;

  const conversation = buildConversation(state.messages, state.session.topic);

  try {
    let raw: string;
    if (def.provider === 'qwen') {
      raw = await callQwen(def.systemPrompt, conversation, signal, def.model);
    } else {
      raw = await callClaude(def.systemPrompt, conversation, signal);
    }
    if (signal.aborted) return;
    store.appendMessage(agentId, stripMarkdown(raw), 'message');
    store.updateAgentStatus(agentId, 'idle', '');
    notify(['chatroom.json']);
  } catch (err: unknown) {
    // ... existing error handling
  }
}
```

---

## 5. CONTEXT SHARING

### Current approach

`buildConversation()` passes the last 16 messages as a plain text block. Each agent sees:
- The topic
- The conversation history (formatted as `[Agent: message]`)
- Its system prompt (defining its role/persona)

This works identically for Qwen -- it accepts the same message format.

### Giving Qwen agents access to project context

For Qwen to reason about actual code/decisions/memories, inject project context into the system prompt:

```typescript
function buildQwenSystemPrompt(agentDef: AgentDefinition, projectContext: ProjectContext): string {
  return `${agentDef.systemPrompt}

PROJECT CONTEXT:
- Active task: ${projectContext.activeTask}
- Recent decisions: ${projectContext.recentDecisions.slice(0, 3).map(d => d.title).join(', ')}
- Key files changed: ${projectContext.recentFiles.join(', ')}

You are participating in a boardroom deliberation. Respond as your assigned role.
4 sentences maximum.`;
}
```

For file content, pass it inline if it's short (< 2000 tokens), or summarize first via a cheap model call.

### Token budget management

With two models active, token spend doubles. Strategies:

1. **Truncate conversation history per-model**: Claude agents may get 16-message history; Qwen agents get 8. Qwen-Plus has a 131k context window so this is headroom, not a constraint.

2. **Use cheaper Qwen models for early rounds**: `qwen-turbo` for rounds 1-2, `qwen-plus` for round 3+ when discussion has depth worth analyzing.

3. **Budget per session**: Track cumulative token cost. Stop adding Qwen agents if session cost exceeds a threshold (e.g. $0.50). The existing `agent/cost.ts` module is the right place for this.

4. **Context caching**: DashScope supports prefix caching (~$0.02-0.05 per 1M cached tokens vs $1.60 regular). For a long system prompt reused across all rounds, caching gives 10-80x savings. Pass `enable_thinking: false` and structure prompts with a stable prefix section.

---

## 6. MESSAGE FORMAT TRANSLATION

### Claude vs Qwen message format

Claude uses the Anthropic Messages API (`Human:` / `Assistant:` alternating blocks). Qwen uses OpenAI's chat completions format (`role: system/user/assistant`). They are fundamentally different.

**This is not a problem for the current architecture.** `agent-runner.ts` builds a plain text conversation string (`[Agent: message]` format) that it passes as a single `user` message to each agent. Both Claude (via CLI) and Qwen (via API) receive plain text -- no format translation needed.

If you ever want Qwen agents to have tool access (reading files, etc.), the tool call loop is the same format as OpenAI (see Section 2).

The one translation issue: Claude sometimes outputs markdown (`**bold**`, `## headers`). The existing `stripMarkdown()` function handles this. Qwen agents may produce similar formatting -- the same function works.

---

## 7. ERROR HANDLING AND RECOVERY

### Known Qwen failure modes

From GitHub issues on qwen-code (2025):

1. **Tool call sequence errors**: Qwen sometimes emits an assistant message with `tool_calls` but the conversation then lacks the matching tool response. Fix: validate before appending, retry if malformed.

2. **Thinking mode hangs**: Qwen3 models with `enable_thinking: true` can spend long periods in thinking before responding. For boardroom use, disable thinking mode (`enable_thinking: false`) for fast turns.

3. **Syntactically invalid code**: Qwen-Code (the agentic tool) has produced broken code with literal `\n` strings and escaped quotes. Less relevant for deliberation agents, but critical for any coding agent role.

4. **Rate limits**: DashScope returns 429s under load. Specific RPS limits are not published, but standard retry behavior applies.

### Retry pattern

```typescript
async function callQwenWithRetry(
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal,
  maxRetries = 2,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal.aborted) throw new Error('aborted');
    try {
      const result = await callQwen(systemPrompt, userMessage, signal);
      if (result.length < 5) throw new Error('response too short -- likely truncated');
      return result;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isRetryable =
        lastError.message.includes('429') ||
        lastError.message.includes('5') ||  // 5xx
        lastError.message.includes('timeout');
      if (!isRetryable || attempt === maxRetries) break;
      // Exponential backoff: 1s, 2s
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  throw lastError ?? new Error('unknown error');
}
```

### Fallback to Claude

If Qwen fails after retries, fall back to Claude for that agent's turn:

```typescript
try {
  raw = await callQwenWithRetry(def.systemPrompt, conversation, signal);
} catch {
  // Qwen unavailable -- fall back to Claude for this turn
  raw = await callClaude(def.systemPrompt, conversation, signal);
  store.appendMessage(agentId, '[Fallback to Claude]', 'system');
}
```

### Two-Strike integration

Hello World already has a Two-Strike system in `orchestration/strikes.ts`. If Qwen fails twice for the same task, flag it and notify Pat via Discord rather than silently falling back. The boardroom is a deliberation context, not a coding task, so a softer rule applies: fall back silently once, then notify.

### Cost controls per session

```typescript
const BOARDROOM_BUDGET_USD = 0.50; // per session

// In agent-runner.ts, before each agent call:
const sessionCost = estimateSessionCost(store.read().messages, agentDef.provider);
if (sessionCost > BOARDROOM_BUDGET_USD) {
  store.appendMessage('claude', `[Budget limit reached -- stopping Qwen agents]`, 'system');
  // Skip remaining Qwen agents this round
  return;
}
```

Token estimation: at qwen-plus rates ($0.40/$1.20 per 1M), a 10-round boardroom with 4 agents, 512 tokens/turn = ~20k tokens = ~$0.01. Budget concerns are real only if context windows are large or many rounds run.

---

## 8. EXISTING OPEN SOURCE EXAMPLES

### Projects orchestrating multiple LLMs for coding

**OpenCode** (ported from Claude Code's agent teams):
- Supports multi-model teammates: different agents can use Claude, Qwen, GPT-4 simultaneously
- Uses a shared task list and peer-to-peer messaging
- Source pattern: each teammate has a `model` field; the runner calls the right provider per message

**MetaGPT TypeScript port** (`@louloulinx/metagpt` on npm):
- Product Manager, Architect, Engineer roles each calling LLMs
- Configurable per-role model -- you could assign Qwen to Engineer and Claude to Product Manager
- TypeScript-native

**Mastra** (most relevant TypeScript framework):
- Built on Vercel AI SDK -- uniform interface across 40+ providers
- Workflow nodes can each use different models
- Agent orchestration with memory, tool use, multi-step workflows
- `mastra.ai` -- open source, Apache 2.0

**BusiAgent** (research, 2025):
- Multi-agent LLM framework for "boardroom decisions" (literally -- CEO/CFO/CTO roles)
- Each agent gets partial information and specialized tools
- Coordinates through delegated tasks, chain-of-thought, and memory checks
- arxiv.org/abs/2508.15447 -- reference architecture matches Hello World boardroom vision

**LiteLLM** (Python gateway):
- Universal proxy that normalizes Qwen, Claude, GPT-4, DeepSeek to one API
- TypeScript calls it as a local OpenAI endpoint
- Handles cost tracking, load balancing, format translation
- Real option if Hello World needs 3+ providers

---

## 9. QWEN vs CLAUDE FOR BOARDROOM AGENTS

### Benchmark reality check

- Qwen3-Coder: 69.6% SWE-Bench Verified (highest open-source, comparable to Claude 3.7 Sonnet)
- Qwen2.5: 85% HumanEval, best open-source on BigCodeBench/LiveCodeBench at time of release
- Claude Sonnet 4.5: better at tool-heavy and complex MCP prompts, better contextual understanding
- Qwen3-Coder: faster, cheaper (free via qwen.ai, $0 commercial tier exists), strong agentic coding

For **deliberation agents** (the current boardroom use case), the quality gap between Qwen-Plus and Claude Haiku is small. Deliberation agents produce short opinion-style text, not long code. Qwen-Plus at $0.40/1M input vs Claude Haiku-4 is a significant cost saving.

For **coding agents** (reviewing PRs, debugging, writing implementations), Claude Sonnet remains better on tool-heavy tasks. Qwen3-Coder is a credible alternative for routine coding work.

### Recommended agent assignments for boardrooms

| Role | Provider | Rationale |
|---|---|---|
| Contrarian, Steelman, Analogist | qwen-plus | Cheap opinion generation, low stakes |
| Pragmatist, Cost Analyst | qwen-plus | Domain reasoning, no tool access needed |
| Backend Architect, Security | claude-haiku | Tool use may be needed; Claude more reliable |
| Mediator / Synthesis | claude (existing) | Synthesis quality matters most |

---

## 10. IMPLEMENTATION ROADMAP

### Phase 1: Basic Qwen agent support (1-2 sessions)

1. Add `openai` npm package to `packages/core` (already compatible, just needs install)
2. Add `DASHSCOPE_API_KEY` to env config + `.env` example
3. Write `callQwen()` function in `agent-runner.ts`
4. Add `provider: 'claude' | 'qwen'` field to `AgentDefinition` in `agent-definitions.ts`
5. Update `runSingleAgent()` to route by provider
6. Add 2-3 new agent definitions using `provider: 'qwen'`
7. Update the boardroom UI to show provider badge per agent (optional cosmetic)

### Phase 2: Reliability and cost tracking (1 session)

1. Add retry logic with exponential backoff to `callQwen()`
2. Add Claude fallback if Qwen fails after 2 attempts
3. Extend `agent/cost.ts` to track Qwen token spend per session
4. Add session budget cap (configurable in Settings view)

### Phase 3: Coding agent in boardroom (2-3 sessions, longer-term)

1. Give select Qwen agents tool access (read file, list directory)
2. Implement tool call loop for Qwen (parse `tool_calls` response, execute, feed results back)
3. Add a "code reviewer" agent persona that reads actual diff before commenting
4. Consider `qwen3-coder-plus` for this role

### What to avoid

- **Adopting a full framework** (Mastra, LangGraph): Hello World already has the orchestration logic. A framework adds abstraction over code that's already written and working.
- **LiteLLM proxy as a required dependency**: It's Python, it's a service, it's operational overhead. Direct OpenAI client is simpler.
- **Mixing provider message formats**: Keep passing plain text via `buildConversation()`. Don't try to interleave Anthropic and OpenAI message arrays.
- **`enable_thinking: true` in boardroom**: Qwen3 thinking mode is slow (15-60s). Deliberation agents need fast turns. Keep thinking disabled.

---

## Sources

- [How to call Qwen models using the OpenAI API (Alibaba Cloud)](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)
- [DashScope API reference](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-dashscope)
- [Community Providers: Qwen (Vercel AI SDK)](https://ai-sdk.dev/providers/community-providers/qwen)
- [Qwen Function Calling - Qwen docs](https://qwen.readthedocs.io/en/latest/framework/function_call.html)
- [Qwen-Agent GitHub (MCP + tool calling)](https://github.com/QwenLM/Qwen-Agent)
- [MCP servers with Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/developers/tools/mcp-server/)
- [Qwen3-Coder blog post](https://qwenlm.github.io/blog/qwen3-coder/)
- [LiteLLM DashScope provider](https://docs.litellm.ai/docs/providers/dashscope)
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction)
- [Mastra TypeScript AI framework](https://mastra.ai/)
- [LLM Orchestration frameworks 2026](https://research.aimultiple.com/llm-orchestration/)
- [BusiAgent: From Bits to Boardrooms (arxiv)](https://arxiv.org/abs/2508.15447)
- [Multi-Agent Collaboration Mechanisms survey](https://arxiv.org/html/2501.06322v1)
- [Qwen3-Coder vs Claude comparison (Composio)](https://composio.dev/blog/qwen-3-coder-vs-kimi-k2-vs-claude-4-sonnet-coding-comparison)
- [Qwen API Pricing 2026](https://pricepertoken.com/pricing-page/provider/qwen)
- [CRITICAL Qwen-Code destroys builds issue](https://github.com/QwenLM/qwen-code/issues/354)
- [Porting Claude Code agent teams to OpenCode](https://thenote.app/post/en/porting-claude-codes-agent-teams-to-opencode-gy2gh7gwns)
- [Claude Code hidden multi-agent system](https://paddo.dev/blog/claude-code-hidden-swarm/)
- [Anthropic: How we built our multi-agent research system](https://simonwillison.net/2025/Jun/14/multi-agent-research-system/)
- [Qwen API pricing guide 2026 (DeepInfra)](https://deepinfra.com/blog/qwen-api-pricing-2026-guide)
- [Alibaba Cloud model pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
