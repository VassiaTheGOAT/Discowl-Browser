'use strict';

/**
 * updateLogger.js — Logger dédié aux mises à jour
 *
 * Fichiers de log :
 *   Windows : %APPDATA%\Discowl Browser\logs\updater.log
 *   macOS   : ~/Library/Logs/Discowl Browser/updater.log
 *   Linux   : ~/.config/Discowl Browser/logs/updater.log
 *
 * Rotation automatique : 5 MB max, 3 fichiers conservés.
 * En dev   : logs console (debug) + fichier.
 * En prod  : fichier uniquement (console silencieuse).
 *
 * L'interface exposée est compatible avec autoUpdater.logger :
 *   { info, warn, error, debug, silly, verbose }
 */

let log;

try {
  log = require('electron-log');

  // Fichier dédié — séparé du log principal de l'app
  log.transports.file.fileName = 'updater.log';
  log.transports.file.maxSize  = 5 * 1024 * 1024; // 5 MB
  log.transports.file.format   = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  const { app } = require('electron');

  if (app.isPackaged) {
    // Prod : désactiver la console (pas de pollution dans les outils système)
    log.transports.console.level = false;
    log.transports.file.level    = 'info';
  } else {
    // Dev : tout voir
    log.transports.console.level = 'debug';
    log.transports.file.level    = 'debug';
  }

} catch (_) {
  // Fallback si electron-log n'est pas installé
  const prefix = '[Updater]';
  log = {
    info:    (...a) => console.log(prefix,   ...a),
    warn:    (...a) => console.warn(prefix,  ...a),
    error:   (...a) => console.error(prefix, ...a),
    debug:   (...a) => console.log(prefix,   ...a),
    silly:   () => {},
    verbose: () => {},
  };
}

module.exports = log;