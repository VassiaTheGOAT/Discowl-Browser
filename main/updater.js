'use strict';

/**
 * updater.js — Système de mise à jour Discowl Browser
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  ARCHITECTURE                                                     │
 * │                                                                   │
 * │  L'app démarre IMMÉDIATEMENT — zéro splash bloquant.             │
 * │                                                                   │
 * │  Phase 1 — CHECK SILENCIEUX (8s après le démarrage)              │
 * │    background check → si MAJ → barre update dans l'app           │
 * │    puis toutes les 4h                                             │
 * │                                                                   │
 * │  Phase 2 — TÉLÉCHARGEMENT (déclenché par l'utilisateur)          │
 * │    download-progress → barre de progression dans l'app           │
 * │    update-downloaded → bouton "Redémarrer et installer"          │
 * │    install           → quitAndInstall() → NSIS prend la main     │
 * │                                                                   │
 * │  Pourquoi pas de splash ?                                         │
 * │    Electron-updater sur Windows utilise NSIS : il télécharge un  │
 * │    .exe installeur, l'app se ferme, NSIS désinstalle/réinstalle, │
 * │    l'app redémarre. L'app est MORTE pendant l'install → impossible│
 * │    d'afficher quoi que ce soit à ce moment. Seul le              │
 * │    téléchargement est visible — on l'affiche dans l'app.          │
 * └──────────────────────────────────────────────────────────────────┘
 */

const { autoUpdater, CancellationToken } = require('electron-updater');
const { ipcMain, app }                   = require('electron');
const path = require('path');
const fs   = require('fs');
const log  = require('./updateLogger');

/* ══════════════════════════════════════════════════════════════════
   SEMVER — comparaison stricte anti-boucle
══════════════════════════════════════════════════════════════════ */

function _isNewer(current, candidate) {
  const pa = String(current   || '0').replace(/^v/, '').split('.').map(Number);
  const pb = String(candidate || '0').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pb[i] || 0) > (pa[i] || 0)) return true;
    if ((pb[i] || 0) < (pa[i] || 0)) return false;
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════════
   ÉTAT GLOBAL
══════════════════════════════════════════════════════════════════ */

let _mainWin   = null;
let _dlToken   = null;
let _dlState   = 'idle'; // 'idle' | 'downloading' | 'ready'
let _dlVersion = null;

let _bgTimer    = null;
let _bgInterval = null;

const INITIAL_DELAY  =      8_000;
const CHECK_INTERVAL = 4 * 3600_000;

/* ══════════════════════════════════════════════════════════════════
   CONFIGURATION electron-updater
══════════════════════════════════════════════════════════════════ */

function _configure() {
  autoUpdater.logger = log;
  autoUpdater.autoDownload         = false;
  autoUpdater.autoInstallOnAppQuit = false;
  _purgePendingCache();
  log.info('[Updater] Configuré — channel:', autoUpdater.channel || 'latest');
}

function _purgePendingCache() {
  const current = app.getVersion().replace(/^v/, '');
  const dirs = [
    path.join(app.getPath('userData'), '..', 'discowl-browser-updater', 'pending'),
    path.join(app.getPath('userData'), 'pending'),
  ];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const ymlPath = path.join(dir, 'latest.yml');
      let cachedVersion = null;
      if (fs.existsSync(ymlPath)) {
        const yml = fs.readFileSync(ymlPath, 'utf8');
        const m   = yml.match(/^version:\s*([\d.]+)/m);
        if (m) cachedVersion = m[1].replace(/^v/, '');
      }
      if (cachedVersion && _isNewer(current, cachedVersion)) {
        log.info('[Updater] Cache pending conservé —', cachedVersion, '>', current);
      } else {
        fs.rmSync(dir, { recursive: true, force: true });
        log.info('[Updater] Cache pending purgé (', cachedVersion || '?', '<=', current, ')');
      }
    } catch (e) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      log.warn('[Updater] Cache pending — purge forcée:', e.message);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════
   ENTRÉE PRINCIPALE — démarrage immédiat, zéro splash
══════════════════════════════════════════════════════════════════ */

function runUpdater(onDone) {
  if (!app.isPackaged) {
    log.info('[Updater] Mode dev — skip');
    onDone();
    return;
  }
  _configure();
  onDone(); // l'app s'ouvre immédiatement
}

/* ══════════════════════════════════════════════════════════════════
   CHECKS EN ARRIÈRE-PLAN
══════════════════════════════════════════════════════════════════ */

function startBackgroundChecks(mainWindow) {
  if (!app.isPackaged) return;
  _mainWin = mainWindow;
  _bgTimer = setTimeout(() => {
    _backgroundCheck();
    _bgInterval = setInterval(_backgroundCheck, CHECK_INTERVAL);
  }, INITIAL_DELAY);
}

function stopBackgroundChecks() {
  if (_bgTimer)    clearTimeout(_bgTimer);
  if (_bgInterval) clearInterval(_bgInterval);
  _bgTimer = _bgInterval = null;
}

