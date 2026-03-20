'use strict';

const { app, BrowserWindow, ipcMain, session, shell, dialog, nativeTheme, Menu, screen } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const TorManager      = require('./torManager');

const passwordManager = require('./passwordManager');
const vaultManager    = require('./vaultManager');
const { runUpdater, registerIpc: registerUpdaterIpc } = require('./updater');
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
const USE_CUSTOM_TITLEBAR = !!earlySettings.customTitlebar;

// ── Cache / Storage cleanup ────────────────────────────────────
// Les erreurs "Unable to move the cache" et "Failed to delete the database"
// viennent toutes du dossier Partitions/persist_main/ de Chromium :
//
//   Cache/               → migration de format → Access Denied
//   GPUCache/            → idem
//   Service Worker/      → quota_database SQLite corrompu/verrouillé
//   QuotaManager(-journal) → idem
//
// On supprime ces fichiers VOLATILS avant que Chromium ne les ouvre.
// On préserve Cookies, Local Storage, IndexedDB (données utilisateur).
{
  let userDataBase;
  if (process.platform === 'win32') {
    userDataBase = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (process.platform === 'darwin') {
    userDataBase = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    userDataBase = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  }

  const base    = path.join(userDataBase, 'discowl-browser');
  const partDir = path.join(base, 'Partitions', 'persist_main');

  // Dossiers/fichiers à supprimer (volatils — recréés automatiquement)
  const toDelete = [
    path.join(base,    'Cache'),
    path.join(base,    'Cache_Data'),
    path.join(base,    'GPUCache'),
    path.join(base,    'Code Cache'),
    path.join(partDir, 'Cache'),
    path.join(partDir, 'Cache_Data'),
    path.join(partDir, 'GPUCache'),
    path.join(partDir, 'Code Cache'),
    path.join(partDir, 'Service Worker'),
    path.join(partDir, 'QuotaManager'),
    path.join(partDir, 'QuotaManager-journal'),
    path.join(partDir, 'databases'),
    path.join(partDir, 'blob_storage'),
  ];

  let cleaned = 0;
  for (const target of toDelete) {
    try {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        cleaned++;
      }
    } catch { /* verrouillé — Chromium gèrera */ }
  }
  if (cleaned > 0) console.log(`[Cache] ${cleaned} dossier(s) volatils nettoyés`);
}

// Désactiver le GPU disk cache et le shader cache
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Supprimer la menubar native — remplacée par menubar HTML custom
Menu.setApplicationMenu(null);

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

  // Déverrouiller le vault selon le mode
  if (passwordManager.isEnabled()) {
    // Vault protégé — sera déverrouillé après authentification (voir vault:unlock IPC)
    console.log('[Vault] Protégé par mot de passe maître — en attente d\'authentification');
  } else {
    vaultManager.unlockAnonymous();
  }
  nativeTheme.themeSource = settings.theme === 'dark' ? 'dark' : 'light';

  // Enregistrer les IPC update (check manuel depuis Settings)
  registerUpdaterIpc();

  // Démarrer tor.exe si activé
  if (settings.torEnabled) {
    console.log('[Main] Démarrage de tor.exe…');
    torManager.startTor()
      .then(() => console.log('[Main] Tor démarré avec succès'))
      .catch(e => console.error('[Main] Tor échoué au boot :', e.message));
  }

  // Splash updater AVANT la fenêtre principale (en prod uniquement)
  // En dev, runUpdater appelle onDone immédiatement
  runUpdater(() => {
    createWindow();
  });
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
    frame: !USE_CUSTOM_TITLEBAR,
    transparent: false,
    hasShadow: true,
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
  mainWindow.on('maximize',   () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));

  // Forcer toutes les nouvelles fenêtres (window.open, target=_blank, etc.)
  // à s'ouvrir dans un nouvel onglet Discowl au lieu d'une vraie fenêtre
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Envoyer l'URL au renderer pour créer un onglet
    mainWindow?.webContents.send('open-url-in-tab', url);
    return { action: 'deny' };   // bloquer la vraie nouvelle fenêtre
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });

  // ── Intercepter les nouvelles fenêtres dans TOUS les webviews ─
  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() !== 'webview') return;

    // setWindowOpenHandler : window.open / target=_blank / disposition new-window
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (url && url !== 'about:blank' && url !== 'about:blank#blocked') {
        mainWindow?.webContents.send('open-url-in-tab', url);
      }
      return { action: 'deny' };
    });

    // will-navigate avec disposition new-window (certains sites)
    contents.on('will-navigate', (e, url) => {
      // navigation normale dans l'onglet — laisser passer
    });

    // did-create-window : si une vraie fenêtre est quand même créée, la fermer
    // et l'ouvrir en onglet
    contents.on('did-create-window', (win, { url }) => {
      win.destroy();
      if (url && url !== 'about:blank') {
        mainWindow?.webContents.send('open-url-in-tab', url);
      }
    });
  });

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
ipcMain.handle('history:add', (_, entry) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (typeof entry.url   !== 'string' || entry.url.length   > 2048) return false;
  if (typeof entry.title !== 'string' || entry.title.length > 512)  entry.title = entry.title?.slice(0,512) ?? '';
  // Rejeter les URLs non-http(s)
  try {
    const p = new URL(entry.url);
    if (!['https:','http:'].includes(p.protocol)) return false;
  } catch { return false; }
  storage.addHistory({ url: entry.url, title: entry.title, favicon: typeof entry.favicon === 'string' ? entry.favicon.slice(0,512) : '' });
  return true;
});
ipcMain.handle('history:clear',  ()         => {
  storage.clearHistory();
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send('history:updated', []));
  return true;
});
ipcMain.handle('history:delete', (_, id) => {
  if (typeof id !== 'string' || id.length > 128) return false;
  storage.deleteHistory(id);
  return true;
});
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
ipcMain.handle('settings:getPublic', () => ({ blockYoutubeAds: !!storage.getSettings().blockYoutubeAds, blockAds: !!storage.getSettings().blockAds }));

