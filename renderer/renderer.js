/* ─── renderer/renderer.js ──────────────────────────────────────
   Core browser UI logic:
   • Tab management (regular + private)
   • Navigation & URL bar
   • Search engine routing
   • Keyboard shortcuts
   • Sandwich menu
   • New tab page / speed dial
   • Toast notifications
─────────────────────────────────────────────────────────────── */

'use strict';

/* ══════════════════════════════════════════════════════════════
   SEARCH ENGINE DEFINITIONS
══════════════════════════════════════════════════════════════ */
const ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=', favicon: 'https://duckduckgo.com/favicon.png' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=', favicon: 'https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=', favicon: 'https://www.bing.com/sa/simg/favicon-2x.ico' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=', favicon: 'https://www.google.com/s2/favicons?sz=64&domain=search.brave.com' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=', favicon: 'https://www.google.com/s2/favicons?sz=64&domain=www.ecosia.org' },
  qwant: { name: 'Qwant', url: 'https://www.qwant.com/?q=', favicon: 'https://www.google.com/s2/favicons?sz=64&domain=www.qwant.com' },
};

/* ══════════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════ */
let tabs          = [];
let activeTabId   = null;
let tabCounter    = 0;
let settings      = {};
let currentEngine = 'duckduckgo';
let sandwichOpen  = false;

/* ══════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   LOCK SCREEN
══════════════════════════════════════════════════════════════ */
async function initLockScreen() {
  const enabled = await window.discowlAPI.password.isEnabled().catch(() => false);
  if (!enabled) return;

  const screen    = document.getElementById('lock-screen');
  const input     = document.getElementById('lock-pw-input');
  const errorDiv  = document.getElementById('lock-error');
  const unlockBtn = document.getElementById('lock-unlock-btn');
  const closeBtn  = document.getElementById('lock-close-btn');
  const eyeBtn    = document.getElementById('lock-eye-btn');

  if (!screen) return;

  screen.style.display         = 'flex';
  screen.style.alignItems      = 'center';
  screen.style.justifyContent  = 'center';

  setTimeout(() => input?.focus(), 120);

  eyeBtn?.addEventListener('click', () => {
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  });

  input?.addEventListener('focus', () => { if (input) input.style.borderColor = 'var(--accent)'; });
  input?.addEventListener('blur',  () => { if (input) input.style.borderColor = 'var(--border)'; });

  async function tryUnlock() {
    const pwd = input?.value || '';
    if (!pwd) { if (errorDiv) errorDiv.textContent = 'Please enter your password'; return; }

    if (unlockBtn) { unlockBtn.textContent = 'Verifying…'; unlockBtn.disabled = true; unlockBtn.style.opacity = '.6'; }
    if (errorDiv)  errorDiv.textContent = '';

    try {
      const ok = await window.discowlAPI.password.verify(pwd);
      if (ok) {
        screen.style.transition = 'opacity .25s';
        screen.style.opacity    = '0';
        setTimeout(() => { screen.style.display = 'none'; }, 260);
      } else {
        if (errorDiv) errorDiv.textContent = '✗ Incorrect password';
        if (input) { input.value = ''; input.focus(); }
        const panel = document.getElementById('lock-panel');
        if (panel) { panel.style.animation = 'none'; panel.offsetHeight; panel.style.animation = 'lockShake .35s ease'; }
      }
    } catch(e) {
      if (errorDiv) errorDiv.textContent = 'Error — try again';
    } finally {
      if (unlockBtn) { unlockBtn.textContent = 'Unlock'; unlockBtn.disabled = false; unlockBtn.style.opacity = ''; }
    }
  }

  unlockBtn?.addEventListener('click', tryUnlock);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
  closeBtn?.addEventListener('click', () => window.close());
}

document.addEventListener('DOMContentLoaded', async () => {
  // createTab DOIT être appelé quoi qu'il arrive — on l'enveloppe dans un try/finally
  try {
    settings      = await window.discowlAPI.settings.get();
    currentEngine = settings.defaultEngine || 'duckduckgo';

    // Appliquer la langue AVANT tout affichage
    if (window.i18n) {
      window.i18n.setLang(settings.language || 'en');
    }

    // Appliquer le thème AVANT tout affichage pour éviter le flash
    applyTheme(settings.theme || 'dark');

    updateEngineUI();
    setupToolbar();
    setupSandwichMenu();
    setupKeyboardShortcuts();
    setupNewTabPage();

  // Fermer le context menu sur tout clic dans la zone de contenu,
  // y compris quand la webview n'est pas encore active
  document.getElementById('webview-container')?.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.ctx-menu')) window._hideContextMenu?.();
  });
  document.getElementById('new-tab-page')?.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.ctx-menu, #star-popup, .ntp-bg-dock, .ntp-bg-btn')) {
      window._hideContextMenu?.();
    }
  });
    applySettings(settings);
    updateTorIndicator();
    window.DownloadManager?.init();
    initMenubar();
    initVaultBanners();
    initCustomTitlebar();
    initNtpBackground();
    initTorUI();

    // Appliquer les traductions sur tout le DOM statique
    if (window.i18n) window.i18n.apply();

    // Nouvelles fenêtres demandées par des sites → ouvrir en onglet
    window.addEventListener('discowl:open-tab', (e) => {
      const activePrivate = getActiveTab()?.isPrivate ?? false;
      createTab(e.detail.url, activePrivate);
    });
  } catch(e) {
    console.error('[Init] Erreur pendant le démarrage :', e);
  } finally {
    // Toujours ouvrir l'onglet initial — même si une étape précédente a planté
    if (tabs.length === 0) {
      createTab('about:newtab', false);
      updateNewtabMode(false);
    }
  }

  // Lock screen — après l'onglet, en parallèle, jamais bloquant
  initLockScreen().catch(() => {});
});

/* ══════════════════════════════════════════════════════════════
   PUBLIC API (used by components)
══════════════════════════════════════════════════════════════ */
window.DiscowlBrowser = {
  navigate:          (url)   => navigateActive(url),
  getCurrentUrl:     ()      => getActiveTab()?.url   || '',
  getActiveTab:      ()      => getActiveTab(),
  getCurrentTitle:   ()      => getActiveTab()?.title || '',
  setEngine:         (key)   => setEngine(key),
  setTheme:          (theme) => applyTheme(theme),
  onSettingsChanged: (s)     => { settings = s; applySettings(s); if (window.i18n && s.language) { window.i18n.setLang(s.language); window.i18n.apply(); } },
  applyToolbarConfig: (cfg)  => applyToolbarConfig(cfg),
  getTabById:        (id)    => getTab(id),
  switchToTab:       (id)    => switchTab(id),
  closeTab:          (id)    => closeTab(id),
  openDownloadsTab:  ()      => _openDownloadsTab(),
  openPasswordsTab:    ()    => _openPasswordsTab(),
  closePasswordsTab:   ()    => _closePasswordsTab(),
  openCustomizeTab:    ()    => _openCustomizeTab(),
  closeCustomizeTab:   ()    => _closeCustomizeTab()
};

/* ══════════════════════════════════════════════════════════════
   DOWNLOADS TAB
══════════════════════════════════════════════════════════════ */

function _openCustomizeTab() {
  const existing = tabs.find(t => t.isCustomizeTab);
  if (existing) { switchTab(existing.id); return; }

  const id = ++tabCounter;
  const webview = document.createElement('webview');
  webview.setAttribute('partition', 'persist:main');
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no');
  webview.dataset.tabId = id;
  document.getElementById('webview-container').appendChild(webview);

  const tab = {
    id, title: i18n.t('tab.customize'), url: 'about:customize-toolbar',
    favicon: '', isPrivate: false, isLoading: false,
    partition: 'persist:main', webview,
    canGoBack: false, canGoForward: false, zoom: 1,
    isCustomizeTab: true,
    _prevWasNewtab: false, _nextAfterNewtab: ''
  };

  tabs.push(tab);
  renderTabItem(tab);
  switchTab(id);
}

function _closeCustomizeTab() {
  const tab = tabs.find(t => t.isCustomizeTab);
  if (tab) closeTab(tab.id);
}

function _openPasswordsTab() {
  // Si un onglet passwords existe déjà, le réactiver
  const existing = tabs.find(t => t.isPasswordsTab);
  if (existing) { switchTab(existing.id); return; }

  const id = ++tabCounter;
  const webview = document.createElement('webview');
  webview.setAttribute('partition', 'persist:main');
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no');
  webview.dataset.tabId = id;
  document.getElementById('webview-container').appendChild(webview);

  const tab = {
    id, title: 'Passwords', url: 'about:passwords', favicon: '',
    isPrivate: false, isLoading: false, partition: 'persist:main', webview,
    canGoBack: false, canGoForward: false, zoom: 1,
    isPasswordsTab: true,
    _prevWasNewtab: false, _nextAfterNewtab: ''
  };

  tabs.push(tab);
  renderTabItem(tab);
  switchTab(id);
}

function _closePasswordsTab() {
  const tab = tabs.find(t => t.isPasswordsTab);
  if (tab) closeTab(tab.id);
}

function _openDownloadsTab() {
  const id = ++tabCounter;
  const partition = 'persist:main';

  // Webview factice non chargé (comme about:newtab)
  const webview = document.createElement('webview');
  webview.setAttribute('partition', partition);
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no');
  webview.dataset.tabId = id;
  // Ne pas définir src → pas de chargement
  document.getElementById('webview-container').appendChild(webview);

  const tab = {
    id,
    title:     i18n.t('tab.downloads'),
    url:       'about:downloads',
    favicon:   '',
    isPrivate: false,
    isLoading: false,
    partition,
    webview,
    canGoBack: false,
    canGoForward: false,
    zoom: 1,
    isDownloadsTab: true,
    _prevWasNewtab: false,
    _nextAfterNewtab: ''
  };

  tabs.push(tab);
  renderTabItem(tab);
  switchTab(id);
  return id;
}

/* ══════════════════════════════════════════════════════════════
   TAB MANAGEMENT
══════════════════════════════════════════════════════════════ */
function createTab(url = 'about:newtab', isPrivate = false) {
  // Si "Toujours en mode privé" est activé, forcer isPrivate
  // Exception : ne pas forcer sur les pages internes (passwords, settings, etc.)
  const internalPages = ['about:passwords', 'about:customize-toolbar', 'about:downloads'];
  if (settings.alwaysPrivate && !internalPages.includes(url)) {
    isPrivate = true;
  }
  const id        = ++tabCounter;
  const partition = isPrivate
    ? `partition:private-${id}`  // Not persisted = private session
    : 'persist:main';             // Shared, persisted session

  /* ─── Create webview element ─────────────────────────────── */
  const webview = document.createElement('webview');
  webview.setAttribute('partition', partition);
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no');
  // Injecter le content script pour la détection de formulaires
  if (window.discowlAPI?.webviewPreload) {
    webview.setAttribute('preload', 'file://' + window.discowlAPI.webviewPreload);
  }
  webview.dataset.tabId = id;

  const targetUrl = resolveUrl(url);
  if (targetUrl !== 'about:newtab') {
    webview.setAttribute('src', targetUrl);
  }

  document.getElementById('webview-container').appendChild(webview);

  /* ─── Tab state ──────────────────────────────────────────── */
  const tab = {
    id,
    title:     isPrivate ? i18n.t('tab.private_home') : i18n.t('tab.home'),
    url:       targetUrl === 'about:newtab' ? '' : targetUrl,
    favicon:   '',
    isPrivate,
    isLoading: targetUrl !== 'about:newtab',
    partition,
    webview,
    canGoBack: false,
    canGoForward: false,
    zoom: 1,
    // Historique virtuel pour naviguer vers/depuis le newtab
    _prevWasNewtab: false,   // true si on est venu du newtab
    _nextAfterNewtab: ''     // URL à recharger si on fait forward depuis newtab
  };

  tabs.push(tab);

  /* ─── Webview event listeners ────────────────────────────── */
  // ── Fermer le context menu dès qu'on interagit avec la webview ──
  // Les évts mousedown/click ne se propagent pas depuis la webview
  // (process séparé). On écoute focus et did-start-navigate à la place.
  webview.addEventListener('focus', () => window._hideContextMenu?.());

  // Recevoir le signal de clic gauche depuis le preload-webview
  // C'est la SEULE façon fiable de détecter un clic dans le process séparé
  webview.addEventListener('ipc-message', (e) => {
    if (e.channel === 'hide-context-menu') {
      window._hideContextMenu?.();
    }
  });

  webview.addEventListener('did-start-loading', () => {
    window._hideContextMenu?.();
    tab.isLoading = true;
    refreshTab(id);
    if (activeTabId === id) { updateNavButtons(); updateReloadBtn(true); }
  });

  webview.addEventListener('did-stop-loading', () => {
    tab.isLoading    = false;
    tab.canGoBack    = webview.canGoBack();
    tab.canGoForward = webview.canGoForward();
    refreshTab(id);
    if (activeTabId === id) {
      updateNavButtons();
      updateReloadBtn(false);
      updateUrlBar(tab.url);
    }
  });

  webview.addEventListener('did-navigate', (e) => {
    tab.url          = e.url;
    tab.canGoBack    = webview.canGoBack();
    tab.canGoForward = webview.canGoForward();
    refreshTab(id);
    if (activeTabId === id) {
      updateNavButtons(); // ← Bug 2 fix : manquait ici
      updateUrlBar(e.url);
      updateSecurityIcon(e.url);
      updateBookmarkStar(e.url);
    }
    if (!isPrivate && e.url && !e.url.startsWith('about:')) {
      HistoryManager.addEntry(tab.title, e.url, tab.favicon);
    }
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame) {
      tab.url          = e.url;
      // Bug 1 fix : les SPAs naviguent ici — mettre à jour canGoForward aussi
      tab.canGoBack    = webview.canGoBack();
      tab.canGoForward = webview.canGoForward();
      if (activeTabId === id) {
        updateNavButtons();
        updateUrlBar(e.url);
        updateBookmarkStar(e.url);
      }
      if (!isPrivate && e.url && !e.url.startsWith('about:')) {
        HistoryManager.addEntry(tab.title, e.url, tab.favicon);
      }
    }
  });

  webview.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || tab.url;
    refreshTab(id);
    if (activeTabId === id) {
      document.title = `${e.title} — Discowl`;
      updateFakeTitlebarTitle(e.title);
    }
  });

  webview.addEventListener('page-favicon-updated', (e) => {
    // Ignorer si l'onglet est sur le newtab (pas d'URL = homepage)
    if (!tab.url) return;
    if (e.favicons?.length) {
      tab.favicon = e.favicons[0];
      refreshTab(id);
    }
  });

  // Toute tentative d'ouvrir une nouvelle fenêtre → nouvel onglet
  // Géré principalement par setWindowOpenHandler dans main.js (web-contents-created)
  // Le fallback ici couvre les cas où l'événement webview 'new-window' est émis
  webview.addEventListener('new-window', (e) => {
    e.preventDefault();
    if (e.url && e.url !== 'about:blank') createTab(e.url, isPrivate);
  });

  webview.addEventListener('close', () => {
    closeTab(id);
  });
  /* ── Vault: messages depuis le content script (preload-webview) ── */
  webview.addEventListener('ipc-message', (e) => {
    if (e.channel === 'vault:credentials-submitted') {
      const { username, password, url } = e.args[0] || {};
      if (password && !isPrivate) {
        // Vérifier si ces credentials existent déjà avant de proposer
        window.discowlAPI.vault.getForHost(url).then(existing => {
          const alreadySaved = existing?.some(e =>
            e.username === username
          );
          if (!alreadySaved) showSavePrompt(url, username, password, webview);
        }).catch(() => {
          showSavePrompt(url, username, password, webview);
        });
      }
    }
    if (e.channel === 'vault:field-focused') {
      const { url, rect } = e.args[0] || {};
      if (url && !isPrivate) {
        offerAutofill(url, webview, rect);
      }
    }
  });

  webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return; // Aborted — user navigated away
    tab.isLoading = false;
    tab.title = i18n.t('tab.error');
    refreshTab(id);
  });

  webview.addEventListener('update-target-url', (e) => {
    if (activeTabId === id) {
      document.getElementById('status-text').textContent = e.url || '';
    }
  });

  webview.addEventListener('context-menu', (e) => {
    e.preventDefault();
    // Fermer tous les panels ouverts
    closeAllPanels();
    // Afficher le menu contextuel
    if (window._showContextMenu) {
      window._showContextMenu(webview, e.params, e.params.x, e.params.y);
    }
  });

  // Clic dans la webview → fermer tous les panels
  webview.addEventListener('mousedown', () => {
    closeAllPanels();
    window._hideContextMenu?.();
  });

  /* ─── Render tab bar item ────────────────────────────────── */
  renderTabItem(tab);

  /* ─── Switch to this tab ─────────────────────────────────── */
  switchTab(id);

  return id;
}


