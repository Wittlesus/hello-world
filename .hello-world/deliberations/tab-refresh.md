# Deliberation: Live Tab Refresh

## Problem
The Hello World Tauri desktop app has multiple data views (Dashboard, Tasks, Decisions, Memory, etc.) that all read from `.hello-world/*.json` files. The current update mechanism relies on a Rust file watcher (`notify_debouncer_mini`) that emits `hw-files-changed` events to React when files change.

**The watcher is missing writes from the MCP server** (a separate Node.js process). On Windows, atomic/buffered writes from Node.js don't always trigger the notify watcher. Result: tabs go stale after MCP tool calls.

## Current Architecture
- `useTauriData(command, projectPath)` — React hook
  - Initial fetch on mount
  - Listens for `hw-files-changed` Tauri events, refetches matching files
  - No polling fallback
- Rust file watcher: `notify_debouncer_mini` with 500ms debounce, NonRecursive on `.hello-world/`
- MCP server: Node.js process writing JSON files directly

## Proposed Fix (boring/safe)
Add a 10-second polling interval to `useTauriData` as a fallback. Simple, works, but adds constant background invokes even when nothing changed.

## What We're Looking For
A **better, more creative solution** that:
- Keeps the UI feeling alive and reactive
- Doesn't create unnecessary load
- Could even be a richer experience than just "data refreshes"
- Considers that Claude is the one making writes — so Claude knows when data changed

## Constraints
- Tauri v2 + React 19 + TypeScript
- MCP server is a separate Node.js process
- App must work offline / local-first
- No cloud dependency

## Open Questions
1. Should Claude actively push updates rather than the UI polling?
2. Is there a smarter event system we could build vs. relying on file watcher?
3. Could this be a feature (showing "Claude just updated X") rather than just a bug fix?
4. What if the UI showed a subtle "last updated" pulse on each panel?

## Round 1 — Agent Response

### The Real Problem

The file watcher is the wrong abstraction. It's trying to infer intent from OS events — events that Windows deliberately suppresses for buffered/atomic writes. The source of truth isn't the filesystem; it's the MCP server process. The MCP server already knows what it changed. We're just not listening to it.

Three proposals follow, ordered from "build it today" to "build it right."

---

### Proposal A: MCP Server Pings Tauri Directly (HTTP sidecar)

**How it works:**

When the Tauri app starts, it opens a local HTTP server on a fixed port (e.g., `127.0.0.1:7788`). One endpoint: `POST /notify` with a JSON body `{ "files": ["state.json", "activity.json"] }`.

The MCP server, after every successful write, fires a `fetch("http://127.0.0.1:7788/notify", ...)` with the list of files it just wrote. Tauri receives this, emits a `hw-files-changed` event to the frontend with the file list — same event the watcher emits today.

**Why this works:**

- Zero polling. Updates arrive in milliseconds.
- The MCP server already knows exactly which files changed (it chose to write them).
- The Tauri HTTP listener can be a tiny `axum` route added to `lib.rs` — 20 lines of Rust.
- If the app isn't running, the `fetch()` simply fails silently — no error handling needed.
- Works entirely offline, no cloud dependency.

**What it unlocks:**

The payload can carry metadata beyond just file names. The MCP server can send `{ "files": ["state.json"], "tool": "hw_add_task", "summary": "Added task: Wire up SkillsView" }`. Tauri forwards this to React. The UI can show a toast: "Claude just added a task" — not just a data refresh, but a narrated update.

**Implementation sketch:**

```rust
// lib.rs — add alongside existing setup
let app_handle = app.handle().clone();
tauri::async_runtime::spawn(async move {
    let router = axum::Router::new()
        .route("/notify", axum::routing::post(move |body: axum::Json<NotifyPayload>| {
            let handle = app_handle.clone();
            async move {
                handle.emit("hw-files-changed", &body.files).ok();
                axum::http::StatusCode::OK
            }
        }));
    axum::Server::bind(&"127.0.0.1:7788".parse().unwrap())
        .serve(router.into_make_service())
        .await.ok();
});
```

