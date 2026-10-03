import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { registerWorkflow } from './workflow-server.js';
import { registerAgents } from './agent-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: (origin, callback) => callback(null, !origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)), credentials: true }));
app.use(express.json({ limit: '50mb' }));

const sessions = new Set();
app.post('/api/owner/login', (req, res) => {
  if (!process.env.OWNER_TOKEN) return res.status(503).json({ error: 'Owner token is not configured' });
  const supplied = Buffer.from(String(req.body?.token ?? ''));
  const expected = Buffer.from(process.env.OWNER_TOKEN);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.status(401).json({ error: 'Invalid token' });
  const session = crypto.randomBytes(32).toString('hex');
  sessions.add(session);
  res.cookie('iv_session', session, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 86400000 });
  res.json({ ok: true });
});
app.get('/api/owner/session', (req, res) => {
  if (!process.env.OWNER_TOKEN) return res.json({ authenticated: true, mode: 'local' });
  const cookie = req.headers.cookie?.match(/(?:^|; )iv_session=([^;]+)/)?.[1];
  res.json({ authenticated: Boolean(cookie && sessions.has(cookie)), mode: 'hosted' });
});
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/blog/public/') || req.path === '/blog/rss.xml' || req.path === '/blog/sitemap.xml' || req.path === '/blog/subscribe' || req.path.startsWith('/blog/confirm/') || req.path.startsWith('/blog/unsubscribe/')) return next();
  if (!process.env.OWNER_TOKEN) {
    if (req.socket.remoteAddress === '::1' || req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::ffff:127.0.0.1') return next();
    return res.status(503).json({ error: 'Configure OWNER_TOKEN for remote access' });
  }
  const cookie = req.headers.cookie?.match(/(?:^|; )iv_session=([^;]+)/)?.[1];
  if (!cookie || !sessions.has(cookie)) return res.status(401).json({ error: 'Owner login required' });
  next();
});

// Initialize SQLite Database
const dbPath = process.env.IDEA_VAULT_DB_PATH || path.join(__dirname, 'database.db');
if (fs.existsSync(dbPath) && !fs.existsSync(`${dbPath}.pre-workflow.bak`)) fs.copyFileSync(dbPath, `${dbPath}.pre-workflow.bak`);
const db = new Database(dbPath);

// Create tables with id and value (JSON string)
db.exec(`
  CREATE TABLE IF NOT EXISTS ideas (id TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS savedFilters (id TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS preferences (id TEXT PRIMARY KEY, value TEXT);
`);
for (const table of ['ideas', 'tags', 'savedFilters', 'preferences']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((column) => column.name === 'version')) db.exec(`ALTER TABLE ${table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
}
registerWorkflow(app, db);
registerAgents(app, db);

// Migration from db.json if it exists
const oldDbPath = path.join(__dirname, 'db.json');
if (fs.existsSync(oldDbPath)) {
  try {
    const oldData = JSON.parse(fs.readFileSync(oldDbPath, 'utf-8'));
    console.log('Migrating db.json to SQLite database...');

    const insert = (table) => db.prepare(`INSERT OR REPLACE INTO ${table} (id, value) VALUES (?, ?)`);
    
    db.transaction(() => {
      // Migrate Ideas
      if (Array.isArray(oldData.ideas)) {
        const stmt = insert('ideas');
        for (const item of oldData.ideas) stmt.run(item.id, JSON.stringify(item));
      }
      // Migrate Tags
      if (Array.isArray(oldData.tags)) {
        const stmt = insert('tags');
        for (const item of oldData.tags) stmt.run(item.id, JSON.stringify(item));
      }
      // Migrate Saved Filters
      if (Array.isArray(oldData.savedFilters)) {
        const stmt = insert('savedFilters');
        for (const item of oldData.savedFilters) stmt.run(item.id, JSON.stringify(item));
      }
      // Migrate Preferences
      if (oldData.preferences) {
        insert('preferences').run('prefs', JSON.stringify(oldData.preferences));
      }
    })();

    // Rename old db.json so we don't migrate again
    fs.renameSync(oldDbPath, oldDbPath + '.migrated');
    console.log('Migration complete. db.json renamed to db.json.migrated');
  } catch (err) {
    console.error('Error during migration:', err);
  }
}

// ─── API Endpoints ────────────────────────────────────────────────────────────

app.get('/api/data', (req, res) => {
  // Read all tables and construct the full state object
  const ideas = db.prepare('SELECT value FROM ideas').all().map(r => JSON.parse(r.value));
  const tags = db.prepare('SELECT value FROM tags').all().map(r => JSON.parse(r.value));
  const savedFilters = db.prepare('SELECT value FROM savedFilters').all().map(r => JSON.parse(r.value));
  const prefsRow = db.prepare('SELECT value FROM preferences WHERE id = ?').get('prefs');
  
  res.json({
    ideas,
    tags,
    savedFilters,
    preferences: prefsRow ? JSON.parse(prefsRow.value) : {},
    versions: Object.fromEntries(['ideas', 'tags', 'savedFilters', 'preferences'].map((table) => [table, Object.fromEntries(db.prepare(`SELECT id, version FROM ${table}`).all().map((row) => [row.id, row.version]))]))
  });
});

app.put('/api/records/:key/:id', (req, res) => {
  const { key, id } = req.params;
  if (!['ideas', 'tags', 'savedFilters', 'preferences'].includes(key)) return res.status(400).json({ error: 'Invalid collection' });
  if (!Number.isInteger(req.body?.expectedVersion) || req.body.expectedVersion < 0) return res.status(400).json({ error: 'Expected version required' });
  const current = db.prepare(`SELECT value, version FROM ${key} WHERE id = ?`).get(id);
  const currentVersion = current?.version ?? 0;
  if (currentVersion !== req.body.expectedVersion) return res.status(409).json({ error: 'Record changed elsewhere', current: current ? JSON.parse(current.value) : null, version: currentVersion });
  const nextVersion = currentVersion + 1;
  if (req.body.value === null) db.prepare(`DELETE FROM ${key} WHERE id = ?`).run(id);
  else if (current) db.prepare(`UPDATE ${key} SET value = ?, version = ? WHERE id = ?`).run(JSON.stringify(req.body.value), nextVersion, id);
  else db.prepare(`INSERT INTO ${key} (id, value, version) VALUES (?, ?, ?)`).run(id, JSON.stringify(req.body.value), nextVersion);
  res.json({ version: req.body.value === null ? 0 : nextVersion });
});

app.post('/api/data/:key', (req, res) => {
  res.status(410).json({ error: 'Bulk replacement is disabled; use versioned record writes' });
});

const PORT = Number(process.env.PORT || 3001);
if (fs.existsSync(path.join(__dirname, 'dist'))) {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('/blog/:slug', async (req, res, next) => {
    const row = db.prepare('SELECT value FROM blog_posts WHERE slug = ?').get(req.params.slug);
    const post = row ? JSON.parse(row.value) : null;
    if (!post || post.status !== 'published') return next();
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    try {
      const template = await fs.promises.readFile(path.join(__dirname, 'dist', 'index.html'), 'utf8');
      const html = template.replace('</head>', `<meta name="description" content="${esc(post.summary)}"><meta property="og:title" content="${esc(post.title)}"><meta property="og:description" content="${esc(post.summary)}"><meta property="og:type" content="article"><meta property="og:url" content="${esc(base)}/blog/${esc(post.slug)}"></head>`);
      res.type('html').send(html);
    } catch {
      next();
    }
  });
  app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
}
app.listen(PORT, process.env.OWNER_TOKEN ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`SQLite Database Server running on http://localhost:${PORT}`);
});
