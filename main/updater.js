'use strict';

const { autoUpdater } = require('electron-updater');
const { ipcMain }     = require('electron');

function initUpdater(mainWindow) {
  autoUpdater.logger       = console;
  autoUpdater.autoDownload = true;           // télécharge silencieusement dès qu'une MAJ est trouvée
  autoUpdater.autoInstallOnAppQuit = true;   // installe si l'utilisateur ferme sans cliquer "Restart"

  /* ── Events ────────────────────────────────────────────────── */

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    // Informer le renderer — la bannière s'affiche (téléchargement commence automatiquement)
    mainWindow?.webContents.send('update:available', {
      version:      info.version,
      releaseNotes: info.releaseNotes || ''
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', {
      percent:  Math.round(progress.percent),
      speed:    progress.bytesPerSecond,
      total:    progress.total,
      received: progress.transferred
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update ready:', info.version);
    // Bannière passe en mode "Restart & Install"
    mainWindow?.webContents.send('update:ready', {
      version: info.version
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] Already up to date.');
  });

  autoUpdater.on('error', (err) => {
    // Ne pas crasher l'app — les erreurs réseau sont fréquentes (offline, firewall...)
    console.error('[Updater] Error:', err.message);
  });

  /* ── IPC ───────────────────────────────────────────────────── */

  // "Restart & Install" cliqué dans la bannière
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // "Check now" dans Settings
  ipcMain.handle('update:check', async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      console.error('[Updater] Manual check failed:', e.message);
    }
  });

  /* ── Vérification au démarrage ─────────────────────────────── */
  // 5s de délai pour ne pas ralentir le boot initial
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(e => {
      console.error('[Updater] Startup check failed:', e.message);
    });
  }, 5000);
}

module.exports = { initUpdater };