```typescript
// MCP server — after every state write
async function notifyApp(files: string[], tool?: string, summary?: string) {
  try {
    await fetch("http://127.0.0.1:7788/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, tool, summary }),
    });
  } catch {
    // App not running — silent fail
  }
}
```

**Tradeoffs:**

- Port conflict is possible (fixable: try 7788, 7789, 7790 in sequence on startup, write chosen port to a temp file the MCP server reads).
- Adds a network interface even though it's loopback-only (acceptable for a dev tool).

---

### Proposal B: Change Ledger File (lightweight, no IPC)

**How it works:**

Instead of watching all `.hello-world/*.json` files, introduce a single file: `.hello-world/changes.jsonl`. The MCP server appends one line per write: `{"ts":1708700000123,"files":["state.json"],"tool":"hw_add_task"}`. The Tauri watcher only watches this one file — a pure append, which Windows handles reliably even for Node.js writes.

The React app polls `changes.jsonl` on a long interval (60s) as a fallback, but primarily listens for the watcher event on that single file. When it sees a new line, it knows which other files to refetch.

**Why this works:**

Appending to a file (rather than rewriting it) uses a different code path in both Node and the OS. Appends don't trigger the same atomic-write behavior that causes the watcher to miss events. The watcher fires reliably. You get targeted invalidation — only refetch the files that actually changed.

The ledger also gives you a free audit trail. The Timeline view could read `changes.jsonl` to show a live feed: "hw_store_memory wrote memories.json at 14:32:01."

**Tradeoffs:**

- Still depends on the OS file watcher for one file, just a more reliable path.
- `changes.jsonl` grows unboundedly — needs periodic truncation (keep last 1000 lines, trim on app startup).
- Two writes per MCP tool call instead of one.

---

### Proposal C: Claude Narrates Its Own Writes (the "alive" experience)

**How it works:**

This reframes the problem. Instead of hiding the staleness, make the UI aware of it in a way that feels intentional.

Add a `last_write` field to a lightweight `.hello-world/sync.json` file. The MCP server writes this file last, after every tool call: `{ "ts": 1708700000, "tool": "hw_add_task", "files": ["state.json"], "summary": "Added: Wire up SkillsView" }`. This is a single small file, always overwritten (not appended) — a sentinel file.

The Tauri app watches ONLY this sentinel file (more reliable than watching all files). When it fires, the UI:
1. Shows a subtle pulse/glow on the affected panels for 2 seconds.
2. Refetches only the changed files.
3. Logs the tool call + summary in a "live feed" that floats at the bottom of the Dashboard.

The key insight: the `sync.json` file is tiny (under 200 bytes), always overwritten to the same size, written last. Windows's write buffering is most likely to fire for small, fixed-size files. This is a reliability trick, not just a feature.

**The experience Pat gets:**

The Dashboard has a bottom strip: "Claude — 14:32:01 — added task 'Wire up SkillsView'". Every MCP action narrates itself. The UI isn't polling in the background wondering if something changed — it's being told, by Claude, what just happened and why.

**Tradeoffs:**

- Still technically relies on the file watcher, just optimized for reliability.
- Requires all MCP tool implementations to write `sync.json` as a final step.
- `summary` field means tool implementations need one-line descriptions of what they did.

---

### Recommendation

**Ship Proposal A first.** The loopback HTTP approach is the cleanest architectural separation. The MCP server becomes an active participant in the UI's lifecycle rather than a passive file-writer. The Tauri HTTP listener is small, isolated, and doesn't change any existing code paths. The file watcher can stay as a fallback for non-MCP writes (manual edits, Discord listener writes, etc.).

**Add Proposal C's narration layer on top.** The `{ tool, summary }` metadata in the HTTP payload is free to include. Wire it to a toast or a live feed strip in the Dashboard. That's the "alive" experience.

Proposal B (ledger file) is a useful fallback if the HTTP approach has issues on certain Windows configurations, but it shouldn't be the primary mechanism.

## Round 2 — Deliberation

### Claude's Response

