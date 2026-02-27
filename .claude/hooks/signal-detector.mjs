/**
 * Signal Detector -- detects significant moments in conversation that should become memories.
 *
 * Architecture:
 * - Layer 1: Regex pre-filter (zero cost, runs on every message)
 * - Layer 2: Structural validation (checks message pairs, context)
 * - Queue: detected signals written to .hello-world/signal-queue.json
 *
 * Designed for Windows-first. No /tmp, no fcntl, no Unix assumptions.
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { join } from 'path';

const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const HW = join(PROJECT, '.hello-world');
const QUEUE_PATH = join(HW, 'signal-queue.json');

// ── Signal Patterns ────────────────────────────────────────────

const PATTERNS = {
  // Understanding shifts -- Claude changes position or realizes something new
  shift: [
    /\b(actually[,.]?\s+(i was|that's|the|this|it))\b/i,
    /\b(i was wrong|i missed the point|i missed that)\b/i,
    /\b(on reflection|having (looked|thought) (at|about) this)\b/i,
    /\b(i (initially|previously|earlier) (thought|said|recommended))\b/i,
    /\b(that changes (things|everything|my))\b/i,
    /\b(i take back|let me revise|let me correct)\b/i,
    /\b(fundamentally different|i was comparing.*(wrong|different))\b/i,
  ],

  // Claude acknowledges user correction
  correction: [
    /\b(you're right|you're correct|fair point|good (catch|point|question))\b/i,
    /\b(i (missed|overlooked|forgot|didn't (consider|notice|have)))\b/i,
    /\b(my mistake|my (earlier|previous) (assessment|analysis))\b/i,
    /\b(i should have|i need to rethink)\b/i,
  ],

  // Bug discovery or fix
  bug_fix: [
    /\b(crash(es|ed|ing)?|broke(n)?|regression)\b/i,
    /\b(found (a |the )?(bug|issue|problem|crash|error))\b/i,
    /\b(fixed (by|with|the)|the fix (is|was))\b/i,
    /\b(root cause|the (actual|underlying) (issue|problem|cause))\b/i,
    /\b(TypeError|ReferenceError|Cannot read propert|undefined is not)\b/i,
    /\b(missing (guard|check|optional chaining|null check))\b/i,
  ],

  // Verification or test outcome
  verification: [
    /\b(PASS|FAIL|verified|confirmed|proven)\b/i,
    /\b(all (\d+|tests?) pass|0 errors|build clean)\b/i,
    /\b(works (now|correctly|as expected))\b/i,
    /\b(integration test|end-to-end|scorecard)\b/i,
    /\bgrade\s*[A-F]\b/i,
    /\b(Brain Health:\s*[A-F])\b/i,
  ],

  // Research conclusion or synthesis
  research_conclusion: [
    /\b(the (verdict|synthesis|key (finding|takeaway)|bottom line))\b/i,
    /\b(across (all|the|every) (agents?|sources?|plugins?|results?))\b/i,
    /\b(all \d+ agents? back|universal flaw|every plugin)\b/i,
    /\b(the research (says|shows|supports|concludes))\b/i,
    /\b(here's the (full|complete) (picture|synthesis|scorecard))\b/i,
  ],

  // Novel insight or connection
  insight: [
    /\b(the (real|actual|honest|hard|core|fundamental) (issue|truth|answer|problem|question|gap))\b/i,
    /\b(this (means|implies|is exactly|is the same))\b/i,
    /\b(the missing (piece|layer|link))\b/i,
    /\b(none of (them|these|the plugins?) (do|have|implement))\b/i,
    /\b(our (differentiator|advantage|opportunity))\b/i,
  ],

  // Decision or direction choice
  decision: [
    /\b(let's\s+(go with|use|build|start with|proceed))\b/i,
    /\b(the (design|approach|architecture|method) (is|will be|should be))\b/i,
    /\b(I('ll| will)\s+(use|build|implement|wire|create))\b/i,
    /\b(instead of|rather than).{0,40}\b(we'll|I'll|let's)\b/i,
  ],

  // Reusable method or pattern discovered
  method: [
    /\b(new method|the (pattern|method|approach) (is|works))\b/i,
    /\b(\d+-agent (parallel|sprint|audit|build))\b/i,
    /\b(thin.?slice|ground truth first|reverse.?engineer)\b/i,
    /\b(this (pattern|method|approach) (can be|should be) (reused|applied))\b/i,
  ],
};

// Patterns for detecting actionable items in user messages (task creation nudge)
const USER_ACTIONABLE = [
  /\b(fix|build|add|implement|create|set up|wire|remove|delete|refactor|update|upgrade|migrate)\s+/i,
  /\b(we need|i need|you need|needs? to)\s+/i,
  /\b(make (it|the|this|a)|finish|ship|deploy|push)\s+/i,
  /\b(bug|broken|crash|doesn't work|not working|failing)\b/i,
  /\b(feature|task|todo|backlog|next up)\b/i,
  /\b(also[,.]?\s+(fix|add|build|do|make|handle|wire))\b/i,
  /\b(and then|after that|once that's done)\b/i,
  /\bfinish\s+(the\s+)?(tasks?|work|remaining|pending)\b/i,
];

// Patterns for detecting user pushback (applied to user messages)
const USER_PUSHBACK = [
  /\b(no[,.]?\s+(that's|it's|you're)\s+(not|wrong))\b/i,
  /\b(you (missed|forgot|overlooked|ignored))\b/i,
  /\b(are you sure|do you even)\b/i,
  /\b(that's not (right|correct|what I))\b/i,
  /\b(hold on|well hold on|wait)\b/i,
  /\b(i don't (just )?want|i want (better|more|different))\b/i,
  /\b(yeesh|debbie downer|that's sad)\b/i,
];

// Patterns for user instructions to remember something
const USER_INSTRUCTION = [
  /\b(save this|remember (this|that)|log this|from now on)\b/i,
  /\b(always (use|do|remember)|never (use|do|forget))\b/i,
  /\b(this is (a |important|something).*(memory|remember))\b/i,
  /\b(that (needs|should) (to )?be (logged|saved|remembered|stored))\b/i,
  /\b(keep (this|it) on the back burner)\b/i,
  /\b(only use .* for)\b/i,
];

// ── Detection Functions ────────────────────────────────────────

/**
 * Detect signals in an assistant message.
 * Returns array of { type, confidence, excerpt }
 */
