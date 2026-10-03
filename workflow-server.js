import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const json = (row) => row ? JSON.parse(row.value) : null;
const slugify = (value) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
const escapeXml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function registerWorkflow(app, db) {
  const subscriptionAttempts = new Map();
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_artifacts (id TEXT PRIMARY KEY, idea_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS work_tasks (id TEXT PRIMARY KEY, idea_id TEXT NOT NULL, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS blog_posts (id TEXT PRIMARY KEY, idea_id TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS blog_subscribers (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, status TEXT NOT NULL, token_hash TEXT, created_at TEXT NOT NULL, confirmed_at TEXT);
    CREATE TABLE IF NOT EXISTS blog_deliveries (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, subscriber_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT, UNIQUE(post_id, subscriber_id));
    CREATE TABLE IF NOT EXISTS blog_post_stats (id TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS agent_configs (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, idea_id TEXT NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS repository_links (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS github_checks (id TEXT PRIMARY KEY, idea_id TEXT NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deployments (id TEXT PRIMARY KEY, idea_id TEXT NOT NULL, value TEXT NOT NULL);
  `);
  const backupTables = ['ideas', 'tags', 'savedFilters', 'preferences', 'work_artifacts', 'work_tasks', 'blog_posts', 'blog_subscribers', 'blog_deliveries', 'blog_post_stats', 'agent_configs', 'agent_runs', 'repository_links', 'github_checks', 'deployments'];
  app.get('/api/backup', (_req, res) => {
    res.json({ format: 'idea-vault-full-backup', version: 1, exportedAt: now(), tables: Object.fromEntries(backupTables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])) });
  });
  function inspectBackup(data) {
    if (data?.format !== 'idea-vault-full-backup' || data.version !== 1 || typeof data.tables !== 'object') throw new Error('Invalid Idea Vault backup');
    return Object.fromEntries(backupTables.map((table) => {
      const rows = data.tables[table] || [];
      if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.id !== 'string')) throw new Error(`Invalid ${table} rows`);
      const present = db.prepare(`SELECT id FROM ${table}`).all();
      const presentIds = new Set(present.map((row) => row.id));
      return [table, { total: rows.length, conflicts: rows.filter((row) => presentIds.has(row.id)).length }];
    }));
  }
  app.post('/api/backup/preview', (req, res) => {
    try { res.json({ counts: inspectBackup(req.body) }); }
    catch (error) { res.status(400).json({ error: String(error) }); }
  });
  app.post('/api/backup/restore', async (req, res) => {
    try {
      const counts = inspectBackup(req.body);
      const backupPath = `${db.name}.pre-import-${Date.now()}.bak`;
      await db.backup(backupPath);
      const inserted = db.transaction(() => Object.fromEntries(backupTables.map((table) => {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
        const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
        let count = 0;
        for (const row of req.body.tables[table] || []) count += stmt.run(...columns.map((column) => row[column] ?? null)).changes;
        return [table, count];
      })))();
      res.json({ inserted, skipped: Object.fromEntries(backupTables.map((table) => [table, counts[table].total - inserted[table]])), preImportBackup: backupPath });
    } catch (error) { res.status(400).json({ error: String(error) }); }
  });
  app.post('/api/backup/wipe', async (req, res) => {
    if (req.body?.confirmation !== 'WIPE IDEA VAULT') return res.status(400).json({ error: 'Exact confirmation required' });
    try {
      const backupPath = `${db.name}.pre-wipe-${Date.now()}.bak`;
      await db.backup(backupPath);
      db.transaction(() => { for (const table of backupTables) db.prepare(`DELETE FROM ${table}`).run(); })();
      res.json({ wiped: true, backupPath });
    } catch (error) { res.status(500).json({ error: String(error) }); }
  });

  const list = (table, ideaId) => db.prepare(`SELECT value FROM ${table} WHERE idea_id = ? ORDER BY rowid DESC`).all(ideaId).map((row) => json(row));
  const ideaExists = (ideaId) => Boolean(db.prepare('SELECT 1 FROM ideas WHERE id = ?').get(ideaId));
  app.get('/api/work/overview', (_req, res) => {
    const checks = db.prepare('SELECT value FROM github_checks ORDER BY rowid DESC LIMIT 100').all().map(json);
    const posts = db.prepare('SELECT value FROM blog_posts ORDER BY rowid DESC LIMIT 100').all().map(json);
    const tasks = db.prepare('SELECT value FROM work_tasks ORDER BY rowid DESC LIMIT 100').all().map(json);
    res.json({ failedChecks: checks.filter((check) => check.conclusion === 'failure').slice(0, 5), recentPosts: posts.filter((post) => post.status === 'published').slice(0, 5), blockedTasks: tasks.filter((task) => task.status === 'blocked').slice(0, 5) });
  });
  app.get('/api/work/now', (_req, res) => {
    const ideas = db.prepare('SELECT value FROM ideas').all().map(json).filter((idea) => !idea.deletedAt && ['planned', 'building'].includes(idea.status));
    res.json(ideas.map((idea) => ({ idea, tasks: list('work_tasks', idea.id), latestRun: list('agent_runs', idea.id)[0] || null, checks: list('github_checks', idea.id), pullRequests: list('work_artifacts', idea.id).filter((artifact) => artifact.kind === 'pull_request') })));
  });
  const postById = db.prepare('SELECT value FROM blog_posts WHERE id = ?');
  const getPost = (postId) => json(postById.get(postId));

  app.get('/api/work/ideas/:ideaId', (req, res) => {
    const posts = list('blog_posts', req.params.ideaId);
    res.json({ artifacts: list('work_artifacts', req.params.ideaId), tasks: list('work_tasks', req.params.ideaId), posts, runs: list('agent_runs', req.params.ideaId), checks: list('github_checks', req.params.ideaId), deployments: list('deployments', req.params.ideaId), readership: { confirmedSubscribers: db.prepare("SELECT COUNT(*) AS count FROM blog_subscribers WHERE status = 'confirmed'").get().count, posts: Object.fromEntries(posts.map((post) => [post.id, db.prepare('SELECT views FROM blog_post_stats WHERE id = ?').get(post.id)?.views || 0])) } });
  });

  app.post('/api/work/artifacts', (req, res) => {
    const { ideaId, kind, title, body } = req.body ?? {};
    if (!ideaId || !['note', 'source', 'decision', 'architecture', 'brief', 'pull_request'].includes(kind) || !String(title ?? '').trim()) return res.status(400).json({ error: 'Invalid artifact' });
    if (!ideaExists(ideaId)) return res.status(404).json({ error: 'Source idea not found' });
    const value = { id: id(), ideaId, kind, title: String(title).trim(), body: String(body ?? ''), createdAt: now(), updatedAt: now(), version: 1 };
    db.prepare('INSERT INTO work_artifacts (id, idea_id, kind, value) VALUES (?, ?, ?, ?)').run(value.id, ideaId, kind, JSON.stringify(value));
    res.status(201).json(value);
  });
  app.patch('/api/work/artifacts/:id', (req, res) => {
    const row = db.prepare('SELECT value, version FROM work_artifacts WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Artifact not found' });
    if (req.body?.version !== row.version) return res.status(409).json({ error: 'Artifact changed elsewhere', current: json(row) });
    const value = { ...json(row), title: String(req.body.title ?? json(row).title).trim(), body: String(req.body.body ?? json(row).body), updatedAt: now(), version: row.version + 1 };
    db.prepare('UPDATE work_artifacts SET value = ?, version = ? WHERE id = ?').run(JSON.stringify(value), value.version, value.id);
    res.json(value);
  });

  app.post('/api/work/tasks', (req, res) => {
    const { ideaId, title } = req.body ?? {};
    if (!ideaId || !String(title ?? '').trim()) return res.status(400).json({ error: 'Idea and task title required' });
    if (!ideaExists(ideaId)) return res.status(404).json({ error: 'Source idea not found' });
    const value = { id: id(), ideaId, title: String(title).trim(), status: 'todo', createdAt: now(), updatedAt: now(), version: 1 };
    db.prepare('INSERT INTO work_tasks (id, idea_id, value) VALUES (?, ?, ?)').run(value.id, ideaId, JSON.stringify(value));
    res.status(201).json(value);
  });

  app.post('/api/work/inbox-convert', (req, res) => {
    const { ideaId, type } = req.body ?? {};
    if (!ideaExists(ideaId)) return res.status(404).json({ error: 'Source idea not found' });
    if (!['task', 'blog'].includes(type)) return res.status(400).json({ error: 'Invalid conversion type' });
    const table = type === 'task' ? 'work_tasks' : 'blog_posts';
    const existing = db.prepare(`SELECT value FROM ${table} WHERE idea_id = ?`).all(ideaId).map(json).find((item) => item.origin === 'inbox');
    if (existing) return res.json({ item: existing, created: false });
    const idea = json(db.prepare('SELECT value FROM ideas WHERE id = ?').get(ideaId));
    const itemId = id();
    const title = String(idea.title || 'Untitled idea').trim();
    const common = { id: itemId, ideaId, origin: 'inbox', createdAt: now(), updatedAt: now(), version: 1 };
    if (type === 'task') {
      const item = { ...common, title: `Build: ${title}`, status: 'todo' };
      db.prepare('INSERT INTO work_tasks (id, idea_id, value) VALUES (?, ?, ?)').run(itemId, ideaId, JSON.stringify(item));
      return res.status(201).json({ item, created: true });
    }
    const item = { ...common, title, slug: `${slugify(title) || 'post'}-${itemId.slice(0, 8)}`, summary: '', outline: '', body: '', coverImage: '', tags: [], canonicalUrl: '', status: 'draft', revisions: [] };
    db.prepare('INSERT INTO blog_posts (id, idea_id, slug, value) VALUES (?, ?, ?, ?)').run(itemId, ideaId, item.slug, JSON.stringify(item));
    return res.status(201).json({ item, created: true });
  });

  app.patch('/api/work/tasks/:id', (req, res) => {
    const row = db.prepare('SELECT value, version FROM work_tasks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found' });
    if (req.body?.version !== row.version) return res.status(409).json({ error: 'Task changed elsewhere', current: json(row) });
    if (!['todo', 'doing', 'done', 'blocked'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
    const value = { ...json(row), status: req.body.status, updatedAt: now(), version: row.version + 1 };
    db.prepare('UPDATE work_tasks SET value = ?, version = ? WHERE id = ?').run(JSON.stringify(value), value.version, value.id);
    res.json(value);
  });

  app.post('/api/blog/posts', (req, res) => {
    const { ideaId, title } = req.body ?? {};
    if (!ideaId || !String(title ?? '').trim()) return res.status(400).json({ error: 'Idea and title required' });
    if (!ideaExists(ideaId)) return res.status(404).json({ error: 'Source idea not found' });
    const postId = id();
    const slug = `${slugify(String(title)) || 'post'}-${postId.slice(0, 8)}`;
    const value = { id: postId, ideaId, title: String(title).trim(), slug, summary: '', outline: '', body: '', coverImage: '', tags: [], canonicalUrl: '', status: 'draft', createdAt: now(), updatedAt: now(), version: 1, revisions: [] };
    db.prepare('INSERT INTO blog_posts (id, idea_id, slug, value) VALUES (?, ?, ?, ?)').run(postId, ideaId, slug, JSON.stringify(value));
    res.status(201).json(value);
  });

  app.patch('/api/blog/posts/:id', (req, res) => {
    const post = getPost(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (req.body?.version !== post.version) return res.status(409).json({ error: 'Post changed elsewhere', current: post });
    const allowed = ['title', 'summary', 'outline', 'body', 'coverImage', 'tags', 'canonicalUrl', 'status', 'publishAt'];
    const patch = Object.fromEntries(allowed.filter((key) => Object.hasOwn(req.body, key)).map((key) => [key, req.body[key]]));
    if (patch.status && !['draft', 'review', 'ready', ...(post.status === 'published' ? ['published'] : [])].includes(patch.status)) return res.status(400).json({ error: 'Invalid editorial status' });
    const value = { ...post, ...patch, version: post.version + 1, updatedAt: now(), revisions: [...post.revisions.slice(-19), { body: post.body, title: post.title, savedAt: post.updatedAt }] };
    db.prepare('UPDATE blog_posts SET value = ?, version = ? WHERE id = ?').run(JSON.stringify(value), value.version, value.id);
    res.json(value);
  });

  async function sendMail(to, subject, html) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) throw new Error('SMTP is not configured');
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_PORT === '465', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
    await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
  }

  async function notifySubscribers(post) {
    const subscribers = db.prepare("SELECT id, email FROM blog_subscribers WHERE status = 'confirmed'").all();
    for (const subscriber of subscribers) {
      const deliveryId = id();
      const inserted = db.prepare('INSERT OR IGNORE INTO blog_deliveries (id, post_id, subscriber_id, status) VALUES (?, ?, ?, ?)').run(deliveryId, post.id, subscriber.id, 'pending');
      if (!inserted.changes) continue;
      try {
        const unsubscribe = `${process.env.PUBLIC_URL || 'http://localhost:3001'}/api/blog/unsubscribe/${subscriber.id}`;
        await sendMail(subscriber.email, post.title, `<p>${escapeXml(post.summary)}</p><p><a href="${process.env.PUBLIC_URL || 'http://localhost:3001'}/blog/${post.slug}">Read post</a></p><p><a href="${unsubscribe}">Unsubscribe</a></p>`);
        db.prepare("UPDATE blog_deliveries SET status = 'sent', error = NULL WHERE post_id = ? AND subscriber_id = ?").run(post.id, subscriber.id);
      } catch (error) {
        db.prepare("UPDATE blog_deliveries SET status = 'failed', error = ? WHERE post_id = ? AND subscriber_id = ?").run(String(error), post.id, subscriber.id);
      }
    }
  }

  app.post('/api/blog/posts/:id/schedule', async (req, res) => {
    const post = getPost(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status === 'published') return res.status(409).json({ error: 'Post is already published' });
    if (req.body?.version !== post.version) return res.status(409).json({ error: 'Post changed elsewhere', current: post });
    const publishAt = new Date(req.body.publishAt);
    if (!post.title.trim() || !post.body.trim() || !Number.isFinite(publishAt.getTime()) || publishAt <= new Date()) return res.status(400).json({ error: 'A complete post and future publication date are required' });
    if (!process.env.SMTP_HOST) return res.status(503).json({ error: 'Configure SMTP before scheduling' });
    const value = { ...post, status: 'scheduled', publishAt: publishAt.toISOString(), approvedAt: now(), updatedAt: now(), version: post.version + 1 };
    db.prepare('UPDATE blog_posts SET value = ?, version = ? WHERE id = ?').run(JSON.stringify(value), value.version, value.id);
    res.json(value);
  });
  app.post('/api/blog/posts/:id/cancel-schedule', (req, res) => {
    const post = getPost(req.params.id);
    if (!post || post.status !== 'scheduled') return res.status(404).json({ error: 'Scheduled post not found' });
    if (req.body?.version !== post.version) return res.status(409).json({ error: 'Post changed elsewhere', current: post });
    const value = { ...post, status: 'draft', publishAt: null, approvedAt: null, updatedAt: now(), version: post.version + 1 };
    db.prepare('UPDATE blog_posts SET value = ?, version = ? WHERE id = ?').run(JSON.stringify(value), value.version, value.id);
    res.json(value);
  });
  let publishingScheduled = false;
  const scheduledTimer = setInterval(async () => {
    if (publishingScheduled) return;
    publishingScheduled = true;
    try {
      const due = db.prepare('SELECT value FROM blog_posts').all().map(json).filter((post) => post.status === 'scheduled' && post.approvedAt && post.publishAt <= now());
      for (const post of due) {
        const value = { ...post, status: 'published', publishedAt: now(), updatedAt: now(), version: post.version + 1 };
        db.prepare('UPDATE blog_posts SET value = ?, version = ? WHERE id = ?').run(JSON.stringify(value), value.version, value.id);
        await notifySubscribers(value);
      }
    } finally { publishingScheduled = false; }
  }, 30000);
  scheduledTimer.unref();

  app.post('/api/blog/posts/:id/publish', async (req, res) => {
    const post = getPost(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status === 'published') return res.status(409).json({ error: 'Post is already published' });
    if (req.body?.version !== post.version) return res.status(409).json({ error: 'Post changed elsewhere', current: post });
    if (!post.title.trim() || !post.body.trim()) return res.status(400).json({ error: 'A title and body are required' });
    if (!process.env.SMTP_HOST) return res.status(503).json({ error: 'Configure SMTP before publishing with subscriber notifications' });
    const value = { ...post, status: 'published', publishedAt: now(), updatedAt: now(), version: post.version + 1 };
    db.prepare('UPDATE blog_posts SET value = ?, version = ? WHERE id = ?').run(JSON.stringify(value), value.version, value.id);
    res.json(value);
    await notifySubscribers(value);
  });

  app.get('/api/blog/public/posts', (req, res) => {
    const tag = String(req.query.tag || '').toLowerCase();
    const posts = db.prepare('SELECT value FROM blog_posts').all().map(json).filter((post) => post.status === 'published' && (!tag || (post.tags || []).some((item) => item.toLowerCase() === tag))).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    res.json(posts.map(({ id, title, slug, summary, tags, coverImage, publishedAt }) => ({ id, title, slug, summary, tags, coverImage, publishedAt })));
  });
  app.get('/api/blog/public/posts/:slug/related', (req, res) => {
    const post = json(db.prepare('SELECT value FROM blog_posts WHERE slug = ?').get(req.params.slug));
    if (!post || post.status !== 'published') return res.status(404).json({ error: 'Post not found' });
    const posts = db.prepare('SELECT value FROM blog_posts').all().map(json).filter((item) => item.status === 'published' && item.id !== post.id);
    posts.sort((a, b) => (b.tags || []).filter((tag) => post.tags?.includes(tag)).length - (a.tags || []).filter((tag) => post.tags?.includes(tag)).length || b.publishedAt.localeCompare(a.publishedAt));
    res.json(posts.slice(0, 3).map(({ id, title, slug, summary, tags, coverImage, publishedAt }) => ({ id, title, slug, summary, tags, coverImage, publishedAt })));
  });
  app.get('/api/blog/public/posts/:slug', (req, res) => {
    const post = json(db.prepare('SELECT value FROM blog_posts WHERE slug = ?').get(req.params.slug));
    if (!post || post.status !== 'published') return res.status(404).json({ error: 'Post not found' });
    db.prepare('INSERT OR IGNORE INTO blog_post_stats (id, views) VALUES (?, 0)').run(post.id);
    db.prepare('UPDATE blog_post_stats SET views = views + 1 WHERE id = ?').run(post.id);
    const { id, title, slug, summary, body, coverImage, tags, canonicalUrl, publishedAt } = post;
    res.json({ id, title, slug, summary, body, coverImage, tags, canonicalUrl, publishedAt });
  });
  app.get('/api/blog/rss.xml', (req, res) => {
    const base = process.env.PUBLIC_URL || 'http://localhost:3001';
    const posts = db.prepare('SELECT value FROM blog_posts').all().map(json).filter((post) => post.status === 'published').sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    res.type('application/rss+xml').send(`<?xml version="1.0"?><rss version="2.0"><channel><title>Idea Vault Blog</title><link>${escapeXml(base)}/blog</link><description>Ideas made real</description>${posts.map((post) => `<item><title>${escapeXml(post.title)}</title><link>${escapeXml(base)}/blog/${escapeXml(post.slug)}</link><guid>${post.id}</guid><description>${escapeXml(post.summary)}</description><pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`);
  });
  app.get('/api/blog/sitemap.xml', (req, res) => {
    const base = process.env.PUBLIC_URL || 'http://localhost:3001';
    const posts = db.prepare('SELECT value FROM blog_posts').all().map(json).filter((post) => post.status === 'published');
    res.type('application/xml').send(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeXml(base)}/blog</loc></url>${posts.map((post) => `<url><loc>${escapeXml(base)}/blog/${escapeXml(post.slug)}</loc></url>`).join('')}</urlset>`);
  });

  app.post('/api/blog/subscribe', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
    if (!process.env.SMTP_HOST) return res.status(503).json({ error: 'Subscriptions are not configured' });
    const attemptKey = `${req.ip}:${email}`;
    const lastAttempt = subscriptionAttempts.get(attemptKey) || 0;
    if (Date.now() - lastAttempt < 60000) return res.status(429).json({ error: 'Please wait before requesting another email' });
    subscriptionAttempts.set(attemptKey, Date.now());
    const existing = db.prepare('SELECT status FROM blog_subscribers WHERE email = ?').get(email);
    if (existing?.status === 'confirmed') return res.json({ message: 'If needed, check your email for subscription details.' });
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const subscriberId = id();
    db.prepare("INSERT INTO blog_subscribers (id, email, status, token_hash, created_at) VALUES (?, ?, 'pending', ?, ?) ON CONFLICT(email) DO UPDATE SET status = 'pending', token_hash = excluded.token_hash").run(subscriberId, email, tokenHash, now());
    const link = `${process.env.PUBLIC_URL || 'http://localhost:3001'}/api/blog/confirm/${token}`;
    await sendMail(email, 'Confirm your Idea Vault subscription', `<p>Confirm your subscription: <a href="${link}">${link}</a></p>`);
    res.json({ message: 'Check your email to confirm.' });
  });
  app.get('/api/blog/confirm/:token', (req, res) => {
    const hash = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const result = db.prepare("UPDATE blog_subscribers SET status = 'confirmed', confirmed_at = ?, token_hash = NULL WHERE token_hash = ?").run(now(), hash);
    res.status(result.changes ? 200 : 404).send(result.changes ? 'Subscription confirmed.' : 'Invalid confirmation link.');
  });
  app.get('/api/blog/unsubscribe/:id', (req, res) => {
    db.prepare("UPDATE blog_subscribers SET status = 'unsubscribed' WHERE id = ?").run(req.params.id);
    res.send('Unsubscribed.');
  });
  app.post('/api/blog/deliveries/:id/retry', async (req, res) => {
    const row = db.prepare('SELECT post_id, subscriber_id, status FROM blog_deliveries WHERE id = ?').get(req.params.id);
    if (!row || row.status !== 'failed') return res.status(404).json({ error: 'Failed delivery not found' });
    const post = getPost(row.post_id);
    const subscriber = db.prepare("SELECT email FROM blog_subscribers WHERE id = ? AND status = 'confirmed'").get(row.subscriber_id);
    if (!post || !subscriber) return res.status(404).json({ error: 'Post or subscriber not found' });
    try {
      await sendMail(subscriber.email, post.title, `<p>${escapeXml(post.summary)}</p><p><a href="${process.env.PUBLIC_URL || 'http://localhost:3001'}/blog/${post.slug}">Read post</a></p>`);
      db.prepare("UPDATE blog_deliveries SET status = 'sent', error = NULL WHERE id = ?").run(req.params.id);
      res.json({ status: 'sent' });
    } catch (error) { res.status(502).json({ error: String(error) }); }
  });
  app.get('/api/blog/deliveries', (_req, res) => {
    res.json(db.prepare('SELECT id, post_id AS postId, status, error FROM blog_deliveries ORDER BY rowid DESC LIMIT 200').all());
  });
}