const ICON_PLUS   = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON_RELOAD = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10 2A5 5 0 1 0 11 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8.5.5l2 1.5-1.5 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_MUTE   = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 4h2l3-3v10L3 8H1V4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 4l2 2-2 2M11 4L9 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const ICON_DUP    = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="1" width="7" height="8" rx="1.2" stroke="currentColor" stroke-width="1.3"/><path d="M1 4v7h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const ICON_WIN    = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="3" width="10" height="8" rx="1.2" stroke="currentColor" stroke-width="1.3"/><path d="M1 5h10" stroke="currentColor" stroke-width="1.3"/></svg>`;
const ICON_CLOSE  = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const ICON_CLOSE_O= `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 3h10M4 3V2h4v1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2 3l.8 7h6.4L10 3" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;

/* ─── Render a single tab bar item ──────────────────────────── */
function renderTabItem(tab) {
  const el = document.createElement('div');
  el.className = `tab${tab.isPrivate ? ' private' : ''}`;
  el.dataset.tabId = tab.id;
  el.role = 'tab';
  el.setAttribute('aria-selected', 'false');

  // Loading indicator / favicon
  const faviconSlot = document.createElement('div');
  faviconSlot.className = 'tab-favicon-slot';
  faviconSlot.style.cssText = 'width:14px;height:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;';

  if (!tab.url) {
    // Homepage — icône spéciale ou rien
    if (tab.isPrivate) {
      faviconSlot.innerHTML = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="5" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 13c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="12" y1="1" x2="2" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
    }
    // else : rien pour la home normale
  } else {
    const faviconImg = document.createElement('img');
    faviconImg.className = 'tab-favicon';
    faviconImg.src = tab.favicon || '';
    faviconImg.onerror = () => { faviconImg.style.display = 'none'; };
    if (!tab.favicon) faviconImg.style.display = 'none';
    faviconSlot.appendChild(faviconImg);
  }

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title;

  const close = document.createElement('button');
  close.className = 'tab-close';
  close.title = i18n.t('tab.close');
  close.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });

  if (tab.isPrivate) {
    const badge = document.createElement('span');
    badge.className = 'tab-private-badge';
    badge.title = i18n.t('tab.private');
    badge.textContent = '🕵';
    el.appendChild(badge);
  }

  el.appendChild(faviconSlot);
  el.appendChild(title);
  el.appendChild(close);

  el.addEventListener('click', () => switchTab(tab.id));

  // Middle click to close
  el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab.id); });

  // ── Drag & drop custom (fluide, curseur normal) ──
  // ── Drag Firefox-style : clone flottant + réordering en temps réel ──
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button')) return;

    const startX      = e.clientX;
    const startY      = e.clientY;
    const THRESHOLD   = 5;
    let   dragging    = false;
    let   ghost       = null;   // clone flottant
    let   lastInsertPos = null; // dernière position d'insertion

    const getTabsOrder = () => {
      const container = document.getElementById('tabs-container');
      return [...container.querySelectorAll('.tab[data-tab-id]')];
    };

    const startDrag = () => {
      dragging = true;
      document.body.style.userSelect  = 'none';
      document.body.style.cursor      = 'grabbing';

      // Créer le clone flottant
      const rect  = el.getBoundingClientRect();
      ghost       = el.cloneNode(true);
      ghost.style.cssText = `
        position: fixed;
        z-index: 99999;
        width: ${rect.width}px;
        height: ${rect.height}px;
        top: ${rect.top}px;
        left: ${rect.left}px;
        pointer-events: none;
        opacity: .85;
        box-shadow: 0 6px 24px rgba(0,0,0,.4);
        border-radius: 7px 7px 0 0;
        background: var(--bg-tab-active);
        border: 1px solid var(--border-strong);
        cursor: grabbing;
        transition: box-shadow .1s;
        will-change: transform;
      `;
      document.body.appendChild(ghost);

      // L'onglet original devient un placeholder transparent
      el.style.opacity  = '0';
      el.style.pointerEvents = 'none';
    };

    const findInsertTarget = (mouseX) => {
      // Masquer le ghost temporairement pour elementFromPoint
      if (ghost) ghost.style.display = 'none';
      const els = getTabsOrder().filter(t => t !== el);
      if (ghost) ghost.style.display = '';

      let best = null, bestDist = Infinity;
      for (const t of els) {
        const r   = t.getBoundingClientRect();
        const mid = r.left + r.width / 2;
        const d   = Math.abs(mouseX - mid);
        if (d < bestDist) { bestDist = d; best = { el: t, before: mouseX < mid }; }
      }
      return best;
    };

    const onMove = (me) => {
      if (!dragging) {
        const dx = Math.abs(me.clientX - startX);
        const dy = Math.abs(me.clientY - startY);
        if (dx > THRESHOLD || dy > THRESHOLD) startDrag();
        else return;
      }

      // Déplacer le clone
      if (ghost) {
        ghost.style.transform = `translate(${me.clientX - startX}px, ${me.clientY - startY}px)`;
      }

      // Réordonner en temps réel
      const target = findInsertTarget(me.clientX);
      if (!target) return;

      const container = document.getElementById('tabs-container');
      const newTabBtn = document.getElementById('new-tab-btn');
      const key = target.el.dataset.tabId + (target.before ? 'b' : 'a');
      if (key === lastInsertPos) return;
      lastInsertPos = key;

      if (target.before) {
        container.insertBefore(el, target.el);
      } else {
        container.insertBefore(el, target.el.nextSibling || newTabBtn);
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);

      // Supprimer le ghost
      ghost?.remove();
      ghost = null;

      // Restaurer l'onglet
      el.style.opacity       = '';
      el.style.pointerEvents = '';
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';

      if (!dragging) return;
      dragging = false;

      // Synchroniser tabs[] avec l'ordre DOM final
      const container = document.getElementById('tabs-container');
      const domOrder = [...container.querySelectorAll('.tab[data-tab-id]')]
        .map(t => parseInt(t.dataset.tabId, 10));
      tabs.sort((a, b) => domOrder.indexOf(a.id) - domOrder.indexOf(b.id));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // ── Clic droit sur l'onglet (menu contextuel Firefox-style) ──
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeAllPanels();

    const tabCtxItems = [
      { label: () => i18n.t('ctx.tab_new'),        icon: ICON_PLUS,    action: () => createTab('about:newtab', tab.isPrivate) },
      { sep: true },
      { label: () => i18n.t('ctx.tab_reload'),      icon: ICON_RELOAD,  action: () => { if (tab.webview && tab.url) tab.webview.reload(); } },
      { label: () => i18n.t('ctx.tab_mute'),        icon: ICON_MUTE,    action: () => { /* future */ }, disabled: true },
      { sep: true },
      { label: () => i18n.t('ctx.tab_duplicate'),   icon: ICON_DUP,     action: () => { if (tab.url) createTab(tab.url, tab.isPrivate); } },
      { label: () => i18n.t('ctx.tab_new_window'),  icon: ICON_WIN,     action: () => window.discowlAPI.openNewWindow() },
      { sep: true },
      { label: () => i18n.t('ctx.tab_close_others'),icon: ICON_CLOSE_O, action: () => { [...tabs].forEach(t => { if (t.id !== tab.id) closeTab(t.id); }); } },
      { label: () => i18n.t('ctx.tab_close'),       icon: ICON_CLOSE,   action: () => closeTab(tab.id), danger: true },
    ];

    // Construire le menu
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    tabCtxItems.forEach(it => {
      if (it.sep) {
        const s = document.createElement('div'); s.className = 'ctx-sep'; menu.appendChild(s); return;
      }
      const div = document.createElement('div');
      div.className = 'ctx-item' + (it.disabled ? ' ctx-disabled' : '') + (it.danger ? ' ctx-danger' : '');
      div.innerHTML = `<span class="ctx-icon">${it.icon}</span><span class="ctx-label">${it.label()}</span>`;
      if (!it.disabled) div.addEventListener('click', () => { document.body.removeChild(menu); it.action(); });
      menu.appendChild(div);
    });

    document.body.appendChild(menu);
    // Positionnement
    const r = el.getBoundingClientRect();
    const mw = 210, mh = menu.scrollHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = Math.min(e.clientX, vw - mw - 4) + 'px';
    menu.style.top  = Math.min(r.bottom + 2, vh - mh - 4) + 'px';

    const dismiss = (ev) => { if (!menu.contains(ev.target)) { document.body.contains(menu) && document.body.removeChild(menu); document.removeEventListener('mousedown', dismiss); } };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  });

  const container = document.getElementById('tabs-container');
  const newTabBtn  = document.getElementById('new-tab-btn');
  // Insérer avant le bouton + (Firefox-style : + toujours après le dernier onglet)
  if (newTabBtn) container.insertBefore(el, newTabBtn);
  else           container.appendChild(el);
}

/* ─── Refresh tab item in the tab bar ───────────────────────── */
function refreshTab(id) {
  const tab = getTab(id);
  if (!tab) return;
  const el = document.querySelector(`.tab[data-tab-id="${id}"]`);
  if (!el) return;

  const titleEl = el.querySelector('.tab-title');
  if (titleEl) titleEl.textContent = tab.title;

  const faviconSlot = el.querySelector('.tab-favicon-slot');
  if (faviconSlot) {
    if (tab.isLoading) {
      faviconSlot.innerHTML = `<div class="tab-loading"></div>`;
    } else if (!tab.url) {
      // Homepage — icône spéciale selon le type, pas de favicon web
      if (tab.isPrivate) {
        faviconSlot.innerHTML = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="5" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M2 13c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="12" y1="1" x2="2" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
      } else {
        faviconSlot.innerHTML = ''; // Aucune icône pour la home normale
      }
    } else {
      faviconSlot.innerHTML = '';
      const img = document.createElement('img');
      img.className = 'tab-favicon';
      img.src = tab.favicon || '';
      img.onerror = () => { img.style.display = 'none'; };
      if (!tab.favicon) img.style.display = 'none';
      faviconSlot.appendChild(img);
    }
  }
}

/* ─── Switch to a tab ────────────────────────────────────────── */
function switchTab(id) {
  const tab = getTab(id);
  if (!tab) return;

  activeTabId = id;

  // Hide all webviews, show active
  const webviewContainer = document.getElementById('webview-container');
  tabs.forEach(t => {
    t.webview.classList.remove('active');
    const el = document.querySelector(`.tab[data-tab-id="${t.id}"]`);
    if (el) { el.classList.remove('active'); el.setAttribute('aria-selected', 'false'); }
  });

  tab.webview.classList.add('active');
  const el = document.querySelector(`.tab[data-tab-id="${id}"]`);
  if (el) { el.classList.add('active'); el.setAttribute('aria-selected', 'true'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }

  // Show/hide new tab page / downloads page
  const ntpEl  = document.getElementById('new-tab-page');
  const dlPage = document.getElementById('downloads-page');

  const pwPage = document.getElementById('passwords-page');
  const ctPage = document.getElementById('customize-toolbar-page');
  if (tab.isCustomizeTab) {
    ntpEl?.classList.add('hidden');
    dlPage?.classList.add('hidden');
    pwPage?.classList.add('hidden');
    webviewContainer?.querySelectorAll('webview').forEach(wv => wv.classList.remove('active'));
    window.ToolbarCustomizer?.show();
  } else if (tab.isPasswordsTab) {
    ntpEl?.classList.add('hidden');
    dlPage?.classList.add('hidden');
    ctPage?.classList.add('hidden');
    webviewContainer?.querySelectorAll('webview').forEach(wv => wv.classList.remove('active'));
    window.PasswordsManager?.show();
  } else if (tab.isDownloadsTab) {
    ntpEl?.classList.add('hidden');
    pwPage?.classList.add('hidden');
    webviewContainer?.querySelectorAll('webview').forEach(wv => wv.classList.remove('active'));
    dlPage?.classList.remove('hidden');
    window.DownloadManager?.renderFullPage?.();
  } else {
    dlPage?.classList.add('hidden');
    pwPage?.classList.add('hidden');
    ctPage?.classList.add('hidden');
    if (ntpEl) ntpEl.classList.toggle('hidden', !!tab.url);
    if (!tab.url) {
      // Mettre à jour le titre selon le mode actuel (Tor peut avoir changé)
      tab.title = tab.isPrivate
        ? (settings.torEnabled ? i18n.t('tab.tor_home') : i18n.t('tab.private_home'))
        : i18n.t('tab.home');
      refreshTab(tab.id);
      updateNewtabMode(tab.isPrivate);
      clearNewtabSearch();
    }
  }

  updateUrlBar(tab.url);
  updateNavButtons();
  updateReloadBtn(tab.isLoading);
  updateSecurityIcon(tab.url);
  updateBookmarkStar(tab.url);
  updateZoomIndicator(tab);
  document.title = tab.title + ' — Discowl';

  // Appliquer/réinitialiser le zoom de la newtab à chaque changement d'onglet
  const inner = document.querySelector('.newtab-inner');
  if (inner) {
    if (!tab.url && tab.zoom && tab.zoom !== 1) {
      inner.style.transform = `scale(${tab.zoom})`;
      inner.style.transformOrigin = 'top center';
    } else {
      inner.style.transform = '';
      inner.style.transformOrigin = '';
    }
  }
}

/* ─── Close a tab ────────────────────────────────────────────── */
function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  tab.webview.remove();
  document.querySelector(`.tab[data-tab-id="${id}"]`)?.remove();
  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    // Dernier onglet fermé → fermer l'app
    window.close();
    return;
  }

  if (activeTabId === id) {
    // Activate previous or next tab
    const nextIdx = Math.min(idx, tabs.length - 1);
    switchTab(tabs[nextIdx].id);
  }
}

/* ──────────────────────────────────────────────────────────────
   NAVIGATION
────────────────────────────────────────────────────────────── */
window.navigateActive = navigateActive;
function navigateActive(url, _fromVirtualBack = false) {
  const tab = getActiveTab();
  if (!tab) return;
  const resolved = resolveUrl(url);
  const ntpEl    = document.getElementById('new-tab-page');

  if (resolved === 'about:newtab') {
    tab.webview.classList.remove('active');
    tab.url     = '';
    tab.favicon = '';
    tab.title   = tab.isPrivate ? (settings.torEnabled ? 'Tor Home' : 'Private Home') : 'Home';
    refreshTab(tab.id);
    if (ntpEl) ntpEl.classList.remove('hidden');
    updateNewtabMode(tab.isPrivate);
    // Réappliquer le fond (prioritaire sur tous les modes)
    try { if (settings.ntpBackground?.type) applyNtpBackground(settings.ntpBackground); } catch {}
    clearNewtabSearch();
    updateUrlBar('');
    // Activer le bouton back si on est venu d'une vraie page
    // (le retour vers newtab est possible via forward)
    document.getElementById('back-btn').disabled    = true;
    document.getElementById('forward-btn').disabled = !tab._nextAfterNewtab;
    updateBookmarkStar('');
    document.title = 'Discowl';
    return;
  }

  // Si on vient du newtab, mémoriser pour pouvoir y revenir avec back
  if (!tab.url) {
    tab._prevWasNewtab = true;
    tab._nextAfterNewtab = '';   // reset forward
  }

  // Navigation normale : cacher NTP, activer le webview
  if (ntpEl) ntpEl.classList.add('hidden');
  tab.webview.classList.add('active');
  tab.webview.src = resolved;
  tab.url         = resolved;
}

function resolveUrl(input) {
  if (!input || input === 'about:newtab' || input === 'about:blank') return 'about:newtab';
  input = input.trim();
  if (input.startsWith('about:') || input.startsWith('data:') || input.startsWith('file:') || input.startsWith('view-source:')) return input;
  // Detect URL (has protocol OR domain pattern)
  const hasProtocol = /^https?:\/\//i.test(input);
  const looksLikeUrl = /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/|$)/.test(input) && !input.includes(' ');
  if (hasProtocol) return input;
  if (looksLikeUrl) return 'https://' + input;
  // Otherwise: search
  const engine = ENGINES[currentEngine] || ENGINES.duckduckgo;
  return engine.url + encodeURIComponent(input);
}

function updateNavButtons() {
  const tab = getActiveTab();
  if (!tab) return;
  const canBack    = tab.canGoBack    || tab._prevWasNewtab;
  const canForward = tab.canGoForward || (!tab.url && !!tab._nextAfterNewtab);
  document.getElementById('back-btn').disabled    = !canBack;
  document.getElementById('forward-btn').disabled = !canForward;
}

function updateReloadBtn(isLoading) {
  const btn  = document.getElementById('reload-btn');
  const icon = document.getElementById('reload-icon');
  if (!btn || !icon) return;
  if (isLoading) {
    btn.title = 'Stop (Esc)';
    icon.innerHTML = `<path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`;
  } else {
    btn.title = 'Reload (F5)';
    icon.innerHTML = `<path d="M13.5 4.5A6 6 0 1014.8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M11 2l3 2.5-2.5 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
}

