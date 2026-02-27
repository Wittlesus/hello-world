# Qwen Model Research: Qwen3, Qwen3-Coder, and Qwen3.5

Researched: 2026-02-26
Sources: Official Qwen blog, HuggingFace model cards, GitHub repos, arXiv technical report (2505.09388)

---

## 1. MODEL VARIANTS

### Qwen3 (Released May 2025)

**Dense models (6 variants):**

| Model | Params | Context |
|---|---|---|
| Qwen3-0.6B | 0.6B | 32K |
| Qwen3-1.7B | 1.7B | 32K |
| Qwen3-4B | 4B | 32K |
| Qwen3-8B | 8B | 128K |
| Qwen3-14B | 14B | 128K |
| Qwen3-32B | 32B | 128K |

**MoE models (2 variants):**

| Model | Total Params | Active Params | Context |
|---|---|---|---|
| Qwen3-30B-A3B | 30.5B | 3.3B | 32K native / 128K via YaRN |
| Qwen3-235B-A22B | 235B | 22B | 32K native / 128K via YaRN |

MoE architecture details (both Qwen3 MoE models): 128 total experts, 8 activated per token, no shared experts (unlike Qwen2.5-MoE).

All 8 variants are open-weight (weights on HuggingFace).

---

### Qwen3-Coder (Released ~July 2025)

All are MoE architecture, all open-weight.

| Model | Total Params | Active Params | Context |
|---|---|---|---|
| Qwen3-Coder-30B-A3B-Instruct | 30.5B | 3.3B | 256K native / 1M via YaRN |
| Qwen3-Coder-480B-A35B-Instruct | 480B | 35B | 256K native / 1M via YaRN |
| Qwen3-Coder-Next (Instruct) | 80B | 3B | 256K native |
| Qwen3-Coder-Next-Base | 80B | 3B | 256K native |

**Qwen3-Coder-Next architecture** is notably different -- uses hybrid attention:
- 48 layers
- Hybrid layout: 12 blocks of (3x Gated DeltaNet -> MoE) + (1x Gated Attention -> MoE)
- 512 total experts, 10 routed + 1 shared activated per token
- Hidden dim: 2048
- This is built on Qwen3-Next-80B-A3B-Base

**Qwen3-Coder-480B-A35B-Instruct architecture:**
- 62 layers
- 96 Q heads, 8 KV heads
- 160 total experts, 8 activated per token

**Qwen3-Coder-30B-A3B-Instruct architecture:**
- 48 layers
- 32 Q heads, 4 KV heads (GQA)
- 128 total experts, 8 activated per token

Also available in FP8 and GGUF quantized forms.

---

### Qwen3.5 (Released February 2026)

All are MoE + Hybrid architecture (Gated DeltaNet + sparse MoE), all open-weight. These models have NATIVE multimodal support (vision encoder built in to the base model -- not a separate VL variant).

| Model | Total Params | Active Params | Context | Released |
|---|---|---|---|---|
| Qwen3.5-397B-A17B | 397B | 17B | 256K native / 1M via YaRN | Feb 16, 2026 |
| Qwen3.5-122B-A10B | 122B | 10B | 256K native / 1M via YaRN | Feb 24, 2026 |
| Qwen3.5-35B-A3B | 35B | 3B | 256K native / 1M via YaRN | Feb 24, 2026 |
| Qwen3.5-27B | 27B | N/A (dense hybrid) | 256K native / 1M via YaRN | Feb 24, 2026 |

**Qwen3.5-397B-A17B architecture:**
- 60 layers
- 15 blocks of: 3x (Gated DeltaNet -> MoE) + 1x (Gated Attention -> MoE)
- 512 total experts, 10 routed + 1 shared activated per token
- 32 Q heads, 2 KV heads for Gated Attention
- 64 V-heads, 16 QK-heads for Gated DeltaNet

**Qwen3.5-35B-A3B architecture:**
- 40 layers
- 10 blocks of same hybrid pattern
- 256 total experts, 8 routed + 1 shared activated per token
- Hidden dim: 2048

