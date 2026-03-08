/* ─────────────────────────────────────────────────────────────────
   downloads.js — Gestionnaire de téléchargements Discowl
   • Reçoit les events via IPC (download:started / download:updated)
   • Panel dropdown sous la toolbar (style Firefox)
   • Page complète via createTab('about:downloads')
───────────────────────────────────────────────────────────────── */
'use strict';

window.DownloadManager = (() => {

  /* ── État ────────────────────────────────────────────────────── */
  const downloads = new Map();   // id → item
  let panelOpen   = false;

  /* ── Helpers ─────────────────────────────────────────────────── */
  function fmt(bytes) {
    if (bytes < 1024)       return bytes + ' B';
    if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  function speed(item) {
    if (!item._lastBytes || !item._lastTime) return '';
    const dt = (Date.now() - item._lastTime) / 1000;
    const db = item.receivedBytes - item._lastBytes;
    if (dt <= 0) return '';
    const bps = db / dt;
    return fmt(bps) + '/s';
  }

  function eta(item) {
    if (!item.totalBytes || item.receivedBytes >= item.totalBytes) return '';
    if (!item._lastBytes || !item._lastTime) return '';
    const dt = (Date.now() - item._lastTime) / 1000;
    const db = item.receivedBytes - item._lastBytes;
    if (dt <= 0 || db <= 0) return '';
    const remaining = item.totalBytes - item.receivedBytes;
    const secs = remaining / (db / dt);
    if (secs < 60)  return Math.round(secs) + 's';
    if (secs < 3600) return Math.round(secs / 60) + 'min';
    return Math.round(secs / 3600) + 'h';
  }

  function pct(item) {
    if (!item.totalBytes) return 0;
    return Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100));
  }

  function stateLabel(item) {
    if (item.state === 'progressing') return pct(item) + '%';
    if (item.state === 'completed')   return 'Done';
    if (item.state === 'cancelled')   return 'Cancelled';
    if (item.state === 'interrupted') return 'Interrupted';
    return item.state;
  }

  function stateColor(item) {
    if (item.state === 'completed')   return 'var(--green, #22c55e)';
    if (item.state === 'cancelled')   return 'var(--text-muted)';
    if (item.state === 'interrupted') return 'var(--red, #ef4444)';
    return 'var(--accent)';
  }

  function basename(p) {
    return (p || 'file').split(/[\\/]/).pop() || 'file';
  }

  /* ── Badge de l'icône ────────────────────────────────────────── */
  function updateBadge() {
    const btn   = document.getElementById('downloads-btn');
    const badge = document.getElementById('downloads-badge');
    if (!btn || !badge) return;
    const active = [...downloads.values()].filter(d => d.state === 'progressing').length;
    badge.textContent = active;
    badge.classList.toggle('hidden', active === 0);
  }

  /* ── Rendu d'un item (panel ou page) ─────────────────────────── */
  function renderItem(item, compact = true) {
    const el = document.createElement('div');
    el.className = 'dl-item' + (compact ? ' dl-compact' : '');
    el.dataset.dlId = item.id;

    const name  = basename(item.savePath || item.filename || item.url);
    const done  = item.state !== 'progressing';
    const p     = pct(item);

    el.innerHTML = `
      <div class="dl-icon">
        ${done
          ? `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v9M5 8l4 4 4-4M2 15h14" stroke="${stateColor(item)}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          : `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="44" stroke-dashoffset="${44 - (44 * p / 100)}" stroke-linecap="round" transform="rotate(-90 9 9)"/><circle cx="9" cy="9" r="7" stroke="var(--bg-input)" stroke-width="1.6" fill="none"/></svg>`
        }
      </div>
      <div class="dl-info">
        <div class="dl-name" title="${name}">${name}</div>
        <div class="dl-meta">
          <span class="dl-state" style="color:${stateColor(item)}">${stateLabel(item)}</span>
          ${item.totalBytes ? `<span class="dl-size">${fmt(item.receivedBytes)} / ${fmt(item.totalBytes)}</span>` : ''}
          ${!done && item.state === 'progressing' ? `<span class="dl-speed">${speed(item)}</span><span class="dl-eta">${eta(item)}</span>` : ''}
        </div>
        ${!done ? `<div class="dl-bar"><div class="dl-bar-fill" style="width:${p}%"></div></div>` : ''}
      </div>
      <div class="dl-actions">
        ${item.state === 'completed' ? `
          <button class="dl-action-btn" data-action="open" title="Open file">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7V2.5A1.5 1.5 0 012.5 1H6l2 2h3.5A1.5 1.5 0 0113 4.5V7" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M1 7h12v5.5A1.5 1.5 0 0111.5 14h-9A1.5 1.5 0 011 12.5V7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
          </button>
          <button class="dl-action-btn" data-action="reveal" title="Show in folder">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11 9l2-2-2-2M3 7h10M7 3L5 1H1.5A1.5 1.5 0 000 2.5v9A1.5 1.5 0 001.5 13H12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        ` : ''}
        ${item.state === 'progressing' ? `
          <button class="dl-action-btn danger" data-action="cancel" title="Cancel">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
        ` : ''}
        <button class="dl-action-btn" data-action="remove" title="Remove from list">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M4 4V2.5A1.5 1.5 0 015.5 1h3A1.5 1.5 0 0110 2.5V4m1 0l-.8 8H3.8L3 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    `;

    // Actions
    el.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'open')   window.discowlAPI.downloads.openFile(item.savePath);
        if (action === 'reveal') window.discowlAPI.downloads.revealFile(item.savePath);
        if (action === 'cancel') window.discowlAPI.downloads.cancel(item.id);
        if (action === 'remove') { downloads.delete(item.id); renderPanel(); renderFullPage(); updateBadge(); }
      });
    });

    return el;
  }

  /* ── Panel dropdown ──────────────────────────────────────────── */
  function renderPanel() {
    const panel = document.getElementById('downloads-panel');
    if (!panel) return;

    const list  = panel.querySelector('.dl-list');
    const empty = panel.querySelector('.dl-empty');
    if (!list) return;

    list.innerHTML = '';
    const items = [...downloads.values()].reverse().slice(0, 8);

    if (items.length === 0) {
      empty?.classList.remove('hidden');
    } else {
      empty?.classList.add('hidden');
      items.forEach(item => list.appendChild(renderItem(item, true)));
    }
  }

  function openPanel() {
    const panel = document.getElementById('downloads-panel');
    if (!panel) return;
    panelOpen = true;
    panel.classList.remove('hidden');
    renderPanel();
    document.getElementById('downloads-btn')?.setAttribute('aria-expanded', 'true');

    // Fermer si clic en dehors
    setTimeout(() => {
      document.addEventListener('click', _onOutside, { once: true });
    }, 0);
  }

  function closePanel() {
    const panel = document.getElementById('downloads-panel');
    if (!panel) return;
    panelOpen = false;
    panel.classList.add('hidden');
    document.getElementById('downloads-btn')?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', _onOutside);
  }

  function togglePanel() {
    panelOpen ? closePanel() : openPanel();
  }

  function _onOutside(e) {
    const panel = document.getElementById('downloads-panel');
    const btn   = document.getElementById('downloads-btn');
    if (panel && !panel.contains(e.target) && !btn?.contains(e.target)) {
      closePanel();
    }
  }

  /* ── Page complète about:downloads ──────────────────────────── */
  function renderFullPage() {
    const page = document.getElementById('downloads-page');
    if (!page) return;

    const list  = page.querySelector('.dl-full-list');
    const empty = page.querySelector('.dl-full-empty');
    if (!list) return;

    list.innerHTML = '';
    const items = [...downloads.values()].reverse();

    if (items.length === 0) {
      empty?.classList.remove('hidden');
    } else {
      empty?.classList.add('hidden');
      items.forEach(item => list.appendChild(renderItem(item, false)));
    }
  }

  function openFullPage() {
    closePanel();
    // Créer un vrai onglet about:downloads (ou le réactiver s'il existe déjà)
    if (window._downloadsTabId != null) {
      const existing = window.DiscowlBrowser?.getTabById?.(window._downloadsTabId);
      if (existing) {
        window.DiscowlBrowser?.switchToTab?.(window._downloadsTabId);
        return;
      }
    }
    const id = window.DiscowlBrowser?.openDownloadsTab?.();
    if (id != null) window._downloadsTabId = id;
  }

  function closeFullPage() {
    // Ferme l'onglet downloads s'il est ouvert
    if (window._downloadsTabId != null) {
      window.DiscowlBrowser?.closeTab?.(window._downloadsTabId);
      window._downloadsTabId = null;
    }
    document.getElementById('downloads-page')?.classList.add('hidden');
  }

  /* ── Update in-place (sans recréer le DOM) ───────────────────── */
  let _rafPending = false;
  function scheduleRender() {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => {
      _rafPending = false;
      updateBadge();
      if (panelOpen) _patchPanel();
      _patchFullPage();
    });
  }

  // Met à jour uniquement les parties dynamiques d'un item existant dans le DOM
  function _patchItem(el, item) {
    const p    = pct(item);
    const done = item.state !== 'progressing';

    const stateEl = el.querySelector('.dl-state');
    const sizeEl  = el.querySelector('.dl-size');
    const speedEl = el.querySelector('.dl-speed');
    const etaEl   = el.querySelector('.dl-eta');
    const barFill = el.querySelector('.dl-bar-fill');
    const bar     = el.querySelector('.dl-bar');

    if (stateEl) { stateEl.textContent = stateLabel(item); stateEl.style.color = stateColor(item); }
    if (sizeEl  && item.totalBytes) sizeEl.textContent = fmt(item.receivedBytes) + ' / ' + fmt(item.totalBytes);
    if (speedEl) speedEl.textContent = done ? '' : speed(item);
    if (etaEl)   etaEl.textContent   = done ? '' : eta(item);
    if (barFill) barFill.style.width = p + '%';
    if (bar && done) bar.style.display = 'none';

    // Si l'item vient de terminer, recréer les boutons d'action
    if (done && el.querySelector('[data-action="cancel"]')) {
      const actionsEl = el.querySelector('.dl-actions');
      if (actionsEl) {
        const fresh = renderItem(item, el.classList.contains('dl-compact'));
        actionsEl.replaceWith(fresh.querySelector('.dl-actions'));
      }
      // Icône → checkmark
      const iconEl = el.querySelector('.dl-icon');
      if (iconEl) {
        iconEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2v9M5 8l4 4 4-4M2 15h14" stroke="${stateColor(item)}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      }
    }
  }

  function _patchPanel() {
    const panel = document.getElementById('downloads-panel');
    if (!panel) return;
    const list  = panel.querySelector('.dl-list');
    const empty = panel.querySelector('.dl-empty');
    if (!list) return;

    const items = [...downloads.values()].reverse().slice(0, 8);
    if (items.length === 0) { empty?.classList.remove('hidden'); list.innerHTML = ''; return; }
    empty?.classList.add('hidden');

    // Ajouter les nouveaux items, mettre à jour les existants
    items.forEach(item => {
      const existing = list.querySelector(`[data-dl-id="${item.id}"]`);
      if (existing) { _patchItem(existing, item); }
      else { list.prepend(renderItem(item, true)); }
    });
    // Retirer les items qui ne sont plus dans la liste (au-delà de 8)
    const ids = new Set(items.map(i => i.id));
    list.querySelectorAll('[data-dl-id]').forEach(el => {
      if (!ids.has(el.dataset.dlId)) el.remove();
    });
  }

  function _patchFullPage() {
    const page = document.getElementById('downloads-page');
    if (!page || page.classList.contains('hidden')) return;
    const list  = page.querySelector('.dl-full-list');
    const empty = page.querySelector('.dl-full-empty');
    if (!list) return;

    const items = [...downloads.values()].reverse();
    if (items.length === 0) { empty?.classList.remove('hidden'); list.innerHTML = ''; return; }
    empty?.classList.add('hidden');

    items.forEach(item => {
      const existing = list.querySelector(`[data-dl-id="${item.id}"]`);
      if (existing) { _patchItem(existing, item); }
      else { list.prepend(renderItem(item, false)); }
    });
  }

  /* ── IPC listeners ───────────────────────────────────────────── */
  function init() {
    window.discowlAPI.downloads.onStarted((item) => {
      item._lastBytes = 0;
      item._lastTime  = Date.now();
      downloads.set(item.id, item);
      // Recréer le panel proprement pour le nouvel item
      renderPanel();
      renderFullPage();
      updateBadge();
      if (!panelOpen) openPanel();
    });

    window.discowlAPI.downloads.onUpdated((update) => {
      const item = downloads.get(update.id);
      if (!item) return;
      item._lastBytes = item.receivedBytes;
      item._lastTime  = Date.now();
      Object.assign(item, update);
      scheduleRender(); // throttlé via requestAnimationFrame
    });

    // Bouton dans la toolbar
    document.getElementById('downloads-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanel();
    });

    // Bouton "See all" dans le panel
    document.getElementById('downloads-see-all')?.addEventListener('click', () => {
      openFullPage();
    });

    // Bouton "Clear all" dans le panel
    document.getElementById('downloads-clear-all')?.addEventListener('click', () => {
      [...downloads.values()].filter(d => d.state !== 'progressing').forEach(d => downloads.delete(d.id));
      renderPanel();
      renderFullPage();
      updateBadge();
    });

    // Fermer la page complète
    document.getElementById('downloads-page-close')?.addEventListener('click', closeFullPage);

    // Ctrl+J
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault();
        openFullPage();
      }
    });
  }

  return { init, openFullPage, closeFullPage, openPanel, closePanel };

})();