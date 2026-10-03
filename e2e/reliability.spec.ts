import { test, expect } from '@playwright/test';

const idea = (id: string, title: string) => ({
  id, title, description: '', status: 'idea', priority: 'medium', tagIds: [],
  pinned: false, position: 0, createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', comments: [], history: [],
});
const snapshot = (ideas: ReturnType<typeof idea>[]) => ({
  ideas, tags: [], savedFilters: [], preferences: {},
  versions: { ideas: Object.fromEntries(ideas.map((item) => [item.id, 1])) },
});

test('command palette opens Quick capture with both keyboard and mouse', async ({ page }) => {
  await page.goto('/dashboard');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Command palette search' }).fill('Quick capture');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Save to Inbox' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.getByRole('option', { name: /Quick capture to Inbox/ }).click();
  await expect(page.getByRole('button', { name: 'Save to Inbox' })).toBeVisible();
});

test('palette keyboard selection matches the displayed grouped result', async ({ page }) => {
  await page.route('**/api/data', (route) => route.fulfill({ json: snapshot([idea('search-result', 'Go to Idea')]) }));
  await page.goto('/ideas');
  await expect(page.getByText('Go to Idea').first()).toBeVisible();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Command palette search' });
  await search.fill('Go');
  const target = page.getByRole('option').filter({ hasText: /^Go to IdeaIdea/ });
  const options = page.getByRole('option');
  const labels = await options.allTextContents();
  const index = labels.findIndex((label) => label.startsWith('Go to IdeaIdea'));
  expect(index).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < index; i++) await search.press('ArrowDown');
  await expect(target).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Idea: Go to Idea' })).toBeVisible();
});

test('empty server does not resurrect ideas from an old browser cache', async ({ page }) => {
  const stale = idea('removed', 'Previously deleted');
  await page.addInitScript((cached) => {
    localStorage.setItem('iv_schema_version', '2');
    localStorage.setItem('iv_ideas', JSON.stringify([cached]));
  }, stale);
  let writes = 0;
  await page.route('**/api/records/**', (route) => { writes++; return route.fulfill({ json: { version: 1 } }); });
  await page.route('**/api/data', (route) => route.fulfill({ json: snapshot([]) }));
  await page.goto('/ideas');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('iv_ideas'))).toBe('[]');
  expect(writes).toBe(0);
});

test('startup drains offline edits before fetching the current server snapshot', async ({ page }) => {
  const local = idea('local', 'Offline edit');
  const remote = idea('remote', 'Created elsewhere');
  await page.addInitScript((cached) => {
    localStorage.setItem('iv_schema_version', '2');
    localStorage.setItem('iv_ideas', JSON.stringify([cached]));
    localStorage.setItem('iv_pending_writes', JSON.stringify([{ key: 'ideas', id: cached.id, value: cached, expectedVersion: 0 }]));
  }, local);
  const requests: string[] = [];
  await page.route('**/api/records/**', (route) => { requests.push('write'); return route.fulfill({ json: { version: 1 } }); });
  await page.route('**/api/data', (route) => { requests.push('read'); return route.fulfill({ json: snapshot([local, remote]) }); });
  await page.goto('/ideas');
  await expect(page.getByText('Created elsewhere').first()).toBeVisible();
  expect(requests.slice(0, 2)).toEqual(['write', 'read']);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('iv_pending_writes'))).toBe('[]');
});

test('a stale in-flight snapshot cannot overwrite a newly saved idea', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let firstRead = true;
  let reads = 0;
  let saved: ReturnType<typeof idea> | undefined;
  await page.route('**/api/records/ideas/*', async (route) => {
    saved = route.request().postDataJSON().value;
    await route.fulfill({ json: { version: 1 } });
  });
  await page.route('**/api/data', async (route) => {
    reads++;
    if (firstRead) {
      firstRead = false;
      await held;
      await route.fulfill({ json: snapshot([]) });
    } else await route.fulfill({ json: snapshot(saved ? [saved] : []) });
  });
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Capture idea' }).click();
  await page.getByRole('textbox', { name: 'Idea title' }).fill('Keep my newest edit');
  await page.getByRole('button', { name: 'Save to Inbox' }).click();
  await expect.poll(() => saved?.title).toBe('Keep my newest edit');
  release();
  await expect.poll(() => reads).toBe(2);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('iv_ideas') || '[]').map((item: { title: string }) => item.title))).toEqual(['Keep my newest edit']);
  await expect(page.getByRole('heading', { name: 'Keep my newest edit' })).toBeVisible();
});

test('new conflicts appear in Settings and remain paused until resolved', async ({ page }) => {
  const local = idea('conflicted', 'Local edit');
  const remote = idea('conflicted', 'Server edit');
  await page.addInitScript((cached) => {
    localStorage.setItem('iv_schema_version', '2');
    localStorage.setItem('iv_ideas', JSON.stringify([cached]));
    localStorage.setItem('iv_pending_writes', JSON.stringify([{ key: 'ideas', id: cached.id, value: cached, expectedVersion: 1 }]));
  }, local);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  await page.route('**/api/records/**', async (route) => {
    writes++;
    await held;
    await route.fulfill({ status: 409, json: { current: remote, version: 2 } });
  });
  await page.route('**/api/data', (route) => route.fulfill({ json: snapshot([remote]) }));
  await page.goto('/settings?tab=data');
  await expect(page.getByRole('heading', { name: 'Sync health' })).toBeVisible();
  release();
  await expect(page.getByRole('heading', { name: 'Resolve sync conflict' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry sync' }).click();
  await expect(page.getByRole('button', { name: 'Retry sync' })).toBeEnabled();
  expect(writes).toBe(1);
  await page.getByRole('button', { name: 'Keep server copy' }).click();
  await expect(page.getByRole('heading', { name: 'Resolve sync conflict' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('iv_ideas') || '[]')[0]?.title)).toBe('Server edit');
});
