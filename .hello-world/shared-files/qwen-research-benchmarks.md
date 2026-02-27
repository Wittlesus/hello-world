# Qwen Coder Research: Benchmarks, Limitations, and Real-World Performance

Researched: 2026-02-26. Covers Qwen3-Coder (480B flagship), Qwen3-Coder-Next (sparse/local), and Qwen3.5-397B (Feb 2026 release).

---

## 1. Model Lineage Clarification

There is no model called "Qwen 3.5 Coder" specifically. The relevant models are:

- **Qwen2.5-Coder-32B-Instruct** -- Oct 2024. Previous generation coding specialist.
- **Qwen3-Coder-480B-A35B-Instruct** -- July 2025. 480B MoE, 35B active params. Current flagship.
- **Qwen3-Coder-30B-A3B-Instruct** -- July 2025. Smaller variant, 3B active params.
- **Qwen3-Coder-Next** -- Feb 2026. Ultra-sparse successor for local deployment. ~80B total, ~3B active.
- **Qwen3.5-397B-A17B** -- Feb 16, 2026. General flagship (NOT a dedicated coder model, but includes strong coding).

---

## 2. SWE-bench Verified Scores

### Qwen3-Coder-480B (flagship, July 2025)

| Configuration | Score | Harness/Notes |
|---|---|---|
| Single-shot (no agent loop) | 67.0% | Standard eval |
| 500-turn agentic (OpenHands v0.54.0) | **69.6%** | The cited headline number |

Methodology for 69.6%: Uses OpenHands scaffold, 500-turn limit, native tool calling enabled, pinned to v0.54.0. Evaluated on the standard 500-problem SWE-bench Verified set.

For context, Claude Sonnet 4 scores 70.4% on the same benchmark.

### Qwen3-Coder-Next (Feb 2026)

| Benchmark | Score | Scaffold |
|---|---|---|
| SWE-bench Verified | **70.6%** | SWE-Agent |
| SWE-bench Multilingual | 62.8% | SWE-Agent |
| SWE-bench Pro | 44.3% | SWE-Agent |

Claude Opus 4.6 scores 80.8% on SWE-bench Verified.

### Qwen3.5-397B (Feb 2026, general model)

| Benchmark | Score |
|---|---|
| SWE-bench Verified | **76.4%** |

Independent verification of the 76.4% claim is still underway as of Feb 2026.

---

## 3. HumanEval, MBPP, LiveCodeBench, EvalPlus

### Qwen3-Coder-480B

| Benchmark | Score | Notes |
|---|---|---|
| HumanEval pass@1 | ~85% | Qwen's own report; Qwen2.5-Coder-7B hits 88.4%, suggesting 480B is higher |
| LiveCodeBench v5 | 70.7% | 7th place on leaderboard as of mid-2025 |
| LiveCodeBench (ranking) | 7th overall | Behind GPT-4o, Claude, Gemini 2.5 Pro |
| Aider Polyglot (235B variant) | 65.3% | Best config: VLLM bfloat16, thinking OFF |

**Important caveat on Aider scores:** Qwen3-235B (the non-coder variant) scored 65.3% with optimal local settings, but only 49.8% via OpenRouter with default settings. Configuration matters enormously.

### Qwen2.5-Coder-32B-Instruct (previous generation, for baseline)

| Benchmark | Score |
|---|---|
| HumanEval pass@1 | 88.4% |
| MBPP | 84.0% |
| MultiPL-E | 75.4% |
| Aider Code Repair | 73.7% |
| McEval (multilingual) | 65.9% |
| MdEval (multilingual repair) | 75.2% |

Qwen2.5-Coder-32B was competitive with GPT-4o on Aider benchmarks.

### Qwen3.5-397B (Feb 2026)

| Benchmark | Score |
|---|---|
| LiveCodeBench v6 | **83.6%** |
| SWE-bench Verified | 76.4% |
| Terminal-Bench 2 | 52.5% |
| BFCL v4 (Tool Use) | 72.9% |

---

## 4. Agentic Coding Benchmarks

### Qwen3-Coder-480B vs Claude Sonnet 4

| Benchmark | Qwen3-Coder-480B | Claude Sonnet 4 | Notes |
|---|---|---|---|
| SWE-bench Verified | 69.6% | 70.4% | Qwen slightly behind |
| Agentic Coding (custom) | 37.5 | 39.0 | Qwen slightly behind |
| WebArena (Browser Use) | **49.9** | 47.4 | Qwen WINS |
| BFCL-v3 (Tool Use) | 68.7 | 73.3 | Qwen behind on tool calls |
| Aider Polyglot | 61.8% | -- | Qwen's claim |

