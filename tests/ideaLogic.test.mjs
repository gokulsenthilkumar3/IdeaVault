import test from 'node:test';
import assert from 'node:assert/strict';
import { isInboxIdea, isExecutionIdea, isStaleIdea, scoreIdea, scoreExplanation } from '../src/lib/ideaLogic.ts';

const base = { id: 'a', title: 'Test', status: 'idea', updatedAt: new Date().toISOString() };

test('capture requires explicit processing and excludes deleted ideas', () => {
  assert.equal(isInboxIdea({ ...base }), false);
  assert.equal(isInboxIdea({ ...base, capturedAt: new Date().toISOString() }), true);
  assert.equal(isInboxIdea({ ...base, capturedAt: new Date().toISOString(), processedAt: new Date().toISOString() }), false);
  assert.equal(isInboxIdea({ ...base, capturedAt: new Date().toISOString(), deletedAt: new Date().toISOString() }), false);
});

test('execution is based on status, independently of the next action', () => {
  assert.equal(isExecutionIdea({ ...base, status: 'planned' }), true);
  assert.equal(isExecutionIdea({ ...base, status: 'building' }), true);
  assert.equal(isExecutionIdea({ ...base, status: 'done' }), false);
});

test('stale excludes completed and archived ideas', () => {
  const old = new Date(Date.now() - 31 * 86400000).toISOString();
  assert.equal(isStaleIdea({ ...base, updatedAt: old }), true);
  assert.equal(isStaleIdea({ ...base, updatedAt: old, status: 'done' }), false);
});

test('score is deterministic, bounded, and explains effort cost', () => {
  const evaluation = { problemSeverity: 5, excitement: 5, strategicFit: 5, confidence: 5, effort: 5 };
  assert.equal(scoreIdea(evaluation), 90);
  assert.match(scoreExplanation(evaluation), /10 points/);
  assert.equal(scoreIdea(undefined), 0);
});
