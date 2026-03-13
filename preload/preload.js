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
    onUpdated: (cb)     => ipcRenderer.on('favorites:updated', (_, d) => cb(d))
  },

  /* ── Historique (history.json) ───────────────────────────── */
  history: {
    get:       ()       => ipcRenderer.invoke('history:get'),
    add:       (entry)  => ipcRenderer.invoke('history:add', entry),
    clear:     ()       => ipcRenderer.invoke('history:clear'),
    delete:    (id)     => ipcRenderer.invoke('history:delete', id),
    search:    (q)      => ipcRenderer.invoke('history:search', q),
    onUpdated: (cb)     => ipcRenderer.on('history:updated', (_, d) => cb(d))
  },

  /* ── Paramètres ──────────────────────────────────────────── */
  settings: {
    get:  ()     => ipcRenderer.invoke('settings:get'),
    save: (data) => ipcRenderer.invoke('settings:save', data)
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
  /* ── Password / Lock ─────────────────────────────────────── */
  password: {
    isEnabled: ()      => ipcRenderer.invoke('password:isEnabled'),
    setup:     (pwd)   => ipcRenderer.invoke('password:setup', pwd),
    verify:    (pwd)   => ipcRenderer.invoke('password:verify', pwd),
    disable:   (pwd)   => ipcRenderer.invoke('password:disable', pwd),
  },


  /* ── Dialog ──────────────────────────────────────────────── */
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory')
  },

  /* ── Updates ────────────────────────────────────────────── */
  updates: {
    check:   ()   => ipcRenderer.invoke('update:check'),
    install: ()   => ipcRenderer.invoke('update:install'),
    onAvailable: (cb) => ipcRenderer.on('update:available', (_, d) => cb(d)),
    onProgress:  (cb) => ipcRenderer.on('update:progress',  (_, d) => cb(d)),
    onReady:     (cb) => ipcRenderer.on('update:ready',     (_, d) => cb(d))
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