### Qwen3-Coder-Next (Feb 2026) vs field

| Benchmark | Qwen3-Coder-Next | Claude Opus 4.6 | GPT-5.3 |
|---|---|---|---|
| SWE-bench Verified | 70.6% | **80.8%** | -- |
| Terminal-Bench 2.0 | 36.2% | **65.4%** | 77.3% |
| SWE-bench Pro | 44.3% | -- | -- |
| SecCodeBench | **61.2%** | ~52.5% (Opus 4.5) | -- |

Terminal-Bench 2.0 is a notable gap: Qwen3-Coder-Next at 36.2% vs Claude Opus 4.6 at 65.4%. This tests realistic terminal interaction, not just code generation.

---

## 5. Known Limitations vs Claude

### TypeScript Advanced Patterns

This is the clearest documented failure mode. In independent testing by 16x.engineer:

- **TypeScript type narrowing (advanced)**: Qwen3-Coder scored **1/10**
- Every open-source model tested (Kimi K2, Gemini 2.5 Pro, DeepSeek V3, Qwen3-Coder) failed
- **Claude Sonnet 4 scored 8/10** -- the only model to correctly handle TypeScript compiler checks

All these models "made the same conceptual mistake and failed to produce code that passed the TypeScript compiler check."

### Native Function/Tool Calling

This is a significant practical problem, especially for agentic workflows:

- **Qwen3-Coder-30B frequently omits the `<tool_call>` opening tag**, making outputs unparseable
- When given more than ~5 tools, the model switches from JSON format to XML inside the content field, breaking most agent frameworks
- Documented failures across: Continue.dev, OpenCode, LM Studio, Goose, Ollama
- The issue is described as "a training deficiency rather than merely a template compatibility problem"
- Workaround exists: a custom Jinja2 chat template with explicit `<IMPORTANT>` instructions, run via vLLM with `--chat-template`. Not viable for managed API users.
- The 480B hosted version is less affected because the API enforces proper formatting

### Instruction Following

- Qwen3-Coder is verbose when told to output diffs only -- it outputs full code blocks
- Compared to Claude which correctly follows "output only diff" constraints
- Score comparison (diff task): Qwen3-Coder roughly equivalent to Kimi K2; both below Claude

### UI and Visualization

- Benchmark visualization tasks: Qwen3-Coder scored **7/10** vs Claude Sonnet 4 at 8.5/10
- "Formatting issues set it behind" -- less polished color schemes, layout inconsistencies
- Front-end generation for simple pages is fine; complex visual tasks degrade

### Complex Tool-Heavy Prompts (MCP/Composio-style)

- "For tool-heavy and complex prompts like MCP + Composio, Claude Sonnet 4 is far ahead in both quality and structure. It was the only one that got it right on the first try."
- Qwen3-Coder handles straightforward tool use well but struggles with multi-step multi-tool orchestration

### Algorithm Selection and Correctness

InfoWorld documented: Qwen Code (using Qwen3-Coder) failed to correctly implement the Chudnovsky algorithm for pi calculation. The model started correctly, switched to Machin's formula (less efficient), and when prompted to reconsider, used mpfr's built-in constant while falsely claiming it was using Chudnovsky. It also failed to notice when shell command execution failed due to a typo.

---

## 6. Real User Reports (Reddit, HN, Dev Blogs)

### Hacker News (item 44653072 -- Qwen3-Coder launch thread)

Most discussion was infrastructure-focused: how to run 480B on consumer hardware, quantization levels, memory bandwidth. The absence of quality complaints in the launch thread suggests initial reception was positive, but the discussion was dominated by hardware questions rather than real-world quality assessment.

### Hacker News (item 44653981 -- Qwen Code CLI launch)

One notable comment described the core problem in agentic mode: "multi-turn prompts, they start hallucinating like a drunk intern reading from an old terminal log." The commenter identified **semantic drift** -- after a few turns, the model "silently forgets half the context." This is a documented problem with multi-hop agentic tasks.

### InfoWorld Review ("Qwen Code is good but not great")

Direct quote: "My own tests give me the impression that Claude Sonnet 4 is more capable and reliable than Qwen3-Coder for most coding use cases, and that Claude Opus 4.1 is even better."

The reviewer placed Qwen3-Coder "closer to Gemini 2.5 Pro" in quality rather than at Claude's level.

### Medium/Developer Blog Reports

One developer tested Qwen3-Coder autonomously for 30 minutes and returned to find the project completed -- suggesting it handles sustained agentic runs reasonably well.

Documented success cases:
- Legacy payment gateway migration (SHA-1 to SHA-256 across 9 Java packages)
- FastAPI OpenAPI spec generation (47 endpoints, one shot)
- Terraform security hardening
- Simple front-end generation (animations, gradients, mobile-responsive)

