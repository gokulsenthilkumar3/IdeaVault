import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type {
  Idea, Tag, SavedFilter, AppPreferences, FilterState,
  Status, Priority, ViewMode, Theme
} from '../types';
import type { ExportData } from '../lib/storage';
import { isInboxIdea, scoreIdea } from '../lib/ideaLogic';
import { DEFAULT_FILTER_STATE, PRIORITY_WEIGHT, DEFAULT_PREFERENCES } from '../types';
import {
  loadIdeas, saveIdeas, loadTags, saveTags,
  loadSavedFilters, saveSavedFilters,
  loadPreferences, savePreferences,
  hasPendingWrites, updateServerVersions, cacheServerData, flushPendingWrites, getLocalRevision,
} from '../lib/storage';

// ─── Store State ──────────────────────────────────────────────────────────────

export interface StoreState {
  // Data
  ideas: Idea[];
  tags: Tag[];
  savedFilters: SavedFilter[];
  preferences: AppPreferences;

  // UI State
  filters: FilterState;
  selectedIds: Set<string>;
  expandedIdeaId: string | null;
  commandPaletteOpen: boolean;
  quickCaptureOpen: boolean;
  undoStack: { ideas: Idea[]; tags: Tag[] }[];
  syncStatus: 'loading' | 'synced' | 'pending' | 'offline' | 'conflict';

  // Actions — Ideas
  createIdea: (partial?: Partial<Idea>) => Idea;
  updateIdea: (id: string, patch: Partial<Idea>) => void;
  deleteIdea: (id: string) => void;
  restoreIdea: (id: string) => void;
  hardDeleteIdea: (id: string) => void;
  hardDeleteIdeas: (ids: string[]) => void;
  duplicateIdea: (id: string) => void;
  togglePin: (id: string) => void;
  changeStatus: (id: string, status: Status) => void;
  changePriority: (id: string, priority: Priority) => void;
  reorderIdeas: (ids: string[]) => void;

  // Bulk actions
  toggleSelect: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  bulkDelete: () => void;
  bulkChangeStatus: (status: Status) => void;
  bulkChangePriority: (priority: Priority) => void;
  bulkAddTag: (tagId: string) => void;
  processIdea: (id: string, status?: Status) => void;
  deferIdea: (id: string, reviewAt: string) => void;

  // Undo
  undo: () => void;
  pushUndo: () => void;

  // Comments
  addComment: (ideaId: string, body: string) => void;
  deleteComment: (ideaId: string, commentId: string) => void;

  // Tags
  createTag: (name: string, color?: string) => Tag;
  updateTag: (id: string, patch: Partial<Tag>) => void;
  deleteTag: (id: string) => void;
  mergeTags: (fromIds: string[], intoId: string) => void;

  // Filters
  setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  resetFilters: () => void;
  saveCurrentFilter: (name: string) => void;
  loadSavedFilter: (id: string) => void;
  deleteSavedFilter: (id: string) => void;

  // Preferences
  setPreference: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void;
  setViewMode: (mode: ViewMode) => void;
  setTheme: (theme: Theme) => void;

  // UI
  openIdea: (id: string | null) => void;
  setCommandPalette: (open: boolean) => void;
  setQuickCapture: (open: boolean) => void;
  completeNextAction: (id: string) => void;

  // Derived
  getFilteredIdeas: () => Idea[];
  getIdeaById: (id: string) => Idea | undefined;
  getInboxIdeas: () => Idea[];
  importData: (data: ExportData) => { ideas: number; tags: number; conflicts: number };

