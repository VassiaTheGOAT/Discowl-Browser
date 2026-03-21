'use strict';

/**
 * updater.js — Système de mise à jour production (electron-updater)
 *
 * Architecture :
 *   Phase 1 : Splash de démarrage → check silencieux
 *             Si MAJ dispo → téléchargement avec progression
 *             Si à jour ou erreur → lancement immédiat de l'app
 *
 *   Phase 2 : Vérification périodique en arrière-plan (toutes les 4h)
 *             Notification toast non-intrusive si MAJ disponible
 *             L'utilisateur choisit quand installer
 *
 * Sécurité :
 *   - electron-updater vérifie le SHA512 de chaque asset via latest.yml
 *   - HTTPS imposé par electron-updater (GitHub Releases)
 *   - Signature de code recommandée (voir DEPLOYMENT.md)
 *
 * Environnements :
 *   - dev  (app.isPackaged = false) → skip complet, lancement direct
 *   - prod (app.isPackaged = true)  → flux complet
 */

const { autoUpdater }         = require('electron-updater');
const { BrowserWindow, ipcMain, app } = require('electron');
const path  = require('path');
const log   = require('./updateLogger');

// Compare deux versions semver — retourne true si b > a STRICTEMENT
function _isNewer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (nb > na) return true;
    if (nb < na) return false;
  }
  return false; // égaux → pas de mise à jour
}

/* ══════════════════════════════════════════════════════════════
   CONFIGURATION electron-updater
══════════════════════════════════════════════════════════════ */

function configureUpdater() {
  // Brancher le logger dédié
  autoUpdater.logger = log;

  // Purger le cache updater au démarrage pour éviter la boucle infinie.
  // electron-updater garde le .exe téléchargé dans userData/pending/.
  // Au redémarrage post-install, il le trouve et re-déclenche update-downloaded.
  try {
    const pendingDir = path.join(app.getPath('userData'), '..', 'discowl-browser-updater', 'pending');
    const altDir     = path.join(app.getPath('userData'), 'pending');
    for (const dir of [pendingDir, altDir]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        log.info('[Updater] Cache pending supprimé:', dir);
      }
    }
  } catch (e) {
    log.warn('[Updater] Impossible de purger le cache:', e.message);
  }

  // Désactiver le téléchargement automatique :
  // on gère la progression manuellement pour l'afficher dans le splash
  autoUpdater.autoDownload = false;

  // Ne pas installer silencieusement au quit en phase 1 (splash)
  // On gère l'installation manuellement pour afficher un état propre
  autoUpdater.autoInstallOnAppQuit = false;

  // Forcer HTTPS — electron-updater le fait nativement via GitHub Releases
  // mais on logue pour traçabilité
  log.info('[Updater] Configuration initialisée — channel:', autoUpdater.channel || 'latest');
}

/* ══════════════════════════════════════════════════════════════
   FENÊTRE SPLASH
══════════════════════════════════════════════════════════════ */

let splashWin = null;
let _onDone   = null;

function createSplash() {
  splashWin = new BrowserWindow({
    width:           460,
    height:          280,
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
      sandbox:          false,
    }
  });

  splashWin.loadFile(path.join(__dirname, '../renderer/updater.html'));
  splashWin.once('ready-to-show', () => splashWin?.show());
  splashWin.on('closed', () => { splashWin = null; });
}

function sendToSplash(type, payload = {}) {
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.webContents.send('updater:status', { type, ...payload });
  }
}

function closeSplashAndLaunch(delay = 600) {
  setTimeout(() => {
    if (splashWin && !splashWin.isDestroyed()) {
      splashWin.close();
      splashWin = null;
    }
    _onDone?.();
  }, delay);
}

/* ══════════════════════════════════════════════════════════════
   PHASE 1 — VÉRIFICATION AU DÉMARRAGE (bloquante, avec splash)
══════════════════════════════════════════════════════════════ */

function runUpdater(onDone) {
  _onDone = onDone;

  // Environnement développement → lancement immédiat
  if (!app.isPackaged) {
    log.info('[Updater] Mode dev — skip update check');
    onDone();
    return;
  }

  configureUpdater();
  createSplash();

  splashWin.webContents.once('did-finish-load', () => {
    _runStartupCheck();
  });
}

function _runStartupCheck() {
  log.info('[Updater] Démarrage — vérification de mise à jour...');
  sendToSplash('checking');

  // Timeout de sécurité : si le check dépasse 15s (réseau lent/absent), on lance quand même
  const networkTimeout = setTimeout(() => {
    log.warn('[Updater] Check timeout — lancement sans mise à jour');
    sendToSplash('timeout');
    closeSplashAndLaunch(400);
  }, 15000);

  // Écouter les événements electron-updater pour ce check de démarrage
  const cleanup = _bindStartupEvents(networkTimeout);

  autoUpdater.checkForUpdates().catch(err => {
    clearTimeout(networkTimeout);
    cleanup();
    log.error('[Updater] checkForUpdates error:', err.message);
    sendToSplash('error', { message: err.message });
    closeSplashAndLaunch(800);
  });
}

