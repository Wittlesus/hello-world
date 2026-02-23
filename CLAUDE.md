# Hello World — Project Bible

## Vision
An autonomous AI workspace where Claude operates as the primary developer and Pat steers strategy. Any Claude instance — new or resumed — opens already knowing the project vision, what's built, what's in progress, and what to do next. No re-orienting. No memory loss. Pat approves decisions and unblocks blockers via Discord. Claude builds continuously.

## The Core Loop
1. Session starts → Claude reads full context (this file + hw_get_context())
2. Claude picks up the active task or the next pending task
3. Claude works, logs activity, advances the workflow phase
4. Claude hits a blocker or needs approval → sends Discord DM to Pat, stops and waits
5. Pat approves/rejects via Discord → Claude continues
6. Task done → Claude marks complete, picks next task, repeats

## Stack
TypeScript monorepo (Turborepo):
- `@hello-world/core` — brain engine, state, orchestration, MCP server, Discord listener
- `@hello-world/cli` — terminal interface
- `@hello-world/app` — Tauri v2 desktop app (Rust + React 19 + Tailwind 4)

Storage: JSON files in `.hello-world/` (local-first, no cloud dependency)

## Commands
- `npm run build:ts` — build TypeScript only
- `npm run build` — build everything including Rust
- `npm run dev` — dev mode
- `npm run test` — run tests
- `npm --workspace=packages/core run mcp` — start MCP server
- `npm --workspace=packages/core run discord` — start Discord listener (keep running)

## Key File Paths
- State (tasks, decisions, questions): `.hello-world/state.json`
- Workflow phase: `.hello-world/workflow.json`
- Activity log: `.hello-world/activity.json`
- Approvals queue: `.hello-world/approvals.json`
- Brain/memory: `.hello-world/memories.json`
- Last-edited file (crash resume): `.hello-world/last-context.json`
- Direction notes from Pat: `.hello-world/direction.json`
- Sessions: `.hello-world/sessions.json`

## MCP Tools — Use These Actively

### Context & Memory
- `hw_get_context()` — call at session start. Returns tasks, decisions, questions, session info.
- `hw_retrieve_memories(prompt)` — search pain/win/fact memories before starting any task.
- `hw_store_memory(type, title, content, rule, severity)` — record lessons as you learn them. Types: pain, win, fact, decision, architecture.

### Tasks
- `hw_add_task(title, description)` — create a task. Do this proactively, not just when asked.
- `hw_update_task(id, status)` — mark in_progress when starting, done when complete.
- `hw_list_tasks(status?)` — see what's pending.

### Workflow
- `hw_advance_phase(phase, taskId?)` — move through: idle → scope → plan → build → verify → ship → idle.
- `hw_get_workflow_state()` — check current phase, strikes, autonomous timer.
- `hw_check_autonomous_timer()` — check if 15/20 min autonomous limit is approaching.

### Decisions & Questions
- `hw_record_decision(title, context, chosen, rationale, decidedBy, alternatives?)` — log architectural decisions.
- `hw_add_question(question, context?)` — log open questions.
- `hw_answer_question(id, answer)` — close answered questions.

### Direction Notes
- `hw_process_direction_note(noteId, action, data)` — route an unread note to an action. action: "task" | "decision" | "scope" | "dismiss". MUST call for every unread note before starting other work.

### Approvals & Notifications
- `hw_check_approval(action, description)` — MUST call before: git push, deploy, delete files, architecture changes. Returns auto/notify/block.
- `hw_notify(message)` — DM Pat when blocked, need direction, or something important happened.
- `hw_list_approvals()` / `hw_resolve_approval(id, decision)` — manage pending approvals.

### Crash Safety
- `hw_write_handoff(message)` — call BEFORE any edit that might trigger a restart. Saves context for next session.
- `hw_record_failure(taskId, errorMessage, approach)` — Two-Strike: same error twice = stop and ask Pat.

## Handoff Format (REQUIRED — use this exact structure)

When writing `hw_write_handoff()`, always use this structure so the next Claude instance knows exactly what to verify, not just what was done:

