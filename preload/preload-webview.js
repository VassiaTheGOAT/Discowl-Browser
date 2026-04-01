'use strict';

/**
 * preload-webview.js — preload/preload-webview.js
 *
 * Injecté dans CHAQUE page web chargée par les webviews.
 * Responsabilités :
 *
 *   1. DOM Filtering     : masquer / supprimer les éléments publicitaires
 *                          via les sélecteurs CSS cosmétiques (EasyList ##rules)
 *   2. YouTube AdBlock   : skip automatique + DOM cleanup
 *   3. Twitch / DM       : mute + DOM cleanup
 *   4. Anti-fingerprint  : Canvas noise, AudioContext noise, webdriver=false
 *   5. Autofill vault    : focus login fields, capture submit
 *   6. URL cleanup       : déjà fait côté réseau, mais on nettoie aussi history.replaceState
 */

const { ipcRenderer } = require('electron');

/* ══════════════════════════════════════════════════════════════
   1. DOM FILTERING — sélecteurs cosmétiques
   Les sélecteurs viennent du moteur (EasyList ##rules + fallback hardcodé)
══════════════════════════════════════════════════════════════ */

const FALLBACK_AD_SELECTORS = [
  // Éléments génériques d'annonces
  '[id*="google_ads"]','[id*="ad-container"]','[id*="ad-slot"]',
  '[id*="adsbygoogle"]','[class*="adsbygoogle"]',
  '[id*="banner-ad"]','[class*="banner-ad"]',
  '[id*="ads-container"]','[class*="ads-container"]',
  'ins.adsbygoogle',
  // Trackers pixel
  'img[src*="doubleclick.net"]',
  'img[src*="googlesyndication"]',
  'img[src*="facebook.com/tr"]',
  'img[width="1"][height="1"]',
  'img[width="0"][height="0"]',
  // iframes pub
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication"]',
  'iframe[src*="adnxs.com"]',
  'iframe[src*="rubiconproject.com"]',
  // Widgets pub courants
  '[data-ad-slot]','[data-adunit]','[data-google-query-id]',
];

let _cosmeticSelectors = [...FALLBACK_AD_SELECTORS];
let _domFilterEnabled  = false;
let _observer          = null;

async function initDomFilter() {
  try {
    const settings = await ipcRenderer.invoke('settings:getPublic');
    if (!settings?.blockAds) return;
    _domFilterEnabled = true;

    // Récupérer les sélecteurs cosmétiques pour ce domaine
    const hostname = window.location.hostname;
    const extra    = await ipcRenderer.invoke('adblock:cosmetic', hostname).catch(() => []);
    if (Array.isArray(extra) && extra.length > 0) {
      _cosmeticSelectors = [..._cosmeticSelectors, ...extra];
    }

    // Appliquer immédiatement
    _hideAdElements();

    // Observer les mutations DOM (SPAs, injection dynamique)
    _observer = new MutationObserver(_onMutation);
    _observer.observe(document.documentElement, { childList: true, subtree: true });

  } catch (e) {
    // Silencieux — ne pas casser la page
  }
}

/** Cache des éléments déjà masqués pour éviter les re-process */
const _hiddenEls = new WeakSet();

function _hideAdElements() {
  if (!_domFilterEnabled || !_cosmeticSelectors.length) return;

  // Regrouper tous les sélecteurs en une seule requête DOM (performance)
  const combined = _cosmeticSelectors.join(',');
  try {
    const els = document.querySelectorAll(combined);
    for (const el of els) {
      if (_hiddenEls.has(el)) continue;
      _hiddenEls.add(el);
      // Masquer sans supprimer (évite de casser les layouts)
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('height', '0', 'important');
      el.style.setProperty('max-height', '0', 'important');
      el.style.setProperty('overflow', 'hidden', 'important');
    }
  } catch {}
}

// Throttle des mutations pour éviter la surcharge CPU
let _mutationThrottle = null;
function _onMutation() {
  if (_mutationThrottle) return;
  _mutationThrottle = setTimeout(() => {
    _hideAdElements();
    _mutationThrottle = null;
  }, 150);
}

/* ══════════════════════════════════════════════════════════════
   2. YOUTUBE AD BLOCKER
══════════════════════════════════════════════════════════════ */

const YOUTUBE_AD_SELECTORS = [
  '.ytp-ad-module','.ytp-ad-overlay-container','.ytp-ad-text-overlay',
  '.ytp-ad-image-overlay','.ytp-ad-action-interstitial',
  '.ytp-ad-skip-button-container','#masthead-ad','#player-ads',
  '.ytd-banner-promo-renderer','ytd-promoted-video-renderer',
  'ytd-promoted-sparkles-web-renderer','ytd-display-ad-renderer',
  'ytd-rich-item-renderer:has(.ytd-ad-slot-renderer)',
  '.ytd-ad-slot-renderer','ad-slot-renderer',
  'ytd-action-companion-ad-renderer','ytd-companion-slot-renderer',
  '#above-the-fold:has([layout="video-masthead-ad"])',
];

