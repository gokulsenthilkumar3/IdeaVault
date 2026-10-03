# Developing Idea Vault

Use Node.js 24 or newer and install the locked dependencies with `npm ci`.
On Windows, use `npm.cmd` and `npx.cmd` if PowerShell blocks the `.ps1` wrappers.
Start the API and Vite together with `npm run dev`.

## Before a pull request

1. Describe the user-visible problem and keep the change focused.
2. Add a regression test for a reproduced bug, especially persistence, authentication, or editor behavior.
3. Run `npm run check` for lint, server/unit tests, TypeScript, and the production build.
4. Install Chromium with `npx playwright install chromium`, then run `npm run test:e2e`.
5. Describe what changed, the checks run, and any remaining limitations. CI must pass before merging.

Lint warnings fail the check. Do not suppress a warning without explaining why it is safe.
Keep `package-lock.json` updated with dependency changes and use the existing two-space style.

## Implementation conventions

- Keep derived UI values derived, use stable record IDs for selection, and make keyboard actions match the visible controls.
- Use accessible names for inputs and controls. Check both desktop and a 390px-wide mobile viewport when changing layouts.
- Keep Zustand updates immutable. Send persisted record changes through the versioned queue; handle conflicts explicitly.
- Drain queued edits before reading server state. Never replace newer local edits with an older response, and never infer permission to restore a backup from an empty database.
- Validate API inputs before writing. Return JSON errors with appropriate HTTP status codes, and keep internal error details in server logs.
- Keep credentials server-side and outside source control. Owner sessions have a 24-hour server-enforced lifetime and are invalidated by a server restart.
- Back up SQLite before migrations and restore operations. Test changes against a temporary database using `IDEA_VAULT_DB_PATH`, never the working vault.
- Do not run real agent jobs, send mail, push branches, or deploy as a side effect of a test. Existing integration tests use isolated repositories, databases, and a local mail fixture.

## Code map

`src/pages` contains screens; `src/components` contains shared controls; `src/stores/useStore.ts` owns application state; `src/lib/storage.ts` owns the browser cache and write queue.
`server.js` handles the core API and authentication. `workflow-server.js` handles linked work, publishing, and backups. `agent-server.js` handles agent and GitHub workflows.
`tests` contains Node tests; `e2e` contains Playwright browser tests.

## Scope of the current checks

Passing tests is a release gate, not a full security or accessibility certification.
Further work includes complete record schemas across all import/API paths, cross-tab queue coordination, login rate limiting and logout UX, and deployment-specific backup recovery drills. Track these in [ROADMAP.md](ROADMAP.md).