```
## VERIFIED (done, tested, confirmed working)
- <feature>: <what was confirmed>

## MERGED BUT UNTESTED (code is on master, not yet tested in running app)
- <feature>: merged in commit <sha>. Test: <exact steps + expected outcome>

## STILL IN BRANCH (not on master yet)
- Branch <name>: <what it contains>
- Files changed: <list>
- Merge blocker (if any): <why it hasn't been merged>

## VERIFICATION CHECKLIST (run on next session start, in order)
1. `git log --oneline -3` → expect: <specific commit message>
2. `npm run build:ts` → expect: 0 errors
3. File exists: <path> → expect: yes/no
4. App test: press <key> → expect: <what panel/data should appear>

## WHAT NEEDS WORK NEXT
1. <specific next action with branch/file context>
2. <next action>

## GIT STATE
- master: <sha> — <commit message>
- Worktrees in use: <branch> at <path> (purpose: ...)
- Pending Rust changes: <yes/no — if yes, describe>
```

## Architecture
- Brain engine: `packages/core/src/brain/`
- State management: `packages/core/src/state.ts`
- MCP server: `packages/core/src/mcp/server.ts`
- Discord listener: `packages/core/src/discord-listener.ts`
- Orchestration (workflow, approvals, Two-Strike): `packages/core/src/orchestration/`
- Tauri backend: `packages/app/src-tauri/src/lib.rs`
- React app: `packages/app/src/`

## App Views (Desktop)
| View | Key | Purpose |
|---|---|---|
| Dashboard | 1 | Status overview, active task, recent activity |
| Terminal | t | Embedded PTY — run commands, Claude sessions |
| Tasks | 2 | Full task board |
| Decisions | 3 | Architecture decision log |
| Questions | 4 | Open questions + answer flow |
| Memory | 5 | Brain memories (pain/win/fact) |
| Sessions | 6 | Session history |
| Cost | 7 | API cost tracking |
| Skills | SK | Claude capabilities — plugins, MCP servers, accounts |
| Settings | 8 | Project config |

## What's Built (as of Feb 2026)
- Tauri v2 desktop app with all views listed above
- Additional views: Watchers (w), Project Context (p), Timeline (l), Dashboard sessions panel
- File watcher — live reactivity, MCP writes sync to UI instantly
- MCP server with all hw_* tools including hw_process_direction_note, hw_spawn_watcher
- Discord bot — sends DMs for approvals and notifications
- Discord listener — receives approve/reject/note replies from Pat
- SessionStart hook — injects context on every session
- PostToolUse hook — captures last-edited file for crash resume
- UserPromptSubmit hook — status line with phase/task/notes count
- Workflow engine (idle→scope→plan→build→verify→ship)
- Two-Strike system — same error twice = stop
- Approval gates — auto/notify/block tiers
- Brain memory — pain/win/fact searchable at session start
- Watcher system — spawn background watchers that fire on app shutdown
- Direction notes — captured in direction.json, surfaced in Dashboard + ProjectContextView

## What's In Progress
- SkillsView tab (Rust command exists, UI not yet wired)
- Direction notes "mark read" button in Dashboard (Rust command in feat/direction-notes, not yet merged)

## Direction Capture — Critical Rule
When Pat discusses vision, scope, or strategy during a session, write it to `.hello-world/direction.json` immediately — before moving on. Do not wait for the end of the session. A crash wipes context; the file survives.

**`direction.json` structure:**
```json
{
  "vision": "One paragraph — where this project is going long-term",
  "scope": [
    { "area": "...", "decision": "in|out", "rationale": "...", "capturedAt": "ISO timestamp" }
  ],
  "notes": [
    { "id": "...", "text": "...", "source": "session|discord", "read": false, "capturedAt": "ISO timestamp" }
  ]
}
```

- `vision` — overwrite with the latest understanding whenever it's refined
- `scope` — append entries when Pat defines what's in or out of scope
- `notes` — append direction notes from Pat (Discord or in-session)

This file is loaded on every session start. If it's populated, every future Claude instance knows the strategic context without being re-briefed.

## Coding Rules
- ESM throughout. `.js` extensions in all relative imports.
- Brain engine functions must be pure — no side effects, storage is separate.
- All significant actions logged to activity stream.
- Approval gates are system constraints, not suggestions — always call hw_check_approval before destructive ops.
- hw_write_handoff before any edit that could trigger a restart.
- No half-implementations. Ship complete features or explicitly flag what's deferred and why.

## Pat's Preferences
- No emojis unless asked.
- No em dashes.
- Short and direct communication.
- If something isn't working as described, say so immediately — don't defend broken work.
- Discord DM for async — don't wait for a session to surface blockers.