Proposal A is the right call architecturally. A few pushbacks and extensions:

**On the HTTP port:** Writing the chosen port to a temp file is fine, but there's a simpler option -- write it to `.hello-world/sync.json` (the sentinel file from Proposal C). The MCP server already reads `.hello-world/` files at startup. Kills two birds: port discovery + the narration layer, zero extra files.

**On axum as a dependency:** Adding axum to Cargo.toml means a heavier Rust build. Tauri v2 already bundles a runtime (`tauri::async_runtime` is tokio). We could use a minimal TCP socket + hand-rolled HTTP parser for the single `/notify` endpoint, or use `tiny_http` (no tokio dependency). Worth checking what's already in Cargo.toml before pulling in axum.

**The big unlock I want to explore:** The `summary` field in the HTTP payload. If every MCP tool sends a human-readable summary of what it did, that's not just a UI refresh mechanism -- it's the feed for the Claude Buddy's speech bubble. Right now the buddy shows coarse activity events. With `summary`, it would say: "Added task: wire up SkillsView" or "Stored memory: loopback HTTP pattern for IPC" in real time.

That means the buddy thoughts feature and this fix are the SAME feature. One `summary` field solves both.

**Question for the agent:** What's the cleanest way to add the `summary` field to all existing MCP tool implementations without touching every tool manually? Could the MCP server's response middleware auto-generate summaries from tool name + input, so individual tools don't need to know about it?

Also: how do we handle the case where multiple rapid tool calls come in (e.g., during a build session)? Do we batch the notifies, debounce them, or fire per-call?

## Round 3 — Agent Response

### 1. HTTP listener: axum vs tiny_http vs raw TCP

Looking at `Cargo.toml`: the current deps are `tauri`, `tauri-plugin-shell`, `tauri-plugin-dialog`, `serde`, `serde_json`, `notify`, `notify-debouncer-mini`, `portable-pty`. No tokio, no axum, no HTTP library at all.