export function detectAssistantSignals(text) {
  if (!text || text.length < 50) return [];
  const signals = [];

  for (const [type, patterns] of Object.entries(PATTERNS)) {
    for (const p of patterns) {
      const match = p.exec(text);
      if (match) {
        // Extract ~150 chars around the match for context
        const start = Math.max(0, match.index - 50);
        const end = Math.min(text.length, match.index + match[0].length + 100);
        const excerpt = text.slice(start, end).replace(/\n/g, ' ').trim();

        signals.push({
          type,
          pattern: p.source.slice(0, 60),
          excerpt,
          confidence: 0.5, // Base confidence, upgraded by validation
        });
        break; // One match per type per message
      }
    }
  }

  return signals;
}

/**
 * Detect signals in a user message.
 * Returns array of { type, confidence, excerpt }
 */
export function detectUserSignals(text) {
  if (!text || text.length < 5) return [];
  const signals = [];

  for (const p of USER_PUSHBACK) {
    const match = p.exec(text);
    if (match) {
      signals.push({
        type: 'user_pushback',
        pattern: p.source.slice(0, 60),
        excerpt: text.slice(0, 200),
        confidence: 0.6,
      });
      break;
    }
  }

  for (const p of USER_INSTRUCTION) {
    const match = p.exec(text);
    if (match) {
      signals.push({
        type: 'user_instruction',
        pattern: p.source.slice(0, 60),
        excerpt: text.slice(0, 200),
        confidence: 0.9, // High confidence -- user explicitly asked
      });
      break;
    }
  }

  return signals;
}

