import { Outlet, NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Lightbulb, Tag, Settings,
  Trash2, Plus, Search, Zap, ChevronLeft, Bot, BookOpen, Inbox, ListTodo
} from 'lucide-react';
import { useStore } from '../stores/useStore';
import { isInboxIdea } from '../lib/ideaLogic';
import styles from './Layout.module.css';

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inbox', icon: Inbox, label: 'Inbox' },
  { to: '/now', icon: ListTodo, label: 'Now' },
  { to: '/ideas', icon: Lightbulb, label: 'Ideas' },
  { to: '/tags', icon: Tag, label: 'Tags' },
  { to: '/trash', icon: Trash2, label: 'Trash' },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/blog', icon: BookOpen, label: 'Blog' },
];

export default function Layout() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [token, setToken] = useState('');
  const [loginError, setLoginError] = useState('');
  useEffect(() => { fetch('/api/owner/session').then((res) => res.json()).then((data) => setAuthenticated(data.authenticated)).catch(() => setAuthenticated(false)); }, []);
  const { preferences, setPreference, setQuickCapture, setCommandPalette, ideas } = useStore();
  const { sidebarCollapsed } = preferences;
  const syncStatus = useStore((state) => state.syncStatus);

  const trashCount = ideas.filter((i) => i.deletedAt).length;
  const inboxCount = ideas.filter(isInboxIdea).length;

  if (authenticated === null) return (
    <div className={styles.root}>
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.collapsed : ''}`}>
        <div className={styles.logo}>
          <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
          {!sidebarCollapsed && <div className="skeleton" style={{ width: 100, height: 16, borderRadius: 4 }} />}
        </div>
        <div className={styles.quickActions}>
          <div className="skeleton" style={{ width: '100%', height: 32, borderRadius: 6 }} />
        </div>
        <nav className={styles.nav}>
          {[1, 2, 3, 4, 5, 6, 7].map(i => (
            <div key={i} className={styles.navItem} style={{ pointerEvents: 'none' }}>
              <div className="skeleton" style={{ width: 16, height: 16, borderRadius: 4 }} />
              {!sidebarCollapsed && <div className="skeleton" style={{ width: 60, height: 14, borderRadius: 4 }} />}
            </div>
          ))}
        </nav>
      </aside>
      <main className={styles.main} style={{ padding: 24 }}>
        <div className="skeleton" style={{ width: '30%', height: 32, borderRadius: 6, marginBottom: 24, maxWidth: 200 }} />
        <div className="skeleton" style={{ width: '100%', height: 200, borderRadius: 8 }} />
      </main>
    </div>
  );
  if (!authenticated) return <main className="work-page"><form className="card capture-dialog" onSubmit={async (event) => { event.preventDefault(); const res = await fetch('/api/owner/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }); if (res.ok) { setAuthenticated(true); window.location.reload(); } else setLoginError('Invalid owner token'); }}><h1>Owner login</h1><input className="input" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Owner token" required /><button className="btn btn-primary">Sign in</button>{loginError && <p role="alert">{loginError}</p>}</form></main>;

  function handleNewIdea() {
    setQuickCapture(true);
  }

  return (
    <div className={styles.root}>
      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.collapsed : ''}`}>
        {/* Logo */}
        <div className={styles.logo}>
          <div className={styles.logoIcon}>
            <Zap size={18} />
          </div>
          {!sidebarCollapsed && <span className={styles.logoText}>Idea Vault</span>}
        </div>

        {/* Quick actions */}
        <div className={styles.quickActions}>
          <button className={`btn btn-primary ${sidebarCollapsed ? 'btn-icon' : ''}`} style={{ width: '100%' }} onClick={handleNewIdea}>
            <Plus size={16} />
            {!sidebarCollapsed && 'New Idea'}
          </button>
          {!sidebarCollapsed && (
            <button
              className="btn btn-ghost btn-icon"
              style={{ flexShrink: 0 }}
              onClick={() => setCommandPalette(true)}
              title="Search (⌘K)"
            >
              <Search size={15} />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className={styles.nav} role="navigation" aria-label="Main navigation">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navActive : ''}`
              }
              title={sidebarCollapsed ? label : undefined}
              aria-label={label}
            >
              <Icon size={16} strokeWidth={2} />
              {!sidebarCollapsed && <span>{label}</span>}
              {label === 'Trash' && trashCount > 0 && (
                <span className={styles.badge}>{trashCount}</span>
              )}
              {label === 'Inbox' && inboxCount > 0 && (
                <span className={`${styles.badge} ${styles.badgeInbox}`}>{inboxCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Sidebar footer */}
        <div className={styles.sidebarFooter}>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.navActive : ''}`
            }
            title={sidebarCollapsed ? 'Settings' : undefined}
          >
            <Settings size={16} />
            {!sidebarCollapsed && 'Settings'}
          </NavLink>
          <button
            className={`btn btn-ghost btn-icon-sm ${styles.collapseBtn}`}
            onClick={() => setPreference('sidebarCollapsed', !sidebarCollapsed)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft size={14} style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className={styles.main}>
        {syncStatus !== 'synced' && <div className="sync-banner" role="status">{syncStatus === 'loading' ? 'Loading vault…' : syncStatus === 'pending' ? 'Saving changes…' : syncStatus === 'conflict' ? <>Sync conflict: your local changes are preserved. <NavLink to="/settings">Resolve in Settings</NavLink>.</> : 'Offline: changes are saved locally and will sync when reconnected.'}</div>}
        <Outlet />
      </main>
    </div>
  );
}
