import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:5174', browserName: 'chromium' },
  webServer: [
    { command: 'node server.js', url: 'http://127.0.0.1:31731/api/owner/session', reuseExistingServer: false, env: { PORT: '31731', IDEA_VAULT_DB_PATH: path.join(os.tmpdir(), `idea-vault-e2e-${process.pid}.db`) } },
    { command: 'npm run dev:frontend -- --host 127.0.0.1 --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: false, env: { IDEA_VAULT_API_PORT: '31731' } },
  ],
});