/**
 * Detect actionable items in a user message.
 * Returns true if the message likely contains work items that should become tasks.
 */
export function detectActionableItems(text) {
  if (!text || text.length < 10) return false;
  let matchCount = 0;
  for (const p of USER_ACTIONABLE) {
    if (p.test(text)) matchCount++;
  }
  // Need at least 2 pattern matches to trigger (reduces false positives)
  return matchCount >= 2;
}

/**
 * Validate signals with structural context.
 * Upgrades confidence when two-message patterns match.
 */
export function validateSignals(assistantSignals, recentUserText) {
  const validated = [];

  for (const sig of assistantSignals) {
    const upgraded = { ...sig };

    // Corrections are higher confidence when preceded by user pushback
    if (sig.type === 'correction' && recentUserText) {
      const hasPushback = USER_PUSHBACK.some(p => p.test(recentUserText));
      if (hasPushback) {
        upgraded.confidence = 0.9;
        upgraded.type = 'correction_confirmed';
      }
    }

    // Research conclusions are higher confidence after tool calls
    if (sig.type === 'research_conclusion') {
      upgraded.confidence = 0.8;
    }

    // Bug discoveries are high value
    if (sig.type === 'bug_fix') {
      upgraded.confidence = 0.7;
    }

    validated.push(upgraded);
  }

  return validated;
}

// ── Queue Management ───────────────────────────────────────────

function readQueue() {
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
  } catch {
    return { signals: [], lastFlushed: null };
  }
}

function writeQueue(queue) {
  const tmp = QUEUE_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(queue, null, 2), 'utf8');
  renameSync(tmp, QUEUE_PATH);
}

/**
 * Add detected signals to the queue.
 */
export function enqueueSignals(signals) {
  if (signals.length === 0) return;
  const queue = readQueue();
  const now = new Date().toISOString();

  for (const sig of signals) {
    queue.signals.push({
      ...sig,
      detectedAt: now,
    });
  }

  // Cap queue at 50 signals (prevent unbounded growth)
  if (queue.signals.length > 50) {
    queue.signals = queue.signals.slice(-50);
  }

  writeQueue(queue);
}

/**
 * Read and flush the queue. Returns the signals that were queued.
 */
export function flushQueue() {
  const queue = readQueue();
  if (queue.signals.length === 0) return [];

  const signals = queue.signals;
  writeQueue({ signals: [], lastFlushed: new Date().toISOString() });
  return signals;
}

/**
 * Peek at the queue without flushing.
 */
export function peekQueue() {
  return readQueue().signals;
}

/**
 * Format queued signals as a context injection for Claude.
 */
export function formatSignalNudge(signals) {
  if (signals.length === 0) return '';

  // Group by type, deduplicate similar excerpts
  const seen = new Set();
  const unique = signals.filter(s => {
    const key = s.type + ':' + s.excerpt.slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) return '';

  const typeLabels = {
    shift: 'Understanding shift',
    correction: 'Correction acknowledged',
    correction_confirmed: 'User correction (confirmed)',
    bug_fix: 'Bug discovery/fix',
    verification: 'Verification outcome',
    research_conclusion: 'Research conclusion',
    insight: 'Novel insight',
    decision: 'Decision made',
    method: 'Reusable method',
    user_pushback: 'User pushback',
    user_instruction: 'User instruction to remember',
  };

  const lines = [];
  lines.push('UNCAPTURED SIGNALS (significant moments not yet stored as memories):');

  for (const sig of unique.slice(0, 8)) { // Max 8 signals in nudge
    const label = typeLabels[sig.type] || sig.type;
    const conf = sig.confidence >= 0.8 ? 'HIGH' : sig.confidence >= 0.6 ? 'MED' : 'LOW';
    lines.push(`- [${label}] (${conf}) "${sig.excerpt.slice(0, 100)}"`);
  }

  if (unique.length > 8) {
    lines.push(`  ...and ${unique.length - 8} more`);
  }

  lines.push('Store significant items via hw_store_memory. Dismiss noise by ignoring.');

  return lines.join('\n');
}