const YOUTUBE_SKIP_SELECTORS = [
  '.ytp-skip-ad-button','.ytp-ad-skip-button',
  '.ytp-ad-skip-button-modern','button.ytp-skip-ad-button',
];

function initYouTubeAdBlock() {
  if (!window.location.hostname.includes('youtube.com')) return;

  let _ytInterval = null;

  function removeYtAds() {
    for (const sel of YOUTUBE_AD_SELECTORS) {
      try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
    }
  }

  function skipAd() {
    for (const sel of YOUTUBE_SKIP_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn) { btn.click(); return true; }
    }
    return false;
  }

  function handleAd() {
    const video    = document.querySelector('video');
    const adActive = !!document.querySelector('.ad-showing');

    removeYtAds();

    if (video && adActive) {
      // Stratégie 1 : Skip direct
      if (!skipAd()) {
        // Stratégie 2 : Accélérer la pub
        video.playbackRate = 16;
        // Stratégie 3 : Avancer à la fin
        if (isFinite(video.duration)) {
          video.currentTime = video.duration - 0.1;
        }
      }
      video.muted  = true;
      video.volume = 0;
    } else if (video && !adActive) {
      if (video.playbackRate === 16) video.playbackRate = 1;
      if (video.muted && video.volume === 0) {
        video.muted  = false;
        video.volume = 1;
      }
    }
  }

  const ytObserver = new MutationObserver(() => handleAd());
  ytObserver.observe(document.documentElement, { childList: true, subtree: true });

  _ytInterval = setInterval(handleAd, 300);

  // Nettoyage à la navigation SPA
  window.addEventListener('yt-navigate-start', () => {
    clearInterval(_ytInterval);
    ytObserver.disconnect();
    // Réinitialiser après navigation
    setTimeout(initYouTubeAdBlock, 1000);
  }, { once: true });
}

/* ══════════════════════════════════════════════════════════════
   3. TWITCH & DAILYMOTION
══════════════════════════════════════════════════════════════ */

