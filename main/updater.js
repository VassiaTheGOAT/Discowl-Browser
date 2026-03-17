'use strict';

/**
 * updater.js — Système de mise à jour maison
 *
 * Pas d'electron-updater. Approche directe :
 *  1. Appel GitHub Releases API → latest release
 *  2. Compare avec app.getVersion()
 *  3. Si nouvelle version → télécharge le .exe via https natif Node
 *  4. Lance le .exe en arrière-plan → quitte l'app
 *  5. Si pas de MAJ ou erreur → ouvre l'app normalement
 */

const { BrowserWindow, ipcMain, app } = require('electron');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { spawn } = require('child_process');

// ── Config GitHub ─────────────────────────────────────────────
// À ajuster si le repo change
const GH_OWNER = 'VassiaTheGOAT';
const GH_REPO  = 'Discowl-Browser';

// ── State ─────────────────────────────────────────────────────
let splashWin  = null;
let _onDone    = null;

// ── Helpers ──────────────────────────────────────────────────

function send(type, extra) {
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.webContents.send('updater:status', { type, ...extra });
  }
}

function launch(delay) {
  setTimeout(() => {
    if (splashWin && !splashWin.isDestroyed()) {
      splashWin.close();
      splashWin = null;
    }
    _onDone?.();
  }, delay || 800);
}

// Compare deux versions semver. Retourne true si b > a
function isNewer(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (nb > na) return true;
    if (nb < na) return false;
  }
  return false;
}

// GET avec suivi des redirections
function getJson(url, cb, _depth = 0) {
  if (_depth > 5) return cb(new Error('Too many redirects'));
  // HTTPS uniquement — jamais de downgrade vers HTTP
  if (!url.startsWith('https://')) return cb(new Error('HTTPS required'));
  const req = https.get(url, {
    headers: { 'User-Agent': 'DiscowlBrowser-Updater/1.0' }
  }, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
      const loc = res.headers.location || '';
      // Rejeter les redirections HTTP
      if (!loc.startsWith('https://')) return cb(new Error('Redirect to non-HTTPS blocked'));
      return getJson(loc, cb, _depth + 1);
    }
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try { cb(null, JSON.parse(data)); }
      catch (e) { cb(e); }
    });
  });
  req.on('error', cb);
  req.setTimeout(10000, () => { req.destroy(new Error('Timeout')); });
}

// Téléchargement avec progression + suivi redirections
function downloadFile(url, destPath, onProgress, cb, _depth = 0) {
  if (_depth > 5) return cb(new Error('Too many redirects'));
  if (!url.startsWith('https://')) return cb(new Error('HTTPS required'));
  const req = https.get(url, {
    headers: { 'User-Agent': 'DiscowlBrowser-Updater/1.0' }
  }, (res) => {
    // Suivre les redirections HTTPS uniquement
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      const loc = res.headers.location || '';
      if (!loc.startsWith('https://')) return cb(new Error('Redirect to non-HTTPS blocked'));
      return downloadFile(loc, destPath, onProgress, cb, _depth + 1);
    }
    if (res.statusCode !== 200) {
      return cb(new Error(`HTTP ${res.statusCode}`));
    }

    const total    = parseInt(res.headers['content-length'] || '0', 10);
    let received   = 0;
    const out      = fs.createWriteStream(destPath);

    res.on('data', chunk => {
      received += chunk.length;
      out.write(chunk);
      if (total > 0) {
        onProgress(Math.round((received / total) * 100), received, total);
      }
    });

    res.on('end', () => {
      out.end();
      out.on('finish', () => cb(null));
      out.on('error', cb);
    });

    res.on('error', (err) => { out.destroy(); cb(err); });
  });

  req.on('error', cb);
  req.setTimeout(120000, () => { req.destroy(new Error('Download timeout')); });
}

// ── Fenêtre splash ────────────────────────────────────────────

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
  splashWin.once('ready-to-show', () => {
    splashWin && splashWin.show();
  });
  splashWin.on('closed', () => { splashWin = null; });
}

// ── Logique principale ────────────────────────────────────────

function runUpdater(onDone) {
  _onDone = onDone;

  // En dev → lancer directement
  if (!app.isPackaged) {
    onDone();
    return;
  }

  createSplash();

  // Attendre que le splash soit prêt avant de commencer
  splashWin.webContents.once('did-finish-load', () => {
    checkAndUpdate();
  });
}

