'use strict';

/**
 * preload-updater.js — Preload exclusif de la fenêtre splash
 *
 * Expose uniquement les APIs nécessaires au splash :
 *   - getVersion() → version installée
 *   - onStatus(cb) → events du process de MAJ
 *
 * Isolation totale : aucun accès aux IPC généraux de l'app.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updaterAPI', {

  /** Version courante de l'app installée */
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  /**
   * Écoute les événements d'état envoyés par updater.js
   * via splashWin.webContents.send('updater:status', { type, ...payload })
   */
  onStatus: (cb) => {
    // Supprimer les anciens listeners pour éviter les doublons
    ipcRenderer.removeAllListeners('updater:status');
    ipcRenderer.on('updater:status', (_, event) => cb(event));
  },
});