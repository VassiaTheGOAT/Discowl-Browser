'use strict';

/**
 * privacyManager.js — Gestionnaire vie privée + Tor (production)
 *
 * FAIL CLOSED : en mode Tor, si le proxy SOCKS n'est pas disponible,
 *               toutes les requêtes réseau sont bloquées.
 *
 * Anti DNS-leak : forcer le resolver DNS via le proxy SOCKS5 de Tor
 *                 (Chromium le fait nativement avec proxy-server SOCKS5)
 *
 * Anti fingerprinting : UA uniforme, headers minimaux, no referer en Tor.
 *
 * Isolation de session : chaque onglet Tor utilise une partition
 *                        éphémère séparée (pas de shared state).
 *
 * WebRTC : désactivé en mode Tor via commandLine (avant app.ready)
 *          + setWebRTCIPHandlingPolicy en session.
 *
 * Nettoyage : à la fermeture, toutes les données de session sont effacées.
 */

const { session, app } = require('electron');
const net = require('net');

/* ── User-Agent uniforme (Tor Browser level) ─────────────────
   Utiliser un UA générique et répandu pour se fondre dans la masse.
   Ne jamais exposer la version Electron (fingerprint trivial).
─────────────────────────────────────────────────────────────── */
const TOR_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0';

const NORMAL_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ── Trackers bloqués ────────────────────────────────────────
   Liste condensée — en mode Tor, tout passe par Tor de toute façon,
   mais on bloque les ressources de tracking connues par prudence.
─────────────────────────────────────────────────────────────── */
const TRACKER_PATTERNS = [
  '*://*.google-analytics.com/*','*://*.googletagmanager.com/*',
  '*://*.doubleclick.net/*','*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*','*://*.facebook.net/*',
  '*://*.facebook.com/tr*','*://*.ads-twitter.com/*',
  '*://analytics.twitter.com/*','*://*.clarity.ms/*',
  '*://*.hotjar.com/*','*://*.mouseflow.com/*','*://*.fullstory.com/*',
  '*://*.adnxs.com/*','*://*.rubiconproject.com/*','*://*.openx.net/*',
  '*://*.pubmatic.com/*','*://*.casalemedia.com/*','*://*.criteo.com/*',
  '*://*.criteo.net/*','*://*.outbrain.com/*','*://*.taboola.com/*',
  '*://*.scorecardresearch.com/*','*://*.quantserve.com/*',
  '*://*.moatads.com/*','*://*.mixpanel.com/*','*://*.segment.com/*',
  '*://*.segment.io/*','*://*.amplitude.com/*',
];

/* ── Protocoles dangereux à bloquer ─────────────────────────── */
const BLOCKED_PROTOCOLS = new Set([
  'javascript:', 'data:', 'vbscript:', 'blob:',
]);

/* ── État global ─────────────────────────────────────────────── */
let _torEnabled    = false;
let _torManager    = null;
let _failedReqs    = 0;       // compteur requêtes bloquées (logging)

/* ══════════════════════════════════════════════════════════════
   FAIL CLOSED — vérification proxy avant chaque requête
══════════════════════════════════════════════════════════════ */

/** Cache du statut proxy (mis à jour toutes les 5s) */
let _proxyReachable = false;
let _lastProxyCheck = 0;
const PROXY_CHECK_TTL = 5000;

async function isProxyReachable() {
  const now = Date.now();
  if (now - _lastProxyCheck < PROXY_CHECK_TTL) return _proxyReachable;
  _lastProxyCheck = now;

  _proxyReachable = await new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(2000);
    s.once('connect', () => { s.destroy(); resolve(true);  });
    s.once('error',   () => { resolve(false); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.connect(9050, '127.0.0.1');
  });

  if (!_proxyReachable && _torEnabled) {
    console.error('[Privacy] FAIL CLOSED — proxy Tor injoignable');
  }

  return _proxyReachable;
}

/* ══════════════════════════════════════════════════════════════
   CONFIGURATION DE SESSION
══════════════════════════════════════════════════════════════ */

