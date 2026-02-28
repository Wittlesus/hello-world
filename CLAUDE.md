# Hello World -- Project Bible

## Vision
An autonomous AI workspace where Claude operates as the primary developer and Pat steers strategy. Any Claude instance -- new or resumed -- opens already knowing the project vision, what's built, what's in progress, and what to do next. No re-orienting. No memory loss. Claude makes technical decisions via deliberation. Pat steers strategy and unblocks true blockers via Discord.

## The Core Loop
1. Session starts -- SessionStart hook injects full context (no need to call hw_get_context())
2. Claude scans Pat's message for implied tasks, creates them, picks one up
3. Claude works, logs activity, advances the workflow phase
4. Technical decision needed -- Claude runs a deliberation with agents, documents the outcome
5. True blocker (physical impossibility, strategy question) -- Discord DM to Pat
6. Task done -- Claude marks complete, picks next task, repeats

## Stack
TypeScript monorepo (Turborepo):
- `@hello-world/core` -- brain engine, state, orchestration, MCP server, Discord listener
- `@hello-world/cli` -- terminal interface
- `@hello-world/app` -- Tauri v2 desktop app (Rust + React 19 + Tailwind 4)

Storage: JSON files in `.hello-world/` (local-first, no cloud dependency)

## Commands
- `npm run build:ts` -- build TypeScript only
- `npm run build` -- build everything including Rust
- `npm run dev` -- dev mode
- `npm run test` -- run tests
- `npm --workspace=packages/core run mcp` -- start MCP server
- `npm --workspace=packages/core run discord` -- start Discord listener (keep running)

## Key File Paths
- Tasks: `.hello-world/tasks.json`
- Decisions: `.hello-world/decisions.json`
- Workflow phase: `.hello-world/workflow.json`
- Activity log: `.hello-world/activity.json`
- Brain/memory: `.hello-world/memories.json`
- Learned rules: `.hello-world/learned-rules.json`
- Last-edited file (crash resume): `.hello-world/last-context.json`
- Direction notes from Pat: `.hello-world/direction.json`
- Sessions: `.hello-world/sessions.json`

## MCP Tools -- Use These Actively

### Context & Memory
- `hw_get_context()` -- available on demand, but NOT needed at session start (the SessionStart hook already injects full context).
- `hw_retrieve_memories(prompt)` -- search pain/win/fact memories before starting any task.
- `hw_store_memory(type, title, content, rule, severity)` -- record lessons as you learn them. Types: pain, win, fact, decision, architecture, skill.

### Tasks
- `hw_add_task(title, description)` -- create a task. Do this proactively, not just when asked.
- `hw_update_task(id, status)` -- mark in_progress when starting, done when complete.
- `hw_list_tasks(status?)` -- see what's pending.

### Workflow
- `hw_advance_phase(phase, taskId?)` -- move through: idle -> scope -> plan -> build -> verify -> ship -> idle.
- `hw_get_workflow_state()` -- check current phase, strikes, autonomous timer.
- `hw_check_autonomous_timer()` -- check if 15/20 min autonomous limit is approaching.

### Decisions
- `hw_record_decision(title, context, chosen, rationale, decidedBy, alternatives?)` -- log architectural decisions.

### Direction Notes
- `hw_process_direction_note(noteId, action, data)` -- route an unread note to an action. action: "task" | "decision" | "scope" | "dismiss". MUST call for every unread note before starting other work.

### Notifications
- `hw_notify(message)` -- DM Pat when blocked, need direction, or something important happened.

### Crash Safety
- `hw_write_handoff(message)` -- call BEFORE any edit that might trigger a restart. Saves context for next session.
- `hw_record_failure(taskId, errorMessage, approach)` -- Two-Strike: same error twice = stop and ask Pat.

## Handoff Format (REQUIRED -- use this exact structure)

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
1. `git log --oneline -3` -> expect: <specific commit message>
2. `npm run build:ts` -> expect: 0 errors
3. File exists: <path> -> expect: yes/no
4. App test: press <key> -> expect: <what panel/data should appear>

## WHAT NEEDS WORK NEXT
1. <specific next action with branch/file context>
2. <next action>

