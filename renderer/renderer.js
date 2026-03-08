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
  duckduckgo: {
    name: 'DuckDuckGo',
    url:  'https://duckduckgo.com/?q=',
    // SVG officiel DuckDuckGo
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><circle cx="64" cy="64" r="64" fill="#de5833"/><ellipse cx="64" cy="54" rx="28" ry="32" fill="#fff"/><circle cx="54" cy="46" r="5" fill="#3d3d3d"/><circle cx="56" cy="45" r="2" fill="#fff"/><path d="M50 66 Q64 76 78 66" stroke="#de5833" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="64" cy="96" rx="18" ry="10" fill="#4c9a2a"/><path d="M46 90 Q64 106 82 90" fill="#4c9a2a"/></svg>`
  },
  google: {
    name: 'Google',
    url:  'https://www.google.com/search?q=',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`
  },
  bing: {
    name: 'Bing',
    url:  'https://www.bing.com/search?q=',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 2v14.7l4.2 2.4 8.3-4.8-4.2-1.5V5.3L5 2z" fill="#00809d"/><path d="M9.2 19.1V11l8.3 3-4.1 2.3-4.2-1.5v2.8l4.2 2.4 4.6-2.7-8.8-8.5v10z" fill="#008373"/></svg>`
  },
  brave: {
    name: 'Brave Search',
    url:  'https://search.brave.com/search?q=',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19.7 7.3L21 5.5l-1.4-.6-1 1.4c-.4-.3-.9-.6-1.4-.8l.3-1.7-1.5-.3-.4 1.7c-.5-.1-1-.1-1.6-.1s-1.1 0-1.6.1L13 3.5l-1.5.3.3 1.7c-.5.2-1 .5-1.4.8L9.4 4.9 8 5.5l1.3 1.8c-.4.4-.8.9-1.1 1.4l-1.7-.5-.5 1.4 1.6.7c-.2.5-.3 1.1-.4 1.7l-1.7.1v1.5l1.7.1c.1.6.2 1.2.4 1.7l-1.6.7.5 1.4 1.7-.5c.3.5.7 1 1.1 1.4L8 21.5l1.4.6 1-1.4c.4.3.9.6 1.4.8l-.3 1.7 1.5.3.4-1.7c.5.1 1 .1 1.6.1s1.1 0 1.6-.1l.4 1.7 1.5-.3-.3-1.7c.5-.2 1-.5 1.4-.8l1 1.4 1.4-.6-1.3-1.8c.4-.4.8-.9 1.1-1.4l1.7.5.5-1.4-1.6-.7c.2-.5.3-1.1.4-1.7l1.7-.1v-1.5l-1.7-.1c-.1-.6-.2-1.2-.4-1.7l1.6-.7-.5-1.4-1.7.5c-.3-.5-.7-1-1.1-1.4zM12 17.5c-3 0-5.5-2.5-5.5-5.5S9 6.5 12 6.5s5.5 2.5 5.5 5.5-2.5 5.5-5.5 5.5z" fill="#fb542b"/><circle cx="12" cy="12" r="3" fill="#fb542b"/></svg>`
  },
  ecosia: {
    name: 'Ecosia',
    url:  'https://www.ecosia.org/search?q=',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#4a9b3f"/><path d="M12 4C7.6 4 4 7.6 4 12s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm3.5 11.5c-.8.8-2 1.3-3.5 1.3-1.4 0-2.6-.5-3.5-1.3-.9-.9-1.5-2.1-1.5-3.5 0-1.4.5-2.6 1.4-3.5h5.7c.3.3.5.6.7 1H9.6c-.5.6-.8 1.5-.8 2.4h7.5c0 .1-.1.3-.1.4 0 .8-.3 1.6-.7 2.2h-5.6c.4.5 1 .9 1.7 1.1 1.5.4 3.1-.1 4.1-1.1l1.1 1.1c-.4.4-.8.7-1.3.9z" fill="#fff"/></svg>`
  }
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
document.addEventListener('DOMContentLoaded', async () => {
  settings      = await window.discowlAPI.settings.get();
  currentEngine = settings.defaultEngine || 'duckduckgo';

  // Appliquer le thème AVANT tout affichage pour éviter le flash
  applyTheme(settings.theme || 'dark');

  updateEngineUI();
  setupToolbar();
  setupSandwichMenu();
  setupKeyboardShortcuts();
  setupNewTabPage();
  applySettings(settings);
  updateTorIndicator();
  window.DownloadManager?.init();

  // Nouvelles fenêtres demandées par des sites → ouvrir en onglet
  window.addEventListener('discowl:open-tab', (e) => {
    createTab(e.detail.url, false);
  });

  // ── Mises à jour ──────────────────────────────────────────
  if (window.discowlAPI.updates) {
    window.discowlAPI.updates.onAvailable((info) => {
      showUpdateBanner('update-available', info.version);
    });
    window.discowlAPI.updates.onProgress((p) => {
      const el = document.getElementById('update-banner-desc');
      if (el) el.textContent = `Downloading update… ${p.percent}%`;
    });
    window.discowlAPI.updates.onReady((info) => {
      showUpdateBanner('update-ready', info.version);
    });
  }

  // Ouvrir sur la page d'accueil Discowl (newtab), pas une URL externe
  createTab('about:newtab', false);
  // Appliquer le mode NTP initial
  updateNewtabMode(false);
});

