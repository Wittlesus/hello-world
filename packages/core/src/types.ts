import { z } from 'zod';

// ── Constants ───────────────────────────────────────────────────

export const HW_DIR = '.hello-world';
export const DB_FILE = 'hello-world.db';

// ── Project Config ──────────────────────────────────────────────

export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  version: z.string().default('0.1.0'),
  description: z.string().default(''),
  gitIntegration: z.boolean().default(true),
  defaultModel: z.string().default('claude-sonnet-4-6'),
  dailyBudgetUsd: z.number().default(5.0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// ── Tasks ───────────────────────────────────────────────────────

export const TaskStatus = z.enum(['todo', 'in_progress', 'done', 'blocked']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskSize = z.enum(['S', 'M', 'L', 'Epic']);
export type TaskSize = z.infer<typeof TaskSize>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().default(''),
  status: TaskStatus.default('todo'),
  size: TaskSize.optional(),
  parentId: z.string().optional(),
  assignee: z.string().optional(),
  milestoneId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Task = z.infer<typeof TaskSchema>;

// ── Milestones ──────────────────────────────────────────────────

export const MilestoneSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().default(''),
  completed: z.boolean().default(false),
  completedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});

export type Milestone = z.infer<typeof MilestoneSchema>;

// ── Decisions ───────────────────────────────────────────────────

export const DecisionSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  context: z.string(),
  chosen: z.string(),
  alternatives: z.array(z.object({
    option: z.string(),
    tradeoff: z.string(),
  })).default([]),
  rationale: z.string(),
  decidedAt: z.string().datetime(),
  decidedBy: z.enum(['pat', 'claude', 'both']),
});

export type Decision = z.infer<typeof DecisionSchema>;

// ── Known Unknowns ──────────────────────────────────────────────

export const QuestionStatus = z.enum(['open', 'answered', 'deferred']);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const QuestionSchema = z.object({
  id: z.string(),
  question: z.string().min(1),
  context: z.string().default(''),
  status: QuestionStatus.default('open'),
  answer: z.string().optional(),
  answeredAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  linkedTaskId: z.string().optional(),
  linkedDecisionId: z.string().optional(),
});

export type Question = z.infer<typeof QuestionSchema>;

// ── Brain: Memories ─────────────────────────────────────────────

export const MemoryType = z.enum(['pain', 'win', 'fact', 'decision', 'architecture', 'reflection']);
export type MemoryType = z.infer<typeof MemoryType>;

export const MemorySeverity = z.enum(['low', 'medium', 'high']);
export type MemorySeverity = z.infer<typeof MemorySeverity>;

export const MemorySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  type: MemoryType,
  title: z.string().min(1),
  content: z.string().default(''),
  rule: z.string().default(''),
  tags: z.array(z.string()).default([]),
  severity: MemorySeverity.default('low'),
  synapticStrength: z.number().default(1.0),
  accessCount: z.number().default(0),
  lastAccessed: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  // Link graph
  links: z.array(z.object({
    targetId: z.string(),
    relationship: z.enum(['resolves', 'supersedes', 'extends', 'contradicts', 'related']),
    createdAt: z.string().datetime(),
  })).default([]),
  supersededBy: z.string().optional(),
  qualityScore: z.number().min(0).max(1).optional(),
  fingerprint: z.string().optional(),
  // Reflection fields (only used when type='reflection')
  relatedTaskId: z.string().optional(),
  surfacedMemoryIds: z.array(z.string()).optional(),
  outcome: z.enum(['success', 'partial', 'failure']).optional(),
});

export type Memory = z.infer<typeof MemorySchema>;

// ── Brain: State ────────────────────────────────────────────────

export const ContextPhase = z.enum(['early', 'mid', 'late']);
export type ContextPhase = z.infer<typeof ContextPhase>;

