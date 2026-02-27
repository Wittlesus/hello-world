#!/usr/bin/env node
/**
 * Backfill migration: run quality gate + fingerprint + linker on all old memories.
 * Safe to run multiple times -- skips memories that already have all fields populated.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MEMORIES_PATH = resolve(ROOT, '.hello-world/memories.json');

// Import brain modules from compiled output (pathToFileURL for Windows)
const { computeFingerprint, assessQuality } = await import(
  pathToFileURL(resolve(ROOT, 'packages/core/dist/brain/quality-gate.js')).href
);
const { findLinks, applyLinks } = await import(
  pathToFileURL(resolve(ROOT, 'packages/core/dist/brain/linker.js')).href
);

// Read memories
const data = JSON.parse(readFileSync(MEMORIES_PATH, 'utf8'));
const memories = data.memories;

console.log(`Total memories: ${memories.length}`);

let fingerprintCount = 0;
let qualityCount = 0;
let linkCount = 0;

// Pass 1: fingerprints + quality scores (independent per memory)
for (const mem of memories) {
  if (!mem.fingerprint) {
    mem.fingerprint = computeFingerprint(mem);
    fingerprintCount++;
  }
  if (mem.qualityScore === undefined || mem.qualityScore === null) {
    mem.qualityScore = assessQuality(mem);
    qualityCount++;
  }
}

console.log(`Fingerprinted: ${fingerprintCount}`);
console.log(`Quality scored: ${qualityCount}`);

// Pass 2: links (needs all memories for comparison)
for (let i = 0; i < memories.length; i++) {
  const mem = memories[i];
  if (mem.links && mem.links.length > 0) continue; // already linked

  // findLinks compares against other memories
  const others = memories.filter(m => m.id !== mem.id);
  const candidateLinks = findLinks(mem, others);

  if (candidateLinks.length > 0) {
    const updated = applyLinks(mem, candidateLinks);
    memories[i] = updated;
    linkCount++;
  } else {
    // Ensure links field exists even if empty
    if (!mem.links) mem.links = [];
  }

  if ((i + 1) % 50 === 0) {
    console.log(`  Linking progress: ${i + 1}/${memories.length}`);
  }
}

console.log(`Linked: ${linkCount} memories got new links`);

// Write back
data.memories = memories;
writeFileSync(MEMORIES_PATH, JSON.stringify(data, null, 2));
console.log('Migration complete. memories.json updated.');

// Summary stats
const withFp = memories.filter(m => m.fingerprint).length;
const withQs = memories.filter(m => m.qualityScore !== undefined).length;
const withLinks = memories.filter(m => m.links?.length > 0).length;
const avgQuality = memories.reduce((s, m) => s + (m.qualityScore ?? 0), 0) / memories.length;

console.log(`\nPost-migration stats:`);
console.log(`  Fingerprinted: ${withFp}/${memories.length}`);
console.log(`  Quality scored: ${withQs}/${memories.length}`);
console.log(`  With links: ${withLinks}/${memories.length}`);
console.log(`  Avg quality: ${avgQuality.toFixed(2)}`);
