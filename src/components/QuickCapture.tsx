import { useEffect, useRef, useState } from 'react';
import { useStore } from '../stores/useStore';
import type { IdeaKind } from '../types';

export default function QuickCapture() {
  const { quickCaptureOpen, setQuickCapture, createIdea } = useStore();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<IdeaKind>('product');
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLFormElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!quickCaptureOpen) return;
    previousFocus.current = document.activeElement as HTMLElement;
    input.current?.focus();
    return () => previousFocus.current?.focus();
  }, [quickCaptureOpen]);

  if (!quickCaptureOpen) return null;
  function close() { setQuickCapture(false); setTitle(''); }
  function capture(event: React.FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    createIdea({ title: value, kind });
    close();
  }
  return <div className="capture-backdrop" onMouseDown={close}>
    <form ref={dialog} className="capture-dialog card" style={{ background: 'var(--bg-base)', padding: '32px' }} role="dialog" aria-modal="true" aria-label="Quick capture" onMouseDown={(event) => event.stopPropagation()} onSubmit={capture} onKeyDown={(event) => { if (event.key === 'Escape') close(); if (event.key === 'Tab') { const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('input, select, button:not([disabled])') || [])]; const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }}>
      <input 
        ref={input} 
        value={title} 
        onChange={(event) => setTitle(event.target.value)} 
        placeholder="What are you thinking about?" 
        aria-label="Idea title"
        style={{
          background: 'transparent',
          border: 'none',
          fontSize: '24px',
          fontWeight: 700,
          padding: 0,
          color: 'var(--text-primary)',
          outline: 'none',
          width: '100%'
        }} 
      />
      <select className="input" value={kind} onChange={(event) => setKind(event.target.value as IdeaKind)} aria-label="Idea type">
        {(['product', 'feature', 'problem', 'project', 'learning', 'content'] as IdeaKind[]).map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <div className="capture-actions" style={{ marginTop: '16px' }}>
        <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!title.trim()}>Save to Inbox</button>
      </div>
    </form>
  </div>;
}