Documented failure/weakness cases:
- Phantom library imports (hallucinated Python library names not in stdlib)
- 420+ second response time on codebases over 200K tokens (mitigated by pre-chunking to ~70 seconds)
- Generally not suited for interactive pair programming due to latency

### GitHub Issue Reports (real signals)

Across `QwenLM/Qwen3-Coder`, `QwenLM/qwen-code`, and third-party repos:

- Tool call format incompatible with most agent frameworks when using local models
- Context limits not respected in requests (compression from 81k to 81k tokens, still overflow)
- "contextWindowSize" setting buggy in qwen-code CLI
- Model generates incorrect code and proceeds as if execution succeeded (does not detect failure)
- Tool call hallucination in Ollama with native tool calling enabled

---

## 7. TypeScript, ESM, and Modern React

**Short answer: Adequately capable for most standard patterns, but fails on advanced TypeScript.**

What works:
- React component generation (hooks, functional components, Tailwind)
- Basic TypeScript (interfaces, types, generics)
- ESM import syntax -- no documented systematic issues
- Framework-specific patterns for React, Vue, Django, FastAPI

What fails:
- **Advanced TypeScript type narrowing** -- the 1/10 score is a hard documented failure, not a minor gap
- TypeScript compiler edge cases involving discriminated unions, conditional types, template literal types likely affected by the same underlying weakness
- Instruction following on diff-only output (verbose = more tokens = more expensive)

No specific user reports about ESM import issues were found. The model appears to handle modern import syntax correctly in standard cases.

---

## 8. Large Codebase Context Utilization (100k+ tokens)

### Claimed vs Real

- Qwen3-Coder-480B: 256K native context, 1M with YaRN extrapolation
- Qwen3-Coder-Next: same architecture
- Qwen3.5-397B: 262K default, 1M for Plus tier

### Documented Problems at Scale

**Context overflow bugs in the CLI:**
- Users reported the qwen-code CLI compressing 81,651 tokens to 81,273 tokens but the request still exceeded 100,096 token limit (100,582 actual) -- the compression math was wrong
- "Useless compression and buggy contextWindowSize" is an open GitHub issue

**Default context truncation:**
- Default context in some configurations silently limits to 2,048 tokens despite the model supporting 128K+
- Users must explicitly configure `contextWindowSize`

**Local deployment (quantized):**
- Practical limit with quantization: 64K-100K tokens before OOM errors
- 30B model at 40K context caused "failed to allocate compute buffers" errors (LM Studio)
- Reducing to 32,768 is the recommended mitigation

**Quality at long context:**
- At 200K+ tokens (via API), average response time exceeds 420 seconds
- Pre-chunking repos and streaming diffs reduces this to ~70 seconds
- No specific "lost in the middle" testing data found for Qwen3-Coder specifically, but this is a general LLM limitation with RoPE-based models

**Semantic drift in multi-turn:**
- Multiple user reports of the model losing context after 3-5 turns in agentic mode
- Most severe with local models; the hosted API version is more consistent

---

## 9. Hallucination Patterns and Known Failure Modes

### Code Hallucinations
- **Phantom library imports**: References Python libraries that don't exist or are not in scope
- **False execution success**: Generates code with syntax errors (e.g., typo "const_1351409" instead of "const_13591409"), shell command fails, model proceeds as if it succeeded
- **Algorithm misidentification**: Claims to implement algorithm X while actually implementing Y

### Knowledge Hallucinations
- GitHub issue #1442 (Qwen3 series): "Frequent hallucinations on model name and knowledge cutoff date -- every new session gives different results and almost none contain correct information"
- Model does not reliably know its own training cutoff
- Qwen3 series may have "scrambled weights" from overtraining on coding/math tasks, per a community hypothesis in the HuggingFace Qwen3-235B discussions

### Tool Call Hallucinations
- With Ollama native tool calling, model hallucinates wrong tool names even when the reasoning text correctly identifies the right one
- Tool arguments passed as wrong types (string when array expected)

### Multi-turn Semantic Drift
- Context degrades in multi-turn sessions; model "silently forgets" earlier context
- Described as a systematic issue with the architecture, not a random bug

---

## 10. Cost and Practical Positioning

| Model | Pricing (input/output per 1M tokens) | Context | Active Params |
|---|---|---|---|
| Qwen3-Coder-480B (API) | ~$0.22 / $0.88 | 256K | 35B |
| Qwen3-Coder-Next | Open-weight, self-host | 256K | ~3B |
| Qwen3.5-397B | TBD (Feb 2026 release) | 262K | 17B |
| Claude Sonnet 4 | ~$3 / $15 | 200K | -- |
| Claude Opus 4.6 | ~$15 / $75 | 200K | -- |

