import { test, expect } from '@playwright/test';

test('capture an idea and open its linked work', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /capture an idea|new idea/i }).first().click();
  await page.getByRole('textbox', { name: 'Idea title' }).fill('Test idea to blog');
  await page.getByRole('button', { name: 'Save to Inbox' }).click();
  await expect(page.getByText('Test idea to blog').first()).toBeVisible();
  await page.getByText('Test idea to blog').first().click();
  await page.getByRole('button', { name: 'Open linked work' }).click();
  await expect(page.getByRole('heading', { name: /Test idea to blog.*Work/ })).toBeVisible();
  await page.getByRole('button', { name: 'Create draft from idea' }).click();
  await expect(page.getByLabel('Markdown')).toBeVisible();
});

test('mobile Inbox and Settings are usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Ready to review/ })).toBeVisible();
  await page.getByRole('button', { name: 'Capture idea' }).click();
  await page.getByRole('textbox', { name: 'Idea title' }).fill('Mobile inbox thought');
  await page.getByRole('button', { name: 'Save to Inbox' }).click();
  await expect(page.getByRole('heading', { name: 'Mobile inbox thought' })).toBeVisible();
  await page.goto('/settings?tab=data');
  await expect(page.getByRole('heading', { name: 'Sync health' })).toBeVisible();
  await page.getByRole('button', { name: 'Integrations' }).click();
  await expect(page).toHaveURL(/tab=integrations/);
  await expect(page.getByRole('link', { name: 'Manage agents & repositories' })).toBeVisible();
});

test('every primary route renders without a client error or mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const route of ['/dashboard', '/ideas', '/inbox', '/now', '/tags', '/trash', '/agents', '/settings', '/blog']) {
    await page.goto(route);
    await expect(page.locator('h1').first(), `heading on ${route}`).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, `horizontal overflow on ${route}`).toBe(false);
    await page.screenshot({ path: test.info().outputPath(`mobile-${route.slice(1)}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('all saved themes remain usable across desktop pages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/settings?tab=appearance');
  for (const theme of ['Dark', 'Light', 'System', 'Midnight', 'Cyberpunk', 'Forest']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'System' ? /dark|light/ : theme.toLowerCase());
    const background = await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
  }
  for (const route of ['/dashboard', '/ideas', '/inbox', '/now', '/tags', '/trash', '/agents', '/settings', '/blog']) {
    await page.goto(route);
    await expect(page.locator('h1').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), `desktop overflow on ${route}`).toBe(false);
    await page.screenshot({ path: test.info().outputPath(`desktop-${route.slice(1)}.png`), fullPage: true });
  }
});

test('capture to inbox to planned work keeps its source idea', async ({ page }) => {
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Capture idea' }).click();
  await page.getByRole('textbox', { name: 'Idea title' }).fill('Traceable build idea');
  await page.getByRole('button', { name: 'Save to Inbox' }).click();
  const card = page.getByRole('region', { name: 'Traceable build idea' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Plan code task' }).click();
  await expect(page.getByRole('heading', { name: /Traceable build idea.*Work/ })).toBeVisible();
  await expect(page.getByText('Build: Traceable build idea')).toBeVisible();
  await page.goto('/now');
  await expect(page.getByRole('heading', { name: 'Traceable build idea' })).toBeVisible();
});

test('idea editor autosaves the latest typed value before closing', async ({ page }) => {
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Capture idea' }).click();
  await page.getByRole('textbox', { name: 'Idea title' }).fill('Original title');
  await page.getByRole('button', { name: 'Save to Inbox' }).click();
  await page.getByRole('region', { name: 'Original title' }).getByRole('button', { name: 'Evaluate' }).click();
  await page.getByRole('dialog', { name: /Idea: Original title/ }).getByRole('textbox', { name: 'Idea title' }).fill('Latest typed title');
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('iv_ideas') || '[]') as { title: string }[]).some((idea) => idea.title === 'Latest typed title'))).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Latest typed title' })).toBeVisible();
});

test('a long published blog post remains scrollable on mobile', async ({ page }) => {
  await page.route('**/api/blog/public/posts/a-long-read**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().url().endsWith('/related') ? [] : { id: 'post-1', slug: 'a-long-read', title: 'A long read', summary: 'A scrolling test.', tags: [], coverImage: '', body: Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}. This is a longer note about building and learning.`).join('\n\n'), publishedAt: new Date().toISOString() }) }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/blog/a-long-read');
  await expect(page.getByRole('heading', { name: 'A long read' })).toBeVisible();
  await page.getByRole('heading', { name: 'Follow new posts' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'Follow new posts' })).toBeInViewport();
});
