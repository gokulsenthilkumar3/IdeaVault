import { useEffect } from 'react';
import { useStore } from '../stores/useStore';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import type { Theme } from '../types';

export default function KeyboardShortcuts() {
  const { 
    setCommandPalette, 
    preferences, 
    setPreference, 
    undo, 
    setQuickCapture,
  } = useStore();
  
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input or textarea
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        // Allow escape to blur
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement).blur();
        }
        return;
      }

      // ⌘K - Command Palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPalette(true);
      }

      // ⌘Z - Undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        undo();
        toast('Undo', { icon: '↩️' });
      }

      // N - New Idea
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setQuickCapture(true);
      }

      // / - Search focus (same as command palette for now)
      if (e.key === '/') {
        e.preventDefault();
        setCommandPalette(true);
      }

      // T - Toggle Theme
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        const themes: Theme[] = ['light', 'dark', 'system', 'midnight', 'cyberpunk', 'forest'];
        const currentIdx = themes.indexOf(preferences.theme);
        const nextTheme = themes[(currentIdx + 1) % themes.length];
        setPreference('theme', nextTheme);
        toast(`Theme: ${nextTheme}`, { icon: '🎨' });
      }

      // V - Cycle View Mode
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        const views: ('grid' | 'list' | 'board' | 'timeline')[] = ['grid', 'list', 'board', 'timeline'];
        const currentIdx = views.indexOf(preferences.viewMode);
        const nextView = views[(currentIdx + 1) % views.length];
        setPreference('viewMode', nextView);
        toast(`View: ${nextView}`, { icon: '👁️' });
      }

      // Navigation: 1-5
      if (e.key === '1') navigate('/dashboard');
      if (e.key === '2') navigate('/inbox');
      if (e.key === '3') navigate('/ideas');
      if (e.key === '4') navigate('/tags');
      if (e.key === '5') navigate('/settings');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    setCommandPalette, undo, setQuickCapture,
    preferences.theme, preferences.viewMode, setPreference, navigate
  ]);

  return null;
}
