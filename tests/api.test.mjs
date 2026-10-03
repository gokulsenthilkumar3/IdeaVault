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

test('tasks and posts keep the source idea and reject stale edits', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'idea-vault-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), IDEA_VAULT_DB_PATH: path.join(dir, 'test.db') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let startupOutput = '';
  child.stdout.on('data', (chunk) => startupOutput += chunk.toString());
  child.stderr.on('data', (chunk) => startupOutput += chunk.toString());
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(`${base}/api/owner/session`)).ok) { ready = true; break; } }
      catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, `Server did not start: ${startupOutput}`);
    for (const value of [undefined, 'invalid', [], { id: 'different', title: 'Wrong ID' }, { id: 'invalid-record', title: 12 }]) {
      const invalid = await fetch(`${base}/api/records/ideas/invalid-record`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 0, value }) });
      assert.equal(invalid.status, 400);
      assert.equal(typeof (await invalid.json()).error, 'string');
    }
    const malformed = await fetch(`${base}/api/records/ideas/invalid-record`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, 'Invalid JSON request');
    const missing = await fetch(`${base}/api/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, 'API route not found');
    const seed = await fetch(`${base}/api/records/ideas/idea-1`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 0, value: { id: 'idea-1', title: 'Original' } }) });
    assert.equal(seed.status, 200);
    const taskResponse = await fetch(`${base}/api/work/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ideaId: 'idea-1', title: 'Write test' }) });
    assert.equal(taskResponse.status, 201);
    const task = await taskResponse.json();
    assert.equal(task.ideaId, 'idea-1');
    const converted = await fetch(`${base}/api/work/inbox-convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ideaId: 'idea-1', type: 'task' }) });
    assert.equal(converted.status, 201);
    const convertedAgain = await fetch(`${base}/api/work/inbox-convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ideaId: 'idea-1', type: 'task' }) });
    assert.equal(convertedAgain.status, 200);
    assert.equal((await convertedAgain.json()).item.id, (await converted.json()).item.id);
    const staleResponse = await fetch(`${base}/api/work/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done', version: 0 }) });
    assert.equal(staleResponse.status, 409);
    const postResponse = await fetch(`${base}/api/blog/posts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ideaId: 'idea-1', title: 'From an idea' }) });
    assert.equal(postResponse.status, 201);
    const post = await postResponse.json();
    const publicResponse = await fetch(`${base}/api/blog/public/posts/${post.slug}`);
    assert.equal(publicResponse.status, 404);
    const publicTag = await fetch(`${base}/api/blog/public/posts?tag=private`);
    assert.deepEqual(await publicTag.json(), []);
    const publishWithoutBody = await fetch(`${base}/api/blog/posts/${post.id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: post.version }) });
    assert.equal(publishWithoutBody.status, 400);
    const work = await (await fetch(`${base}/api/work/ideas/idea-1`)).json();
    assert.equal(work.tasks.length, 2);
    assert.equal(work.posts[0].ideaId, 'idea-1');
    const staleWrite = await fetch(`${base}/api/records/ideas/idea-1`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 0, value: { id: 'idea-1', title: 'Lost update' } }) });
    assert.equal(staleWrite.status, 409);
    const data = await (await fetch(`${base}/api/data`)).json();
    assert.equal(data.ideas[0].title, 'Original');
    assert.equal(data.versions.ideas['idea-1'], 1);
    const backup = await (await fetch(`${base}/api/backup`)).json();
    assert.equal(backup.format, 'idea-vault-full-backup');
    const preview = await (await fetch(`${base}/api/backup/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) })).json();
    assert.equal(preview.counts.ideas.conflicts, 1);
    const repoResponse = await fetch(`${base}/api/agents/repositories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: 'sample', name: 'repo', workflowId: 'deploy.yml', ref: 'main' }) });
    assert.equal(repoResponse.status, 201);
    const repo = await repoResponse.json();
    const staleRepo = await fetch(`${base}/api/agents/repositories/${repo.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 0, ref: 'next' }) });
    assert.equal(staleRepo.status, 409);
    const disabledRepo = await fetch(`${base}/api/agents/repositories/${repo.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, enabled: false }) });
    assert.equal(disabledRepo.status, 200);
    assert.equal((await disabledRepo.json()).enabled, false);
    const repoPreflight = await fetch(`${base}/api/agents/repositories/${repo.id}/preflight`);
    assert.equal(repoPreflight.status, 200);
    assert.ok(Array.isArray((await repoPreflight.json()).checks));
    const agentResponse = await fetch(`${base}/api/agents/configs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Codex', adapter: 'codex', mode: 'hosted', executable: 'codex', allowedRepoIds: [repo.id], mcpTools: [] }) });
    assert.equal(agentResponse.status, 201);
    const agent = await agentResponse.json();
    assert.equal((await fetch(`${base}/api/agents/configs/${agent.id}/preflight`)).status, 200);
    const staleAgent = await fetch(`${base}/api/agents/configs/${agent.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 0, enabled: false }) });
    assert.equal(staleAgent.status, 409);
    const disabledAgent = await fetch(`${base}/api/agents/configs/${agent.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, enabled: false }) });
    assert.equal(disabledAgent.status, 200);
    const refusedRun = await fetch(`${base}/api/agents/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ideaId: 'idea-1', agentId: agent.id, repoId: repo.id, action: 'groom' }) });
    assert.equal(refusedRun.status, 400);
    const deployResponse = await fetch(`${base}/api/agents/deployments/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ideaId: 'idea-1', repoId: repo.id, ref: 'main' }) });
    assert.equal(deployResponse.status, 409);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('hosted private API requires owner login while public blog remains readable', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'idea-vault-auth-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), IDEA_VAULT_DB_PATH: path.join(dir, 'test.db'), OWNER_TOKEN: 'test-secret' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(`${base}/api/owner/session`)).ok) { ready = true; break; } } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.ok(ready);
    assert.equal((await fetch(`${base}/api/data`)).status, 401);
    assert.equal((await fetch(`${base}/api/blog/public/posts`)).status, 200);
    const login = await fetch(`${base}/api/owner/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'test-secret' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    assert.equal((await fetch(`${base}/api/data`, { headers: { Cookie: cookie } })).status, 200);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
