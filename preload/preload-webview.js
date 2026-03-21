'use strict';
/**
 * preload-webview.js
 * Injecté dans chaque page web chargée dans un webview.
 * - Déclenche l'autofill au focus d'un champ email/password/username
 * - Capture les credentials à la soumission du formulaire
 */

const { ipcRenderer } = require('electron');

/* ══════════════════════════════════════════════════════════════
   AUTOFILL — déclenché au focus d'un champ de login
══════════════════════════════════════════════════════════════ */
let _autofillArmed = false;

function isLoginField(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  const t  = (el.type || '').toLowerCase();
  const nm = (el.name || '').toLowerCase();
  const ac = (el.autocomplete || '').toLowerCase();
  const id = (el.id   || '').toLowerCase();

  if (t === 'password') return true;
  if (t === 'email')    return true;
  if (ac.match(/username|email|password/)) return true;
  if (nm.match(/user|email|login|mail|account/)) return true;
  if (id.match(/user|email|login|mail|account/)) return true;
  return false;
}

document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!isLoginField(el)) return;
  if (_autofillArmed) return;
  _autofillArmed = true;

  const r = el.getBoundingClientRect();
  // Valider l'URL avant de l'envoyer au renderer
  const currentUrl = window.location.href;
  try { new URL(currentUrl); } catch { return; } // URL invalide
  if (currentUrl.startsWith('javascript:') || currentUrl.startsWith('data:')) return;
  ipcRenderer.sendToHost('vault:field-focused', {
    url:  currentUrl.slice(0, 2048),
    rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width }
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

/* ── Remplissage depuis le renderer ────────────────────────── */
ipcRenderer.on('vault:fill', (_, { username, password }) => {
  const pwField   = document.querySelector('input[type="password"]');
  const userField = document.querySelector('input[type="email"]')
    || document.querySelector('input[autocomplete="username"]')
    || document.querySelector('input[autocomplete="email"]')
    || document.querySelector('input[type="text"][name*="user"]')
    || document.querySelector('input[type="text"][name*="email"]')
    || document.querySelector('input[type="text"][name*="login"]')
    || document.querySelector('input[type="text"]');

  function fillInput(el, value) {
    if (!el || !value) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  fillInput(userField, username);
  fillInput(pwField,   password);
  _autofillArmed = false;
});

/* ══════════════════════════════════════════════════════════════
   CAPTURE CREDENTIALS — soumission
══════════════════════════════════════════════════════════════ */
function getCredentials(root) {
  const ctx = root || document;
  const pwField = ctx.querySelector('input[type="password"]');
  if (!pwField?.value) return null;

  let userField = ctx.querySelector('input[type="email"]')
    || ctx.querySelector('input[autocomplete="username"]')
    || ctx.querySelector('input[autocomplete="email"]')
    || ctx.querySelector('input[type="text"][name*="user"]')
    || ctx.querySelector('input[type="text"][name*="email"]')
    || ctx.querySelector('input[type="text"][name*="login"]');

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
      // Valider avant envoi
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
   ANTI-FINGERPRINTING (injecté dans toutes les pages)
══════════════════════════════════════════════════════════════ */

// 1. Canvas fingerprinting — ajouter un bruit imperceptible
(function() {
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  const origToBlob = HTMLCanvasElement.prototype.toBlob;

  function addNoise(data) {
    // Modifier 1 pixel sur 1000 avec un bruit de ±1 — imperceptible visuellement
    for (let i = 0; i < data.data.length; i += 4 * 1000) {
      data.data[i]   = Math.max(0, Math.min(255, data.data[i]   + (Math.random() > 0.5 ? 1 : -1)));
      data.data[i+1] = Math.max(0, Math.min(255, data.data[i+1] + (Math.random() > 0.5 ? 1 : -1)));
    }
    return data;
  }

  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    const ctx = this.getContext('2d');
    if (ctx) {
      const imageData = origGetImageData.call(ctx, 0, 0, this.width, this.height);
      addNoise(imageData);
      ctx.putImageData(imageData, 0, 0);
    }
    return origToDataURL.apply(this, args);
  };
})();

// 2. AudioContext fingerprinting — bruit sur les données audio
(function() {
  if (typeof AudioBuffer === 'undefined') return;
  const origGetChannelData = AudioBuffer.prototype.getChannelData;
  AudioBuffer.prototype.getChannelData = function(channel) {
    const data = origGetChannelData.call(this, channel);
    for (let i = 0; i < data.length; i += 1000) {
      data[i] += Math.random() * 0.0001 - 0.00005;
    }
    return data;
  };
})();

// 3. Navigator properties — valeurs cohérentes
(function() {
  // Masquer qu'on est sous Electron/WebView
  const nav = navigator;
  try {
    Object.defineProperty(nav, 'webdriver', { get: () => false });
  } catch {}
})();

/* ══════════════════════════════════════════════════════════════
   AD BLOCKER — YouTube & plateformes vidéo
   Activé seulement si blockYoutubeAds = true dans les settings
══════════════════════════════════════════════════════════════ */

(function() {
  const host = window.location.hostname;

  // Vérifier si le bloqueur est activé via IPC
  ipcRenderer.invoke('settings:getPublic').then(settings => {
    if (!settings?.blockYoutubeAds) return;

    if (host.includes('youtube.com')) initYouTubeAdBlock();
    if (host.includes('twitch.tv'))   initTwitchAdBlock();
    if (host.includes('dailymotion')) initDailymotionAdBlock();
  }).catch(() => {});

  /* ── YouTube ─────────────────────────────────────────────── */
  function initYouTubeAdBlock() {

    // Sélecteurs des éléments publicitaires YouTube
    const AD_SELECTORS = [
      '.ytp-ad-module',
      '.ytp-ad-overlay-container',
      '.ytp-ad-text-overlay',
      '.ytp-ad-image-overlay',
      '.ytp-ad-action-interstitial',
      '.ytp-ad-skip-button-container',
      '#masthead-ad',
      '#player-ads',
      '.ytd-banner-promo-renderer',
      'ytd-promoted-video-renderer',
      'ytd-promoted-sparkles-web-renderer',
      'ytd-display-ad-renderer',
      'ytd-rich-item-renderer:has(.ytd-ad-slot-renderer)',
      '.ytd-ad-slot-renderer',
      'ad-slot-renderer',
      'ytd-action-companion-ad-renderer',
      'ytd-companion-slot-renderer',
    ];

    // Cliquer sur "Passer la pub" dès qu'il apparaît
    const SKIP_SELECTORS = [
      '.ytp-skip-ad-button',
      '.ytp-ad-skip-button',
      '.ytp-ad-skip-button-modern',
      'button.ytp-skip-ad-button',
    ];

    // Couper le son pendant une pub (backup si skip impossible)
    function muteIfAd() {
      const video = document.querySelector('video');
      const adPlaying = !!document.querySelector('.ad-showing');
      if (video && adPlaying) {
        video.muted  = true;
        video.volume = 0;
        // Tenter le skip
        for (const sel of SKIP_SELECTORS) {
          const btn = document.querySelector(sel);
          if (btn) { btn.click(); break; }
        }
      } else if (video && !adPlaying && video.volume === 0) {
        video.muted  = false;
        video.volume = 1;
      }
    }

    function removeAdElements() {
      for (const sel of AD_SELECTORS) {
        document.querySelectorAll(sel).forEach(el => el.remove());
      }
    }

    function trySkip() {
      for (const sel of SKIP_SELECTORS) {
        const btn = document.querySelector(sel);
        if (btn) { btn.click(); return true; }
      }
      return false;
    }

    // Accélérer la vidéo pub pour atteindre le skip plus vite
    function speedUpAd() {
      const video = document.querySelector('video');
      if (video && document.querySelector('.ad-showing')) {
        video.playbackRate = 16;
        if (!trySkip()) {
          // Si pas de bouton skip : attendre la fin
        }
      } else if (video) {
        if (video.playbackRate === 16) video.playbackRate = 1;
      }
    }

    // Observateur mutations DOM (YouTube est une SPA)
    const observer = new MutationObserver(() => {
      removeAdElements();
      speedUpAd();
      muteIfAd();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree:   true,
    });

    // Vérification périodique (fallback pour les pubs en mid-roll)
    const interval = setInterval(() => {
      removeAdElements();
      speedUpAd();
    }, 300);

    // Nettoyage à la navigation SPA
    window.addEventListener('yt-navigate-start', () => {
      clearInterval(interval);
      observer.disconnect();
    });

    // Désactiver les requêtes vers les serveurs de pubs YouTube
    // (déjà géré côté session Electron pour persist:main)

    console.log('[Discowl] YouTube ad blocker active');
  }

  /* ── Twitch ──────────────────────────────────────────────── */
  function initTwitchAdBlock() {
    const TWITCH_AD_SELECTORS = [
      '[data-a-target="ad-overlay"]',
      '.ad-overlay',
      '.tw-ad',
      '[class*="AdBanner"]',
      '[class*="ad-banner"]',
    ];

    // Twitch utilise les HLS streams — on ne peut pas bloquer au niveau réseau
    // sans casser le stream. On supprime l'UI pub et on mute.
    const observer = new MutationObserver(() => {
      TWITCH_AD_SELECTORS.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove());
      });

      // Mute pendant la pub Twitch
      const video = document.querySelector('video');
      const adBanner = document.querySelector('[data-a-target="ad-overlay"]');
      if (video && adBanner) { video.muted = true; video.volume = 0; }
      else if (video && video.volume === 0) { video.muted = false; video.volume = 1; }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    console.log('[Discowl] Twitch ad blocker active');
  }

  /* ── Dailymotion ─────────────────────────────────────────── */
  function initDailymotionAdBlock() {
    const DM_AD_SELECTORS = [
      '.adContainer',
      '.AdSlot',
      '[class*="Ad_"]',
      '[id*="Ads"]',
    ];

    const observer = new MutationObserver(() => {
      DM_AD_SELECTORS.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove());
      });
      // Auto-skip Dailymotion
      const skipBtn = document.querySelector('.skip_ad_button, .SkipButton, [class*="skip"]');
      if (skipBtn) skipBtn.click();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    console.log('[Discowl] Dailymotion ad blocker active');
  }

})();