/* ══════════════════════════════════════════════════════════════
   PUBLIC API (used by components)
══════════════════════════════════════════════════════════════ */
window.DiscowlBrowser = {
  navigate:          (url)   => navigateActive(url),
  getCurrentUrl:     ()      => getActiveTab()?.url   || '',
  getCurrentTitle:   ()      => getActiveTab()?.title || '',
  setEngine:         (key)   => setEngine(key),
  setTheme:          (theme) => applyTheme(theme),
  onSettingsChanged: (s)     => { settings = s; applySettings(s); },
  getTabById:        (id)    => getTab(id),
  switchToTab:       (id)    => switchTab(id),
  closeTab:          (id)    => closeTab(id),
  openDownloadsTab:  ()      => _openDownloadsTab()
};

/* ══════════════════════════════════════════════════════════════
   DOWNLOADS TAB
══════════════════════════════════════════════════════════════ */
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
    title:     'Downloads',
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
  const id        = ++tabCounter;
  const partition = isPrivate
    ? `partition:private-${id}`  // Not persisted = private session
    : 'persist:main';             // Shared, persisted session

  /* ─── Create webview element ─────────────────────────────── */
  const webview = document.createElement('webview');
  webview.setAttribute('partition', partition);
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no');
  webview.dataset.tabId = id;

  const targetUrl = resolveUrl(url);
  if (targetUrl !== 'about:newtab') {
    webview.setAttribute('src', targetUrl);
  }

  document.getElementById('webview-container').appendChild(webview);

  /* ─── Tab state ──────────────────────────────────────────── */
  const tab = {
    id,
    title:     isPrivate ? 'Private tab' : 'New tab',
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
  webview.addEventListener('did-start-loading', () => {
    tab.isLoading = true;
    refreshTab(id);
    if (activeTabId === id) { updateNavButtons(); updateReloadBtn(true); }
  });

  webview.addEventListener('did-stop-loading', () => {
    tab.isLoading = false;
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
      updateUrlBar(e.url);
      updateSecurityIcon(e.url);
      updateBookmarkStar(e.url);
    }
    // Don't log private tabs in history
    if (!isPrivate && e.url && !e.url.startsWith('about:')) {
      HistoryManager.addEntry(tab.title, e.url, tab.favicon);
    }
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame) {
      tab.url = e.url;
      if (activeTabId === id) {
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
    if (activeTabId === id) document.title = `${e.title} — Discowl`;
  });

  webview.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons?.length) {
      tab.favicon = e.favicons[0];
      refreshTab(id);
    }
  });

  webview.addEventListener('new-window', (e) => {
    e.preventDefault();
    createTab(e.url, isPrivate);
  });

  // Certains sites forcent la navigation vers une URL externe via will-navigate
  // avec disposition != 'current-tab' — on l'intercepte aussi
  webview.addEventListener('will-navigate', (e) => {
    // Si l'URL change et que la target est explicitement une nouvelle fenêtre
    // (détecté par le fait que l'URL est complètement différente du domaine courant)
    // → laisser faire (navigation normale dans l'onglet)
  });

  webview.addEventListener('close', () => {
    closeTab(id);
  });

  webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return; // Aborted — user navigated away
    tab.isLoading = false;
    tab.title = 'Erreur de chargement';
    refreshTab(id);
  });

  webview.addEventListener('update-target-url', (e) => {
    if (activeTabId === id) {
      document.getElementById('status-text').textContent = e.url || '';
    }
  });

  webview.addEventListener('context-menu', (e) => {
    // Basic context menu handling could be added here
  });

  /* ─── Render tab bar item ────────────────────────────────── */
  renderTabItem(tab);

  /* ─── Switch to this tab ─────────────────────────────────── */
  switchTab(id);

  return id;
}

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

  const faviconImg = document.createElement('img');
  faviconImg.className = 'tab-favicon';
  faviconImg.src = tab.favicon || '';
  faviconImg.onerror = () => { faviconImg.style.display = 'none'; };
  if (!tab.favicon) faviconImg.style.display = 'none';
  faviconSlot.appendChild(faviconImg);

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title;

  const close = document.createElement('button');
  close.className = 'tab-close';
  close.title = 'Close tab';
  close.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });

  if (tab.isPrivate) {
    const badge = document.createElement('span');
    badge.className = 'tab-private-badge';
    badge.title = 'Private browsing';
    badge.textContent = '🕵';
    el.appendChild(badge);
  }

  el.appendChild(faviconSlot);
  el.appendChild(title);
  el.appendChild(close);

  el.addEventListener('click', () => switchTab(tab.id));

  // Middle click to close
  el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab.id); });

  // ── Drag & drop pour réordonner ──
  el.draggable = true;

  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', tab.id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => el.classList.add('tab-dragging'), 0);
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('tab-dragging');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab-drag-over'));
  });

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab-drag-over'));
    el.classList.add('tab-drag-over');
  });

  el.addEventListener('dragleave', () => {
    el.classList.remove('tab-drag-over');
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('tab-drag-over');
    const draggedId = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (draggedId === tab.id) return;

    const container = document.getElementById('tabs-container');
    const newTabBtn = document.getElementById('new-tab-btn');
    const draggedEl = document.querySelector(`.tab[data-tab-id="${draggedId}"]`);
    const targetEl  = el;
    if (!draggedEl || !targetEl) return;

    // Réordonner dans le DOM
    const allTabs = [...container.querySelectorAll('.tab[data-tab-id]')];
    const dragIdx = allTabs.indexOf(draggedEl);
    const dropIdx = allTabs.indexOf(targetEl);
    if (dragIdx < dropIdx) {
      container.insertBefore(draggedEl, targetEl.nextSibling || newTabBtn);
    } else {
      container.insertBefore(draggedEl, targetEl);
    }

    // Synchroniser le tableau tabs[]
    const di = tabs.findIndex(t => t.id === draggedId);
    const ti = tabs.findIndex(t => t.id === tab.id);
    if (di !== -1 && ti !== -1) {
      const [moved] = tabs.splice(di, 1);
      tabs.splice(ti, 0, moved);
    }
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

  if (tab.isDownloadsTab) {
    ntpEl?.classList.add('hidden');
    webviewContainer?.querySelectorAll('webview').forEach(wv => wv.classList.remove('active'));
    dlPage?.classList.remove('hidden');
    window.DownloadManager?.renderFullPage?.();
  } else {
    dlPage?.classList.add('hidden');
    if (ntpEl) ntpEl.classList.toggle('hidden', !!tab.url);
    if (!tab.url) updateNewtabMode(tab.isPrivate);
  }

  updateUrlBar(tab.url);
  updateNavButtons();
  updateReloadBtn(tab.isLoading);
  updateSecurityIcon(tab.url);
  updateBookmarkStar(tab.url);
  updateZoomIndicator(tab);
  document.title = tab.title + ' — Discowl';
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
function navigateActive(url, _fromVirtualBack = false) {
  const tab = getActiveTab();
  if (!tab) return;
  const resolved = resolveUrl(url);
  const ntpEl    = document.getElementById('new-tab-page');

  if (resolved === 'about:newtab') {
    tab.webview.classList.remove('active');
    tab.url   = '';
    tab.title = tab.isPrivate ? 'Private tab' : 'New tab';
    refreshTab(tab.id);
    if (ntpEl) ntpEl.classList.remove('hidden');
    updateNewtabMode(tab.isPrivate);
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
  if (input.startsWith('about:') || input.startsWith('data:') || input.startsWith('file:')) return input;
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
    icon.innerHTML = `<path d="M4 4l10 10M14 4L4 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
  } else {
    btn.title = 'Reload (F5)';
    icon.innerHTML = `<path d="M3 9a6 6 0 106-6H6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M2 5l4 1-1 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
}

function updateZoomIndicator(tab) {
  const btn = document.getElementById('zoom-indicator');
  if (!btn) return;
  if (!tab || tab.zoom === 1 || !tab.zoom) {
    btn.classList.add('hidden');
  } else {
    btn.textContent = Math.round(tab.zoom * 100) + '%';
    btn.classList.remove('hidden');
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
    icon.title = 'Secure connection (HTTPS)';
  } else {
    icon.className = 'security-icon warning';
    icon.title = 'Insecure connection (HTTP)';
  }
}

function updateBookmarkStar(url) {
  // Délègue à BookmarksManager qui gère aussi l'état SVG (filled/outline)
  if (window.BookmarksManager) {
    window.BookmarksManager.updateStarBtn(url);
  } else {
    // Fallback minimal si BookmarksManager pas encore chargé
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
      const next = tab._nextAfterNewtab;
      tab._nextAfterNewtab = '';
      tab._prevWasNewtab   = true;
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
  // Ouvre la star popup (style Firefox) : confirm/edit avant sauvegarde
  document.getElementById('bookmark-star-btn').addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab?.url || tab.url === 'about:newtab') return;
    window.BookmarksManager?.openStarPopup(tab.title, tab.url);
  });

  /* ─── Zoom indicator ────────────────────────────────────── */
  document.getElementById('zoom-indicator')?.addEventListener('click', () => {
    zoomActive(0, true);
  });

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
  if (iconEl) { iconEl.innerHTML = engine.svg; }

  document.querySelectorAll('.engine-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.engine === currentEngine);
  });
}

