'use strict';

/**
 * updater.js — Système de mise à jour production — Discowl Browser
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  ARCHITECTURE                                                    │
 * │                                                                  │
 * │  Phase 1 — DÉMARRAGE (bloquant, splash)                         │
 * │    Splash → checkForUpdates()                                    │
 * │    ├── À jour        → fermer splash → lancer app               │
 * │    ├── MAJ dispo     → télécharger → installer → relancer        │
 * │    └── Erreur/Timeout→ fermer splash → lancer app               │
 * │                                                                  │
 * │  Phase 2 — ARRIÈRE-PLAN (non-bloquant, toutes les 4h)           │
 * │    Background check → si MAJ → toast dans l'app                 │
 * │    Toast → [Télécharger] → barre de progression dans l'app      │
 * │    Barre → [Installer maintenant] → redémarrer                  │
 * │                                     [Plus tard]  → fermer       │
 * │                                     [Annuler]    → stopper DL   │
 * │                                                                  │
 * │  Sécurité :                                                      │
 * │    ─ electron-updater vérifie SHA512 via latest.yml              │
 * │    ─ HTTPS imposé (GitHub Releases)                              │
 * │    ─ Semver strict anti-boucle                                   │
 * │    ─ Purge cache pending au démarrage                            │
 * │    ─ CancellationToken pour annulation propre                    │
 * └─────────────────────────────────────────────────────────────────┘
 */

const { autoUpdater, CancellationToken } = require('electron-updater');
const { BrowserWindow, ipcMain, app }    = require('electron');
const path = require('path');
const fs   = require('fs');
const log  = require('./updateLogger');

/* ══════════════════════════════════════════════════════════════════
   SEMVER — comparaison stricte
══════════════════════════════════════════════════════════════════ */

function _isNewer(current, candidate) {
  const pa = String(current  || '0').replace(/^v/, '').split('.').map(Number);
  const pb = String(candidate|| '0').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pb[i] || 0) > (pa[i] || 0)) return true;
    if ((pb[i] || 0) < (pa[i] || 0)) return false;
  }
  return false; // strictement égal = pas de MAJ
}

/* ══════════════════════════════════════════════════════════════════
   ÉTAT GLOBAL
══════════════════════════════════════════════════════════════════ */

let _mainWindowRef     = null;  // référence à la fenêtre principale
let _splashWin         = null;  // fenêtre splash de démarrage
let _onDone            = null;  // callback après splash

// État téléchargement arrière-plan
let _dlToken       = null;   // CancellationToken courant
let _dlState       = 'idle'; // 'idle' | 'downloading' | 'paused' | 'ready'
let _dlVersion     = null;   // version en cours de téléchargement
let _dlPausedPct   = 0;      // % au moment de la pause (pour affichage)

// Timers arrière-plan
let _bgTimer    = null;
let _bgInterval = null;

const BACKGROUND_INITIAL_DELAY  = 30_000;        // 30s après lancement
const BACKGROUND_CHECK_INTERVAL = 4 * 3600_000;  // 4 heures

/* ══════════════════════════════════════════════════════════════════
   CONFIGURATION electron-updater
══════════════════════════════════════════════════════════════════ */

function _configure() {
  autoUpdater.logger = log;

  // Pas de téléchargement auto — on gère manuellement
  autoUpdater.autoDownload         = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Purger le dossier pending/ pour éviter la boucle infinie
  // (electron-updater y stocke le .exe et le re-détecte au démarrage)
  _purgePendingCache();

  log.info('[Updater] Configuré — channel:', autoUpdater.channel || 'latest');
}

function _purgePendingCache() {
  const dirs = [
    path.join(app.getPath('userData'), '..', 'discowl-browser-updater', 'pending'),
    path.join(app.getPath('userData'), 'pending'),
  ];
  for (const dir of dirs) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        log.info('[Updater] Cache pending purgé:', dir);
      }
    } catch (e) {
      log.warn('[Updater] Impossible de purger cache:', e.message);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════
   FENÊTRE SPLASH
══════════════════════════════════════════════════════════════════ */

function _createSplash() {
  _splashWin = new BrowserWindow({
    width:           480,
    height:          300,
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
    },
  });

  _splashWin.loadFile(path.join(__dirname, '../renderer/updater.html'));
  _splashWin.once('ready-to-show', () => _splashWin?.show());
  _splashWin.on('closed', () => { _splashWin = null; });
}

function _sendSplash(type, payload = {}) {
  if (_splashWin && !_splashWin.isDestroyed()) {
    _splashWin.webContents.send('updater:status', { type, ...payload });
  }
}

function _closeSplash(delay = 600) {
  setTimeout(() => {
    if (_splashWin && !_splashWin.isDestroyed()) {
      _splashWin.close();
      _splashWin = null;
    }
    _onDone?.();
    _onDone = null;
  }, delay);
}

