// ─── Core Types ──────────────────────────────────────────────────────────────

export type Status = 'idea' | 'planned' | 'building' | 'done' | 'archived';
export type Priority = 'low' | 'medium' | 'high';
export type ViewMode = 'grid' | 'list' | 'board' | 'timeline';
export type Theme = 'dark' | 'light' | 'system' | 'midnight' | 'cyberpunk' | 'forest';
export type SortField = 'createdAt' | 'updatedAt' | 'title' | 'priority' | 'status' | 'score';
export type IdeaKind = 'product' | 'feature' | 'problem' | 'project' | 'learning' | 'content';
export type SortDir = 'asc' | 'desc';

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  ideaId: string;
  timestamp: string;
  changes: Partial<Omit<Idea, 'id' | 'createdAt' | 'history'>>;
  snapshot: Omit<Idea, 'history'>;
}

export interface Comment {
  id: string;
  ideaId: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Idea {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  tagIds: string[];
  pinned: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  comments: Comment[];
  history: HistoryEntry[];
  template?: string;
  techStack?: string;
  estimatedTime?: string;
  teamSize?: number;
  nextAction?: string;
  links?: string[];
  completionNote?: string;
  capturedAt?: string;
  processedAt?: string;
  dueDate?: string;
  reviewAt?: string;
  evaluation?: IdeaEvaluation;
  kind?: IdeaKind;
  completedActions?: { body: string; completedAt: string }[];
}

export interface IdeaEvaluation {
  problemSeverity: number;
  excitement: number;
  strategicFit: number;
  effort: number;
  confidence: number;
  evidence?: string;
}

export interface SavedFilter {
  id: string;
  name: string;
  filters: FilterState;
  createdAt: string;
}

export interface FilterState {
  search: string;
  status: Status[];
  priority: Priority[];
  tagIds: string[];
  pinned: boolean | null;
  dateFrom: string;
  dateTo: string;
  sortField: SortField;
  sortDir: SortDir;
  minScore: number | null;
}

export interface AppPreferences {
  theme: Theme;
  viewMode: ViewMode;
  sidebarCollapsed: boolean;
  defaultStatus: Status;
  defaultPriority: Priority;
  autoSaveMs: number;
  undoStackSize: number;
}

export interface Analytics {
  total: number;
  byStatus: Record<Status, number>;
  byPriority: Record<Priority, number>;
  created7d: number;
  created30d: number;
  doneThisWeek: number;
  streak: number;
  velocity: { date: string; count: number }[];
}

export const STATUS_ORDER: Status[] = ['idea', 'planned', 'building', 'done', 'archived'];
export const STATUS_LABELS: Record<Status, string> = {
  idea: 'Idea',
  planned: 'Planned',
  building: 'Building',
  done: 'Done',
  archived: 'Archived',
};
export const STATUS_COLORS: Record<Status, string> = {
  idea: '#a78bfa',
  planned: '#60a5fa',
  building: '#f59e0b',
  done: '#34d399',
  archived: '#6b7280',
};
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};
export const PRIORITY_COLORS: Record<Priority, string> = {
  low: '#6b7280',
  medium: '#f59e0b',
  high: '#ef4444',
};
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export const DEFAULT_FILTER_STATE: FilterState = {
  search: '',
  status: [],
  priority: [],
  tagIds: [],
  pinned: null,
  dateFrom: '',
  dateTo: '',
  sortField: 'updatedAt',
  sortDir: 'desc',
  minScore: null,
};

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'dark',
  viewMode: 'grid',
  sidebarCollapsed: false,
  defaultStatus: 'idea',
  defaultPriority: 'medium',
  autoSaveMs: 800,
  undoStackSize: 10,
};

export const IDEA_TEMPLATES: { id: string; name: string; fields: Partial<Idea> }[] = [
  {
    id: 'product',
    name: '🚀 Product',
    fields: { status: 'idea', priority: 'medium', description: '## Problem\n\n## Solution\n\n## Target Audience\n\n## Monetization\n' },
  },
  {
    id: 'feature',
    name: '✨ Feature',
    fields: { status: 'idea', priority: 'medium', description: '## User Story\n\n## Requirements\n\n## Metrics / Success\n' },
  },
  {
    id: 'problem',
    name: '🔍 Problem',
    fields: { status: 'idea', priority: 'high', description: '## Description\n\n## Impact\n\n## Potential Solutions\n' },
  },
  {
    id: 'content',
    name: '✍️ Content',
    fields: { status: 'idea', priority: 'medium', description: '## Topic\n\n## Format (blog/video)\n\n## Target Audience\n\n## Outline\n' },
  },
  {
    id: 'learning',
    name: '📚 Learning',
    fields: { status: 'idea', priority: 'low', description: '## Topic\n\n## Goal\n\n## Resources\n' },
  },
  {
    id: 'project',
    name: '🛠 Project',
    fields: { status: 'idea', priority: 'medium', description: '## What it does\n\n## Tech Stack\n\n## Next Steps\n' },
  },
];
