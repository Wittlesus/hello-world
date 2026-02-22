import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HW_DIR } from './types.js';

/**
 * JSON file-backed storage. Reads on first access, writes on every mutation.
 * Will be replaced with SQLite when native build tools are available.
 */
export class JsonStore<T> {
  private data: T | null = null;
  private readonly filePath: string;

  constructor(
    private readonly projectRoot: string,
    private readonly fileName: string,
    private readonly defaultData: T,
  ) {
    this.filePath = join(projectRoot, HW_DIR, fileName);
  }

  read(): T {
    if (this.data) return this.data;
    if (!existsSync(this.filePath)) {
      this.data = structuredClone(this.defaultData);
      return this.data;
    }
    this.data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as T;
    return this.data;
  }

  write(data: T): void {
    this.data = data;
    const dir = join(this.projectRoot, HW_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  update(fn: (data: T) => T): T {
    const current = this.read();
    const updated = fn(current);
    this.write(updated);
    return updated;
  }

  invalidate(): void {
    this.data = null;
  }
}
