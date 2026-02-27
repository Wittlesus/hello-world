# Qwen 3.5 & Qwen3-Coder: API Access and Pricing Research
**Researched:** 2026-02-26

---

## Model Landscape (Feb 2026)

### Qwen3.5 Series (Released Feb 2026)
| Model | Params (Total / Active) | Architecture | Context |
|-------|------------------------|--------------|---------|
| Qwen3.5-Flash | ~unknown | Hybrid attention (GDN + full) | 1M hosted / 256K open |
| Qwen3.5-27B | 27B / 27B | Dense, hybrid attention | 256K |
| Qwen3.5-35B-A3B | 35B / 3B | MoE | 256K |
| Qwen3.5-122B-A10B | 122B / 10B | MoE | 256K |
| Qwen3.5-397B-A17B | 397B / 17B | MoE, flagship open-weight | 256K open / 1M hosted |
| Qwen3.5-Plus | ~397B hosted | Hosted API only | 1M |

Key: Released Feb 16 (397B flagship) + Feb 24 (medium series). Native multimodal (text, image, video). 201 languages.

### Qwen3-Coder Series (Released Jul 2025)
| Model | Params (Total / Active) | Context |
|-------|------------------------|---------|
| Qwen3-Coder-30B-A3B | 30B / 3.3B | 256K |
| Qwen3-Coder-480B-A35B | 480B / 35B | 256K / 1M via extrapolation |
| Qwen3-Coder-Next (80B-A3B) | 80B / 3B | 256K |

Qwen3-Coder-Next is the Feb 2026 refresh of the coder line. All support thinking and non-thinking modes.

---

## 1. API PROVIDERS

### 1A. Groq
**Models available:** Qwen3-32B only (as of Feb 2026)
- No Qwen3.5 or Qwen3-Coder models listed yet
- Preview status: "intended for evaluation only, not for production"

| Model | Input $/M | Output $/M | Context |
|-------|-----------|-----------|---------|
| Qwen3-32B | $0.29 | $0.59 | 131K |

**Rate limits:**
- Free tier: 60 RPM / 6K TPM / 500K TPD
- Developer plan: 1,000 RPM / 300K TPM (higher available on request)
- Batch: 50% cost reduction, async, 24h-7d window

**OpenAI compatible:** Yes (full compatibility)
**Tool calling:** Yes
**Streaming:** Yes

**Speed note:** Qwen3-32B runs at ~662 tokens/second on Groq's LPU hardware -- significantly faster than GPU-based providers.

**Verdict:** Limited model selection, but Qwen3-32B at $0.29/$0.59 is the cheapest mid-tier reasoning model with extreme speed.

---

### 1B. Together AI
**Models available:** Qwen3 and Qwen3.5 series

| Model | Input $/M | Output $/M | Notes |
|-------|-----------|-----------|-------|
| Qwen3-235B-A22B-Instruct-2507 | $0.20 | $0.60 | |
| Qwen3-235B-A22B-Thinking-2507 | $0.65 | $3.00 | |
| Qwen3-Next-80B-A3B-Instruct | $0.15 | $1.50 | |
| Qwen3-Coder-480B-A35B-Instruct | $2.00 | $2.00 | Flat rate |
| Qwen3-Coder-Next | $0.50 | $1.20 | |
| Qwen3.5-397B-A17B | $0.60 | $3.60 | |

**OpenAI compatible:** Yes (full drop-in replacement)
**Tool calling:** Yes (parallel tool calls supported)
**Streaming:** Yes (stream=True parameter)

**Batch:** Async batch jobs available at reduced rates (check docs for current discount).
**Rate limits:** Not published publicly; scales with account tier.

---

### 1C. Alibaba Cloud / DashScope (Official)
This is the authoritative source. All prices below are international (non-mainland China) USD rates.

