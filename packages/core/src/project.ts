import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { StateManager } from './state.js';
import { JsonStore } from './storage.js';
import { HW_DIR, type ProjectConfig, ProjectConfigSchema } from './types.js';
import { now } from './utils.js';

export class Project {
  readonly root: string;
  readonly hwDir: string;
  readonly config: ProjectConfig;
  readonly state: StateManager;

  private constructor(root: string, config: ProjectConfig, state: StateManager) {
    this.root = root;
    this.hwDir = join(root, HW_DIR);
    this.config = config;
    this.state = state;
  }

  static init(root: string, name: string, description = ''): Project {
    const hwDir = join(root, HW_DIR);
    if (existsSync(hwDir)) {
      throw new Error(`Project already exists at ${root}`);
    }
    mkdirSync(hwDir, { recursive: true });

    const timestamp = now();
    const config = ProjectConfigSchema.parse({
      name,
      description,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const configStore = new JsonStore<{ config: ProjectConfig }>(root, 'config.json', { config });
    configStore.write({ config });

    const state = new StateManager(root);
    return new Project(root, config, state);
  }

  static open(root: string): Project {
    const hwDir = join(root, HW_DIR);
    if (!existsSync(hwDir)) {
      throw new Error(`No Hello World project found at ${root}`);
    }

    const configStore = new JsonStore<{ config: ProjectConfig }>(root, 'config.json', {
      config: ProjectConfigSchema.parse({
        name: 'unknown',
        createdAt: now(),
        updatedAt: now(),
      }),
    });
    const { config } = configStore.read();

    const state = new StateManager(root);
    return new Project(root, config, state);
  }

  updateConfig(updates: Partial<ProjectConfig>): void {
    Object.assign(this.config, updates, { updatedAt: now() });
    const configStore = new JsonStore<{ config: ProjectConfig }>(this.root, 'config.json', {
      config: this.config,
    });
    configStore.write({ config: this.config });
  }
}
