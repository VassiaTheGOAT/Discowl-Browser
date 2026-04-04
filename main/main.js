'use strict';

const { app, BrowserWindow, ipcMain, session, shell, dialog, nativeTheme, Menu, screen } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const TorManager        = require('./torManager');
const { initAdBlock, registerIpc: registerAdBlockIpc, setAdBlockEnabled } = require('./adBlockSession');
const privacyManager  = require('./privacyManager');

const passwordManager = require('./passwordManager');
const vaultManager    = require('./vaultManager');
const { runUpdater, registerIpc: registerUpdaterIpc,
        startBackgroundChecks, stopBackgroundChecks } = require('./updater');
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
// Chromium verrouille certains fichiers entre deux sessions (LOCK, quota DB...).
// Stratégie :
//   1. Supprimer les LOCK files spécifiques (léger, ciblé)
//   2. Supprimer les caches HTTP/GPU entiers (recréés automatiquement)
//   3. Désactiver le cache HTTP via commandLine (empêche la recréation)
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

  const base = path.join(userDataBase, 'discowl-browser');

  // Chromium nomme les partitions ainsi sur disque :
  //   ''  → Partitions/main          (Electron >= 20)
  //   ''  → Partitions/persist_main   (Electron < 20)
  const partDirs = [
    path.join(base, 'Partitions', 'main'),
    path.join(base, 'Partitions', 'persist_main'),
  ];

  // ── 1. LOCK files — supprimer uniquement les verrous (pas les données) ──
  // Ces fichiers restent ouverts si l'app s'est fermée brutalement.
  const lockFiles = [];
  for (const partDir of partDirs) {
    lockFiles.push(
      path.join(partDir, 'File System', 'Origins', 'LOCK'),
      path.join(partDir, 'File System', 'Origins', 'LOG'),
      path.join(partDir, 'QuotaManager'),
      path.join(partDir, 'QuotaManager-journal'),
      path.join(partDir, 'databases'),
    );
  }
  lockFiles.push(
    path.join(base, 'QuotaManager'),
    path.join(base, 'QuotaManager-journal'),
  );
  for (const f of lockFiles) {
    try { if (fs.existsSync(f)) { fs.rmSync(f, { recursive: true, force: true }); } } catch {}
  }

  // ── 2. Caches HTTP/GPU entiers (volatils, recréés automatiquement) ──
  const cacheDirs = [
    path.join(base, 'Cache'),
    path.join(base, 'Cache_Data'),
    path.join(base, 'GPUCache'),
    path.join(base, 'Code Cache'),
  ];
  for (const partDir of partDirs) {
    cacheDirs.push(
      path.join(partDir, 'Cache'),
      path.join(partDir, 'Cache_Data'),
      path.join(partDir, 'GPUCache'),
      path.join(partDir, 'Code Cache'),
      path.join(partDir, 'Service Worker'),
      path.join(partDir, 'blob_storage'),
    );
  }
  let cleaned = 0;
  for (const d of cacheDirs) {
    try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); cleaned++; } } catch {}
  }
  if (cleaned > 0) console.log(`[Cache] ${cleaned} cache(s) nettoyé(s)`);
}

// ── Switches Chromium ─────────────────────────────────────────────────────
// Désactiver les caches disque qui causent des erreurs de verrouillage
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-application-cache');
// Forcer le cache HTTP en mémoire uniquement (taille 1 = mémoire, pas de fichiers)
app.commandLine.appendSwitch('disk-cache-size', '1');
// Désactiver le quota manager persistant (cause les erreurs quota_database)
app.commandLine.appendSwitch('unlimited-storage');

// Supprimer la menubar native — remplacée par menubar HTML custom
Menu.setApplicationMenu(null);

