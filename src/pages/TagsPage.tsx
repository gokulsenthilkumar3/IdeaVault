import { useState } from 'react';
import { Plus, Edit2, Trash2, Merge, X, Check } from 'lucide-react';
import { useStore } from '../stores/useStore';
import toast from 'react-hot-toast';
import styles from './TagsPage.module.css';

const TAG_COLORS = [
  '#7c5cff', '#60a5fa', '#34d399', '#f59e0b',
  '#ef4444', '#f472b6', '#a78bfa', '#fb923c',
  '#22d3ee', '#84cc16', '#e879f9', '#94a3b8',
];

function TagCreateForm({ 
  newName, setNewName, newColor, setNewColor, handleCreate 
}: { 
  newName: string, setNewName: (n: string) => void, newColor: string, setNewColor: (c: string) => void, handleCreate: (e: React.FormEvent) => void 
}) {
  return (
    <form className={`card ${styles.createForm}`} onSubmit={handleCreate}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Create New Tag</h3>
      <div className={styles.createRow}>
        <input
          className="input"
          placeholder="Tag name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={32}
        />
        <div className={styles.colorRow}>
          {TAG_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`${styles.colorSwatch} ${newColor === c ? styles.colorActive : ''}`}
              style={{ background: c }}
              onClick={() => setNewColor(c)}
              title={c}
            />
          ))}
        </div>
        <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>
          <Plus size={14} /> Create
        </button>
      </div>
    </form>
  );
}