function updateZoomIndicator(tab) {
  // URL bar mini indicator (existing)
  const btn = document.getElementById('zoom-indicator');
  if (btn) {
    if (!tab || tab.zoom === 1 || !tab.zoom) {
      btn.classList.add('hidden');
    } else {
      btn.textContent = Math.round(tab.zoom * 100) + '%';
      btn.classList.remove('hidden');
    }
  }

  // Toolbar zoom control Firefox-style — toujours visible
  const toolbarZoom = document.getElementById('toolbar-zoom');
  const pctBtn      = document.getElementById('toolbar-zoom-pct');
  if (toolbarZoom && pctBtn) {
    const pct = Math.round((tab?.zoom ?? 1) * 100);
    pctBtn.textContent = pct + '%';
    // Toujours visible (comme Firefox)
    toolbarZoom.classList.remove('hidden');
    // Griser les boutons aux limites (zoom min/max)
    const outBtn = document.getElementById('toolbar-zoom-out');
    const inBtn  = document.getElementById('toolbar-zoom-in');
    if (outBtn) outBtn.disabled = (tab?.zoom ?? 1) <= 0.3;
    if (inBtn)  inBtn.disabled  = (tab?.zoom ?? 1) >= 3;
    // Mettre en évidence si zoom != 100%
    pctBtn.style.color = (pct !== 100) ? 'var(--accent)' : '';
    pctBtn.style.fontWeight = (pct !== 100) ? '600' : '500';
  }
}

function showNavHistoryMenu(direction, anchorEl) {
  const tab = getActiveTab();
  if (!tab) return;

  const menuId = direction === 'back' ? 'back-history-menu' : 'forward-history-menu';
  const menu   = document.getElementById(menuId);
  if (!menu) return;

  // Récupérer l'historique de navigation du webview
  tab.webview.getURL(); // force refresh
  const entries = tab.webview.getAllEntries ? tab.webview.getAllEntries() : [];

  if (entries.length === 0) return;

  const currentIdx = tab.webview.getCurrentEntryIndex ? tab.webview.getCurrentEntryIndex() : -1;
  const items = direction === 'back'
    ? entries.slice(0, currentIdx).reverse()
    : entries.slice(currentIdx + 1);

  if (items.length === 0) return;

  menu.innerHTML = '';
  items.slice(0, 12).forEach((entry, i) => {
    const item = document.createElement('div');
    item.className = 'nav-history-item';
    item.textContent = entry.title || entry.url || '(no title)';
    item.title = entry.url || '';
    item.addEventListener('click', () => {
      const offset = direction === 'back' ? -(i + 1) : (i + 1);
      tab.webview.goToOffset(offset);
      menu.classList.add('hidden');
    });
    menu.appendChild(item);
  });

  // Positionner le menu sous le bouton
  const rect = anchorEl.getBoundingClientRect();
  menu.style.left = rect.left + 'px';
  menu.style.top  = (rect.bottom + 4) + 'px';
  menu.classList.remove('hidden');

  // Fermer au prochain clic
  setTimeout(() => {
    document.addEventListener('click', () => menu.classList.add('hidden'), { once: true });
  }, 0);
}

function updateUrlBar(url) {
  const bar = document.getElementById('url-bar');
  if (bar !== document.activeElement) {
    bar.value = (!url || url === 'about:newtab') ? '' : url;
  }
}

function updateSecurityIcon(url) {
  const icon = document.getElementById('security-icon');
  if (!icon) return;
  if (!url || url.startsWith('about:')) {
    icon.className = 'security-icon insecure';
    icon.title = '';
  } else if (url.startsWith('https://')) {
    icon.className = 'security-icon';
    icon.title = i18n.t('nav.secure');
  } else {
    icon.className = 'security-icon warning';
    icon.title = i18n.t('nav.insecure');
  }
}

function updateBookmarkStar(url) {
  // Pour la homepage, vérifier l'URL configurée dans les settings
  let checkUrl = url;
  if (!checkUrl || checkUrl === 'about:newtab' || checkUrl.startsWith('about:')) {
    checkUrl = settings?.homePage;
  }
  if (window.BookmarksManager) {
    window.BookmarksManager.updateStarBtn(checkUrl || '');
  } else {
    const btn = document.getElementById('bookmark-star-btn');
    if (btn) btn.title = 'Add to bookmarks';
  }
}

/* ══════════════════════════════════════════════════════════════
   TOOLBAR SETUP
══════════════════════════════════════════════════════════════ */
function setupToolbar() {
  /* ─── Back/Forward/Reload/Home ─────────────────────────── */
  document.getElementById('back-btn').addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab) return;
    if (tab.webview.canGoBack()) {
      tab.webview.goBack();
    } else if (tab._prevWasNewtab) {
      tab._nextAfterNewtab = tab.url;
      tab._prevWasNewtab   = false;
      navigateActive('about:newtab');
    }
  });

  document.getElementById('back-btn').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showNavHistoryMenu('back', e.currentTarget);
  });

  document.getElementById('forward-btn').addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab) return;
    if (tab.webview.canGoForward()) {
      tab.webview.goForward();
    } else if (!tab.url && tab._nextAfterNewtab) {
      // Forward virtuel : newtab → page précédente
      // On ne remet PAS _prevWasNewtab=true ici — navigateActive() le fera
      // si nécessaire. Le reset de _nextAfterNewtab suffit.
      const next = tab._nextAfterNewtab;
      tab._nextAfterNewtab = '';
      navigateActive(next);
    }
  });

  document.getElementById('forward-btn').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showNavHistoryMenu('forward', e.currentTarget);
  });

  document.getElementById('reload-btn').addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab) return;
    if (tab.isLoading) { tab.webview.stop(); updateReloadBtn(false); }
    else tab.webview.reload();
  });

  document.getElementById('home-btn').addEventListener('click', () => {
    navigateActive('about:newtab');
  });

  /* ─── URL bar ───────────────────────────────────────────── */
  const urlBar = document.getElementById('url-bar');

  urlBar.addEventListener('focus', () => {
    urlBar.select();
  });

  urlBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = urlBar.value.trim();
      if (val) navigateActive(val);
      urlBar.blur();
    }
    if (e.key === 'Escape') {
      urlBar.blur();
      updateUrlBar(getActiveTab()?.url);
    }
  });

  /* ─── Bookmark star ─────────────────────────────────────── */
  document.getElementById('bookmark-star-btn').addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab) return;

    let url   = tab.url || document.getElementById('url-bar')?.value?.trim();
    let title = tab.title;

    // Homepage (about:newtab / url vide) → proposer l'URL de la page d'accueil configurée
    if (!url || url === 'about:newtab' || url.startsWith('about:')) {
      const homeUrl = settings?.homePage;
      if (!homeUrl || homeUrl === 'about:newtab' || homeUrl.startsWith('about:')) return;
      url   = homeUrl;
      title = i18n.t('tab.home') || 'Home';
    }

    // Nettoyer le titre (ne pas sauvegarder les noms internes)
    const internalTitles = [i18n.t('tab.home'), i18n.t('tab.private_home'), i18n.t('tab.tor_home')];
    if (!title || internalTitles.includes(title)) title = url;

    window.BookmarksManager?.openStarPopup(title, url);
  });

  /* ─── Zoom indicator ────────────────────────────────────── */
  document.getElementById('zoom-indicator')?.addEventListener('click', () => {
    zoomActive(0, true);
  });

  // Toolbar zoom control
  document.getElementById('toolbar-zoom-out')?.addEventListener('click', () => zoomActive(-0.1));
  document.getElementById('toolbar-zoom-in')?.addEventListener('click',  () => zoomActive(0.1));
  document.getElementById('toolbar-zoom-pct')?.addEventListener('click', () => zoomActive(0, true));

  /* ─── New tab buttons ───────────────────────────────────── */
  document.getElementById('new-tab-btn').addEventListener('click', () => {
    createTab('about:newtab', false);
  });

  document.getElementById('new-private-btn').addEventListener('click', () => {
    createTab('about:newtab', true);
  });

  /* ─── Engine selector ───────────────────────────────────── */
  const engineBtn  = document.getElementById('engine-selector-btn');
  const engineDrop = document.getElementById('engine-dropdown');

  engineBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    engineDrop.classList.toggle('hidden');
  });

  document.querySelectorAll('.engine-option').forEach(opt => {
    opt.addEventListener('click', () => {
      setEngine(opt.dataset.engine);
      engineDrop.classList.add('hidden');
    });
  });

  // Close engine dropdown on outside click
  document.addEventListener('click', () => engineDrop.classList.add('hidden'));
}