export const BrainStateSchema = z.object({
  sessionStart: z.string().datetime(),
  messageCount: z.number().default(0),
  contextPhase: ContextPhase.default('early'),
  synapticActivity: z.record(z.string(), z.object({
    count: z.number(),
    lastHit: z.string().datetime(),
  })).default({}),
  memoryTraces: z.record(z.string(), z.object({
    count: z.number(),
    lastAccessed: z.string().datetime(),
    synapticStrength: z.number(),
  })).default({}),
  firingFrequency: z.record(z.string(), z.number()).default({}),
  activeTraces: z.array(z.string()).default([]),
  significantEventsSinceCheckpoint: z.number().default(0),
});

export type BrainState = z.infer<typeof BrainStateSchema>;

// ── Sessions ────────────────────────────────────────────────────

export const SessionSchema = z.object({
  id: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  tasksCompleted: z.array(z.string()).default([]),
  decisionsMade: z.array(z.string()).default([]),
  costUsd: z.number().default(0),
  tokensUsed: z.number().default(0),
  summary: z.string().default(''),
});

export type Session = z.infer<typeof SessionSchema>;

// ── Cost: Traces ────────────────────────────────────────────────

export const TraceSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  agentName: z.string(),
  modelId: z.string(),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  costUsd: z.number().default(0),
  durationMs: z.number().default(0),
  startedAt: z.string().datetime(),
  parentTraceId: z.string().optional(),
});

export type Trace = z.infer<typeof TraceSchema>;

// ── Approval System ─────────────────────────────────────────────

export const ApprovalTier = z.enum(['auto', 'notify', 'block']);
export type ApprovalTier = z.infer<typeof ApprovalTier>;