  // Server Sync
  syncFromServer: () => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function patchIdea(idea: Idea, patch: Partial<Idea>): Idea {
  const timestamp = now();
  const { history = [], ...snapshot } = idea;
  return {
    ...idea,
    ...patch,
    updatedAt: timestamp,
    history: [{ id: uuid(), ideaId: idea.id, timestamp, changes: patch, snapshot }, ...history].slice(0, 5),
  };
}

function newIdea(partial: Partial<Idea> = {}, prefs: AppPreferences, existingCount: number): Idea {
  return {
    id: uuid(),
    title: '',
    description: '',
    status: prefs.defaultStatus,
    priority: prefs.defaultPriority,
    tagIds: [],
    pinned: false,
    position: existingCount,
    createdAt: now(),
    updatedAt: now(),
    comments: [],
    history: [],
    capturedAt: now(),
    ...partial,
  };
}

function applyFilters(ideas: Idea[], filters: FilterState, tags: Tag[]): Idea[] {
  let result = ideas.filter((i) => !i.deletedAt);

  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.tagIds.some((tid) => {
          const tag = tags.find((t) => t.id === tid);
          return tag?.name.toLowerCase().includes(q);
        }) ||
        i.comments.some((c) => c.body.toLowerCase().includes(q))
    );
  }

  if (filters.status.length > 0) {
    result = result.filter((i) => filters.status.includes(i.status));
  }
  if (filters.priority.length > 0) {
    result = result.filter((i) => filters.priority.includes(i.priority));
  }
  if (filters.tagIds.length > 0) {
    result = result.filter((i) => filters.tagIds.some((tid) => i.tagIds.includes(tid)));
  }
  if (filters.pinned !== null) {
    result = result.filter((i) => i.pinned === filters.pinned);
  }
  if (filters.minScore !== null && filters.minScore !== undefined) {
    result = result.filter((i) => i.evaluation && scoreIdea(i.evaluation) >= filters.minScore!);
  }
  if (filters.dateFrom) {
    result = result.filter((i) => i.createdAt >= filters.dateFrom);
  }
  if (filters.dateTo) {
    result = result.filter((i) => i.createdAt <= filters.dateTo + 'T23:59:59Z');
  }

  // Sort
  result.sort((a, b) => {
    let cmp = 0;
    switch (filters.sortField) {
      case 'title':
        cmp = a.title.localeCompare(b.title);
        break;
      case 'priority':
        cmp = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
        break;
      case 'score':
        cmp = scoreIdea(a.evaluation) - scoreIdea(b.evaluation);
        break;
      case 'status':
        cmp = ['idea','planned','building','done','archived'].indexOf(a.status) - ['idea','planned','building','done','archived'].indexOf(b.status);
        break;
      case 'createdAt':
        cmp = a.createdAt.localeCompare(b.createdAt);
        break;
      case 'updatedAt':
      default:
        cmp = a.updatedAt.localeCompare(b.updatedAt);
    }
    return filters.sortDir === 'asc' ? cmp : -cmp;
  });

  // Pinned always first
  result.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  return result;
}

// ─── Store ────────────────────────────────────────────────────────────────────
let syncRequest = 0;