if (earlySettings.torEnabled) {
  console.log('[Main] torEnabled → proxy + WebRTC + DNS configurés');
  // Proxy global — couvre TOUT Chromium, webviews incluses
  app.commandLine.appendSwitch('proxy-server', 'socks5://127.0.0.1:9050');
  app.commandLine.appendSwitch('proxy-bypass-list', '<local>');
  // WebRTC désactivé — empêche fuites IP réelle
  app.commandLine.appendSwitch('disable-webrtc');
  // Désactiver le cache GPU (fingerprint via timing)
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  // Désactiver les connexions réseau en arrière-plan
  app.commandLine.appendSwitch('disable-background-networking');
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

  // ── Désactiver le cache HTTP sur la session persistante ──────
  // Évite les erreurs "Unable to move the cache" et "Unable to create cache".
  // Le cache est mis en mémoire uniquement (setCacheSize(0) = pas de limite
  // mais sans écriture disque quand disk-cache-size=1 est actif).
  try {
    const mainSession = session.fromPartition('');
    await mainSession.clearCache();
    await mainSession.setCacheSize(0);
  } catch (e) {
    console.warn('[Session] clearCache/setCacheSize:', e.message);
  }

  const settings = storage.getSettings();

  // Déverrouiller le vault selon le mode
  if (passwordManager.isEnabled()) {
    // Vault protégé — sera déverrouillé après authentification (voir vault:unlock IPC)
    console.log('[Vault] Protégé par mot de passe maître — en attente d\'authentification');
  } else {
    vaultManager.unlockAnonymous();
  }
  nativeTheme.themeSource = settings.theme === 'dark' ? 'dark' : 'light';

  // Initialiser le gestionnaire de confidentialité
  privacyManager.initialize(settings);

  // Initialiser le bloqueur de pub
  await initAdBlock(settings, privacyManager).catch(e => console.warn('[AdBlock] init error:', e.message));
  registerAdBlockIpc();

  // Enregistrer les IPC update (check manuel depuis Settings)
  registerUpdaterIpc(() => mainWindow);

  // ── Démarrer Tor ET ouvrir la fenêtre dans le bon ordre ──────
  //
  // PROBLÈME : Chromium reçoit --proxy-server=socks5://127.0.0.1:9050
  // dès le démarrage. Si on ouvre la fenêtre avant que tor.exe soit
  // bootstrappé, toutes les requêtes réseau échouent → app bloquée.
  //
  // SOLUTION : si Tor est activé, on attend qu'il soit prêt (ou qu'il
  // échoue / timeout) AVANT d'appeler createWindow().
  // ──────────────────────────────────────────────────────────────────
  const openApp = () => {
    runUpdater(() => {
      createWindow();
      startBackgroundChecks(mainWindow);
    });
  };

  if (settings.torEnabled) {
    console.log('[Main] Tor activé — bootstrap en cours avant ouverture…');
    _startTorWithSplash(openApp);
  } else {
    openApp();
  }
});

