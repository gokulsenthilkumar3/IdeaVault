import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('verified reader receives one notification for one published post', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'idea-vault-blog-test-'));
  const port = await freePort();
  const messages = [];
  const smtp = net.createServer((socket) => {
    socket.write('220 test SMTP\r\n');
    let buffer = '';
    let data = false;
    let message = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n');
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (data) {
          if (line === '.') { data = false; messages.push(message); message = ''; socket.write('250 accepted\r\n'); }
          else message += `${line}\n`;
        } else if (/^EHLO|^HELO/i.test(line)) socket.write('250-localhost\r\n250 8BITMIME\r\n');
        else if (/^DATA/i.test(line)) { data = true; socket.write('354 start mail\r\n'); }
        else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  const smtpPort = smtp.address().port;
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), IDEA_VAULT_DB_PATH: path.join(dir, 'test.db'), SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtpPort), SMTP_FROM: 'blog@example.test', PUBLIC_URL: base }, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) { try { if ((await fetch(`${base}/api/owner/session`)).ok) { ready = true; break; } } catch { await new Promise((resolve) => setTimeout(resolve, 100)); } }
    assert.ok(ready);
    const jsonPost = (url, value) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const seed = await fetch(`${base}/api/records/ideas/blog-idea`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 0, value: { id: 'blog-idea', title: 'Blog idea' } }) });
    assert.equal(seed.status, 200);
    const subscribe = await jsonPost('/api/blog/subscribe', { email: 'reader@example.test' });
    assert.equal(subscribe.status, 200);
    assert.equal(messages.length, 1);
    const token = messages[0].replace(/=\n/g, '').match(/\/api\/blog\/confirm\/[a-f0-9]{64}/)?.[0];
    assert.ok(token);
    assert.equal((await fetch(`${base}${token}`)).status, 200);
    const created = await jsonPost('/api/blog/posts', { ideaId: 'blog-idea', title: 'A published idea' });
    assert.equal(created.status, 201);
    const draft = await created.json();
    const saved = await fetch(`${base}/api/blog/posts/${draft.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: draft.version, body: '# Hello readers', summary: 'Test summary' }) });
    assert.equal(saved.status, 200);
    const updated = await saved.json();
    const published = await jsonPost(`/api/blog/posts/${draft.id}/publish`, { version: updated.version });
    assert.equal(published.status, 200);
    for (let i = 0; i < 30 && messages.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(messages.length, 2);
    const publicPostResponse = await fetch(`${base}/api/blog/public/posts/${draft.slug}`);
    assert.equal(publicPostResponse.status, 200);
    const publicPost = await publicPostResponse.json();
    assert.equal(publicPost.body, '# Hello readers');
    assert.equal(publicPost.ideaId, undefined);
    assert.equal(publicPost.revisions, undefined);
    const work = await (await fetch(`${base}/api/work/ideas/blog-idea`)).json();
    assert.equal(work.readership.confirmedSubscribers, 1);
    assert.equal(work.readership.posts[draft.id], 1);
    const deliveries = await (await fetch(`${base}/api/blog/deliveries`)).json();
    assert.equal(deliveries[0].status, 'sent');
    const duplicate = await jsonPost(`/api/blog/posts/${draft.id}/publish`, { version: updated.version });
    assert.equal(duplicate.status, 409);
    assert.equal(messages.length, 2);
    assert.match(await (await fetch(`${base}/api/blog/rss.xml`)).text(), /A published idea/);
    const scheduledDraft = await (await jsonPost('/api/blog/posts', { ideaId: 'blog-idea', title: 'Later idea' })).json();
    const scheduledSaved = await (await fetch(`${base}/api/blog/posts/${scheduledDraft.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: scheduledDraft.version, body: 'Later content' }) })).json();
    const schedule = await jsonPost(`/api/blog/posts/${scheduledDraft.id}/schedule`, { version: scheduledSaved.version, publishAt: new Date(Date.now() + 86400000).toISOString() });
    assert.equal(schedule.status, 200);
    const scheduledPost = await schedule.json();
    assert.equal((await fetch(`${base}/api/blog/public/posts/${scheduledDraft.slug}`)).status, 404);
    const cancel = await jsonPost(`/api/blog/posts/${scheduledDraft.id}/cancel-schedule`, { version: scheduledPost.version });
    assert.equal(cancel.status, 200);
    assert.equal((await cancel.json()).status, 'draft');
  } finally {
    child.kill(); await new Promise((resolve) => child.once('exit', resolve));
    await new Promise((resolve) => smtp.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
