'use strict';

/**
 * adBlockSession.js — main/adBlockSession.js
 *
 * Intégration Electron :
 *   - Branche le moteur sur session.webRequest.onBeforeRequest
 *   - Applique le blocage réseau sur toutes les sessions (main + private + Tor)
 *   - Strip les paramètres de tracking des URLs
 *   - Gère les IPC (stats, toggle, règles custom)
 *
 * L'engine (adBlockEngine.js) est partagé — une seule instance
 * pour toutes les sessions, rechargeable à chaud.
 */

const { session, ipcMain, app } = require('electron');
const { AdBlockEngine }         = require('./adBlockEngine');

/* ══════════════════════════════════════════════════════════════
   PARAMÈTRES DE TRACKING À SUPPRIMER DES URLs
   Inspiré de ClearURLs
══════════════════════════════════════════════════════════════ */
const TRACKING_PARAMS = new Set([
  // Google
  'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
  'utm_id','utm_source_platform','utm_creative_format','utm_marketing_tactic',
  'gclid','gclsrc','gbraid','wbraid','dclid',
  // Facebook
  'fbclid','fb_action_ids','fb_action_types','fb_source',
  // Microsoft
  'msclkid',
  // Twitter
  'twclid',
  // Pinterest
  'epik',
  // Mailchimp
  'mc_cid','mc_eid',
  // HubSpot
  '_hsmi','_hsenc','hsCtaTracking',
  // Marketo
  'mkt_tok',
  // Adobe
  's_cid',
  // Autres
  'ref','referrer','source','campaign','aff','affiliate',
  'zanpid','origin_source','yclid','ymclid','at_medium','at_campaign',
]);

function stripTrackingParams(urlString) {
  try {
    const url    = new URL(urlString);
    let changed  = false;
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    return changed ? url.toString() : null; // null = pas de changement
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════
   INSTANCE GLOBALE DE L'ENGINE
══════════════════════════════════════════════════════════════ */

const engine = new AdBlockEngine();
let _initialized = false;

/* ══════════════════════════════════════════════════════════════
   INITIALISATION
══════════════════════════════════════════════════════════════ */

async function initAdBlock(settings, privacyMgr) {
  if (_initialized) return;
  _initialized = true;

  const enabled = !!settings?.blockAds;
  await engine.init(enabled);

  // Injecter l'engine dans privacyManager qui gère le handler onBeforeRequest
  // (Electron n'autorise qu'un seul handler par session — privacyManager est prioritaire)
  if (privacyMgr?.setAdBlockEngine) {
    privacyMgr.setAdBlockEngine(engine);
  }

  console.log(`[AdBlock] Initialisé — ${engine.getInfo().ruleCount} règles, blocage: ${enabled}`);
}


/* ══════════════════════════════════════════════════════════════
   MISE À JOUR À CHAUD
   Appelée quand l'utilisateur change le setting blockAds
══════════════════════════════════════════════════════════════ */

function setAdBlockEnabled(enabled) {
  if (enabled) engine.enable();
  else engine.disable();
  console.log(`[AdBlock] ${enabled ? 'Activé' : 'Désactivé'}`);
}

/* ══════════════════════════════════════════════════════════════
   IPC HANDLERS
══════════════════════════════════════════════════════════════ */

function registerIpc() {
  // Statistiques
  ipcMain.handle('adblock:stats', () => ({
    ...engine.getInfo(),
    enabled: engine.isEnabled(),
  }));

  // Activer / désactiver
  ipcMain.handle('adblock:toggle', (_, enabled) => {
    setAdBlockEnabled(enabled);
    return { enabled: engine.isEnabled() };
  });

  // Règles personnalisées (lire)
  ipcMain.handle('adblock:getRules', () => engine.getCustomRules());

  // Règles personnalisées (sauvegarder)
  ipcMain.handle('adblock:saveRules', (_, text) => {
    if (typeof text !== 'string' || text.length > 1_000_000) return { ok: false };
    engine.saveCustomRules(text);
    return { ok: true };
  });

  // Forcer la mise à jour des listes
  ipcMain.handle('adblock:forceUpdate', async () => {
    const count = await engine.forceUpdate();
    return { ok: true, count };
  });

  // Sélecteurs CSS pour un domaine (appelé par le preload-webview)
  ipcMain.handle('adblock:cosmetic', (_, hostname) => {
    if (typeof hostname !== 'string') return [];
    return engine.getCosmeticSelectors(hostname);
  });

  // Reset stats
  ipcMain.handle('adblock:resetStats', () => {
    engine.resetStats();
    return { ok: true };
  });
}

/* ══════════════════════════════════════════════════════════════
   EXPORTS
══════════════════════════════════════════════════════════════ */

module.exports = { initAdBlock, registerIpc, setAdBlockEnabled, engine };