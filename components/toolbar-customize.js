'use strict';

/* ─── components/toolbar-customize.js ───────────────────────────
   Page de personnalisation de la toolbar (about:customize-toolbar)
   Drag & drop entre "Active" et "Disponible"
   Sauvegarde dans settings.toolbarItems
──────────────────────────────────────────────────────────────── */

const ToolbarCustomizer = (() => {

  /* ── Définitions des boutons personnalisables ────────────── */
  const BUTTON_DEFS = [
    {
      id: 'back',
      label: 'Back',
      title: 'Go back (Alt+←)',
      svg: `<svg width="20" height="20" viewBox="0 0 18 18" fill="none"><path d="M14 9H5M5 9L9 5M5 9l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    {
      id: 'forward',
      label: 'Forward',
      title: 'Go forward (Alt+→)',
      svg: `<svg width="20" height="20" viewBox="0 0 18 18" fill="none"><path d="M4 9h9M13 9l-4-4M13 9l-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    {
      id: 'reload',
      label: 'Reload',
      title: 'Reload page (F5)',
      svg: `<svg width="20" height="20" viewBox="0 0 18 18" fill="none"><path d="M13.5 4.5A6 6 0 1014.8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M11 2l3 2.5-2.5 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    {
      id: 'home',
      label: 'Home',
      title: 'Go to homepage',
      svg: `<svg width="20" height="20" viewBox="0 0 18 18" fill="none"><path d="M2.5 8.5L9 3l6.5 5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 8v6.5h9V8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 14.5v-4h4v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    {
      id: 'bookmarks',
      label: 'Bookmarks',
      title: 'Toggle bookmarks sidebar (Ctrl+B)',
      svg: `<svg width="20" height="20" viewBox="0 0 18 18" fill="none"><path d="M3 4h12M3 9h12M3 14h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
    },
    {
      id: 'history',
      label: 'History',
      title: 'Toggle history sidebar (Ctrl+H)',
      svg: `<svg width="20" height="20" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M9 5v4l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    {
      id: 'downloads',
      label: 'Downloads',
      title: 'Downloads (Ctrl+J)',
      svg: `<svg width="20" height="20" viewBox="0 0 18 18" fill="none"><path d="M9 2v9M5 8l4 4 4-4M2 15h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
  ];

  /* ── État ────────────────────────────────────────────────── */
  let _config = [];  // [{id, visible}] — copie de travail

  /* ── Helpers ─────────────────────────────────────────────── */
  function getDef(id) { return BUTTON_DEFS.find(d => d.id === id); }

  function getConfig() {
    // Merge default defs + saved config : garder l'ordre sauvegardé,
    // ajouter les nouveaux boutons qui ne seraient pas encore dans la config
    const saved = (_config || []).filter(i => getDef(i.id));
    const savedIds = saved.map(i => i.id);
    const extras = BUTTON_DEFS.filter(d => !savedIds.includes(d.id))
      .map(d => ({ id: d.id, visible: true }));
    return [...saved, ...extras];
  }

  /* ── Render ──────────────────────────────────────────────── */
  function renderPage() {
    const page = document.getElementById('customize-toolbar-page');
    if (!page) return;

    const cfg = getConfig();
    const active    = cfg.filter(i => i.visible);
    const inactive  = cfg.filter(i => !i.visible);

    // Active zone
    const activeZone = page.querySelector('#ct-active-zone');
    const inactiveZone = page.querySelector('#ct-inactive-zone');
    if (!activeZone || !inactiveZone) return;

    activeZone.innerHTML = '';
    inactiveZone.innerHTML = '';

    active.forEach(item => activeZone.appendChild(makeCard(item, true)));
    inactive.forEach(item => inactiveZone.appendChild(makeCard(item, false)));

    // Placeholder si vide
    if (!active.length) {
      activeZone.innerHTML = `<div class="ct-drop-hint">Drop buttons here</div>`;
    }
    if (!inactive.length) {
      inactiveZone.innerHTML = `<div class="ct-drop-hint">All buttons are active</div>`;
    }

    setupDropZones();
  }

  function makeCard(item, isActive) {
    const def = getDef(item.id);
    if (!def) return document.createDocumentFragment();

    const card = document.createElement('div');
    card.className = 'ct-card' + (isActive ? ' ct-card-active' : ' ct-card-inactive');
    card.draggable = true;
    card.dataset.id = item.id;

    card.innerHTML = `
      <div class="ct-card-grip">
        <svg width="12" height="18" viewBox="0 0 12 18" fill="none">
          <circle cx="4" cy="4"  r="1.5" fill="currentColor"/>
          <circle cx="4" cy="9"  r="1.5" fill="currentColor"/>
          <circle cx="4" cy="14" r="1.5" fill="currentColor"/>
          <circle cx="8" cy="4"  r="1.5" fill="currentColor"/>
          <circle cx="8" cy="9"  r="1.5" fill="currentColor"/>
          <circle cx="8" cy="14" r="1.5" fill="currentColor"/>
        </svg>
      </div>
      <div class="ct-card-icon">${def.svg}</div>
      <div class="ct-card-info">
        <div class="ct-card-label">${def.label}</div>
        <div class="ct-card-desc">${def.title}</div>
      </div>
      <button class="ct-card-toggle" title="${isActive ? 'Remove from toolbar' : 'Add to toolbar'}">
        ${isActive
          ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
          : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
        }
      </button>
    `;

    // Toggle visible
    card.querySelector('.ct-card-toggle').addEventListener('click', () => {
      toggleItem(item.id);
    });

    // Drag
    setupCardDrag(card, item.id);

    return card;
  }

  function toggleItem(id) {
    const cfg = getConfig();
    const idx = cfg.findIndex(i => i.id === id);
    if (idx >= 0) cfg[idx] = { ...cfg[idx], visible: !cfg[idx].visible };
    _config = cfg;
    renderPage();
  }

  /* ── Drag & Drop ─────────────────────────────────────────── */
  let _dragId = null;
  let _indicator = null;

  function setupCardDrag(card, id) {
    card.addEventListener('dragstart', (e) => {
      _dragId = id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.style.opacity = '.4', 0);
    });
    card.addEventListener('dragend', () => {
      card.style.opacity = '';
      _dragId = null;
      removeIndicator();
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!_dragId || _dragId === id) return;
      const rect   = card.getBoundingClientRect();
      const isBefore = e.clientX < rect.left + rect.width / 2;
      showIndicator(card, isBefore);
      card.dataset.dropPos = isBefore ? 'before' : 'after';
    });
    card.addEventListener('dragleave', () => {
      removeIndicator();
      delete card.dataset.dropPos;
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const pos = card.dataset.dropPos || 'after';
      delete card.dataset.dropPos;
      removeIndicator();
      if (_dragId && _dragId !== id) moveItem(_dragId, id, pos, card.closest('.ct-zone')?.dataset.zone);
    });
  }

  function setupDropZones() {
    document.querySelectorAll('.ct-zone').forEach(zone => {
      zone.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!_dragId) return;
        const zoneType = zone.dataset.zone; // 'active' | 'inactive'
        // Drop on empty zone
        const cfg = getConfig();
        const idx = cfg.findIndex(i => i.id === _dragId);
        if (idx >= 0) {
          cfg[idx].visible = (zoneType === 'active');
          _config = cfg;
          renderPage();
        }
      });
    });
  }

  function showIndicator(card, isBefore) {
    removeIndicator();
    _indicator = document.createElement('div');
    _indicator.className = 'ct-drop-indicator';
    if (isBefore) card.parentNode?.insertBefore(_indicator, card);
    else card.parentNode?.insertBefore(_indicator, card.nextSibling);
  }

  function removeIndicator() {
    _indicator?.remove();
    _indicator = null;
  }

  function moveItem(fromId, toId, pos, toZone) {
    let cfg = getConfig();
    const fromIdx = cfg.findIndex(i => i.id === fromId);
    const toIdx   = cfg.findIndex(i => i.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;

    const [item] = cfg.splice(fromIdx, 1);
    // Mettre à jour la visibilité selon la zone de destination
    item.visible = (toZone === 'active') ?? item.visible;

    const newToIdx = cfg.findIndex(i => i.id === toId);
    const insertAt = pos === 'before' ? newToIdx : newToIdx + 1;
    cfg.splice(insertAt, 0, item);

    _config = cfg;
    renderPage();
  }

  /* ── Sauvegarde et application ───────────────────────────── */
  async function save() {
    const cfg = getConfig();
    await window.discowlAPI.settings.save({ toolbarItems: cfg });
    // Appliquer immédiatement sans rechargement
    window.DiscowlBrowser?.applyToolbarConfig?.(cfg);
    showToast('Toolbar saved ✓', 'success');
  }

  function reset() {
    _config = [
      { id: 'back',      visible: true },
      { id: 'forward',   visible: true },
      { id: 'reload',    visible: true },
      { id: 'home',      visible: true },
      { id: 'bookmarks', visible: true },
      { id: 'history',   visible: true },
      { id: 'downloads', visible: true },
    ];
    renderPage();
  }

  /* ── Init ────────────────────────────────────────────────── */
  async function show() {
    const page = document.getElementById('customize-toolbar-page');
    if (!page) return;
    page.classList.remove('hidden');

    // Charger config actuelle
    const s = await window.discowlAPI.settings.get();
    _config = s.toolbarItems || [];
    renderPage();
  }

  function hide() {
    document.getElementById('customize-toolbar-page')?.classList.add('hidden');
  }

  function init() {
    document.getElementById('ct-save-btn')?.addEventListener('click', save);
    document.getElementById('ct-reset-btn')?.addEventListener('click', reset);
    document.getElementById('ct-close-btn')?.addEventListener('click', () => {
      window.DiscowlBrowser?.closeCustomizeTab?.();
    });
  }

  window.addEventListener('DOMContentLoaded', init);
  return { show, hide, BUTTON_DEFS };
})();

window.ToolbarCustomizer = ToolbarCustomizer;