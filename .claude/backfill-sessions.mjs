#!/usr/bin/env node
/**
 * Backfills orphaned sessions in sessions.json using JSONL transcripts from Claude Code.
 * Matches sessions by timestamp overlap, extracts: endedAt, message count, summary.
 * Run once: node .claude/backfill-sessions.mjs
 */
import { readFileSync, writeFileSync, renameSync, readdirSync } from 'fs';
import { join } from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const HW = 'C:/Users/Patri/CascadeProjects/hello-world/.hello-world';
const TRANSCRIPTS = 'C:/Users/Patri/.claude/projects/C--Users-Patri-CascadeProjects-hello-world';
const SESSIONS_FILE = join(HW, 'sessions.json');

async function parseJsonl(filePath) {
  const stats = { startTs: null, endTs: null, userMsgs: 0, assistantMsgs: 0, toolCalls: 0, lastAssistantText: '' };

  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.trim().length === 0) continue;
    try {
      const entry = JSON.parse(line);
      const ts = entry.timestamp;
      if (ts) {
        if (stats.startTs === null || ts < stats.startTs) stats.startTs = ts;
        if (stats.endTs === null || ts > stats.endTs) stats.endTs = ts;
      }

      if (entry.type === 'user') stats.userMsgs++;
      if (entry.type === 'assistant') {
        stats.assistantMsgs++;
        // Extract last assistant text for summary
        const content = entry.message?.content;
        if (typeof content === 'string' && content.length > 10) {
          stats.lastAssistantText = content;
        } else if (Array.isArray(content)) {
          const textBlocks = content.filter(b => b.type === 'text' && b.text);
          if (textBlocks.length > 0) {
            stats.lastAssistantText = textBlocks[textBlocks.length - 1].text;
          }
        }
        // Count tool calls
        if (Array.isArray(content)) {
          stats.toolCalls += content.filter(b => b.type === 'tool_use').length;
        }
      }
    } catch { /* skip malformed lines */ }
  }

  return stats;
}

function makeSummary(stats) {
  if (stats.userMsgs <= 1) return `(stub session, ${stats.userMsgs} exchange)`;

  // Try to use last assistant text as summary
  let summary = stats.lastAssistantText;
  if (summary.length > 200) summary = summary.substring(0, 197) + '...';
  if (summary.length < 10) {
    summary = `${stats.userMsgs + stats.assistantMsgs} messages, ${stats.toolCalls} tool calls`;
  }

  // Clean up markdown/formatting
  summary = summary.replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/[#*`]/g, '').trim();
  return summary;
}

async function main() {
  // Read sessions
  const sessionsData = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  const sessions = sessionsData.sessions;

  // Find orphaned sessions
  const orphaned = sessions.filter(s => (s.summary || '').includes('orphan') || s.summary === '');
  console.log(`Found ${orphaned.length} orphaned sessions out of ${sessions.length} total`);

  // Find all JSONL files
  const jsonlFiles = readdirSync(TRANSCRIPTS).filter(f => f.endsWith('.jsonl'));
  console.log(`Found ${jsonlFiles.length} JSONL transcript files`);

  // Parse all transcripts
  console.log('Parsing transcripts...');
  const transcripts = [];
  for (const file of jsonlFiles) {
    try {
      const stats = await parseJsonl(join(TRANSCRIPTS, file));
      if (stats.startTs) transcripts.push({ file, ...stats });
    } catch { /* skip */ }
  }
  console.log(`Parsed ${transcripts.length} valid transcripts`);

  // Match orphaned sessions to transcripts by timestamp
  let matched = 0;
  for (const session of orphaned) {
    const sessionStart = new Date(session.startedAt).getTime();

    // Find transcript whose start is within 120 seconds of session start
    const match = transcripts.find(t => {
      const tStart = new Date(t.startTs).getTime();
      return Math.abs(tStart - sessionStart) < 120000; // 2 min window
    });

    if (match) {
      const summary = makeSummary(match);
      session.summary = summary;
      if (match.endTs && (session.endedAt === undefined || (session.summary || '').includes('orphan'))) {
        session.endedAt = match.endTs;
      }
      matched++;
    } else {
      // No transcript match -- keep orphaned but mark as unmatched
      if ((session.summary || '').includes('orphan')) {
        session.summary = '(no transcript found)';
      }
    }
  }

  console.log(`Matched ${matched} of ${orphaned.length} orphaned sessions`);

  // Write back
  const tmp = SESSIONS_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(sessionsData, null, 2), 'utf8');
  renameSync(tmp, SESSIONS_FILE);
  console.log('sessions.json updated');
}

main().catch(err => { console.error(err); process.exit(1); });
