#!/usr/bin/env node
/**
 * Extracts conversation text from JSONL transcripts for agent summarization.
 * Produces a condensed extract (user messages + assistant text, no tool results/base64).
 * Output: .hello-world/session-extracts/{session_id}.txt
 */
import { readFileSync, writeFileSync, mkdirSync, createReadStream } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

const HW = 'C:/Users/Patri/CascadeProjects/hello-world/.hello-world';
const EXTRACT_DIR = join(HW, 'session-extracts');
mkdirSync(EXTRACT_DIR, { recursive: true });

const matches = JSON.parse(readFileSync(join(HW, 'session-transcript-matches.json'), 'utf8'));

async function extractConversation(filePath, sessionId) {
  const lines = [];
  let msgCount = 0;
  const MAX_EXTRACT = 15000; // chars -- enough for a summary, not overwhelming
  let totalChars = 0;

  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });

  for await (const line of rl) {
    if (totalChars >= MAX_EXTRACT) break;
    if (line.trim().length === 0) continue;

    try {
      const entry = JSON.parse(line);

      if (entry.type === 'user') {
        const content = entry.message?.content;
        let text = '';
        if (typeof content === 'string') text = content;
        else if (Array.isArray(content)) {
          text = content.filter(b => b.type === 'text').map(b => b.text).join(' ');
        }
        if (text.length > 0) {
          // Skip system reminders injected by hooks
          if (text.includes('<system-reminder>')) {
            const clean = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
            if (clean.length > 5) {
              const truncated = clean.length > 500 ? clean.substring(0, 500) + '...' : clean;
              lines.push(`[PAT] ${truncated}`);
              totalChars += truncated.length;
              msgCount++;
            }
          } else {
            const truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;
            lines.push(`[PAT] ${truncated}`);
            totalChars += truncated.length;
            msgCount++;
          }
        }
      }

      if (entry.type === 'assistant') {
        const content = entry.message?.content;
        let text = '';
        if (typeof content === 'string') text = content;
        else if (Array.isArray(content)) {
          // Only text blocks, skip tool_use
          text = content.filter(b => b.type === 'text').map(b => b.text).join(' ');
        }
        if (text.length > 10) {
          const truncated = text.length > 800 ? text.substring(0, 800) + '...' : text;
          lines.push(`[CLAUDE] ${truncated}`);
          totalChars += truncated.length;
          msgCount++;
        }
      }
    } catch { /* skip */ }
  }

  return { text: lines.join('\n\n'), msgCount };
}

console.log(`Extracting ${matches.length} sessions...`);

for (const match of matches) {
  try {
    const { text, msgCount } = await extractConversation(match.file, match.session_id);
    const outPath = join(EXTRACT_DIR, `${match.session_id}.txt`);
    writeFileSync(outPath, `Session: ${match.session_id}\nDate: ${match.start}\nMessages: ${msgCount}\n\n${text}`, 'utf8');
    console.log(`  ${match.session_id} (${match.start.substring(0, 10)}): ${msgCount} msgs, ${text.length} chars`);
  } catch (err) {
    console.log(`  ${match.session_id}: ERROR ${err.message}`);
  }
}

console.log('Done. Extracts in .hello-world/session-extracts/');
