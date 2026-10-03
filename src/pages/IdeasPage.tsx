import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, LayoutGrid, List, Columns3, Calendar,
  SlidersHorizontal, X, Search, SortAsc, SortDesc,
  ChevronDown, Trash2, Tag, CheckSquare,
} from 'lucide-react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, DragOverlay, closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
  rectSortingStrategy, arrayMove, useSortable, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../stores/useStore';
import { STATUS_ORDER, STATUS_LABELS, STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS } from '../types';
import type { Status, Priority, ViewMode, SortField } from '../types';
import IdeaCard from '../components/IdeaCard';
import styles from './IdeasPage.module.css';
import toast from 'react-hot-toast';
import { scoreIdea, scoreExplanation } from '../lib/ideaLogic';

// ─── Sortable wrapper for DnD ──────────────────────────────────────────────

function SortableCard({ idea, ...props }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: idea.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <IdeaCard idea={idea} {...props} />
    </div>
  );
}

// ─── Board column ──────────────────────────────────────────────────────────

function BoardColumn({ status, ideas, onSelect, selectedIds }: {
  status: Status; ideas: any[]; onSelect: (id: string) => void; selectedIds: Set<string>;
}) {
  const { createIdea, openIdea } = useStore();
  const count = ideas.length;

  return (
    <div className={styles.boardCol}>
      <div className={styles.boardColHeader}>
        <span className={styles.boardColDot} style={{ background: STATUS_COLORS[status] }} />
        <span className={styles.boardColLabel}>{STATUS_LABELS[status]}</span>
        <span className={styles.boardColCount}>{count}</span>
        <button
          className={`btn btn-ghost btn-icon-sm ${styles.boardColAdd}`}
          onClick={() => { const i = createIdea({ status }); openIdea(i.id); }}
          title={`Add to ${STATUS_LABELS[status]}`}
        >
          <Plus size={13} />
        </button>
      </div>
      <SortableContext items={ideas.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className={styles.boardColBody}>
          {ideas.map((idea) => (
            <SortableCard
              key={idea.id}
              idea={idea}
              compact
              selected={selectedIds.has(idea.id)}
              onSelect={onSelect}
            />
          ))}
          {ideas.length === 0 && (
            <div className={styles.boardColEmpty}>Drop here or click + to add</div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ─── Timeline view ─────────────────────────────────────────────────────────

function TimelineView({ ideas }: { ideas: any[] }) {
  const grouped = ideas.reduce<Record<string, any[]>>((acc, idea) => {
    const month = idea.createdAt.slice(0, 7);
    (acc[month] = acc[month] ?? []).push(idea);
    return acc;
  }, {});
  const months = Object.keys(grouped).sort().reverse();

  return (
    <div className={styles.timeline}>
      {months.map((month) => (
        <div key={month} className={styles.timelineMonth}>
          <div className={styles.timelineMonthLabel}>
            {new Date(month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            <span className={styles.boardColCount}>{grouped[month].length}</span>
          </div>
          <div className={styles.timelineItems}>
            {grouped[month].map((idea) => (
              <IdeaCard key={idea.id} idea={idea} compact />
            ))}
          </div>
        </div>
      ))}
      {months.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📅</div>
          <h3>No ideas yet</h3>
          <p>Create your first idea to see the timeline</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Ideas Page ───────────────────────────────────────────────────────

import { useTitle } from '../hooks/useTitle';

export default function IdeasPage() {
  useTitle('Ideas');
  const {
    filters, setFilter, resetFilters, preferences, setViewMode,
    tags, savedFilters, saveCurrentFilter, loadSavedFilter, deleteSavedFilter,
    selectedIds, toggleSelect, selectAll, clearSelection, bulkDelete, bulkChangeStatus,
    bulkChangePriority, bulkAddTag, createIdea, openIdea, reorderIdeas, getFilteredIdeas,
  } = useStore();

  const ideas = getFilteredIdeas();
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [savedFilterOpen, setSavedFilterOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialParams] = useState(() => new URLSearchParams(window.location.search));
  const initRef = useRef(false);

  // Load filters from URL on mount
  useEffect(() => {
    const s = initialParams.get('q');
    if (s !== null) setFilter('search', s);
    
    const statuses = initialParams.getAll('status');
    if (statuses.length > 0) setFilter('status', statuses as Status[]);
    
    const tagsParam = initialParams.getAll('tag');
    if (tagsParam.length > 0) setFilter('tagIds', tagsParam);
    
    const priorities = initialParams.getAll('priority');
    if (priorities.length > 0) setFilter('priority', priorities as Priority[]);
    
    // Note: To avoid infinite loops, we don't listen to `filters` changes here to update URL.
    // Instead we update URL when filters change by watching filters in another effect.
  }, [initialParams, setFilter]);

  // Sync filters to URL
  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      return;
    }
    const params = new URLSearchParams();
    if (filters.search) params.set('q', filters.search);
    filters.status.forEach(st => params.append('status', st));
    filters.priority.forEach(p => params.append('priority', p));
    filters.tagIds.forEach(t => params.append('tag', t));
    
    // Only replace if it actually changed, to avoid React Router loop
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [filters.search, filters.status, filters.priority, filters.tagIds, setSearchParams, searchParams]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const viewMode = preferences.viewMode;
  const hasFilters = filters.status.length > 0 || filters.priority.length > 0 || filters.tagIds.length > 0 || !!filters.search || !!filters.dateFrom || filters.pinned !== null || filters.minScore != null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = ideas.findIndex((i) => i.id === active.id);
    const newIdx = ideas.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const newOrder = arrayMove(ideas, oldIdx, newIdx);
    reorderIdeas(newOrder.map((i) => i.id));
  }

  const activeIdea = activeId ? ideas.find((i) => i.id === activeId) : null;

  const VIEW_MODES: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
    { mode: 'grid', icon: <LayoutGrid size={14} />, label: 'Grid' },
    { mode: 'list', icon: <List size={14} />, label: 'List' },
    { mode: 'board', icon: <Columns3 size={14} />, label: 'Board' },
    { mode: 'timeline', icon: <Calendar size={14} />, label: 'Timeline' },
  ];

  const SORT_FIELDS: { field: SortField; label: string }[] = [
    { field: 'updatedAt', label: 'Last Updated' },
    { field: 'createdAt', label: 'Created' },
    { field: 'title', label: 'Title' },
    { field: 'priority', label: 'Priority' },
    { field: 'status', label: 'Status' },
    { field: 'score', label: 'Opportunity score' },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.pageIntro}><h1>Ideas</h1><p>Explore, compare, and move your ideas forward.</p></div>
      {compareOpen && <div className="capture-backdrop" onMouseDown={() => setCompareOpen(false)}><div className="card compare-dialog" role="dialog" aria-modal="true" aria-label="Compare ideas" onMouseDown={(event) => event.stopPropagation()}><div className="work-row"><h2>Compare ideas</h2><button className="btn btn-ghost" onClick={() => setCompareOpen(false)}>Close</button></div><div className="compare-grid">{ideas.filter((item) => selectedIds.has(item.id)).map((item) => <div className="card" key={item.id}><h3>{item.title || 'Untitled'}</h3><p>{item.status} · {item.priority} priority</p><strong>{item.evaluation ? `${scoreIdea(item.evaluation)}/100` : 'Not evaluated'}</strong><p>{item.evaluation && scoreExplanation(item.evaluation)}</p><button className="btn btn-secondary btn-sm" onClick={() => { setCompareOpen(false); openIdea(item.id); }}>Open</button></div>)}</div></div></div>}
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className={styles.toolbar}>
        {/* Search */}
        <div className={styles.searchWrap}>
          <Search size={14} className={styles.searchIcon} />
          <input
            className={`input input-sm ${styles.searchInput}`}
            placeholder="Search ideas… (Ctrl+K for more)"
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            aria-label="Search ideas"
          />
          {filters.search && (
            <button className="btn btn-ghost btn-icon-sm" onClick={() => setFilter('search', '')} aria-label="Clear search" title="Clear search">
              <X size={12} />
            </button>
          )}
        </div>

        <div className={styles.toolbarRight}>
          {/* Saved filters */}
          <div className={styles.relativeWrap}>
            <button
              className={`btn btn-ghost btn-sm ${savedFilterOpen ? 'active' : ''}`}
              onClick={() => setSavedFilterOpen((o) => !o)}
            >
              <CheckSquare size={13} /> Saved
            </button>
            {savedFilterOpen && (
              <div className="dropdown" style={{ right: 0, top: 'calc(100% + 4px)', minWidth: 200 }}>
                <div className="dropdown-label">Saved Filters</div>
                {savedFilters.length === 0 && (
                  <div className="dropdown-item" style={{ color: 'var(--text-muted)', cursor: 'default', fontSize: 12 }}>None saved yet</div>
                )}
                {savedFilters.map((sf) => (
                  <div key={sf.id} className="dropdown-item">
                    <span style={{ flex: 1 }} onClick={() => { loadSavedFilter(sf.id); setSavedFilterOpen(false); }}>{sf.name}</span>
                    <button className="btn btn-ghost btn-icon-sm" onClick={() => deleteSavedFilter(sf.id)} aria-label="Delete saved filter" title="Delete saved filter">
                      <X size={11} />
                    </button>
                  </div>
                ))}
                {hasFilters && (
                  <>
                    <div className="dropdown-sep" />
                    <div style={{ padding: '6px 8px', display: 'flex', gap: 6 }}>
                      <input
                        className="input input-sm"
                        placeholder="Save current as…"
                        value={saveFilterName}
                        onChange={(e) => setSaveFilterName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && saveFilterName.trim()) {
                            saveCurrentFilter(saveFilterName.trim());
                            setSaveFilterName('');
                            setSavedFilterOpen(false);
                            toast.success('Filter saved!');
                          }
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Filter toggle */}
          <button
            className={`btn btn-ghost btn-sm ${hasFilters ? 'active' : ''} ${filterOpen ? 'active' : ''}`}
            onClick={() => setFilterOpen((o) => !o)}
          >
            <SlidersHorizontal size={13} />
            Filters
            {hasFilters && <span className="badge" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', marginLeft: 0 }}>
              {[filters.status.length > 0, filters.priority.length > 0, filters.tagIds.length > 0, !!filters.search, filters.pinned !== null].filter(Boolean).length}
            </span>}
          </button>

          {/* Sort */}
          <div className={styles.relativeWrap}>
            <button className="btn btn-ghost btn-sm" onClick={() => setSortOpen((o) => !o)}>
              {filters.sortDir === 'asc' ? <SortAsc size={13} /> : <SortDesc size={13} />}
              {SORT_FIELDS.find((f) => f.field === filters.sortField)?.label}
              <ChevronDown size={12} />
            </button>
            {sortOpen && (
              <div className="dropdown" style={{ right: 0, top: 'calc(100% + 4px)' }}>
                <div className="dropdown-label">Sort by</div>
                {SORT_FIELDS.map(({ field, label }) => (
                  <div
                    key={field}
                    className={`dropdown-item ${filters.sortField === field ? 'active' : ''}`}
                    onClick={() => { setFilter('sortField', field); setSortOpen(false); }}
                  >
                    {label}
                    {filters.sortField === field && (
                      <button
                        style={{ marginLeft: 'auto' }}
                        className="btn btn-ghost btn-icon-sm"
                        onClick={(e) => { e.stopPropagation(); setFilter('sortDir', filters.sortDir === 'asc' ? 'desc' : 'asc'); setSortOpen(false); }}
                      >
                        {filters.sortDir === 'asc' ? <SortAsc size={12} /> : <SortDesc size={12} />}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* View mode */}
          <div className="tabs">
            {VIEW_MODES.map(({ mode, icon, label }) => (
              <button
                key={mode}
                className={`tab ${viewMode === mode ? 'active' : ''}`}
                onClick={() => setViewMode(mode)}
                title={label}
                aria-pressed={viewMode === mode}
              >
                {icon}
              </button>
            ))}
          </div>

          {/* New idea */}
          {selectedIds.size > 1 && <button className="btn btn-secondary btn-sm" onClick={() => setCompareOpen(true)}>Compare ({selectedIds.size})</button>}
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { const i = createIdea(); openIdea(i.id); }}
          >
            <Plus size={14} /> New Idea
          </button>
        </div>
      </div>

      {/* ── Filter Panel ─────────────────────────────────────────────────── */}
      {filterOpen && (
        <div className={styles.filterPanel}>
          {/* Status */}
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Status</span>
            <div className={styles.chipRow}>
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  className={`chip ${filters.status.includes(s) ? 'active' : ''}`}
                  onClick={() => {
                    const next = filters.status.includes(s)
                      ? filters.status.filter((x) => x !== s)
                      : [...filters.status, s];
                    setFilter('status', next);
                  }}
                  style={filters.status.includes(s) ? { borderColor: STATUS_COLORS[s] + '88', color: STATUS_COLORS[s] } : {}}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLORS[s] }} />
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Priority</span>
            <div className={styles.chipRow}>
              {(['high', 'medium', 'low'] as Priority[]).map((p) => (
                <button
                  key={p}
                  className={`chip ${filters.priority.includes(p) ? 'active' : ''}`}
                  onClick={() => {
                    const next = filters.priority.includes(p)
                      ? filters.priority.filter((x) => x !== p)
                      : [...filters.priority, p];
                    setFilter('priority', next);
                  }}
                  style={filters.priority.includes(p) ? { borderColor: PRIORITY_COLORS[p] + '88', color: PRIORITY_COLORS[p] } : {}}
                >
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Tags</span>
              <div className={styles.chipRow}>
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    className={`chip ${filters.tagIds.includes(tag.id) ? 'active' : ''}`}
                    onClick={() => {
                      const next = filters.tagIds.includes(tag.id)
                        ? filters.tagIds.filter((x) => x !== tag.id)
                        : [...filters.tagIds, tag.id];
                      setFilter('tagIds', next);
                    }}
                    style={filters.tagIds.includes(tag.id) ? { borderColor: tag.color + '88', color: tag.color } : {}}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: tag.color }} />
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pinned */}
          <div className={styles.filterGroup}><span className={styles.filterLabel}>Minimum opportunity score</span><div className={styles.chipRow}><input type="range" min="0" max="90" step="5" value={filters.minScore ?? 0} onChange={(event) => setFilter('minScore', Number(event.target.value))} aria-label="Minimum opportunity score" /><span>{filters.minScore === null ? 'Any' : `${filters.minScore}+`}</span><button className="btn btn-ghost btn-sm" onClick={() => setFilter('minScore', null)}>Clear</button></div></div>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Pinned</span>
            <div className={styles.chipRow}>
              <button className={`chip ${filters.pinned === true ? 'active' : ''}`} onClick={() => setFilter('pinned', filters.pinned === true ? null : true)}>📌 Pinned only</button>
              <button className={`chip ${filters.pinned === false ? 'active' : ''}`} onClick={() => setFilter('pinned', filters.pinned === false ? null : false)}>Not pinned</button>
            </div>
          </div>

          {/* Date range */}
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Created</span>
            <div className={styles.chipRow}>
              <input
                type="date"
                className="input input-sm"
                value={filters.dateFrom}
                onChange={(e) => setFilter('dateFrom', e.target.value)}
                style={{ width: 140 }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
              <input
                type="date"
                className="input input-sm"
                value={filters.dateTo}
                onChange={(e) => setFilter('dateTo', e.target.value)}
                style={{ width: 140 }}
              />
            </div>
          </div>

          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={resetFilters}>
              <X size={12} /> Clear all filters
            </button>
          )}
        </div>
      )}

      {/* ── Bulk Action Bar ───────────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>{selectedIds.size} selected</span>
          <div className={styles.relativeWrap}>
            <button className="btn btn-secondary btn-sm" onClick={() => setBulkMenuOpen((o) => !o)}>
              <Tag size={13} /> Actions <ChevronDown size={12} />
            </button>
            {bulkMenuOpen && (
              <div className="dropdown" style={{ top: 'calc(100% + 4px)', left: 0 }}>
                <div className="dropdown-label">Change Status</div>
                {STATUS_ORDER.map((s) => (
                  <div key={s} className="dropdown-item" onClick={() => { bulkChangeStatus(s); setBulkMenuOpen(false); }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[s] }} />
                    {STATUS_LABELS[s]}
                  </div>
                ))}
                <div className="dropdown-sep" />
                <div className="dropdown-label">Change Priority</div>
                {(['high', 'medium', 'low'] as Priority[]).map((p) => (
                  <div key={p} className="dropdown-item" onClick={() => { bulkChangePriority(p); setBulkMenuOpen(false); }}>
                    {PRIORITY_LABELS[p]}
                  </div>
                ))}
                {tags.length > 0 && (
                  <>
                    <div className="dropdown-sep" />
                    <div className="dropdown-label">Add Tag</div>
                    {tags.map((tag) => (
                      <div key={tag.id} className="dropdown-item" onClick={() => { bulkAddTag(tag.id); setBulkMenuOpen(false); }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color }} />
                        {tag.name}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <button 
            className={`btn btn-sm ${confirmingDelete ? 'btn-danger' : 'btn-ghost'}`}
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
              } else {
                bulkDelete();
                setConfirmingDelete(false);
                toast.success('Deleted');
              }
            }}
            onBlur={() => setConfirmingDelete(false)}
          >
            <Trash2 size={13} /> {confirmingDelete ? 'Confirm' : 'Delete'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={clearSelection}>
            <X size={13} /> Clear
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => selectAll(ideas.map((i) => i.id))}>
            Select all ({ideas.length})
          </button>
        </div>
      )}

      {/* ── Content Area ─────────────────────────────────────────────────── */}
      <div className={styles.content}>
        {(viewMode === 'grid' || viewMode === 'list') && ideas.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, textAlign: 'center' }}>
            <strong>Keyboard sorting:</strong> Focus a card, press Space to lift, arrow keys to move, and Space to drop.
          </div>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {/* Grid view */}
          {viewMode === 'grid' && (
            <SortableContext items={ideas.map((i) => i.id)} strategy={rectSortingStrategy}>
              {ideas.length === 0 ? (
                <EmptyState hasFilters={hasFilters} />
              ) : (
                <div className={styles.grid}>
                  {ideas.map((idea) => (
                    <SortableCard
                      key={idea.id}
                      idea={idea}
                      selected={selectedIds.has(idea.id)}
                      onSelect={toggleSelect}
                    />
                  ))}
                </div>
              )}
            </SortableContext>
          )}

          {/* List view */}
          {viewMode === 'list' && (
            <SortableContext items={ideas.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {ideas.length === 0 ? (
                <EmptyState hasFilters={hasFilters} />
              ) : (
                <div className={styles.list}>
                  {ideas.map((idea) => (
                    <SortableCard
                      key={idea.id}
                      idea={idea}
                      compact
                      selected={selectedIds.has(idea.id)}
                      onSelect={toggleSelect}
                    />
                  ))}
                </div>
              )}
            </SortableContext>
          )}

          {/* Board view */}
          {viewMode === 'board' && (
            <div className={styles.board}>
              {STATUS_ORDER.map((status) => (
                <BoardColumn
                  key={status}
                  status={status}
                  ideas={ideas.filter((i) => i.status === status)}
                  onSelect={toggleSelect}
                  selectedIds={selectedIds}
                />
              ))}
            </div>
          )}

          {/* Timeline view */}
          {viewMode === 'timeline' && <TimelineView ideas={ideas} />}

          {/* Drag overlay */}
          <DragOverlay>
            {activeIdea ? (
              <div className="drag-overlay">
                <IdeaCard idea={activeIdea} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  const { createIdea, openIdea, resetFilters } = useStore();
  return (
    <div className="empty-state">
      <div className="empty-state-icon">💡</div>
      <h3>{hasFilters ? 'No ideas match your filters' : 'No ideas yet'}</h3>
      <p>{hasFilters ? 'Try adjusting your filters or search.' : 'Capture your first idea and start building your vault.'}</p>
      {hasFilters ? (
        <button className="btn btn-secondary" onClick={resetFilters}>Clear Filters</button>
      ) : (
        <button className="btn btn-primary" onClick={() => { const i = createIdea(); openIdea(i.id); }}>
          <Plus size={14} /> Create First Idea
        </button>
      )}
    </div>
  );
}