/* ══════════════════════════════════════════════════════════════
   SANDWICH MENU
══════════════════════════════════════════════════════════════ */
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
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === 't') { e.preventDefault(); createTab('about:newtab', false); }
    if (ctrl && e.shiftKey && e.key === 'T') { e.preventDefault(); createTab('about:newtab', true); }
    if (ctrl && e.key === 'w') { e.preventDefault(); closeTab(activeTabId); }
    if (ctrl && e.key === 'l') { e.preventDefault(); document.getElementById('url-bar').focus(); }
    if (ctrl && e.key === 'b') { e.preventDefault(); window.SidebarManager?.toggleLeft(); }
    if (ctrl && e.key === 'h') { e.preventDefault(); window.SidebarManager?.toggleRight(); }
    if (ctrl && e.key === 'r' || e.key === 'F5') { e.preventDefault(); getActiveTab()?.webview.reload(); }
    if (ctrl && e.key === '=' || ctrl && e.key === '+') { e.preventDefault(); zoomActive(0.1); }
    if (ctrl && e.key === '-')  { e.preventDefault(); zoomActive(-0.1); }
    if (ctrl && e.key === '0')  { e.preventDefault(); zoomActive(0, true); }

    // Tab switching Ctrl+1..9
    if (ctrl && e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      if (tabs[idx]) { e.preventDefault(); switchTab(tabs[idx].id); }
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
  try {
    tab.webview.setZoomFactor(tab.zoom);
    const pct = Math.round(tab.zoom * 100);
    updateZoomIndicator(tab);
  } catch {}
}