function _bindStartupEvents(networkTimeout) {
  // Retourne une fonction cleanup pour détacher les listeners après usage

  function onNotAvailable(info) {
    clearTimeout(networkTimeout);
    cleanup();
    log.info('[Updater] À jour — version', app.getVersion());
    sendToSplash('not-available');
    closeSplashAndLaunch(700);
  }

  function onAvailable(info) {
    clearTimeout(networkTimeout);
    log.info('[Updater] Mise à jour disponible —', info.version);

    // Vérification anti-boucle : la version disponible doit être
    // STRICTEMENT supérieure à la version courante installée.
    const current = app.getVersion().replace(/^v/, '');
    const available = (info.version || '').replace(/^v/, '');
    if (!_isNewer(current, available)) {
      log.info('[Updater] Version disponible', available, '<= version courante', current, '— skip');
      sendToSplash('not-available');
      closeSplashAndLaunch(700);
      cleanup();
      return;
    }

    sendToSplash('available', { version: info.version, releaseNotes: info.releaseNotes });

    // Démarrer le téléchargement
    autoUpdater.downloadUpdate().catch(err => {
      cleanup();
      log.error('[Updater] Download error:', err.message);
      sendToSplash('error', { message: err.message });
      closeSplashAndLaunch(800);
    });
  }

  function onProgress(progress) {
    sendToSplash('progress', {
      percent:       Math.round(progress.percent),
      bytesPerSecond:progress.bytesPerSecond,
      transferred:   progress.transferred,
      total:         progress.total,
    });
  }

  function onDownloaded(info) {
    cleanup();
    log.info('[Updater] Téléchargement terminé —', info.version);
    sendToSplash('downloaded', { version: info.version });

    // Laisser l'UI afficher "Installing…" puis installer
    setTimeout(() => {
      log.info('[Updater] Installation en cours...');
      // setImmediateFeedback avant de quitter
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.quitAndInstall(
        /* isSilent */ true,
        /* isForceRunAfter */ true  // relancer l'app après install
      );
    }, 1800);
  }

  function onError(err) {
    clearTimeout(networkTimeout);
    cleanup();
    log.error('[Updater] Erreur:', err.message);
    sendToSplash('error', { message: err.message });
    closeSplashAndLaunch(800);
  }

  autoUpdater.on('update-not-available', onNotAvailable);
  autoUpdater.on('update-available',     onAvailable);
  autoUpdater.on('download-progress',    onProgress);
  autoUpdater.on('update-downloaded',    onDownloaded);
  autoUpdater.on('error',                onError);

  function cleanup() {
    autoUpdater.removeListener('update-not-available', onNotAvailable);
    autoUpdater.removeListener('update-available',     onAvailable);
    autoUpdater.removeListener('download-progress',    onProgress);
    autoUpdater.removeListener('update-downloaded',    onDownloaded);
    autoUpdater.removeListener('error',                onError);
  }

  return cleanup;
}

/* ══════════════════════════════════════════════════════════════
   PHASE 2 — VÉRIFICATION EN ARRIÈRE-PLAN (non-bloquante)
   Démarre après que l'app principale est ouverte.
   Toutes les 4h + au démarrage après 30s.
══════════════════════════════════════════════════════════════ */

const BACKGROUND_CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 heures
const BACKGROUND_INITIAL_DELAY  = 30 * 1000;           // 30s après lancement
let _bgCheckTimer    = null;
let _bgCheckInterval = null;
let _mainWindowRef   = null;  // injecté depuis main.js

function startBackgroundChecks(mainWindow) {
  if (!app.isPackaged) return;

  _mainWindowRef = mainWindow;

  // Premier check 30s après lancement (app complètement prête)
  _bgCheckTimer = setTimeout(() => {
    _backgroundCheck();
    // Puis toutes les 4h
    _bgCheckInterval = setInterval(_backgroundCheck, BACKGROUND_CHECK_INTERVAL);
  }, BACKGROUND_INITIAL_DELAY);
}

function stopBackgroundChecks() {
  if (_bgCheckTimer)    clearTimeout(_bgCheckTimer);
  if (_bgCheckInterval) clearInterval(_bgCheckInterval);
}

function _backgroundCheck() {
  log.info('[Updater] Vérification arrière-plan...');

  // Listener unique pour ce check — ne pas polluer avec des listeners permanents
  let handled = false;

  function onAvailable(info) {
    if (handled) return;
    handled = true;
    cleanup();
    log.info('[Updater] MAJ disponible en arrière-plan —', info.version);

    // Notifier l'app principale via IPC (toast non-intrusif)
    if (_mainWindowRef && !_mainWindowRef.isDestroyed()) {
      _mainWindowRef.webContents.send('updater:update-available', {
        version:      info.version,
        releaseNotes: info.releaseNotes,
      });
    }
  }

  function onNotAvailable() {
    if (handled) return;
    handled = true;
    cleanup();
    log.info('[Updater] Arrière-plan : déjà à jour');
  }

  function onError(err) {
    if (handled) return;
    handled = true;
    cleanup();
    log.warn('[Updater] Arrière-plan erreur (silencieuse):', err.message);
    // Pas de notification — échec silencieux en arrière-plan
  }

  autoUpdater.on('update-available',     onAvailable);
  autoUpdater.on('update-not-available', onNotAvailable);
  autoUpdater.on('error',                onError);

  function cleanup() {
    autoUpdater.removeListener('update-available',     onAvailable);
    autoUpdater.removeListener('update-not-available', onNotAvailable);
    autoUpdater.removeListener('error',                onError);
  }

  autoUpdater.checkForUpdates().catch(err => {
    onError(err);
  });
}

