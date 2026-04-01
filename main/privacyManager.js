'use strict';

/**
 * privacyManager.js — Version finale
 *
 * Principe absolu : un site web normal ne doit JAMAIS etre bloque.
 * Seuls 3 cas annulent une requete :
 *   1. Mode Tor + proxy injoignable (fail-closed)
 *   2. blockTrackers=true + domaine EXACTEMENT dans TRACKER_DOMAINS
 *   3. blockAds=true + domaine EXACTEMENT dans AD_DOMAINS
 *
 * Pas de wildcards. Pas de regex. Pas de moteur externe.
 */

const { session, app } = require('electron');
const net = require('net');

const TRACKER_DOMAINS = new Set([
  'google-analytics.com','ssl.google-analytics.com','www.google-analytics.com',
  'googletagmanager.com','www.googletagmanager.com','googletagservices.com',
  'connect.facebook.net',
  'ads-twitter.com','analytics.twitter.com',
  'clarity.ms','www.clarity.ms','c.clarity.ms',
  'hotjar.com','script.hotjar.com','static.hotjar.com',
  'mouseflow.com','cdn.mouseflow.com',
  'fullstory.com','edge.fullstory.com',
  'mixpanel.com','api.mixpanel.com','cdn.mxpnl.com',
  'amplitude.com','api.amplitude.com','api2.amplitude.com',
  'segment.com','cdn.segment.com','api.segment.com',
  'segment.io','api.segment.io',
  'scorecardresearch.com','sb.scorecardresearch.com',
  'quantserve.com','pixel.quantserve.com',
  'moatads.com',
]);

const AD_DOMAINS = new Set([
  'doubleclick.net','ad.doubleclick.net','stats.g.doubleclick.net',
  'googlesyndication.com','pagead2.googlesyndication.com',
  'googleadservices.com','www.googleadservices.com',
  'adnxs.com','ib.adnxs.com','secure.adnxs.com',
  'rubiconproject.com','fastlane.rubiconproject.com',
  'pubmatic.com','ads.pubmatic.com',
  'openx.net','us-u.openx.net',
  'casalemedia.com','js.casalemedia.com',
  'criteo.com','gum.criteo.com','criteo.net',
  'outbrain.com','widgets.outbrain.com',
  'taboola.com','cdn.taboola.com','trc.taboola.com',
  'sharethrough.com','native.sharethrough.com',
]);

let _torEnabled    = false;
let _blockTrackers = false;
let _blockAds      = false;
let _failedReqs    = 0;
let _proxyOk       = false;
let _proxyCheckedAt= 0;

const UA_TOR    = 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0';
const UA_NORMAL = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function _checkProxy() {
  if (Date.now() - _proxyCheckedAt < 5000) return _proxyOk;
  _proxyCheckedAt = Date.now();
  _proxyOk = await new Promise(r => {
    const s = new net.Socket();
    s.setTimeout(2000);
    s.once('connect', () => { s.destroy(); r(true); });
    s.once('error',   () => r(false));
    s.once('timeout', () => { s.destroy(); r(false); });
    s.connect(9050, '127.0.0.1');
  });
  return _proxyOk;
}

function _handler(isTor) {
  return async (details, callback) => {
    try {
      const url = details.url || '';
      if (!url.startsWith('http')) return callback({});

      if (isTor) {
        if (!await _checkProxy()) { _failedReqs++; return callback({ cancel: true }); }
      }

      let host = '';
      try { host = new URL(url).hostname.toLowerCase(); }
      catch { return callback({}); }

      if ((_blockTrackers || isTor) && TRACKER_DOMAINS.has(host)) {
        return callback({ cancel: true });
      }

      if (_blockAds && AD_DOMAINS.has(host)) {
        return callback({ cancel: true });
      }

    } catch {}

    callback({});
  };
}

const _done = new WeakSet();

function configureSession(sess, isTor) {
  if (!sess || _done.has(sess)) return;
  _done.add(sess);

  sess.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    _handler(isTor)
  );

  sess.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, cb) => {
      try {
        const h = { ...details.requestHeaders };
        h['User-Agent'] = isTor ? UA_TOR : UA_NORMAL;
        h['DNT'] = '1'; h['Sec-GPC'] = '1';
        if (isTor) {
          ['sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform',
           'Sec-CH-UA','Sec-CH-UA-Mobile','Sec-CH-UA-Platform'].forEach(k => delete h[k]);
        }
        cb({ requestHeaders: h });
      } catch { cb({}); }
    }
  );

  try {
    if (typeof sess.setWebRTCIPHandlingPolicy === 'function') {
      sess.setWebRTCIPHandlingPolicy(isTor ? 'disable_non_proxied_udp' : 'default');
    }
  } catch {}

  const ALLOWED = new Set(['clipboard-read','clipboard-write','clipboard-sanitized-write','fullscreen','media','accessibility-events']);
  try {
    sess.setPermissionRequestHandler((_, p, cb) => {
      if (isTor && p === 'geolocation') return cb(false);
      cb(ALLOWED.has(p));
    });
    sess.setPermissionCheckHandler((_, p) => {
      if (isTor && p === 'geolocation') return false;
      if (['clipboard-write','clipboard-read','clipboard-sanitized-write'].includes(p)) return true;
      return ALLOWED.has(p);
    });
  } catch {}
}

function initialize(settings) {
  _torEnabled    = !!settings?.torEnabled;
  _blockTrackers = !!settings?.blockTrackers;
  _blockAds      = !!settings?.blockAds;

  const isTor = _torEnabled;
  configureSession(session.fromPartition('persist:main'), isTor);
  configureSession(session.defaultSession, isTor);

  app.on('web-contents-created', (_, c) => {
    try { configureSession(c.session, _torEnabled); } catch {}
  });
  app.on('session-created', s => {
    try { configureSession(s, _torEnabled); } catch {}
  });
  app.on('before-quit', async () => {
    try { await clearAllSensitiveData(); } catch {}
  });
}

function setTorMode(v)       { _torEnabled    = v; _proxyCheckedAt = 0; }
function setBlockTrackers(v) { _blockTrackers = v; }
function setBlockAds(v)      { _blockAds      = v; }

async function clearAllSensitiveData() {
  for (const s of [
    session.defaultSession,
    session.fromPartition('persist:main'),
    session.fromPartition('persist:private'),
  ]) {
    try { await s.clearCache(); } catch {}
    if (_torEnabled) {
      try { await s.clearStorageData({ storages: ['cookies','filesystem','indexdb','localstorage','shadercache','websql','serviceworkers','cachestorage'] }); } catch {}
    }
  }
}

function getStats() {
  return { torEnabled: _torEnabled, blockTrackers: _blockTrackers, blockAds: _blockAds, blockedReqs: _failedReqs };
}

function isProxyReachable() { return _proxyOk; }

module.exports = { initialize, setTorMode, setBlockTrackers, setBlockAds, configureSession, clearAllSensitiveData, getStats, isProxyReachable };