function configureSession(sess, mode) {
  if (!sess) return;

  const isTor     = mode === 'tor';
  const isPrivate = mode === 'private' || isTor;

  /* ── 1. FAIL CLOSED — intercepter toutes les requêtes ─────── */
  if (isTor) {
    sess.webRequest.onBeforeRequest(
      { urls: ['<all_urls>'] },
      async (details, callback) => {
        // Autoriser les schémas locaux (fichiers app)
        if (details.url.startsWith('file://') ||
            details.url.startsWith('devtools://') ||
            details.url.startsWith('chrome-extension://')) {
          return callback({});
        }

        // Bloquer les protocoles dangereux
        try {
          const u = new URL(details.url);
          if (BLOCKED_PROTOCOLS.has(u.protocol)) {
            return callback({ cancel: true });
          }
        } catch {
          return callback({ cancel: true });
        }

        // Vérification proxy (fail closed)
        const proxyOk = await isProxyReachable();
        if (!proxyOk) {
          _failedReqs++;
          console.warn(`[Privacy] BLOQUÉ (pas de proxy) : ${details.url.slice(0, 80)}`);
          return callback({ cancel: true });
        }

        callback({});
      }
    );
  }

  /* ── 2. Blocage trackers ───────────────────────────────────── */
  if (isPrivate) {
    // En Tor, on a déjà le onBeforeRequest ci-dessus — on ajoute en deuxième
    // handler pour les trackers (quand le proxy est OK)
    sess.webRequest.onBeforeRequest(
      { urls: TRACKER_PATTERNS },
      (details, callback) => {
        callback({ cancel: true });
      }
    );
  }

  /* ── 3. Headers — User-Agent uniforme + privacy ────────────── */
  sess.webRequest.onBeforeSendHeaders(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      const h = { ...details.requestHeaders };

      // User-Agent uniforme
      h['User-Agent'] = isTor ? TOR_USER_AGENT : NORMAL_USER_AGENT;

      // Sec-CH-UA : supprimer en Tor (révèle le moteur et sa version)
      if (isTor) {
        delete h['sec-ch-ua'];
        delete h['sec-ch-ua-mobile'];
        delete h['sec-ch-ua-platform'];
        delete h['sec-ch-ua-platform-version'];
        delete h['sec-ch-ua-full-version-list'];
        delete h['Sec-CH-UA'];
        delete h['Sec-CH-UA-Mobile'];
        delete h['Sec-CH-UA-Platform'];
      }

      // DNT + Sec-GPC toujours
      h['DNT']     = '1';
      h['Sec-GPC'] = '1';

      // Referer
      const referer = h['Referer'] || h['referer'];
      if (referer && isPrivate) {
        try {
          const refOrigin = new URL(referer).origin;
          const reqOrigin = new URL(details.url).origin;
          if (refOrigin !== reqOrigin) {
            if (isTor) {
              // Tor : supprimer complètement le referer cross-origin
              delete h['Referer'];
              delete h['referer'];
            } else {
              // Privé : garder seulement l'origin
              h['Referer'] = refOrigin + '/';
            }
          }
        } catch {}
      }

      callback({ requestHeaders: h });
    }
  );

  /* ── 4. Cookies tiers ──────────────────────────────────────── */
  if (isPrivate) {
    sess.webRequest.onHeadersReceived(
      { urls: ['<all_urls>'] },
      (details, callback) => {
        const headers = { ...details.responseHeaders };
        const key = Object.keys(headers).find(k => k.toLowerCase() === 'set-cookie');
        if (key) {
          const filtered = (headers[key] || []).filter(ck => {
            const lc = ck.toLowerCase();
            // Supprimer cookies SameSite=None (cross-site tracking)
            if (lc.includes('samesite=none')) return false;
            return true;
          });
          headers[key] = filtered;
        }
        callback({ responseHeaders: headers });
      }
    );
  }

  /* ── 5. WebRTC ─────────────────────────────────────────────── */
  if (typeof sess.setWebRTCIPHandlingPolicy === 'function') {
    if (isTor) {
      // Désactiver complètement UDP non proxifié
      sess.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    } else if (isPrivate) {
      sess.setWebRTCIPHandlingPolicy('default_public_interface_only');
    } else {
      sess.setWebRTCIPHandlingPolicy('default');
    }
  }

  /* ── 6. Permissions ────────────────────────────────────────── */
  const ALLOWED_PERMS = new Set([
    'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write',
    'fullscreen', 'media', 'accessibility-events',
  ]);

  sess.setPermissionRequestHandler((wc, permission, callback) => {
    // En mode Tor : géolocalisation toujours bloquée
    if (isTor && permission === 'geolocation') return callback(false);
    callback(ALLOWED_PERMS.has(permission));
  });

  sess.setPermissionCheckHandler((wc, permission, origin) => {
    if (isTor && permission === 'geolocation') return false;
    if (['clipboard-write','clipboard-read','clipboard-sanitized-write'].includes(permission)) return true;
    return ALLOWED_PERMS.has(permission);
  });

  console.log(`[Privacy] Session configurée — mode "${mode}"`);
}

