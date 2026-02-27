// Analyze current session transcript for capturable moments
import { readFileSync } from 'fs';
const TRANSCRIPT = process.argv[2];
const lines = readFileSync(TRANSCRIPT, 'utf8').split('\n').filter(Boolean);

const userMsgs = [];
const assistantMsgs = [];
const SIGNAL_PATTERNS = {
  shift: [
    /\b(actually|wait|on reflection|i was wrong|that changes|revise|reconsider)\b/i,
    /\b(i (initially|previously|earlier) (thought|said|recommended|suggested))\b/i,
    /\b(better approach|instead of what I|correction:)\b/i,
    /\btake back\b/i,
    /\bmissed the point\b/i,
  ],
  correction: [
    /\b(you'?re right|good (catch|point)|I (missed|overlooked|was wrong))\b/i,
    /\b(my mistake|fair point|you're correct)\b/i,
  ],
  user_pushback: [
    /\b(no,?\s+(that'?s|it'?s|you'?re)\s+(not|wrong))\b/i,
    /\b(you (missed|forgot|overlooked))\b/i,
    /\b(that'?s (wrong|incorrect|not right))\b/i,
    /\b(are you sure|do you even)\b/i,
    /\b(yeesh|debbie downer)\b/i,
    /\b(hold on|well hold on)\b/i,
    /\b(i don'?t just want|i want better)\b/i,
  ],
  decision: [
    /\b(let'?s\s+(go with|use|choose|pick|proceed))\b/i,
    /\b(i('?ll| will)\s+(use|go with|implement|choose))\b/i,
    /\b(the design|the approach|the method)\s+(is|will be)\b/i,
  ],
  research_conclusion: [
    /\b(the (verdict|synthesis|key finding|bottom line))\b/i,
    /\b(across (all|the) (agents?|sources?|results?))\b/i,
    /\b(every plugin|all 6|universal flaw)\b/i,
  ],
  insight: [
    /\b(this (means|implies|is exactly|is the))\b/i,
    /\b(the (real|actual|honest|hard) (issue|truth|answer|problem|question))\b/i,
    /\b(fundamentally different)\b/i,
  ],
  user_instruction: [
    /\b(save this|remember this|log this|from now on)\b/i,
    /\b(always use|never use|don'?t forget)\b/i,
  ],
};

for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'user' && obj.message?.content) {
      const parts = Array.isArray(obj.message.content) ? obj.message.content : [{ type: 'text', text: obj.message.content }];
      const text = parts.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
      if (text.length > 5 && text.indexOf('<system') !== 0) {
        userMsgs.push(text);
      }
    }
    if (obj.type === 'assistant' && obj.message?.content) {
      const parts = Array.isArray(obj.message.content) ? obj.message.content : [{ type: 'text', text: obj.message.content }];
      const text = parts.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
      if (text.length > 50) {
        assistantMsgs.push(text);
      }
    }
  } catch {}
}

console.log(`Transcript: ${lines.length} lines, ${userMsgs.length} user msgs, ${assistantMsgs.length} assistant msgs\n`);

// Now detect signals
console.log('=== DETECTED SIGNALS ===\n');
let signalCount = 0;

for (let i = 0; i < assistantMsgs.length; i++) {
  const msg = assistantMsgs[i];
  const signals = [];
  for (const [type, patterns] of Object.entries(SIGNAL_PATTERNS)) {
    for (const p of patterns) {
      if (p.test(msg)) {
        signals.push(type);
        break;
      }
    }
  }
  if (signals.length > 0) {
    signalCount++;
    console.log(`[MSG ${i}] Signals: ${signals.join(', ')}`);
    console.log(`  Text: ${msg.slice(0, 200)}`);
    console.log('');
  }
}

// Check user messages for pushback/instructions
console.log('=== USER SIGNALS ===\n');
for (let i = 0; i < userMsgs.length; i++) {
  const msg = userMsgs[i];
  const signals = [];
  for (const [type, patterns] of Object.entries(SIGNAL_PATTERNS)) {
    for (const p of patterns) {
      if (p.test(msg)) {
        signals.push(type);
        break;
      }
    }
  }
  if (signals.length > 0) {
    console.log(`[USER ${i}] Signals: ${signals.join(', ')}`);
    console.log(`  Text: ${msg.slice(0, 200)}`);
    console.log('');
  }
}

console.log(`\nTotal: ${signalCount} assistant signals, ${userMsgs.length} user messages analyzed`);

// Now manually list what SHOULD have been captured
console.log('\n=== GROUND TRUTH: MOMENTS THAT SHOULD HAVE BEEN AUTO-CAPTURED ===');
console.log('(manual analysis of what actually mattered in this session)\n');
const groundTruth = [
  'health.ts has 3 crash bugs (links, links in computeGrade, synapticActivity) -- discovered and fixed',
  'JsonStore caches in memory -- external writes get clobbered by MCP server',
  'Backfill data lost because MCP server overwrote from stale cache',
  'Brain MO integration test: 11/13 modules working, 2 unwired (reflection, prediction)',
  'Brain state was actually alive (114 tags, 21 traces) -- earlier audit had nesting bug',
  'UNDERSTANDING SHIFT: went from "cut the brain" to "brain is research-aligned" after Pat pushed back',
  'CORRECTION: Pat pointed out I was comparing against wrong category (coding memory vs relational memory)',
  'CORRECTION: Pat said "do you even know the vision and initial pitch?" -- I did not have it stored',
  'PAT INSTRUCTION: save the founding pitch and vision',
  'PAT INSTRUCTION: save methods including what worked and what didn\'t',
  'PAT INSTRUCTION: use Sonnet 4.6 1M for research/reasoning subagents, Opus for coding',
  'PAT CORRECTION: "not just what they do, I want better -- reverse engineer, find flaws"',
  'PAT CORRECTION: "well not all methods produced good results so be careful"',
  'RESEARCH CONCLUSION: 6-agent landscape research -- brain MO is research-aligned',
  'RESEARCH CONCLUSION: 6-agent reverse-engineering -- 5 universal flaws found in all plugins',
  'INSIGHT: "file edits are not thoughts" -- auto-memory only captures file changes, misses conversation insights',
  'INSIGHT: memories shown to human but not injected into Claude (claude-mem fatal flaw)',
  'INSIGHT: no plugin has a feedback loop measuring if memories helped',
  'METHOD: deep research then reverse-engineer pattern',
];
groundTruth.forEach((g, i) => console.log(`${i + 1}. ${g}`));