function _backgroundCheck() {
  if (_dlState === 'downloading' || _dlState === 'ready') return;
  log.info('[Updater] Background check...');
  let done = false;
  const current = app.getVersion().replace(/^v/, '');

  function onAvailable(info) {
    if (done) return;
    done = true; cleanup();
    const candidate = (info.version || '').replace(/^v/, '');
    if (!_isNewer(current, candidate)) return;
    log.info('[Updater] MAJ disponible:', candidate);
    _dlVersion = candidate;
    _notify('updater:update-available', {
      version:      info.version,
      releaseNotes: info.releaseNotes || null,
    });
  }

  function onNotAvailable() {
    if (done) return;
    done = true; cleanup();
    log.info('[Updater] Déjà à jour');
  }

  function onError(err) {
    if (done) return;
    done = true; cleanup();
    log.warn('[Updater] Erreur background silencieuse:', err.message);
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
}

/* ══════════════════════════════════════════════════════════════════
   TÉLÉCHARGEMENT
══════════════════════════════════════════════════════════════════ */

function _startDownload() {
  if (_dlState === 'downloading') return;
  _dlState = 'downloading';
  log.info('[Updater] Téléchargement démarré — version:', _dlVersion);

  const token = new CancellationToken();
  _dlToken = token;

  let smoothSpeed = 0, lastBytes = 0, lastTime = Date.now();

  function onProgress(p) {
    if (_dlState !== 'downloading') return;
    const now = Date.now(), dt = (now - lastTime) / 1000;
    if (dt > 0.25) {
      const raw = (p.transferred - lastBytes) / dt;
      smoothSpeed = smoothSpeed * 0.65 + raw * 0.35;
      lastBytes = p.transferred;
      lastTime  = now;
    }
    _notify('updater:download-progress', {
      percent:        Math.max(0, Math.min(100, Math.round(p.percent || 0))),
      bytesPerSecond: Math.round(smoothSpeed),
      transferred:    p.transferred,
      total:          p.total,
      version:        _dlVersion,
    });
  }

  function onDownloaded(info) {
    cleanup();
    _dlToken = null;
    _dlState = 'ready';
    log.info('[Updater] Téléchargement terminé:', info.version);
    _notify('updater:update-ready', { version: info.version });
  }

  function onError(err) {
    if (token.cancelled) {
      log.info('[Updater] Téléchargement annulé par l\'utilisateur');
      return;
    }
    cleanup();
    _dlToken = null;
    _dlState = 'idle';
    log.error('[Updater] Erreur téléchargement:', err.message);
    _notify('updater:download-error', { message: err.message });
  }

  autoUpdater.on('download-progress', onProgress);
  autoUpdater.on('update-downloaded', onDownloaded);
  autoUpdater.on('error',             onError);

  function cleanup() {
    autoUpdater.removeListener('download-progress', onProgress);
    autoUpdater.removeListener('update-downloaded', onDownloaded);
    autoUpdater.removeListener('error',             onError);
  }

  autoUpdater.downloadUpdate(token).catch(onError);
}

function _cancelDownload() {
  if (_dlToken) { _dlToken.cancel(); _dlToken = null; }
  _dlState = 'idle';
  log.info('[Updater] Téléchargement annulé');
}

/* ══════════════════════════════════════════════════════════════════
   HELPER — notifier le renderer
══════════════════════════════════════════════════════════════════ */

function _notify(channel, payload = {}) {
  if (_mainWin && !_mainWin.isDestroyed()) {
    _mainWin.webContents.send(channel, payload);
  }
}

/* ══════════════════════════════════════════════════════════════════
   IPC — HANDLERS
══════════════════════════════════════════════════════════════════ */

function registerIpc(getMainWindow) {

  /* ── Vérification manuelle ── */
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return { upToDate: true, current: app.getVersion(), dev: true };

    return new Promise((resolve) => {
      let done = false;
      const current = app.getVersion().replace(/^v/, '');

      const timeout = setTimeout(() => {
        if (!done) { done = true; cleanup(); resolve({ upToDate: true, error: 'timeout', current: app.getVersion() }); }
      }, 12_000);

      function onAvailable(info) {
        if (done) return;
        const candidate = (info.version || '').replace(/^v/, '');
        done = true; clearTimeout(timeout); cleanup();
        if (!_isNewer(current, candidate)) {
          resolve({ upToDate: true, current: app.getVersion() });
        } else {
          _dlVersion = candidate;
          resolve({ upToDate: false, latest: info.version, current: app.getVersion() });
        }
      }
      function onNotAvailable() {
        if (!done) { done = true; clearTimeout(timeout); cleanup(); resolve({ upToDate: true, current: app.getVersion() }); }
      }
      function onError(err) {
        if (!done) { done = true; clearTimeout(timeout); cleanup(); resolve({ upToDate: true, error: err.message, current: app.getVersion() }); }
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

  /* ── Démarrer le téléchargement ── */
  ipcMain.handle('update:download', () => {
    const win = getMainWindow?.();
    if (win) _mainWin = win;
    _startDownload();
    return { started: true, state: _dlState };
  });

  /* ── Annuler ── */
  ipcMain.handle('update:cancel', () => {
    _cancelDownload();
    return { state: _dlState };
  });

  /* ── Pause / Resume — no-op (NSIS ne supporte pas la vraie pause).
         On renvoie l'état pour que le renderer ne crashe pas. ── */
  ipcMain.handle('update:pause',  () => ({ state: _dlState }));
  ipcMain.handle('update:resume', () => {
    // Traiter "resume" comme un download si on était en idle après annulation
    if (_dlState === 'idle' && _dlVersion) _startDownload();
    return { state: _dlState };
  });

  /* ── Installer (NSIS prend la main, app se ferme) ── */
  ipcMain.handle('update:install', () => {
    if (_dlState !== 'ready') return { error: 'not_ready' };
    log.info('[Updater] Installation — lancement NSIS...');
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  });

  /* ── Différer ── */
  ipcMain.handle('update:defer', () => {
    log.info('[Updater] MAJ reportée');
    return { deferred: true };
  });

  /* ── État courant ── */
  ipcMain.handle('update:state', () => ({
    state:   _dlState,
    version: _dlVersion,
    current: app.getVersion(),
  }));
}

/* ══════════════════════════════════════════════════════════════════
   EXPORTS
══════════════════════════════════════════════════════════════════ */

module.exports = {
  runUpdater,
  registerIpc,
  startBackgroundChecks,
  stopBackgroundChecks,
};
