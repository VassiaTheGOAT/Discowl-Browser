'use strict';

const { BrowserWindow, ipcMain } = require('electron');
const { autoUpdater }            = require('electron-updater');
const path                       = require('path');

let _onDone    = null;
let splashWin  = null;
let _launched  = false;  // garde-fou : on ne lance l'app qu'une seule fois

function send(type, extra) {
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.webContents.send('updater:status', { type, ...(extra || {}) });
  }
}

function launch(delay) {
  if (_launched) return;
  _launched = true;
  setTimeout(() => {
    if (splashWin && !splashWin.isDestroyed()) {
      splashWin.close();
      splashWin = null;
    }
    _onDone?.();
  }, delay ?? 900);
}

function createSplash() {
  splashWin = new BrowserWindow({
    width:           420,
    height:          240,
    resizable:       false,
    frame:           false,
    alwaysOnTop:     true,
    center:          true,
    show:            false,
    skipTaskbar:     true,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload:          path.join(__dirname, '../preload/preload-updater.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false
    }
  });
  splashWin.loadFile(path.join(__dirname, '../renderer/updater.html'));
  splashWin.once('ready-to-show', () => splashWin?.show());
  splashWin.on('closed', () => { splashWin = null; });
}

function runUpdater(onDone) {
  _onDone   = onDone;
  _launched = false;

  const { app } = require('electron');
  if (!app.isPackaged) { onDone(); return; }

  createSplash();

  // ── Timeout de secours : si aucun event dans 8s → lancer l'app ──
  const timeout = setTimeout(() => {
    console.warn('[Updater] Timeout — launching anyway');
    send('error', { message: 'Timeout' });
    launch(800);
  }, 8000);

  function done(delay) {
    clearTimeout(timeout);
    launch(delay);
  }

  // ── Config autoUpdater ───────────────────────────────────────
  autoUpdater.autoDownload         = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade       = false;

  // Logger complet pour debug
  autoUpdater.logger = {
    info:  (...a) => console.log('[Updater]',  ...a),
    warn:  (...a) => console.warn('[Updater]', ...a),
    error: (...a) => console.error('[Updater]',...a),
    debug: (...a) => console.log('[Updater:debug]', ...a)
  };

  // ── Events ──────────────────────────────────────────────────
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for update…');
    send('checking');
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] Up to date. Current:', info.version);
    send('not-available');
    done(900);
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    send('available', { version: info.version });
    autoUpdater.downloadUpdate().catch(e => {
      console.error('[Updater] downloadUpdate failed:', e.message);
      send('error', { message: e.message });
      done(1000);
    });
  });

  autoUpdater.on('download-progress', (p) => {
    const pct = Math.round(p.percent);
    console.log(`[Updater] Downloading ${pct}%`);
    send('progress', { percent: pct, speed: p.bytesPerSecond, total: p.total, received: p.transferred });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Downloaded:', info.version);
    send('downloaded', { version: info.version });
    clearTimeout(timeout);
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 1200);
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
    send('error', { message: err.message });
    done(1000);
  });

  // ── Lancer le check APRÈS que le splash soit prêt ───────────
  // did-finish-load garantit que le webContents peut recevoir des IPC.
  // Sans ça, si update-available fire avant le chargement du splash,
  // send() est ignoré et downloadUpdate() n'est jamais appelé.
  splashWin.webContents.once('did-finish-load', () => {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[Updater] checkForUpdates threw:', err.message);
      send('error', { message: err.message });
      done(1000);
    });
  });
}

function registerIpc() {
  ipcMain.handle('update:check', async () => {
    try { await autoUpdater.checkForUpdates(); }
    catch (e) { console.error('[Updater] Manual check failed:', e.message); }
  });
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });
}

module.exports = { runUpdater, registerIpc };