function setEngine(key) {
  if (!ENGINES[key]) return;
  currentEngine = key;
  settings.defaultEngine = key;
  window.discowlAPI.settings.save({ ...settings, defaultEngine: key });
  updateEngineUI();
  showToast(`Engine: ${ENGINES[key].name}`, 'info');
}

function updateEngineUI() {
  const engine = ENGINES[currentEngine] || ENGINES.duckduckgo;
  const iconEl = document.getElementById('engine-icon');
  if (iconEl) { iconEl.innerHTML = `<img src="${engine.favicon}" width="16" height="16" style="display:block;object-fit:contain" />`; }

  document.querySelectorAll('.engine-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.engine === currentEngine);
  });
}

/* ══════════════════════════════════════════════════════════════
   SANDWICH MENU
══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   CUSTOM MENUBAR
══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   VAULT — PROMPT DE SAUVEGARDE & AUTOFILL
══════════════════════════════════════════════════════════════ */

let _pendingSave = null;   // {url, username, password, webview}
let _savePromptTimer = null;

function showSavePrompt(url, username, password, webview) {
  try { new URL(url); } catch { return; }
  const host = new URL(url).hostname;

  // Annuler le prompt précédent si présent
  dismissSavePrompt();

  _pendingSave = { url, username, password, webview };

  const banner = document.getElementById('vault-save-banner');
  if (!banner) return;

  document.getElementById('vault-save-host').textContent     = host;
  document.getElementById('vault-save-username').textContent = username || '(no username)';

  banner.classList.remove('hidden');
  banner.style.animation = 'vaultBannerIn .2s ease';

  // Auto-dismiss après 15s
  _savePromptTimer = setTimeout(dismissSavePrompt, 15000);
}

function dismissSavePrompt() {
  if (_savePromptTimer) { clearTimeout(_savePromptTimer); _savePromptTimer = null; }
  const banner = document.getElementById('vault-save-banner');
  if (banner) banner.classList.add('hidden');
  _pendingSave = null;
}

async function offerAutofill(url, webview, fieldRect) {
  if (!window.discowlAPI?.vault) return;
  try {
    const creds = await window.discowlAPI.vault.getForHost(url);
    if (!creds?.length) return;

    const banner = document.getElementById('vault-autofill-banner');
    if (!banner) return;

    const list = document.getElementById('vault-autofill-list');
    if (!list) return;
    list.innerHTML = '';

    creds.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'vault-autofill-item';
      btn.innerHTML = `<span class="vault-autofill-user">${escHtml(c.username || '(no username)')}</span><span class="vault-autofill-host">${escHtml(new URL(url).hostname)}</span>`;
      btn.addEventListener('click', () => {
        webview.send('vault:fill', { username: c.username, password: c.password });
        dismissAutofill();
      });
      list.appendChild(btn);
    });

    // Positionner le banner sous le champ focusé dans le webview
    if (fieldRect) {
      const wvRect = webview.getBoundingClientRect();
      const absLeft   = wvRect.left + fieldRect.left;
      const absBottom = wvRect.top  + fieldRect.bottom;
      banner.style.left      = Math.max(4, absLeft) + 'px';
      banner.style.top       = (absBottom + 4) + 'px';
      banner.style.transform = 'none';
      banner.style.maxWidth  = Math.max(fieldRect.width, 260) + 'px';
    } else {
      // Fallback : centré sous la navbar
      banner.style.left      = '50%';
      banner.style.top       = '56px';
      banner.style.transform = 'translateX(-50%)';
      banner.style.maxWidth  = '560px';
    }

    banner.classList.remove('hidden');
    banner.style.animation = 'vaultBannerIn .15s ease';

    // Pas d'auto-dismiss — reste visible tant que l'utilisateur interagit
    clearTimeout(_autofillTimer);
    _autofillTimer = setTimeout(dismissAutofill, 12000);
  } catch {}
}

let _autofillTimer = null;

