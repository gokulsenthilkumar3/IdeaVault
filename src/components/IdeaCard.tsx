import { useState, useRef, useEffect } from 'react';
import { Pin, Trash2, Copy, MoreHorizontal, MessageSquare, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useStore } from '../stores/useStore';
import type { Idea } from '../types';
import { STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS, PRIORITY_LABELS } from '../types';
import styles from './IdeaCard.module.css';

interface Props {
  idea: Idea;
  compact?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

export default function IdeaCard({ idea, compact = false, selected = false, onSelect }: Props) {
  const { openIdea, deleteIdea, duplicateIdea, togglePin, tags } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const ideaTags = tags.filter((t) => idea.tagIds.includes(t.id));

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  function handleCardClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-no-open]')) return;
    openIdea(idea.id);
  }

  function handleSelectClick(e: React.MouseEvent) {
    e.stopPropagation();
    onSelect?.(idea.id);
  }

  return (
    <div
      className={`${styles.card} ${selected ? styles.selected : ''} ${compact ? styles.compact : ''} card animate-fade-in`}
      onClick={handleCardClick}
      role="article"
      aria-label={idea.title || 'Untitled idea'}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') openIdea(idea.id); }}
    >
      {/* Selection checkbox */}
      {onSelect && (
        <div
          className={`${styles.checkbox} ${selected ? styles.checked : ''}`}
          data-no-open
          onClick={handleSelectClick}
          role="checkbox"
          aria-checked={selected}
          aria-label="Select idea"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') handleSelectClick(e as unknown as React.MouseEvent); }}
        >
          {selected && <span>✓</span>}
        </div>
      )}

      {/* Pin indicator */}
      {idea.pinned && (
        <div className={styles.pinBadge} title="Pinned">
          <Pin size={10} />
        </div>
      )}

      {/* Header row */}
      <div className={styles.header}>
        {/* Status dot */}
        <span
          className={styles.statusDot}
          style={{ background: STATUS_COLORS[idea.status] }}
          title={STATUS_LABELS[idea.status]}
        />
        <h3 className={`${styles.title} truncate`}>{idea.title || <em style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: 400 }}>Untitled</em>}</h3>

        {/* Actions menu */}
        <div className={styles.menuWrap} ref={menuRef} data-no-open>
          <button
            className={`btn btn-ghost btn-icon-sm ${styles.menuBtn}`}
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
            aria-label="Idea options"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className={`dropdown ${styles.menu}`}>
              <div className="dropdown-item" onClick={() => { openIdea(idea.id); setMenuOpen(false); }}>
                Open
              </div>
              <div className="dropdown-sep" />
              <div className="dropdown-item" onClick={() => { togglePin(idea.id); setMenuOpen(false); }}>
                {idea.pinned ? <><Pin size={12} /> Unpin</> : <><Pin size={12} /> Pin</>}
              </div>
              <div className="dropdown-item" onClick={() => { duplicateIdea(idea.id); setMenuOpen(false); }}>
                <Copy size={12} /> Duplicate
              </div>
              <div className="dropdown-sep" />
              <div className="dropdown-item danger" onClick={() => { deleteIdea(idea.id); setMenuOpen(false); }}>
                <Trash2 size={12} /> Delete
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Description preview */}
      {!compact && idea.description && (
        <p className={styles.desc}>
          {idea.description.replace(/#{1,6}\s|[*_`~]/g, '').slice(0, 120)}
          {idea.description.length > 120 ? '…' : ''}
        </p>
      )}

      {/* Tags */}
      {!compact && ideaTags.length > 0 && (
        <div className={styles.tags}>
          {ideaTags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              className="tag"
              style={{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}
            >
              {tag.name}
            </span>
          ))}
          {ideaTags.length > 3 && (
            <span className="tag" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              +{ideaTags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className={styles.footer}>
        <span
          className={styles.priority}
          style={{ color: PRIORITY_COLORS[idea.priority] }}
          title={`Priority: ${PRIORITY_LABELS[idea.priority]}`}
        >
          ●
        </span>
        <time className={styles.time} dateTime={idea.updatedAt}>
          <Clock size={10} />
          {formatDistanceToNow(new Date(idea.updatedAt), { addSuffix: true })}
        </time>
        {idea.comments.length > 0 && (
          <span className={styles.commentCount}>
            <MessageSquare size={10} /> {idea.comments.length}
          </span>
        )}
      </div>
    </div>
  );
}
