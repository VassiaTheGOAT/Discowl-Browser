'use strict';

const { app, BrowserWindow, ipcMain, session, shell, dialog, nativeTheme, Menu, screen } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const TorManager      = require('./torManager');
const privacyManager  = require('./privacyManager');

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

// WebRTC : éviter les fuites IP en mode normal
// (renforcé en mode privé/Tor via privacyManager)
app.commandLine.appendSwitch('enforce-webrtc-ip-permission-check');

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

  // ── Protection vie privée ──────────────────────────────────
  if (settings.torEnabled) {
    privacyManager.setupTorSession(settings);
  } else {
    privacyManager.setupNormalSession(settings);
  }
  privacyManager.watchPrivateSessions();

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

  // ── User-Agent & Client Hints ──────────────────────────────────
  // Electron expose "Electron/X.Y.Z" dans le UA — Google le détecte
  // et affiche une page de consentement RGPD non interactable.
  // Solution : intercepter toutes les requêtes et forcer un UA Chrome
  // sur TOUTES les sessions (persist:main + privées dynamiques).
  {
    const chromeVer  = process.versions.chrome || '120.0.0.0';
    const chromeMaj  = chromeVer.split('.')[0];
    const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;

    function patchSession(sess) {
      if (!sess) return;
      sess.setUserAgent(UA);
      // Remplacer aussi les Client Hints (Sec-CH-UA) que Google lit
      sess.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
        const h = details.requestHeaders;
        h['User-Agent']         = UA;
        h['Sec-CH-UA']          = `"Google Chrome";v="${chromeMaj}", "Chromium";v="${chromeMaj}", "Not_A Brand";v="24"`;
        h['Sec-CH-UA-Mobile']   = '?0';
        h['Sec-CH-UA-Platform'] = '"Windows"';
        // Supprimer le header Electron s'il existe
        delete h['X-Electron-Version'];
        callback({ requestHeaders: h });
      });
    }

    // Patcher la session principale + persist:main au démarrage
    patchSession(session.defaultSession);
    patchSession(session.fromPartition('persist:main'));

    // Patcher automatiquement toutes les nouvelles sessions (onglets privés)
    app.on('web-contents-created', (_, contents) => {
      const sess = contents.session;
      if (sess && sess !== session.defaultSession) {
        patchSession(sess);
        bypassGoogleConsent(sess);
      }
    });


    // ── Google Consent bypass ──────────────────────────────────
    // Google redirige les utilisateurs EU vers consent.google.com.
    // On injecte le cookie de consentement pour éviter la page RGPD.
    function bypassGoogleConsent(sess) {
      if (!sess) return;

      // Intercepter les redirections vers consent.google.com
      sess.webRequest.onBeforeRequest(
        { urls: ['https://consent.google.com/*', 'https://www.google.com/sorry/*'] },
        (details, callback) => {
          // Extraire l'URL de retour depuis les paramètres
          try {
            const url   = new URL(details.url);
            const cont  = url.searchParams.get('continue') || url.searchParams.get('q');
            if (cont) {
              callback({ redirectURL: decodeURIComponent(cont) });
              return;
            }
          } catch {}
          callback({});
        }
      );

      // Injecter les cookies de consentement Google sur chaque domaine google.*
      const googleCookies = [
        { name: 'CONSENT',    value: 'YES+cb.20210720-07-p0.fr+FX+' + Math.floor(Date.now()/1000), domain: '.google.com' },
        { name: 'SOCS',       value: 'CAESEwgDEgk0ODE5Nzk2NzIaAmZyIAEaBgiA_LyaBg', domain: '.google.com' },
      ];

      googleCookies.forEach(ck => {
        sess.cookies.set({
          url:      'https://www.google.com',
          name:     ck.name,
          value:    ck.value,
          domain:   ck.domain,
          path:     '/',
          secure:   true,
          httpOnly: false,
          expirationDate: Math.floor(Date.now()/1000) + 60*60*24*365*2
        }).catch(() => {});
      });
    }

    bypassGoogleConsent(session.defaultSession);
    bypassGoogleConsent(session.fromPartition('persist:main'));

    // Appliquer aussi aux nouvelles sessions (onglets privés)
    const _origPatch = patchSession;
    function patchSessionFull(sess) {
      _origPatch(sess);
      bypassGoogleConsent(sess);
    }

    console.log('[UA] Chrome UA actif :', UA.slice(0, 80));
  }

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
    'blockAds','doNotTrack','saveCookies','blockThirdPartyCookies','blockYoutubeAds','toolbarItems','customTitlebar'
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
   RATE LIMITING — protection brute-force
   Max 5 tentatives, puis délai exponentiel
══════════════════════════════════════════════════════════════ */
const _rateLimits = new Map(); // key → { count, lockedUntil }

function rateCheck(key) {
  const now = Date.now();
  const s   = _rateLimits.get(key) || { count: 0, lockedUntil: 0 };
  if (now < s.lockedUntil) {
    const wait = Math.ceil((s.lockedUntil - now) / 1000);
    return { allowed: false, wait };
  }
  return { allowed: true };
}

function rateRecord(key, success) {
  const s = _rateLimits.get(key) || { count: 0, lockedUntil: 0 };
  if (success) {
    _rateLimits.delete(key);
    return;
  }
  s.count++;
  // Délai exponentiel : 5 échecs → 30s, 8 → 5min, 10 → 15min
  if (s.count >= 10) s.lockedUntil = Date.now() + 15 * 60 * 1000;
  else if (s.count >= 8) s.lockedUntil = Date.now() + 5 * 60 * 1000;
  else if (s.count >= 5) s.lockedUntil = Date.now() + 30 * 1000;
  _rateLimits.set(key, s);
}

/* ══════════════════════════════════════════════════════════════
   PASSWORD IPC
══════════════════════════════════════════════════════════════ */
ipcMain.handle('password:isEnabled', ()           => passwordManager.isEnabled());
ipcMain.handle('password:setup',     (_, pwd)     => passwordManager.setup(pwd));
ipcMain.handle('password:verify', async (_, pwd) => {
  const rl = rateCheck('password:verify');
  if (!rl.allowed) return { ok: false, rateLimited: true, wait: rl.wait };
  const ok = await passwordManager.verify(pwd);
  rateRecord('password:verify', ok);
  return ok;
});
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
ipcMain.handle('vault:unlock', async (_, pwd) => {
  const rl = rateCheck('vault:unlock');
  if (!rl.allowed) return false;
  const ok = await vaultManager.unlock(pwd);
  rateRecord('vault:unlock', ok);
  return ok;
});
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
// Appelé quand le mot de passe maître est désactivé — requiert le mot de passe
ipcMain.handle('vault:removeProtection', async (_, pwd) => {
  if (typeof pwd !== 'string' || !pwd) return { ok: false, error: 'Password required' };
  const valid = await passwordManager.verify(pwd);
  if (!valid) return { ok: false, error: 'Incorrect password' };
  vaultManager.removePasswordProtection();
  return { ok: true };
});