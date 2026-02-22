import { JsonStore } from './storage.js';
import { generateId, now } from './utils.js';

export type ActivityType =
  | 'session_start'
  | 'session_end'
  | 'memory_stored'
  | 'memory_retrieved'
  | 'task_added'
  | 'task_updated'
  | 'decision_recorded'
  | 'approval_requested'
  | 'approval_auto'
  | 'approval_resolved'
  | 'strike_recorded'
  | 'strike_halt'
  | 'question_added'
  | 'question_answered'
  | 'context_loaded'
  | 'handoff_written'
  | 'handoff_loaded';

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  description: string;
  details: string;
  timestamp: string;
}

interface ActivityData {
  activities: ActivityEvent[];
}

const MAX_EVENTS = 500;

export class ActivityStore {
  private store: JsonStore<ActivityData>;

  constructor(projectRoot: string) {
    this.store = new JsonStore<ActivityData>(projectRoot, 'activity.json', { activities: [] });
  }

  append(type: ActivityType, description: string, details = ''): ActivityEvent {
    const event: ActivityEvent = {
      id: generateId('act'),
      type,
      description,
      details,
      timestamp: now(),
    };

    this.store.update(data => {
      const activities = [...data.activities, event];
      // Cap at MAX_EVENTS, keeping newest
      return { activities: activities.slice(-MAX_EVENTS) };
    });

    return event;
  }

  getRecent(count = 200): ActivityEvent[] {
    const all = this.store.read().activities;
    return all.slice(-count).reverse(); // newest first
  }

  getAll(): ActivityEvent[] {
    return this.store.read().activities.slice().reverse(); // newest first
  }
}
