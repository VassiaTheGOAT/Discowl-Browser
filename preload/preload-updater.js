'use strict';

/**
 * preload-updater.js — Preload de la fenêtre splash updater
 * Expose uniquement les APIs nécessaires à l'affichage du splash.
 * Isolation complète : aucun accès IPC générique.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updaterAPI', {

  // Version courante de l'application
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Écouter les événements de statut de l'updater
  onStatus: (cb) => {
    ipcRenderer.removeAllListeners('updater:status');
    ipcRenderer.on('updater:status', (_, event) => cb(event));
  },
});