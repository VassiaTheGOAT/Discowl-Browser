'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/*
 * Discowl Preload — pont IPC sécurisé.
 * N'expose que les méthodes explicitement listées.
 * ipcRenderer n'est JAMAIS exposé directement.
 */
contextBridge.exposeInMainWorld('discowlAPI', {

  /* ── Favoris (favorites.json) ────────────────────────────── */
  favorites: {
    get:       ()       => ipcRenderer.invoke('favorites:get'),
    save:      (data)   => ipcRenderer.invoke('favorites:save', data),
    onUpdated: (cb)     => {
      ipcRenderer.removeAllListeners('favorites:updated');
      ipcRenderer.on('favorites:updated', (_, d) => cb(d));
    }
  },

  /* ── Historique (history.json) ───────────────────────────── */
  history: {
    get:       ()       => ipcRenderer.invoke('history:get'),
    add:       (entry)  => ipcRenderer.invoke('history:add', entry),
    clear:     ()       => ipcRenderer.invoke('history:clear'),
    delete:    (id)     => ipcRenderer.invoke('history:delete', id),
    search:    (q)      => ipcRenderer.invoke('history:search', q),
    onUpdated: (cb)     => {
      ipcRenderer.removeAllListeners('history:updated');
      ipcRenderer.on('history:updated', (_, d) => cb(d));
    }
  },

  /* ── Paramètres ──────────────────────────────────────────── */
  settings: {
    get:       ()     => ipcRenderer.invoke('settings:get'),
    save:      (data) => ipcRenderer.invoke('settings:save', data),
    getPublic: ()     => ipcRenderer.invoke('settings:getPublic')
  },

  /* ── Tor ─────────────────────────────────────────────────── */
  tor: {
    start:  () => ipcRenderer.invoke('tor:start'),
    stop:   () => ipcRenderer.invoke('tor:stop'),
    status: () => ipcRenderer.invoke('tor:status'),
    check:  () => ipcRenderer.invoke('tor:check')
  },

  /* ── Shell ───────────────────────────────────────────────── */
  shell: {
    openExternal: (url)    => ipcRenderer.invoke('shell:openExternal', url),
    openPath:     (folder) => ipcRenderer.invoke('shell:openPath', folder)
  },

  /* ── App ─────────────────────────────────────────────────── */
  app: {
    getPath:    (name) => ipcRenderer.invoke('app:getPath', name),
    getVersion: ()     => ipcRenderer.invoke('app:getVersion'),
    getName:    ()     => ipcRenderer.invoke('app:getName'),
    relaunch:   ()     => ipcRenderer.invoke('app:relaunch')
  },

  /* ── Storage ─────────────────────────────────────────────── */
  storage: {
    getDataPath: () => ipcRenderer.invoke('storage:getDataPath')
  },

  /* ── Vault (password manager) ────────────────────────────── */
  vault: {
    unlock:          (pwd) => ipcRenderer.invoke('vault:unlock', pwd),
    isUnlocked:      ()    => ipcRenderer.invoke('vault:isUnlocked'),
    save:            (h, u, p) => ipcRenderer.invoke('vault:save', h, u, p),
    getForHost:      (url) => ipcRenderer.invoke('vault:getForHost', url),
    getAll:          ()    => ipcRenderer.invoke('vault:getAll'),
    getById:         (id)  => ipcRenderer.invoke('vault:getById', id),
    delete:          (id)  => ipcRenderer.invoke('vault:delete', id),
    removeProtection:()    => ipcRenderer.invoke('vault:removeProtection'),
  },

  /* ── Webview preload path ─────────────────────────────────── */
  webviewPreload: require('path').join(__dirname, 'preload-webview.js'),


  /* ── Window controls (custom titlebar) ──────────────────────── */
  window: {
    minimize:          ()  => ipcRenderer.send('window:minimize'),
    maximize:          ()  => ipcRenderer.send('window:maximize'),
    close:             ()  => ipcRenderer.send('window:close'),
    isMaximized:       ()  => ipcRenderer.invoke('window:isMaximized'),
    customTitlebar:    ()  => ipcRenderer.invoke('window:customTitlebar'),
    getBounds:         ()  => ipcRenderer.invoke('window:getBounds'),
    getWorkArea:       ()  => ipcRenderer.invoke('window:getWorkArea'),
    setBounds:         (b) => ipcRenderer.send('window:setBounds', b),
    onMaximized:       (cb)=> {
      ipcRenderer.removeAllListeners('window:maximized');
      ipcRenderer.on('window:maximized', (_, v) => cb(v));
    },
  },

  openNewWindow: (url) => ipcRenderer.invoke('window:openNew', url),
  devtools: {
    open: (wcId) => ipcRenderer.invoke('devtools:open', wcId),
  },
  /* ── Password / Lock ─────────────────────────────────────── */
  password: {
    isEnabled: ()      => ipcRenderer.invoke('password:isEnabled'),
    setup:     (pwd)   => ipcRenderer.invoke('password:setup', pwd),
    verify:    (pwd)   => ipcRenderer.invoke('password:verify', pwd),
    disable:   (pwd)   => ipcRenderer.invoke('password:disable', pwd),
  },


  /* ── AdBlock ─────────────────────────────────────────────── */
  adblock: {
    stats:       ()      => ipcRenderer.invoke('adblock:stats'),
    toggle:      (on)    => ipcRenderer.invoke('adblock:toggle', on),
    getRules:    ()      => ipcRenderer.invoke('adblock:getRules'),
    saveRules:   (text)  => ipcRenderer.invoke('adblock:saveRules', text),
    forceUpdate: ()      => ipcRenderer.invoke('adblock:forceUpdate'),
    resetStats:  ()      => ipcRenderer.invoke('adblock:resetStats'),
  },

  /* ── Dialog ──────────────────────────────────────────────── */
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    openFile:      ()         => ipcRenderer.invoke('dialog:openFile'),
    saveFile:      (opts)     => ipcRenderer.invoke('dialog:saveFile', opts),
  },

  /* ── File I/O (écriture sécurisée — validation côté main) ── */
  file: {
    write: (filePath, content) => ipcRenderer.invoke('file:write', filePath, content),
  },

  /* ── Updates ─────────────────────────────────────────────── */
  updates: {
    check:    ()  => ipcRenderer.invoke('update:check'),
    download: ()  => ipcRenderer.invoke('update:download'),
    pause:    ()  => ipcRenderer.invoke('update:pause'),
    resume:   ()  => ipcRenderer.invoke('update:resume'),
    cancel:   ()  => ipcRenderer.invoke('update:cancel'),
    install:  ()  => ipcRenderer.invoke('update:install'),
    defer:    ()  => ipcRenderer.invoke('update:defer'),
    getState: ()  => ipcRenderer.invoke('update:state'),
    onAvailable: (cb) => {
      ipcRenderer.removeAllListeners('updater:update-available');
      ipcRenderer.on('updater:update-available', (_, d) => cb(d));
    },
    onDownloadProgress: (cb) => {
      ipcRenderer.removeAllListeners('updater:download-progress');
      ipcRenderer.on('updater:download-progress', (_, d) => cb(d));
    },
    onDownloadPaused: (cb) => {
      ipcRenderer.removeAllListeners('updater:download-paused');
      ipcRenderer.on('updater:download-paused', (_, d) => cb(d));
    },
    onReady: (cb) => {
      ipcRenderer.removeAllListeners('updater:update-ready');
      ipcRenderer.on('updater:update-ready', (_, d) => cb(d));
    },
    onError: (cb) => {
      ipcRenderer.removeAllListeners('updater:download-error');
      ipcRenderer.on('updater:download-error', (_, d) => cb(d));
    },
  },

  /* ── Downloads ───────────────────────────────────────────── */
  downloads: {
    openFile:   (p)  => ipcRenderer.invoke('downloads:openFile',   p),
    revealFile: (p)  => ipcRenderer.invoke('downloads:revealFile', p),
    cancel:     (id) => ipcRenderer.invoke('downloads:cancel',     id),
    onStarted:  (cb) => ipcRenderer.on('download:started',  (_, d) => cb(d)),
    onUpdated:  (cb) => ipcRenderer.on('download:updated',  (_, d) => cb(d))
  }

});

// Ouvrir les nouvelles fenêtres dans un onglet Discowl
ipcRenderer.on('open-url-in-tab', (_, url) => {
  window.dispatchEvent(new CustomEvent('discowl:open-tab', { detail: { url } }));
});