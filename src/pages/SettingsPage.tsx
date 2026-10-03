import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Sun, Moon, Monitor, Download, Upload, Trash2, AlertTriangle, Star, Zap, TreePine } from 'lucide-react';
import { useStore } from '../stores/useStore';
import {
  exportToJSON, exportToCSV, exportToMarkdown,
  importFromJSON, downloadFile,
} from '../lib/storage';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { getSyncConflict, resolveSyncConflict, pendingWriteCount, flushPendingWrites } from '../lib/storage';
import type { Theme, ViewMode, Status, Priority } from '../types';
import { STATUS_LABELS, STATUS_ORDER } from '../types';
import styles from './SettingsPage.module.css';

import { useTitle } from '../hooks/useTitle';

export default function SettingsPage() {
  useTitle('Settings');
  const { preferences, setPreference, ideas, tags, savedFilters, importData, syncFromServer, syncStatus } = useStore();
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const conflict = getSyncConflict();
  const [params, setParams] = useSearchParams();
  const validTabs = ['appearance', 'workflow', 'data', 'integrations'] as const;
  const tab = validTabs.find((item) => item === params.get('tab')) || 'appearance';
  const [preview, setPreview] = useState<{ total: number; conflicts: number; format: string } | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [integrationsSummary, setIntegrationsSummary] = useState('');

  useEffect(() => {
    if (tab === 'integrations') {
      Promise.all([api<any[]>('/agents/configs'), api<any[]>('/agents/repositories')])
        .then(([configs, repos]) => setIntegrationsSummary(`${configs.length} agents, ${repos.length} repositories`))
        .catch(() => setIntegrationsSummary('Failed to load counts'));
    }
  }, [tab]);

  const activeIdeas = ideas.filter((i) => !i.deletedAt);

  async function handleExportJSON() {
    let content = exportToJSON(ideas, tags, savedFilters, preferences);
    try { content = JSON.stringify(await api('/backup'), null, 2); } catch { /* local cache export remains available offline */ }
    downloadFile(content, `idea-vault-${new Date().toISOString().split('T')[0]}.json`, 'application/json');
    toast.success('Exported as JSON');
  }

  function handleExportCSV() {
    const content = exportToCSV(ideas, tags);
    downloadFile(content, `idea-vault-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
    toast.success('Exported as CSV');
  }

  function handleExportMarkdown() {
    const content = exportToMarkdown(ideas, tags);
    downloadFile(content, `idea-vault-${new Date().toISOString().split('T')[0]}.md`, 'text/markdown');
    toast.success('Exported as Markdown');
  }

  async function handleImport() {
    try {
      const parsed = JSON.parse(importText);
      if (parsed.format === 'idea-vault-full-backup') {
        const preview = await api<{ counts: Record<string, { total: number; conflicts: number }> }>('/backup/preview', { method: 'POST', body: importText });
        const total = Object.values(preview.counts).reduce((sum, item) => sum + item.total, 0);
        const conflicts = Object.values(preview.counts).reduce((sum, item) => sum + item.conflicts, 0);
        if (!window.confirm(`Import ${total} records? ${conflicts} matching IDs will be skipped. A database backup will be created first.`)) return;
        const result = await api<{ inserted: Record<string, number> }>('/backup/restore', { method: 'POST', body: importText });
        await syncFromServer();
        toast.success(`Imported ${Object.values(result.inserted).reduce((sum, count) => sum + count, 0)} records`);
      } else {
        const data = importFromJSON(importText);
        downloadFile(exportToJSON(ideas, tags, savedFilters, preferences), `idea-vault-pre-import-${new Date().toISOString().split('T')[0]}.json`, 'application/json');
        const result = importData(data);
        toast.success(`Imported ${result.ideas} ideas and ${result.tags} tags; skipped ${result.conflicts} duplicate IDs`);
      }
      setImportText('');
      setShowImport(false);
    } catch (error) {
      toast.error(String(error));
    }
  }

  function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setImportText(text);
      setShowImport(true);
      setPreview(null);
    };
    reader.readAsText(file);
  }

  async function previewImport() {
    try {
      const parsed = JSON.parse(importText);
      if (parsed.format === 'idea-vault-full-backup') {
        const result = await api<{ counts: Record<string, { total: number; conflicts: number }> }>('/backup/preview', { method: 'POST', body: importText });
        setPreview({ format: 'Full backup', total: Object.values(result.counts).reduce((sum, item) => sum + item.total, 0), conflicts: Object.values(result.counts).reduce((sum, item) => sum + item.conflicts, 0) });
      } else {
        const result = importFromJSON(importText);
        setPreview({ format: 'Ideas export', total: result.ideas.length + result.tags.length, conflicts: result.ideas.filter((item) => ideas.some((idea) => idea.id === item.id)).length + result.tags.filter((item) => tags.some((tag) => tag.id === item.id)).length });
      }
    } catch (error) { toast.error(String(error)); setPreview(null); }
  }

  const THEMES: { value: Theme; icon: React.ReactNode; label: string }[] = [
    { value: 'dark', icon: <Moon size={14} />, label: 'Dark' },
    { value: 'light', icon: <Sun size={14} />, label: 'Light' },
    { value: 'system', icon: <Monitor size={14} />, label: 'System' },
    { value: 'midnight', icon: <Star size={14} />, label: 'Midnight' },
    { value: 'cyberpunk', icon: <Zap size={14} />, label: 'Cyberpunk' },
    { value: 'forest', icon: <TreePine size={14} />, label: 'Forest' },
  ];

  const VIEW_MODES: { value: ViewMode; label: string }[] = [
    { value: 'grid', label: 'Grid' },
    { value: 'list', label: 'List' },
    { value: 'board', label: 'Board' },
    { value: 'timeline', label: 'Timeline' },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Settings</h1>
        <p className={styles.sub}>Customize your Idea Vault experience</p>
      </div>
      <nav className="page-tabs settings-tabs" aria-label="Settings sections">{validTabs.map((item) => <button key={item} aria-current={tab === item ? 'page' : undefined} className={tab === item ? 'active' : ''} onClick={() => setParams({ tab: item })}>{({ appearance: 'Appearance', workflow: 'Workflow', data: 'Data & Sync', integrations: 'Integrations' })[item]}</button>)}</nav>

      {/* ── Appearance ──────────────────────────────────────────────────── */}
      {tab === 'appearance' && <>
      <section className={`card ${styles.section}`}>
        <h2 className={styles.sectionTitle}>Appearance</h2>

        <div className={styles.setting}>
          <div className={styles.settingInfo}>
            <label className={styles.settingLabel}>Theme</label>
            <span className={styles.settingDesc}>Choose your preferred color scheme</span>
          </div>
          <div className="tabs">
            {THEMES.map(({ value, icon, label }) => (
              <button
                key={value}
                className={`tab ${preferences.theme === value ? 'active' : ''}`}
                onClick={() => setPreference('theme', value)}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </div>

        <div className={`${styles.setting} ${styles.settingDivider}`}>
          <div className={styles.settingInfo}>
            <label className={styles.settingLabel}>Default View</label>
            <span className={styles.settingDesc}>How ideas are displayed by default</span>
          </div>
          <div className="tabs">
            {VIEW_MODES.map(({ value, label }) => (
              <button
                key={value}
                className={`tab ${preferences.viewMode === value ? 'active' : ''}`}
                onClick={() => setPreference('viewMode', value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>
      </>}

      {/* ── Behavior ──────────────────────────────────────────────────── */}
      {tab === 'workflow' && <>
      <section className={`card ${styles.section}`}>
        <h2 className={styles.sectionTitle}>Behavior</h2>

        <div className={styles.setting}>
          <div className={styles.settingInfo}>
            <label className={styles.settingLabel}>Default Status</label>
            <span className={styles.settingDesc}>Status applied to new ideas</span>
          </div>
          <select
            className="input"
            style={{ width: 160 }}
            value={preferences.defaultStatus}
            onChange={(e) => setPreference('defaultStatus', e.target.value as Status)}
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div className={`${styles.setting} ${styles.settingDivider}`}>
          <div className={styles.settingInfo}>
            <label className={styles.settingLabel}>Default Priority</label>
            <span className={styles.settingDesc}>Priority applied to new ideas</span>
          </div>
          <select
            className="input"
            style={{ width: 160 }}
            value={preferences.defaultPriority}
            onChange={(e) => setPreference('defaultPriority', e.target.value as Priority)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        <div className={`${styles.setting} ${styles.settingDivider}`}>
          <div className={styles.settingInfo}>
            <label className={styles.settingLabel}>Auto-save Delay</label>
            <span className={styles.settingDesc}>Milliseconds before saving changes</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range"
              min={200}
              max={3000}
              step={100}
              value={preferences.autoSaveMs}
              onChange={(e) => setPreference('autoSaveMs', Number(e.target.value))}
              style={{ width: 120 }}
            />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', width: 50 }}>{preferences.autoSaveMs}ms</span>
          </div>
        </div>

        <div className={`${styles.setting} ${styles.settingDivider}`}>
          <div className={styles.settingInfo}>
            <label className={styles.settingLabel}>Undo History Size</label>
            <span className={styles.settingDesc}>Maximum undo steps (⌘Z)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range"
              min={5}
              max={50}
              step={5}
              value={preferences.undoStackSize}
              onChange={(e) => setPreference('undoStackSize', Number(e.target.value))}
              style={{ width: 120 }}
            />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', width: 30 }}>{preferences.undoStackSize}</span>
          </div>
        </div>
      </section>
      </>}

      {/* ── Export ────────────────────────────────────────────────────── */}
      {tab === 'data' && <><section className={`card ${styles.section}`}><h2 className={styles.sectionTitle}>Sync health</h2><p>Current state: <strong>{syncStatus}</strong> · {pendingWriteCount()} pending local changes</p><p>Local changes remain queued while offline. Conflicts need your choice before they can continue.</p><button className="btn btn-secondary" disabled={syncBusy} onClick={async () => { setSyncBusy(true); try { await flushPendingWrites(); await syncFromServer(); toast.success('Sync checked'); } catch (error) { toast.error(String(error)); } finally { setSyncBusy(false); } }}>Retry sync</button></section>
      {conflict && <section className={`card ${styles.section}`}><h2 className={styles.sectionTitle}>Resolve sync conflict</h2><p>Record {conflict.key}/{conflict.id} changed elsewhere. Download a backup, then choose which copy to keep.</p><div className={styles.exportRow}><button className="btn btn-secondary" onClick={handleExportJSON}>Download backup</button><button className="btn btn-secondary" onClick={async () => { await resolveSyncConflict('remote'); await syncFromServer(); }}>Keep server copy</button><button className="btn btn-danger" onClick={async () => { if (!window.confirm('Replace the server record with your local copy?')) return; await resolveSyncConflict('local'); }}>Keep local copy</button></div></section>}
      <section className={`card ${styles.section}`}>
        <h2 className={styles.sectionTitle}>Backups & exports</h2>
        <p className={styles.sectionDesc}>Full JSON includes linked work and relationships when the server is available. CSV and Markdown are readable exports of {activeIdeas.length} active ideas, not full backups.</p>
        <div className={styles.exportRow}>
          <button className="btn btn-secondary" onClick={handleExportJSON}>
            <Download size={14} /> Export JSON
          </button>
          <button className="btn btn-secondary" onClick={handleExportCSV}>
            <Download size={14} /> Export CSV
          </button>
          <button className="btn btn-secondary" onClick={handleExportMarkdown}>
            <Download size={14} /> Export Markdown
          </button>
        </div>
      </section>

      {/* ── Import ────────────────────────────────────────────────────── */}
      <section className={`card ${styles.section}`}>
        <h2 className={styles.sectionTitle}>Import Data</h2>
        <p className={styles.sectionDesc}>Import ideas from a JSON export file.</p>
        <div className={styles.importRow}>
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            <Upload size={14} /> Choose File
            <input type="file" accept=".json" onChange={handleFileImport} style={{ display: 'none' }} />
          </label>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowImport(!showImport)}>
            Or paste JSON
          </button>
        </div>
        {showImport && (
          <div className={styles.importArea}>
            <textarea
              className="input textarea"
              placeholder='Paste JSON export here… {"version":2,"ideas":[...]}'
              value={importText}
              onChange={(e) => { setImportText(e.target.value); setPreview(null); }}
              rows={6}
            />
            <button className="btn btn-secondary btn-sm" onClick={previewImport} disabled={!importText.trim()}>Preview import</button>
            {preview && <p role="status">{preview.format}: {preview.total} records, {preview.conflicts} matching IDs will be skipped. A pre-import backup is created before restore.</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={handleImport} disabled={!importText.trim()}>
                Import
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowImport(false); setImportText(''); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
      </>}

      {/* ── Keyboard shortcuts reference ──────────────────────────────── */}
      {tab === 'workflow' && <>
      <section className={`card ${styles.section}`}>
        <h2 className={styles.sectionTitle}>Keyboard Shortcuts</h2>
        <div className={styles.shortcutsGrid}>
          {[
            { keys: ['⌘', 'K'], label: 'Open command palette' },
            { keys: ['⌘', 'Z'], label: 'Undo last action' },
            { keys: ['N'], label: 'New idea' },
            { keys: ['/'], label: 'Quick search' },
            { keys: ['1–5'], label: 'Navigate sections' },
            { keys: ['T'], label: 'Toggle theme' },
            { keys: ['V'], label: 'Cycle view mode' },
            { keys: ['Esc'], label: 'Close / deselect' },
            { keys: ['⌘', '↵'], label: 'Save & close idea' },
          ].map(({ keys, label }) => (
            <div key={label} className={styles.shortcutRow}>
              <div className={styles.shortcutKeys}>
                {keys.map((k, i) => <kbd key={i}>{k}</kbd>)}
              </div>
              <span className={styles.shortcutLabel}>{label}</span>
            </div>
          ))}
        </div>
      </section>
      </>}

      {/* ── Danger zone ───────────────────────────────────────────────── */}
      {tab === 'data' && <>
      <section className={`card ${styles.section} ${styles.dangerSection}`}>
        <h2 className={styles.sectionTitle} style={{ color: '#ef4444' }}>
          <AlertTriangle size={16} style={{ display: 'inline', marginRight: 6 }} />
          Danger Zone
        </h2>
        <div className={styles.setting}>
          <div className={styles.settingInfo}>
            <label className={styles.settingLabel}>Clear All Data</label>
            <span className={styles.settingDesc}>Permanently delete all ideas, tags, and preferences. This cannot be undone.</span>
          </div>
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (!window.confirm('Delete all Idea Vault data? A server backup will be created first.')) return;
              const confirmation = window.prompt('Type WIPE IDEA VAULT to confirm');
              if (confirmation !== 'WIPE IDEA VAULT') return;
              try { await handleExportJSON(); await api('/backup/wipe', { method: 'POST', body: JSON.stringify({ confirmation }) }); localStorage.clear(); window.location.reload(); }
              catch (error) { toast.error(String(error)); }
            }}
          >
            <Trash2 size={14} /> Wipe All Data
          </button>
        </div>
      </section>
      </>}
      {tab === 'integrations' && <section className={`card ${styles.section}`}><h2 className={styles.sectionTitle}>Connected tools</h2><p>Manage agent executables, repository permissions, and read-only connection checks in one place. SMTP and GitHub credentials are configured on the server, never stored in this browser.</p><p style={{ fontWeight: 500 }}>{integrationsSummary || 'Loading...'}</p><Link className="btn btn-primary" to="/agents">Manage agents & repositories</Link><p>Publishing a post and deploying code each require separate owner approval.</p></section>}
    </div>
  );
}
