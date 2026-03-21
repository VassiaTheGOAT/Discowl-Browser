'use strict';

/**
 * updateLogger.js — Logger dédié aux mises à jour
 *
 * Utilise electron-log pour écrire dans :
 *   Windows : %APPDATA%\discowl-browser\logs\updater.log
 *   macOS   : ~/Library/Logs/discowl-browser/updater.log
 *   Linux   : ~/.config/discowl-browser/logs/updater.log
 *
 * Rotation : max 5MB par fichier, 3 fichiers conservés
 * Format   : [timestamp] [level] message
 */

let log;

try {
  log = require('electron-log');

  // Fichier de log dédié aux mises à jour (séparé du log principal)
  log.transports.file.fileName = 'updater.log';
  log.transports.file.maxSize  = 5 * 1024 * 1024; // 5 MB
  log.transports.file.format   = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  // En dev : logs console visibles
  // En prod : logs fichier uniquement (pas de pollution console)
  const { app } = require('electron');
  if (app.isPackaged) {
    log.transports.console.level = false; // désactiver console en prod
  } else {
    log.transports.console.level = 'debug';
    log.transports.file.level    = 'debug';
  }

} catch (e) {
  // electron-log non disponible (rare) — fallback sur console
  // Les méthodes sont compatibles avec l'interface autoUpdater.logger
  log = {
    info:  (...a) => console.log('[Updater]',  ...a),
    warn:  (...a) => console.warn('[Updater]', ...a),
    error: (...a) => console.error('[Updater]',...a),
    debug: (...a) => console.log('[Updater]',  ...a),
    silly: (...a) => {},
    verbose: (...a) => {},
  };
}

module.exports = log;