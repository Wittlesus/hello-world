import { create } from 'zustand';

export interface ActivityItem {
  id: string;
  type: string;
  description: string;
  details: string;
  timestamp: string;
}

export interface ApprovalItem {
  id: string;
  action: string;
  description: string;
  tier: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

interface ActivityState {
  activities: ActivityItem[];
  approvals: ApprovalItem[];
  addActivity: (item: ActivityItem) => void;
  addApproval: (item: ApprovalItem) => void;
  resolveApproval: (id: string, status: 'approved' | 'rejected') => void;
  clearActivities: () => void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  activities: [],
  approvals: [],
  addActivity: (item) => set((s) => ({ activities: [item, ...s.activities].slice(0, 200) })),
  addApproval: (item) => set((s) => ({ approvals: [...s.approvals, item] })),
  resolveApproval: (id, status) =>
    set((s) => ({
      approvals: s.approvals.map((a) => (a.id === id ? { ...a, status } : a)),
    })),
  clearActivities: () => set({ activities: [] }),
}));