## GIT STATE
- master: <sha> -- <commit message>
- Worktrees in use: <branch> at <path> (purpose: ...)
- Pending Rust changes: <yes/no -- if yes, describe>
```

## Architecture
- Brain engine: `packages/core/src/brain/`
- State management: `packages/core/src/state.ts`
- MCP server: `packages/core/src/mcp/server.ts`
- Discord listener: `packages/core/src/discord-listener.ts`
- Orchestration (workflow, Two-Strike): `packages/core/src/orchestration/`
- Tauri backend: `packages/app/src-tauri/src/lib.rs`
- React app: `packages/app/src/`

## App Views (Desktop)
| View | Key | Purpose |
|---|---|---|
| Dashboard | 1 | Status overview, active task, recent activity |
| Terminal | t | Embedded PTY -- run commands, Claude sessions |
| Tasks | 2 | Full task board |
| Decisions | 3 | Architecture decision log |
| Memory | 5 | Brain memories (pain/win/fact/skill) |
| Sessions | 6 | Session history |
| Cost | 7 | API cost tracking |
| Skills | SK | Claude capabilities -- plugins, MCP servers, accounts |
| Settings | 8 | Project config |
| Bible | B | CLAUDE.md viewer -- styled collapsible cards |
| Timeline | l | Session timeline with episodic index |
| Watchers | w | Background watcher processes |
| Project Context | p | Direction notes, scope, vision |
| Agents | g | Deliberation sessions and boardrooms |
| Agent Factory | a | Deploy single-agent missions with full context |

## What's Built (as of Feb 2026)
- Tauri v2 desktop app with all views listed above
- Additional views: Watchers (w), Project Context (p), Timeline (l), Dashboard sessions panel
- File watcher -- live reactivity, MCP writes sync to UI instantly
- MCP server with all hw_* tools including hw_process_direction_note, hw_spawn_watcher
- Discord bot -- sends DMs for notifications
- Discord listener -- receives approve/reject/note replies from Pat
- SessionStart hook -- injects context on every session
- PostToolUse hook -- captures last-edited file for crash resume
- UserPromptSubmit hook -- status line with phase/task/notes count
- Workflow engine (idle->scope->plan->build->verify->ship)
- Two-Strike system -- same error twice = stop
- Brain memory -- pain/win/fact/skill searchable at session start, with learned rules
- Watcher system -- spawn background watchers that fire on app shutdown
- Direction notes -- captured in direction.json, surfaced in Dashboard + ProjectContextView
- Loading splash screen -- HTML+CSS spinner visible from first webview frame
- Brain wiring -- reflection, prediction, cortex merger, linker all connected to runtime
- Auto-capture signal detector -- detects significant moments, auto-stores high-confidence signals
- Boardroom system -- Qwen-powered multi-agent collaboration with anti-groupthink phases
- Knowledge intake -- /scan skill with intelligence briefing and for/against assessment
- Bible view -- CLAUDE.md rendered as styled collapsible cards with edit intent
- Command palette -- clickable /commands menu in sidebar
- Deliberation system -- full guardrails with plan/coverage/synthesis pipeline

## What's In Progress
- Brain wiring verification -- reflection, prediction, cortex merger merged but untested in running app
- Bible view -- Rust command merged, needs app restart to compile

## Direction Capture -- Critical Rule
When Pat discusses vision, scope, or strategy during a session, write it to `.hello-world/direction.json` immediately -- before moving on. Do not wait for the end of the session. A crash wipes context; the file survives.

**`direction.json` structure:**
```json
{
  "vision": "One paragraph -- where this project is going long-term",
  "scope": [
    { "area": "...", "decision": "in|out", "rationale": "...", "capturedAt": "ISO timestamp" }
  ],
  "notes": [
    { "id": "...", "text": "...", "source": "session|discord", "read": false, "capturedAt": "ISO timestamp" }
  ]
}
```

- `vision` -- overwrite with the latest understanding whenever it's refined
- `scope` -- append entries when Pat defines what's in or out of scope
- `notes` -- append direction notes from Pat (Discord or in-session)

This file is loaded on every session start. If it's populated, every future Claude instance knows the strategic context without being re-briefed.

## Deliberation Rules
Two modes exist. They are separate by design.

**Deliberation (binding):** For decisions that matter. One mandatory path:
1. `hw_plan_deliberation` with subQuestions (required) and balanceNotes (optional)
2. For technical/architectural decisions: Claude proceeds autonomously. For strategy/scope decisions: Pat approves the plan.
3. `hw_start_deliberation` runs the session
4. `hw_check_deliberation_coverage` with quality tags (consensus/tension/shifted) per sub-question
5. `hw_conclude_deliberation` (blocked if coverage incomplete, warns if no synthesis message)
6. Document everything so changes can be rolled back.

Never skip `hw_plan_deliberation` for decisions. If it's worth deliberating, full guardrails apply.

**Quick Insights (non-binding):** ONLY for low-stakes flavor-testing where no action will be taken based on the result:
- `hw_quick_insights` -- 2-4 agents, no sub-questions, no coverage, no approval gate
- Output is bulk-dismissable and clearly labeled non-binding
- If real tension surfaces, escalate to a full deliberation
- **The tool will BLOCK decision-like topics** (contains "should we", "how to redesign", "which approach", etc.) and redirect you to hw_plan_deliberation. This is enforced in code, not just instructions.

**How to tell the difference:** If the outcome will change code, architecture, layout, or strategy, it's a DECISION -- use full deliberation. If you're just exploring what agents think about a vague idea with no action planned, it's quick insights.

**Coverage quality tags:** Every sub-question gets tagged:
- `consensus` -- agents agreed quickly. If ALL questions are consensus, that's a yellow flag (groupthink risk).
- `tension` -- real disagreement surfaced. This is where Pat should focus.
- `shifted` -- an agent changed position. The most valuable signal.

**Auto-runner:** Pauses automatically when the mediator sets phase to synthesis or later. This prevents stale coverage reports.

## Coding Rules
- ESM throughout. `.js` extensions in all relative imports.
- Brain engine functions must be pure -- no side effects, storage is separate.
- All significant actions logged to activity stream.
- For destructive ops (git push, deploy, delete), confirm with Pat first.
- Never delete data or code permanently. Archive everything -- deprecate, don't destroy.
- hw_write_handoff before any edit that could trigger a restart.
- No half-implementations. Ship complete features or explicitly flag what's deferred and why.
- **Task gate (enforced by hook):** Edit/Write is hard-blocked when no task is in_progress. Before writing any code: scan the user's message for implied tasks, hw_add_task for each, then hw_update_task to in_progress. No task = no edit.

## Pat's Preferences
- No emojis unless asked.
- No em dashes.
- Short and direct communication.
- If something isn't working as described, say so immediately -- don't defend broken work.
- Discord DM for async -- don't wait for a session to surface blockers.
