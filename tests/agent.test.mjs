import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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

test('local agent grooms an idea in an isolated worktree and records tasks', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'idea-vault-agent-test-'));
  const repoPath = path.join(dir, 'repo');
  const dbPath = path.join(dir, 'test.db');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const git = (...args) => execFileSync('git', args, { cwd: repoPath, stdio: 'ignore' });
  let child;
  let workspace;
  try {
    await writeFile(path.join(dir, 'placeholder'), '');
    execFileSync('git', ['init', repoPath], { stdio: 'ignore' });
    git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    await writeFile(path.join(repoPath, 'README.md'), '# Test');
    git('add', '.'); git('commit', '-m', 'initial');
    child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), IDEA_VAULT_DB_PATH: dbPath, ALLOWED_AGENT_EXECUTABLES: process.execPath }, stdio: 'ignore' });
    let ready = false;
    for (let i = 0; i < 150; i++) { try { if ((await fetch(`${base}/api/owner/session`)).ok) { ready = true; break; } } catch { await new Promise((resolve) => setTimeout(resolve, 100)); } }
    assert.ok(ready);
    const post = async (url, value) => {
      const response = await fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      if (!response.ok) assert.fail(`${url} returned ${response.status}: ${await response.text()}`);
      return response.json();
    };
    const repo = await post('/api/agents/repositories', { owner: 'sample', name: 'repo', localPath: repoPath });
    const agent = await post('/api/agents/configs', { name: 'Fake groomer', adapter: 'custom', mode: 'local', executable: process.execPath, argsTemplate: ['-e', 'console.log("## Goal\\nTest\\n## Acceptance criteria\\nWorks\\n## Tasks\\n1. Write a unit test\\n2. Ship the fix")', '{prompt}'], allowedRepoIds: [repo.id] });
    const seed = await fetch(`${base}/api/records/ideas/idea-agent`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 0, value: { id: 'idea-agent', title: 'Test agent' } }) });
    assert.equal(seed.status, 200);
    const run = await post('/api/agents/runs', { ideaId: 'idea-agent', agentId: agent.id, repoId: repo.id, action: 'groom', instructions: 'Create two tasks' });
    let finished;
    for (let i = 0; i < 100; i++) {
      const response = await fetch(`${base}/api/agents/runs/${run.id}`);
      finished = await response.json();
      if (['completed', 'failed'].includes(finished.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(finished.status, 'completed', finished.error || finished.logs);
    workspace = finished.workspace;
    assert.notEqual(path.resolve(workspace), path.resolve(repoPath));
    const work = await (await fetch(`${base}/api/work/ideas/idea-agent`)).json();
    assert.equal(work.artifacts[0].kind, 'brief');
    assert.deepEqual(work.tasks.map((item) => item.title).sort(), ['Ship the fix', 'Write a unit test']);
  } finally {
    if (child) { child.kill(); await new Promise((resolve) => child.once('exit', resolve)); }
    if (workspace) { try { git('worktree', 'remove', '-f', workspace); } catch { /* cleanup best effort */ } }
    await rm(dir, { recursive: true, force: true });
  }
});
