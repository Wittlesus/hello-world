#!/usr/bin/env node
/**
 * Hello World — Detached recap generator
 * Spawned on clean session exit (hw_end_session).
 * Reads recap-buffer.json, generates a polished summary, writes pending-recap.json.
 * Falls back to simple formatting if API unavailable.
 *
 * Usage: node .claude/recap-generator.mjs <project-path>
 * Runs detached (parent calls child.unref()).
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import https from 'https';

const projectPath = process.argv[2];
if (!projectPath) {
  console.error('[recap] No project path provided');
  process.exit(1);
}

const HW = join(projectPath, '.hello-world');

function safeRead(file) {
  try {
    return JSON.parse(readFileSync(join(HW, file), 'utf8'));
  } catch {
    return null;
  }
}

const buffer = safeRead('recap-buffer.json');
if (!buffer) {
  console.error('[recap] No recap-buffer.json found');
  process.exit(0);
}

// Build a simple text recap from the buffer
function simpleRecap(buf) {
  const lines = [`Session ${buf.sessionNumber} recap:`];

  if (buf.completedTasks?.length > 0) {
    lines.push('');
    lines.push('Completed:');
    buf.completedTasks.slice(0, 6).forEach((t) => lines.push(`- ${t}`));
  }

  if (buf.decisions?.length > 0) {
    lines.push('');
    lines.push('Decisions:');
    buf.decisions.slice(0, 3).forEach((d) => lines.push(`- ${d}`));
  }

  if (buf.completedTasks?.length === 0 && buf.decisions?.length === 0) {
    if (buf.highlights?.length > 0) {
      lines.push('');
      buf.highlights.slice(0, 5).forEach((h) => lines.push(`- ${h}`));
    } else {
      lines.push('(quiet session)');
    }
  }

  return lines.join('\n');
}

// Try to generate AI summary via Claude Haiku
async function aiRecap(buf) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const prompt = `Summarize this coding session in 3-5 bullet points. Be concise (each bullet max 60 chars). Focus on what was accomplished, not process details.

Session ${buf.sessionNumber}:
- Tasks completed: ${(buf.completedTasks || []).join(', ') || 'none'}
- Decisions: ${(buf.decisions || []).join(', ') || 'none'}
- Highlights: ${(buf.highlights || []).join(', ') || 'none'}

Output only the bullet points, one per line, starting with "- ".`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.content?.[0]?.text;
            if (text) {
              resolve(`Session ${buf.sessionNumber} recap:\n${text.trim()}`);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      },
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

// Main
(async () => {
  let summary;

  // Try AI recap first
  try {
    summary = await aiRecap(buffer);
  } catch {
    summary = null;
  }

  // Fall back to simple formatting
  if (!summary) {
    summary = simpleRecap(buffer);
  }

  const recap = {
    sessionNumber: buffer.sessionNumber,
    sessionId: buffer.sessionId,
    generatedAt: new Date().toISOString(),
    summary,
    completedTasks: buffer.completedTasks || [],
    decisions: buffer.decisions || [],
    source: summary !== simpleRecap(buffer) ? 'ai' : 'buffer',
  };

  try {
    writeFileSync(join(HW, 'pending-recap.json'), JSON.stringify(recap, null, 2), 'utf8');
    console.log('[recap] Written pending-recap.json');
  } catch (err) {
    console.error('[recap] Failed to write:', err.message);
  }
})();
