---
description: "Scan the web for knowledge worth remembering -- AI news, coding trends, dependency updates. Stages candidates in knowledge-queue.json for review before storing."
---

# Knowledge Intake Scanner

You are running a knowledge intake scan. Your job is to find recent, useful information and stage it for review.

## Source Categories

Search across ALL of these categories (one WebSearch per category):

1. **Dependency updates**: Tauri, React, TypeScript, Anthropic SDK, Claude API changes
2. **AI news**: new models, agent frameworks, tool-use advances, MCP ecosystem
3. **Coding trends**: new libraries, frameworks, developer tools, paradigm shifts

## Process

### Step 1: Search (3 parallel WebSearches)

Run these searches in parallel:
- "Tauri OR React OR TypeScript OR Anthropic Claude SDK release update 2026"
- "AI agent framework MCP tool use new model release 2026"
- "developer tools new framework library trending 2026"

If the user provided a specific topic (e.g., `/scan rust async`), add a targeted search for that topic.

### Step 2: Evaluate Findings

For each interesting result, evaluate:
- **Relevance**: Does this matter for Hello World development, Claude's capabilities, or the AI/coding landscape?
- **Novelty**: Is this already in memory? Run `hw_retrieve_memories` with the topic to check.
- **Actionability**: Can this knowledge be used in future sessions?

Discard anything that fails 2+ of these checks.

### Step 3: Stage Candidates

Write candidates to `.hello-world/knowledge-queue.json`:

```json
{
  "scannedAt": "ISO timestamp",
  "candidates": [
    {
      "id": "kq_<8-char-random>",
      "title": "Short descriptive title",
      "category": "dependency | ai-news | coding-trend",
      "summary": "2-3 sentences of what this is and why it matters",
      "source": "URL or search result reference",
      "relevance": "high | medium",
      "suggestedMemoryType": "fact | architecture | decision",
      "status": "pending"
    }
  ]
}
```

**Max 5 candidates per scan.** Quality over quantity.

### Step 4: Present for Review

Show the candidates to Pat in a clean list:
- Title, category, 1-line summary
- Ask which to approve, reject, or edit

### Step 5: Store Approved

For each approved candidate, call `hw_store_memory` with:
- `type`: the suggestedMemoryType
- `title`: the candidate title
- `content`: the full summary
- `tags`: ["knowledge-intake", the category]

Mark stored candidates as `status: "stored"` and rejected ones as `status: "rejected"` in the queue file.

## Rules

- Never store more than 5 memories per scan cycle
- Always check for duplicates via hw_retrieve_memories before staging
- If nothing interesting is found, say so -- don't force weak candidates
- The queue file is append-friendly: new scans add to the candidates array, old entries stay for history
- Medium relevance items need Pat's explicit approval; high relevance items are recommended but still shown
