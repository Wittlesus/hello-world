#!/usr/bin/env node
/**
 * Syncs claude.ai usage limits to .hello-world/claude-usage.json.
 * Uses Claude Code's OAuth token (already on disk). No browser needed.
 * Run via Task Scheduler every 5 min, or standalone.
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const CREDS_FILE = join(HOME, '.claude', '.credentials.json');
const PROJECT = 'C:/Users/Patri/CascadeProjects/hello-world';
const USAGE_FILE = join(PROJECT, '.hello-world', 'claude-usage.json');
const API_URL = 'https://api.anthropic.com/api/oauth/usage';

function getToken() {
  const creds = JSON.parse(readFileSync(CREDS_FILE, 'utf8'));
  return creds.claudeAiOauth?.accessToken;
}

async function fetchUsage(token) {
  const res = await fetch(API_URL, {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-code/2.0.31',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function mergeWebUsage(api) {
  const webUsage = {
    fetchedAt: new Date().toISOString(),
    fiveHour: { utilization: api.five_hour?.utilization ?? 0, resetsAt: api.five_hour?.resets_at ?? '' },
    sevenDay: { utilization: api.seven_day?.utilization ?? 0, resetsAt: api.seven_day?.resets_at ?? '' },
    sevenDaySonnet: api.seven_day_sonnet
      ? { utilization: api.seven_day_sonnet.utilization, resetsAt: api.seven_day_sonnet.resets_at }
      : null,
    extraUsage: api.extra_usage
      ? { isEnabled: api.extra_usage.is_enabled, monthlyLimit: api.extra_usage.monthly_limit,
          usedCredits: api.extra_usage.used_credits, utilization: api.extra_usage.utilization }
      : null,
  };

  let existing = {};
  try { existing = JSON.parse(readFileSync(USAGE_FILE, 'utf8')); } catch {}
  existing.webUsage = webUsage;

  const tmp = USAGE_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(existing, null, 2), 'utf8');
  renameSync(tmp, USAGE_FILE);
  return webUsage;
}

try {
  const token = getToken();
  if (!token) { console.error('No OAuth token found'); process.exit(1); }
  const data = await fetchUsage(token);
  const wu = mergeWebUsage(data);
  console.log(`OK: session ${wu.fiveHour.utilization}%, weekly ${wu.sevenDay.utilization}%, extra ${wu.extraUsage?.utilization ?? 0}%`);
} catch (err) {
  console.error('Failed:', err.message);
  process.exit(1);
}