function checkAndUpdate() {
  const currentVersion = app.getVersion();
  console.log('[Updater] Current version:', currentVersion);

  send('checking');

  const apiUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`;

  getJson(apiUrl, (err, release) => {
    if (err) {
      console.error('[Updater] API error:', err.message);
      send('error', { message: err.message });
      launch(1000);
      return;
    }

    if (!release || !release.tag_name) {
      console.log('[Updater] No release found.');
      send('not-available');
      launch(900);
      return;
    }

    const latestVersion = release.tag_name.replace(/^v/, '');
    console.log('[Updater] Latest version on GitHub:', latestVersion);

    if (!isNewer(currentVersion, latestVersion)) {
      console.log('[Updater] Already up to date.');
      send('not-available');
      launch(900);
      return;
    }

    console.log('[Updater] Update available:', latestVersion);

    // Chercher le .exe dans les assets
    const assets = release.assets || [];
    const exeAsset = assets.find(a =>
      a.name.endsWith('.exe') && a.name.toLowerCase().includes('setup')
    ) || assets.find(a => a.name.endsWith('.exe'));

    if (!exeAsset) {
      console.error('[Updater] No .exe asset found in release.');
      send('error', { message: 'No installer found in release' });
      launch(1000);
      return;
    }

    // Valider que l'URL de téléchargement vient bien de GitHub
    const dlUrl = exeAsset.browser_download_url || '';
    try {
      const parsed = new URL(dlUrl);
      if (parsed.protocol !== 'https:' ||
          !parsed.hostname.endsWith('github.com') &&
          !parsed.hostname.endsWith('githubusercontent.com')) {
        console.error('[Security] Blocked non-GitHub download URL:', dlUrl);
        send('error', { message: 'Download URL rejected for security reasons' });
        launch(1000);
        return;
      }
    } catch {
      console.error('[Security] Invalid download URL');
      send('error', { message: 'Invalid download URL' });
      launch(1000);
      return;
    }
    console.log('[Updater] Downloading:', exeAsset.name, 'from', dlUrl);
    send('available', { version: latestVersion });

    // Télécharger dans le dossier temp
    const tmpPath = path.join(os.tmpdir(), exeAsset.name);

    downloadFile(
      exeAsset.browser_download_url,
      tmpPath,
      (pct, received, total) => {
        console.log(`[Updater] Download: ${pct}%`);
        send('progress', { percent: pct, received, total, version: latestVersion });
      },
      (err) => {
        if (err) {
          console.error('[Updater] Download error:', err.message);
          send('error', { message: err.message });
          launch(1000);
          return;
        }

        console.log('[Updater] Download complete:', tmpPath);
        send('downloaded', { version: latestVersion });

        // Lancer l'installeur en silent + quitter
        setTimeout(() => {
          try {
            // Vérifier que l'extension est bien .exe avant de lancer
            if (!tmpPath.toLowerCase().endsWith('.exe')) {
              console.error('[Security] Downloaded file is not an .exe:', tmpPath);
              send('error', { message: 'Downloaded file rejected for security reasons' });
              launch(1000);
              return;
            }
            // /S = silent install NSIS, remplace l'installation existante
            spawn(tmpPath, ['/S'], {
              detached: true,
              stdio:    'ignore'
            }).unref();
          } catch (spawnErr) {
            console.error('[Updater] Failed to launch installer:', spawnErr.message);
          }
          app.quit();
        }, 1500);
      }
    );
  });
}

// ── IPC — bouton "Check now" dans Settings ────────────────────

function registerIpc() {
  // Le check manuel depuis Settings notifie via le renderer principal (mainWindow)
  ipcMain.handle('update:check', async () => {
    // En prod, déclenche un check silencieux et notifie via update:result
    if (!app.isPackaged) return { upToDate: true };

    return new Promise((resolve) => {
      const currentVersion = app.getVersion();
      const apiUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`;

      getJson(apiUrl, (err, release) => {
        if (err || !release || !release.tag_name) {
          resolve({ upToDate: true, error: err?.message });
          return;
        }
        const latestVersion = release.tag_name.replace(/^v/, '');
        resolve({
          upToDate:  !isNewer(currentVersion, latestVersion),
          latest:    latestVersion,
          current:   currentVersion
        });
      });
    });
  });
}

module.exports = { runUpdater, registerIpc };