#### Qwen3 Series (DashScope)
| Model | Mode | Input $/M | Output $/M |
|-------|------|-----------|-----------|
| qwen3-235b-a22b | Both | $0.70 | $2.80 (non-thinking) / $8.40 (thinking) |
| qwen3-235b-a22b-thinking-2507 | Thinking | $0.23 | $2.30 |
| qwen3-235b-a22b-instruct-2507 | Non-thinking | $0.23 | $0.92 |
| qwen3-32b | Both | $0.16 | $0.64 (non-thinking) / $0.64 (thinking) |
| qwen3-30b-a3b | Both | $0.20 | $0.80 (non-thinking) / $2.40 (thinking) |
| qwen3-30b-a3b-thinking-2507 | Thinking | $0.20 | $2.40 |
| qwen3-30b-a3b-instruct-2507 | Non-thinking | $0.20 | $0.80 |
| qwen3-14b | Both | $0.35 | $1.40 (non-thinking) / $4.20 (thinking) |
| qwen3-8b | Both | $0.18 | $0.70 (non-thinking) / $2.10 (thinking) |
| qwen3-next-80b-a3b-thinking | Thinking | $0.15 | $1.20 |
| qwen3-next-80b-a3b-instruct | Non-thinking | $0.15 | $1.20 |

#### Qwen3.5 Series (DashScope)
| Model | Input $/M | Output $/M | Context |
|-------|-----------|-----------|---------|
| qwen3.5-plus-2026-02-15 (= Qwen3.5-Plus) | $0.40 | $2.40 | 1M |
| qwen3.5-plus-2026-02-15 (long context >256K) | $0.50 | $3.00 | up to 1M |
| qwen3.5-397b-a17b | $0.60 | $3.60 | 256K |
| qwen3.5-122b-a10b | $0.40 | $3.20 | 256K |
| qwen3.5-27b | $0.30 | $2.40 | 256K |
| qwen3.5-35b-a3b | $0.25 | $2.00 | 256K |
| qwen3.5-flash | $0.10 | $0.40 | 1M hosted |

**Tiered context pricing note:** For qwen3-max and premium models, 0-32K tokens is base rate; 32K-128K is 2x input; 128K-252K is ~2.5x input. Check individual model docs.

**Batch pricing:** 50% discount on both input and output for all batch-eligible models.

**Free quota:** New accounts get 1M free tokens, valid 90 days.

**OpenAI compatible:** Yes. Change only `base_url`, `api_key`, and `model` name. Uses `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/`.
**Tool calling:** Yes (parallel tool calls, structured outputs)
**Streaming:** Yes

---

### 1D. OpenRouter
OpenRouter aggregates multiple providers. Prices shown are OpenRouter's routing price (may be slightly above provider direct).

| Model | Input $/M | Output $/M | Context | Provider |
|-------|-----------|-----------|---------|----------|
| Qwen3.5-Plus (2026-02-15) | $0.40 | $2.40 | 1M | Alibaba Cloud |
| Qwen3.5-Plus long (>256K) | $0.50 | $3.00 | 1M | Alibaba Cloud |
| Qwen3-Max | $1.20 | $6.00 | 262K | Alibaba Cloud |
| Qwen3-Max-Thinking | $0.55 | $3.50 | 262K | Alibaba Cloud |
| Qwen3-Coder-480B (exacto) | $0.22 | $1.00 | 262K | DeepInfra (Turbo) |
| Qwen3-Coder-480B (best price) | $0.22 | $1.80 | 262K | Google |
| Qwen3-Coder-Next | $1.20 | $6.00 | 262K | Multiple |
| Qwen3-Coder-Next (via Chutes) | $0.12 | $0.75 | 262K | Chutes |
| Qwen3-Coder-Next cache read | $0.06 | -- | -- | Chutes |
| Qwen3-Coder-Plus | $1.00 | $5.00 | 1M | Alibaba |
| Qwen3-Coder-Flash | $0.30 | $1.50 | 1M | Alibaba |

**66 Qwen models total available on OpenRouter** (as of Feb 2026). Free tier available for some models.