/* ══════════════════════════════════════════════════════════════
   TÉLÉCHARGEMENT ARRIÈRE-PLAN (déclenché par l'utilisateur
   depuis la notification toast)
══════════════════════════════════════════════════════════════ */

let _downloadProgress = null; // { percent, bytesPerSecond, transferred, total }
let _isDownloading    = false;

function startBackgroundDownload(mainWindow) {
  if (_isDownloading) return;
  _isDownloading = true;
  _mainWindowRef = mainWindow;

  log.info('[Updater] Téléchargement arrière-plan démarré');

  function onProgress(progress) {
    _downloadProgress = {
      percent:       Math.round(progress.percent),
      bytesPerSecond:progress.bytesPerSecond,
      transferred:   progress.transferred,
      total:         progress.total,
    };
    if (_mainWindowRef && !_mainWindowRef.isDestroyed()) {
      _mainWindowRef.webContents.send('updater:download-progress', _downloadProgress);
    }
  }

  function onDownloaded(info) {
    cleanup();
    _isDownloading = false;
    log.info('[Updater] Téléchargement terminé —', info.version);
    if (_mainWindowRef && !_mainWindowRef.isDestroyed()) {
      _mainWindowRef.webContents.send('updater:update-ready', { version: info.version });
    }
  }

  function onError(err) {
    cleanup();
    _isDownloading = false;
    log.error('[Updater] Erreur téléchargement arrière-plan:', err.message);
    if (_mainWindowRef && !_mainWindowRef.isDestroyed()) {
      _mainWindowRef.webContents.send('updater:download-error', { message: err.message });
    }
  }

  autoUpdater.on('download-progress', onProgress);
  autoUpdater.on('update-downloaded', onDownloaded);
  autoUpdater.on('error',             onError);

  function cleanup() {
    autoUpdater.removeListener('download-progress', onProgress);
    autoUpdater.removeListener('update-downloaded', onDownloaded);
    autoUpdater.removeListener('error',             onError);
  }

  autoUpdater.downloadUpdate().catch(onError);
}

/* ══════════════════════════════════════════════════════════════
   IPC — HANDLERS (enregistrés dans main.js via registerIpc())
══════════════════════════════════════════════════════════════ */

function registerIpc(getMainWindow) {
  // Check manuel depuis Settings
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      return { upToDate: true, current: app.getVersion(), dev: true };
    }

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ upToDate: true, error: 'timeout', current: app.getVersion() });
        }
      }, 12000);

      function onAvailable(info) {
        if (resolved) return;
        const cur = app.getVersion().replace(/^v/, '');
        const avail = (info.version || '').replace(/^v/, '');
        if (!_isNewer(cur, avail)) {
          // Anti-boucle : déjà à jour
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          resolve({ upToDate: true, current: app.getVersion() });
          return;
        }
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        resolve({ upToDate: false, latest: info.version, current: app.getVersion() });
      }

      function onNotAvailable() {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        resolve({ upToDate: true, current: app.getVersion() });
      }

      function onError(err) {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        resolve({ upToDate: true, error: err.message, current: app.getVersion() });
      }

      autoUpdater.on('update-available',     onAvailable);
      autoUpdater.on('update-not-available', onNotAvailable);
      autoUpdater.on('error',                onError);

      function cleanup() {
        autoUpdater.removeListener('update-available',     onAvailable);
        autoUpdater.removeListener('update-not-available', onNotAvailable);
        autoUpdater.removeListener('error',                onError);
      }

      autoUpdater.checkForUpdates().catch(onError);
    });
  });

  // Démarrer le téléchargement depuis la notification toast
  ipcMain.handle('update:download', () => {
    const win = getMainWindow?.();
    if (win) startBackgroundDownload(win);
    return true;
  });

  // Installer maintenant (redémarre l'app)
  ipcMain.handle('update:install', () => {
    log.info('[Updater] Installation demandée par l\'utilisateur');
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.quitAndInstall(true, true);
    return true;
  });

  // Remettre à plus tard (ferme la notification)
  ipcMain.handle('update:defer', () => {
    log.info('[Updater] Mise à jour reportée par l\'utilisateur');
    return true;
  });
}

module.exports = { runUpdater, registerIpc, startBackgroundChecks, stopBackgroundChecks };