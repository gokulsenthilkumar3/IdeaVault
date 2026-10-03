# Idea Vault improvement roadmap

These are proposed additions, not implemented features. Prioritize reliability before expanding integrations.

| Priority | Addition | User benefit and acceptance criteria |
| --- | --- | --- |
| Next | Full record validation | Shared schemas for API writes and both backup formats; malformed nested fields are rejected before mutation with actionable errors. |
| Next | Cross-tab sync coordination | Two tabs editing different ideas retain both edits; competing edits show a conflict; reconnect retries do not duplicate writes. |
| Next | Better conflict and backup recovery | Compare both versions, export unsynced edits explicitly, preview a restore, and verify recovery against a temporary database. |
| Next | Hosted account controls | Sign out and revoke sessions, rate-limit login attempts, and handle expiry without losing an in-progress edit. |
| Later | Review reminders | Surface overdue next actions and deferred ideas in a weekly review, with snooze and timezone-aware dates. |
| Later | Idea relationships | Link related or duplicate ideas, merge them with a preview, and preserve linked tasks, comments, and history. |
| Later | Planning views | Add task dependencies, milestones, and workload views with clear blocked-state indicators. |
| Later | Capture integrations | Browser-extension or authenticated API capture that preserves the source URL and deduplicates repeated submissions. |

Before a hosted release, also exercise keyboard-only navigation, contrast and focus behavior, backup retention and restore, and the deployed HTTPS/authentication configuration. Add targeted regression coverage when those reviews identify failures.