**Qwen3.5-27B architecture:**
- 64 layers
- 16 blocks of: 3x (Gated DeltaNet -> FFN) + 1x (Gated Attention -> FFN)
- No MoE -- uses standard FFN
- Intermediate dim: 17,408
- Context: 256K native / 1,010,000 via YaRN

Note: "Qwen3.5-Flash" is a hosted API product corresponding to Qwen3.5-35B-A3B with 1M context by default and built-in tools -- not a separate open-weight model.

---

### Separate Specialized Families (Related but Distinct)

- **Qwen3-VL**: Vision-language variants (separate from base Qwen3). Qwen3-VL-8B, Qwen3-VL-72B. Have dedicated vision encoder.
- **Qwen3-Omni**: Full multimodal (text + image + audio + video). Separate product line.
- **Qwen3-VL-Embedding-2B**: Embedding model for multimodal retrieval.

Qwen3.5 appears to SUBSUME the VL distinction -- base models include vision encoder natively.

---

## 2. CONTEXT WINDOWS

| Model Family | Native | Extended (YaRN) |
|---|---|---|
| Qwen3 dense (0.6B-4B) | 32K | 128K |
| Qwen3 dense (8B-32B) | 128K | -- |
| Qwen3 MoE (30B, 235B) | 32K | 128K |
| Qwen3-Coder (30B, 480B) | 256K (262,144) | 1M |
| Qwen3-Coder-Next (80B) | 256K (262,144) | not documented |
| Qwen3.5 (all variants) | 256K (262,144) | ~1M (1,010,000) |

YaRN = "Yet another RoPE N" -- a scaling method for extending beyond native context. Performance degrades at extremes.

---

## 3. TOOL CALLING / FUNCTION CALLING

**Short answer: Yes, all Qwen3/Qwen3-Coder/Qwen3.5 instruct models support OpenAI-compatible tool calling.**

### Format

The format is OpenAI tools specification with JSON Schema:

```json
tools=[
  {
    "type": "function",
    "function": {
      "name": "function_name",
      "description": "what it does",
      "parameters": {
        "type": "object",
        "required": ["param_name"],
        "properties": {
          "param_name": {
            "type": "string",
            "description": "description"
          }
        }
      }
    }
  }
]
```

### Deployment Notes

- Qwen3-Coder specifically uses updated tool parser: `--tool-call-parser qwen3_coder` in SGLang/vLLM
- Qwen3.5 uses `--tool-call-parser qwen3_coder` for standard deployments
- Full OpenAI API compatibility via vLLM (`/v1/chat/completions` endpoint)
- MCP (Model Context Protocol) integration supported via Qwen-Agent framework
- Qwen-Agent library provides canonical wrapper for tool-calling templates and parsers

### Qwen3-Coder-Specific Tool Notes

- Qwen3-Coder was fine-tuned with agentic RL across thousands of tool-use environments
- Supports 358 coding languages explicitly
- FIM (Fill-in-the-Middle) is documented but not explicitly confirmed in the instruct variants' model cards for 480B and 30B (it is confirmed for Qwen2.5-Coder series)

---

## 4. KNOWLEDGE CUTOFF

**Not officially disclosed for any variant.**

