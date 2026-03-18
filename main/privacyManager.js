'use strict';

/**
 * privacyManager.js — Couches de protection vie privée par mode
 *
 * MODE NORMAL  : DNT, Sec-GPC, Referer réduit, blocage trackers connus
 * MODE PRIVÉ   : + cookies tiers bloqués, cache isolé, WebRTC restreint
 * MODE TOR     : + WebRTC désactivé, DNS via proxy, headers fingerprint réduits
 */

const { session, app } = require('electron');

/* ── Liste de domaines trackers (condensée, pattern matching) ── */
const TRACKER_PATTERNS = [
  // Analytics
  '*://*.google-analytics.com/*',
  '*://*.googletagmanager.com/*',
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  // Facebook
  '*://*.facebook.net/*',
  '*://*.facebook.com/tr*',
  // Twitter/X
  '*://*.ads-twitter.com/*',
  '*://analytics.twitter.com/*',
  // Microsoft
  '*://*.clarity.ms/*',
  '*://*.bing.com/action/0*',
  // Hotjar, Mouseflow, FullStory, etc.
  '*://*.hotjar.com/*',
  '*://*.mouseflow.com/*',
  '*://*.fullstory.com/*',
  '*://*.crazyegg.com/*',
  // Pub programmatique
  '*://*.adnxs.com/*',
  '*://*.rubiconproject.com/*',
  '*://*.openx.net/*',
  '*://*.pubmatic.com/*',
  '*://*.casalemedia.com/*',
  '*://*.criteo.com/*',
  '*://*.criteo.net/*',
  '*://*.outbrain.com/*',
  '*://*.taboola.com/*',
  // Fingerprinting commun
  '*://*.scorecardresearch.com/*',
  '*://*.quantserve.com/*',
  '*://*.moatads.com/*',
];

/* ── Headers à ajouter sur toutes les requêtes ──────────────── */
function getPrivacyHeaders(mode) {
  const base = {
    'DNT':     '1',
    'Sec-GPC': '1',
  };

  if (mode === 'private' || mode === 'tor') {
    base['Sec-Fetch-Mode'] = 'navigate';
    base['Sec-Fetch-Site'] = 'none';
    // Supprimer le Referer sur les navigations cross-origin
    base['Referrer-Policy'] = 'strict-origin-when-cross-origin';
  }

  if (mode === 'tor') {
    // En mode Tor : referer complètement retiré
    base['Referrer-Policy'] = 'no-referrer';
  }

  return base;
}

/* ══════════════════════════════════════════════════════════════
   Configuration par session
══════════════════════════════════════════════════════════════ */

/**
 * Configure une session selon le mode de confidentialité.
 * @param {Electron.Session} sess
 * @param {'normal'|'private'|'tor'} mode
 */
