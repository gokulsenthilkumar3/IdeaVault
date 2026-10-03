import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Lightbulb, Tag, BarChart3, Settings, Trash2, LayoutDashboard, X } from 'lucide-react';
import Fuse from 'fuse.js';
import { useStore } from '../stores/useStore';
import { STATUS_COLORS, STATUS_LABELS } from '../types';
import styles from './CommandPalette.module.css';

interface Command {
  id: string;
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  action: () => void;
  keywords?: string[];
  category: string;
  color?: string;
}

export default function CommandPaletteWrapper() {
  const commandPaletteOpen = useStore((s) => s.commandPaletteOpen);
  if (!commandPaletteOpen) return null;
  return <CommandPalette />;
}

function CommandPalette() {
  const { setCommandPalette, setQuickCapture, ideas, tags, createIdea, openIdea, setFilter } = useStore();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => previousFocus.current?.focus();
  }, []);

  const staticCommands: Command[] = useMemo(() => [
    {
      id: 'quick-capture', label: 'Quick capture to Inbox', icon: <Plus size={15} />,
      action: () => setQuickCapture(true), category: 'Actions', keywords: ['capture', 'inbox', 'note'],
    },
    {
      id: 'new-idea',
      label: 'New Idea',
      icon: <Plus size={15} />,
      action: () => { const idea = createIdea(); openIdea(idea.id); },
      category: 'Actions',
      keywords: ['create', 'add'],
    },
    { id: 'nav-dashboard', label: 'Go to Dashboard', icon: <LayoutDashboard size={15} />, action: () => navigate('/dashboard'), category: 'Navigate' },
    { id: 'nav-ideas', label: 'Go to Ideas', icon: <Lightbulb size={15} />, action: () => navigate('/ideas'), category: 'Navigate' },
    { id: 'nav-tags', label: 'Go to Tags', icon: <Tag size={15} />, action: () => navigate('/tags'), category: 'Navigate' },
    { id: 'nav-analytics', label: 'Go to Dashboard analytics', icon: <BarChart3 size={15} />, action: () => navigate('/dashboard'), category: 'Navigate' },
    { id: 'nav-trash', label: 'Go to Trash', icon: <Trash2 size={15} />, action: () => navigate('/trash'), category: 'Navigate' },
    { id: 'nav-settings', label: 'Go to Settings', icon: <Settings size={15} />, action: () => navigate('/settings'), category: 'Navigate' },
    // Filter by status
    ...(['idea', 'planned', 'building', 'done', 'archived'] as const).map((s) => ({
      id: `filter-status-${s}`,
      label: `Filter: Status = ${STATUS_LABELS[s]}`,
      icon: <span style={{ width: 10, height: 10, borderRadius: '50%', background: STATUS_COLORS[s], display: 'inline-block' }} />,
      action: () => { navigate('/ideas'); setFilter('status', [s]); },
      category: 'Filters',
      color: STATUS_COLORS[s],
    })),
  ], [createIdea, openIdea, navigate, setFilter, setQuickCapture]);

  const ideaCommands: Command[] = useMemo(
    () =>
      ideas
        .filter((i) => !i.deletedAt)
        // No artificial cap: Fuse.js ranks results, display is limited to 20
        .map((idea) => ({
          id: `idea-${idea.id}`,
          label: idea.title || '(Untitled)',
          sublabel: STATUS_LABELS[idea.status],
          icon: <Lightbulb size={15} />,
          action: () => { navigate('/ideas'); openIdea(idea.id); },
          category: 'Ideas',
          color: STATUS_COLORS[idea.status],
          keywords: [idea.description, ...idea.tagIds.map((tid) => tags.find((t) => t.id === tid)?.name ?? '')],
        })),
    [ideas, tags, navigate, openIdea]
  );

  const allCommands = useMemo(() => [...staticCommands, ...ideaCommands], [staticCommands, ideaCommands]);

  const fuse = useMemo(
    () =>
      new Fuse(allCommands, {
        keys: ['label', 'sublabel', 'keywords', 'category'],
        threshold: 0.3,
        includeScore: true,
      }),
    [allCommands]
  );

  const results = useMemo(() => {
    if (!query.trim()) return allCommands.slice(0, 20);
    return fuse.search(query).map((r) => r.item).slice(0, 20);
  }, [query, fuse, allCommands]);

  // Reset selection whenever results list changes
  useEffect(() => {
    setSelected(0);
  }, [results]);

  // Group results
  const grouped = useMemo(() => {
    const groups: Record<string, Command[]> = {};
    for (const cmd of results) {
      (groups[cmd.category] = groups[cmd.category] ?? []).push(cmd);
    }
    return groups;
  }, [results]);

  const flat = results;

  // Build a stable id→index map via useMemo to avoid render-time mutation
  const flatIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const cmds of Object.values(grouped)) {
      for (const cmd of cmds) {
        map.set(cmd.id, idx++);
      }
    }
    return map;
  }, [grouped]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flat[selected]?.action();
      setCommandPalette(false);
    } else if (e.key === 'Escape') {
      setCommandPalette(false);
    }
  }

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`) as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const selectedCmd = flat[selected];
  const activeDescendantId = selectedCmd ? `cp-item-${selectedCmd.id}` : undefined;

  return (
    <div className={styles.backdrop} onClick={() => setCommandPalette(false)}>
      <div ref={paletteRef} className={styles.palette} role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()} onKeyDown={(event) => { if (event.key !== 'Tab') return; const focusable = Array.from(paletteRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])') || []); if (!focusable.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }}>
        {/* Search input */}
        <div className={styles.searchRow}>
          <Search size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search ideas, commands, navigate…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            aria-label="Command palette search"
            aria-controls="cp-results"
            aria-activedescendant={activeDescendantId}
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button className={`btn btn-ghost btn-icon-sm`} onClick={() => setQuery('')} aria-label="Clear" title="Clear">
              <X size={13} />
            </button>
          )}
          <kbd>Esc</kbd>
        </div>

        {/* Results */}
        <div className={styles.results} ref={listRef} role="listbox" id="cp-results">
          {flat.length === 0 ? (
            <div className={styles.empty}>No results for "{query}"</div>
          ) : (
            Object.entries(grouped).map(([category, cmds]) => (
              <div key={category} className={styles.group}>
                <div className={styles.groupLabel}>{category}</div>
                {cmds.map((cmd) => {
                  const idx = flatIndexMap.get(cmd.id) ?? 0;
                  const isSelected = selected === idx;
                  return (
                    <div
                      key={cmd.id}
                      id={`cp-item-${cmd.id}`}
                      className={`${styles.item} ${isSelected ? styles.selected : ''}`}
                      data-idx={idx}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => { cmd.action(); setCommandPalette(false); }}
                      onMouseEnter={() => setSelected(idx)}
                    >
                      <span className={styles.itemIcon} style={cmd.color ? { color: cmd.color } : {}}>
                        {cmd.icon}
                      </span>
                      <span className={styles.itemLabel}>{cmd.label}</span>
                      {cmd.sublabel && (
                        <span className={styles.itemSublabel} style={cmd.color ? { color: cmd.color } : {}}>
                          {cmd.sublabel}
                        </span>
                      )}
                      {isSelected && <kbd className={styles.enterHint}>↵</kbd>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
