import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { HW_DIR } from './types.js';

/**
 * JSON file-backed storage with atomic writes and backup.
 *
 * Write strategy (B+ from deliberation d_e5d0b81b):
 * 1. Write data to .tmp file
 * 2. Copy current file to .backup
 * 3. Rename .tmp to target (with Windows NTFS retry loop)
 * 4. On read failure, fall back to .backup
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

    // Try main file first
    if (existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as T;
        return this.data;
      } catch {
        // Main file corrupted -- try backup
      }
    }

    // Try backup
    const backupPath = this.filePath + '.backup';
    if (existsSync(backupPath)) {
      try {
        this.data = JSON.parse(readFileSync(backupPath, 'utf-8')) as T;
        // Restore from backup
        writeFileSync(this.filePath, readFileSync(backupPath, 'utf-8'), 'utf-8');
        return this.data;
      } catch {
        // Backup also corrupted
      }
    }

    this.data = structuredClone(this.defaultData);
    return this.data;
  }

  write(data: T): void {
    this.data = data;
    const dir = join(this.projectRoot, HW_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpPath = this.filePath + '.tmp';
    const backupPath = this.filePath + '.backup';
    const content = JSON.stringify(data, null, 2);

    // Step 1: write to temp file
    writeFileSync(tmpPath, content, 'utf-8');

    // Step 2: backup current file (if it exists)
    if (existsSync(this.filePath)) {
      try {
        copyFileSync(this.filePath, backupPath);
      } catch {
        /* non-fatal */
      }
    }

    // Step 3: atomic rename with Windows NTFS retry
    if (!this.atomicRename(tmpPath, this.filePath)) {
      // Fallback: direct write (not atomic but better than losing data)
      writeFileSync(this.filePath, content, 'utf-8');
      try {
        unlinkSync(tmpPath);
      } catch {
        /* cleanup */
      }
    }
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

  /** Rename with retry loop for Windows NTFS (file may be held by watcher) */
  private atomicRename(src: string, dest: string): boolean {
    const MAX_RETRIES = 5;
    const RETRY_MS = 50;

    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        renameSync(src, dest);
        return true;
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') {
          return false; // Not a lock issue, don't retry
        }
        if (i < MAX_RETRIES - 1) {
          // Sync sleep for retry (acceptable in file I/O path)
          const start = Date.now();
          while (Date.now() - start < RETRY_MS * (i + 1)) {
            /* spin */
          }
        }
      }
    }
    return false;
  }
}
