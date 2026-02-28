---
description: "Scan the web for knowledge worth remembering -- AI news, coding trends, dependency updates. Finds, analyzes, and produces actionable intelligence briefings."
---

# Knowledge Intake Scanner

You are running a knowledge intake scan. Your job is to find recent, useful information, analyze it against our project, and produce actionable intelligence -- not just bookmarks.

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

### Step 4: Intelligence Briefing (THE CRITICAL STEP)

For each staged candidate, produce an **actionable brief**. This is NOT optional -- raw facts without analysis are useless.

For each candidate, add these fields to the queue entry:

```json
{
  "brief": {
    "relevanceToUs": "1-2 sentences: what this specifically means for Hello World. Reference our actual architecture, stack, or roadmap.",
    "actionCall": "adopt | investigate | monitor | ignore",
    "integrationSketch": "If adopt/investigate: what's the concrete task? Which files/systems would change? Rough scope (hours/days). If monitor/ignore: null.",
    "costOfIgnoring": "What do we lose or risk by not acting on this? Be honest -- if the answer is 'nothing', say so.",
    "confidence": "high | medium | low -- how confident are you in this assessment?"
  }
}
```

**Action call definitions:**
- **adopt**: We should build/integrate this. Create a task.
- **investigate**: Promising but needs more research before committing. Create a research task.
- **monitor**: Interesting but not actionable yet. Store as fact, revisit next scan.
- **ignore**: Not relevant enough. Store for reference only.

### Step 5: For/Against Assessment (YOUR OPINION)

After producing the brief, give your honest for/against take on each item. This is NOT neutral analysis -- it's your recommendation as the developer who knows this codebase.

For each candidate, write:
- **FOR**: Why we should care. Be specific to our stack, our roadmap, our pain points.
- **AGAINST**: Why we shouldn't act. Be honest -- if it's resume-driven development, say so. If the timing is wrong, say so. If we already solved this better, say so.
- **MY TAKE**: One sentence. Adopt / investigate / monitor / skip, and why.

This assessment may change the actionCall from Step 4. That's the point -- the brief is the analysis, the for/against is the gut check. If the gut check says "skip" but the brief says "adopt", downgrade to monitor.

Not everything needs to become a task. The scan's job is also to confirm we're on the right track and identify what NOT to build.

### Step 6: Deliberate on "Adopt" Items

For any candidate where actionCall is still "adopt" after the for/against check, run a deliberation to validate the decision before creating tasks. Use agents appropriate to the domain:
- Technical adoption: backendarch + pragmatist + contrarian
- Architecture change: backendarch + firstprinciples + premortem
- New tool/framework: pragmatist + costanalyst + contrarian

This replaces asking Pat. Document the deliberation outcome in the brief.

For "investigate" items, create the research task directly -- no deliberation needed for research.

### Step 7: Present Intelligence Report

Show the full briefing to Pat as a decision table:

| # | Title | Action | For/Against Summary | Confidence |
|---|-------|--------|---------------------|------------|
| 1 | ... | ADOPT | FOR: ... / AGAINST: ... | HIGH |
| 2 | ... | MONITOR | FOR: ... / AGAINST: ... | MEDIUM |

Then for each item, show the full for/against breakdown. Pat should be able to read the table and immediately know what matters and what doesn't.

### Step 8: Store & Act

For each candidate:
- **adopt**: Store memory + create task (from integration sketch). Mark `status: "stored"`.
- **investigate**: Store memory + create research task. Mark `status: "stored"`.
- **monitor**: Store memory only. Mark `status: "stored"`.
- **ignore**: Store memory for reference. Mark `status: "stored"`.

All items get stored (we want the knowledge regardless). The action call determines whether a task is created alongside the memory.

## Rules

- Never store more than 5 memories per scan cycle
- Always check for duplicates via hw_retrieve_memories before staging
- If nothing interesting is found, say so -- don't force weak candidates
- The queue file is append-friendly: new scans add to the candidates array, old entries stay for history
- Every candidate MUST have a brief. No brief = not staged.
- "adopt" items MUST go through deliberation before task creation
- Medium relevance items with "monitor" action don't need Pat's review -- just store and note them
- High relevance items with "adopt" action get deliberation + task creation automatically
- Document everything: the brief, the deliberation outcome, the created task ID. Full audit trail.