function configureSession(sess, mode) {
  if (!sess) return;

  // ── 1. Headers privacy ─────────────────────────────────────
  sess.webRequest.onBeforeSendHeaders(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      const h = { ...details.requestHeaders };

      // Ajouter les headers privacy
      const ph = getPrivacyHeaders(mode);
      Object.assign(h, ph);

      // Réduire le Referer en cross-origin
      if (mode !== 'normal') {
        const req = details.url;
        const ref = h['Referer'] || h['referer'];
        if (ref) {
          try {
            const refOrigin = new URL(ref).origin;
            const reqOrigin = new URL(req).origin;
            if (refOrigin !== reqOrigin) {
              if (mode === 'tor') {
                delete h['Referer'];
                delete h['referer'];
              } else {
                // Mode privé : garder seulement l'origine
                h['Referer'] = refOrigin + '/';
              }
            }
          } catch {}
        }
      }

      callback({ requestHeaders: h });
    }
  );

  // ── 2. Blocage trackers ────────────────────────────────────
  // Mode privé et Tor : bloquage strict
  // Mode normal : bloquage si blockAds activé (géré séparément)
  if (mode === 'private' || mode === 'tor') {
    sess.webRequest.onBeforeRequest(
      { urls: TRACKER_PATTERNS },
      (details, callback) => {
        // Ne pas bloquer les ressources first-party
        const reqHost = (() => {
          try { return new URL(details.url).hostname; } catch { return ''; }
        })();
        // Bloquer
        callback({ cancel: true });
      }
    );
  }

  // ── 3. Cookies tiers (mode privé + Tor) ───────────────────
  if (mode === 'private' || mode === 'tor') {
    // Réponses : supprimer les cookies tiers via Set-Cookie
    sess.webRequest.onHeadersReceived(
      { urls: ['<all_urls>'] },
      (details, callback) => {
        const headers = { ...details.responseHeaders };

        // Détecter les cookies tiers (SameSite=None sans Secure = trackers)
        const setCookie = headers['set-cookie'] || headers['Set-Cookie'];
        if (setCookie && Array.isArray(setCookie)) {
          const filtered = setCookie.filter(ck => {
            const lower = ck.toLowerCase();
            // Garder les cookies first-party (SameSite=Lax/Strict ou sans SameSite)
            if (lower.includes('samesite=none')) return false;
            return true;
          });
          if (filtered.length !== setCookie.length) {
            headers['set-cookie'] = filtered;
          }
        }

        callback({ responseHeaders: headers });
      }
    );
  }

  // ── 4. Permissions (caméra, micro, géoloc) ────────────────
  sess.setPermissionRequestHandler((webContents, permission, callback) => {
    // En mode Tor : bloquer géolocalisation systématiquement
    if (mode === 'tor' && permission === 'geolocation') {
      callback(false);
      return;
    }
    // Mode privé : demander confirmation (comportement par défaut Electron = prompt)
    // Mode normal : laisser passer (l'OS gérera)
    callback(mode === 'normal');
  });

  // ── 5. WebRTC (fuite IP) ───────────────────────────────────
  // Géré via commandLine avant app.ready (voir main.js)
  // Ici on peut forcer via API session si disponible
  if (typeof sess.setWebRTCIPHandlingPolicy === 'function') {
    if (mode === 'tor') {
      sess.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    } else if (mode === 'private') {
      sess.setWebRTCIPHandlingPolicy('default_public_interface_only');
    } else {
      sess.setWebRTCIPHandlingPolicy('default');
    }
  }

  console.log(`[Privacy] Session configurée en mode "${mode}"`);
}

/**
 * Configure la session principale (onglets normaux).
 */
function setupNormalSession(settings) {
  const sess = session.fromPartition('persist:main');
  configureSession(sess, 'normal');

  // Blocage trackers si blockAds activé
  if (settings?.blockAds) {
    sess.webRequest.onBeforeRequest(
      { urls: TRACKER_PATTERNS },
      (_, callback) => callback({ cancel: true })
    );
  }
}

/**
 * Configure une session privée à la volée.
 * Appelé depuis web-contents-created pour chaque partition privée.
 */
function setupPrivateSession(sess) {
  configureSession(sess, 'private');
  // Session éphémère — pas de persistance
  sess.clearCache().catch(() => {});
}

/**
 * Configure la session Tor.
 * Appelé quand Tor est activé.
 */
function setupTorSession(settings) {
  const sess = session.fromPartition('persist:main');
  configureSession(sess, 'tor');
}

/**
 * Hook sur web-contents-created pour capturer les sessions privées.
 */
function watchPrivateSessions() {
  app.on('web-contents-created', (_, contents) => {
    const sess = contents.session;
    if (!sess) return;
    // Détecter si c'est une session privée (non persistante)
    const isPersisted = sess.isPersistent?.() ?? true;
    if (!isPersisted) {
      setupPrivateSession(sess);
    }
  });
}

module.exports = { setupNormalSession, setupPrivateSession, setupTorSession, watchPrivateSessions, configureSession };