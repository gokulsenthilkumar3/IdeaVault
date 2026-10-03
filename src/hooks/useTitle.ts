import { useEffect } from 'react';

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} — Idea Vault` : 'Idea Vault';
  }, [title]);
}