/* ══════════════════════════════════════════════════════════════
   UPDATE BANNER
══════════════════════════════════════════════════════════════ */
function showUpdateBanner(type, version) {
  let banner = document.getElementById('update-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.className = 'update-banner';
    document.body.appendChild(banner);
  }

  const isReady = type === 'update-ready';

  banner.innerHTML = `
    <div class="update-banner-left">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 1v7M5 5l3 4 3-4M2 13h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div>
        <div class="update-banner-title">${isReady ? `Discowl ${version} ready to install` : `Discowl ${version} available`}</div>
        <div class="update-banner-desc" id="update-banner-desc">${isReady ? 'Restart to apply the update' : 'Downloading in background…'}</div>
      </div>
    </div>
    <div class="update-banner-actions">
      ${isReady ? `<button class="update-btn primary" id="update-install-btn">Restart & Install</button>` : ''}
      <button class="update-btn secondary" id="update-dismiss-btn">Later</button>
    </div>
  `;

  banner.classList.remove('hidden');

  if (isReady) {
    document.getElementById('update-install-btn')?.addEventListener('click', () => {
      window.discowlAPI.updates.install();
    });
  }
  document.getElementById('update-dismiss-btn')?.addEventListener('click', () => {
    banner.classList.add('hidden');
  });
}

/* ══════════════════════════════════════════════════════════════
   NEWTAB MODE — adapte l'apparence selon privé/Tor
══════════════════════════════════════════════════════════════ */
function updateNewtabMode(isPrivate) {
  const ntpEl   = document.getElementById('new-tab-page');
  const titleEl = document.getElementById('newtab-title');
  if (!ntpEl || !titleEl) return;

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


/* ══════════════════════════════════════════════════════════════
   SETTINGS APPLICATION
══════════════════════════════════════════════════════════════ */
function applySettings(s) {
  // Thème — appliqué sur <html> pour le chrome complet du navigateur
  if (s.theme) applyTheme(s.theme);

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