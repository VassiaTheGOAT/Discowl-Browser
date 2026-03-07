'use strict';

/**
 * updater.js — Gestion des mises à jour automatiques via electron-updater
 *
 * Principe :
 *  1. Au démarrage, vérifie silencieusement si une nouvelle version existe
 *     sur GitHub Releases (latest.yml / latest-mac.yml)
 *  2. Si oui, télécharge en arrière-plan
 *  3. Une fois prêt, envoie une notification au renderer
 *  4. L'utilisateur choisit de redémarrer ou plus tard
 */

const { autoUpdater } = require('electron-updater');
const { ipcMain, BrowserWindow } = require('electron');

function initUpdater(mainWindow) {
  // Logs visibles dans la console pendant le dev
  autoUpdater.logger = console;

  // Ne pas installer automatiquement — attendre la confirmation de l'utilisateur
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoDownload         = true;

  /* ── Events ────────────────────────────────────────────────── */

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Vérification des mises à jour…');
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] Déjà à jour.');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Mise à jour disponible :', info.version);
    mainWindow?.webContents.send('update:available', {
      version: info.version,
      releaseNotes: info.releaseNotes || ''
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', {
      percent:   Math.round(progress.percent),
      speed:     progress.bytesPerSecond,
      total:     progress.total,
      received:  progress.transferred
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Mise à jour téléchargée :', info.version);
    mainWindow?.webContents.send('update:ready', {
      version: info.version
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Erreur :', err.message);
    // Ne pas crasher l'app sur une erreur d'update
  });

  /* ── IPC — déclenché depuis le renderer ────────────────────── */

  // Redémarrer et installer la mise à jour
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // Vérifier manuellement (bouton dans les paramètres)
  ipcMain.handle('update:check', async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      console.error('[Updater] checkForUpdates échoué :', e.message);
    }
  });

  /* ── Lancement ─────────────────────────────────────────────── */
  // Attendre 5s après le démarrage pour ne pas ralentir le boot
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(e => {
      console.error('[Updater] check silencieux échoué :', e.message);
    });
  }, 5000);
}

module.exports = { initUpdater };