app.on('window-all-closed', async () => {
  stopBackgroundChecks();
  await privacyManager.clearAllSensitiveData();
  if (torManager) await torManager.stopTor();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ══════════════════════════════════════════════════════════════
   FENÊTRE
══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   TOR SPLASH — fenêtre native de bootstrap
   Affiche la progression réelle lue depuis stdout de tor.exe.
   L'app ne s'ouvre qu'une fois Tor bootstrappé (ou après timeout).
══════════════════════════════════════════════════════════════ */
function _startTorWithSplash(onReady) {
  let splashWin = null;
  let launched  = false;

  // ── HTML inline (pas de fichier externe) ────────────────────
  const html = `<!DOCTYPE html><html><head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
    background:#0f1117;color:#dde1f0;
    width:420px;height:220px;overflow:hidden;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:18px;user-select:none;-webkit-app-region:drag;
  }
  .header{display:flex;align-items:center;gap:14px}
  .onion{font-size:36px;line-height:1;filter:drop-shadow(0 0 12px rgba(167,139,250,.5))}
  .brand{display:flex;flex-direction:column;gap:3px}
  .name{font-size:22px;font-weight:700;color:#a78bfa;letter-spacing:-.3px}
  .sub{font-size:12px;color:#475569}
  .panel{width:360px;display:flex;flex-direction:column;gap:8px}
  .status{font-size:12.5px;color:#94a3b8;text-align:center;min-height:18px;transition:color .2s}
  .status.ok{color:#4ade80}.status.err{color:#f87171}
  .track{width:100%;height:6px;background:#1a2035;border-radius:3px;overflow:hidden}
  .fill{height:100%;width:0%;border-radius:3px;transition:width .5s cubic-bezier(.4,0,.2,1);
        background:linear-gradient(90deg,#7c3aed,#a78bfa)}
  .fill.indeterminate{width:35%;animation:ind 1.6s ease-in-out infinite}
  @keyframes ind{0%{transform:translateX(-200%)}100%{transform:translateX(500%)}}
  .pct{font-size:11px;color:#4a5568;text-align:right;font-variant-numeric:tabular-nums}
</style></head><body>
<div class="header">
  <div class="onion">🧅</div>
  <div class="brand">
    <div class="name">Discowl Tor</div>
    <div class="sub">Connexion au réseau Tor…</div>
  </div>
</div>
<div class="panel">
  <div class="status" id="s">Démarrage de Tor…</div>
  <div class="track"><div class="fill indeterminate" id="f"></div></div>
  <div class="pct" id="p"></div>
</div>
<script>
  const s=document.getElementById('s'),f=document.getElementById('f'),p=document.getElementById('p');
  window.__setProgress=(pct,msg)=>{
    if(pct>=0){f.classList.remove('indeterminate');f.style.width=pct+'%';p.textContent=pct+'%';}
    if(msg){s.textContent=msg;}
  };
  window.__setDone=()=>{
    f.classList.remove('indeterminate');f.style.width='100%';
    s.textContent='Connecté !';s.className='status ok';p.textContent='100%';
  };
  window.__setError=(msg)=>{
    s.textContent=msg||'Erreur Tor — lancement quand même…';
    s.className='status err';f.style.background='#f87171';
  };
</script></body></html>`;

  // ── Créer la splash ─────────────────────────────────────────
  splashWin = new BrowserWindow({
    width: 420, height: 220,
    resizable: false, frame: false,
    transparent: false, alwaysOnTop: true,
    center: true, show: false, skipTaskbar: true,
    backgroundColor: '#0f1117',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });

  splashWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  splashWin.once('ready-to-show', () => splashWin?.show());
  splashWin.on('closed', () => { splashWin = null; });

  // ── Helper : envoyer la progression à la splash via executeJS ──
  const send = (fn, ...args) => {
    if (!splashWin || splashWin.isDestroyed()) return;
    const argsStr = args.map(a => JSON.stringify(a)).join(',');
    splashWin.webContents.executeJavaScript(`window.${fn}(${argsStr})`).catch(()=>{});
  };

  // ── Fermer la splash et ouvrir l'app ───────────────────────
  const launch = (delay = 600) => {
    if (launched) return;
    launched = true;
    setTimeout(() => {
      if (splashWin && !splashWin.isDestroyed()) splashWin.close();
      onReady();
    }, delay);
  };

  // ── Timeout global 60s ──────────────────────────────────────
  const globalTimeout = setTimeout(() => {
    console.warn('[Main] Tor — timeout 60s, ouverture forcée');
    send('__setError', 'Timeout — lancement sans Tor…');
    launch(1200);
  }, 60_000);

  // ── Hook sur la progression bootstrap de tor.exe ────────────
  // torManager.startTor() lit stdout/stderr — on branche un listener
  // supplémentaire AVANT startTor() pour intercepter le % en temps réel.
  torManager._onBootstrapProgress = (pct, msg) => {
    send('__setProgress', pct, msg || `Bootstrap ${pct}%…`);
  };

  torManager.startTor()
    .then(() => {
      clearTimeout(globalTimeout);
      console.log('[Main] Tor bootstrappé');
      send('__setDone');
      launch(700);
    })
    .catch(e => {
      clearTimeout(globalTimeout);
      console.error('[Main] Tor échoué:', e.message);
      send('__setError', 'Tor indisponible — lancement quand même…');
      launch(1200);
    });
}

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

    // Bloquer les navigations vers des protocoles dangereux
    contents.on('will-navigate', (event, url) => {
      try {
        const p = new URL(url);
        const blocked = ['javascript:', 'data:', 'vbscript:', 'file:'];
        if (blocked.includes(p.protocol)) {
          console.warn('[Security] Blocked navigation to:', p.protocol);
          event.preventDefault();
        }
      } catch { event.preventDefault(); }
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
  // Les webviews utilisent la defaultSession (partition='')
  const mainSession = session.fromPartition('');
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
  if (!Array.isArray(bookmarks)) return;

  // Validation récursive du nouveau format (avec tags, visitCount, etc.)
  function validateItem(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    if (!['bookmark', 'folder', 'separator'].includes(item.type)) return false;
    if (typeof item.title !== 'string' || item.title.length > 500) return false;
    if (item.type === 'bookmark') {
      if (typeof item.url !== 'string' || item.url.length > 2048) return false;
    }
    // Valider tags
    if (item.tags !== undefined) {
      if (!Array.isArray(item.tags)) return false;
      if (item.tags.some(t => typeof t !== 'string' || t.length > 100)) return false;
    }
    // Valider champs numériques
    if (item.visitCount !== undefined && typeof item.visitCount !== 'number') return false;
    if (item.visitedAt  !== undefined && typeof item.visitedAt  !== 'number') return false;
    if (item.createdAt  !== undefined && typeof item.createdAt  !== 'number') return false;
    if (item.position   !== undefined && typeof item.position   !== 'number') return false;
    // Récursif pour les enfants
    if (item.children) {
      if (!Array.isArray(item.children)) return false;
      if (!item.children.every(validateItem)) return false;
    }
    return true;
  }

  if (!bookmarks.every(validateItem)) return;
  storage.saveFavorites(bookmarks);
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
ipcMain.handle('history:search', (_, q) => {
  if (typeof q !== 'string') return storage.getHistory();
  const safe = q.slice(0, 256); // limite longueur recherche
  const lq = safe.toLowerCase();
  if (!lq) return storage.getHistory();
  return storage.getHistory().filter(e =>
    e.title?.toLowerCase().includes(lq) || e.url?.toLowerCase().includes(lq)
  );
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
    'blockAds','doNotTrack','saveCookies','toolbarItems','customTitlebar',
    'blockTrackers','httpsUpgrade','strictReferrer','blockWebRTC',
    'clearOnExit','doh','blockFingerprinting','blockThirdPartyCookies',
    'blockYoutubeAds','privacyLevel','proxy','ntpBackground','alwaysPrivate',
  ]);
  // Mise a jour a chaud
  if (newSettings.blockAds !== undefined) {
    setAdBlockEnabled(!!newSettings.blockAds);
    privacyManager.setBlockAds(!!newSettings.blockAds);
  }
  if (newSettings.blockTrackers !== undefined) {
    privacyManager.setBlockTrackers(!!newSettings.blockTrackers);
  }
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
  ...torManager.getStatus(),
  binPath:     torManager.torBinPath,
  proxyActive: !!earlySettings.torEnabled,
}));

ipcMain.handle('tor:newCircuit', async () => {
  const result = await torManager.rotateCircuit();
  if (result.ok) {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('tor:circuit-rotated', { circuitId: result.circuitId });
    });
  }
  return result;
});

