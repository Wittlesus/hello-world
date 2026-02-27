#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync } from 'fs';

const SESSIONS_FILE = 'C:/Users/Patri/CascadeProjects/hello-world/.hello-world/sessions.json';

const batch1 = {
  "s_1b3f50d2": "Fixed 8 stale deliberation statuses, rebuilt Timeline and ProjectContext to auto-populate from sessions/activity/decisions. Launched 6-agent Qwen research sprint.",
  "s_d2f23730": "Ran 3 think-tank agents revealing brain system was mostly dead code (85% memories never accessed). Ran 6-agent deliberation designing the Magnum Opus brain rewrite, then launched 4 parallel build teams.",
  "s_d66d73f3": "Fixed clean-shutdown bug in lib.rs. Built real-time brain data-flow SVG diagram. Wired overdrive glow, fixed Questions tab, replaced terminal sessions panel with neural viz.",
  "s_550e25c7": "Fixed prediction wiring bug and linker null guard. Ran 6-agent boardroom research sprint; implemented 5 boardroom quality fixes (max_tokens, round awareness, whiteboard regex, char limit, agent prompts).",
  "s_390eb7dd": "Scaffolded Cortex as standalone MCP server for static code indexing. Ran 3 mining agents to retroactively extract undocumented learnings from 227 conversation logs into brain memories.",
  "s_5210c6e4": "Productivity sprint: fixed 7 hardcoded hook paths, installed Biome 2.4.4, adopted React 19.2 Activity for all 15 views, built buddy recap and memory scoring -- 15 tasks completed.",
  "s_06112d9b": "Built Overdrive mode with hook injection and visual indicators (buddy golden aura, amber sidebar). Built crash-safety sentinel: hidden process that backs up state files and writes crash-marker on exit.",
  "s_b6acc132": "Built UsageBars with live claude.ai session/weekly/extra limit data via OAuth token. Set up Windows Task Scheduler poller -- no browser, no CDP, no setup.",
  "s_8924618b": "Built safe embedded browser feature in worktree: browser.rs with 10 Tauri commands, loopback HTTP bridge, BrowserView React panel, 4 hw_browser_* MCP tools.",
  "s_4fc86777": "Verified B+ split-state storage (tasks/decisions/questions.json) landed cleanly. Added auto-tag inference to hw_add_task. Updated system-explorer.html for split architecture."
};

const batch2 = {
  "s_05d4b7be": "Audited uncommitted work, removed orphaned ChatView, built Discord bot and hw_notify DM system with new Skills view.",
  "s_35213d6e": "Wired 3 dead brain modules (reflection, prediction, cortex merger) into runtime, built UsageBars component, fixed Qwen API key in MCP config.",
  "s_1e357f56": "Ran full deliberation on the guardrail system itself, then implemented all 6 improvements including quality coverage tags and hw_quick_insights tool.",
  "s_967d8fd3": "Diagnosed app freeze from 11+ redundant polling intervals and stale state.json reads, fixed Rust backend to read split task/decision/question files.",
  "s_bb5ba7e0": "Cleaned 30 stale worktrees and 39 branches, ran full feature verification (all 10 systems passed), ran SaaS deliberation resulting in TaxCreditCalculators.com.",
  "s_ad3e9148": "Recovered from session 53 crash (editing lib.rs in dev mode), updated MEMORY.md with correct rule, added previous-session transcript recap to SessionStart hook.",
  "s_91729db5": "Rebuilt SessionStart hook as single source of truth -- Claude gets full context instantly on startup without calling hw_get_context().",
  "s_cae449b6": "Recovered from Claude Code auto-update crash, deployed 6 parallel agents to extract forgotten ideas, pains, decisions from 272 session transcripts into memory.",
  "s_36696220": "Cleared all non-epic tasks, shipped deliberation UX polish (colored brackets, summary overlay), color-coded activity feed brackets by status type.",
  "s_f655bc9e": "Verified browser MCP tools work, rewrote browser feature to embed child webview inside main Tauri window using unstable multi-webview API."
};

const batch3 = {
  "s_e04cf3ac": "Created SessionStart hook and project memory file after Claude lost context; wired hw_get_context() to auto-inject on every session start.",
  "s_aa18083a": "Investigated terminal PTY context injection, fixed missing projectPath arg, added auto-sent init message on terminal open.",
  "s_7849a44c": "Merged deliberation v2 (7 new agents, hw_plan_deliberation, hw_list_agents), added themed sidebar badges showing new-item counts per tab.",
  "s_cccd1859": "Committed session-start hook rewrite, ran 7-agent multi-research sweep covering AI tools, React 19.2, Tauri patterns; added GitMCP and Package Version MCPs.",
  "s_7f6c13b5": "Fixed pre-tool-gate reading deleted state.json, wired MCP-to-Rust browser bridge with /browser/navigate and /browser/close loopback routes.",
  "s_5d9234d7": "Diagnosed CORS preflight blocking browser content extraction, fixed init script to use sendBeacon with text/plain, added CORS headers.",
  "s_bc9daacd": "Audited and fixed all 7 files still referencing deleted state.json after B+ migration (Rust, hooks, MCP server).",
  "s_15d58e79": "Fixed missed bug in answer_question() reading questions.json as bare array instead of {questions:[]} wrapper format.",
  "s_b78d3af5": "Added mod browser to Rust, registered 9 Tauri commands, rewrote handler with path-based routing for browser loopback.",
  "s_4abc0a2e": "Ran browser verification (4/5 passing), diagnosed broken triple-parse in store_browser_result, added /browser/extract route.",
  "s_a3007273": "Browser verification continued -- diagnosed sendBeacon CORS issues, added active /browser/extract route bypass.",
  "s_b4f02001": "Verified browser extraction working, attempted to embed browser as child webview using Tauri's unstable multi-webview API.",
  "s_00320b10": "Tried opening system-explorer.html in built-in browser, hit file:// URL block, spun up local HTTP server as workaround.",
  "s_bc56cc43": "Confirmed browser compiles and opens, found content extraction only works on first page load -- subsequent navigations don't re-trigger.",
  "s_93622989": "Committed 38-file batch (ErrorBoundary, browser module, useTauriData optimizations) after fixing white screen.",
  "s_6994b38b": "Diagnosed white screen root cause (get_state reading deleted state.json after B+ migration), fixed in Rust, added ErrorBoundary.",
  "s_b4eb8308": "Cleaned up browser frontend references (BrowserView.tsx, App.tsx, Sidebar.tsx) after Pat decided to remove browser feature.",
  "s_21775048": "Removed built-in browser feature from Rust and React -- too many failure points.",
  "s_c9ad02d3": "Fixed Cost view showing nothing by adding get_claude_usage Rust command and rewiring useClaudeUsage hook to useTauriData."
};

const allSummaries = { ...batch1, ...batch2, ...batch3 };

const data = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
let updated = 0;

for (const session of data.sessions) {
  if (allSummaries[session.id]) {
    session.summary = allSummaries[session.id];
    updated++;
  }
}

const tmp = SESSIONS_FILE + '.tmp';
writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
renameSync(tmp, SESSIONS_FILE);
console.log(`Updated ${updated} session summaries`);
