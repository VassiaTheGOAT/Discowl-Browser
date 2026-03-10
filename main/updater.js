'use strict';

/**
 * updater.js — Pre-launch updater
 *
 * Flow :
 *  1. Crée une petite fenêtre splash (420x240) AVANT la fenêtre principale
 *  2. Vérifie silencieusement GitHub Releases
 *  3a. Pas de MAJ → ferme splash → ouvre l'app (après 900ms)
 *  3b. MAJ trouvée → télécharge avec barre de progression dans le splash
 *  4. Download terminé → quitAndInstall
 *  5. En cas d'erreur réseau → ferme splash → ouvre l'app normalement
 */

const { BrowserWindow, ipcMain } = require('electron');
const { autoUpdater }            = require('electron-updater');
const path                       = require('path');

let _onDone   = null;
let splashWin = null;

function send(type, extra) {
  splashWin?.webContents?.send('updater:status', { type, ...extra });
}

function closeSplashAndLaunch(delay) {
  setTimeout(() => {
    if (splashWin && !splashWin.isDestroyed()) {
      splashWin.close();
      splashWin = null;
    }
    _onDone?.();
  }, delay || 900);
}

function createSplash() {
  splashWin = new BrowserWindow({
    width:           420,
    height:          240,
    resizable:       false,
    frame:           false,
    transparent:     false,
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
  splashWin.once('ready-to-show', () => splashWin && splashWin.show());
  splashWin.on('closed', () => { splashWin = null; });
}

function runUpdater(onDone) {
  _onDone = onDone;

  const { app } = require('electron');

  // En dev → lancer directement, pas de check
  if (!app.isPackaged) {
    onDone();
    return;
  }

  createSplash();

  autoUpdater.logger       = console;
  autoUpdater.autoDownload = false; // contrôle manuel

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking…');
    send('checking');
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] Up to date.');
    send('not-available');
    closeSplashAndLaunch(900);
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    send('available', { version: info.version });
    autoUpdater.downloadUpdate();
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    send('progress', {
      version:  '',
      percent:  pct,
      speed:    progress.bytesPerSecond,
      total:    progress.total,
      received: progress.transferred
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Downloaded, installing…');
    send('downloaded', { version: info.version });
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 1200);
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
    send('error', { message: err.message });
    closeSplashAndLaunch(1000);
  });

  autoUpdater.checkForUpdates().catch(err => {
    console.error('[Updater] checkForUpdates failed:', err.message);
    send('error', { message: err.message });
    closeSplashAndLaunch(1000);
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