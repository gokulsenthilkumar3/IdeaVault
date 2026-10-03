import { useState } from 'react';
import { RotateCcw, Trash2, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useStore } from '../stores/useStore';
import { STATUS_COLORS, STATUS_LABELS } from '../types';
import toast from 'react-hot-toast';
import styles from './TrashPage.module.css';

import { useTitle } from '../hooks/useTitle';

export default function TrashPage() {
  useTitle('Trash');
  const { ideas, restoreIdea, hardDeleteIdea, hardDeleteIdeas } = useStore();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);

  const deleted = ideas
    .filter((i) => i.deletedAt)
    .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));

  function handleHardDelete(id: string) {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    hardDeleteIdea(id);
    setConfirming(null);
    toast.success('Permanently deleted');
  }

  function handleRestore(id: string) {
    restoreIdea(id);
    toast.success('Idea restored!');
  }

  function handleEmptyTrash() {
    if (!confirmingEmpty) {
      setConfirmingEmpty(true);
      return;
    }
    hardDeleteIdeas(deleted.map(i => i.id));
    setConfirmingEmpty(false);
    toast.success('Trash emptied');
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>Trash</h1>
          <p className={styles.sub}>{deleted.length} deleted idea{deleted.length !== 1 ? 's' : ''}</p>
        </div>
        {deleted.length > 0 && (
          <button 
            className={`btn ${confirmingEmpty ? 'btn-danger' : 'btn-secondary'}`}
            onClick={handleEmptyTrash}
            onBlur={() => setConfirmingEmpty(false)}
          >
            <Trash2 size={14} /> {confirmingEmpty ? 'Confirm Empty' : 'Empty Trash'}
          </button>
        )}
      </div>

      {deleted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🗑️</div>
          <h3>Trash is empty</h3>
          <p>Deleted ideas will appear here. You can restore or permanently delete them.</p>
        </div>
      ) : (
        <>
          <div className={styles.banner}>
            <AlertTriangle size={14} />
            Ideas in trash can be restored or permanently deleted. They are not included in any views or analytics.
          </div>
          <div className={styles.list}>
            {deleted.map((idea) => (
              <div key={idea.id} className={`card ${styles.item}`}>
                <div className={styles.itemHeader}>
                  <span className={styles.statusDot} style={{ background: STATUS_COLORS[idea.status] }} />
                  <span className={styles.title}>{idea.title || <em style={{ color: 'var(--text-muted)' }}>Untitled</em>}</span>
                  <span className={styles.statusBadge} style={{ color: STATUS_COLORS[idea.status] }}>
                    {STATUS_LABELS[idea.status]}
                  </span>
                </div>
                {idea.description && (
                  <p className={styles.desc}>
                    {idea.description.replace(/#{1,6}\s|[*_`~]/g, '').slice(0, 120)}
                    {idea.description.length > 120 ? '…' : ''}
                  </p>
                )}
                <div className={styles.footer}>
                  <span className={styles.time}>Deleted {formatDistanceToNow(new Date(idea.deletedAt!), { addSuffix: true })}</span>
                  <div className={styles.actions}>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleRestore(idea.id)}>
                      <RotateCcw size={12} /> Restore
                    </button>
                    <button
                      className={`btn btn-sm ${confirming === idea.id ? 'btn-danger' : 'btn-ghost'}`}
                      onClick={() => handleHardDelete(idea.id)}
                      onBlur={() => { if (confirming === idea.id) setConfirming(null); }}
                    >
                      <Trash2 size={12} />
                      {confirming === idea.id ? 'Confirm Delete' : 'Delete Forever'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
