import type { Idea, Tag, SavedFilter, AppPreferences } from '../types';
import { DEFAULT_PREFERENCES } from '../types';

const KEYS = {
  IDEAS: 'iv_ideas',
  TAGS: 'iv_tags',
  SAVED_FILTERS: 'iv_saved_filters',
  PREFERENCES: 'iv_preferences',
  UNDO_STACK: 'iv_undo_stack',
  VERSION: 'iv_schema_version',
  PENDING: 'iv_pending_writes',
  VERSIONS: 'iv_record_versions',
  CONFLICT: 'iv_sync_conflict',
} as const;

const CURRENT_VERSION = 2;

function migrate(raw: unknown, version: number): unknown {
  // v1 → v2: add comments/history arrays if missing
  if (version < 2 && Array.isArray(raw)) {
    return (raw as Idea[]).map((idea) => ({
      ...idea,
      comments: idea.comments ?? [],
      history: idea.history ?? [],
      pinned: idea.pinned ?? false,
      position: idea.position ?? 0,
    }));
  }
  return raw;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type PendingWrite = { key: string; id: string; value: unknown; expectedVersion: number };
type Versions = Record<string, Record<string, number>>;
let flushPromise: Promise<void> | null = null;
let localRevision = 0;
export function getLocalRevision(): number { return localRevision; }
function syncEvent(status: 'pending' | 'synced' | 'offline' | 'conflict') {
  window.dispatchEvent(new CustomEvent('iv-sync', { detail: status }));
}
export function hasPendingWrites(): boolean { return load<PendingWrite[]>(KEYS.PENDING, []).length > 0; }
export function pendingWriteCount(): number { return load<PendingWrite[]>(KEYS.PENDING, []).length; }
export type SyncConflict = { key: string; id: string; local: unknown; remote: unknown; remoteVersion: number };
export function getSyncConflict(): SyncConflict | null { return load<SyncConflict | null>(KEYS.CONFLICT, null); }
export async function resolveSyncConflict(choice: 'local' | 'remote'): Promise<void> {
  const conflict = getSyncConflict();
  if (!conflict) return;
  const pending = load<PendingWrite[]>(KEYS.PENDING, []);
  const item = pending.find((entry) => entry.key === conflict.key && entry.id === conflict.id);
  if (item) {
    if (choice === 'local') item.expectedVersion = conflict.remoteVersion;
    else pending.splice(pending.indexOf(item), 1);
    localStorage.setItem(KEYS.PENDING, JSON.stringify(pending));
  }
  localStorage.removeItem(KEYS.CONFLICT);
  if (choice === 'remote') syncEvent('pending');
  await flushPendingWrites();
}
export function updateServerVersions(versions: Versions): void { localStorage.setItem(KEYS.VERSIONS, JSON.stringify(versions)); }
export function cacheServerData(data: { ideas: Idea[]; tags: Tag[]; savedFilters: SavedFilter[]; preferences: AppPreferences }): void {
  localStorage.setItem(KEYS.IDEAS, JSON.stringify(data.ideas));
  localStorage.setItem(KEYS.TAGS, JSON.stringify(data.tags));
  localStorage.setItem(KEYS.SAVED_FILTERS, JSON.stringify(data.savedFilters));
  localStorage.setItem(KEYS.PREFERENCES, JSON.stringify(data.preferences));
}
function rows(key: string, value: unknown): Record<string, unknown> {
  if (key === KEYS.PREFERENCES) return { prefs: value };
  return Object.fromEntries((value as { id: string }[]).map((row) => [row.id, row]));
}
function queueChanges(key: string, oldValue: unknown, value: unknown): void {
  const endpointMap: Record<string, string> = { [KEYS.IDEAS]: 'ideas', [KEYS.TAGS]: 'tags', [KEYS.SAVED_FILTERS]: 'savedFilters', [KEYS.PREFERENCES]: 'preferences' };
  const collection = endpointMap[key];
  if (!collection) return;
  localRevision++;
  const before = rows(key, oldValue);
  const after = rows(key, value);
  const versions = load<Versions>(KEYS.VERSIONS, {});
  const pending = load<PendingWrite[]>(KEYS.PENDING, []);
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[id]) === JSON.stringify(after[id])) continue;
    const existing = pending.find((item) => item.key === collection && item.id === id);
    if (existing) existing.value = after[id] ?? null;
    else pending.push({ key: collection, id, value: after[id] ?? null, expectedVersion: versions[collection]?.[id] ?? 0 });
  }
  localStorage.setItem(KEYS.PENDING, JSON.stringify(pending));
  if (pending.length) { syncEvent('pending'); void flushPendingWrites(); }
}
export function flushPendingWrites(): Promise<void> {
  if (flushPromise) return flushPromise;
  flushPromise = drainPendingWrites()
    .catch(() => { syncEvent('offline'); })
    .finally(() => { flushPromise = null; });
  return flushPromise;
}
async function drainPendingWrites(): Promise<void> {
  if (getSyncConflict()) { syncEvent('conflict'); return; }
  while (true) {
    const pending = load<PendingWrite[]>(KEYS.PENDING, []);
    if (!pending.length) { syncEvent('synced'); break; }
    const item = pending[0];
    let response: Response;
    try { response = await fetch(`/api/records/${item.key}/${encodeURIComponent(item.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: item.expectedVersion, value: item.value }) }); }
    catch { syncEvent('offline'); break; }
    if (response.status === 409) {
      const data = await response.json();
      localStorage.setItem(KEYS.CONFLICT, JSON.stringify({ key: item.key, id: item.id, local: item.value, remote: data.current, remoteVersion: data.version }));
      syncEvent('conflict'); break;
    }
    if (!response.ok) { syncEvent('offline'); break; }
    const result = await response.json();
    const versions = load<Versions>(KEYS.VERSIONS, {});
    versions[item.key] = { ...(versions[item.key] || {}), [item.id]: result.version };
    updateServerVersions(versions);
    const latest = load<PendingWrite[]>(KEYS.PENDING, []);
    if (latest[0]?.key === item.key && latest[0]?.id === item.id) {
      if (JSON.stringify(latest[0].value) === JSON.stringify(item.value)) latest.shift();
      else latest[0].expectedVersion = result.version;
      localStorage.setItem(KEYS.PENDING, JSON.stringify(latest));
    }
  }
}

function save<T>(key: string, value: T): void {
  const previous = load<unknown>(key, key === KEYS.PREFERENCES ? {} : []);
  try {
    localStorage.setItem(key, JSON.stringify(value));
    queueChanges(key, previous, value);
  } catch (e: any) {
    console.error('Storage write failed', key, e);
    if (e.name === 'QuotaExceededError') {
      throw e;
    }
  }

}

// ─── Ideas ───────────────────────────────────────────────────────────────────

export function loadIdeas(): Idea[] {
  const version = load<number>(KEYS.VERSION, 1);
  const raw = load<Idea[]>(KEYS.IDEAS, []);
  const migrated = migrate(raw, version) as Idea[];
  if (version < CURRENT_VERSION) {
    save(KEYS.VERSION, CURRENT_VERSION);
    save(KEYS.IDEAS, migrated);
  }
  return migrated;
}

export function saveIdeas(ideas: Idea[]): void {
  save(KEYS.IDEAS, ideas);
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

export function loadTags(): Tag[] {
  return load<Tag[]>(KEYS.TAGS, []);
}

export function saveTags(tags: Tag[]): void {
  save(KEYS.TAGS, tags);
}

// ─── Saved Filters ────────────────────────────────────────────────────────────

export function loadSavedFilters(): SavedFilter[] {
  return load<SavedFilter[]>(KEYS.SAVED_FILTERS, []);
}

export function saveSavedFilters(filters: SavedFilter[]): void {
  save(KEYS.SAVED_FILTERS, filters);
}

// ─── Preferences ──────────────────────────────────────────────────────────────

export function loadPreferences(): AppPreferences {
  const stored = load<Partial<AppPreferences>>(KEYS.PREFERENCES, {});
  return { ...DEFAULT_PREFERENCES, ...stored };
}

export function savePreferences(prefs: AppPreferences): void {
  save(KEYS.PREFERENCES, prefs);
}

// ─── Undo Stack ───────────────────────────────────────────────────────────────

export function loadUndoStack(): Idea[][] {
  return load<Idea[][]>(KEYS.UNDO_STACK, []);
}

export function saveUndoStack(stack: Idea[][]): void {
  save(KEYS.UNDO_STACK, stack);
}

// ─── Export / Import ──────────────────────────────────────────────────────────

export interface ExportData {
  version: number;
  exportedAt: string;
  ideas: Idea[];
  tags: Tag[];
  savedFilters: SavedFilter[];
  preferences?: AppPreferences;
}

export function exportToJSON(ideas: Idea[], tags: Tag[], savedFilters: SavedFilter[], preferences?: AppPreferences): string {
  const data: ExportData = {
    version: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    ideas,
    tags,
    savedFilters,
    preferences,
  };
  return JSON.stringify(data, null, 2);
}

export function exportToCSV(ideas: Idea[], tags: Tag[]): string {
  const tagMap = Object.fromEntries(tags.map((t) => [t.id, t.name]));
  const headers = ['id', 'title', 'description', 'status', 'priority', 'tags', 'pinned', 'createdAt', 'updatedAt'];
  const rows = ideas
    .filter((i) => !i.deletedAt)
    .map((idea) => [
      idea.id,
      `"${(idea.title || '').replace(/"/g, '""')}"`,
      `"${(idea.description || '').replace(/"/g, '""').replace(/\n/g, '\\n')}"`,
      idea.status,
      idea.priority,
      `"${idea.tagIds.map((tid) => tagMap[tid] ?? tid).join(', ')}"`,
      idea.pinned,
      idea.createdAt,
      idea.updatedAt,
    ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function exportToMarkdown(ideas: Idea[], tags: Tag[]): string {
  const tagMap = Object.fromEntries(tags.map((t) => [t.id, t.name]));
  const active = ideas.filter((i) => !i.deletedAt);
  const sections: string[] = ['# Idea Vault Export\n'];
  sections.push(`> Exported ${new Date().toLocaleDateString()} · ${active.length} ideas\n`);

  const grouped = active.reduce<Record<string, Idea[]>>((acc, idea) => {
    (acc[idea.status] = acc[idea.status] ?? []).push(idea);
    return acc;
  }, {});

  for (const status of ['idea', 'planned', 'building', 'done', 'archived'] as const) {
    const group = grouped[status];
    if (!group?.length) continue;
    sections.push(`\n## ${status.charAt(0).toUpperCase() + status.slice(1)}\n`);
    for (const idea of group) {
      sections.push(`### ${idea.title}`);
      sections.push(`**Priority:** ${idea.priority} | **Tags:** ${idea.tagIds.map((t) => tagMap[t] ?? t).join(', ') || 'none'}`);
      sections.push(`**Created:** ${new Date(idea.createdAt).toLocaleDateString()}\n`);
      if (idea.description) sections.push(idea.description + '\n');
      sections.push('---\n');
    }
  }
  return sections.join('\n');
}

export function importFromJSON(jsonString: string): ExportData {
  const data = JSON.parse(jsonString) as ExportData;
  if (!data || !Array.isArray(data.ideas) || !Array.isArray(data.tags) || !Array.isArray(data.savedFilters)) throw new Error('Invalid Idea Vault export');
  for (const idea of data.ideas) if (!idea || typeof idea.id !== 'string' || typeof idea.title !== 'string' || !Array.isArray(idea.tagIds)) throw new Error('Invalid idea record');
  for (const tag of data.tags) if (!tag || typeof tag.id !== 'string' || typeof tag.name !== 'string') throw new Error('Invalid tag record');
  return data;
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Analytics helpers ────────────────────────────────────────────────────────

export function computeAnalytics(ideas: Idea[]) {
  const active = ideas.filter((i) => !i.deletedAt);
  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 86400000);
  const d30 = new Date(now.getTime() - 30 * 86400000);

  const byStatus = { idea: 0, planned: 0, building: 0, done: 0, archived: 0 };
  const byPriority = { low: 0, medium: 0, high: 0 };
  let created7d = 0, created30d = 0, doneThisWeek = 0;

  for (const idea of active) {
    byStatus[idea.status]++;
    byPriority[idea.priority]++;
    const createdDate = new Date(idea.createdAt);
    if (createdDate >= d7) created7d++;
    if (createdDate >= d30) created30d++;
    if (idea.status === 'done' && new Date(idea.updatedAt) >= d7) doneThisWeek++;
  }

  // Build velocity (ideas created per day over last 14 days)
  const velocity: { date: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 86400000);
    const dateStr = date.toISOString().split('T')[0];
    const count = active.filter((idea) => idea.createdAt.startsWith(dateStr)).length;
    velocity.push({ date: dateStr, count });
  }

  // Streak: consecutive days with at least one idea created
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const date = new Date(now.getTime() - i * 86400000);
    const dateStr = date.toISOString().split('T')[0];
    const hasIdea = active.some((idea) => idea.createdAt.startsWith(dateStr));
    if (hasIdea) streak++;
    else break;
  }

  return { total: active.length, byStatus, byPriority, created7d, created30d, doneThisWeek, streak, velocity };
}
