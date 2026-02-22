# Hello World

## What
Autonomous AI workspace. Local-first desktop environment where Claude operates as the primary developer — persistent project memory, structured task execution, full tool access — and the human steers strategy and approves decisions.

## Stack
TypeScript monorepo (Turborepo). Three packages:
- `@hello-world/core` — brain engine, project state, agent orchestration, tools, workflow engine
- `@hello-world/cli` — terminal interface (commander)
- `@hello-world/app` — Tauri v2 desktop app (Rust backend + React 19 + Tailwind 4)

## Commands
- Build (TS only): `npm run build:ts`
- Build (all): `npm run build`
- Test: `npm run test`
- Dev: `npm run dev`
- Clean: `npm run clean`

## Architecture
- Brain engine (hippocampal retrieval): `packages/core/src/brain/`
- Project state (tasks, decisions, sessions): `packages/core/src/state.ts`
- Agent layer (Claude client, cost tracking): `packages/core/src/agent/`
- Tools (filesystem, terminal, git): `packages/core/src/tools/`
- Orchestration (workflow, approvals, Two-Strike): `packages/core/src/orchestration/`
- Storage: SQLite via better-sqlite3 (local-first)

## Patterns
- Zod schemas + inferred types: `packages/core/src/types.ts`
- Tool definitions: `packages/core/src/tools/filesystem.ts`

## Rules
- ESM throughout. Use `.js` extensions in relative imports.
- Brain engine functions must be pure (no side effects). Storage is separate.
- All tool calls must be logged to the activity stream.
- Approval gates are system-level constraints, not prompt suggestions.
