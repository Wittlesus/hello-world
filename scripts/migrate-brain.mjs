#!/usr/bin/env node

/**
 * migrate-brain.mjs -- One-time brain data migration script.
 *
 * Imports lessons and wins from the Python-era memory files into
 * the Hello World memories.json, merges brain-state.json from both
 * systems, and archives dead memories.
 *
 * Usage: node scripts/migrate-brain.mjs
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// --- Paths ---
const PYTHON_MEMORY_DIR = 'C:/Users/Patri/.claude/projects/C--Users-Patri/memory';
const LESSONS_PATH = join(PYTHON_MEMORY_DIR, 'lessons-learned.md');
const WINS_PATH = join(PYTHON_MEMORY_DIR, 'wins.md');
const PYTHON_BRAIN_STATE_PATH = join(PYTHON_MEMORY_DIR, '.brain-state.json');

const HW_DIR = join(PROJECT_ROOT, '.hello-world');
const MEMORIES_PATH = join(HW_DIR, 'memories.json');
const BRAIN_STATE_PATH = join(HW_DIR, 'brain-state.json');
const ARCHIVE_PATH = join(HW_DIR, 'memories-archive.json');

// --- Helpers ---

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function atomicWriteJSON(path, data) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}

function now() {
  return new Date().toISOString();
}

// Severity from keyword scanning
function classifySeverity(text) {
  const lower = text.toLowerCase();
  const highKeywords = ['critical', 'never', 'always', 'crashed', 'infinite', 'destroyed', 'most expensive'];
  const medKeywords = ['warning', 'mistake', 'bug', 'cost', 'wasted', 'failed', 'broke'];
  if (highKeywords.some(k => lower.includes(k))) return 'high';
  if (medKeywords.some(k => lower.includes(k))) return 'medium';
  return 'low';
}

// Check if a memory with similar title exists (case-insensitive, first 30 chars)
function isDuplicate(title, existingMemories) {
  const prefix = title.toLowerCase().slice(0, 30);
  return existingMemories.some(m => m.title.toLowerCase().slice(0, 30) === prefix);
}

// Convert YYYY-MM-DD to ISO datetime (noon UTC) if not already ISO
function toISO(dateStr) {
  if (!dateStr) return now();
  // Already ISO format (contains T)
  if (dateStr.includes('T')) return dateStr;
  // YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr + 'T12:00:00.000Z';
  return dateStr;
}


// ============================================================
// 1. Parse lessons-learned.md
// ============================================================

function parseLessons(filePath) {
  const content = readFileSync(filePath, 'utf-8').replace(/\r/g, '');
  const lines = content.split('\n');

  // --- Parse Tag Index ---
  const tagMap = {}; // lessonId -> [tags]
  const tagIndexStart = lines.findIndex(l => l.startsWith('## Tag Index'));
  if (tagIndexStart >= 0) {
    for (let i = tagIndexStart + 1; i < lines.length; i++) {
      const line = lines[i];
      // Stop at next ## heading
      if (line.startsWith('## ') && !line.startsWith('## Tag Index')) break;
      // Match: `tagname`: id1, id2, id3
      // Note: some tags use arrow (→) before lesson numbers
      const tagMatch = line.match(/^`([^`]+)`:\s*(.+)$/);
      if (tagMatch) {
        const tag = tagMatch[1];
        // Strip parenthetical notes like "(CRASH)" from IDs
        const ids = tagMatch[2].split(',')
          .map(s => s.replace(/\([^)]*\)/g, '').trim())
          .filter(Boolean);
        for (const id of ids) {
          if (!tagMap[id]) tagMap[id] = [];
          if (!tagMap[id].includes(tag)) tagMap[id].push(tag);
        }
      }
    }
  }

  // --- Parse all ### headings as lessons ---
  // Two formats:
  //   ### N. Title text here       (numbered: id = "N")
  //   ### Title text here           (unnumbered: generate slug id)
  const lessons = [];
  const numberedRegex = /^### (\d+)\.\s+(.+)$/;
  const anyH3Regex = /^### (.+)$/;

  // Track which section we're in to skip pure reference subsections
  // We want lessons from: Behavioral Rules, Critical Mistakes, Session Mistakes,
  // Playwright Gotchas, Stripe Gotchas, Next.js Gotchas, GitHub Gotchas, etc.
  // We skip: Platform-Specific Notes subsections (Reddit, Indie Hackers, Dev.to, SaaSHub)
  // and Token Optimization subsections that are just tips
  const skipTitles = new Set([
    'Reddit', 'Indie Hackers', 'Dev.to', 'SaaSHub',
    'Context window management', 'Parallel vs Sequential agents',
  ]);

  for (let i = 0; i < lines.length; i++) {
    const h3Match = lines[i].match(anyH3Regex);
    if (!h3Match) continue;

    const fullTitle = h3Match[1].trim();

    // Try numbered format first
    const numMatch = lines[i].match(numberedRegex);
    let lessonId, title;

    if (numMatch) {
      lessonId = numMatch[1];
      title = numMatch[2].trim();
    } else {
      title = fullTitle;
      // Generate slug ID for tag index lookup
      lessonId = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 40);
    }

    // Skip platform descriptions and pure tips
    if (skipTitles.has(title)) continue;

    // Collect content until next ### or ## heading
    let contentLines = [];
    let rule = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].startsWith('### ') || lines[j].startsWith('## ')) break;
      contentLines.push(lines[j]);
    }

    const body = contentLines.join('\n').trim();

    // Skip empty entries (section headings with no content)
    if (!body) continue;

    // Extract rule from **Rule**: or **Fix**: lines
    // Also extract inline **Tags**: declarations
    let inlineTags = [];
    for (const cl of contentLines) {
      const ruleMatch = cl.match(/\*\*(?:Rule|Fix)\*\*:\s*(.+)/);
      if (ruleMatch && !rule) {
        rule = ruleMatch[1].slice(0, 300);
      }
      const tagsMatch = cl.match(/\*\*Tags\*\*:\s*(.+)/);
      if (tagsMatch) {
        inlineTags = tagsMatch[1]
          .replace(/`/g, '')
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);
      }
    }

    // Try to find tags from tag index.
    // For numbered lessons, use exact numeric ID lookup only.
    // For unnumbered lessons, try well-known slug IDs from the tag index.
    let tags = tagMap[lessonId] || [];

    // For unnumbered entries (non-numeric IDs), try known slug mappings
    if (tags.length === 0 && !/^\d+$/.test(lessonId)) {
      // Check if any tag index key is a substring of or matches the slug
      for (const [tagId, tagList] of Object.entries(tagMap)) {
        // Only match non-numeric tag IDs (the named references)
        if (/^\d+$/.test(tagId)) continue;
        if (lessonId.includes(tagId) || tagId.includes(lessonId)) {
          tags = [...new Set([...tags, ...tagList])];
        }
      }
    }

    // Merge inline tags with tag-index tags (deduplicate)
    const allTags = [...new Set([...tags, ...inlineTags])];

    lessons.push({
      lessonId,
      title,
      content: body.slice(0, 2000),
      rule,
      tags: allTags,
      severity: classifySeverity(title + ' ' + body),
    });
  }

  return lessons;
}


// ============================================================
// 2. Parse wins.md
// ============================================================

function parseWins(filePath) {
  const content = readFileSync(filePath, 'utf-8').replace(/\r/g, '');
  const lines = content.split('\n');

  // --- Parse Tag Index ---
  const tagMap = {};
  const tagIndexStart = lines.findIndex(l => l.startsWith('## Tag Index'));
  if (tagIndexStart >= 0) {
    for (let i = tagIndexStart + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('## ') && !line.startsWith('## Tag Index')) break;
      if (line === '---') break;
      const tagMatch = line.match(/^`([^`]+)`:\s*(.+)$/);
      if (tagMatch) {
        const tag = tagMatch[1];
        const ids = tagMatch[2].split(',').map(s => s.trim()).filter(Boolean);
        for (const id of ids) {
          if (!tagMap[id]) tagMap[id] = [];
          if (!tagMap[id].includes(tag)) tagMap[id].push(tag);
        }
      }
    }
  }

  // --- Parse numbered win headings ---
  const wins = [];
  const headingRegex = /^### (\d+)\.\s+(.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(headingRegex);
    if (!match) continue;

    const winId = match[1];
    const title = match[2].trim();

    let contentLines = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].startsWith('### ') || lines[j].startsWith('## ')) break;
      contentLines.push(lines[j]);
    }

    const body = contentLines.join('\n').trim();
    const tags = tagMap[winId] || [];

    wins.push({
      winId,
      title,
      content: body.slice(0, 2000),
      tags,
    });
  }

  return wins;
}


// ============================================================
// 3. Merge brain states
// ============================================================

function mergeBrainStates(pythonPath, tsPath) {
  const py = readJSON(pythonPath);
  const ts = readJSON(tsPath);

  const merged = structuredClone(ts);

  // Merge synapticActivity (Python uses snake_case: synaptic_activity)
  const pySynaptic = py.synaptic_activity || {};
  if (!merged.state.synapticActivity) merged.state.synapticActivity = {};

  for (const [key, pyVal] of Object.entries(pySynaptic)) {
    const existing = merged.state.synapticActivity[key];
    if (!existing) {
      merged.state.synapticActivity[key] = {
        count: pyVal.count,
        lastHit: toISO(pyVal.last_hit),
      };
    } else {
      // Take max count, latest lastHit
      merged.state.synapticActivity[key] = {
        count: Math.max(existing.count, pyVal.count),
        lastHit: toISO(pyVal.last_hit) > existing.lastHit
          ? toISO(pyVal.last_hit)
          : existing.lastHit,
      };
    }
  }

  // Merge memoryTraces (Python uses snake_case: memory_traces)
  const pyTraces = py.memory_traces || {};
  if (!merged.state.memoryTraces) merged.state.memoryTraces = {};

  for (const [key, pyVal] of Object.entries(pyTraces)) {
    // Python traces use numeric IDs or string IDs
    // Prefix all with "py_" to avoid collision with TS mem_* IDs
    const traceKey = `py_${key}`;
    const existing = merged.state.memoryTraces[traceKey];
    if (!existing) {
      merged.state.memoryTraces[traceKey] = {
        count: pyVal.count,
        lastAccessed: toISO(pyVal.last_accessed),
        synapticStrength: pyVal.synaptic_strength || 1,
      };
    } else {
      merged.state.memoryTraces[traceKey] = {
        count: Math.max(existing.count, pyVal.count),
        lastAccessed: toISO(pyVal.last_accessed) > existing.lastAccessed
          ? toISO(pyVal.last_accessed)
          : existing.lastAccessed,
        synapticStrength: Math.max(
          existing.synapticStrength || 1,
          pyVal.synaptic_strength || 1
        ),
      };
    }
  }

  return merged;
}


// ============================================================
// 4. Archive dead memories
// ============================================================

function archiveDeadMemories(memoriesData) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const active = [];
  const archived = [];

  for (const mem of memoriesData.memories) {
    const isZeroAccess = mem.accessCount === 0;
    const isOld = mem.createdAt && mem.createdAt < thirtyDaysAgo;
    if (isZeroAccess && isOld) {
      archived.push(mem);
    } else {
      active.push(mem);
    }
  }

  return { active, archived };
}


// ============================================================
// Main
// ============================================================

function main() {
  console.log('=== Brain Migration Script ===\n');

  // Load current memories
  const memoriesData = readJSON(MEMORIES_PATH);
  const existingMemories = memoriesData.memories;

  // Detect projectId from first existing memory
  const projectId = existingMemories.length > 0
    ? existingMemories[0].projectId
    : 'Hello World';
  console.log(`Project ID: ${projectId}`);
  console.log(`Existing memories: ${existingMemories.length}\n`);

  const migrationTimestamp = now();

  // --- Step 1: Import lessons ---
  let lessonsImported = 0;
  let lessonsSkipped = 0;

  if (existsSync(LESSONS_PATH)) {
    const lessons = parseLessons(LESSONS_PATH);
    console.log(`Parsed ${lessons.length} lessons from lessons-learned.md`);

    for (const lesson of lessons) {
      const id = `mem_migrated_${lesson.lessonId}`;
      const title = lesson.title;

      if (isDuplicate(title, existingMemories)) {
        lessonsSkipped++;
        continue;
      }

      const memory = {
        id,
        projectId,
        type: 'pain',
        title,
        content: lesson.content,
        rule: lesson.rule,
        tags: [...lesson.tags, 'migrated-from-python'],
        severity: lesson.severity,
        synapticStrength: 1,
        accessCount: 0,
        createdAt: migrationTimestamp,
      };

      existingMemories.push(memory);
      lessonsImported++;
    }

    console.log(`  Imported: ${lessonsImported}, Skipped (duplicate): ${lessonsSkipped}`);
  } else {
    console.log('WARNING: lessons-learned.md not found, skipping lesson import');
  }

  // --- Step 2: Import wins ---
  let winsImported = 0;
  let winsSkipped = 0;

  if (existsSync(WINS_PATH)) {
    const wins = parseWins(WINS_PATH);
    console.log(`\nParsed ${wins.length} wins from wins.md`);

    for (const win of wins) {
      const id = `mem_win_${win.winId}`;
      const title = win.title;

      if (isDuplicate(title, existingMemories)) {
        winsSkipped++;
        continue;
      }

      const memory = {
        id,
        projectId,
        type: 'win',
        title,
        content: win.content,
        rule: '',
        tags: [...win.tags, 'migrated-from-python'],
        severity: 'low',
        synapticStrength: 1,
        accessCount: 0,
        createdAt: migrationTimestamp,
      };

      existingMemories.push(memory);
      winsImported++;
    }

    console.log(`  Imported: ${winsImported}, Skipped (duplicate): ${winsSkipped}`);
  } else {
    console.log('WARNING: wins.md not found, skipping wins import');
  }

  // --- Step 3: Archive dead memories ---
  console.log('\n--- Archiving dead memories ---');
  const { active, archived } = archiveDeadMemories({ memories: existingMemories });

  // Load existing archive if it exists
  let existingArchive = [];
  if (existsSync(ARCHIVE_PATH)) {
    existingArchive = readJSON(ARCHIVE_PATH).memories || [];
  }

  const allArchived = [...existingArchive, ...archived];
  console.log(`Archived ${archived.length} memories, kept ${active.length} active`);

  // --- Step 4: Merge brain states ---
  console.log('\n--- Merging brain states ---');
  let brainMerged = false;

  if (existsSync(PYTHON_BRAIN_STATE_PATH) && existsSync(BRAIN_STATE_PATH)) {
    const mergedBrain = mergeBrainStates(PYTHON_BRAIN_STATE_PATH, BRAIN_STATE_PATH);

    const pyBrain = readJSON(PYTHON_BRAIN_STATE_PATH);
    const tsBrain = readJSON(BRAIN_STATE_PATH);
    const pySynapticCount = Object.keys(pyBrain.synaptic_activity || {}).length;
    const tsSynapticCount = Object.keys(tsBrain.state?.synapticActivity || {}).length;
    const mergedSynapticCount = Object.keys(mergedBrain.state.synapticActivity).length;
    const pyTraceCount = Object.keys(pyBrain.memory_traces || {}).length;
    const tsTraceCount = Object.keys(tsBrain.state?.memoryTraces || {}).length;
    const mergedTraceCount = Object.keys(mergedBrain.state.memoryTraces).length;

    console.log(`  Synaptic activity: Python(${pySynapticCount}) + TS(${tsSynapticCount}) -> Merged(${mergedSynapticCount})`);
    console.log(`  Memory traces: Python(${pyTraceCount}) + TS(${tsTraceCount}) -> Merged(${mergedTraceCount})`);

    atomicWriteJSON(BRAIN_STATE_PATH, mergedBrain);
    brainMerged = true;
    console.log('  Brain state merged and written.');
  } else {
    if (!existsSync(PYTHON_BRAIN_STATE_PATH)) console.log('  WARNING: Python brain-state.json not found');
    if (!existsSync(BRAIN_STATE_PATH)) console.log('  WARNING: TS brain-state.json not found');
    console.log('  Brain state merge skipped.');
  }

  // --- Write results atomically ---
  console.log('\n--- Writing results ---');
  atomicWriteJSON(MEMORIES_PATH, { memories: active });
  console.log(`  memories.json: ${active.length} memories`);

  if (allArchived.length > 0) {
    atomicWriteJSON(ARCHIVE_PATH, { memories: allArchived });
    console.log(`  memories-archive.json: ${allArchived.length} archived memories`);
  }

  // --- Summary ---
  console.log('\n========== SUMMARY ==========');
  console.log(`Imported ${lessonsImported} lessons (${lessonsSkipped} skipped as duplicates)`);
  console.log(`Imported ${winsImported} wins (${winsSkipped} skipped as duplicates)`);
  console.log(`Archived ${archived.length} dead memories, kept ${active.length} active`);
  console.log(`Brain states: ${brainMerged ? 'merged' : 'skipped'}`);
  console.log('==============================\n');
}

main();
