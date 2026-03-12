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
  initMenubar();

  // Nouvelles fenêtres demandées par des sites → ouvrir en onglet
  window.addEventListener('discowl:open-tab', (e) => {
    createTab(e.detail.url, false);
  });

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
    title:     isPrivate ? 'Private Home' : 'Home',
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
    // Ignorer si l'onglet est sur le newtab (pas d'URL = homepage)
    if (!tab.url) return;
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

  if (tab.isDownloadsTab) {
    ntpEl?.classList.add('hidden');
    webviewContainer?.querySelectorAll('webview').forEach(wv => wv.classList.remove('active'));
    dlPage?.classList.remove('hidden');
    window.DownloadManager?.renderFullPage?.();
  } else {
    dlPage?.classList.add('hidden');
    if (ntpEl) ntpEl.classList.toggle('hidden', !!tab.url);
    if (!tab.url) {
      // Mettre à jour le titre selon le mode actuel (Tor peut avoir changé)
      tab.title = tab.isPrivate
        ? (settings.torEnabled ? 'Tor Home' : 'Private Home')
        : 'Home';
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
    icon.innerHTML = `<path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`;
  } else {
    btn.title = 'Reload (F5)';
    icon.innerHTML = `<path d="M13.5 4.5A6 6 0 1014.8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M11 2l3 2.5-2.5 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
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
  document.getElementById('bookmark-star-btn').addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab) return;
    // Fallback : lire l'URL depuis la barre si tab.url est vide
    const url = tab.url || document.getElementById('url-bar')?.value?.trim();
    if (!url || url === 'about:newtab' || url.startsWith('about:')) return;
    const title = tab.title && tab.title !== 'Home' && tab.title !== 'Private Home' && tab.title !== 'Tor Home'
      ? tab.title
      : url;
    window.BookmarksManager?.openStarPopup(title, url);
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
  mb('new-private',      () => createTab('about:newtab', true));
  mb('open-url',         () => document.getElementById('url-bar')?.focus());
  mb('save-page',        () => getActiveTab()?.webview?.downloadURL(getActiveTab()?.url));
  mb('print',            () => getActiveTab()?.webview?.print?.());
  mb('quit',             () => window.close());

  // Edit
  mb('find',             () => {
    const tab = getActiveTab();
    if (tab?.webview) tab.webview.executeJavaScript("window.find?.('') || document.execCommand?.('find')");
  });
  mb('cut',              () => document.execCommand('cut'));
  mb('copy',             () => document.execCommand('copy'));
  mb('paste',            () => document.execCommand('paste'));
  mb('select-all',       () => document.execCommand('selectAll'));
  mb('settings',         () => window.SettingsManager?.open());

  // View
  mb('zoom-in',          () => zoomActive(0.1));
  mb('zoom-out',         () => zoomActive(-0.1));
  mb('zoom-reset',       () => zoomActive(0, true));
  mb('fullscreen',       () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });
  mb('toggle-bookmarks-bar', () => {
    const bar = document.getElementById('bookmarks-toolbar');
    if (bar) bar.classList.toggle('hidden');
  });
  mb('devtools',         () => getActiveTab()?.webview?.openDevTools());

  // History
  mb('back',             () => document.getElementById('back-btn')?.click());
  mb('forward',          () => document.getElementById('forward-btn')?.click());
  mb('show-history',     () => window.SidebarManager?.toggleRight());
  mb('clear-history',    () => {
    if (confirm('Clear all browsing history?')) window.HistoryManager?.clear();
  });

  // Bookmarks
  mb('bookmark-page',    () => document.getElementById('bookmark-star-btn')?.click());
  mb('show-bookmarks',   () => window.SidebarManager?.toggleLeft());

  // Help
  mb('about',            () => {
    window.discowlAPI.app.getVersion().then(v => alert(`Discowl Browser v${v}\nA modern, privacy-focused browser.`));
  });
  mb('github',           () => window.discowlAPI.shell.openExternal('https://github.com/VassiaTheGOAT/Discowl-Browser'));
  mb('check-updates',    async () => {
    showToast('Checking for updates…', 'info');
    try {
      const result = await window.discowlAPI.updates.check();
      if (result.upToDate) showToast('Already up to date ✓', 'success');
      else showToast(`Update ${result.latest} available — restart to install`, 'info');
    } catch { showToast('Could not check for updates', 'error'); }
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

function clearNewtabSearch() {
  const searchInput = document.getElementById('newtab-search-input');
  if (searchInput) searchInput.value = '';
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