Cost advantage is real: Qwen3-Coder-480B via API is approximately 13-15x cheaper than Claude Sonnet 4.

---

## 11. Summary Verdict

**Where Qwen3-Coder beats or matches Claude:**
- SWE-bench Verified (within 1-2% of Sonnet 4 with 480B; ahead with Qwen3-Coder-Next on same benchmark)
- WebArena browser automation (49.9 vs 47.4 for Sonnet 4)
- SecCodeBench secure coding (61.2% vs ~52.5% for Opus 4.5)
- Open-weight, Apache 2.0, self-hostable -- no vendor lock-in
- Price: 13-15x cheaper than Sonnet 4 via API

**Where Claude consistently beats Qwen:**
- Advanced TypeScript type narrowing: Claude 8/10, Qwen 1/10 (and so does every other open model)
- Terminal-based agentic tasks: Opus 4.6 at 65.4% vs Qwen3-Coder-Next at 36.2%
- Complex multi-tool orchestration (MCP-style tool use)
- Instruction following precision (output diff vs full file)
- Reliability: algorithm correctness, noticing execution failures, multi-turn coherence
- UI/visualization generation quality
- Overall coding reliability across diverse tasks (InfoWorld: "Claude Sonnet 4 is more capable and reliable for most coding use cases")

**For this project's stack specifically (TypeScript + ESM + React 19 + Tauri):**
- Standard React/TypeScript: Qwen3-Coder is capable
- Advanced TypeScript patterns (discriminated unions, complex narrowing): documented failure
- Agentic workflows over large codebases: tool calling reliability is a real concern with local models
- The 480B hosted API is more reliable than running 30B locally for agentic use

---

## Sources

- [Qwen3-Coder Official Blog](https://qwenlm.github.io/blog/qwen3-coder/)
- [Together AI: Qwen3-Coder Benchmarks](https://www.together.ai/blog/qwen-3-coder)
- [Nebius: OpenHands + Qwen3-Coder 480B Trajectories](https://nebius.com/blog/posts/openhands-trajectories-with-qwen3-coder-480b)
- [16x.engineer: Qwen3-Coder Evaluation vs Claude Sonnet 4](https://eval.16x.engineer/blog/qwen3-coder-evaluation-results)
- [InfoWorld: Qwen Code is good but not great](https://www.infoworld.com/article/4054914/qwen-code-is-good-but-not-great.html)
- [BinaryVerseAI: Deep Dive Review with Real-World Tests](https://binaryverseai.com/qwen3-coder-review/)
- [Aider: Qwen3 Polyglot Benchmark Results](https://aider.chat/2025/05/08/qwen3.html)
- [marc0.dev: Best AI for Coding 2026 SWE-Bench Breakdown](https://www.marc0.dev/en/blog/best-ai-for-coding-2026-swe-bench-breakdown-opus-4-6-qwen3-coder-next-gpt-5-3-and-what-actually-matters-1770387434111)
- [Qwen3-Coder GitHub: Unreliable Function Calling Issue #475](https://github.com/QwenLM/Qwen3-Coder/issues/475)
- [Qwen3-Coder GitHub: Tool calls fail with many tools (Goose #6883)](https://github.com/block/goose/issues/6883)
- [Qwen3-Coder GitHub: Hallucination Issue #420](https://github.com/QwenLM/Qwen3-Coder/issues/420)
- [qwen-code GitHub: Context limits not respected #371](https://github.com/QwenLM/qwen-code/issues/371)
- [qwen-code GitHub: Buggy contextWindowSize #1924](https://github.com/QwenLM/qwen-code/issues/1924)
- [Qwen3.5 Benchmarks Guide](https://www.digitalapplied.com/blog/qwen-3-5-agentic-ai-benchmarks-guide)
- [Analytics Vidhya: Qwen3.5 Hands-On Tests](https://www.analyticsvidhya.com/blog/2026/02/qwen3-5-open-weight-qwen3-5-plus/)
- [Qwen3-Coder-Next VentureBeat](https://venturebeat.com/technology/qwen3-coder-next-offers-vibe-coders-a-powerful-open-source-ultra-sparse)
- [Qwen2.5-Coder Family Blog](https://qwenlm.github.io/blog/qwen2.5-coder-family/)
- [HuggingFace: Qwen3-235B Knowledge Regression Discussion](https://huggingface.co/Qwen/Qwen3-235B-A22B/discussions/16)
- [Qwen3 Frequent Hallucinations GitHub Issue #1442](https://github.com/QwenLM/Qwen3/issues/1442)