Tauri v2 uses tokio internally (it's how `tauri::async_runtime::spawn` works), but it's not exposed as a direct dependency you build against. You can't call `tokio::net::TcpListener` in your own code unless you add tokio to Cargo.toml.

The three options and their actual costs:

**axum**: Pulls in tokio (full features), hyper, tower, http, plus their transitive deps. On a first build this adds 2-4 minutes and ~50 additional crates. The binary grows. Overkill for one endpoint.

**tiny_http**: Single-threaded, minimal, no async runtime. Works. But it blocks the calling thread, so you'd need to spawn an OS thread (`std::thread::spawn`), not a tokio task. That's fine — it's a separate thread that just sits in an accept loop. ~200KB added to binary. No tokio dependency. This is viable.

**Raw TCP (`std::net::TcpListener`)**: Zero new dependencies. You hand-parse the HTTP request — but for a single `POST /notify` with a JSON body, the parse is trivial: read until `\r\n\r\n`, extract `Content-Length`, read body, parse JSON. ~50 lines of Rust. This is the correct call. One endpoint, one method, fixed schema — rolling a minimal parser is not reckless here, it's appropriate.

**Recommendation: raw TCP in a `std::thread::spawn` loop.** No new Cargo deps. The listener thread does: accept → read body → parse JSON → call `app_handle.emit(...)` → respond `HTTP/1.1 200 OK\r\n\r\n` → close. The emit is the only thing that crosses back to the main Tauri runtime, and `AppHandle::emit` is thread-safe.

If the raw TCP approach feels fragile (e.g., a chunked transfer encoding edge case from Node.js `fetch`), add `tiny_http` as a fallback. But Node's `fetch` sends standard non-chunked POST bodies for small payloads, so the raw approach will hold.

---

### 2. Auto-generating `summary` at the MCP middleware layer

Yes, this is viable. The MCP protocol structure makes it straightforward.

The MCP server receives tool calls in a standard shape: `{ method: "tools/call", params: { name: "hw_add_task", arguments: { title: "...", description: "..." } } }`. The response goes back through the same handler. Both the name and the input are available at the transport/dispatch layer before the tool itself is invoked.

**How to implement it without touching each tool:**

In `packages/core/src/mcp/server.ts`, the tool dispatch looks something like a `switch` or `Map` lookup that calls the handler and returns its result. Wrap that dispatch in a middleware function:

```typescript
// Before: tool calls go directly to handler
const result = await toolHandlers[toolName](args);

// After: wrap the dispatch
const result = await toolHandlers[toolName](args);
const summary = generateSummary(toolName, args, result);
// attach summary to the outgoing notify payload
pendingNotify = { files: result.filesWritten, tool: toolName, summary };
```

`generateSummary` is a pure function — a `switch` on `toolName` that pulls the most meaningful field from `args`:

```typescript
function generateSummary(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "hw_add_task":      return `Added task: ${args.title}`;
    case "hw_update_task":   return `Task ${args.id} → ${args.status}`;
    case "hw_store_memory":  return `Stored ${args.type}: ${args.title}`;
    case "hw_advance_phase": return `Phase → ${args.phase}`;
    case "hw_add_question":  return `Question: ${args.question}`;
    case "hw_notify":        return `Notified Pat`;
    default:                 return tool.replace("hw_", "").replace(/_/g, " ");
  }
}
```

This function lives in one place. Individual tool handlers never know it exists. When a new tool is added, it falls through to the default (tool name prettified) which is good enough. When someone wants a better summary for a specific tool, they add one case.

The "attach to notify payload" piece means the tool handler needs to signal which files it wrote. Currently tools just return a result. The cleanest addition: tools return `{ content, filesWritten: string[] }` where `filesWritten` is optional. Middleware reads it if present. If absent, middleware sends the notify without a file list (UI refetches all watched files). That's a non-breaking change.

---

### 3. Batching/debouncing rapid fire tool calls

During a build session, Claude makes tool calls sequentially but fast — `hw_advance_phase`, `hw_update_task`, `hw_store_memory` back to back. Each one would fire a notify. That's 3-5 HTTP calls in under a second, 3-5 UI refetches, 3-5 toasts.

The right strategy is **debounce on the MCP side, not the Tauri side**.

After each tool call, don't fire the HTTP notify immediately. Instead, schedule a notify 150ms out and accumulate the payload:

```typescript
let pendingNotify: { files: Set<string>, events: Array<{tool: string, summary: string}> } | null = null;
let notifyTimer: NodeJS.Timeout | null = null;

function scheduleNotify(files: string[], tool: string, summary: string) {
  if (!pendingNotify) pendingNotify = { files: new Set(), events: [] };
  files.forEach(f => pendingNotify!.files.add(f));
  pendingNotify!.events.push({ tool, summary });

  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(async () => {
    const payload = pendingNotify!;
    pendingNotify = null;
    notifyTimer = null;
    await fireNotify(Array.from(payload.files), payload.events);
  }, 150);
}
```

The Tauri side receives one batched payload with all affected files and all events that fired. The UI refetches once, and the live feed shows all the events in sequence.

150ms is the right debounce window. Claude's sequential tool calls are typically 50-100ms apart (MCP round-trip). A 150ms window collapses a rapid burst into one notify while still feeling near-instant to the user.

The Tauri HTTP listener stays stateless — it receives whatever comes in and emits it. The intelligence is in the sender.

---

### 4. Port in sync.json — good or bad?

Good idea with one issue.

**What's good:** The MCP server already reads `.hello-world/` files. If Tauri writes the port to `sync.json` on startup (e.g., `{ "port": 7789, "ts": ... }`), the MCP server reads it once at init and knows where to POST. Zero extra files, no hardcoded ports, no env vars needed.

**The issue:** Race condition on startup. The Tauri app starts, picks a port, starts the listener, then writes `sync.json`. But if a Claude session is already running (or starts before the app finishes init), it reads `sync.json` before the port is written and falls back to no-notify. That's acceptable — the tool call still succeeds, the notify just silently fails. But it means that MCP session won't notify for its lifetime.

**Fix:** MCP server reads the port from `sync.json` at the time of each notify call, not once at startup. The file is tiny, the read is cheap. First call with a missing/stale port silently fails; second call (after Tauri has written it) succeeds. This is more robust than caching the port at init.

One addition to the schema: include a `pid` field alongside the port. Before POSTing, the MCP server can verify the process is still alive with a cheap `process.kill(pid, 0)` (signal 0 just checks existence, doesn't kill). If the process is gone, skip the HTTP call entirely rather than waiting for a connection timeout.

```json
// sync.json
{
  "port": 7789,
  "pid": 12345,
  "ts": 1708700000,
  "tool": "hw_add_task",
  "summary": "Added task: wire up SkillsView",
  "files": ["state.json"]
}
```

This one file serves four purposes: port discovery, process liveness check, last-write sentinel for the file watcher fallback, and live feed data source. That's the right design.

---

## Round 4 — Suggested Final Decision

**Concrete build plan:**

**Step 1: Tauri HTTP listener (raw TCP, no new deps)**
- In `lib.rs`, spawn a `std::thread::spawn` loop on `127.0.0.1:0` (OS picks the port).
- After binding, get the actual port, write it to `.hello-world/sync.json` as `{ "port": N, "pid": N }`.
- Loop: accept → read body → `serde_json::from_str` → `app_handle.emit("hw-files-changed", payload)` → respond 200 → close.
- Keep existing `notify_debouncer_mini` watcher as-is for non-MCP writes.

**Step 2: MCP notify middleware**
- In `packages/core/src/mcp/server.ts`, wrap the tool dispatch with `scheduleNotify`.
- `generateSummary` pure function, one switch statement.
- Tools optionally return `filesWritten: string[]`. Start with hardcoded file lists per tool name (same switch); refine later.
- 150ms debounce, batched payload.

**Step 3: React side**
- `useTauriData` already listens for `hw-files-changed`. No changes needed for the refresh fix.
- Add a `ClaudeBuddy` thought: when `hw-files-changed` arrives with a `summary` field, push it to the buddy's thought queue.
- Dashboard live feed: render the last N events from the batched payload.

**Step 4: Fallback**
- Keep the 10-second polling interval as the boring fallback (one line in `useTauriData`). It only fires if the HTTP path misses. Cost is minimal and it catches edge cases.

This is ~200 lines of new code across 3 files. No new npm packages. One new Cargo feature (std TCP, already in std). Delivers: reliable refresh, zero polling in the happy path, narrated live feed, Claude Buddy thoughts wired to real tool calls.

## Round 4 — Final Decision

**We're building this.** The deliberation converged cleanly. Here's the locked plan:

### Architecture: MCP → Tauri loopback HTTP + sync.json sentinel

**3 files changed. ~200 lines. No new dependencies.**

**`packages/app/src-tauri/src/lib.rs`**
- Spawn `std::thread::spawn` listener on `127.0.0.1:0` (OS picks port)
- After bind, write port + pid to `.hello-world/sync.json`
- Loop: accept → parse JSON body → `app_handle.emit("hw-files-changed", payload)` → 200 OK
- Existing notify_debouncer_mini watcher stays as fallback for non-MCP writes

**`packages/core/src/mcp/server.ts`**
- Wrap tool dispatch with `scheduleNotify(files, tool, summary)`
- `generateSummary(tool, args)` — one switch, prettified defaults
- 150ms debounce, batches rapid calls into one payload
- Reads port + pid from `sync.json` per-call (not cached at init)
- `process.kill(pid, 0)` liveness check before connecting

**`packages/app/src/hooks/useTauriData.ts`** + **`ClaudeBuddy.tsx`**
- useTauriData: no changes for refresh (already handles hw-files-changed)
- Add 10s polling as silent fallback (1 line)
- ClaudeBuddy reads `summary` from the event payload → speech bubble text

### The bonus unlock
`sync.json` serves 4 purposes: port discovery, liveness check, file watcher sentinel, live feed source. The buddy's real-time thoughts and the refresh fix are the SAME feature — one `summary` field wires both.