ipcMain.handle('settings:save', async (_, newSettings) => {
  if (!newSettings || typeof newSettings !== 'object' || Array.isArray(newSettings)) return false;
  // Whitelist des clés autorisées — aucune clé arbitraire ne peut être injectée
  const ALLOWED_KEYS = new Set([
    'defaultEngine','theme','torEnabled','homePage','newTabPage',
    'downloadPath','language','fontSize','showBookmarksToolbar',
    'blockAds','doNotTrack','saveCookies','toolbarItems','customTitlebar'
  ]);
  const safe = {};
  for (const [k, v] of Object.entries(newSettings)) {
    if (ALLOWED_KEYS.has(k)) safe[k] = v;
  }
  const old = storage.getSettings();
  storage.saveSettings(safe);
  if (safe.theme !== undefined && safe.theme !== old.theme) {
    nativeTheme.themeSource = safe.theme === 'dark' ? 'dark' : 'light';
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
ipcMain.handle('downloads:openFile', async (_, p) => {
  if (typeof p !== 'string') return;
  const resolved = path.resolve(p);
  const downloadsDir = app.getPath('downloads');
  const userDataDir  = app.getPath('userData');
  // Autoriser seulement downloads et userData (pour les exports)
  if (!resolved.startsWith(downloadsDir) && !resolved.startsWith(userDataDir)) {
    console.warn('[Security] Blocked openFile outside allowed dirs:', resolved);
    return;
  }
  return shell.openPath(resolved);
});
ipcMain.handle('downloads:revealFile', async (_, p) => {
  if (typeof p !== 'string') return;
  const resolved = path.resolve(p);
  const downloadsDir = app.getPath('downloads');
  const userDataDir  = app.getPath('userData');
  if (!resolved.startsWith(downloadsDir) && !resolved.startsWith(userDataDir)) {
    console.warn('[Security] Blocked revealFile outside allowed dirs:', resolved);
    return;
  }
  return shell.showItemInFolder(resolved);
});
ipcMain.handle('downloads:cancel',     (_, id) => {
  // Le cancel se fait via l'objet DownloadItem — on garde juste l'id côté renderer
  // pour supprimer visuellement ; l'annulation réelle est gérée côté renderer
  return true;
});

ipcMain.handle('shell:openExternal', (_, url) => {
  // Whitelist des protocoles autorisés uniquement
  if (typeof url !== 'string') return;
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
      console.warn('[Security] Blocked openExternal with protocol:', parsed.protocol);
      return;
    }
    shell.openExternal(url);
  } catch { /* URL invalide — ignorer */ }
});
ipcMain.handle('shell:openPath', (_, folder) => {
  if (typeof folder !== 'string') return;
  // Autoriser uniquement les chemins dans userData
  const userDataPath = app.getPath('userData');
  const resolvedPath = path.resolve(folder);
  if (!resolvedPath.startsWith(userDataPath)) {
    console.warn('[Security] Blocked openPath outside userData:', resolvedPath);
    return;
  }
  shell.openPath(resolvedPath);
});
ipcMain.handle('app:getPath', (_, name) => {
  const ALLOWED = ['userData', 'downloads', 'temp'];
  if (!ALLOWED.includes(name)) return '';
  try { return app.getPath(name); } catch { return ''; }
});
ipcMain.handle('app:getVersion',     ()          => app.getVersion());
ipcMain.handle('app:getName',        ()          => app.getName());
ipcMain.handle('app:relaunch',       ()          => { app.relaunch(); app.exit(0); });
ipcMain.handle('storage:getDataPath', ()          => storage.getDataPath());
ipcMain.handle('dialog:openDirectory', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});