/* ══════════════════════════════════════════════════════════════
   NETTOYAGE COMPLET À LA FERMETURE
   Appelé depuis app.on('before-quit')
══════════════════════════════════════════════════════════════ */

async function clearAllSensitiveData() {
  const sessions = [
    session.defaultSession,
    session.fromPartition('persist:main'),
    session.fromPartition('persist:private'),
  ];

  const clearOpts = {
    storages: ['cookies', 'filesystem', 'indexdb', 'localstorage',
               'shadercache', 'websql', 'serviceworkers', 'cachestorage'],
  };

  for (const sess of sessions) {
    try {
      // Toujours effacer cache
      await sess.clearCache();
      // En mode Tor : effacer tout
      if (_torEnabled) {
        await sess.clearStorageData(clearOpts);
        console.log('[Privacy] Données de session effacées (mode Tor)');
      }
    } catch (e) {
      console.warn('[Privacy] Erreur nettoyage session:', e.message);
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   HOOKS GLOBAUX
══════════════════════════════════════════════════════════════ */

/** À appeler une fois au démarrage depuis main.js */
function initialize(settings, torManager) {
  _torEnabled  = !!settings?.torEnabled;
  _torManager  = torManager;

  // Session principale
  const mainMode = _torEnabled ? 'tor' : 'normal';
  configureSession(session.fromPartition('persist:main'), mainMode);
  configureSession(session.defaultSession, mainMode);

  // Hook : configurer toutes les nouvelles sessions à la volée
  app.on('web-contents-created', (_, contents) => {
    const sess = contents.session;
    if (!sess) return;
    const isPersistent = sess.isPersistent?.() ?? true;
    const mode = _torEnabled ? 'tor' : (isPersistent ? 'normal' : 'private');
    configureSession(sess, mode);
  });

  // Hook session-created (pour capturer les sessions créées dynamiquement)
  app.on('session-created', (sess) => {
    const mode = _torEnabled ? 'tor' : 'normal';
    configureSession(sess, mode);
  });

  // Nettoyage avant fermeture
  app.on('before-quit', async () => {
    await clearAllSensitiveData();
  });

  console.log(`[Privacy] Initialisé — mode: ${mainMode}`);
}

/** Appelé quand l'utilisateur active/désactive Tor */
function setTorMode(enabled) {
  _torEnabled = enabled;
  _lastProxyCheck = 0; // forcer re-vérification proxy
}

/** Stats non sensibles pour logging/UI */
function getStats() {
  return {
    mode:          _torEnabled ? 'tor' : 'normal',
    blockedReqs:   _failedReqs,
    proxyReachable: _proxyReachable,
  };
}

module.exports = {
  initialize,
  setTorMode,
  configureSession,
  clearAllSensitiveData,
  getStats,
  isProxyReachable,
};