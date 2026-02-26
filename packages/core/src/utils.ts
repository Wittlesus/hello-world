import { randomUUID } from 'node:crypto';

export function generateId(prefix?: string): string {
  const short = randomUUID().replace(/-/g, '').slice(0, 8);
  return prefix ? `${prefix}_${short}` : short;
}

export function now(): string {
  return new Date().toISOString();
}

const WATCHER_ADJECTIVES = [
  'amber',
  'brave',
  'coral',
  'dusty',
  'fuzzy',
  'golden',
  'jade',
  'lunar',
  'misty',
  'noble',
  'pale',
  'quiet',
  'rusty',
  'silver',
  'sleepy',
  'swift',
  'tangy',
  'velvet',
  'windy',
  'zesty',
];

const WATCHER_ANIMALS = [
  'badger',
  'beaver',
  'cobra',
  'dingo',
  'eagle',
  'ferret',
  'gecko',
  'heron',
  'ibis',
  'jackal',
  'kestrel',
  'lemur',
  'marmot',
  'newt',
  'otter',
  'panda',
  'quail',
  'raven',
  'stoat',
  'thrush',
];

export function generateWatcherName(tag: string, existing: string[]): string {
  const existingSet = new Set(existing);
  // Try random pairs first, fall back to exhaustive search
  for (let attempt = 0; attempt < 50; attempt++) {
    const adj = WATCHER_ADJECTIVES[Math.floor(Math.random() * WATCHER_ADJECTIVES.length)];
    const animal = WATCHER_ANIMALS[Math.floor(Math.random() * WATCHER_ANIMALS.length)];
    const name = `[${tag}] ${adj}-${animal}`;
    if (!existingSet.has(name)) return name;
  }
  // Guaranteed unique fallback
  return `[${tag}] ${generateId()}`;
}
