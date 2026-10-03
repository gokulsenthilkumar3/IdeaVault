import { useState, useRef, useEffect } from 'react';
import { Tag as TagIcon, Plus, Check } from 'lucide-react';
import { useStore } from '../stores/useStore';
import styles from './TagPicker.module.css';

const TAG_COLORS = [
  '#7c5cff', '#60a5fa', '#34d399', '#f59e0b',
  '#ef4444', '#f472b6', '#a78bfa', '#fb923c',
  '#22d3ee', '#84cc16',
];

interface Props { ideaId: string; }

export default function TagPicker({ ideaId }: Props) {
  const { tags, ideas, createTag, updateIdea } = useStore();
  const idea = ideas.find((i) => i.id === ideaId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!dropRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!idea) return null;

  function toggleTag(tagId: string) {
    if (!idea) return;
    const next = idea.tagIds.includes(tagId)
      ? idea.tagIds.filter((t) => t !== tagId)
      : [...idea.tagIds, tagId];
    updateIdea(idea.id, { tagIds: next });
  }

  function normalizeTag(str: string) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function handleCreate() {
    const name = search.trim();
    if (!name) return;
    const normalized = normalizeTag(name);
    const existing = tags.find((t) => normalizeTag(t.name) === normalized);
    if (existing) {
      toggleTag(existing.id);
    } else {
      const tag = createTag(name, newColor);
      toggleTag(tag.id);
    }
    setSearch('');
  }

  const filtered = tags.filter((t) => {
    const s = normalizeTag(search);
    return normalizeTag(t.name).includes(s);
  });

  return (
    <div className={styles.wrap} ref={dropRef}>
      <button
        className={`btn btn-ghost btn-sm ${styles.triggerBtn}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Add tag"
        title="Add tag"
      >
        <TagIcon size={12} />
        <Plus size={10} />
      </button>

      {open && (
        <div className={`dropdown ${styles.dropdown}`}>
          <div className={styles.searchRow}>
            <input
              ref={inputRef}
              className={`input input-sm ${styles.searchInput}`}
              placeholder="Find or create tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setOpen(false);
              }}
            />
          </div>

          {/* Color picker for new tag */}
          {search && !tags.find((t) => normalizeTag(t.name) === normalizeTag(search)) && (
            <div className={styles.colorPicker}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Color:</span>
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  className={`${styles.colorSwatch} ${newColor === c ? styles.colorActive : ''}`}
                  style={{ background: c }}
                  onClick={() => setNewColor(c)}
                  title={c}
                />
              ))}
            </div>
          )}

          <div className={styles.list}>
            {search && !filtered.find((t) => normalizeTag(t.name) === normalizeTag(search)) && (
              <div className="dropdown-item" onClick={handleCreate}>
                <Plus size={13} />
                <span>Create "<strong>{search}</strong>"</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: newColor,
                    display: 'inline-block',
                  }}
                />
              </div>
            )}

            {filtered.length === 0 && !search && (
              <div className="dropdown-item" style={{ color: 'var(--text-muted)', cursor: 'default' }}>
                No tags yet
              </div>
            )}

            {filtered.map((tag) => {
              const active = idea.tagIds.includes(tag.id);
              return (
                <div
                  key={tag.id}
                  className={`dropdown-item ${active ? 'active' : ''}`}
                  onClick={() => toggleTag(tag.id)}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: tag.color,
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1 }}>{tag.name}</span>
                  {active && <Check size={12} style={{ color: 'var(--accent)' }} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
