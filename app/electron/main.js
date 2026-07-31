'use strict';
const { app, BrowserWindow, shell, ipcMain, Menu, dialog } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const IS_DEVELOPER = process.argv.includes('-developer');

let serverPort = null;
let mainWin    = null;

function getAssetsPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(ROOT, 'assets');
}

async function startServer() {
  process.env.ELECTRON_ASSETS_PATH = getAssetsPath();
  process.env.ELECTRON_USER_DATA   = app.getPath('userData');

  const express = require('express');
  const srv = express(); 
  srv.use(express.json());
  srv.use(express.static(path.join(ROOT, 'public')));
  srv.use('/assets', express.static(process.env.ELECTRON_ASSETS_PATH));

  for (const name of ['meta', 'ai', 'dev', 'game', 'inventory', 'combat', 'npc', 'event', 'dialogue', 'scavenge']) {
    try {
      srv.use(require(path.join(ROOT, 'server', 'routes', name)));
    } catch (err) {
      throw new Error(`Failed to load route "${name}" (ROOT=${ROOT}): ${err.message}`);
    }
  }

  return new Promise((resolve, reject) => {
    const s = srv.listen(0, '127.0.0.1', () => resolve(s.address().port));
    s.on('error', reject);
  });
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    }
  });
  mainWin.loadURL(`http://127.0.0.1:${serverPort}`);
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Surface load failures instead of a silent hang (e.g. packaged build with a
  // bad asset/server path) — visible in the -developer console.
  mainWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[electron] did-fail-load', code, desc, url);
  });

  // Known Electron/Chromium quirk (Windows): the BrowserWindow can hold OS
  // focus while its webContents doesn't track keyboard/click focus, leaving
  // inputs unclickable and Tab dead — until something (alt-tab, opening
  // DevTools) forces Chromium to reattach it. `focus`/`enter-full-screen`
  // alone weren't enough to reproduce that reattach reliably, so `focusOnWebView()`
  // is also re-asserted on every renderer→main IPC call (see 'api' handle below),
  // which happens to line up with the exact same fix as clicking into DevTools.
  mainWin.on('enter-full-screen', () => mainWin.focusOnWebView());
  mainWin.on('focus',             () => mainWin.focusOnWebView());

  // F12 → toggle DevTools, only when launched with -developer (same flag that
  // gates server/engine/devlog.js and the in-game dev panel).
  if (IS_DEVELOPER) {
    mainWin.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        mainWin.webContents.toggleDevTools();
      }
    });
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  serverPort = await startServer();

  ipcMain.handle('api', async (_e, url, method, body) => {
    mainWin?.focusOnWebView();
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`http://127.0.0.1:${serverPort}${url}`, opts);
    return res.json();
  });

  ipcMain.handle('app:quit', () => app.quit());

  ipcMain.handle('window:getInfo', () => {
    const { screen } = require('electron');
    const display = screen.getPrimaryDisplay();
    return {
      screenW:     display.size.width,
      screenH:     display.size.height,
      mode:        mainWin?.isFullScreen() ? 'fullscreen'
                 : mainWin?.isMaximized()  ? 'borderless'
                 : 'windowed',
      bounds:      mainWin?.getBounds() ?? { width: 1280, height: 800 }
    };
  });

  ipcMain.handle('window:setMode', (_e, mode, width, height) => {
    if (!mainWin) return;
    if (mode === 'fullscreen') {
      mainWin.setFullScreen(true);
    } else if (mode === 'borderless') {
      mainWin.setFullScreen(false);
      mainWin.maximize();
    } else {
      mainWin.setFullScreen(false);
      mainWin.unmaximize();
      if (width && height) { mainWin.setSize(width, height); mainWin.center(); }
    }
  });

  createWindow();
}).catch(err => {
  console.error('[electron] startup failed:', err);
  dialog.showErrorBox('Lux Aeterna Dungeon — startup failed', String(err?.stack ?? err));
  app.quit();
});  

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
