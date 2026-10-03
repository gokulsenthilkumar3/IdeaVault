import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const running = new Map();
async function executableAvailable(command) {
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  const folders = path.isAbsolute(command) ? [''] : (process.env.PATH || '').split(path.delimiter);
  for (const folder of folders) for (const suffix of suffixes) {
    try { await access(path.join(folder, command + suffix)); return true; } catch { /* try next location */ }
  }
  return false;
}
const runCommand = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, shell: false, windowsHide: true, signal: AbortSignal.timeout(300000) });
  let output = '';
  child.stdout.on('data', (chunk) => output += chunk);
  child.stderr.on('data', (chunk) => output += chunk);
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(output.slice(-3000) || `${command} failed (${code})`)));
});

export function registerAgents(app, db) {
  const getRun = (runId) => JSON.parse(db.prepare('SELECT value FROM agent_runs WHERE id = ?').get(runId)?.value || 'null');
  const saveRun = (run) => db.prepare('UPDATE agent_runs SET value = ? WHERE id = ?').run(JSON.stringify(run), run.id);
  const getRepo = (repoId) => JSON.parse(db.prepare('SELECT value FROM repository_links WHERE id = ?').get(repoId)?.value || 'null');
  const getAgent = (agentId) => JSON.parse(db.prepare('SELECT value FROM agent_configs WHERE id = ?').get(agentId)?.value || 'null');
  const allowedExecutable = (command) => (process.env.ALLOWED_AGENT_EXECUTABLES || 'codex,claude').split(',').map((item) => item.trim()).includes(command);
  const validRepoIds = (ids) => Array.isArray(ids) && ids.every((repoId) => Boolean(getRepo(repoId)));

  app.get('/api/agents/configs', (_req, res) => res.json(db.prepare('SELECT value FROM agent_configs').all().map((row) => JSON.parse(row.value))));
  app.post('/api/agents/configs', (req, res) => {
    const { name, adapter, mode, executable, allowedRepoIds, mcpTools, argsTemplate } = req.body ?? {};
    if (!name || !['codex', 'claude', 'custom'].includes(adapter) || !['local', 'hosted'].includes(mode) || !Array.isArray(allowedRepoIds) || !allowedRepoIds.length) return res.status(400).json({ error: 'Agent and permitted repositories required' });
    if (adapter === 'custom' && (!Array.isArray(argsTemplate) || !argsTemplate.includes('{prompt}'))) return res.status(400).json({ error: 'Custom agent arguments must include {prompt}' });
    const command = String(executable || adapter);
    if (!allowedExecutable(command)) return res.status(403).json({ error: 'Executable is not allowed by server configuration' });
    if (!validRepoIds(allowedRepoIds)) return res.status(400).json({ error: 'Unknown permitted repository' });
    const value = { id: id(), name: String(name), adapter, mode, executable: command, argsTemplate: adapter === 'custom' ? argsTemplate.map(String) : [], allowedRepoIds, mcpTools: Array.isArray(mcpTools) ? mcpTools : [], enabled: true, version: 1, createdAt: now(), updatedAt: now() };
    db.prepare('INSERT INTO agent_configs (id, value) VALUES (?, ?)').run(value.id, JSON.stringify(value));
    res.status(201).json(value);
  });
  app.patch('/api/agents/configs/:id', (req, res) => {
    const previous = getAgent(req.params.id);
    if (!previous) return res.status(404).json({ error: 'Agent not found' });
    if (req.body?.version !== (previous.version || 1)) return res.status(409).json({ error: 'Agent changed elsewhere', current: previous });
    const value = { ...previous, ...Object.fromEntries(['name', 'adapter', 'mode', 'executable', 'argsTemplate', 'allowedRepoIds', 'mcpTools', 'enabled'].filter((key) => Object.hasOwn(req.body, key)).map((key) => [key, req.body[key]])), version: (previous.version || 1) + 1, updatedAt: now() };
    if (!String(value.name).trim() || !['codex', 'claude', 'custom'].includes(value.adapter) || !['local', 'hosted'].includes(value.mode) || !Array.isArray(value.allowedRepoIds) || !value.allowedRepoIds.length || !validRepoIds(value.allowedRepoIds) || !allowedExecutable(value.executable) || (value.adapter === 'custom' && (!Array.isArray(value.argsTemplate) || !value.argsTemplate.includes('{prompt}')))) return res.status(400).json({ error: 'Invalid agent configuration' });
    db.prepare('UPDATE agent_configs SET value = ? WHERE id = ?').run(JSON.stringify(value), value.id);
    res.json(value);
  });
  app.get('/api/agents/configs/:id/preflight', async (req, res) => {
    const agent = getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const checks = [{ name: 'Executable allowlist', ok: allowedExecutable(agent.executable) }];
    checks.push({ name: 'Executable available', ok: await executableAvailable(agent.executable) });
    checks.push({ name: 'Permitted repositories', ok: validRepoIds(agent.allowedRepoIds) && agent.allowedRepoIds.length > 0 });
    res.json({ checks, ready: checks.every((check) => check.ok), note: 'MCP tool declarations are informational; tool enforcement belongs to the agent runtime.' });
  });
  app.get('/api/agents/repositories', (_req, res) => res.json(db.prepare('SELECT value FROM repository_links').all().map((row) => JSON.parse(row.value))));
  app.post('/api/agents/repositories', (req, res) => {
    const { owner, name, localPath, workflowId, ref } = req.body ?? {};
    if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(name)) return res.status(400).json({ error: 'Valid GitHub owner and repository required' });
    const value = { id: id(), owner, name, localPath: String(localPath || ''), workflowId: String(workflowId || ''), ref: String(ref || 'main'), enabled: true, version: 1, createdAt: now(), updatedAt: now() };
    db.prepare('INSERT INTO repository_links (id, value) VALUES (?, ?)').run(value.id, JSON.stringify(value));
    res.status(201).json(value);
  });
  app.patch('/api/agents/repositories/:id', (req, res) => {
    const previous = getRepo(req.params.id);
    if (!previous) return res.status(404).json({ error: 'Repository not found' });
    if (req.body?.version !== (previous.version || 1)) return res.status(409).json({ error: 'Repository changed elsewhere', current: previous });
    const value = { ...previous, ...Object.fromEntries(['owner', 'name', 'localPath', 'workflowId', 'ref', 'enabled'].filter((key) => Object.hasOwn(req.body, key)).map((key) => [key, req.body[key]])), version: (previous.version || 1) + 1, updatedAt: now() };
    if (!/^[a-zA-Z0-9_.-]+$/.test(value.owner) || !/^[a-zA-Z0-9_.-]+$/.test(value.name) || !String(value.ref).trim()) return res.status(400).json({ error: 'Invalid repository configuration' });
    db.prepare('UPDATE repository_links SET value = ? WHERE id = ?').run(JSON.stringify(value), value.id);
    res.json(value);
  });
  app.get('/api/agents/repositories/:id/preflight', async (req, res) => {
    const repo = getRepo(req.params.id);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });
    const checks = [];
    if (repo.localPath) {
      try { await access(repo.localPath); await runCommand('git', ['-C', repo.localPath, 'rev-parse', '--is-inside-work-tree'], process.cwd()); checks.push({ name: 'Local Git checkout', ok: true }); }
      catch (error) { checks.push({ name: 'Local Git checkout', ok: false, detail: String(error).slice(0, 300) }); }
    }
    try { await runCommand('gh', ['api', `repos/${repo.owner}/${repo.name}`, '--jq', '.full_name'], process.cwd()); checks.push({ name: 'GitHub access', ok: true }); }
    catch (error) { checks.push({ name: 'GitHub access', ok: false, detail: String(error).slice(0, 300) }); }
    if (repo.workflowId) {
      try { await runCommand('gh', ['api', `repos/${repo.owner}/${repo.name}/actions/workflows/${encodeURIComponent(repo.workflowId)}`, '--jq', '.name'], process.cwd()); checks.push({ name: 'Deployment workflow visible', ok: true }); }
      catch (error) { checks.push({ name: 'Deployment workflow visible', ok: false, detail: String(error).slice(0, 300) }); }
    }
    res.json({ checks, ready: checks.every((check) => check.ok) });
  });
  app.get('/api/agents/runs', (_req, res) => res.json(db.prepare('SELECT value FROM agent_runs ORDER BY rowid DESC LIMIT 30').all().map((row) => JSON.parse(row.value))));
  app.post('/api/agents/runs', async (req, res) => {
    const { ideaId, agentId, repoId, action, instructions } = req.body ?? {};
    if (!ideaId || !['groom', 'architecture', 'implement', 'test', 'investigate', 'prepare_release'].includes(action)) return res.status(400).json({ error: 'Invalid run request' });
    if (!db.prepare('SELECT 1 FROM ideas WHERE id = ?').get(ideaId)) return res.status(404).json({ error: 'Source idea not found' });
    const agent = getAgent(agentId);
    const repo = getRepo(repoId);
    if (!agent || !repo || agent.enabled === false || repo.enabled === false || !agent.allowedRepoIds.includes(repoId)) return res.status(400).json({ error: 'Agent or repository unavailable' });
    if (agent.mode === 'local' && !repo.localPath) return res.status(400).json({ error: 'Local repository path required' });
    const run = { id: id(), ideaId, agentId, repoId, action, instructions: String(instructions || ''), status: 'queued', createdAt: now(), updatedAt: now(), logs: '', branch: '', workspace: '', error: '' };
    db.prepare('INSERT INTO agent_runs (id, idea_id, value) VALUES (?, ?, ?)').run(run.id, ideaId, JSON.stringify(run));
    res.status(202).json(run);
    void execute(run, agent, repo);
  });

  async function execute(run, agent, repo) {
    try {
      const workDir = await mkdtemp(path.join(os.tmpdir(), 'idea-vault-run-'));
      const checkout = path.join(workDir, 'repo');
      const branch = `idea-vault/${run.id.slice(0, 8)}`;
      if (agent.mode === 'local') {
        await runCommand('git', ['-C', repo.localPath, 'worktree', 'add', '-b', branch, checkout, 'HEAD']);
      } else {
        await runCommand('gh', ['repo', 'clone', `${repo.owner}/${repo.name}`, checkout], workDir);
        await runCommand('git', ['-C', checkout, 'checkout', '-b', branch]);
      }
      run = { ...run, status: 'running', workspace: checkout, branch, updatedAt: now() };
      saveRun(run);
      const idea = JSON.parse(db.prepare('SELECT value FROM ideas WHERE id = ?').get(run.ideaId)?.value || 'null');
      const artifacts = db.prepare('SELECT value FROM work_artifacts WHERE idea_id = ? ORDER BY rowid DESC LIMIT 8').all(run.ideaId).map((row) => JSON.parse(row.value));
      const tasks = db.prepare('SELECT value FROM work_tasks WHERE idea_id = ? ORDER BY rowid DESC LIMIT 20').all(run.ideaId).map((row) => JSON.parse(row.value));
      const failedChecks = db.prepare('SELECT value FROM github_checks WHERE idea_id = ? ORDER BY rowid DESC LIMIT 10').all(run.ideaId).map((row) => JSON.parse(row.value)).filter((check) => check.conclusion === 'failure');
      const context = JSON.stringify({ idea: idea && { title: idea.title, description: idea.description, status: idea.status, nextAction: idea.nextAction, evaluation: idea.evaluation }, artifacts: artifacts.map((item) => ({ kind: item.kind, title: item.title, body: item.body?.slice(0, 3000) })), tasks, failedChecks: failedChecks.map((check) => ({ name: check.name, summary: check.summary, failures: check.failures, failureLog: check.failureLog?.slice(-8000) })) }).slice(0, 28000);
      const outputShape = run.action === 'groom' ? 'Return an editable Markdown brief with ## Goal, ## Acceptance criteria, and ## Tasks. Under ## Tasks, use numbered lines, one actionable task per line.' : run.action === 'architecture' ? 'Return editable Markdown with ## Architecture, ## Alternatives, ## Dependencies, and ## Migration.' : 'Summarize changed files, tests run, and unresolved failures.';
      const prompt = `Idea Vault task ${run.ideaId}. Action: ${run.action}. Context: ${context}. User instructions: ${run.instructions}. Requested MCP tools: ${(agent.mcpTools || []).join(', ') || 'none'}. Work only in this repository. Do not publish, merge, push, or deploy. ${outputShape}`;
      const finalPath = path.join(workDir, 'final.txt');
      const args = agent.adapter === 'codex' ? ['exec', '-C', checkout, '-s', 'workspace-write', '--json', '-o', finalPath, prompt] : agent.adapter === 'claude' ? ['-p', prompt] : agent.argsTemplate.map((argument) => argument.replaceAll('{prompt}', prompt).replaceAll('{workspace}', checkout));
      const child = spawn(agent.executable, args, { cwd: checkout, shell: false, windowsHide: true });
      running.set(run.id, child);
      const timeout = setTimeout(() => {
        const current = getRun(run.id);
        if (current && current.status === 'running') saveRun({ ...current, status: 'failed', error: 'Agent exceeded the 30 minute limit', updatedAt: now() });
        child.kill();
      }, 30 * 60 * 1000);
      let logs = '';
      const onData = (chunk) => {
        logs = (logs + chunk.toString()).slice(-100000);
        const current = getRun(run.id);
        if (current) saveRun({ ...current, logs, updatedAt: now() });
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (error) => {
        clearTimeout(timeout);
        running.delete(run.id);
        const current = getRun(run.id);
        if (current) saveRun({ ...current, status: 'failed', error: String(error), updatedAt: now() });
      });
      child.on('close', async (code) => {
        clearTimeout(timeout);
        running.delete(run.id);
        const current = getRun(run.id);
        if (current && current.status === 'running') {
          if (code === 0 && ['groom', 'architecture'].includes(run.action)) {
            const body = agent.adapter === 'codex' ? await readFile(finalPath, 'utf8').catch(() => logs.slice(-20000)) : logs.slice(-20000);
            const artifact = { id: id(), ideaId: run.ideaId, kind: run.action === 'groom' ? 'brief' : 'architecture', title: `${run.action} by ${agent.name}`, body, createdAt: now(), updatedAt: now(), version: 1, runId: run.id };
            db.prepare('INSERT INTO work_artifacts (id, idea_id, kind, value) VALUES (?, ?, ?, ?)').run(artifact.id, artifact.ideaId, artifact.kind, JSON.stringify(artifact));
            if (run.action === 'groom') {
              const taskSection = body.split(/^## Tasks\s*$/im)[1]?.split(/^## /m)[0] || '';
              const titles = taskSection.split(/\r?\n/).map((line) => line.match(/^\s*\d+[.)]\s+(.+)$/)?.[1]?.trim()).filter(Boolean).slice(0, 30);
              const insertTask = db.prepare('INSERT INTO work_tasks (id, idea_id, value) VALUES (?, ?, ?)');
              titles.forEach((title, position) => {
                const task = { id: id(), ideaId: run.ideaId, title, position, status: 'todo', createdAt: now(), updatedAt: now(), version: 1, sourceRunId: run.id };
                insertTask.run(task.id, task.ideaId, JSON.stringify(task));
              });
            }
          }
          saveRun({ ...current, status: code === 0 ? 'completed' : 'failed', exitCode: code, logs, updatedAt: now() });
        }
      });
    } catch (error) {
      saveRun({ ...run, status: 'failed', error: String(error), updatedAt: now() });
    }
  }
  app.get('/api/agents/runs/:id', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(run);
  });
  app.post('/api/agents/runs/:id/stop', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    running.get(run.id)?.kill();
    saveRun({ ...run, status: 'cancelled', updatedAt: now() });
    res.json({ status: 'cancelled' });
  });
  app.post('/api/agents/runs/:id/retry', (req, res) => {
    const prior = getRun(req.params.id);
    if (!prior || !['failed', 'cancelled'].includes(prior.status)) return res.status(400).json({ error: 'Run is not retryable' });
    const agent = JSON.parse(db.prepare('SELECT value FROM agent_configs WHERE id = ?').get(prior.agentId)?.value || 'null');
    const repo = getRepo(prior.repoId);
    if (!agent || !repo) return res.status(404).json({ error: 'Configuration missing' });
    const run = { ...prior, id: id(), status: 'queued', createdAt: now(), updatedAt: now(), logs: '', workspace: '', branch: '', error: '', retryOf: prior.id };
    db.prepare('INSERT INTO agent_runs (id, idea_id, value) VALUES (?, ?, ?)').run(run.id, run.ideaId, JSON.stringify(run));
    res.status(202).json(run);
    void execute(run, agent, repo);
  });
  app.post('/api/agents/runs/:id/resume', (req, res) => {
    const prior = getRun(req.params.id);
    if (!prior || !['completed', 'failed', 'cancelled'].includes(prior.status)) return res.status(400).json({ error: 'Run cannot be resumed' });
    const agent = JSON.parse(db.prepare('SELECT value FROM agent_configs WHERE id = ?').get(prior.agentId)?.value || 'null');
    const repo = getRepo(prior.repoId);
    if (!agent || !repo) return res.status(404).json({ error: 'Configuration missing' });
    const run = { ...prior, id: id(), status: 'queued', createdAt: now(), updatedAt: now(), logs: '', workspace: '', branch: '', error: '', resumedFrom: prior.id, instructions: `${prior.instructions}\nPrevious run summary: ${prior.logs.slice(-2000)}\n${String(req.body?.instructions || '')}` };
    db.prepare('INSERT INTO agent_runs (id, idea_id, value) VALUES (?, ?, ?)').run(run.id, run.ideaId, JSON.stringify(run));
    res.status(202).json(run);
    void execute(run, agent, repo);
  });
  app.post('/api/agents/runs/:id/pull-request', async (req, res) => {
    const run = getRun(req.params.id);
    if (!run || run.status !== 'completed' || !run.workspace || !run.branch) return res.status(400).json({ error: 'Completed run with a checkout required' });
    const repo = getRepo(run.repoId);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });
    try {
      await runCommand('git', ['-C', run.workspace, 'push', '-u', 'origin', run.branch]);
      const url = (await runCommand('gh', ['pr', 'create', '--repo', `${repo.owner}/${repo.name}`, '--head', run.branch, '--base', repo.ref, '--title', String(req.body?.title || `Idea Vault: ${run.action}`), '--body', `Idea Vault idea ${run.ideaId}\nAgent run ${run.id}`], run.workspace)).trim();
      const artifact = { id: id(), ideaId: run.ideaId, kind: 'pull_request', title: `PR for ${run.action}`, body: url, createdAt: now(), updatedAt: now(), version: 1 };
      db.prepare('INSERT INTO work_artifacts (id, idea_id, kind, value) VALUES (?, ?, ?, ?)').run(artifact.id, run.ideaId, artifact.kind, JSON.stringify(artifact));
      res.json(artifact);
    } catch (error) { res.status(502).json({ error: String(error) }); }
  });

  async function github(pathname, options = {}) {
    if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not configured');
    const response = await fetch(`https://api.github.com${pathname}`, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', ...options.headers } });
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return response.status === 204 ? {} : response.json();
  }
  app.post('/api/agents/checks/refresh', async (req, res) => {
    const { ideaId, repoId, ref } = req.body ?? {};
    const repo = getRepo(repoId);
    if (!ideaId || !repo || !ref) return res.status(400).json({ error: 'Idea, repository, and commit/ref required' });
    try {
      const result = await github(`/repos/${repo.owner}/${repo.name}/commits/${encodeURIComponent(ref)}/check-runs`);
      const commit = await github(`/repos/${repo.owner}/${repo.name}/commits/${encodeURIComponent(ref)}`);
      const failed = result.check_runs.filter((check) => check.conclusion === 'failure');
      const annotations = new Map();
      for (const check of failed) {
        try { annotations.set(check.id, await github(`/repos/${repo.owner}/${repo.name}/check-runs/${check.id}/annotations?per_page=100`)); }
        catch { annotations.set(check.id, []); }
      }
      let failureLog = '';
      if (failed.length) {
        try {
          const runs = await github(`/repos/${repo.owner}/${repo.name}/actions/runs?head_sha=${commit.sha}&per_page=10`);
          const failedRun = runs.workflow_runs?.find((run) => run.conclusion === 'failure');
          if (failedRun) failureLog = (await runCommand('gh', ['run', 'view', String(failedRun.id), '--repo', `${repo.owner}/${repo.name}`, '--log-failed'])).slice(-16000);
        } catch { /* check annotations still remain available */ }
      }
      const checks = result.check_runs.map((check) => ({ id: String(check.id), ideaId, repoId, ref, sha: commit.sha, name: check.name, status: check.status, conclusion: check.conclusion, url: check.html_url, summary: check.output?.summary || '', title: check.output?.title || '', failureLog: check.conclusion === 'failure' ? failureLog : '', failures: (annotations.get(check.id) || []).map((item) => ({ title: item.title, message: item.message, path: item.path, line: item.start_line })), updatedAt: now() }));
      const insert = db.prepare('INSERT OR REPLACE INTO github_checks (id, idea_id, value) VALUES (?, ?, ?)');
      db.transaction(() => checks.forEach((check) => insert.run(check.id, ideaId, JSON.stringify(check))))();
      res.json(checks);
    } catch (error) { res.status(502).json({ error: String(error) }); }
  });
  app.post('/api/agents/deployments/prepare', async (req, res) => {
    const { ideaId, repoId, ref } = req.body ?? {};
    const repo = getRepo(repoId);
    if (!ideaId || !repo?.workflowId || !ref) return res.status(400).json({ error: 'Repository deployment workflow and ref required' });
    const checks = db.prepare('SELECT value FROM github_checks WHERE idea_id = ?').all(ideaId).map((row) => JSON.parse(row.value)).filter((check) => check.repoId === repoId && check.ref === ref);
    if (!checks.length || checks.some((check) => check.conclusion !== 'success')) return res.status(409).json({ error: 'Required GitHub checks must pass for this ref' });
    let sha;
    try { sha = (await github(`/repos/${repo.owner}/${repo.name}/commits/${encodeURIComponent(ref)}`)).sha; }
    catch (error) { return res.status(502).json({ error: String(error) }); }
    if (checks.some((check) => check.sha !== sha)) return res.status(409).json({ error: 'Branch moved; refresh GitHub checks' });
    const value = { id: id(), ideaId, repoId, ref, sha, workflowId: repo.workflowId, status: 'awaiting_approval', createdAt: now() };
    db.prepare('INSERT INTO deployments (id, idea_id, value) VALUES (?, ?, ?)').run(value.id, ideaId, JSON.stringify(value));
    res.status(201).json(value);
  });
  app.post('/api/agents/deployments/:id/approve', async (req, res) => {
    const deployment = JSON.parse(db.prepare('SELECT value FROM deployments WHERE id = ?').get(req.params.id)?.value || 'null');
    if (!deployment || deployment.status !== 'awaiting_approval') return res.status(404).json({ error: 'Pending deployment not found' });
    const repo = getRepo(deployment.repoId);
    const checks = db.prepare('SELECT value FROM github_checks WHERE idea_id = ?').all(deployment.ideaId).map((row) => JSON.parse(row.value)).filter((check) => check.repoId === deployment.repoId && check.ref === deployment.ref);
    if (!checks.length || checks.some((check) => check.conclusion !== 'success' || check.sha !== deployment.sha)) return res.status(409).json({ error: 'GitHub checks are not passing for the prepared commit' });
    try {
      const latestSha = (await github(`/repos/${repo.owner}/${repo.name}/commits/${encodeURIComponent(deployment.ref)}`)).sha;
      if (latestSha !== deployment.sha) return res.status(409).json({ error: 'Branch moved after preparation; refresh checks' });
      await github(`/repos/${repo.owner}/${repo.name}/actions/workflows/${encodeURIComponent(deployment.workflowId)}/dispatches`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: deployment.ref }) });
      const value = { ...deployment, status: 'dispatched', approvedAt: now() };
      db.prepare('UPDATE deployments SET value = ? WHERE id = ?').run(JSON.stringify(value), value.id);
      res.json(value);
    } catch (error) { res.status(502).json({ error: String(error) }); }
  });
  app.post('/api/agents/deployments/:id/refresh', async (req, res) => {
    const deployment = JSON.parse(db.prepare('SELECT value FROM deployments WHERE id = ?').get(req.params.id)?.value || 'null');
    if (!deployment || deployment.status === 'awaiting_approval') return res.status(404).json({ error: 'Dispatched deployment not found' });
    const repo = getRepo(deployment.repoId);
    try {
      const result = await github(`/repos/${repo.owner}/${repo.name}/actions/workflows/${encodeURIComponent(deployment.workflowId)}/runs?branch=${encodeURIComponent(deployment.ref)}&per_page=10`);
      const run = result.workflow_runs?.find((item) => item.created_at >= deployment.approvedAt);
      if (!run) return res.json(deployment);
      const value = { ...deployment, status: run.status === 'completed' ? (run.conclusion === 'success' ? 'succeeded' : 'failed') : run.status, url: run.html_url, updatedAt: now() };
      db.prepare('UPDATE deployments SET value = ? WHERE id = ?').run(JSON.stringify(value), value.id);
      res.json(value);
    } catch (error) { res.status(502).json({ error: String(error) }); }
  });
}
