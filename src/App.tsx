import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './stores/useStore';
import Layout from './components/Layout';
import KeyboardShortcuts from './components/KeyboardShortcuts';
import QuickCapture from './components/QuickCapture';
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const IdeaModal = lazy(() => import('./components/IdeaModal'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const IdeasPage = lazy(() => import('./pages/IdeasPage'));
const TagsPage = lazy(() => import('./pages/TagsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const TrashPage = lazy(() => import('./pages/TrashPage'));
const BlogPage = lazy(() => import('./pages/BlogPage'));
const WorkPage = lazy(() => import('./pages/WorkPage'));
const AgentsPage = lazy(() => import('./pages/AgentsPage'));
const InboxPage = lazy(() => import('./pages/InboxPage'));
const NowPage = lazy(() => import('./pages/NowPage'));

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useStore((s) => s.preferences.theme);

  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (t: string) => {
      root.setAttribute('data-theme', t);
    };

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mq.matches ? 'dark' : 'light');
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  return <>{children}</>;
}

export default function App() {
  const commandPaletteOpen = useStore((state) => state.commandPaletteOpen);
  const expandedIdeaId = useStore((state) => state.expandedIdeaId);
  return (
    <ThemeProvider>
      <BrowserRouter>
        <KeyboardShortcuts />
        <QuickCapture />
        <Suspense fallback={null}>{commandPaletteOpen && <CommandPalette />}{expandedIdeaId && <IdeaModal />}</Suspense>
        <Suspense fallback={<main className="route-loading" role="status">Loading page…</main>}><Routes>
          <Route path="blog" element={<BlogPage />} />
          <Route path="blog/:slug" element={<BlogPage />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="ideas" element={<IdeasPage />} />
            <Route path="tags" element={<TagsPage />} />
            <Route path="trash" element={<TrashPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="work/:ideaId" element={<WorkPage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="now" element={<NowPage />} />
          </Route>
        </Routes></Suspense>
      </BrowserRouter>
    </ThemeProvider>
  );
}