**OpenAI compatible:** Yes (OpenRouter uses OpenAI SDK format)
**Tool calling:** Yes (most models)
**Streaming:** Yes

**Rate limits:** Set per provider routed to; OpenRouter itself adds minimal overhead.

---

### 1E. DeepInfra
Specializes in cheap GPU inference. Tends to have among the lowest prices for open-weight models.

| Model | Input $/M | Cache Input $/M | Output $/M | Context |
|-------|-----------|-----------------|-----------|---------|
| Qwen3-Next-80B-A3B-Instruct | $0.09 | -- | $1.10 | 256K |
| Qwen3-Coder-480B-A35B-Instruct-Turbo | $0.22 | $0.022 (10x cheaper) | $1.00 | 256K |
| Qwen3-Coder-480B-A35B-Instruct | $0.40 | -- | $1.60 | 256K |
| Qwen3-235B-A22B-Thinking-2507 | $0.23 | $0.20 | $2.30 | 256K |
| Qwen3-235B-A22B-Instruct-2507 | $0.071 | -- | $0.10 | 256K |
| Qwen3-32B | $0.08 | -- | $0.28 | 40K |

**Note:** DeepInfra routes Qwen3-Coder-480B Turbo through OpenRouter at $0.22/$1.00 -- this is the same DeepInfra endpoint OpenRouter uses for that model.

**OpenAI compatible:** Yes
**Tool calling:** Yes
**Streaming:** Yes
**Rate limits:** Not publicly published; pay-as-you-go with no stated caps.

---

### 1F. Fireworks AI

| Model | Input $/M | Output $/M | Context |
|-------|-----------|-----------|---------|
| Qwen3-235B-A22B | $0.45 | $1.80 | 262K |
| Qwen3-235B-A22B-Thinking-2507 | (similar tier) | (similar tier) | 262K |
| Qwen3-VL-30B-A3B | $0.15 | $0.60 | -- |

**Batch:** 50% off serverless pricing
**Cache:** 50% off cached input tokens
**OpenAI compatible:** Yes
**Tool calling:** Yes
**Streaming:** Yes
**Rate limits:** "High rate limits" -- exact figures in account console.

---

### 1G. Other Notable Providers

**Qwen3-Coder-480B multi-provider comparison (via OpenRouter/pricepertoken):**

| Provider | Input $/M | Output $/M | Uptime |
|----------|-----------|-----------|--------|
| Google (via OR) | $0.22 | $1.80 | -- |
| SiliconFlow | $0.25 | $1.00 | -- |
| Novita | $0.30 | $1.30 | 99.7% |
| DeepInfra | $0.40 | $1.60 | 99.5% |
| Nebius | $0.40 | $1.80 | 100% |
| Fireworks | $0.90 | $0.90 | -- |
| Together AI | $2.00 | $2.00 | -- |

**SiliconFlow:** Chinese domestic provider, competitive rates, primarily for China-based deployments.
**Novita:** Budget-focused GPU cloud, OpenAI-compatible.
**Nebius:** European cloud, strong uptime.
**Atlas Cloud:** Offers Qwen3-Coder from $0.78/1M with caching.

---

## 2. LOCAL OPTIONS

### 2A. Ollama
Ollama packages models as single-command installs with automatic GGUF quantization.

**Qwen3-Coder (Ollama library):**
| Tag | Size on Disk | Params | Context |
|-----|-------------|--------|---------|
| qwen3-coder:30b (latest) | 19 GB | 30B total / 3.3B active | 256K |
| qwen3-coder:480b | 290 GB | 480B total / 35B active | 256K |
| qwen3-coder:480b-cloud | N/A | Cloud-hosted | 256K |

Local 480B requires 250GB+ unified memory. The 30B version runs on 24GB VRAM systems.