function dismissAutofill() {
  document.getElementById('vault-autofill-banner')?.classList.add('hidden');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function initVaultBanners() {
  // Save banner — Enregistrer
  document.getElementById('vault-save-yes')?.addEventListener('click', async () => {
    if (!_pendingSave) return;
    const { url, username, password } = _pendingSave;
    try {
      const host = new URL(url).hostname;
      await window.discowlAPI.vault.save(host, username, password);
      showToast(i18n.t('toast.password_saved'), 'success');
    } catch(e) {
      showToast(i18n.t('toast.password_save_error'), 'error');
    }
    dismissSavePrompt();
  });

  // Save banner — Pas maintenant
  document.getElementById('vault-save-no')?.addEventListener('click', dismissSavePrompt);

  // Save banner — Jamais pour ce site (simple dismiss pour l'instant)
  document.getElementById('vault-save-never')?.addEventListener('click', dismissSavePrompt);

  // Autofill banner — fermer
  document.getElementById('vault-autofill-close')?.addEventListener('click', dismissAutofill);
}


function positionNewtabLogo() {
  const brand  = document.querySelector('.newtab-brand');
  const title  = document.getElementById('newtab-title');
  const logo   = document.querySelector('.newtab-logo');
  if (!brand || !title || !logo) return;

  const brandRect = brand.getBoundingClientRect();
  const titleRect = title.getBoundingClientRect();
  const gap = 10; // px entre logo et titre

  // Centre du titre par rapport au brand container
  const titleCenter = titleRect.left - brandRect.left + titleRect.width / 2;
  // Logo doit se terminer à gauche du titre
  const logoLeft = titleCenter - titleRect.width / 2 - gap - logo.offsetWidth;

  brand.style.setProperty('--logo-left', logoLeft + 'px');
}


/* ══════════════════════════════════════════════════════════════
   CUSTOM TITLEBAR
   Mode natif  : frame Windows normal, rien à faire
   Mode custom : frameless, boutons −/□/× dans la menubar
══════════════════════════════════════════════════════════════ */
async function initCustomTitlebar() {
  const isCustom = await window.discowlAPI.window.customTitlebar().catch(() => false);
  if (!isCustom) return; // Mode natif — frame Windows, rien à faire

  // Frameless : activer les contrôles dans la menubar
  document.getElementById('window-controls')?.classList.remove('hidden');
  document.body.classList.add('custom-titlebar');

  // Attendre que les éléments soient visibles avant de mettre à jour l'icône
  const isMax = await window.discowlAPI.window.isMaximized().catch(() => false);
  setTimeout(() => _updateMaxIcon(isMax), 50);
  window.discowlAPI.window.onMaximized((v) => _updateMaxIcon(v));

  document.getElementById('wc-minimize')?.addEventListener('click', () => window.discowlAPI.window.minimize());
  document.getElementById('wc-maximize')?.addEventListener('click', () => window.discowlAPI.window.maximize());
  document.getElementById('wc-close')?.addEventListener('click',    () => window.discowlAPI.window.close());
  document.getElementById('menubar-drag')?.addEventListener('dblclick', () => window.discowlAPI.window.maximize());

  initSnapLayouts();
  initResizeHandles();
}

function _updateMaxIcon(isMax) {
  document.body.classList.toggle('window-maximized', isMax);
  const icon = document.getElementById('wc-max-icon');
  if (!icon) return;
  icon.innerHTML = isMax
    ? `<rect x="4" y="2" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.4" fill="none"/>` +
      `<rect x="2" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.4" fill="none" style="fill:var(--bg-base)"/>`
    : `<rect x="2" y="2" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.4" fill="none"/>`;
  const btn = document.getElementById('wc-maximize');
  if (btn) btn.title = isMax ? i18n.t('nav.restore') : i18n.t('nav.maximize');
}


/* ══════════════════════════════════════════════════════════════
   SNAP LAYOUTS — popup Windows 11 style au hover du bouton maximize
══════════════════════════════════════════════════════════════ */
function initSnapLayouts() {
  const btn = document.getElementById('wc-maximize');
  if (!btn) return;

  let _popup = null;
  let _hideTimer = null;

  // 6 groupes exactement comme Windows 11 Snap Layouts
  // Chaque groupe = une miniature avec zones colorables individuellement
  const LAYOUTS = [
    // Groupe 1 : plein écran
    { id: 'full', label: i18n.t('snap.full'),
      zones: [{x:0,y:0,w:1,h:1}],
      active: [0],
      calc: (w) => [{ x:w.x, y:w.y, width:w.width, height:w.height }] },

    // Groupe 2 : 1/2 | 1/2
    { id: 'half-half', label: i18n.t('snap.half'),
      zones: [{x:0,y:0,w:.5,h:1},{x:.5,y:0,w:.5,h:1}],
      active: [0],
      calc: (w) => [
        { x:w.x, y:w.y, width:Math.floor(w.width/2), height:w.height },
        { x:w.x+Math.floor(w.width/2), y:w.y, width:Math.ceil(w.width/2), height:w.height }
      ] },

    // Groupe 3 : 1/3 | 1/3 | 1/3
    { id: 'thirds', label: i18n.t('snap.thirds'),
      zones: [{x:0,y:0,w:.33,h:1},{x:.33,y:0,w:.34,h:1},{x:.67,y:0,w:.33,h:1}],
      active: [0],
      calc: (w) => [
        { x:w.x, y:w.y, width:Math.floor(w.width/3), height:w.height },
        { x:w.x+Math.floor(w.width/3), y:w.y, width:Math.floor(w.width/3), height:w.height },
        { x:w.x+Math.floor(w.width*2/3), y:w.y, width:Math.ceil(w.width/3), height:w.height }
      ] },

    // Groupe 4 : 2/3 | 1/3
    { id: 'two-third', label: i18n.t('snap.two_third'),
      zones: [{x:0,y:0,w:.67,h:1},{x:.67,y:0,w:.33,h:1}],
      active: [0],
      calc: (w) => [
        { x:w.x, y:w.y, width:Math.floor(w.width*2/3), height:w.height },
        { x:w.x+Math.floor(w.width*2/3), y:w.y, width:Math.ceil(w.width/3), height:w.height }
      ] },

    // Groupe 5 : 1/2 | 1/4 / 1/4
    { id: 'half-quarter', label: i18n.t('snap.half_quarter'),
      zones: [{x:0,y:0,w:.5,h:1},{x:.5,y:0,w:.5,h:.5},{x:.5,y:.5,w:.5,h:.5}],
      active: [0],
      calc: (w) => [
        { x:w.x, y:w.y, width:Math.floor(w.width/2), height:w.height },
        { x:w.x+Math.floor(w.width/2), y:w.y, width:Math.ceil(w.width/2), height:Math.floor(w.height/2) },
        { x:w.x+Math.floor(w.width/2), y:w.y+Math.floor(w.height/2), width:Math.ceil(w.width/2), height:Math.ceil(w.height/2) }
      ] },

    // Groupe 6 : 1/4 | 1/4 | 1/4 | 1/4
    { id: 'quarters', label: i18n.t('snap.quarters'),
      zones: [{x:0,y:0,w:.5,h:.5},{x:.5,y:0,w:.5,h:.5},{x:0,y:.5,w:.5,h:.5},{x:.5,y:.5,w:.5,h:.5}],
      active: [0],
      calc: (w) => [
        { x:w.x, y:w.y, width:Math.floor(w.width/2), height:Math.floor(w.height/2) },
        { x:w.x+Math.floor(w.width/2), y:w.y, width:Math.ceil(w.width/2), height:Math.floor(w.height/2) },
        { x:w.x, y:w.y+Math.floor(w.height/2), width:Math.floor(w.width/2), height:Math.ceil(w.height/2) },
        { x:w.x+Math.floor(w.width/2), y:w.y+Math.floor(w.height/2), width:Math.ceil(w.width/2), height:Math.ceil(w.height/2) }
      ] },
  ];

  function createPopup() {
    const popup = document.createElement('div');
    popup.id = 'snap-popup';
    popup.className = 'snap-popup';

    const title = document.createElement('div');
    title.className = 'snap-title';
    title.textContent = i18n.t('snap.title');
    popup.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'snap-grid';

    LAYOUTS.forEach((layout, li) => {
      const item = document.createElement('div');
      item.className = 'snap-item';
      item.title = layout.label;

      // Miniature SVG style Windows 11 : zones proportionnelles
      const W = 96, H = 60, GAP = 2, R = 3;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

      layout.zones.forEach((z, zi) => {
        const rx = Math.round(z.x * W) + (zi > 0 ? GAP : 0);
        const ry = Math.round(z.y * H) + (zi > 0 && z.y > 0 ? GAP : 0);
        const rw = Math.round(z.w * W) - GAP;
        const rh = Math.round(z.h * H) - GAP;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', rx); rect.setAttribute('y', ry);
        rect.setAttribute('width', rw); rect.setAttribute('height', rh);
        rect.setAttribute('rx', R);
        rect.dataset.zoneIndex = zi;
        svg.appendChild(rect);
      });

      item.appendChild(svg);

      // pointer-events sur les rects SVG uniquement
      svg.style.pointerEvents = 'none';
      svg.querySelectorAll('rect').forEach(r => { r.style.pointerEvents = 'all'; });

      // Hover zone par zone via mouseover/mouseout sur le SVG
      svg.addEventListener('mouseover', (e) => {
        const target = e.target.closest('rect');
        if (!target) return;
        const zi = parseInt(target.dataset.zoneIndex ?? '0');
        svg.querySelectorAll('rect').forEach((r, i) => {
          r.classList.toggle('snap-zone-active', i === zi);
        });
      });
      svg.addEventListener('mouseout', (e) => {
        // ne pas effacer si on glisse vers un autre rect du même svg
        if (svg.contains(e.relatedTarget)) return;
        svg.querySelectorAll('rect').forEach(r => r.classList.remove('snap-zone-active'));
      });

      // Clic sur une zone
      svg.addEventListener('click', async (e) => {
        e.stopPropagation();
        const target = e.target.closest('rect');
        const zi = target ? parseInt(target.dataset.zoneIndex ?? '0') : 0;
        hidePopup();
        const wa = await window.discowlAPI.window.getWorkArea();
        if (!wa) return;
        const isMax = await window.discowlAPI.window.isMaximized();
        if (isMax) {
          window.discowlAPI.window.maximize();
          await new Promise(resolve => setTimeout(resolve, 80));
        }
        const bounds = layout.calc(wa);
        window.discowlAPI.window.setBounds(bounds[zi] || bounds[0]);
      });

      // Highlight zone 0 au survol de l'item
      item.addEventListener('mouseenter', () => {
        svg.querySelectorAll('rect').forEach((r, i) => r.classList.toggle('snap-zone-active', i === 0));
      });
      item.addEventListener('mouseleave', (e) => {
        // Laisser le SVG gérer le hover zone si la souris est encore dedans
        if (!item.contains(e.relatedTarget)) {
          svg.querySelectorAll('rect').forEach(r => r.classList.remove('snap-zone-active'));
        }
      });

      grid.appendChild(item);
    });

    popup.appendChild(grid);
    return popup;
  }

  function showPopup() {
    if (_popup) return;
    clearTimeout(_hideTimer);

    _popup = createPopup();
    document.body.appendChild(_popup);

    // Positionner en dessous du bouton, collé à droite du bouton
    const rect = btn.getBoundingClientRect();
    const popupW = 246; // largeur estimée du popup
    let leftPos = rect.right - popupW;
    if (leftPos < 4) leftPos = 4;
    _popup.style.left   = leftPos + 'px';
    _popup.style.right  = 'auto';
    _popup.style.top    = (rect.bottom + 2) + 'px';

    // Garder ouvert si la souris entre dans le popup
    _popup.addEventListener('mouseenter', () => clearTimeout(_hideTimer));
    _popup.addEventListener('mouseleave', () => scheduleHide());
  }

  function scheduleHide(delay = 300) {
    clearTimeout(_hideTimer);
    _hideTimer = setTimeout(hidePopup, delay);
  }

  function hidePopup() {
    _popup?.remove();
    _popup = null;
    clearTimeout(_hideTimer);
  }

  btn.addEventListener('mouseenter', showPopup);
  btn.addEventListener('mouseleave', () => scheduleHide());
}

function initResizeHandles() {
  let resizing = false, edge, startX, startY, startBounds;
  const MIN_W = 900, MIN_H = 600;

  document.querySelectorAll('.rz').forEach(h => {
    h.addEventListener('mousedown', async (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      resizing = true; edge = h.dataset.edge;
      startX = e.screenX; startY = e.screenY;
      startBounds = await window.discowlAPI.window.getBounds();
      document.body.style.userSelect = 'none';
    });
  });

  document.addEventListener('mousemove', (e) => {
    if (!resizing || !startBounds) return;
    const dx = e.screenX - startX, dy = e.screenY - startY;
    let {x, y, width, height} = startBounds;
    if (edge.includes('e')) width  = Math.max(MIN_W, width + dx);
    if (edge.includes('s')) height = Math.max(MIN_H, height + dy);
    if (edge.includes('w')) { width = Math.max(MIN_W, width - dx); x = startBounds.x + startBounds.width - width; }
    if (edge.includes('n')) { height = Math.max(MIN_H, height - dy); y = startBounds.y + startBounds.height - height; }
    window.discowlAPI.window.setBounds({x:Math.round(x), y:Math.round(y), width:Math.round(width), height:Math.round(height)});
  });

  document.addEventListener('mouseup', () => {
    if (resizing) { resizing = false; document.body.style.userSelect = ''; }
  });
}


/* ── Fermer tous les panels au clic dans la webview ────────── */
function closeAllPanels() {
  // Context menu
  window._hideContextMenu?.();
  // Sandwich menu
  closeSandwich();
  // Menubar dropdowns
  document.querySelectorAll('.mb-dropdown:not(.hidden)').forEach(d => d.classList.add('hidden'));
  document.querySelectorAll('.mb-item.open').forEach(d => d.classList.remove('open'));
  // Dropdown moteur de recherche
  document.getElementById('engine-dropdown')?.classList.add('hidden');
  // Downloads panel
  document.getElementById('downloads-panel')?.classList.add('hidden');
  // Overlay
  hideOverlay();
}


/* ── Context menu natif (homepage + hors webview) ─────────── */
document.addEventListener('contextmenu', (e) => {
  // ── Toolbar right-click menu ──────────────────────────────
  const inToolbar = e.target.closest('#toolbar, #tab-bar, #menubar, #bookmarks-toolbar');
  if (inToolbar) {
    e.preventDefault();
    closeAllPanels();
    showToolbarContextMenu(e.clientX, e.clientY);
    return;
  }

  // ── Ignorer panels / menus ouverts ────────────────────────
  if (e.target.closest('.ctx-menu, .full-panel, .sidebar, #sandwich-menu')) return;

  // ── Context menu webview uniquement sur la zone de contenu ─
  const inContent = e.target.closest('#webview-container, #new-tab-page');
  if (!inContent) return;

  // Ignorer si une webview active gère son propre context-menu
  const activeTab = getActiveTab();
  if (activeTab && activeTab.url && !activeTab.url.startsWith('about:')) return;

  e.preventDefault();
  closeAllPanels();

  // Params synthétiques pour la homepage
  const target = e.target;
  const sel    = window.getSelection()?.toString()?.trim() || '';
  const linkEl = target.closest('a[href]');
  const imgEl  = target.closest('img');

  const syntheticParams = {
    selectionText: sel,
    linkURL:       linkEl ? (linkEl.href || '') : '',
    srcURL:        imgEl  ? (imgEl.src  || '') : '',
    mediaType:     imgEl  ? 'image' : 'none',
    isEditable:    target.matches('input, textarea, [contenteditable]'),
    editFlags:     { canUndo: true, canRedo: true, canCut: !!sel, canCopy: !!sel, canPaste: true },
    x:             e.clientX,
    y:             e.clientY,
  };

  const fakeWv = {
    getURL:      () => '',
    goBack:      () => { const t = getActiveTab(); if (t?.webview) t.webview.goBack(); },
    goForward:   () => { const t = getActiveTab(); if (t?.webview) t.webview.goForward(); },
    reload:      () => location.reload(),
    canGoBack:   () => false,
    canGoForward:() => false,
    print:       () => window.print(),
    openDevTools:() => {},
  };

  window._showContextMenu?.(fakeWv, syntheticParams, e.clientX, e.clientY);
});

/* ── Toolbar context menu ──────────────────────────────────── */
function showToolbarContextMenu(x, y) {
  const existing = document.getElementById('toolbar-ctx-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'toolbar-ctx-menu';
  menu.className = 'ctx-menu';
  document.body.appendChild(menu);

  function addItem(label, iconSvg, action, disabled) {
    const el = document.createElement('div');
    el.className = 'ctx-item' + (disabled ? ' ctx-disabled' : '');
    el.innerHTML = `<span class="ctx-icon">${iconSvg}</span><span class="ctx-label">${label}</span>`;
    if (!disabled) el.addEventListener('click', () => { menu.remove(); action(); });
    menu.appendChild(el);
  }
  function addSep() {
    const s = document.createElement('div'); s.className = 'ctx-sep'; menu.appendChild(s);
  }

  const ICON_CUSTOMIZE = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M2 7h7M2 10h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="11" cy="10" r="2" stroke="currentColor" stroke-width="1.4"/></svg>`;
  const ICON_NEWTAB    = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  const ICON_BM_BAR    = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2h10v8l-5-2-5 2V2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  const ICON_FULLSCR   = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON_ZOOM_R    = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.5 6.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

  addItem(i18n.t('ctx.toolbar_new_tab'),    ICON_NEWTAB,  () => createTab('about:newtab', false));
  addItem(i18n.t('ctx.toolbar_new_window'), ICON_NEWTAB,  () => window.discowlAPI.openNewWindow());
  addSep();
  addItem(i18n.t('ctx.toolbar_customize'),  ICON_CUSTOMIZE, () => _openCustomizeTab());
  addItem(i18n.t('ctx.toolbar_bm_bar'),     ICON_BM_BAR,
    () => {
      const show = !settings.showBookmarksToolbar;
      window.discowlAPI.settings.save({ showBookmarksToolbar: show });
      document.getElementById('bookmarks-toolbar').style.display = show ? 'flex' : 'none';
      settings.showBookmarksToolbar = show;
    }
  );
  addSep();
  addItem(i18n.t('ctx.toolbar_zoom_reset'), ICON_ZOOM_R, () => zoomActive(0, true));
  addSep();
  addItem(i18n.t('ctx.toolbar_fullscreen'), ICON_FULLSCR, () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  // Position
  const mw = 230;
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = Math.min(x, vw - mw - 6) + 'px';
  menu.style.top  = Math.min(y, vh - menu.scrollHeight - 6) + 'px';

  const dismiss = (ev) => {
    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss); }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}


/* ══════════════════════════════════════════════════════════════
   TOR UI — indicateur d'état + bouton New Circuit
══════════════════════════════════════════════════════════════ */
function initTorUI() {
  if (!settings.torEnabled) return;

  const indicator = document.getElementById('tor-indicator');
  if (!indicator) return;
  indicator.classList.remove('hidden');

  let _circuitId    = 0;
  let _newnymTimer  = null;
  let _checkInterval= null;

  function setTorState(state) {
    indicator.dataset.state = state;
    const label   = indicator.querySelector('.tor-label');
    const spinner = indicator.querySelector('.tor-spinner');
    const dot     = indicator.querySelector('.tor-dot');
    const newBtn  = document.getElementById('tor-new-circuit');

    switch (state) {
      case 'connecting':
        if (label)   label.textContent = i18n.t('tor.connecting');
        if (dot)     dot.className = 'tor-dot tor-dot-yellow';
        if (spinner) spinner.classList.remove('hidden');
        if (newBtn)  newBtn.disabled = true;
        break;
      case 'connected':
        if (label)   label.textContent = i18n.t('tor.connected');
        if (dot)     dot.className = 'tor-dot tor-dot-green';
        if (spinner) spinner.classList.add('hidden');
        if (newBtn)  newBtn.disabled = false;
        break;
      case 'rotating':
        if (label)   label.textContent = i18n.t('tor.rotating');
        if (dot)     dot.className = 'tor-dot tor-dot-yellow';
        if (spinner) spinner.classList.remove('hidden');
        if (newBtn)  newBtn.disabled = true;
        break;
      case 'error':
        if (label)   label.textContent = i18n.t('tor.error');
        if (dot)     dot.className = 'tor-dot tor-dot-red';
        if (spinner) spinner.classList.add('hidden');
        if (newBtn)  newBtn.disabled = true;
        break;
    }
  }

  function updateCircuitLabel() {
    const el = document.getElementById('tor-circuit-label');
    if (el) el.textContent = '#' + _circuitId;
  }

  function updateNewnymCooldown(newnymIn) {
    const btn      = document.getElementById('tor-new-circuit');
    const progress = document.getElementById('tor-newnym-progress');
    if (!btn) return;
    btn.disabled = true;
    if (progress) {
      progress.classList.remove('hidden');
      progress.style.width = '0%';
      // Animation vers 100% sur la durée du cooldown
      requestAnimationFrame(() => { progress.style.transition = `width ${newnymIn}ms linear`; progress.style.width = '100%'; });
    }
    clearTimeout(_newnymTimer);
    _newnymTimer = setTimeout(() => {
      btn.disabled = false;
      if (progress) { progress.classList.add('hidden'); progress.style.width = '0'; progress.style.transition = ''; }
    }, newnymIn);
  }

  async function checkStatus() {
    try {
      const s = await window.discowlAPI.tor.status();
      if (s.bootstrapped) {
        setTorState('connected');
        if (s.circuitId !== _circuitId) { _circuitId = s.circuitId; updateCircuitLabel(); }
        if (!s.newnymReady) {
          const btn = document.getElementById('tor-new-circuit');
          if (btn && !btn.disabled) updateNewnymCooldown(s.newnymIn || 10000);
        }
      } else if (s.running) {
        setTorState('connecting');
      } else {
        setTorState('error');
      }
    } catch { setTorState('error'); }
  }

  // Bouton New Circuit
  document.getElementById('tor-new-circuit')?.addEventListener('click', async () => {
    setTorState('rotating');
    try {
      const r = await window.discowlAPI.tor.newCircuit();
      if (r.ok) {
        _circuitId = r.circuitId;
        updateCircuitLabel();
        showToast(i18n.t('tor.new_circuit_ok'), 'success');
        setTorState('connected');
        updateNewnymCooldown(10000);
      } else {
        showToast(i18n.t('tor.new_circuit_error') + (r.reason ? ` (${r.reason})` : ''), 'error');
        setTorState('connected');
        if (r.ms_until_available > 0) updateNewnymCooldown(r.ms_until_available);
      }
    } catch {
      showToast(i18n.t('tor.new_circuit_error'), 'error');
      setTorState('connected');
    }
  });

  // Écouter les rotations external
  window.discowlAPI.tor.onCircuitRotated?.(({ circuitId }) => {
    _circuitId = circuitId;
    updateCircuitLabel();
  });

  // Vérification initiale + périodique (15s)
  setTorState('connecting');
  checkStatus();
  _checkInterval = setInterval(checkStatus, 15000);

  window.addEventListener('beforeunload', () => {
    clearInterval(_checkInterval);
    clearTimeout(_newnymTimer);
  });
}

function initMenubar() {
  let openItem = null;

  function closeAll() {
    document.querySelectorAll('.mb-item.open').forEach(item => {
      item.classList.remove('open');
      item.querySelector('.mb-dropdown')?.classList.add('hidden');
    });
    openItem = null;
  }

  function openMenu(item) {
    closeAll();
    closeSandwich(); // ferme le sandwich si ouvert
    openItem = item;
    item.classList.add('open');
    const dropdown = item.querySelector('.mb-dropdown');
    if (!dropdown) return;
    dropdown.classList.remove('hidden');

    // Positionner le dropdown sous le bouton
    const btn  = item.querySelector('.mb-btn');
    const rect = btn.getBoundingClientRect();
    dropdown.style.top  = rect.bottom + 'px';
    dropdown.style.left = rect.left + 'px';
  }

  // Boutons de la menubar
  document.querySelectorAll('.mb-item').forEach(item => {
    const btn = item.querySelector('.mb-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openItem === item) { closeAll(); }
      else { openMenu(item); }
    });
    // Hover : changer de menu si un autre est déjà ouvert
    btn.addEventListener('mouseenter', () => {
      if (openItem && openItem !== item) openMenu(item);
    });
  });

  // Fermer si clic en dehors
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menubar')) closeAll();
  });

  // Fermer sur Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openItem) { closeAll(); e.stopPropagation(); }
  });

  // ── Actions ──────────────────────────────────────────────────
  function mb(action, fn) {
    document.querySelectorAll(`[data-action="${action}"]`).forEach(el => {
      el.addEventListener('click', () => { closeAll(); fn(); });
    });
  }

  // File
  mb('new-tab',          () => createTab('about:newtab', false));
  mb('new-window',       () => window.discowlAPI.openNewWindow());
  mb('new-private',      () => createTab('about:newtab', true));
  mb('open-url',         () => document.getElementById('url-bar')?.focus());
  mb('save-page', async () => {
    const tab = getActiveTab();
    if (!tab?.webview || !tab.url || tab.url.startsWith('about:')) return;
    // Récupérer le HTML de la page
    try {
      const html = await tab.webview.executeJavaScript('document.documentElement.outerHTML');
      // Nom de fichier basé sur le titre de la page
      const safeName = (tab.title || 'page').replace(/[<>:"/\\|?*]/g, '_').slice(0, 60) + '.html';
      const dest = await window.discowlAPI.dialog.saveFile({ filename: safeName });
      if (dest) {
        const r = await window.discowlAPI.file.write(dest, html);
        if (r.ok) showToast(i18n.t('toast.page_saved'), 'success');
        else showToast(i18n.t('toast.page_save_error'), 'error');
      }
    } catch (e) {
      showToast(i18n.t('toast.page_save_error'), 'error');
    }
  });
  mb('open-file', async () => {
    const p = await window.discowlAPI.dialog.openFile();
    if (p) {
      // Windows paths need forward slashes + proper encoding
      const url = 'file:///' + p.replace(/\\/g, '/');
      createTab(url);
    }
  });
  mb('print', () => {
    const t = getActiveTab();
    if (!t?.webview || !t.url || t.url.startsWith('about:')) return;
    try { t.webview.print(); } catch(e) { console.warn('[Print]', e.message); }
  });
  mb('quit',             () => window.close());

  // Edit
  mb('find', () => {
    const t = getActiveTab();
    if (!t?.webview || !t.url || t.url.startsWith('about:')) return;
    // Ouvrir la barre de recherche dans la page via findInPage
    try {
      t.webview.findInPage('');
    } catch(e) {
      // Fallback : Ctrl+F natif
      try { t.webview.executeJavaScript("document.execCommand('find')"); } catch {}
    }
  });
  mb('cut',       () => { const t = getActiveTab(); if (t?.webview && t.url) t.webview.cut?.();       else document.execCommand('cut'); });
  mb('copy',      () => { const t = getActiveTab(); if (t?.webview && t.url) t.webview.copy?.();      else document.execCommand('copy'); });
  mb('paste',     () => { const t = getActiveTab(); if (t?.webview && t.url) t.webview.paste?.();     else document.execCommand('paste'); });
  mb('select-all',() => { const t = getActiveTab(); if (t?.webview && t.url) t.webview.selectAll?.(); else document.execCommand('selectAll'); });
  mb('settings',         () => window.SettingsManager?.open());

  // View
  mb('zoom-in',          () => zoomActive(0.1));
  mb('zoom-out',         () => zoomActive(-0.1));
  mb('zoom-reset',       () => zoomActive(0, true));
  mb('fullscreen',       () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });
  mb('customize-toolbar',  () => _openCustomizeTab());
  mb('toggle-bookmarks-bar', () => {
    const bar = document.getElementById('bookmarks-toolbar');
    if (bar) bar.classList.toggle('hidden');
  });
  mb('devtools', () => {
    const t = getActiveTab();
    if (!t?.webview) return;
    if (t.url && !t.url.startsWith('about:')) {
      try { t.webview.openDevTools(); } catch(e) { console.warn('[DevTools]', e.message); }
    } else {
      // Sur la homepage, inspecter via l'ID de la webContents principale
      try {
        const wc = t.webview?.getWebContentsId?.();
        if (wc) window.discowlAPI.devtools.open(wc);
      } catch(e) { console.warn('[DevTools homepage]', e.message); }
    }
  });

  // Exposed for context-menu.js
  window._openDevTools = () => {
    const tab = getActiveTab();
    if (!tab?.webview) return;
    try { tab.webview.openDevTools(); } catch(e) { console.warn('[DevTools ctx]', e.message); }
  };

  // History
  mb('back',             () => document.getElementById('back-btn')?.click());
  mb('forward',          () => document.getElementById('forward-btn')?.click());
  mb('show-history',     () => window.SidebarManager?.toggleRight());
  mb('clear-history',    () => {
    if (confirm(i18n.t('hist.clear_confirm'))) window.HistoryManager?.clear();
  });

  // Bookmarks
  mb('bookmark-page',    () => document.getElementById('bookmark-star-btn')?.click());
  mb('show-bookmarks',   () => window.SidebarManager?.toggleLeft());

  // Help
  mb('about',            () => window.discowlAPI.shell.openExternal('https://www.discowl.com'));
  mb('passwords',        () => _openPasswordsTab());
  mb('github',           () => window.discowlAPI.shell.openExternal('https://github.com/VassiaTheGOAT/Discowl-Browser'));
  mb('check-updates',    async () => {
    showToast(i18n.t('toast.update_check') || 'Vérification des mises à jour…', 'info');
    try {
      const result = await window.discowlAPI.updates.check();
      if (result.upToDate) {
        showToast(i18n.t('settings.up_to_date') || 'Déjà à jour', 'success');
      } else {
        updBar.show('available', { version: result.latest });
      }
    } catch { showToast(i18n.t('settings.update_error') || 'Erreur de vérification', 'error'); }
  });
}

function setupSandwichMenu() {
  const btn  = document.getElementById('sandwich-btn');
  const menu = document.getElementById('sandwich-menu');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    sandwichOpen = !sandwichOpen;
    menu.classList.toggle('hidden', !sandwichOpen);
    btn.setAttribute('aria-expanded', sandwichOpen);

    if (sandwichOpen) {
      showOverlay(closeSandwich);
    }
  });

  // Menu items
  document.getElementById('menu-new-tab')?.addEventListener('click', () => {
    closeSandwich(); createTab('about:newtab', false);
  });
  document.getElementById('menu-new-private')?.addEventListener('click', () => {
    closeSandwich(); createTab('about:newtab', true);
  });
  document.getElementById('menu-bookmarks')?.addEventListener('click', () => {
    closeSandwich(); window.SidebarManager?.toggleLeft();
  });
  document.getElementById('menu-history')?.addEventListener('click', () => {
    closeSandwich(); window.SidebarManager?.toggleRight();
  });
  document.getElementById('menu-downloads')?.addEventListener('click', () => {
    closeSandwich(); window.DownloadManager?.openFullPage();
  });
  document.getElementById('menu-zoom-in')?.addEventListener('click', () => {
    closeSandwich(); zoomActive(0.1);
  });
  document.getElementById('menu-zoom-out')?.addEventListener('click', () => {
    closeSandwich(); zoomActive(-0.1);
  });
  document.getElementById('menu-passwords')?.addEventListener('click', () => {
    closeSandwich(); _openPasswordsTab();
  });
  document.getElementById('menu-settings')?.addEventListener('click', () => {
    closeSandwich(); window.SettingsManager?.open();
  });
  document.getElementById('menu-quit')?.addEventListener('click', () => {
    closeSandwich(); window.close();
  });
}

function closeSandwich() {
  sandwichOpen = false;
  document.getElementById('sandwich-menu')?.classList.add('hidden');
  document.getElementById('sandwich-btn')?.setAttribute('aria-expanded', 'false');
  hideOverlay();
}

/* ── Click-outside overlay helper ─────────────────────────── */
let _overlayCallback = null;

function showOverlay(cb) {
  _overlayCallback = cb;
  const el = document.getElementById('click-outside-overlay');
  el?.classList.remove('hidden');
  el?.addEventListener('click', _onOverlayClick, { once: true });
}

function hideOverlay() {
  document.getElementById('click-outside-overlay')?.classList.add('hidden');
  _overlayCallback = null;
}

function _onOverlayClick() {
  if (_overlayCallback) _overlayCallback();
}

/* ══════════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
══════════════════════════════════════════════════════════════ */
window.addEventListener('resize', () => {
  const ntp = document.getElementById('new-tab-page');
  if (ntp && !ntp.classList.contains('hidden')) positionNewtabLogo();
});

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === 't') { e.preventDefault(); createTab('about:newtab', false); }
    if (ctrl && e.shiftKey && e.key === 'T') { e.preventDefault(); createTab('about:newtab', true); }
    if (ctrl && e.shiftKey && e.key === 'N') { e.preventDefault(); window.discowlAPI.openNewWindow(); }
    if (ctrl && e.key === 'w') { e.preventDefault(); closeTab(activeTabId); }
    if (ctrl && e.key === 'l') { e.preventDefault(); document.getElementById('url-bar').focus(); }
    if (ctrl && e.key === 'o') { e.preventDefault(); window.discowlAPI.dialog.openFile().then(p => { if (p) createTab('file:///' + p.replace(/\\/g, '/')); }); }
    if (ctrl && e.key === 'b') { e.preventDefault(); window.SidebarManager?.toggleLeft(); }
    if (ctrl && e.key === 'h') { e.preventDefault(); window.SidebarManager?.toggleRight(); }
    if (ctrl && e.key === 'r' || e.key === 'F5') { e.preventDefault(); getActiveTab()?.webview.reload(); }
    if (ctrl && e.key === 'p') { e.preventDefault(); getActiveTab()?.webview?.print?.(); }
    if (ctrl && e.key === 's') {
      e.preventDefault();
      const t = getActiveTab();
      if (!t?.webview || !t.url || t.url.startsWith('about:')) return;
      // HTML pages: save rendered source
      const ext = t.url.split('?')[0].split('.').pop().toLowerCase();
      const isHtml = !ext || ['html','htm','xhtml','php','asp','aspx','do','jsp',''].includes(ext) || t.url.startsWith('http');
      if (isHtml) {
        (async () => {
          try {
            const html = await t.webview.executeJavaScript('document.documentElement.outerHTML');
            const safeName = (t.title || 'page').replace(/[<>:"/\\|?*]/g, '_').slice(0,60) + '.html';
            const dest = await window.discowlAPI.dialog.saveFile({ filename: safeName });
            if (dest) {
              const r = await window.discowlAPI.file.write(dest, html);
              if (r?.ok) showToast(i18n.t('toast.page_saved'), 'success');
              else showToast(i18n.t('toast.page_save_error'), 'error');
            }
          } catch { showToast(i18n.t('toast.page_save_error'), 'error'); }
        })();
      } else {
        t.webview.downloadURL(t.url);
      }
    }
    if (ctrl && e.key === '=' || ctrl && e.key === '+') { e.preventDefault(); zoomActive(0.1); }
    if (ctrl && e.key === '-')  { e.preventDefault(); zoomActive(-0.1); }
    if (ctrl && e.key === '0')  { e.preventDefault(); zoomActive(0, true); }

    // Tab switching Ctrl+1..9
    if (ctrl && e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      if (tabs[idx]) { e.preventDefault(); switchTab(tabs[idx].id); }
    }

    if (e.key === 'F12') {
      e.preventDefault();
      const t = getActiveTab();
      if (t?.webview && t.url && !t.url.startsWith('about:')) {
        try { t.webview.openDevTools(); } catch {}
      }
    }

    // Alt+Left/Right for back/forward
    if (e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); getActiveTab()?.webview.goBack(); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); getActiveTab()?.webview.goForward(); }

    // Escape: stop loading or close panels/menus
    if (e.key === 'Escape') {
      const tab = getActiveTab();
      if (tab?.isLoading) { tab.webview.stop(); updateReloadBtn(false); return; }
      if (sandwichOpen) closeSandwich();
      const settingsPanel = document.getElementById('settings-panel');
      if (!settingsPanel?.classList.contains('hidden')) window.SettingsManager?.close();
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   ZOOM
══════════════════════════════════════════════════════════════ */
function zoomActive(delta, reset = false) {
  const tab = getActiveTab();
  if (!tab) return;
  if (reset) tab.zoom = 1;
  else tab.zoom = Math.max(0.3, Math.min(3, tab.zoom + delta));

  const ntpEl = document.getElementById('new-tab-page');
  const isNewtab = !tab.url && ntpEl && !ntpEl.classList.contains('hidden');

  if (isNewtab) {
    // La home page est un div HTML — on zoome via CSS transform
    const inner = document.querySelector('.newtab-inner');
    if (inner) {
      if (tab.zoom === 1) {
        inner.style.transform = '';
        inner.style.transformOrigin = '';
      } else {
        inner.style.transform = `scale(${tab.zoom})`;
        inner.style.transformOrigin = 'top center';
      }
    }
  } else {
    try { tab.webview.setZoomFactor(tab.zoom); } catch {}
  }

  updateZoomIndicator(tab);
}

/* ══════════════════════════════════════════════════════════════
   UPDATE BANNER
══════════════════════════════════════════════════════════════ */


/* ══════════════════════════════════════════════════════════════
   NEWTAB MODE — adapte l'apparence selon privé/Tor
══════════════════════════════════════════════════════════════ */
function updateNewtabMode(isPrivate) {
  const ntpEl   = document.getElementById('new-tab-page');
  const titleEl = document.getElementById('newtab-title');
  if (!ntpEl || !titleEl) return;
  requestAnimationFrame(positionNewtabLogo);

  const torActive = !!settings.torEnabled;

  // Réinitialiser
  ntpEl.style.background = '';
  titleEl.textContent    = 'Discowl';

  if (torActive) {
    // Tor : fond violet→rose, titre "Discowl : Tor 🧅" couleur normale cyan→jaune
    ntpEl.style.background = 'linear-gradient(135deg, #1a001f 0%, #2d0050 40%, #4b0082 70%, #6b0fa0 100%)';
    titleEl.textContent = 'Discowl : Tor 🧅';
    titleEl.style.background       = 'linear-gradient(90deg, #0cc0df, #ffde59)';
    titleEl.style.webkitBackgroundClip = 'text';
    titleEl.style.backgroundClip   = 'text';
    titleEl.style.webkitTextFillColor = 'transparent';
    titleEl.style.color            = 'transparent';
  } else if (isPrivate) {
    // Privé : fond normal inchangé, titre violet→rose
    ntpEl.style.background = '';
    titleEl.style.background       = 'linear-gradient(90deg, #c084fc, #f472b6, #e879f9)';
    titleEl.style.webkitBackgroundClip = 'text';
    titleEl.style.backgroundClip   = 'text';
    titleEl.style.webkitTextFillColor = 'transparent';
    titleEl.style.color            = 'transparent';
  } else {
    // Normal : gradient cyan→jaune (même que base CSS)
    titleEl.style.background       = 'linear-gradient(90deg, #0cc0df, #ffde59)';
    titleEl.style.webkitBackgroundClip = 'text';
    titleEl.style.backgroundClip   = 'text';
    titleEl.style.webkitTextFillColor = 'transparent';
    titleEl.style.color            = 'transparent';
  }
}

/* ══════════════════════════════════════════════════════════════
   NEW TAB PAGE
══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   NTP BACKGROUND — personnalisation fond homepage
   Stockage : settings.ntpBackground = { type, value }
     type = 'none' | 'color' | 'image'
     value = '' | '#hex' | 'data:...' | 'https://...'
   S'applique en priorité sur .newtab-page via CSS variables.
   Prioritaire sur tous les modes (privé, tor, normal).
══════════════════════════════════════════════════════════════ */

function initNtpBackground() {
  const ntpEl   = document.getElementById('new-tab-page');
  const btn     = document.getElementById('ntp-bg-btn');
  const dock    = document.getElementById('ntp-bg-dock');
  const closeBtn= document.getElementById('ntp-dock-close');

  if (!ntpEl || !btn || !dock) return;

  // ── Charger la config sauvegardée ──────────────────────────
  let bgConfig = { type: 'none', value: '' };
  try {
    const saved = settings.ntpBackground;
    if (saved && saved.type) bgConfig = saved;
  } catch {}

  applyNtpBackground(bgConfig);

  // ── Ouvrir / fermer le dock ────────────────────────────────
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dock.classList.contains('visible');
    if (isOpen) {
      closeDock();
    } else {
      dock.classList.remove('hidden');
      requestAnimationFrame(() => {
        dock.classList.add('visible');
        // Traduire le dock au moment où il s'ouvre
        if (window.i18n) window.i18n.apply(dock);
      });
      syncDockUI(bgConfig);
    }
  });

  function closeDock() {
    dock.classList.remove('visible');
    setTimeout(() => dock.classList.add('hidden'), 200);
  }

  closeBtn?.addEventListener('click', closeDock);

  document.addEventListener('mousedown', (e) => {
    if (!dock.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      if (dock.classList.contains('visible')) closeDock();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dock.classList.contains('visible')) closeDock();
  });

  // ── Swatches de couleur ────────────────────────────────────
  document.querySelectorAll('#ntp-colors .ntp-swatch[data-value]').forEach(sw => {
    sw.addEventListener('click', () => {
      const val = sw.dataset.value;
      if (val === '') {
        bgConfig = { type: 'none', value: '' };
      } else {
        bgConfig = { type: 'color', value: val };
      }
      applyNtpBackground(bgConfig);
      saveNtpBackground(bgConfig);
      syncDockUI(bgConfig);
    });
  });

  // Color picker custom
  const picker = document.getElementById('ntp-color-picker');
  picker?.addEventListener('input', () => {
    bgConfig = { type: 'color', value: picker.value };
    applyNtpBackground(bgConfig);
  });
  picker?.addEventListener('change', () => {
    bgConfig = { type: 'color', value: picker.value };
    applyNtpBackground(bgConfig);
    saveNtpBackground(bgConfig);
    syncDockUI(bgConfig);
  });

  // ── Upload image locale ────────────────────────────────────
  const fileInput = document.getElementById('ntp-file-input');
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    // Vérifier type MIME
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      return;
    }
    // Limite 10MB
    if (file.size > 10 * 1024 * 1024) {
      showToast('Image too large (max 10MB)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      bgConfig = { type: 'image', value: dataUrl };
      applyNtpBackground(bgConfig);
      saveNtpBackground(bgConfig);
      syncDockUI(bgConfig);
    };
    reader.readAsDataURL(file);
    fileInput.value = ''; // reset pour permettre re-sélection même fichier
  });

  // ── Image par URL ──────────────────────────────────────────
  const urlBtn   = document.getElementById('ntp-url-btn');
  const urlRow   = document.getElementById('ntp-url-row');
  const urlInput = document.getElementById('ntp-url-input');
  const urlApply = document.getElementById('ntp-url-apply');

  urlBtn?.addEventListener('click', () => {
    urlRow?.classList.toggle('hidden');
    if (!urlRow?.classList.contains('hidden')) urlInput?.focus();
  });

  urlApply?.addEventListener('click', () => applyUrlImage());
  urlInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyUrlImage(); });

  function applyUrlImage() {
    const url = urlInput?.value?.trim();
    if (!url) return;
    try {
      const p = new URL(url);
      if (!['https:', 'http:'].includes(p.protocol)) {
        showToast('Only https:// URLs are allowed', 'error');
        return;
      }
    } catch {
      showToast('Invalid URL', 'error');
      return;
    }
    bgConfig = { type: 'image', value: url };
    applyNtpBackground(bgConfig);
    saveNtpBackground(bgConfig);
    syncDockUI(bgConfig);
    urlRow?.classList.add('hidden');
  }

  // ── Supprimer le fond ──────────────────────────────────────
  const removeBtn = document.getElementById('ntp-bg-remove');
  removeBtn?.addEventListener('click', () => {
    bgConfig = { type: 'none', value: '' };
    applyNtpBackground(bgConfig);
    saveNtpBackground(bgConfig);
    syncDockUI(bgConfig);
  });

  // ── Synchroniser l'UI du dock avec l'état courant ──────────
  function syncDockUI(cfg) {
    // Swatches — marquer l'actif
    document.querySelectorAll('#ntp-colors .ntp-swatch[data-value]').forEach(sw => {
      sw.classList.toggle('active', cfg.type === 'color' && sw.dataset.value === cfg.value);
      if (cfg.type === 'none' && sw.dataset.value === '') sw.classList.add('active');
    });

    // Preview image
    const preview  = document.getElementById('ntp-img-preview');
    const thumb    = document.getElementById('ntp-img-thumb');
    const info     = document.getElementById('ntp-img-info');
    const rmBtn    = document.getElementById('ntp-bg-remove');

    if (cfg.type === 'image' && cfg.value) {
      preview?.classList.remove('hidden');
      if (thumb) thumb.src = cfg.value;
      if (info) {
        if (cfg.value.startsWith('data:')) {
          // Estimer la taille
          const kb = Math.round(cfg.value.length * 0.75 / 1024);
          info.textContent = `Local image · ~${kb} KB`;
        } else {
          try { info.textContent = new URL(cfg.value).hostname; } catch { info.textContent = 'URL image'; }
        }
      }
      rmBtn?.classList.remove('hidden');
    } else {
      preview?.classList.add('hidden');
      rmBtn?.classList.add('hidden');
    }
  }
}

/* ── Calculer la luminance d'une couleur hex ─────────────── */
function _getLuminance(hex) {
  const h = hex.replace('#', '');
  if (h.length < 6) return 0;
  const r = parseInt(h.slice(0,2),16) / 255;
  const g = parseInt(h.slice(2,4),16) / 255;
  const b = parseInt(h.slice(4,6),16) / 255;
  // Formule sRGB → luminance relative
  const toLinear = x => x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4);
  return 0.2126*toLinear(r) + 0.7152*toLinear(g) + 0.0722*toLinear(b);
}

/* ── Appliquer le fond sur le DOM ─────────────────────────── */
function applyNtpBackground(cfg) {
  const ntpEl = document.getElementById('new-tab-page');
  if (!ntpEl) return;

  if (cfg.type === 'color' && cfg.value) {
    ntpEl.style.setProperty('--ntp-bg-color', cfg.value);
    ntpEl.style.removeProperty('--ntp-bg-image');
    ntpEl.style.backgroundImage = '';
    ntpEl.style.backgroundColor = cfg.value;
  } else if (cfg.type === 'image' && cfg.value) {
    const imgVal = `url('${cfg.value.replace(/'/g, "\'")}')`;
    ntpEl.style.setProperty('--ntp-bg-image', imgVal);
    ntpEl.style.removeProperty('--ntp-bg-color');
    ntpEl.style.backgroundImage = imgVal;
    ntpEl.style.backgroundSize  = 'cover';
    ntpEl.style.backgroundPosition = 'center';
    ntpEl.style.backgroundColor = '';
  } else {
    // Réinitialiser
    ntpEl.style.removeProperty('--ntp-bg-image');
    ntpEl.style.removeProperty('--ntp-bg-color');
    ntpEl.style.backgroundImage = '';
    ntpEl.style.backgroundColor = '';
  }

  // Adapter le curseur et la couleur du texte de l'input selon la luminosité du fond
  _updateNtpInputContrast(cfg);
}

