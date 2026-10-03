import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Pin, PinOff, Trash2, Copy, Clock, MessageSquare, ChevronDown, Save, Loader, Play, Eye, EyeOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { format, formatDistanceToNow } from 'date-fns';
import { useStore } from '../stores/useStore';
import { STATUS_ORDER, STATUS_LABELS, STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS, IDEA_TEMPLATES } from '../types';
import { scoreIdea, scoreLabel, scoreExplanation, isInboxIdea } from '../lib/ideaLogic';
import type { IdeaEvaluation } from '../types';
import type { Status, Priority, IdeaKind } from '../types';
import TagPicker from './TagPicker';
import styles from './IdeaModal.module.css';
import toast from 'react-hot-toast';

export default function IdeaModal() {
  const expandedIdeaId = useStore((state) => state.expandedIdeaId);
  if (!expandedIdeaId) return null;
  return <IdeaEditor key={expandedIdeaId} />;
}

function IdeaEditor() {
  const {
    expandedIdeaId, openIdea, ideas, tags,
    updateIdea, deleteIdea, hardDeleteIdea, duplicateIdea, togglePin,
    addComment, deleteComment, preferences, processIdea, deferIdea, completeNextAction,
  } = useStore();

  const idea = expandedIdeaId ? ideas.find((i) => i.id === expandedIdeaId) : null;
  const navigate = useNavigate();

  const [title, setTitle] = useState(idea?.title || '');
  const [description, setDescription] = useState(idea?.description || '');
  const [previewMode, setPreviewMode] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [techStack, setTechStack] = useState(idea?.techStack || '');
  const [estimatedTime, setEstimatedTime] = useState(idea?.estimatedTime || '');
  const [teamSize, setTeamSize] = useState<number | ''>(idea?.teamSize ?? '');
  const [nextAction, setNextAction] = useState(idea?.nextAction || '');
  const [links, setLinks] = useState<string[]>(idea?.links || []);
  const [newLink, setNewLink] = useState('');
  const [completionNote, setCompletionNote] = useState(idea?.completionNote || '');
  const [evaluation, setEvaluation] = useState<IdeaEvaluation>(idea?.evaluation || { problemSeverity: 3, excitement: 3, strategicFit: 3, effort: 3, confidence: 3 });
  const [evaluated, setEvaluated] = useState(Boolean(idea?.evaluation));
  const [aiGenerating, setAiGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasNewOnOpen = useRef(Boolean(idea && idea.createdAt === idea.updatedAt && !idea.title && !idea.description));
  const draftRef = useRef({ title, description, techStack, estimatedTime, teamSize, nextAction, links, completionNote });

  // Focus title on open
  useEffect(() => {
    if (expandedIdeaId) {
      previousFocus.current = document.activeElement as HTMLElement;
      const frame = requestAnimationFrame(() => titleRef.current?.focus());
      return () => {
        cancelAnimationFrame(frame);
        previousFocus.current?.focus();
      };
    }
  }, [expandedIdeaId]);

  // Debounced auto-save — reads from stable refs so the callback is never stale
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const triggerSave = useCallback(
    (patch: Partial<typeof draftRef.current>) => {
      draftRef.current = { ...draftRef.current, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(() => {
        if (!expandedIdeaId) return;
        const draft = draftRef.current;
        updateIdea(expandedIdeaId, { ...draft, teamSize: draft.teamSize === '' ? undefined : draft.teamSize });
        setSaving(false);
      }, preferences.autoSaveMs);
    },
    [expandedIdeaId, updateIdea, preferences.autoSaveMs]
  );

  // Clear timer on unmount
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  function handleTitleChange(val: string) {
    setTitle(val);
    triggerSave({ title: val });
  }

  function handleDescChange(val: string) {
    setDescription(val);
    triggerSave({ description: val });
  }

  function handleStackChange(val: string) {
    setTechStack(val);
    triggerSave({ techStack: val });
  }

  function handleTimeChange(val: string) {
    setEstimatedTime(val);
    triggerSave({ estimatedTime: val });
  }

  function handleTeamChange(val: number | '') {
    setTeamSize(val);
    triggerSave({ teamSize: val });
  }

  function handleNextActionChange(val: string) {
    setNextAction(val);
    triggerSave({ nextAction: val });
  }

  function handleEvaluationChange(key: keyof IdeaEvaluation, value: number) {
    const next = { ...evaluation, [key]: value };
    setEvaluation(next);
    setEvaluated(true);
    if (idea) updateIdea(idea.id, { evaluation: next });
  }

  function handleCompletionNoteChange(val: string) {
    setCompletionNote(val);
    triggerSave({ completionNote: val });
  }

  function handleAddLink(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && newLink.trim()) {
      e.preventDefault();
      const nLinks = [...links, newLink.trim()];
      setLinks(nLinks);
      setNewLink('');
      triggerSave({ links: nLinks });
    }
  }

  function handleRemoveLink(idx: number) {
    const nLinks = links.filter((_, i) => i !== idx);
    setLinks(nLinks);
    triggerSave({ links: nLinks });
  }

  function handleClose() {
    clearTimeout(saveTimer.current);
    if (!expandedIdeaId) return;

    // Permanently discard if completely empty (don't pollute Trash)
    if (!title.trim() && !description.trim()) {
      hardDeleteIdea(expandedIdeaId);
      toast('Discarded empty idea');
      openIdea(null);
      return;
    }

    // Flush save
    updateIdea(expandedIdeaId, {
      title, description, techStack, estimatedTime,
      teamSize: teamSize === '' ? undefined : teamSize,
      nextAction, links, completionNote,
      ...(wasNewOnOpen.current ? { processedAt: new Date().toISOString() } : {}),
    });

    if (wasNewOnOpen.current) {
      toast(
        (t) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontWeight: 600 }}>Idea captured! What's next?</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                className="btn btn-primary btn-sm"
                onClick={() => { updateIdea(expandedIdeaId, { status: 'building' }); toast.dismiss(t.id); }}
              >
                <Play size={12} /> Start Building
              </button>
              <button 
                className="btn btn-secondary btn-sm"
                onClick={() => { navigate('/ideas'); toast.dismiss(t.id); }}
              >
                View Library
              </button>
            </div>
          </div>
        ),
        { duration: 6000 }
      );
    }
    
    openIdea(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Tab') {
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]');
      const focusable = elements ? Array.from(elements).filter((element) => element.offsetParent !== null) : [];
      if (focusable.length) {
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    if (e.key === 'Escape') handleClose();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleClose();
    }
  }

  function handleStatusChange(status: Status) {
    if (!idea) return;
    updateIdea(idea.id, { status });
  }

  function handlePriorityChange(priority: Priority) {
    if (!idea) return;
    updateIdea(idea.id, { priority });
  }

  function handleDelete() {
    if (!idea) return;
    deleteIdea(idea.id);
    openIdea(null);
  }

  function handleDuplicate() {
    if (!idea) return;
    duplicateIdea(idea.id);
    openIdea(null);
  }

  function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!idea || !commentBody.trim()) return;
    addComment(idea.id, commentBody.trim());
    setCommentBody('');
  }

  function handleTagTemplate(templateId: string) {
    const tpl = IDEA_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl || !idea) return;
    const newDesc = tpl.fields.description ?? description;
    setDescription(newDesc);
    triggerSave({ description: newDesc });
  }

  async function handleDevelopWithAI() {
    setAiGenerating(true);
    try {
      const prompt = `Act as an expert product manager and software architect. I have an idea for a software project. 
Title: ${title}
Current Description/Notes:
${description}
      
Please help me develop this idea by providing:
1. A brief summary of the core value proposition.
2. A suggested tech stack and architecture.
3. 3-5 immediate next steps to get started.`;

      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3',
          prompt: prompt,
          stream: false
        })
      });

      if (!response.ok) throw new Error('Ollama API error');

      const data = await response.json();
      const newDesc = description + '\n\n---\n\n### 🤖 AI Development Plan\n' + data.response;
      setDescription(newDesc);
      triggerSave({ description: newDesc });
      toast.success('AI Development complete!');
    } catch (e) {
      console.warn('Ollama not running or accessible', e);
      const newDesc = description + '\n\n---\n\n### 🤖 AI Generation Error\nCould not connect to local Ollama instance on `localhost:11434`. Make sure Ollama is running and the `llama3` model is installed.';
      setDescription(newDesc);
      triggerSave({ description: newDesc });
      toast.error('Failed to connect to local AI.');
    } finally {
      setAiGenerating(false);
    }
  }

  if (!expandedIdeaId) return null;
  if (!idea) return null;

  const ideaTags = tags.filter((t) => idea.tagIds.includes(t.id));

  return (
    <div className={styles.backdrop} onClick={handleClose}>
      <div
        ref={dialogRef}
        className={`${styles.modal} animate-scale-in`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={`Idea: ${idea.title || 'Untitled'}`}
      >
        {/* Header toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            {/* Status selector */}
            <div className={styles.statusWrap}>
              <select
                className={styles.statusSelect}
                value={idea.status}
                onChange={(e) => handleStatusChange(e.target.value as Status)}
                style={{ '--status-color': STATUS_COLORS[idea.status] } as React.CSSProperties}
                aria-label="Status"
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>

            {/* Priority selector */}
            <div className={styles.priorityWrap}>
              <select
                className={styles.prioritySelect}
                value={idea.priority}
                onChange={(e) => handlePriorityChange(e.target.value as Priority)}
                style={{ '--priority-color': PRIORITY_COLORS[idea.priority] } as React.CSSProperties}
                aria-label="Priority"
              >
                {(['low', 'medium', 'high'] as Priority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.toolbarRight}>
            {saving && <Loader size={13} className={styles.savingIcon} />}
            <button
              className="btn btn-ghost btn-icon-sm"
              onClick={() => setPreviewMode((p) => !p)}
              title={previewMode ? 'Edit' : 'Preview markdown'}
              aria-pressed={previewMode}
            >
              {previewMode ? <EyeOff size={13} /> : <Eye size={13} />}
              <span style={{ fontSize: 11 }}>{previewMode ? 'Edit' : 'Preview'}</span>
            </button>
            <button className="btn btn-ghost btn-icon-sm" onClick={() => togglePin(idea.id)} title={idea.pinned ? 'Unpin' : 'Pin'}>
              {idea.pinned ? <PinOff size={13} /> : <Pin size={13} />}
            </button>
            <button className="btn btn-ghost btn-icon-sm" onClick={handleDuplicate} title="Duplicate">
              <Copy size={13} />
            </button>
            <button className="btn btn-ghost btn-icon-sm" onClick={handleDelete} title="Delete" style={{ color: '#ef4444' }}>
              <Trash2 size={13} />
            </button>
            <button className="btn btn-ghost btn-icon-sm" onClick={handleClose} title="Close (Esc)">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Title */}
          <input
            ref={titleRef}
            className={styles.titleInput}
            placeholder="Idea title…"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            aria-label="Idea title"
          />

          {/* Tags */}
          <div className={styles.metaFieldsRow}>
            <div className={styles.metaField}><label>Idea type</label><select className="input input-sm" value={idea.kind || 'product'} onChange={(event) => updateIdea(idea.id, { kind: event.target.value as IdeaKind })}>{(['product', 'feature', 'problem', 'project', 'learning', 'content'] as IdeaKind[]).map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></div>
            {isInboxIdea(idea) && <><button className="btn btn-primary btn-sm" onClick={() => processIdea(idea.id)}>Process</button><button className="btn btn-secondary btn-sm" onClick={() => deferIdea(idea.id, new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))}>Review in 7 days</button></>}
          </div>
          <div className={styles.tagsRow}>
            {ideaTags.map((tag) => (
              <span
                key={tag.id}
                className="tag"
                style={{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}
              >
                {tag.name}
              </span>
            ))}
            <TagPicker ideaId={idea.id} />
          </div>

          {/* Extended Metadata */}
          <div className={styles.metaFieldsRow}>
            <div className={styles.metaField}>
              <label>Tech Stack</label>
              <input
                className="input input-sm"
                placeholder="e.g. React, Node, Postgres"
                value={techStack}
                onChange={(e) => handleStackChange(e.target.value)}
              />
            </div>
            <div className={styles.metaField}>
              <label>Estimated Time</label>
              <input
                className="input input-sm"
                placeholder="e.g. 2 weeks"
                value={estimatedTime}
                onChange={(e) => handleTimeChange(e.target.value)}
              />
            </div>
            <div className={styles.metaField}>
              <label>Team Size</label>
              <input
                type="number"
                min="1"
                className="input input-sm"
                placeholder="e.g. 3"
                value={teamSize}
                onChange={(e) => handleTeamChange(e.target.value === '' ? '' : parseInt(e.target.value))}
              />
            </div>
            <button 
              className={`btn btn-primary btn-sm ${styles.aiBtn}`} 
              onClick={handleDevelopWithAI}
              disabled={aiGenerating}
            >
              {aiGenerating ? 'Developing...' : '✨ Develop with AI'}
            </button>
          </div>

          <div className={styles.metaFieldsRow} style={{ alignItems: 'end' }}>
            <div className={styles.metaField} style={{ flex: 1 }}>
              <label>Evaluation · {evaluated ? `${scoreIdea(evaluation)}/100` : 'Not evaluated'}</label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {([['problemSeverity', 'Problem'], ['excitement', 'Excitement'], ['strategicFit', 'Fit'], ['effort', 'Effort'], ['confidence', 'Confidence']] as const).map(([key, label]) => (
                  <label key={key} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {label} <input type="range" min="1" max="5" value={evaluation[key]} onChange={(e) => handleEvaluationChange(key, Number(e.target.value))} aria-label={label} />
                  </label>
                ))}
              </div>
              <small>{evaluated ? scoreExplanation(evaluation) : 'Move a slider to start evaluating.'}</small>
              <textarea className="input input-sm" placeholder="Evidence and sources" aria-label="Evaluation evidence" value={evaluation.evidence || ''} onChange={(event) => { const next = { ...evaluation, evidence: event.target.value }; setEvaluation(next); setEvaluated(true); updateIdea(idea.id, { evaluation: next }); }} />
            </div>
            {evaluated && <span className="badge badge-accent">{scoreLabel(scoreIdea(evaluation))}</span>}
          </div>

          <div className={styles.metaFieldsRow}>
            <div className={styles.metaField} style={{ flex: 2 }}>
              <label>Next Action</label>
              <input
                className="input input-sm"
                placeholder="What is the immediate next step?"
                value={nextAction}
                onChange={(e) => handleNextActionChange(e.target.value)}
              />
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => { const target = idea.id; handleClose(); navigate(`/work/${target}`); }}>Open linked work</button>
            {nextAction.trim() && <button className="btn btn-secondary btn-sm" onClick={() => { clearTimeout(saveTimer.current); updateIdea(idea.id, { nextAction }); completeNextAction(idea.id); setNextAction(''); }}>Complete action</button>}
          </div>
          <div className={styles.metaFieldsRow}><div className={styles.metaField}><label>Due date</label><input className="input input-sm" type="date" value={idea.dueDate || ''} onChange={(event) => updateIdea(idea.id, { dueDate: event.target.value })} /></div><div className={styles.metaField}><label>Review date</label><input className="input input-sm" type="date" value={idea.reviewAt || ''} onChange={(event) => updateIdea(idea.id, { reviewAt: event.target.value })} /></div></div>
          
          <div className={styles.metaFieldsRow}>
            <div className={styles.metaField} style={{ flex: 1 }}>
              <label>Links & Resources</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {links.map((link, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <a href={link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--accent)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link}</a>
                    <button className="btn btn-ghost btn-icon-sm" onClick={() => handleRemoveLink(idx)} title="Remove link" aria-label="Remove link"><X size={12} /></button>
                  </div>
                ))}
                <input
                  className="input input-sm"
                  placeholder="Add a link (press Enter)"
                  value={newLink}
                  onChange={(e) => setNewLink(e.target.value)}
                  onKeyDown={handleAddLink}
                />
              </div>
            </div>
          </div>
          
          {idea.status === 'done' && (
            <div className={styles.metaFieldsRow}>
              <div className={styles.metaField} style={{ flex: 1 }}>
          <label style={{ color: 'var(--success)' }}>Completion Note</label>
                <textarea
                  className="input input-sm"
                  style={{ minHeight: 60, resize: 'vertical' }}
                  placeholder="What was the outcome? Any learnings?"
                  value={completionNote}
                  onChange={(e) => handleCompletionNoteChange(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Template selector */}
          {!description && (
            <div className={styles.templates}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Use template:</span>
              {IDEA_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleTagTemplate(tpl.id)}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          )}

          {/* Description */}
          {previewMode ? (
            <div className={`${styles.preview} prose`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {description || '*No description*'}
              </ReactMarkdown>
            </div>
          ) : (
            <textarea
              className={`input textarea ${styles.descInput}`}
              placeholder="Describe your idea… (Markdown supported)"
              value={description}
              onChange={(e) => handleDescChange(e.target.value)}
              aria-label="Idea description"
            />
          )}

          {/* Meta info */}
          <div className={styles.meta}>
            <time dateTime={idea.createdAt}><Clock size={11} /> Created {formatDistanceToNow(new Date(idea.createdAt), { addSuffix: true })}</time>
            <time dateTime={idea.updatedAt}>Updated {formatDistanceToNow(new Date(idea.updatedAt), { addSuffix: true })}</time>
          </div>
        </div>

        {/* History */}
        {idea.history.length > 0 && (
          <div className={styles.section}>
            <button
              className={styles.sectionToggle}
              onClick={() => setHistoryOpen((o) => !o)}
            >
              <Clock size={13} />
              Version History ({idea.history.length})
              <ChevronDown size={13} style={{ transform: historyOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
            {historyOpen && (
              <div className={styles.historyList}>
                {idea.history.slice(0, 10).map((h) => (
                  <div key={h.id} className={styles.historyItem}>
                    <time dateTime={h.timestamp} className={styles.historyTime}>
                      {format(new Date(h.timestamp), 'MMM d, HH:mm')}
                    </time>
                    <span className={styles.historyChanges}>
                      {Object.keys(h.changes).filter(k => k !== 'updatedAt').join(', ')} changed
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Comments */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <MessageSquare size={13} />
            Notes & Comments ({idea.comments.length})
          </div>
          <div className={styles.comments}>
            {idea.comments.map((comment) => (
              <div key={comment.id} className={styles.comment}>
                <div className={styles.commentBody}>{comment.body}</div>
                <div className={styles.commentMeta}>
                  <time dateTime={comment.createdAt}>{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}</time>
                  <button
                    className="btn btn-ghost btn-icon-sm"
                    onClick={() => deleteComment(idea.id, comment.id)}
                    style={{ fontSize: 11, color: 'var(--text-muted)' }}
                    title="Delete note"
                    aria-label="Delete note"
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
            ))}
            <form className={styles.commentForm} onSubmit={handleAddComment}>
              <textarea
                className={`input input-sm textarea ${styles.commentInput}`}
                placeholder="Add a note…"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    handleAddComment(e as unknown as React.FormEvent);
                  }
                }}
                rows={2}
              />
              <button type="submit" className="btn btn-secondary btn-sm" disabled={!commentBody.trim()}>
                <Save size={12} /> Add Note
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