function TagCardView({ tag, count, mergeMode, isSource, isTarget, toggleMergeFrom, setMergeInto, startEdit, handleDelete }: any) {
  return (
    <div
      className={`card ${styles.tagCard} ${isSource ? styles.mergeSource : ''} ${isTarget ? styles.mergeTarget : ''}`}
      onClick={mergeMode ? () => toggleMergeFrom(tag.id) : undefined}
      style={{ cursor: mergeMode ? 'pointer' : 'default' }}
    >
      <div className={styles.tagHeader}>
        <div
          className={styles.tagColorBadge}
          style={{ background: tag.color + '22', border: `1px solid ${tag.color}55` }}
        >
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: tag.color, display: 'inline-block' }} />
          <span style={{ color: tag.color, fontWeight: 600, fontSize: 13 }}>{tag.name}</span>
        </div>
        <div className={styles.tagActions}>
          {mergeMode ? (
            <button
              className={`btn btn-sm ${isTarget ? 'btn-primary' : 'btn-secondary'}`}
              onClick={(e) => { e.stopPropagation(); setMergeInto(isTarget ? null : tag.id); }}
            >
              {isTarget ? '★ Target' : 'Set Target'}
            </button>
          ) : (
            <>
              <button className="btn btn-ghost btn-icon-sm" onClick={(e) => { e.stopPropagation(); startEdit(tag); }} title="Edit">
                <Edit2 size={12} />
              </button>
              <button className="btn btn-ghost btn-icon-sm" onClick={(e) => { e.stopPropagation(); handleDelete(tag.id, tag.name); }} title="Delete" style={{ color: '#ef4444' }}>
                <Trash2 size={12} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className={styles.tagMeta}>
        <span className={styles.tagCount}>
          {count} idea{count !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

function TagCardEdit({ editName, setEditName, editColor, setEditColor, saveEdit, setEditId }: any) {
  return (
    <div className={`card ${styles.tagCard}`}>
      <div className={styles.editForm}>
        <input
          className="input input-sm"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditId(null); }}
          autoFocus
        />
        <div className={styles.colorRow}>
          {TAG_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`${styles.colorSwatch} ${styles.colorSwatchSm} ${editColor === c ? styles.colorActive : ''}`}
              style={{ background: c }}
              onClick={() => setEditColor(c)}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-primary btn-sm" onClick={saveEdit}><Check size={12} /> Save</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}><X size={12} /></button>
        </div>
      </div>
    </div>
  );
}

export default function TagsPage() {
  const { tags, ideas, createTag, updateTag, deleteTag, mergeTags } = useStore();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [mergeFrom, setMergeFrom] = useState<Set<string>>(new Set());
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeInto, setMergeInto] = useState<string | null>(null);

  function tagCount(tagId: string) {
    return ideas.filter((i) => !i.deletedAt && i.tagIds.includes(tagId)).length;
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    if (tags.find((t) => t.name.toLowerCase() === newName.toLowerCase())) {
      toast.error('Tag already exists');
      return;
    }
    createTag(newName.trim(), newColor);
    setNewName('');
    toast.success('Tag created');
  }

  function startEdit(tag: { id: string; name: string; color: string }) {
    setEditId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  }

  function saveEdit() {
    if (!editId || !editName.trim()) return;
    updateTag(editId, { name: editName.trim(), color: editColor });
    setEditId(null);
    toast.success('Tag updated');
  }

  function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete tag "${name}"? It will be removed from all ideas.`)) return;
    deleteTag(id);
    toast.success('Tag deleted');
  }

  function handleMerge() {
    if (!mergeInto || mergeFrom.size === 0) return;
    const fromIds = Array.from(mergeFrom).filter((id) => id !== mergeInto);
    if (fromIds.length === 0) return;
    mergeTags(fromIds, mergeInto);
    setMergeMode(false);
    setMergeFrom(new Set());
    setMergeInto(null);
    toast.success(`Merged ${fromIds.length} tag${fromIds.length > 1 ? 's' : ''}`);
  }

  function toggleMergeFrom(id: string) {
    const next = new Set(mergeFrom);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setMergeFrom(next);
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>Tags</h1>
          <p className={styles.sub}>{tags.length} tag{tags.length !== 1 ? 's' : ''} · organize your ideas</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!mergeMode && tags.length >= 2 && (
            <button className="btn btn-secondary" onClick={() => setMergeMode(true)}>
              <Merge size={14} /> Merge Tags
            </button>
          )}
          {mergeMode && (
            <>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                {mergeFrom.size > 0 ? `Select target →` : 'Select tags to merge'}
              </span>
              <button className="btn btn-primary" onClick={handleMerge} disabled={mergeFrom.size === 0 || !mergeInto}>
                <Check size={14} /> Apply Merge
              </button>
              <button className="btn btn-ghost" onClick={() => { setMergeMode(false); setMergeFrom(new Set()); setMergeInto(null); }}>
                <X size={14} /> Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Merge instructions */}
      {mergeMode && (
        <div className={styles.mergeBanner}>
          <Merge size={14} />
          Click tags to select sources, then click <strong>Set Target</strong> on the tag to merge into.
          Selected sources will be removed after merging.
        </div>
      )}

      {/* Create form */}
      <TagCreateForm 
        newName={newName} setNewName={setNewName}
        newColor={newColor} setNewColor={setNewColor}
        handleCreate={handleCreate}
      />

      {/* Tags grid */}
      {tags.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏷️</div>
          <h3>No tags yet</h3>
          <p>Create tags to organize your ideas by theme, project, or any category.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {tags
            .slice()
            .sort((a, b) => tagCount(b.id) - tagCount(a.id))
            .map((tag) => {
              const count = tagCount(tag.id);
              if (editId === tag.id) {
                return (
                  <TagCardEdit
                    key={tag.id}
                    editName={editName} setEditName={setEditName}
                    editColor={editColor} setEditColor={setEditColor}
                    saveEdit={saveEdit} setEditId={setEditId}
                  />
                );
              }
              
              const isSource = mergeMode && mergeFrom.has(tag.id);
              const isTarget = mergeMode && mergeInto === tag.id;
              
              return (
                <TagCardView
                  key={tag.id}
                  tag={tag}
                  count={count}
                  mergeMode={mergeMode}
                  isSource={isSource}
                  isTarget={isTarget}
                  toggleMergeFrom={toggleMergeFrom}
                  setMergeInto={setMergeInto}
                  startEdit={startEdit}
                  handleDelete={handleDelete}
                />
              );
            })}
        </div>
      )}
    </div>
  );
}
