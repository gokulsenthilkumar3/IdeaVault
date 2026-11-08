# Idea Vault

Idea Vault connects ideas to decisions, tasks, agent runs, GitHub checks, blog posts, and deployments. It runs locally with SQLite and can serve a public blog from the same Node process.

## Run locally

Requires Node.js 24+, npm, and Git. Install dependencies with `npm ci`, then run `npm run dev`. The frontend opens at `http://localhost:5173`; the API runs at `http://127.0.0.1:3001`. The first server start copies an existing `database.db` to `database.db.pre-workflow.bak` before schema changes. Set `IDEA_VAULT_DB_PATH` to use a different database file.

Use **Quick capture** to save an idea to Inbox. Open the idea to evaluate it, set a next action, or visit **Linked work** to add tasks, architecture notes, research, and a blog draft. The public blog is at `/blog`; its RSS feed is at `/api/blog/rss.xml`.

## Hosted configuration

Set these variables on the server:

| Variable | Purpose |
| --- | --- |
| `OWNER_TOKEN` | Required for remote private API access; enables owner login. |
| `PUBLIC_URL` | Absolute public site URL for email, RSS, and share links. |
| `IDEA_VAULT_DB_PATH` | Persistent SQLite file path. |
| `PORT` | HTTP port (default `3001`). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Verified subscriptions and new-post mail. Publishing remains unavailable until SMTP is configured. |
| `GITHUB_TOKEN` | GitHub check retrieval and workflow dispatch. |
| `ALLOWED_AGENT_EXECUTABLES` | Comma-separated executable names or absolute paths allowed for agent runs (default `codex,claude`). Add custom agent paths explicitly. |

Build with `npm run build`, then run `node server.js` to serve the app and API from one origin. Use HTTPS in front of the server when hosting it. Keep the SQLite database and its backup files on persistent storage. Never expose agent executables or GitHub credentials through the browser.

## Agents and releases

Connect a repository on the **Agents** page, then allow a Codex, Claude, or custom CLI agent to use it. Local agents use a Git worktree; hosted agents clone with `gh` on the host. Codex or Claude CLI, `gh`, and their credentials must be installed on the machine that executes the run. Custom agents receive a configured argument array with `{prompt}` and `{workspace}` substitutions; the executable runs without a shell. MCP tool names are recorded in the agent configuration, while actual MCP availability is controlled by the agent's own configuration.

Runs can groom, design architecture, implement, test, investigate, and prepare release. A successful grooming or architecture run produces a linked editable artifact. Completed code runs can push their branch and create a pull request when the owner clicks **Create pull request**. Deployments use the connected repository's GitHub Actions workflow. Idea Vault requires successful GitHub checks for the exact ref before preparing or approving deployment.

## Data and tests

Idea and preference writes use versioned record updates. Offline writes stay in a local queue; conflicting writes pause until the owner chooses a copy in Settings. JSON backup includes linked work, blog posts, subscribers, agent runs, and repository links; restore skips duplicate IDs and creates a pre-import SQLite backup. Do not place credentials in agent names, prompts, notes, or artifacts.

Run `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e`. Browser tests require Playwright Chromium (`npx playwright install chromium`). GitHub CI runs all four checks on pull requests.

`npm run check` runs lint, Node tests, and the production build together. See [CONTRIBUTING.md](CONTRIBUTING.md) for development conventions and [ROADMAP.md](ROADMAP.md) for proposed improvements and remaining hardening work.

The server is authoritative after queued offline edits have synced. An empty server no longer automatically imports cached ideas; use Settings to import a backup deliberately. Owner sessions expire after 24 hours on both the server and browser.

## Windows desktop app

Run `npm run desktop:build` to create a Windows installer in `release/`. The installed app bundles its own runtime, UI, API, and SQLite database; users do not need Node.js or a separately running server. Launch Idea Vault from the Start menu. Closing its window exits the app.

Desktop data is stored in `%APPDATA%/Idea Vault/database.db` (Electron's user data directory) and survives application upgrades. The desktop starts with a fresh database; use Settings backup/export and import to transfer existing development data. Back up your data regularly.

Core idea management works without internet. GitHub, email delivery, and external agent integrations still require their services, credentials, and installed CLIs. This desktop app does not make a public blog reachable from other computers.
