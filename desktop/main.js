import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';

app.setName('Idea Vault');
let window;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.restore(); window?.focus(); });
  app.whenReady().then(async () => {
    try {
      process.env.IDEA_VAULT_DB_PATH = path.join(app.getPath('userData'), 'database.db');
      process.env.PORT = '0';
      delete process.env.OWNER_TOKEN;
      const { server } = await import('../server.js');
      if (!server.listening) await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
      const origin = `http://127.0.0.1:${server.address().port}`;
      process.env.PUBLIC_URL = origin;
      window = new BrowserWindow({ width: 1280, height: 850, minWidth: 800, minHeight: 600, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (event, url) => {
        if (new URL(url).origin !== origin) event.preventDefault();
      });
      await window.loadURL(origin);
    } catch (error) {
      dialog.showErrorBox('Idea Vault could not start', String(error));
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
}

