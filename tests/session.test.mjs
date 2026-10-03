import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore, SESSION_TTL_MS } from '../session-store.js';

test('owner sessions expire on the server even if a client retains its cookie', () => {
  let now = 1000;
  const sessions = createSessionStore(() => now);
  const token = sessions.create();
  assert.equal(sessions.has(token), true);
  now += SESSION_TTL_MS - 1;
  assert.equal(sessions.has(token), true);
  now++;
  assert.equal(sessions.has(token), false);
  assert.equal(sessions.has('unknown'), false);
});