function initTwitchAdBlock() {
  if (!window.location.hostname.includes('twitch.tv')) return;

  const TWITCH_SELECTORS = [
    '[data-a-target="ad-overlay"]','.ad-overlay',
    '.tw-ad','[class*="AdBanner"]','[class*="ad-banner"]',
  ];

  const obs = new MutationObserver(() => {
    TWITCH_SELECTORS.forEach(s => {
      try { document.querySelectorAll(s).forEach(el => el.remove()); } catch {}
    });
    const video = document.querySelector('video');
    const adBanner = document.querySelector('[data-a-target="ad-overlay"]');
    if (video && adBanner) { video.muted = true; video.volume = 0; }
    else if (video && video.volume === 0 && !adBanner) { video.muted = false; video.volume = 1; }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

function initDailymotionAdBlock() {
  if (!window.location.hostname.includes('dailymotion.com')) return;

  const DM_SELECTORS = ['.adContainer','.AdSlot','[class*="Ad_"]','[id*="Ads"]'];
  const obs = new MutationObserver(() => {
    DM_SELECTORS.forEach(s => { try { document.querySelectorAll(s).forEach(el => el.remove()); } catch {} });
    const skipBtn = document.querySelector('.skip_ad_button, .SkipButton, [class*="skip"]');
    if (skipBtn) skipBtn.click();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

/* ══════════════════════════════════════════════════════════════
   4. ANTI-FINGERPRINTING
══════════════════════════════════════════════════════════════ */

// Canvas
(function() {
  const origToDataURL    = HTMLCanvasElement.prototype.toDataURL;
  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

  function noise(data) {
    for (let i = 0; i < data.data.length; i += 4000) {
      data.data[i]   = Math.max(0, Math.min(255, data.data[i]   + (Math.random() > 0.5 ? 1 : -1)));
      data.data[i+1] = Math.max(0, Math.min(255, data.data[i+1] + (Math.random() > 0.5 ? 1 : -1)));
    }
    return data;
  }

  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    const ctx = this.getContext('2d');
    if (ctx && this.width > 0 && this.height > 0) {
      try {
        const img = origGetImageData.call(ctx, 0, 0, this.width, this.height);
        noise(img); ctx.putImageData(img, 0, 0);
      } catch {}
    }
    return origToDataURL.apply(this, args);
  };
})();

// AudioContext
(function() {
  if (typeof AudioBuffer === 'undefined') return;
  const orig = AudioBuffer.prototype.getChannelData;
  AudioBuffer.prototype.getChannelData = function(ch) {
    const data = orig.call(this, ch);
    for (let i = 0; i < data.length; i += 1000) {
      data[i] += (Math.random() - 0.5) * 0.0001;
    }
    return data;
  };
})();

// WebDriver detection
(function() {
  try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch {}
})();

/* ══════════════════════════════════════════════════════════════
   5. AUTOFILL VAULT (inchangé)
══════════════════════════════════════════════════════════════ */

let _autofillArmed = false;

function isLoginField(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  const t  = (el.type || '').toLowerCase();
  const nm = (el.name || '').toLowerCase();
  const ac = (el.autocomplete || '').toLowerCase();
  const id = (el.id   || '').toLowerCase();
  if (t === 'password' || t === 'email') return true;
  if (ac.match(/username|email|password/)) return true;
  if (nm.match(/user|email|login|mail|account/)) return true;
  if (id.match(/user|email|login|mail|account/)) return true;
  return false;
}

document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!isLoginField(el) || _autofillArmed) return;
  _autofillArmed = true;
  const r = el.getBoundingClientRect();
  const currentUrl = window.location.href;
  try { new URL(currentUrl); } catch { return; }
  if (currentUrl.startsWith('javascript:') || currentUrl.startsWith('data:')) return;
  ipcRenderer.sendToHost('vault:field-focused', {
    url: currentUrl.slice(0, 2048),
    rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width },
  });
}, true);

document.addEventListener('focusout', () => {
  setTimeout(() => {
    const active = document.activeElement;
    if (!active || !isLoginField(active)) _autofillArmed = false;
  }, 200);
}, true);

window.addEventListener('popstate',   () => { _autofillArmed = false; });
window.addEventListener('hashchange', () => { _autofillArmed = false; });

ipcRenderer.on('vault:fill', (_, { username, password }) => {
  const pwField   = document.querySelector('input[type="password"]');
  const userField =
    document.querySelector('input[type="email"]') ||
    document.querySelector('input[autocomplete="username"]') ||
    document.querySelector('input[autocomplete="email"]') ||
    document.querySelector('input[type="text"][name*="user"]') ||
    document.querySelector('input[type="text"][name*="email"]') ||
    document.querySelector('input[type="text"][name*="login"]') ||
    document.querySelector('input[type="text"]');

  function fillInput(el, value) {
    if (!el || !value) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }
  fillInput(userField, username);
  fillInput(pwField,   password);
  _autofillArmed = false;
});

function getCredentials(root) {
  const ctx = root || document;
  const pwField = ctx.querySelector('input[type="password"]');
  if (!pwField?.value) return null;
  let userField =
    ctx.querySelector('input[type="email"]') ||
    ctx.querySelector('input[autocomplete="username"]') ||
    ctx.querySelector('input[autocomplete="email"]') ||
    ctx.querySelector('input[type="text"][name*="user"]') ||
    ctx.querySelector('input[type="text"][name*="email"]') ||
    ctx.querySelector('input[type="text"][name*="login"]');
  if (!userField && root) {
    const inputs = Array.from(root.querySelectorAll('input[type="text"],input[type="email"]'));
    userField = inputs.find(i => i.compareDocumentPosition(pwField) & Node.DOCUMENT_POSITION_FOLLOWING) || inputs[0];
  }
  if (!userField) userField = document.querySelector('input[type="text"],input[type="email"]');
  return { username: userField?.value?.trim() || '', password: pwField.value, url: window.location.href };
}

document.addEventListener('submit', (e) => {
  const creds = getCredentials(e.target);
  if (creds?.password) ipcRenderer.sendToHost('vault:credentials-submitted', creds);
}, true);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[type="submit"],input[type="submit"]');
  if (!btn) return;
  setTimeout(() => {
    const creds = getCredentials(btn.closest('form'));
    if (creds?.password) {
      const safe = {
        url:      typeof creds.url      === 'string' ? creds.url.slice(0, 2048)  : '',
        username: typeof creds.username === 'string' ? creds.username.slice(0, 512)  : '',
        password: typeof creds.password === 'string' ? creds.password.slice(0, 4096) : '',
      };
      if (safe.url && safe.password) ipcRenderer.sendToHost('vault:credentials-submitted', safe);
    }
  }, 300);
}, true);

/* ══════════════════════════════════════════════════════════════
   6. FERMETURE CONTEXT MENU SUR CLIC GAUCHE
   Envoie un message IPC au renderer pour fermer le context menu.
   C'est la seule façon fiable — la webview est un process séparé
   et ses clics ne se propagent pas au document du renderer.
══════════════════════════════════════════════════════════════ */

document.addEventListener('mousedown', (e) => {
  // Clic gauche uniquement (button 0)
  if (e.button === 0) {
    ipcRenderer.sendToHost('hide-context-menu');
  }
}, true); // capture phase — avant tout autre handler

/* ══════════════════════════════════════════════════════════════
   7. DÉMARRAGE
══════════════════════════════════════════════════════════════ */

// Initialiser le DOM filter et les bloqueurs spécifiques
initDomFilter();
initYouTubeAdBlock();
initTwitchAdBlock();
initDailymotionAdBlock();