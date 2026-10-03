import crypto from 'node:crypto';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function createSessionStore(now = Date.now) {
  const sessions = new Map();
  function prune() {
    const timestamp = now();
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= timestamp) sessions.delete(token);
    }
  }
  return {
    create() {
      prune();
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, now() + SESSION_TTL_MS);
      return token;
    },
    has(token) {
      prune();
      return sessions.has(token);
    },
    delete(token) { sessions.delete(token); },
  };
}