export const ApprovalStatus = z.enum(['pending', 'approved', 'rejected']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalRequestSchema = z.object({
  id: z.string(),
  action: z.string(),
  description: z.string(),
  tier: ApprovalTier,
  status: ApprovalStatus.default('pending'),
  options: z.array(z.string()).default([]),
  context: z.string().default(''),
  resolution: z.string().optional(),
  resolvedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

// ── Activity Stream ─────────────────────────────────────────────

export const ActivityType = z.enum([
  'file_read', 'file_write', 'file_edit',
  'command_run', 'tool_call',
  'decision', 'approval_request', 'approval_resolved',
  'error', 'memory_stored',
  'task_started', 'task_completed',
  'session_start', 'session_end',
]);
export type ActivityType = z.infer<typeof ActivityType>;

export const ActivityEventSchema = z.object({
  id: z.string(),
  type: ActivityType,
  description: z.string(),
  details: z.string().default(''),
  sessionId: z.string(),
  timestamp: z.string().datetime(),
});

export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

// ── File Ownership ──────────────────────────────────────────────

export const FileOwnershipSchema = z.object({
  filePath: z.string(),
  feature: z.string().optional(),
  module: z.string().optional(),
  lastModifiedBy: z.string().optional(),
  lastModifiedAt: z.string().datetime().optional(),
});

export type FileOwnership = z.infer<typeof FileOwnershipSchema>;

// ── Workflow Engine ─────────────────────────────────────────────

export const WorkflowPhase = z.enum([
  'idle', 'scope', 'plan', 'build', 'verify', 'ship', 'waiting_approval', 'blocked',
]);
export type WorkflowPhase = z.infer<typeof WorkflowPhase>;

export const WorkflowStateSchema = z.object({
  phase: WorkflowPhase.default('idle'),
  currentTaskId: z.string().optional(),
  strikes: z.number().default(0),
  lastStrikeError: z.string().optional(),
  autonomousStartedAt: z.string().datetime().optional(),
  contextUsagePercent: z.number().default(0),
});

export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

// ── Git ─────────────────────────────────────────────────────────

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitStatus {
  staged: string[];
  modified: string[];
  untracked: string[];
  branch: string;
  ahead: number;
  behind: number;
}

// ── Model Pricing ───────────────────────────────────────────────

export interface ModelPricing {
  modelId: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICING: ModelPricing[] = [
  { modelId: 'claude-opus-4-6', inputPerMTok: 15.0, outputPerMTok: 75.0 },
  { modelId: 'claude-sonnet-4-6', inputPerMTok: 3.0, outputPerMTok: 15.0 },
  { modelId: 'claude-sonnet-4-5', inputPerMTok: 3.0, outputPerMTok: 15.0 },
  { modelId: 'claude-haiku-4-5', inputPerMTok: 0.80, outputPerMTok: 4.0 },
  { modelId: 'gpt-4o', inputPerMTok: 2.50, outputPerMTok: 10.0 },
  { modelId: 'gpt-4o-mini', inputPerMTok: 0.15, outputPerMTok: 0.60 },
  { modelId: 'gemini-2.5-pro', inputPerMTok: 1.25, outputPerMTok: 10.0 },
  { modelId: 'gemini-2.5-flash', inputPerMTok: 0.15, outputPerMTok: 0.60 },
];

// ── Sensory Cortex (keyword -> tag mapping) ──────────────────────
// Merged from Python SENSORY_CORTEX (~230 entries) + TS-only entries.
// Keys: words from user prompts (lowercase).
// Values: tag names that map to memory tag indices.

export const DEFAULT_CORTEX: Record<string, string[]> = {
  // --- Platforms ---
  reddit: ['reddit', 'social'],
  subreddit: ['reddit', 'social'],
  karma: ['reddit', 'social'],
  upvote: ['reddit', 'social'],
  twitter: ['twitter', 'social'],
  tweet: ['twitter', 'social'],
  tweeting: ['twitter', 'social'],
  'x.com': ['twitter', 'social'],
  timeline: ['twitter', 'social'],
  follower: ['twitter', 'social'],
  followers: ['twitter', 'social'],
  retweet: ['twitter', 'social'],
  reply: ['twitter', 'social'],
  thread: ['twitter', 'writing'],
  hacker: ['social'],
  hn: ['social'],
  'dev.to': ['social', 'writing'],
  github: ['github', 'git'],
  repo: ['github', 'git'],
  repository: ['github', 'git'],
  stars: ['github'],
  pr: ['github', 'git'],
  pull: ['github', 'git'],
  commit: ['github', 'git'],
  gh: ['github', 'git'],

  // --- Tools ---
  playwright: ['playwright', 'browser'],
  browser: ['browser', 'playwright'],
  snapshot: ['playwright', 'tokens'],
  dom: ['playwright', 'tokens', 'browser'],
  'page.evaluate': ['playwright', 'browser'],
  navigate: ['playwright', 'browser'],
  click: ['playwright', 'browser'],
  selector: ['playwright', 'browser'],
  stripe: ['stripe', 'payments'],
  payment: ['stripe', 'payments'],
  money: ['stripe'],
  revenue: ['stripe', 'strategy'],
  charge: ['stripe'],
  subscription: ['stripe'],
  invoice: ['stripe'],
  checkout: ['stripe'],
  npm: ['npm', 'dependencies', 'packages'],
  publish: ['npm'],
  package: ['npm'],
  install: ['npm', 'dependencies'],
  dependency: ['npm', 'dependencies'],
  dependencies: ['npm', 'dependencies'],
  node_modules: ['npm'],
  mcp: ['mcp'],
  plugin: ['plugins'],
  plugins: ['plugins'],
  hook: ['hooks'],
  hooks: ['hooks'],
  git: ['git', 'version-control'],
  merge: ['git'],
  branch: ['git'],
  docker: ['infrastructure', 'deployment'],
  ci: ['ci-cd', 'deployment'],

  // --- Actions ---
  deploy: ['deployment', 'infrastructure'],
  deploying: ['deployment'],
  deployment: ['deployment'],
  vercel: ['deployment'],
  production: ['deployment'],
  ship: ['deployment', 'npm'],
  shipping: ['deployment', 'npm'],
  launch: ['deployment', 'strategy'],
  posting: ['social', 'writing'],
  content: ['writing', 'opsec'],
  blog: ['writing'],
  article: ['writing'],
  write: ['writing'],
  writing: ['writing'],
  draft: ['writing'],
  engage: ['social'],
  engagement: ['social'],
  comment: ['social'],
  commenting: ['social'],
  build: ['build', 'compilation', 'strategy', 'validation'],
  test: ['testing'],
  refactor: ['refactoring', 'architecture'],

  // --- Concepts ---
  memory: ['memory', 'performance'],
  remember: ['memory'],
  forgot: ['memory'],
  forget: ['memory'],
  context: ['memory', 'tokens'],
  session: ['memory'],
  persist: ['memory'],
  model: ['model-selection'],
  haiku: ['model-selection'],
  sonnet: ['model-selection', 'prompting'],
  opus: ['model-selection'],
  claude: ['model-selection'],
  gpt: ['model-selection'],
  gemini: ['model-selection'],
  opsec: ['opsec'],
  identity: ['opsec'],
  anonymous: ['opsec'],
  secret: ['opsec'],
  reveal: ['opsec'],
  strategy: ['strategy'],
  pricing: ['strategy'],
  monetize: ['strategy'],
  monetization: ['strategy'],
  competitor: ['strategy'],
  competition: ['strategy'],
  market: ['strategy', 'validation'],
  validation: ['validation'],
  validate: ['validation'],
  research: ['validation', 'strategy'],
  feature: ['strategy'],
  prioritize: ['strategy'],
  priority: ['strategy'],
  leverage: ['strategy'],
  productive: ['strategy', 'autonomy'],
  productivity: ['strategy', 'autonomy'],
  focus: ['strategy', 'autonomy'],
  distraction: ['strategy', 'autonomy'],
  procrastinate: ['strategy', 'autonomy'],
  procrastinating: ['strategy', 'autonomy'],
  quality: ['strategy', 'autonomy'],
  slop: ['strategy', 'autonomy'],
  discriminating: ['strategy', 'validation'],
  worth: ['strategy', 'validation'],
  should: ['strategy', 'validation'],
  windows: ['windows'],
  path: ['windows'],
  tokens: ['tokens'],
  token: ['tokens', 'authentication', 'security'],
  cost: ['tokens', 'strategy'],
  expensive: ['tokens', 'strategy'],
  cheap: ['tokens', 'model-selection'],
  budget: ['tokens', 'strategy'],
  waste: ['tokens'],
  wasted: ['tokens'],

  // --- AI writing tells ---
  dash: ['ai-tells', 'writing'],
  lowercase: ['ai-tells', 'writing'],
  'ai-written': ['ai-tells', 'writing'],
  detected: ['ai-tells', 'writing'],
  bot: ['ai-tells', 'opsec'],
  automated: ['ai-tells', 'opsec'],

  // --- TS-only: errors and debugging ---
  bug: ['debugging', 'errors'],
  error: ['errors', 'debugging'],
  crash: ['errors', 'debugging'],
  fix: ['debugging'],

  // --- TS-only: auth and security ---
  auth: ['authentication', 'security'],
  login: ['authentication'],
  password: ['authentication', 'security'],
  security: ['security'],

  // --- TS-only: api and data ---
  api: ['api', 'integration'],
  database: ['database'],
  sql: ['database'],
  query: ['database'],

  // --- TS-only: frontend ---
  react: ['react', 'frontend'],
  component: ['react', 'frontend'],
  css: ['styling', 'frontend'],
  style: ['styling', 'frontend'],

  // --- TS-only: performance ---
  performance: ['performance', 'optimization'],
  slow: ['performance'],

  // --- TS-only: configuration ---
  config: ['configuration'],
  env: ['configuration', 'environment'],

  // --- TS-only: architecture ---
  architecture: ['architecture'],
  design: ['architecture', 'design'],
};

// ── Attention Patterns (hard interrupts) ────────────────────────

export const ATTENTION_PATTERNS: Record<string, string> = {
  deploy: 'DEPLOYMENT detected — check deployment memories',
  production: 'PRODUCTION context — extra caution required',
  security: 'SECURITY context — review security memories',
  delete: 'DESTRUCTIVE operation — check for related pain memories',
  payment: 'PAYMENT context — mandatory human review',
  migration: 'MIGRATION detected — check for related pain memories',
};
