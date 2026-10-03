import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

export type AgentConfig = {
  id: string;
  name: string;
  adapter: "codex" | "claude" | "custom";
  mode: "local" | "hosted";
  executable: string;
  allowedRepoIds: string[];
  mcpTools: string[];
  argsTemplate?: string[];
  enabled?: boolean;
  version?: number;
};
export type Repository = {
  id: string;
  owner: string;
  name: string;
  localPath: string;
  workflowId: string;
  ref: string;
  enabled?: boolean;
  version?: number;
};
type Preflight = {
  ready: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
  note?: string;
};
type RecentRun = {
  id: string;
  action: string;
  status: string;
  createdAt: string;
  agentId: string;
  repoId: string;
};

import { useTitle } from "../hooks/useTitle";

export default function AgentsPage() {
  useTitle("Agents");
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [runs, setRuns] = useState<RecentRun[]>([]);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [editingRepo, setEditingRepo] = useState<Repository | null>(null);
  const [preflight, setPreflight] = useState<Record<string, Preflight>>({});
  const [busy, setBusy] = useState("");
  const [agentName, setAgentName] = useState("Codex");
  const [adapter, setAdapter] = useState<"codex" | "claude" | "custom">(
    "codex",
  );
  const [mode, setMode] = useState<"local" | "hosted">("local");
  const [executable, setExecutable] = useState("codex");
  const [mcpTools, setMcpTools] = useState("");
  const [argsTemplate, setArgsTemplate] = useState("-p,{prompt}");
  const [allowedRepoIds, setAllowedRepoIds] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [ref, setRef] = useState("main");
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const [configured, repositories, recent] = await Promise.all([
      api<AgentConfig[]>("/agents/configs"),
      api<Repository[]>("/agents/repositories"),
      api<RecentRun[]>("/agents/runs"),
    ]);
    setAgents(configured);
    setRepos(repositories);
    setRuns(recent);
  }, []);
  useEffect(() => {
    Promise.all([api<AgentConfig[]>('/agents/configs'), api<Repository[]>('/agents/repositories'), api<RecentRun[]>('/agents/runs')])
      .then(([configured, repositories, recent]) => { setAgents(configured); setRepos(repositories); setRuns(recent); })
      .catch((caught) => setError(String(caught)));
  }, []);
  async function addAgent(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/agents/configs", {
        method: "POST",
        body: JSON.stringify({
          name: agentName,
          adapter,
          mode,
          executable,
          argsTemplate: argsTemplate.split(",").map((item) => item.trim()),
          mcpTools: mcpTools
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          allowedRepoIds,
        }),
      });
      await reload();
    } catch (caught) {
      setError(String(caught));
    }
  }
  async function addRepo(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/agents/repositories", {
        method: "POST",
        body: JSON.stringify({ owner, name, localPath, workflowId, ref }),
      });
      await reload();
    } catch (caught) {
      setError(String(caught));
    }
  }
  async function saveAgent(item: AgentConfig) {
    setBusy(item.id);
    setError("");
    try {
      await api(`/agents/configs/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...item, version: item.version || 1 }),
      });
      setEditingAgent(null);
      await reload();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy("");
    }
  }
  async function saveRepo(item: Repository) {
    setBusy(item.id);
    setError("");
    try {
      await api(`/agents/repositories/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...item, version: item.version || 1 }),
      });
      setEditingRepo(null);
      await reload();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy("");
    }
  }
  async function testConnection(kind: "configs" | "repositories", id: string) {
    setBusy(id);
    setError("");
    try {
      setPreflight({
        ...preflight,
        [`${kind}:${id}`]: await api<Preflight>(
          `/agents/${kind}/${id}/preflight`,
        ),
      });
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy("");
    }
  }
  return (
    <main className="work-page agents-page">
      <div className="page-heading">
        <div>
          <h1>Agents & repositories</h1>
          <p>
            Control who can work where, and check each connection before a run.
          </p>
        </div>
      </div>
      <div className="page-tabs" role="tablist" aria-label="Agents sections">
        <button
          role="tab"
          onClick={() =>
            document
              .getElementById("agent-configurations")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          Agents {agents.length}
        </button>
        <button
          role="tab"
          onClick={() =>
            document
              .getElementById("agent-repositories")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          Repositories {repos.length}
        </button>
        <button
          role="tab"
          onClick={() =>
            document
              .getElementById("agent-runs")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          Recent runs {runs.length}
        </button>
      </div>
      <p className="page-notice">
        Agents can plan, code, and test in isolated checkouts. Publishing and
        deployment still require your approval. MCP tools listed here are
        declarations, not enforced tool grants.
      </p>
      {error && (
        <p role="alert" className="page-error">
          {error}
        </p>
      )}
      <section className="card" id="agent-configurations">
        <h2>Agent configurations</h2>
        <p>
          Connect a CLI and explicitly choose its permitted repositories.
          Credentials remain on the runner.
        </p>
        <form onSubmit={addAgent} className="work-form">
          <input
            className="input"
            aria-label="Agent name"
            placeholder="Name"
            value={agentName}
            onChange={(event) => setAgentName(event.target.value)}
            required
          />
          <select
            className="input"
            aria-label="Agent adapter"
            value={adapter}
            onChange={(event) => {
              const value = event.target.value as "codex" | "claude" | "custom";
              setAdapter(value);
              setExecutable(value === "custom" ? "" : value);
            }}
          >
            <option value="codex">Codex CLI</option>
            <option value="claude">Claude CLI</option>
            <option value="custom">Other CLI / MCP agent</option>
          </select>
          <select
            className="input"
            aria-label="Agent runner"
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as "local" | "hosted")
            }
          >
            <option value="local">Local runner</option>
            <option value="hosted">Hosted runner</option>
          </select>
          <input
            className="input"
            aria-label="Agent executable"
            placeholder="Executable"
            value={executable}
            onChange={(event) => setExecutable(event.target.value)}
            required
          />
          <input
            className="input"
            aria-label="Declared MCP tools"
            placeholder="MCP tools available through agent (comma separated)"
            value={mcpTools}
            onChange={(event) => setMcpTools(event.target.value)}
          />
          {adapter === "custom" && (
            <input
              className="input"
              aria-label="Custom agent arguments"
              placeholder="Arguments, comma separated; include {prompt}"
              value={argsTemplate}
              onChange={(event) => setArgsTemplate(event.target.value)}
            />
          )}
          <fieldset>
            <legend>Permitted repositories</legend>
            {repos.map((repo) => (
              <label key={repo.id}>
                <input
                  type="checkbox"
                  checked={allowedRepoIds.includes(repo.id)}
                  onChange={(event) =>
                    setAllowedRepoIds(
                      event.target.checked
                        ? [...allowedRepoIds, repo.id]
                        : allowedRepoIds.filter((id) => id !== repo.id),
                    )
                  }
                />{" "}
                {repo.owner}/{repo.name}
              </label>
            ))}
          </fieldset>
          {repos.length === 0 && (
            <p className="page-notice" style={{ marginTop: 8 }}>
              Please add a repository below before adding an agent.
            </p>
          )}
          <button
            className="btn btn-primary"
            disabled={!allowedRepoIds.length || repos.length === 0}
          >
            Add agent
          </button>
        </form>
        <div className="configuration-list">
          {agents.map((item) => (
            <article className="configuration-row" key={item.id}>
              <div>
                <h3>
                  {item.name}{" "}
                  <span className="page-badge">
                    {item.enabled === false ? "Disabled" : "Enabled"}
                  </span>
                </h3>
                <p>
                  {item.adapter} · {item.mode} · {item.executable}
                </p>
                <small>
                  Repositories:{" "}
                  {item.allowedRepoIds
                    .map((id) => {
                      const repo = repos.find((entry) => entry.id === id);
                      return repo
                        ? `${repo.owner}/${repo.name}`
                        : "Missing repository";
                    })
                    .join(", ") || "None"}
                  <br />
                  MCP declared: {item.mcpTools.join(", ") || "None"}
                </small>
              </div>
              <div className="work-form">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setEditingAgent({ ...item })}
                >
                  Edit access
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={busy === item.id}
                  onClick={() => testConnection("configs", item.id)}
                >
                  Test connection
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy === item.id}
                  onClick={() =>
                    saveAgent({ ...item, enabled: item.enabled === false })
                  }
                >
                  {item.enabled === false ? "Enable" : "Disable"}
                </button>
              </div>
              {preflight[`configs:${item.id}`] && (
                <div className="preflight-result" role="status">
                  <strong>
                    {preflight[`configs:${item.id}`].ready
                      ? "Ready"
                      : "Needs attention"}
                  </strong>
                  {preflight[`configs:${item.id}`].checks.map((check) => (
                    <p key={check.name}>
                      {check.ok ? "✓" : "×"} {check.name} {check.detail}
                    </p>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
        {editingAgent && (
          <div className="configuration-editor">
            <h3>Edit {editingAgent.name}</h3>
            <label>
              Name
              <input
                className="input"
                value={editingAgent.name}
                onChange={(event) =>
                  setEditingAgent({ ...editingAgent, name: event.target.value })
                }
              />
            </label>
            <label>
              Executable
              <input
                className="input"
                value={editingAgent.executable}
                onChange={(event) =>
                  setEditingAgent({
                    ...editingAgent,
                    executable: event.target.value,
                  })
                }
              />
            </label>
            <fieldset>
              <legend>Permitted repositories</legend>
              {repos.map((repo) => (
                <label key={repo.id}>
                  <input
                    type="checkbox"
                    checked={editingAgent.allowedRepoIds.includes(repo.id)}
                    onChange={(event) =>
                      setEditingAgent({
                        ...editingAgent,
                        allowedRepoIds: event.target.checked
                          ? [...editingAgent.allowedRepoIds, repo.id]
                          : editingAgent.allowedRepoIds.filter(
                              (id) => id !== repo.id,
                            ),
                      })
                    }
                  />{" "}
                  {repo.owner}/{repo.name}
                </label>
              ))}
            </fieldset>
            <label>
              Declared MCP tools
              <input
                className="input"
                value={editingAgent.mcpTools.join(", ")}
                onChange={(event) =>
                  setEditingAgent({
                    ...editingAgent,
                    mcpTools: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <div className="work-form">
              <button
                className="btn btn-primary"
                disabled={busy === editingAgent.id}
                onClick={() => saveAgent(editingAgent)}
              >
                Save changes
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setEditingAgent(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="card" id="agent-repositories">
        <h2>GitHub repositories</h2>
        <form onSubmit={addRepo} className="work-form">
          <input
            className="input"
            aria-label="GitHub owner"
            placeholder="Owner"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            required
          />
          <input
            className="input"
            aria-label="GitHub repository"
            placeholder="Repository"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <input
            className="input"
            aria-label="Local repository path"
            placeholder="Local path (for local runs)"
            value={localPath}
            onChange={(event) => setLocalPath(event.target.value)}
          />
          <input
            className="input"
            aria-label="Deployment workflow"
            placeholder="Deployment workflow file or ID"
            value={workflowId}
            onChange={(event) => setWorkflowId(event.target.value)}
          />
          <input
            className="input"
            aria-label="Default branch"
            placeholder="Default branch"
            value={ref}
            onChange={(event) => setRef(event.target.value)}
            required
          />
          <button className="btn btn-primary">Add repository</button>
        </form>
        <div className="configuration-list">
          {repos.map((repo) => (
            <article className="configuration-row" key={repo.id}>
              <div>
                <h3>
                  {repo.owner}/{repo.name}{" "}
                  <span className="page-badge">
                    {repo.enabled === false ? "Disabled" : "Enabled"}
                  </span>
                </h3>
                <p>
                  Branch {repo.ref} ·{" "}
                  {repo.workflowId || "No deployment workflow"}
                </p>
                <small>{repo.localPath || "Hosted checkout only"}</small>
              </div>
              <div className="work-form">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setEditingRepo({ ...repo })}
                >
                  Edit
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={busy === repo.id}
                  onClick={() => testConnection("repositories", repo.id)}
                >
                  Test connection
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy === repo.id}
                  onClick={() =>
                    saveRepo({ ...repo, enabled: repo.enabled === false })
                  }
                >
                  {repo.enabled === false ? "Enable" : "Disable"}
                </button>
              </div>
              {preflight[`repositories:${repo.id}`] && (
                <div className="preflight-result" role="status">
                  <strong>
                    {preflight[`repositories:${repo.id}`].ready
                      ? "Ready"
                      : "Needs attention"}
                  </strong>
                  {preflight[`repositories:${repo.id}`].checks.map((check) => (
                    <p key={check.name}>
                      {check.ok ? "✓" : "×"} {check.name} {check.detail}
                    </p>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
        {editingRepo && (
          <div className="configuration-editor">
            <h3>
              Edit {editingRepo.owner}/{editingRepo.name}
            </h3>
            <label>
              Owner
              <input
                className="input"
                value={editingRepo.owner}
                onChange={(event) =>
                  setEditingRepo({ ...editingRepo, owner: event.target.value })
                }
              />
            </label>
            <label>
              Repository
              <input
                className="input"
                value={editingRepo.name}
                onChange={(event) =>
                  setEditingRepo({ ...editingRepo, name: event.target.value })
                }
              />
            </label>
            <label>
              Local path
              <input
                className="input"
                value={editingRepo.localPath}
                onChange={(event) =>
                  setEditingRepo({
                    ...editingRepo,
                    localPath: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Default branch
              <input
                className="input"
                value={editingRepo.ref}
                onChange={(event) =>
                  setEditingRepo({ ...editingRepo, ref: event.target.value })
                }
              />
            </label>
            <label>
              Deployment workflow
              <input
                className="input"
                value={editingRepo.workflowId}
                onChange={(event) =>
                  setEditingRepo({
                    ...editingRepo,
                    workflowId: event.target.value,
                  })
                }
              />
            </label>
            <div className="work-form">
              <button
                className="btn btn-primary"
                disabled={busy === editingRepo.id}
                onClick={() => saveRepo(editingRepo)}
              >
                Save changes
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setEditingRepo(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="card" id="agent-runs">
        <h2>Recent runs</h2>
        {!runs.length && (
          <p>No agent runs yet. Start one from an idea’s linked work.</p>
        )}
        {(Array.isArray(runs) ? runs : []).map((run) => (
          <div className="configuration-row" key={run.id}>
            <strong>
              {run.action} · {run.status}
            </strong>
            <small>
              {new Date(run.createdAt).toLocaleString()} ·{" "}
              {agents.find((item) => item.id === run.agentId)?.name ||
                "Unknown agent"}
            </small>
          </div>
        ))}
      </section>
    </main>
  );
}