export const useStore = create<StoreState>()(
  subscribeWithSelector((set, get) => ({
    ideas: loadIdeas(),
    tags: loadTags(),
    savedFilters: loadSavedFilters(),
    preferences: loadPreferences(),
    filters: DEFAULT_FILTER_STATE,
    selectedIds: new Set<string>(),
    expandedIdeaId: null,
    commandPaletteOpen: false,
    quickCaptureOpen: false,
    undoStack: [],
    syncStatus: 'loading',

    // ── Undo ────────────────────────────────────────────────────────────────

    pushUndo() {
      const { ideas, tags, undoStack, preferences } = get();
      // Store references directly — arrays are already immutable (patchIdea creates new arrays).
      // structuredClone is far too expensive for large vaults.
      const newStack = [{ ideas, tags }, ...undoStack].slice(0, preferences.undoStackSize);
      set({ undoStack: newStack });
    },

    undo() {
      const { undoStack } = get();
      if (undoStack.length === 0) return;
      const [prev, ...rest] = undoStack;
      set({ ideas: prev.ideas, tags: prev.tags, undoStack: rest });
      saveIdeas(prev.ideas);
      saveTags(prev.tags);
    },

    // ── Ideas ────────────────────────────────────────────────────────────────

    createIdea(partial = {}) {
      get().pushUndo();
      const { ideas, preferences } = get();
      const idea = newIdea(partial, preferences, ideas.filter((i) => !i.deletedAt).length);
      const updated = [idea, ...ideas];
      set({ ideas: updated });
      saveIdeas(updated);
      return idea;
    },

    updateIdea(id, patch) {
      get().pushUndo();
      const { ideas } = get();
      const updated = ideas.map((i) => i.id === id ? patchIdea(i, patch) : i);
      set({ ideas: updated });
      saveIdeas(updated);
    },

    deleteIdea(id) {
      get().pushUndo();
      const { ideas } = get();
      const updated = ideas.map((i) => (i.id === id ? patchIdea(i, { deletedAt: now() }) : i));
      set({ ideas: updated });
      saveIdeas(updated);
    },

    restoreIdea(id) {
      get().pushUndo();
      const { ideas } = get();
      const updated = ideas.map((i) =>
        i.id === id ? patchIdea(i, { deletedAt: undefined }) : i
      );
      set({ ideas: updated });
      saveIdeas(updated);
    },

    hardDeleteIdea(id) {
      get().pushUndo();
      const { ideas } = get();
      const updated = ideas.filter((i) => i.id !== id);
      set({ ideas: updated });
      saveIdeas(updated);
    },

    hardDeleteIdeas(ids) {
      get().pushUndo();
      const { ideas } = get();
      const idSet = new Set(ids);
      const updated = ideas.filter((i) => !idSet.has(i.id));
      set({ ideas: updated });
      saveIdeas(updated);
    },

    duplicateIdea(id) {
      get().pushUndo();
      const { ideas } = get();
      const source = ideas.find((i) => i.id === id);
      if (!source) return;
      const copy: Idea = {
        ...source,
        id: uuid(),
        title: source.title + ' (copy)',
        createdAt: now(),
        updatedAt: now(),
        deletedAt: undefined,
        comments: [],
        history: [],
        pinned: false,
        capturedAt: now(),
        processedAt: now(),
      };
      const updated = [copy, ...ideas];
      set({ ideas: updated });
      saveIdeas(updated);
    },

    togglePin(id) {
      get().updateIdea(id, { pinned: !get().ideas.find((i) => i.id === id)?.pinned });
    },

    changeStatus(id, status) {
      get().updateIdea(id, { status });
    },

    changePriority(id, priority) {
      get().updateIdea(id, { priority });
    },

    reorderIdeas(ids) {
      get().pushUndo();
      const { ideas } = get();
      const updated = ideas.map((i) => {
        const pos = ids.indexOf(i.id);
        return pos >= 0 && pos !== i.position ? patchIdea(i, { position: pos }) : i;
      });
      set({ ideas: updated });
      saveIdeas(updated);
    },

    // ── Bulk ─────────────────────────────────────────────────────────────────

    toggleSelect(id) {
      const next = new Set(get().selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      set({ selectedIds: next });
    },

    selectAll(ids) {
      set({ selectedIds: new Set(ids) });
    },

    clearSelection() {
      set({ selectedIds: new Set() });
    },

    bulkDelete() {
      const { selectedIds } = get();
      get().pushUndo();
      const { ideas } = get();
      const updated = ideas.map((i) =>
        selectedIds.has(i.id) ? patchIdea(i, { deletedAt: now() }) : i
      );
      set({ ideas: updated, selectedIds: new Set() });
      saveIdeas(updated);
    },

    bulkChangeStatus(status) {
      const { selectedIds } = get();
      get().pushUndo();
      const { ideas } = get();
      const updated = ideas.map((i) =>
        selectedIds.has(i.id) ? patchIdea(i, { status }) : i
      );
      set({ ideas: updated, selectedIds: new Set() });
      saveIdeas(updated);
    },

    bulkChangePriority(priority) {
      const { selectedIds } = get();
      get().pushUndo();
      const { ideas } = get();
      const updated = ideas.map((i) =>
        selectedIds.has(i.id) ? patchIdea(i, { priority }) : i
      );
      set({ ideas: updated, selectedIds: new Set() });
      saveIdeas(updated);
    },

    bulkAddTag(tagId) {
      const { selectedIds } = get();
      get().pushUndo();
      const { ideas } = get();
      const updated = ideas.map((i) =>
        selectedIds.has(i.id) && !i.tagIds.includes(tagId)
          ? patchIdea(i, { tagIds: [...i.tagIds, tagId] })
          : i
      );
      set({ ideas: updated, selectedIds: new Set() });
      saveIdeas(updated);
    },

    processIdea(id, status = 'idea') {
      get().updateIdea(id, { status, processedAt: now() });
    },

    completeNextAction(id) {
      const idea = get().ideas.find((item) => item.id === id);
      if (!idea?.nextAction?.trim()) return;
      get().updateIdea(id, {
        completedActions: [...(idea.completedActions ?? []), { body: idea.nextAction.trim(), completedAt: now() }],
        nextAction: '',
      });
    },

    deferIdea(id, reviewAt) {
      get().updateIdea(id, { reviewAt });
    },

    // ── Comments ──────────────────────────────────────────────────────────────

    addComment(ideaId, body) {
      const idea = get().ideas.find((item) => item.id === ideaId);
      if (!idea) return;
      const comment = { id: uuid(), ideaId, body, createdAt: now() };
      get().updateIdea(ideaId, { comments: [...idea.comments, comment] });
    },

    deleteComment(ideaId, commentId) {
      const idea = get().ideas.find((item) => item.id === ideaId);
      if (!idea) return;
      get().updateIdea(ideaId, { comments: idea.comments.filter((c) => c.id !== commentId) });
    },

    // ── Tags ──────────────────────────────────────────────────────────────────

    createTag(name, color = '#7c5cff') {
      get().pushUndo();
      const { tags } = get();
      const tag: Tag = { id: uuid(), name, color, createdAt: now() };
      const updated = [...tags, tag];
      set({ tags: updated });
      saveTags(updated);
      return tag;
    },

    updateTag(id, patch) {
      get().pushUndo();
      const { tags } = get();
      const updated = tags.map((t) => (t.id === id ? { ...t, ...patch } : t));
      set({ tags: updated });
      saveTags(updated);
    },

    deleteTag(id) {
      get().pushUndo();
      const { tags, ideas } = get();
      const updatedTags = tags.filter((t) => t.id !== id);
      const updatedIdeas = ideas.map((i) => i.tagIds.includes(id) ? patchIdea(i, { tagIds: i.tagIds.filter((tid) => tid !== id) }) : i);
      set({ tags: updatedTags, ideas: updatedIdeas });
      saveTags(updatedTags);
      saveIdeas(updatedIdeas);
    },

    mergeTags(fromIds, intoId) {
      get().pushUndo();
      const { tags, ideas } = get();
      const updatedTags = tags.filter((t) => !fromIds.includes(t.id));
      const updatedIdeas = ideas.map((i) => {
        const hasFrom = i.tagIds.some((tid) => fromIds.includes(tid));
        if (!hasFrom) return i;
        const without = i.tagIds.filter((tid) => !fromIds.includes(tid));
        const tagIds = without.includes(intoId) ? without : [...without, intoId];
        return patchIdea(i, { tagIds });
      });
      set({ tags: updatedTags, ideas: updatedIdeas });
      saveTags(updatedTags);
      saveIdeas(updatedIdeas);
    },

    // ── Filters ───────────────────────────────────────────────────────────────

    setFilter(key, value) {
      set((state) => ({ filters: { ...state.filters, [key]: value } }));
    },

    resetFilters() {
      set({ filters: DEFAULT_FILTER_STATE });
    },

    saveCurrentFilter(name) {
      const { filters, savedFilters } = get();
      const sf: SavedFilter = { id: uuid(), name, filters: { ...filters }, createdAt: now() };
      const updated = [...savedFilters, sf];
      set({ savedFilters: updated });
      saveSavedFilters(updated);
    },

    loadSavedFilter(id) {
      const { savedFilters } = get();
      const sf = savedFilters.find((f) => f.id === id);
      if (sf) set({ filters: { ...sf.filters } });
    },

    deleteSavedFilter(id) {
      const { savedFilters } = get();
      const updated = savedFilters.filter((f) => f.id !== id);
      set({ savedFilters: updated });
      saveSavedFilters(updated);
    },

    // ── Preferences ───────────────────────────────────────────────────────────

    setPreference(key, value) {
      const { preferences } = get();
      const updated = { ...preferences, [key]: value };
      set({ preferences: updated });
      savePreferences(updated);
    },

    setViewMode(mode) {
      get().setPreference('viewMode', mode);
    },

    setTheme(theme) {
      get().setPreference('theme', theme);
    },

    // ── UI ────────────────────────────────────────────────────────────────────

    openIdea(id) {
      set({ expandedIdeaId: id, quickCaptureOpen: false, commandPaletteOpen: false });
    },

    setCommandPalette(open) {
      set({ commandPaletteOpen: open, expandedIdeaId: open ? null : get().expandedIdeaId, quickCaptureOpen: false });
    },

    setQuickCapture(open) {
      set({ quickCaptureOpen: open, expandedIdeaId: open ? null : get().expandedIdeaId, commandPaletteOpen: false });
    },

    // ── Derived ───────────────────────────────────────────────────────────────

    getFilteredIdeas() {
      const { ideas, filters, tags } = get();
      return applyFilters(ideas, filters, tags);
    },

    getIdeaById(id) {
      return get().ideas.find((i) => i.id === id);
    },

    getInboxIdeas() {
      return get().ideas.filter(isInboxIdea);
    },

    importData(data) {
      const state = get();
      const ideaIds = new Set(state.ideas.map((item) => item.id));
      const tagIds = new Set(state.tags.map((item) => item.id));
      const filterIds = new Set(state.savedFilters.map((item) => item.id));
      const incomingIdeas = data.ideas.filter((item) => !ideaIds.has(item.id)).map((item) => ({ ...item, comments: item.comments ?? [], history: item.history ?? [] }));
      const incomingTags = data.tags.filter((item) => !tagIds.has(item.id));
      const incomingFilters = data.savedFilters.filter((item) => !filterIds.has(item.id));
      const ideas = [...state.ideas, ...incomingIdeas];
      const tags = [...state.tags, ...incomingTags];
      const savedFilters = [...state.savedFilters, ...incomingFilters];
      state.pushUndo();
      set({ ideas, tags, savedFilters });
      saveIdeas(ideas); saveTags(tags); saveSavedFilters(savedFilters);
      return { ideas: incomingIdeas.length, tags: incomingTags.length, conflicts: data.ideas.length - incomingIdeas.length + data.tags.length - incomingTags.length + data.savedFilters.length - incomingFilters.length };
    },

    async syncFromServer() {
      const request = ++syncRequest;
      try {
        await flushPendingWrites();
        if (hasPendingWrites() || request !== syncRequest) return;
        const revision = getLocalRevision();
        const res = await fetch('/api/data');
        if (res.ok) {
          const data = await res.json();
          if (request !== syncRequest) return;
          // A response requested before a local edit must never replace that edit.
          if (revision !== getLocalRevision() || hasPendingWrites()) return get().syncFromServer();
          const localIdeas = get().ideas;
          const localTags = get().tags;

          updateServerVersions(data.versions || {});
          const preferences = data.preferences && Object.keys(data.preferences).length > 0
            ? { ...DEFAULT_PREFERENCES, ...data.preferences } : get().preferences;
          cacheServerData({ ideas: data.ideas || localIdeas, tags: data.tags || localTags, savedFilters: data.savedFilters || get().savedFilters, preferences });

          set({
            ideas: data.ideas || localIdeas,
            tags: data.tags || localTags,
            savedFilters: data.savedFilters || get().savedFilters,
            preferences,
            syncStatus: 'synced',
          });
        } else if (request === syncRequest) {
          set({ syncStatus: 'offline' });
        }
      } catch {
        if (request !== syncRequest) return;
        console.warn('Local database server not reachable, using localStorage cache.');
        set({ syncStatus: 'offline' });
      }
    },
  }))
);

// Auto-sync on startup
useStore.getState().syncFromServer();

// Auto-sync whenever the user switches back to this browser tab
if (typeof window !== 'undefined') {
  window.addEventListener('iv-sync', (event) => useStore.setState({ syncStatus: (event as CustomEvent<StoreState['syncStatus']>).detail }));
  window.addEventListener('focus', () => {
    useStore.getState().syncFromServer();
  });
  window.addEventListener('online', () => { void useStore.getState().syncFromServer(); });
}
