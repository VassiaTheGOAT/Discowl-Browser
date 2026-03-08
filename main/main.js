'use strict';

const { app, BrowserWindow, ipcMain, session, shell, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const TorManager    = require('./torManager');
const { initUpdater } = require('./updater');
const Storage    = require('../store/storage');

/* ══════════════════════════════════════════════════════════════
   LECTURE DES SETTINGS AVANT app.ready
   Nécessaire pour app.commandLine.appendSwitch (doit précéder ready)
══════════════════════════════════════════════════════════════ */
function readSettingsSync() {
  try {
    // Reproduit la logique de app.getPath('userData') sans l'API Electron
    let base;
    if (process.platform === 'win32') {
      base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    } else if (process.platform === 'darwin') {
      base = path.join(os.homedir(), 'Library', 'Application Support');
    } else {
      base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    }
    const settingsPath = path.join(base, 'discowl-browser', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (e) {
    console.error('[Main] Lecture settings pre-ready échouée :', e.message);
  }
  return {};
}

/* ══════════════════════════════════════════════════════════════
   PROXY TOR — AVANT app.ready
   app.commandLine.appendSwitch est la SEULE méthode fiable pour
   forcer Chromium à utiliser un proxy sur TOUS les WebContents
   (webview inclus), peu importe leur partition/session.
   session.setProxy() ne couvre que certaines sessions.
══════════════════════════════════════════════════════════════ */
const earlySettings = readSettingsSync();

// Désactiver le GPU disk cache (évite les erreurs de permission Windows)
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

if (earlySettings.torEnabled) {
  console.log('[Main] torEnabled détecté avant ready → proxy Chromium configuré');
  app.commandLine.appendSwitch('proxy-server', 'socks5://127.0.0.1:9050');
  app.commandLine.appendSwitch('proxy-bypass-list', '<local>');
}

/* ══════════════════════════════════════════════════════════════
   GLOBALS
══════════════════════════════════════════════════════════════ */
let mainWindow = null;
let storage    = null;
let torManager = null;

/* ══════════════════════════════════════════════════════════════
   APP READY
══════════════════════════════════════════════════════════════ */
app.whenReady().then(async () => {
  storage    = new Storage();
  torManager = new TorManager();

  const settings = storage.getSettings();
  nativeTheme.themeSource = settings.theme === 'dark' ? 'dark' : 'light';

  // Démarrer tor.exe si activé (le proxy Chromium est déjà configuré via commandLine)
  if (settings.torEnabled) {
    console.log('[Main] Démarrage de tor.exe…');
    torManager.startTor()
      .then(() => console.log('[Main] Tor démarré avec succès'))
      .catch(e => console.error('[Main] Tor échoué au boot :', e.message));
  }

  createWindow();

  // Démarrer le système de mise à jour (seulement en prod)
  if (app.isPackaged) {
    initUpdater(mainWindow);
  }
});

app.on('window-all-closed', async () => {
  if (torManager) await torManager.stopTor();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ══════════════════════════════════════════════════════════════
   FENÊTRE
══════════════════════════════════════════════════════════════ */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 900, minHeight: 600,
    frame: true,
    show: false,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload:          path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webviewTag:       true,
      sandbox:          false,
      spellcheck:       true
    }
  });

  mainWindow.once('ready-to-show', () => { mainWindow.show(); mainWindow.maximize(); });

  // Forcer toutes les nouvelles fenêtres (window.open, target=_blank, etc.)
  // à s'ouvrir dans un nouvel onglet Discowl au lieu d'une vraie fenêtre
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Envoyer l'URL au renderer pour créer un onglet
    mainWindow?.webContents.send('open-url-in-tab', url);
    return { action: 'deny' };   // bloquer la vraie nouvelle fenêtre
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });

  // ── Interception des téléchargements ────────────────────────
  // Les webviews utilisent fromPartition('persist:main') — PAS defaultSession
  const mainSession = session.fromPartition('persist:main');
  mainSession.on('will-download', (event, item) => {
    const id = Date.now() + '_' + Math.random().toString(36).slice(2);

    const dlItem = {
      id,
      filename:      item.getFilename(),
      url:           item.getURL(),
      totalBytes:    item.getTotalBytes(),
      receivedBytes: 0,
      state:         'progressing',
      savePath:      ''
    };

    // started est envoyé seulement au premier 'updated', c'est-à-dire
    // APRÈS que l'utilisateur a validé la boîte de dialogue de sauvegarde.
    // Avant ça, savePath est vide et le téléchargement n'a pas vraiment commencé.
    let started = false;

    item.on('updated', (e, state) => {
      dlItem.receivedBytes = item.getReceivedBytes();
      dlItem.totalBytes    = item.getTotalBytes();
      dlItem.state         = state;
      dlItem.savePath      = item.getSavePath();

      if (!started && dlItem.savePath) {
        // L'utilisateur a choisi l'emplacement → on annonce le démarrage
        started = true;
        mainWindow?.webContents.send('download:started', { ...dlItem });
      } else if (started) {
        mainWindow?.webContents.send('download:updated', { ...dlItem });
      }
    });

    item.once('done', (e, state) => {
      dlItem.state         = state;
      dlItem.receivedBytes = item.getReceivedBytes();
      dlItem.totalBytes    = item.getTotalBytes();
      dlItem.savePath      = item.getSavePath();

      if (!started) {
        // L'utilisateur a annulé le dialog → on n'affiche rien
        return;
      }
      mainWindow?.webContents.send('download:updated', { ...dlItem });
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   IPC — Favoris
══════════════════════════════════════════════════════════════ */
ipcMain.handle('favorites:get', () => storage.getFavorites());

ipcMain.handle('favorites:save', (_, bookmarks) => {
  storage.saveFavorites(bookmarks);
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send('favorites:updated', bookmarks));
  return true;
});

/* ══════════════════════════════════════════════════════════════
   IPC — Historique
══════════════════════════════════════════════════════════════ */
ipcMain.handle('history:get',    ()         => storage.getHistory());
ipcMain.handle('history:add',    (_, entry) => { storage.addHistory(entry); return true; });
ipcMain.handle('history:clear',  ()         => {
  storage.clearHistory();
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send('history:updated', []));
  return true;
});
ipcMain.handle('history:delete', (_, id)    => { storage.deleteHistory(id); return true; });
ipcMain.handle('history:search', (_, q)     => {
  const h = storage.getHistory();
  if (!q) return h;
  const lq = q.toLowerCase();
  return h.filter(e => e.title?.toLowerCase().includes(lq) || e.url?.toLowerCase().includes(lq));
});

/* ══════════════════════════════════════════════════════════════
   IPC — Paramètres
══════════════════════════════════════════════════════════════ */
ipcMain.handle('settings:get', () => storage.getSettings());

ipcMain.handle('settings:save', async (_, newSettings) => {
  const old = storage.getSettings();
  storage.saveSettings(newSettings);
  if (newSettings.theme !== old.theme) {
    nativeTheme.themeSource = newSettings.theme === 'dark' ? 'dark' : 'light';
  }
  return true;
});

/* ══════════════════════════════════════════════════════════════
   IPC — Tor
   Le vrai travail se fait au redémarrage via commandLine.
   Ces handlers permettent juste d'interroger l'état en live.
══════════════════════════════════════════════════════════════ */
ipcMain.handle('tor:status', () => ({
  running:   torManager.isTorRunning(),
  proxyUrl:  torManager.getTorProxyUrl(),
  binExists: fs.existsSync(torManager.torBinPath),
  binPath:   torManager.torBinPath,
  // Indique si le proxy Chromium est actif (= commandLine switch présent)
  proxyActive: !!earlySettings.torEnabled
}));

/* ══════════════════════════════════════════════════════════════
   IPC — Système
══════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════
   IPC — Downloads
══════════════════════════════════════════════════════════════ */
ipcMain.handle('downloads:openFile',   (_, p) => shell.openPath(p));
ipcMain.handle('downloads:revealFile', (_, p) => shell.showItemInFolder(p));
ipcMain.handle('downloads:cancel',     (_, id) => {
  // Le cancel se fait via l'objet DownloadItem — on garde juste l'id côté renderer
  // pour supprimer visuellement ; l'annulation réelle est gérée côté renderer
  return true;
});

ipcMain.handle('shell:openExternal', (_, url)    => shell.openExternal(url));
ipcMain.handle('shell:openPath',     (_, folder) => shell.openPath(folder));
ipcMain.handle('app:getPath',        (_, name)   => { try { return app.getPath(name); } catch { return ''; } });
ipcMain.handle('app:getVersion',     ()          => app.getVersion());
ipcMain.handle('app:getName',        ()          => app.getName());
ipcMain.handle('app:relaunch',       ()          => { app.relaunch(); app.exit(0); });
ipcMain.handle('storage:getDataPath', ()          => storage.getDataPath());
ipcMain.handle('dialog:openDirectory', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});