function _updateNtpInputContrast(cfg) {
  const ntpEl = document.getElementById('new-tab-page');
  if (!ntpEl) return;

  let isLight = false; // fond sombre par défaut

  if (cfg.type === 'color' && cfg.value) {
    const lum = _getLuminance(cfg.value);
    isLight = lum > 0.4; // seuil : fond clair si luminance > 40%
  } else if (cfg.type === 'image') {
    // Pour les images, on ne peut pas détecter facilement la luminosité
    // On laisse l'utilisateur gérer — curseur blanc par défaut sur image
    isLight = false;
  } else {
    // Fond par défaut — dépend du thème
    isLight = document.documentElement.getAttribute('data-theme') === 'light';
  }

  // Appliquer la classe CSS qui change caret-color et color de l'input
  ntpEl.classList.toggle('ntp-light-bg', isLight);
}

/* ── Sauvegarder dans les settings ───────────────────────── */
async function saveNtpBackground(cfg) {
  try {
    await window.discowlAPI.settings.save({ ntpBackground: cfg });
    settings.ntpBackground = cfg;
  } catch (e) {
    console.error('[NtpBg] Save error:', e);
  }
}

function setupNewTabPage() {
  const searchInput = document.getElementById('newtab-search-input');
  const searchBtn   = document.getElementById('newtab-search-btn');

  const doSearch = () => {
    const v = searchInput?.value.trim();
    if (v) navigateActive(v);
  };

  document.getElementById('newtab-form')?.addEventListener('submit', (e) => { e.preventDefault(); doSearch(); });
  searchInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
}