/* ══════════════════════════════════════════════════════════════════
   PHASE 1 — CHECK AU DÉMARRAGE
   Bloquant — le splash s'affiche pendant la vérification.
   Si MAJ → téléchargement direct → installation → relance.
   Si OK  → ferme le splash et lance l'app immédiatement.
══════════════════════════════════════════════════════════════════ */

function runUpdater(onDone) {
  _onDone = onDone;

  if (!app.isPackaged) {
    log.info('[Updater] Mode dev — skip');
    onDone();
    return;
  }

  _configure();
  _createSplash();

  _splashWin.webContents.once('did-finish-load', _startupCheck);
}

function _startupCheck() {
  log.info('[Updater] Check démarrage...');
  _sendSplash('checking');

  // Timeout réseau : si aucune réponse en 15s, on lance quand même
  const netTimeout = setTimeout(() => {
    log.warn('[Updater] Timeout réseau — lancement sans MAJ');
    _sendSplash('timeout');
    _closeSplash(400);
  }, 15_000);

  const cleanup = _bindSplashListeners(netTimeout);

  autoUpdater.checkForUpdates().catch(err => {
    clearTimeout(netTimeout);
    cleanup();
    log.error('[Updater] checkForUpdates:', err.message);
    _sendSplash('error', { message: err.message });
    _closeSplash(800);
  });
}

