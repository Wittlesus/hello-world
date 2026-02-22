import { randomUUID } from 'node:crypto';

export function generateId(prefix?: string): string {
  const short = randomUUID().replace(/-/g, '').slice(0, 8);
  return prefix ? `${prefix}_${short}` : short;
}

export function now(): string {
  return new Date().toISOString();
}
