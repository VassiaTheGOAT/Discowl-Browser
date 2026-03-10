'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updaterAPI', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  onStatus:   (cb) => ipcRenderer.on('updater:status', (_, event) => cb(event))
});