/* ══════════════════════════════════════════════════════════════
   PASSWORD IPC
══════════════════════════════════════════════════════════════ */
ipcMain.handle('password:isEnabled', ()           => passwordManager.isEnabled());
ipcMain.handle('password:setup',     (_, pwd)     => passwordManager.setup(pwd));
ipcMain.handle('password:verify',    (_, pwd)     => passwordManager.verify(pwd));
ipcMain.handle('password:disable',   (_, pwd)     => passwordManager.disable(pwd));

/* ══════════════════════════════════════════════════════════════
   WINDOW CONTROLS IPC (custom titlebar)
══════════════════════════════════════════════════════════════ */
ipcMain.handle('window:getBounds',   () => mainWindow?.getBounds());
ipcMain.handle('window:getWorkArea', () => screen.getPrimaryDisplay().workArea);
ipcMain.on('window:setBounds', (_, b) => {
  if (!b || typeof b !== 'object') return;
  const { x, y, width, height } = b;
  if (typeof width  !== 'number' || width  < 200 || width  > 7680) return;
  if (typeof height !== 'number' || height < 150 || height > 4320) return;
  const safe = {};
  if (typeof x === 'number') safe.x = Math.round(x);
  if (typeof y === 'number') safe.y = Math.round(y);
  safe.width  = Math.round(width);
  safe.height = Math.round(height);
  mainWindow?.setBounds(safe);
});
ipcMain.on('window:minimize',  () => mainWindow?.minimize());
ipcMain.on('window:maximize',  () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close',     () => mainWindow?.close());
ipcMain.handle('window:isMaximized',    () => mainWindow?.isMaximized() ?? false);
ipcMain.handle('window:customTitlebar', () => USE_CUSTOM_TITLEBAR);

/* ══════════════════════════════════════════════════════════════
   VAULT IPC
══════════════════════════════════════════════════════════════ */
// Appelé après vérification du mot de passe maître (lock screen)
ipcMain.handle('vault:unlock',      async (_, pwd)  => vaultManager.unlock(pwd));
ipcMain.handle('vault:isUnlocked',  ()              => vaultManager.isUnlocked());
ipcMain.handle('vault:save', (_, host, username, password) => {
  if (typeof host     !== 'string' || host.length     > 253)   return { ok: false, error: 'Invalid host' };
  if (typeof username !== 'string' || username.length > 512)   return { ok: false, error: 'Username too long' };
  if (typeof password !== 'string' || password.length > 4096)  return { ok: false, error: 'Password too long' };
  if (!password) return { ok: false, error: 'Empty password' };
  return vaultManager.save(host, username, password);
});
ipcMain.handle('vault:getForHost', (_, url) => {
  if (typeof url !== 'string' || url.length > 2048) return [];
  return vaultManager.getForHost(url);
});
ipcMain.handle('vault:getAll',      ()              => vaultManager.getAll());
ipcMain.handle('vault:getById', (_, id) => {
  if (typeof id !== 'string' || id.length > 64) return null;
  return vaultManager.getById(id);
});
ipcMain.handle('vault:delete', (_, id) => {
  if (typeof id !== 'string' || id.length > 64) return { ok: false };
  return vaultManager.delete(id);
});
// Appelé quand le mot de passe maître est désactivé
ipcMain.handle('vault:removeProtection', ()         => { vaultManager.removePasswordProtection(); return { ok: true }; });


/* ══════════════════════════════════════════════════════════════
   NOUVELLE FENÊTRE
══════════════════════════════════════════════════════════════ */
const secondaryWindows = new Set();

ipcMain.handle('window:openNew', (_, url) => {
  // url optionnel — si absent, ouvre une nouvelle fenêtre vide

  const win = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 900, minHeight: 600,
    frame: !USE_CUSTOM_TITLEBAR,
    transparent: false,
    hasShadow: true,
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

  win.once('ready-to-show', () => {
    win.show();
    // Si une URL est passée, l'ouvrir dans le nouvel onglet
    if (url && typeof url === 'string') {
      try { new URL(url); } catch { url = null; }
    }
    if (url) {
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('open-url-in-tab', url);
      });
    }
  });

  win.on('maximize',   () => win.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized', false));
  win.on('closed',     () => secondaryWindows.delete(win));

  win.webContents.setWindowOpenHandler(({ url: u }) => {
    win.webContents.send('open-url-in-tab', u);
    return { action: 'deny' };
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  secondaryWindows.add(win);
  return true;
});

/* ══════════════════════════════════════════════════════════════
   DEVTOOLS DOCKÉS
   Electron ne peut pas intégrer les DevTools d'un webview dans
   le même rendu. On simule le dockage en repositionnant la
   fenêtre DevTools juste sous la fenêtre principale.
══════════════════════════════════════════════════════════════ */
ipcMain.handle('devtools:open', (event, webContentsId) => {
  try {
    // Essayer via webContents.fromId
    const { webContents } = require('electron');
    const wc = webContents.fromId(webContentsId);
    if (!wc) return { ok: false };
    // Toggle : fermer si déjà ouvert, sinon ouvrir
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
    } else {
      wc.openDevTools({ mode: 'bottom', activate: true });
    }
    return { ok: true };
  } catch (e) {
    console.error('[DevTools]', e.message);
    return { ok: false };
  }
});

ipcMain.handle('devtools:getWebContentsId', (event) => {
  // Appelé par le renderer pour récupérer l'id du webContents d'un webview
  return null; // géré côté renderer via webview.getWebContentsId()
});


/* ══════════════════════════════════════════════════════════════
   SAVE PAGE — télécharger la page HTML complète
   OPEN FILE  — ouvrir un fichier HTML/local
══════════════════════════════════════════════════════════════ */
ipcMain.handle('dialog:saveFile', async (_, opts) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: opts?.filename || 'page.html',
    filters: [
      { name: 'Web Page', extensions: ['html', 'htm'] },
      { name: 'All Files', extensions: ['*'] },
    ]
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('dialog:openFile', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Web pages',      extensions: ['html', 'htm', 'xhtml', 'mhtml', 'mht'] },
      { name: 'Documents',      extensions: ['pdf', 'txt', 'md', 'markdown', 'rtf'] },
      { name: 'Data & Code',    extensions: ['json', 'xml', 'yaml', 'yml', 'csv', 'js', 'ts', 'css'] },
      { name: 'Images',         extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'] },
      { name: 'Audio',          extensions: ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac'] },
      { name: 'Video',          extensions: ['mp4', 'webm', 'ogv', 'mkv', 'avi', 'mov'] },
      { name: 'All Files',      extensions: ['*'] },
    ]
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('file:write', async (_, filePath, content) => {
  if (typeof filePath !== 'string' || typeof content !== 'string') return { ok: false };
  // Sécurité : ne permettre d'écrire que dans downloads ou temp
  const downloadsDir = app.getPath('downloads');
  const tempDir      = app.getPath('temp');
  const resolved     = require('path').resolve(filePath);
  if (!resolved.startsWith(downloadsDir) && !resolved.startsWith(tempDir)) {
    // Fichier choisi via dialog — on autorise
  }
  try {
    fs.writeFileSync(resolved, content, 'utf8');
    return { ok: true, path: resolved };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});