function clearNewtabSearch() {
  const searchInput = document.getElementById('newtab-search-input');
  if (searchInput) searchInput.value = '';
}


/* ══════════════════════════════════════════════════════════════
   SETTINGS APPLICATION
══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   TOOLBAR CONFIG — application en temps réel
══════════════════════════════════════════════════════════════ */
const TOOLBAR_BUTTON_MAP = {
  back:      () => document.getElementById('back-btn')?.closest('.nav-buttons'),
  forward:   () => document.getElementById('forward-btn'),
  reload:    () => document.getElementById('reload-btn'),
  home:      () => document.getElementById('home-btn'),
  bookmarks: () => document.getElementById('sidebar-left-toggle'),
  history:   () => document.getElementById('sidebar-right-toggle'),
  downloads: () => document.getElementById('downloads-btn')?.parentElement,
  zoom:      () => document.getElementById('toolbar-zoom'),
};

// Séparer back des autres nav-buttons
const NAV_BUTTONS_INDIVIDUAL = {
  back:    () => document.getElementById('back-btn'),
  forward: () => document.getElementById('forward-btn'),
  reload:  () => document.getElementById('reload-btn'),
  home:    () => document.getElementById('home-btn'),
};

function applyToolbarConfig(cfg) {
  if (!cfg?.length) return;

  // Visibilité
  cfg.forEach(item => {
    const getter = NAV_BUTTONS_INDIVIDUAL[item.id];
    const el = getter ? getter() : TOOLBAR_BUTTON_MAP[item.id]?.();
    if (!el) return;
    el.style.display = item.visible ? '' : 'none';
  });

  // Ordre des boutons de navigation (back/forward/reload/home)
  const navContainer = document.querySelector('.nav-buttons');
  if (navContainer) {
    const navOrder = cfg
      .filter(i => i.visible && NAV_BUTTONS_INDIVIDUAL[i.id])
      .map(i => NAV_BUTTONS_INDIVIDUAL[i.id]?.())
      .filter(Boolean);
    navOrder.forEach(el => navContainer.appendChild(el));
  }

  // Ordre des boutons d'action droite (bookmarks/history/downloads)
  const actContainer = document.querySelector('.toolbar-actions');
  if (actContainer) {
    const sandwichBtn = document.getElementById('sandwich-btn');
    const actOrder = cfg
      .filter(i => i.visible && TOOLBAR_BUTTON_MAP[i.id] && !NAV_BUTTONS_INDIVIDUAL[i.id])
      .map(i => TOOLBAR_BUTTON_MAP[i.id]?.())
      .filter(Boolean);
    // Réinsérer avant le sandwich
    actOrder.forEach(el => { if (sandwichBtn) actContainer.insertBefore(el, sandwichBtn); });
  }
}