ipcMain.handle('tor:verify', async () => {
  return torManager.verifyTorConnectivity();
});

ipcMain.handle('tor:getStats', () => {
  return privacyManager.getStats();
});

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
let _lastRelaunch = 0;
ipcMain.handle('app:relaunch', () => {
  const now = Date.now();
  if (now - _lastRelaunch < 10000) {
    console.warn('[Security] app:relaunch rate limited');
    return false;
  }
  _lastRelaunch = now;
  app.relaunch(); app.exit(0);
});
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
  // Mise à jour à chaud
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
  // Validation URL stricte si fournie
  if (url !== undefined) {
    if (typeof url !== 'string' || url.length > 2048) return false;
    try {
      const p = new URL(url);
      if (!['https:', 'http:', 'file:'].includes(p.protocol)) return false;
    } catch { return false; }
  }

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
  if (content.length > 50 * 1024 * 1024) return { ok: false, error: 'Content too large' }; // 50MB max
  const resolved = path.resolve(filePath);
  // Autoriser uniquement downloads et temp — jamais userData (données sensibles)
  const downloadsDir = app.getPath('downloads');
  const tempDir      = app.getPath('temp');
  if (!resolved.startsWith(downloadsDir) && !resolved.startsWith(tempDir)) {
    console.warn('[Security] Blocked file:write outside allowed dirs:', resolved);
    return { ok: false, error: 'Path not allowed' };
  }
  // Bloquer les noms de fichiers dangereux
  const basename = path.basename(resolved);
  if (/\.(exe|bat|cmd|ps1|sh|msi|dll|com|scr|vbs|js|ts)$/i.test(basename)) {
    console.warn('[Security] Blocked dangerous extension:', basename);
    return { ok: false, error: 'Dangerous file type' };
  }
  try {
    fs.writeFileSync(resolved, content, 'utf8');
    return { ok: true, path: resolved };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Permissions + sessions gérées par privacyManager.initialize()