function _bindSplashListeners(netTimeout) {
  const current = app.getVersion().replace(/^v/, '');

  function onNotAvailable() {
    clearTimeout(netTimeout);
    cleanup();
    log.info('[Updater] À jour —', current);
    _sendSplash('not-available');
    _closeSplash(700);
  }

  function onAvailable(info) {
    clearTimeout(netTimeout);

    // Guard anti-boucle : version doit être STRICTEMENT supérieure
    const candidate = (info.version || '').replace(/^v/, '');
    if (!_isNewer(current, candidate)) {
      log.info('[Updater] Version', candidate, '<= courante', current, '— skip');
      cleanup();
      _sendSplash('not-available');
      _closeSplash(700);
      return;
    }

    log.info('[Updater] MAJ disponible:', candidate);
    _sendSplash('available', { version: info.version });

    // Lancer le téléchargement avec CancellationToken
    const token = new CancellationToken();
    _dlToken   = token;
    _dlVersion = candidate;

    autoUpdater.downloadUpdate(token).catch(err => {
      if (token.cancelled) return; // annulation intentionnelle → ignorer
      cleanup();
      log.error('[Updater] Téléchargement splash:', err.message);
      _sendSplash('error', { message: err.message });
      _closeSplash(800);
    });
  }

  function onProgress(progress) {
    _sendSplash('progress', {
      percent:        Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred:    progress.transferred,
      total:          progress.total,
    });
  }

  function onDownloaded(info) {
    cleanup();
    _dlToken = null;
    log.info('[Updater] Téléchargement terminé:', info.version);
    _sendSplash('downloaded', { version: info.version });

    // Laisser l'UI afficher "Installing…" 1.8s puis installer
    setTimeout(() => {
      log.info('[Updater] Installation...');
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.quitAndInstall(/* silent */ true, /* runAfter */ true);
    }, 1800);
  }

  function onError(err) {
    clearTimeout(netTimeout);
    cleanup();
    log.error('[Updater] Erreur splash:', err.message);
    _sendSplash('error', { message: err.message });
    _closeSplash(800);
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

/* ══════════════════════════════════════════════════════════════════
   PHASE 2 — VÉRIFICATIONS EN ARRIÈRE-PLAN
   Non-bloquant. Démarre 30s après l'ouverture de l'app.
   Notifie la fenêtre principale via IPC si MAJ trouvée.
══════════════════════════════════════════════════════════════════ */

function startBackgroundChecks(mainWindow) {
  if (!app.isPackaged) return;
  _mainWindowRef = mainWindow;

  _bgTimer = setTimeout(() => {
    _backgroundCheck();
    _bgInterval = setInterval(_backgroundCheck, BACKGROUND_CHECK_INTERVAL);
  }, BACKGROUND_INITIAL_DELAY);
}

function stopBackgroundChecks() {
  if (_bgTimer)    clearTimeout(_bgTimer);
  if (_bgInterval) clearInterval(_bgInterval);
  _bgTimer    = null;
  _bgInterval = null;
}

function _backgroundCheck() {
  // Ne pas checker si un téléchargement est en cours
  if (_dlState === 'downloading' || _dlState === 'ready') return;

  log.info('[Updater] Check arrière-plan...');
  let done = false;

  function onAvailable(info) {
    if (done) return;
    done = true; cleanup();
    const candidate = (info.version || '').replace(/^v/, '');
    const current   = app.getVersion().replace(/^v/, '');
    if (!_isNewer(current, candidate)) return;
    log.info('[Updater] Arrière-plan — MAJ:', candidate);
    _dlVersion = candidate;
    _notify({ type: 'updater:update-available', version: info.version, releaseNotes: info.releaseNotes });
  }

  function onNotAvailable() {
    if (done) return;
    done = true; cleanup();
    log.info('[Updater] Arrière-plan — déjà à jour');
  }

  function onError(err) {
    if (done) return;
    done = true; cleanup();
    log.warn('[Updater] Arrière-plan — erreur silencieuse:', err.message);
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
   TÉLÉCHARGEMENT EN ARRIÈRE-PLAN
   Déclenché par l'utilisateur depuis la notification toast.
   Envoie la progression à la fenêtre principale.
══════════════════════════════════════════════════════════════════ */

function _startBackgroundDownload() {
  if (_dlState === 'downloading') return;
  _dlState = 'downloading';
  log.info('[Updater] Téléchargement arrière-plan démarré');

  const token = new CancellationToken();
  _dlToken = token;

  let smoothSpeed = 0;
  let lastBytes   = 0;
  let lastTime    = Date.now();

  function onProgress(progress) {
    if (_dlState !== 'downloading') return;

    // EMA sur la vitesse pour éviter les sauts
    const now = Date.now();
    const dt  = (now - lastTime) / 1000;
    if (dt > 0.3) {
      const rawSpeed = (progress.transferred - lastBytes) / dt;
      smoothSpeed = smoothSpeed * 0.65 + rawSpeed * 0.35;
      lastBytes = progress.transferred;
      lastTime  = now;
    }

    _notify({
      type:           'updater:download-progress',
      percent:        Math.round(progress.percent),
      bytesPerSecond: Math.round(smoothSpeed),
      transferred:    progress.transferred,
      total:          progress.total,
      version:        _dlVersion,
    });
  }

  function onDownloaded(info) {
    cleanup();
    _dlToken = null;
    _dlState = 'ready';
    log.info('[Updater] Téléchargement arrière-plan terminé:', info.version);
    _notify({ type: 'updater:update-ready', version: info.version });
  }

  function onError(err) {
    if (token.cancelled) {
      // Annulation demandée par l'utilisateur → état idle ou paused
      log.info('[Updater] Téléchargement annulé par l\'utilisateur');
      return;
    }
    cleanup();
    _dlToken = null;
    _dlState = 'idle';
    log.error('[Updater] Erreur téléchargement arrière-plan:', err.message);
    _notify({ type: 'updater:download-error', message: err.message });
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
  if (_dlToken) {
    _dlToken.cancel();
    _dlToken = null;
  }
  _dlState   = 'idle';
  _dlPausedPct = 0;
}

function _pauseDownload() {
  // electron-updater ne supporte pas la vraie reprise depuis un offset.
  // On annule le téléchargement et on mémorise l'état "paused".
  // À la reprise, le téléchargement redémarre (electron-updater utilise
  // le blockmap différentiel → redémarre rapidement depuis le cache).
  if (_dlState !== 'downloading' || !_dlToken) return;
  _dlToken.cancel();
  _dlToken    = null;
  _dlState    = 'paused';
  log.info('[Updater] Téléchargement mis en pause');
  _notify({ type: 'updater:download-paused', version: _dlVersion });
}

function _resumeDownload() {
  if (_dlState !== 'paused') return;
  log.info('[Updater] Reprise du téléchargement');
  _startBackgroundDownload();
}

/* ══════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════ */

function _notify(payload) {
  if (_mainWindowRef && !_mainWindowRef.isDestroyed()) {
    _mainWindowRef.webContents.send(payload.type, payload);
  }
}

/* ══════════════════════════════════════════════════════════════════
   IPC — HANDLERS (enregistrés depuis main.js)
══════════════════════════════════════════════════════════════════ */

function registerIpc(getMainWindow) {

  /* ── Vérification manuelle depuis Settings ── */
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      return { upToDate: true, current: app.getVersion(), dev: true };
    }

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
    if (win) _mainWindowRef = win;
    if (_dlState === 'paused') {
      _resumeDownload();
    } else {
      _startBackgroundDownload();
    }
    return { started: true, state: _dlState };
  });

  /* ── Mettre en pause ── */
  ipcMain.handle('update:pause', () => {
    _pauseDownload();
    return { state: _dlState };
  });

  /* ── Reprendre ── */
  ipcMain.handle('update:resume', () => {
    _resumeDownload();
    return { state: _dlState };
  });

  /* ── Annuler ── */
  ipcMain.handle('update:cancel', () => {
    _cancelDownload();
    return { state: _dlState };
  });

  /* ── Installer maintenant ── */
  ipcMain.handle('update:install', () => {
    if (_dlState !== 'ready') return { error: 'not_ready' };
    log.info('[Updater] Installation demandée par l\'utilisateur');
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.quitAndInstall(/* silent */ true, /* runAfter */ true);
    return { ok: true };
  });

  /* ── Différer (fermer la notification) ── */
  ipcMain.handle('update:defer', () => {
    log.info('[Updater] MAJ reportée par l\'utilisateur');
    // Garde l'état — la notification réapparaîtra au prochain check
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