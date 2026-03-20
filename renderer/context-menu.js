/* ══════════════════════════════════════════════════════════════
   CONTEXT MENU — clic droit dans la webview
   Comportement identique à Chrome/Firefox
══════════════════════════════════════════════════════════════ */

(function initContextMenu() {

  // ── Créer le DOM du menu ──────────────────────────────────
  const menu = document.createElement('div');
  menu.id = 'ctx-menu';
  menu.className = 'ctx-menu hidden';
  document.body.appendChild(menu);

  let _activeWebview = null;
  let _params        = null;

  // ── Fermeture ─────────────────────────────────────────────
  function hideCtx() {
    menu.classList.add('hidden');
    menu.innerHTML = '';
    _params = null;
  }

  document.addEventListener('mousedown', (e) => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target)) hideCtx();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtx(); });

  // ── Helpers de construction ────────────────────────────────
  function item(label, icon, action, disabled = false) {
    const el = document.createElement('div');
    el.className = 'ctx-item' + (disabled ? ' ctx-disabled' : '');
    el.innerHTML = `<span class="ctx-icon">${icon}</span><span class="ctx-label">${label}</span>`;
    if (!disabled) el.addEventListener('click', () => { hideCtx(); action(); });
    return el;
  }

  function sep() {
    const el = document.createElement('div');
    el.className = 'ctx-sep';
    return el;
  }

  function shortcutItem(label, icon, shortcut, action, disabled = false) {
    const el = document.createElement('div');
    el.className = 'ctx-item' + (disabled ? ' ctx-disabled' : '');
    el.innerHTML = `<span class="ctx-icon">${icon}</span><span class="ctx-label">${label}</span><span class="ctx-shortcut">${shortcut}</span>`;
    if (!disabled) el.addEventListener('click', () => { hideCtx(); action(); });
    return el;
  }

  // ── SVG icons ─────────────────────────────────────────────
  const ICONS = {
    back:        `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    forward:     `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 2l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    reload:      `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 2.5A6 6 0 1 0 13 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M10 .5l3 2-2.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    save:        `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M3 6l4 4 4-4M1 11h12v2H1z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    print:       `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="5" width="12" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M3 5V2h8v3M3 9h2v3h4V9h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    copy:        `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="5" y="1" width="8" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M1 4v9h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    paste:       `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 3H2a1 1 0 00-1 1v9a1 1 0 001 1h8a1 1 0 001-1V4a1 1 0 00-1-1h-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="4" y="1" width="6" height="3" rx="1" stroke="currentColor" stroke-width="1.4"/></svg>`,
    cut:         `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 1l8 8M11 1L3 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="3" cy="11" r="2" stroke="currentColor" stroke-width="1.4"/><circle cx="11" cy="11" r="2" stroke="currentColor" stroke-width="1.4"/></svg>`,
    selectAll:   `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2"/></svg>`,
    link:        `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M6 8a3.5 3.5 0 005 0l1.5-1.5a3.5 3.5 0 00-5-5L6 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 6a3.5 3.5 0 00-5 0L1.5 7.5a3.5 3.5 0 005 5L8 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    newTab:      `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    newPrivate:  `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="5" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M1 12c0-3.31 2.69-6 6-6s6 2.69 6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="12" y1="1" x2="2" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    image:       `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="4.5" cy="5.5" r="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M1 10l3.5-3.5L7 9l2-2 4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    search:      `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    inspect:     `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 3h12M1 7h8M1 11h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="11" cy="10" r="2" stroke="currentColor" stroke-width="1.4"/><path d="M12.4 11.4l1.6 1.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    viewSource:  `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 4L1 7l3 3M10 4l3 3-3 3M8 2l-2 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    bookmark:    `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2h10v11l-5-3-5 3V2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
    download:    `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M3 6l4 4 4-4M1 12h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    copyLink:    `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M6 8a3.5 3.5 0 005 0l1.5-1.5a3.5 3.5 0 00-5-5L6 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 6a3.5 3.5 0 00-5 0L1.5 7.5a3.5 3.5 0 005 5L8 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  };

  // ── Construction du menu selon le contexte ────────────────
  function buildMenu(wv, p) {
    menu.innerHTML = '';

    const sel         = p.selectionText?.trim() || '';
    const linkUrl     = p.linkURL || '';
    const srcUrl      = p.srcURL  || '';
    const isEditable  = p.isEditable;
    const mediaType   = p.mediaType; // 'image' | 'video' | 'audio' | 'none'
    const _activeTab  = window.getActiveTab?.();
    const pageUrl     = _activeTab?.url || wv.getURL?.() || '';
    const isPrivate   = getActiveTab()?.isPrivate || false;

    // ── Lien ─────────────────────────────────────────────────
    if (linkUrl) {
      const displayUrl = linkUrl.length > 50 ? linkUrl.slice(0, 50) + '…' : linkUrl;
      menu.appendChild(item(i18n.t('ctx.open_link_tab'), ICONS.newTab, () => createTab(linkUrl, isPrivate)));
      menu.appendChild(item(i18n.t('ctx.open_link_private'), ICONS.newPrivate, () => createTab(linkUrl, true)));
      menu.appendChild(item(i18n.t('ctx.open_link_window'), ICONS.newTab, () => window.discowlAPI.openNewWindow(linkUrl)));
      menu.appendChild(sep());
      menu.appendChild(item(i18n.t('ctx.copy_link'), ICONS.copyLink, () => navigator.clipboard.writeText(linkUrl)));
      if (sel) menu.appendChild(item(i18n.t('ctx.copy_text'), ICONS.copy, () => navigator.clipboard.writeText(sel)));
      menu.appendChild(sep());
    }

    // ── Image ────────────────────────────────────────────────
    if (mediaType === 'image' && srcUrl) {
      menu.appendChild(item(i18n.t('ctx.open_image_tab'), ICONS.image, () => createTab(srcUrl, isPrivate)));
      menu.appendChild(item(i18n.t('ctx.save_image'), ICONS.download, () => {
        wv.downloadURL(srcUrl);
      }));
      menu.appendChild(item(i18n.t('ctx.copy_image_url'), ICONS.copyLink, () => navigator.clipboard.writeText(srcUrl)));
      menu.appendChild(sep());
    }

    // ── Vidéo / Audio ────────────────────────────────────────
    if ((mediaType === 'video' || mediaType === 'audio') && srcUrl) {
      menu.appendChild(item(i18n.t('ctx.save_media'), ICONS.download, () => wv.downloadURL(srcUrl)));
      menu.appendChild(item(i18n.t('ctx.copy_media_url'), ICONS.copyLink, () => navigator.clipboard.writeText(srcUrl)));
      menu.appendChild(sep());
    }

    // ── Champ éditable ────────────────────────────────────────
    if (isEditable) {
      menu.appendChild(shortcutItem(i18n.t('ctx.undo'), '', 'Ctrl+Z', () => wv.undo?.(), !p.editFlags?.canUndo));
      menu.appendChild(shortcutItem(i18n.t('ctx.redo'), '', 'Ctrl+Y', () => wv.redo?.(), !p.editFlags?.canRedo));
      menu.appendChild(sep());
      menu.appendChild(shortcutItem(i18n.t('ctx.cut'),   ICONS.cut,  'Ctrl+X', () => wv.cut?.(),  !p.editFlags?.canCut));
      menu.appendChild(shortcutItem(i18n.t('ctx.copy'),  ICONS.copy, 'Ctrl+C', () => wv.copy?.(), !p.editFlags?.canCopy || !sel));
      menu.appendChild(shortcutItem(i18n.t('ctx.paste'), ICONS.paste,'Ctrl+V', () => wv.paste?.(),!p.editFlags?.canPaste));
      menu.appendChild(sep());
      menu.appendChild(shortcutItem(i18n.t('ctx.select_all'), ICONS.selectAll, 'Ctrl+A', () => wv.selectAll?.()));
      menu.appendChild(sep());
    }

    // ── Texte sélectionné ─────────────────────────────────────
    if (sel && !isEditable) {
      menu.appendChild(shortcutItem(i18n.t('ctx.copy'), ICONS.copy, 'Ctrl+C', () => navigator.clipboard.writeText(sel)));
      const engine = window.currentEngine || 'duckduckgo';
      const engines = { google:'https://www.google.com/search?q=', duckduckgo:'https://duckduckgo.com/?q=', bing:'https://www.bing.com/search?q=', brave:'https://search.brave.com/search?q=', qwant:'https://www.qwant.com/?q=', ecosia:'https://www.ecosia.org/search?q=' };
      const searchUrl = (engines[engine] || engines.duckduckgo) + encodeURIComponent(sel);
      const shortSel = sel.length > 25 ? sel.slice(0, 25) + '…' : sel;
      menu.appendChild(item(i18n.t('ctx.search_for').replace('{q}', `"${shortSel}"`), ICONS.search, () => createTab(searchUrl, isPrivate)));
      menu.appendChild(sep());
    }

    // ── Page (toujours présent sauf éditable sans sélection) ──
    if (!isEditable || sel) {
      if (!linkUrl && !mediaType?.match(/image|video|audio/) && !isEditable) {
        const _tab = window.getActiveTab?.() || null;
        const _canBack    = _tab && (_tab.canGoBack || _tab._prevWasNewtab);
        const _canForward = _tab && (_tab.canGoForward || (!_tab.url && _tab._nextAfterNewtab));
        menu.appendChild(item(i18n.t('ctx.open_new_window'), ICONS.newTab, () => {
          window.discowlAPI.openNewWindow();
        }));
        menu.appendChild(sep());
        menu.appendChild(shortcutItem(i18n.t('ctx.back'),    ICONS.back,   'Alt+←', () => {
          if (!_tab) return;
          if (_tab.webview?.canGoBack()) {
            _tab.webview.goBack();
          } else if (_tab._prevWasNewtab) {
            _tab._nextAfterNewtab = _tab.url;
            _tab._prevWasNewtab   = false;
            window.navigateActive?.('about:newtab');
          }
        }, !_canBack));
        menu.appendChild(shortcutItem(i18n.t('ctx.forward'), ICONS.forward,'Alt+→', () => {
          if (!_tab) return;
          if (_tab.webview?.canGoForward()) {
            _tab.webview.goForward();
          } else if (!_tab.url && _tab._nextAfterNewtab) {
            const next = _tab._nextAfterNewtab;
            _tab._nextAfterNewtab = '';
            _tab._prevWasNewtab   = true;
            window.navigateActive?.(next);
          }
        }, !_canForward));
        menu.appendChild(shortcutItem(i18n.t('ctx.reload'),  ICONS.reload, 'F5', () => {
          if (_tab?.webview) _tab.webview.reload();
          else if (!_tab?.url) {} // homepage — rien à recharger
        }));
        menu.appendChild(sep());
        menu.appendChild(item(i18n.t('ctx.bookmark_page'), ICONS.bookmark, () => {
          document.getElementById('bookmark-star-btn')?.click();
        }, !pageUrl || pageUrl.startsWith('about:')));
        menu.appendChild(shortcutItem(i18n.t('ctx.save_page'), ICONS.save, 'Ctrl+S', () => {
          const t = window.getActiveTab?.();
          if (t?.webview && t.url) t.webview.executeJavaScript('document.execCommand("saveAs")').catch(() => {});
        }, !pageUrl || pageUrl.startsWith('about:')));
        menu.appendChild(shortcutItem(i18n.t('ctx.print'), ICONS.print, 'Ctrl+P', () => {
          const t = window.getActiveTab?.();
          if (t?.webview && t.url) t.webview.print?.();
          else window.print?.();
        }));
        menu.appendChild(sep());
      }
    }

    // ── Développeur (toujours en bas) ─────────────────────────
    if (pageUrl && !pageUrl.startsWith('about:')) {
      menu.appendChild(item(i18n.t('ctx.view_source'), ICONS.viewSource, () => {
        createTab('view-source:' + pageUrl, isPrivate);
      }));
    }
    const _hasPage = pageUrl && !pageUrl.startsWith('about:');
    menu.appendChild(item(i18n.t('ctx.inspect'), ICONS.inspect, () => {
      const t = window.getActiveTab?.();
      if (!t) return;
      // Try webview directly
      const wv = t.webview;
      if (wv) {
        console.log('[Inspect] calling openDevTools on webview', wv);
        wv.openDevTools();
      }
    }));
  }

  // ── Positionnement ─────────────────────────────────────────
  function positionMenu(x, y) {
    menu.classList.remove('hidden');
    const mw = menu.offsetWidth  || 220;
    const mh = menu.offsetHeight || 300;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    menu.style.left = (x + mw > vw ? vw - mw - 6 : x) + 'px';
    menu.style.top  = (y + mh > vh ? vh - mh - 6 : y) + 'px';
  }

  // ── Point d'entrée ─────────────────────────────────────────
  window._showContextMenu = function(wv, params, screenX, screenY) {
    hideCtx();
    _activeWebview = wv;
    _params        = params;
    buildMenu(wv, params);
    // Attendre que le DOM soit calculé pour positionner
    requestAnimationFrame(() => positionMenu(screenX, screenY));
  };

  window._hideContextMenu = hideCtx;

})();