**Qwen3.5 (Ollama library):**
| Tag | Size on Disk | Context |
|-----|-------------|---------|
| qwen3.5:27b | 17 GB | 256K |
| qwen3.5:35b | 24 GB | 256K |
| qwen3.5:122b | 81 GB | 256K |
| qwen3.5:cloud | N/A (hosted) | 256K |
| qwen3.5:397b-cloud | N/A (hosted) | 256K |

**Install command:** `ollama pull qwen3.5:27b` (or whichever tag)
**API:** Ollama runs a local OpenAI-compatible REST API at `http://localhost:11434`
**Tool calling:** Yes (supported in Ollama's API layer)
**Streaming:** Yes

---

### 2B. VRAM Requirements by Model and Quantization

#### Qwen3.5 VRAM Requirements (Unsloth estimates)
| Model | 3-bit | 4-bit | 6-bit | 8-bit | BF16 |
|-------|-------|-------|-------|-------|------|
| 27B | 14 GB | 17 GB | 24 GB | 30 GB | 54 GB |
| 35B-A3B | 17 GB | 22 GB | 30 GB | 38 GB | 70 GB |
| 122B-A10B | 60 GB | 70 GB | 106 GB | 132 GB | 245 GB |
| 397B-A17B | 180 GB | 214 GB | 340 GB | 512 GB | 810 GB |

**Practical GPU targets:**
- RTX 4090 (24 GB): Qwen3.5-27B at Q4_K_M fits comfortably
- RTX 4090 + system RAM offload: Qwen3.5-35B-A3B at Q4
- 2x RTX 4090 (48 GB): Qwen3.5-122B-A10B at 3-bit (needs 60 GB, borderline)
- Mac M3 Ultra (192 GB unified): Qwen3.5-397B at 3-bit
- Mac M3 Ultra (256 GB unified): Qwen3.5-397B at 4-bit dynamic (214 GB with Unsloth UD-Q4_K_XL)

**Qwen3-Coder-480B local:**
- Minimum 250 GB memory/VRAM total
- 4-bit quant: ~45 GB+ combined RAM/VRAM
- 2-bit quant: ~30 GB combined (reduced quality)

---

### 2C. vLLM
vLLM is the production-grade GPU serving framework. Day-0 Qwen3.5 support confirmed.

**Verified hardware configurations:**
- 8x NVIDIA H200 (reference deployment for Qwen3.5-397B)
- 2x GB200 nodes (4 GPUs each) -- Blackwell
- AMD Instinct MI300X, MI325X, MI35X (ROCm + vLLM, Day-0 support from AMD)

**Launch command (example):**
```bash
vllm serve Qwen/Qwen3.5-397B-A17B \
  --tensor-parallel-size 8 \
  --max-model-len 32768
```

**OpenAI-compatible server:** Yes (vLLM exposes `/v1/chat/completions`)
**Tool calling:** Yes
**Streaming:** Yes

---

### 2D. llama.cpp
- Full GGUF support for all Qwen3.5 model sizes
- CPU+GPU hybrid inference (offload layers to GPU, rest to RAM)
- Ideal for single-machine deployments without datacenter GPU budgets
- Community GGUF files available on Hugging Face (Unsloth, bartowski, etc.)

**Key quantization formats available:**
- Q4_K_M: Best balance of quality/size (default recommendation)
- Q4_K_XL: Unsloth Dynamic 4-bit (important layers at higher precision)
- Q2_K_XL: Dynamic 2-bit (smallest, reasonable quality for MoE)
- Q8_0: Near-lossless, 2x smaller than BF16
- IQ2_M: Aggressive compression for very limited RAM

**Example:**
```bash
./llama-cli -m Qwen3.5-27B-Q4_K_M.gguf \
  --ctx-size 32768 \
  -ngl 99  # offload all layers to GPU
```

---

## 3. COST COMPARISON

### Claude Sonnet 4.6 Pricing (Reference)
| Tier | Input $/M | Output $/M |
|------|-----------|-----------|
| Standard | $3.00 | $15.00 |
| Batch (50% off) | $1.50 | $7.50 |
| Cache write (5 min) | $3.75 | -- |
| Cache write (1 hr) | $6.00 | -- |
| Cache read | $0.30 | -- |
| Long context >200K | $6.00 | $22.50 |

### Task 1: Research Query (10K input + 2K output)

| Provider / Model | Input Cost | Output Cost | Total |
|-----------------|-----------|-----------|-------|
| **Claude Sonnet 4.6** | $0.030 | $0.030 | **$0.060** |
| Claude Sonnet 4.6 (cached read) | $0.003 | $0.030 | **$0.033** |
| Qwen3.5-Flash (DashScope) | $0.001 | $0.0008 | **$0.0018** |
| Qwen3.5-27B (DashScope) | $0.003 | $0.0048 | **$0.0078** |
| Qwen3.5-Plus (DashScope) | $0.004 | $0.0048 | **$0.0088** |
| Qwen3.5-397B (DashScope) | $0.006 | $0.0072 | **$0.0132** |
| Qwen3-32B (Groq) | $0.0029 | $0.0012 | **$0.0041** |
| Qwen3-235B Instruct (DeepInfra) | $0.00071 | $0.0002 | **$0.00091** |
| Qwen3-Coder-480B Turbo (DeepInfra) | $0.0022 | $0.002 | **$0.0042** |

### Task 2: Code Generation (20K input + 5K output)

| Provider / Model | Input Cost | Output Cost | Total |
|-----------------|-----------|-----------|-------|
| **Claude Sonnet 4.6** | $0.060 | $0.075 | **$0.135** |
| Claude Sonnet 4.6 (batch) | $0.030 | $0.0375 | **$0.0675** |
| Qwen3.5-Flash (DashScope) | $0.002 | $0.002 | **$0.004** |
| Qwen3.5-27B (DashScope) | $0.006 | $0.012 | **$0.018** |
| Qwen3.5-35B-A3B (DashScope) | $0.005 | $0.010 | **$0.015** |
| Qwen3.5-Plus (DashScope) | $0.008 | $0.012 | **$0.020** |
| Qwen3.5-397B (DashScope) | $0.012 | $0.018 | **$0.030** |
| Qwen3-32B (Groq) | $0.0058 | $0.00295 | **$0.0088** |
| Qwen3-Coder-480B Turbo (DeepInfra) | $0.0044 | $0.005 | **$0.0094** |
| Qwen3-Coder-Next (Chutes/OR) | $0.0024 | $0.00375 | **$0.0062** |
| Together AI Qwen3-235B Instruct | $0.004 | $0.003 | **$0.007** |

### Key Cost Insight
**Qwen3.5-Flash is 33x cheaper than Claude Sonnet 4.6** on standard research tasks.
**Qwen3-235B-Instruct on DeepInfra is 66x cheaper** than Sonnet 4.6 for the same code task.
For tasks where Claude Sonnet 4.6 costs $1.00, Qwen3.5-Flash costs ~$0.030 and Qwen3-Coder-480B Turbo costs ~$0.070.

Local inference (self-hosted): Marginal cost per query approaches $0 once hardware is amortized.

---

## 4. API COMPATIBILITY MATRIX

| Provider | OpenAI Compatible | Tool Calling | Parallel Tools | Streaming | Structured Output | Vision |
|----------|------------------|--------------|----------------|-----------|-------------------|--------|
| Alibaba DashScope | Yes | Yes | Yes | Yes | Yes | Yes (Qwen3.5) |
| Groq | Yes | Yes | Yes | Yes | Yes | No (Qwen3-32B) |
| Together AI | Yes | Yes | Yes | Yes | Yes | Yes |
| OpenRouter | Yes | Yes | Yes | Yes | Yes | Model-dependent |
| DeepInfra | Yes | Yes | Unknown | Yes | Yes | Model-dependent |
| Fireworks | Yes | Yes | Yes | Yes | Yes | Yes (VL models) |
| Ollama (local) | Yes | Yes | Yes | Yes | Yes | Yes (Qwen3.5) |
| vLLM (local) | Yes | Yes | Yes | Yes | Yes | Yes |

**Base URL patterns:**
- DashScope: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
- Groq: `https://api.groq.com/openai/v1`
- Together AI: `https://api.together.xyz/v1`
- OpenRouter: `https://openrouter.ai/api/v1`
- DeepInfra: `https://api.deepinfra.com/v1/openai`
- Fireworks: `https://api.fireworks.ai/inference/v1`
- Ollama: `http://localhost:11434/v1`

All use standard `Authorization: Bearer <api_key>` header except Ollama (no auth by default).

---

## 5. RECOMMENDATIONS BY USE CASE

**Cheapest capable API for research/chat:** Qwen3-235B-Instruct on DeepInfra ($0.071/$0.10 per M) or Qwen3.5-Flash on DashScope ($0.10/$0.40 per M)

**Best coding model via API (quality):** Qwen3-Coder-480B Turbo on DeepInfra ($0.22/$1.00) or Qwen3-Coder-Next on Chutes/OpenRouter ($0.12/$0.75)

**Fastest inference (latency-sensitive):** Groq Qwen3-32B (~662 tokens/sec, $0.29/$0.59)

**Best local model for single RTX 4090:** Qwen3.5-27B Q4_K_M (17 GB, fits in 24 GB VRAM)

**Best local coding model with 48 GB VRAM:** Qwen3-Coder-30B via Ollama (19 GB on disk, active only 3.3B params)

**Best local flagship (Mac M3 Ultra 192 GB):** Qwen3.5-397B-A17B at 3-bit (180 GB)

**Lowest-risk drop-in for Claude Sonnet 4.6:** Any provider via OpenRouter (same OpenAI SDK, swap model string to `qwen/qwen3.5-plus-02-15`)

---

## Sources
- [Alibaba Cloud Model Studio Pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [OpenRouter Qwen3.5-Plus](https://openrouter.ai/qwen/qwen3.5-plus-02-15)
- [OpenRouter Qwen3-Coder](https://openrouter.ai/qwen/qwen3-coder)
- [OpenRouter Qwen3-Coder-Next](https://openrouter.ai/qwen/qwen3-coder-next)
- [OpenRouter Qwen3-Max](https://openrouter.ai/qwen/qwen3-max)
- [Groq Pricing](https://groq.com/pricing)
- [Groq Rate Limits](https://console.groq.com/docs/rate-limits)
- [Together AI Pricing](https://www.together.ai/pricing)
- [Together AI Qwen Models](https://www.together.ai/qwen)
- [DeepInfra Qwen Models](https://deepinfra.com/qwen)
- [Fireworks AI Pricing](https://fireworks.ai/pricing)
- [Ollama qwen3-coder library](https://ollama.com/library/qwen3-coder)
- [Ollama qwen3.5 library](https://ollama.com/library/qwen3.5)
- [Unsloth Qwen3.5 local guide](https://unsloth.ai/docs/models/qwen3.5)
- [vLLM Qwen3.5 recipes](https://docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html)
- [Anthropic pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- [VentureBeat: Sonnet 4.6 pricing](https://venturebeat.com/orchestration/anthropics-sonnet-4-6-matches-flagship-ai-performance-at-one-fifth-the-cost)
- [MarkTechPost: Qwen3.5 medium series](https://www.marktechpost.com/2026/02/24/alibaba-qwen-team-releases-qwen-3-5-medium-model-series-a-production-powerhouse-proving-that-smaller-ai-models-are-smarter/)
- [AMD Day-0 Qwen3.5 support](https://www.amd.com/en/developer/resources/technical-articles/2026/day-0-support-for-qwen-3-5-on-amd-instinct-gpus.html)
- [Qwen3.5 GitHub](https://github.com/QwenLM/Qwen3.5)