What is known:
- Qwen3 technical report published May 14, 2025 (arXiv:2505.09388). Training data was assembled before this.
- Community reports (GitHub Discussion #1093) show the models respond inconsistently: some say Oct 2023, some say Dec 2024, some say March 2025.
- One model card (Qwen3-30B-A3B via simtheory.ai) claims March 2025 cutoff.
- Qwen3.5 released February 2026 -- cutoff is likely late 2025 but unconfirmed.
- Qwen3-Coder released after Qwen3 base -- similar or later cutoff assumed.

**Official position**: Qwen team has not published a specific cutoff date. Treat any model-stated date as unreliable.

---

## 5. TRAINING DATA COMPOSITION

### Qwen3 Base Models

- **Total tokens**: ~36 trillion (approx. 2x Qwen2.5's 18T)
- **Languages**: 119 languages and dialects (up from 29 in Qwen2.5)
- **Sources**: Web content, PDF documents (extracted via Qwen2.5-VL), synthetic data
- **Synthetic data generation**: Qwen2.5-Math for math content, Qwen2.5-Coder for code content
- **Formats synthesized**: Textbooks, Q&A pairs, instructions, code snippets

**Three-stage pretraining:**
1. Stage 1: ~30T tokens -- general knowledge foundation (general web, books, code, multilingual)
2. Stage 2: Knowledge-intensive data -- STEM, coding, reasoning (increased density of technical content)
3. Stage 3: Long-context data -- extends context from 4K to 32K tokens

### Qwen3-Coder

- **Total tokens**: 7.5 trillion
- **Code ratio**: 70% code, 30% general + math (to preserve non-code abilities)
- **Code languages**: "358 coding languages" explicitly cited
- **Post-training**: Agentic RL with large-scale executable task synthesis and environment interaction
- **Data quality**: Noisy code data was cleaned and rewritten using Qwen2.5-Coder

### Qwen3.5

- **Total tokens**: "Trillions of multimodal tokens" -- no specific number disclosed
- **Modalities**: Text, image, video (native multimodal from pretraining)
- **Languages**: 201 languages and dialects (expanded from 119 in Qwen3)
- Specific breakdown not publicly disclosed

---

## 6. MULTIMODAL CAPABILITIES

### Qwen3 (Base text models) -- NO vision

Qwen3-0.6B through Qwen3-235B-A22B: text-only. No image or file understanding.

### Qwen3-VL (Separate VL family)

- Qwen3-VL-8B and Qwen3-VL-72B: image + video + document understanding
- Qwen3-VL-8B-Thinking: thinking-enabled VL variant
- Supports 256K interleaved context (text + images + video)
- Capabilities: OCR (32 languages), spatial reasoning, GUI agent (can operate computer/mobile interfaces), video understanding

### Qwen3-Coder -- NO vision

All Qwen3-Coder variants (30B, 480B, Next): text and code only, no image input.

### Qwen3.5 -- YES, native vision built in

This is the key differentiator of Qwen3.5 vs Qwen3:

- ALL Qwen3.5 models include a vision encoder natively (not a separate VL variant)
- Supports image understanding, video understanding, document/OCR
- Qwen3.5-397B-A17B model card explicitly shows image and video input examples
- Qwen3.5-27B scores 82.3 on MMMU (multimodal benchmark)
- Context window supports interleaved text + image + video up to 256K tokens

**File understanding**: Qwen3.5 handles PDFs and documents via vision encoder (treats as images). No native "file upload" tool -- images/video are passed inline in the message content.

---

## 7. THINKING / REASONING MODE

### Qwen3 (All dense and MoE instruct variants)

**Hybrid thinking: YES -- unique approach, most flexible implementation seen**

- Single model operates in both thinking and non-thinking mode
- **Thinking mode on**: model generates `<think>...</think>` chain-of-thought before final answer
- **Thinking mode off**: rapid response with no CoT overhead
- Toggle per-turn with `/think` and `/no_think` in prompts, or system message
- Programmatic: `enable_thinking=True/False` in `tokenizer.apply_chat_template`
- Budget control: adjustable compute budget for thinking depth
- Trained via 4-stage pipeline: long CoT cold start -> reasoning RL -> thinking mode fusion -> general RL

**Qwen3-2507 variants** (e.g., Qwen3-235B-A22B-Thinking-2507): thinking always on by default, optimized for multi-stage reasoning.

### Qwen3-Coder

**Thinking mode: DISABLED on all Qwen3-Coder instruct variants**

- Qwen3-Coder-480B-A35B-Instruct: explicitly "does NOT support thinking mode"
- Qwen3-Coder-30B-A3B-Instruct: "does NOT support thinking mode"
- Qwen3-Coder-Next: "does NOT support thinking mode"
- None generate `<think></think>` blocks
- `enable_thinking=False` specification is no longer needed (it's the default and only mode)

Rationale: agentic coding tasks benefit from fast, direct responses without CoT overhead. Thinking was sacrificed for latency and tool-use reliability.

### Qwen3.5

**Thinking mode: ON by default, can be disabled**

- All Qwen3.5 instruct variants default to thinking mode
- Generates `<think>...</think>` before final answer
- Disable via `chat_template_kwargs: {"enable_thinking": False}` in API call
- Qwen3.5-27B: same behavior confirmed in model card

---

## 8. LICENSE TERMS

**All models in scope: Apache 2.0**

Confirmed:
- Qwen3 (all sizes, dense and MoE): Apache 2.0
- Qwen3-Coder (30B, 480B, Next): Apache 2.0
- Qwen3.5 (all sizes): Apache 2.0

**What Apache 2.0 means:**
- Free for commercial use: YES, no MAU limits, no royalties
- Modification allowed: YES
- Distribution allowed: YES with attribution
- Patent grant: YES
- No field-of-use restrictions

**Historical context** (not applicable to current models but worth noting): Earlier Qwen models (Qwen 1.x, Qwen2 large sizes) used custom "Qwen License" with a 100M MAU cap for commercial use, and some small models used Qwen Research License (no commercial). Those restrictions were DROPPED starting with Qwen2.5 for most sizes, and Qwen3+ uses clean Apache 2.0 across the board.

**Qwen3-VL and Qwen3-Omni**: Also Apache 2.0 (confirmed on GitHub repos).

---

## SUMMARY TABLE

| Property | Qwen3 (dense) | Qwen3 (MoE) | Qwen3-Coder | Qwen3.5 |
|---|---|---|---|---|
| Sizes | 0.6B to 32B | 30B, 235B | 30B, 80B, 480B | 27B, 35B, 122B, 397B |
| Active params | N/A | 3B, 22B | 3B, 3B, 35B | 3B, 3B, 10B, 17B |
| Context (native) | 32K or 128K | 32K | 256K | 256K |
| Context (extended) | 128K | 128K | 1M | 1M |
| Open-weight | YES | YES | YES | YES |
| License | Apache 2.0 | Apache 2.0 | Apache 2.0 | Apache 2.0 |
| Tool calling | YES | YES | YES | YES |
| OAI-compatible | YES | YES | YES | YES |
| Thinking mode | Hybrid on/off | Hybrid on/off | NO | On by default |
| Vision/multimodal | NO | NO | NO | YES (native) |
| Knowledge cutoff | Undisclosed | Undisclosed | Undisclosed | Undisclosed |
| Training tokens | 36T | 36T | 7.5T | Undisclosed |
| Languages | 119 | 119 | 119+ | 201 |

---

## KEY SOURCES

- Qwen3 official blog: https://qwenlm.github.io/blog/qwen3/
- Qwen3 technical report: https://arxiv.org/abs/2505.09388
- Qwen3-Coder official blog: https://qwenlm.github.io/blog/qwen3-coder/
- Qwen3-Coder GitHub: https://github.com/QwenLM/Qwen3-Coder
- HuggingFace Qwen3-Coder-480B: https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct
- HuggingFace Qwen3-Coder-30B: https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct
- HuggingFace Qwen3-Coder-Next: https://huggingface.co/Qwen/Qwen3-Coder-Next
- HuggingFace Qwen3.5-397B: https://huggingface.co/Qwen/Qwen3.5-397B-A17B
- HuggingFace Qwen3.5-35B: https://huggingface.co/Qwen/Qwen3.5-35B-A3B
- HuggingFace Qwen3.5-27B: https://huggingface.co/Qwen/Qwen3.5-27B
- Qwen3 GitHub: https://github.com/QwenLM/Qwen3
- Qwen3.5 GitHub: https://github.com/QwenLM/Qwen3.5
- Knowledge cutoff discussion: https://github.com/QwenLM/Qwen3/discussions/1093
- Function calling docs: https://qwen.readthedocs.io/en/latest/framework/function_call.html