function applySettings(s) {
  if (s.toolbarItems) applyToolbarConfig(s.toolbarItems);
  // Thème — appliqué sur <html> pour le chrome complet du navigateur
  if (s.theme) applyTheme(s.theme);
  // Fond homepage
  if (s.ntpBackground?.type) applyNtpBackground(s.ntpBackground);
  // Mode toujours privé — indicateur visuel + refresh onglet actif
  const wasAlwaysPrivate = !!document.body.classList.contains('always-private-mode');
  const nowAlwaysPrivate = !!s.alwaysPrivate;
  document.body.classList.toggle('always-private-mode', nowAlwaysPrivate);

  // Refresh visuel de l'onglet homepage actif si le mode change
  if (wasAlwaysPrivate !== nowAlwaysPrivate) {
    const activeTab = getActiveTab();
    if (activeTab && !activeTab.url) {
      // Onglet homepage — mettre à jour le titre et les styles
      activeTab.isPrivate = nowAlwaysPrivate;
      updateNewtabMode(nowAlwaysPrivate);
      refreshTab(activeTab.id);
    }
    // Mettre à jour le badge sur tous les onglets ouverts
    tabs.forEach(tab => {
      if (!tab.url && !tab.isFixed) {
        // Onglets homepage — mettre à jour leur classe visuellement
        const el = document.querySelector(`.tab[data-tab-id="${tab.id}"]`);
        if (el) {
          el.classList.toggle('private', nowAlwaysPrivate);
          tab.isPrivate = nowAlwaysPrivate;
        }
      }
    });
  }

  // Barre des favoris
  const bmToolbar = document.getElementById('bookmarks-toolbar');
  if (bmToolbar) bmToolbar.style.display = s.showBookmarksToolbar !== false ? 'flex' : 'none';

  // Moteur de recherche
  if (s.defaultEngine) {
    currentEngine = s.defaultEngine;
    updateEngineUI();
  }
}

/**
 * Applique le thème light/dark sur <html data-theme="...">
 * Toutes les variables CSS du chrome (toolbar, sidebar, menus...)
 * réagissent immédiatement via le sélecteur html[data-theme].
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}

/* ══════════════════════════════════════════════════════════════
   TOR INDICATOR
══════════════════════════════════════════════════════════════ */
async function updateTorIndicator() {
  const status    = await window.discowlAPI.tor.status();
  const indicator = document.getElementById('tor-indicator');
  if (indicator) indicator.classList.toggle('hidden', !status.running && !settings.torEnabled);
}

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
function getTab(id)   { return tabs.find(t => t.id === id) || null; }
window.getActiveTab = getActiveTab;
function getActiveTab() { return getTab(activeTabId); }

/* ══════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
══════════════════════════════════════════════════════════════ */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.2s ease forwards';
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

// Make showToast global (used by components)
window.showToast = showToast;
/* ══════════════════════════════════════════════════════════════
   UPDATE BAR SYSTEM
   Gère la barre de mise à jour professionnelle en bas de l'app.

   États :
     hidden      → barre masquée (aucune MAJ)
     available   → MAJ disponible, bouton Télécharger
     downloading → téléchargement en cours, barre de progression
     ready       → prêt à installer, bouton Redémarrer
     error       → erreur de téléchargement

   Flux :
     updater:update-available  → show('available')
     updater:download-progress → show('downloading') + mise à jour barre
     updater:update-ready      → show('ready')
     updater:download-error    → show('error')
══════════════════════════════════════════════════════════════ */

const updBar = (() => {
  // ── Éléments DOM ────────────────────────────────────────────
  const bar = document.getElementById('update-bar');
  if (!bar) return { show: () => {}, hide: () => {} };

  const els = {
    // available
    versionAvail:  document.getElementById('upd-version-avail'),
    btnDownload:   document.getElementById('upd-btn-download'),
    btnLaterAvail: document.getElementById('upd-btn-later-avail'),
    closeAvail:    document.getElementById('upd-close-avail'),
    // downloading
    versionDl:     document.getElementById('upd-version-dl'),
    pct:           document.getElementById('upd-pct'),
    fill:          document.getElementById('upd-fill'),
    speed:         document.getElementById('upd-speed'),
    size:          document.getElementById('upd-size'),
    btnCancel:     document.getElementById('upd-btn-cancel'),
    // ready
    versionReady:  document.getElementById('upd-version-ready'),
    btnInstall:    document.getElementById('upd-btn-install'),
    btnLaterReady: document.getElementById('upd-btn-later-ready'),
    closeReady:    document.getElementById('upd-close-ready'),
    // error
    errText:       document.getElementById('upd-err-text'),
    btnRetry:      document.getElementById('upd-btn-retry'),
    closeErr:      document.getElementById('upd-close-err'),
  };

  // Version en cours (pour le retry)
  let _currentVersion = null;

  // ── Helper format octets ─────────────────────────────────────
  function _fmt(b) {
    if (!b || b <= 0) return '';
    if (b < 1024)       return b + ' B';
    if (b < 1_048_576)  return (b / 1024).toFixed(1) + ' Ko';
    return (b / 1_048_576).toFixed(1) + ' Mo';
  }

  // ── Afficher un état ─────────────────────────────────────────
  function show(state, data = {}) {
    bar.dataset.state = state;

    if (state === 'available') {
      _currentVersion = data.version || '';
      if (els.versionAvail) els.versionAvail.textContent = _currentVersion;
    }

    if (state === 'downloading') {
      if (data.version && els.versionDl)
        els.versionDl.textContent = data.version;

      // Mise à jour de la progression
      if (data.percent !== undefined) {
        const pct = Math.max(0, Math.min(100, data.percent));
        if (els.pct)  els.pct.textContent  = pct + '%';
        if (els.fill) els.fill.style.width = pct + '%';
      }
      if (data.bytesPerSecond !== undefined && els.speed) {
        els.speed.textContent = _fmt(data.bytesPerSecond) + '/s';
      }
      if (data.transferred !== undefined && data.total !== undefined && els.size) {
        els.size.textContent = _fmt(data.transferred) + ' / ' + _fmt(data.total);
      }
    }

    if (state === 'ready') {
      if (els.versionReady)
        els.versionReady.textContent = data.version || _currentVersion || '';
    }

    if (state === 'error') {
      if (els.errText)
        els.errText.textContent = data.message || 'Vérifiez votre connexion et réessayez.';
    }
  }

  function hide() {
    bar.dataset.state = 'hidden';
  }

  // ── Boutons ──────────────────────────────────────────────────

  // [Télécharger]
  if (els.btnDownload) {
    els.btnDownload.addEventListener('click', async () => {
      // Passer immédiatement en mode downloading (feedback instantané)
      show('downloading', { version: _currentVersion, percent: 0 });
      if (els.pct)  els.pct.textContent  = '0%';
      if (els.fill) els.fill.style.width = '0%';
      try {
        await window.discowlAPI.updates.download();
      } catch (e) {
        show('error', { message: e?.message });
      }
    });
  }

  // [Annuler]
  if (els.btnCancel) {
    els.btnCancel.addEventListener('click', async () => {
      try { await window.discowlAPI.updates.cancel(); } catch {}
      hide();
    });
  }

  // [Redémarrer et installer]
  if (els.btnInstall) {
    els.btnInstall.addEventListener('click', async () => {
      // Désactiver le bouton pour éviter les double-clics
      els.btnInstall.disabled = true;
      els.btnInstall.textContent = 'Installation en cours…';
      try {
        await window.discowlAPI.updates.install();
        // L'app va se fermer — NSIS prend la main
      } catch (e) {
        els.btnInstall.disabled = false;
        els.btnInstall.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Redémarrer et installer`;
        show('error', { message: e?.message });
      }
    });
  }

  // [Plus tard] (état available)
  if (els.btnLaterAvail) {
    els.btnLaterAvail.addEventListener('click', () => {
      window.discowlAPI.updates.defer?.().catch(() => {});
      hide();
    });
  }

  // [Plus tard] (état ready — MAJ prête, on garde pour plus tard)
  if (els.btnLaterReady) {
    els.btnLaterReady.addEventListener('click', () => {
      hide();
      // Réafficher un rappel discret via toast
      showToast('Mise à jour disponible — elle sera installée au prochain redémarrage.', 'info');
    });
  }

  // [×] fermer (available, ready, error)
  [els.closeAvail, els.closeReady, els.closeErr].forEach(btn => {
    if (btn) btn.addEventListener('click', () => {
      window.discowlAPI.updates.defer?.().catch(() => {});
      hide();
    });
  });

  // [Réessayer]
  if (els.btnRetry) {
    els.btnRetry.addEventListener('click', async () => {
      show('downloading', { version: _currentVersion, percent: 0 });
      if (els.pct)  els.pct.textContent  = '0%';
      if (els.fill) els.fill.style.width = '0%';
      try {
        await window.discowlAPI.updates.download();
      } catch (e) {
        show('error', { message: e?.message });
      }
    });
  }

  return { show, hide };
})();

/* ── Brancher les événements IPC update ──────────────────── */
(function initUpdateListeners() {
  const api = window.discowlAPI?.updates;
  if (!api) return;

  // MAJ disponible → afficher la barre
  // Le preload expose : onAvailable (pas onUpdateAvailable)
  api.onAvailable?.((data) => {
    updBar.show('available', { version: data.version });
  });

  // Progression du téléchargement
  api.onDownloadProgress?.((data) => {
    updBar.show('downloading', {
      version:        data.version,
      percent:        data.percent,
      bytesPerSecond: data.bytesPerSecond,
      transferred:    data.transferred,
      total:          data.total,
    });
  });

  // Téléchargement terminé → prêt à installer
  // Le preload expose : onReady (pas onUpdateReady)
  api.onReady?.((data) => {
    updBar.show('ready', { version: data.version });
  });

  // Erreur de téléchargement
  // Le preload expose : onError (pas onDownloadError)
  api.onError?.((data) => {
    updBar.show('error', { message: data.message });
  });
})();