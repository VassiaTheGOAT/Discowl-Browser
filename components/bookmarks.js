/* ─── components/bookmarks.js ───────────────────────────────────
   Système de favoris production — v2
   ─ Modèle plat avec index (lookup O(1))
   ─ Tags multi + vues intelligentes (Récents, Fréquents, Non visités)
   ─ Recherche scorée (titre + url + tags + fréquence + récence)
   ─ 3 modes de vue : liste / compacte / grille
   ─ Drag & drop avec position float (aucune renumérotation)
   ─ Undo/redo sur 50 opérations
   ─ Sélection multiple (Shift+clic)
   ─ Navigation clavier complète
   ─ Star popup moderne (ancré sous le bouton)
   ─ Modales inline sans prompt()
   ─ Tout traduit via i18n
────────────────────────────────────────────────────────────────── */

'use strict';

const BookmarksManager = (() => {

  /* ════════════════════════════════════════════════════════════
     MODÈLE DE DONNÉES
     Stockage plat : _items = { id: item }
     Ordre par parent : _order = { parentId: [id, id, ...] }
     Index tags : _tags = { tagName: Set<id> }
  ════════════════════════════════════════════════════════════ */

  let _items   = {};   // { id → item }
  let _order   = {};   // { parentId → [id, id, ...] }
  let _tags    = {};   // { tagName → Set<id> }
  let _history = [];   // undo stack [ {type,data} ]
  let _future  = [];   // redo stack
  const MAX_HISTORY = 50;

  // UI state
  let _view       = 'list';   // 'list' | 'compact' | 'grid'
  let _query      = '';
  let _activeTag  = null;
  let _activeView = 'all';    // 'all' | 'recent' | 'frequent' | 'unvisited' | tag
  let _selected   = new Set();
  let _dragId     = null;
  let _lastClickId= null;     // for shift-select

  /* ════════════════════════════════════════════════════════════
     HELPERS — ID & POSITION
  ════════════════════════════════════════════════════════════ */

  function uid() {
    return 'bm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  // Float position — insert between two items without renumbering
  function midPos(a, b) {
    if (a === undefined && b === undefined) return 1.0;
    if (a === undefined) return b - 1.0;
    if (b === undefined) return a + 1.0;
    return (a + b) / 2;
  }

  function getOrderedChildren(parentId) {
    const ids = _order[parentId || 'root'] || [];
    return ids
      .filter(id => _items[id])
      .sort((a, b) => (_items[a].position || 0) - (_items[b].position || 0));
  }

  function faviconSrc(url) {
    try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; }
    catch { return ''; }
  }

  /* ════════════════════════════════════════════════════════════
     INDEX — rebuild depuis la structure plate
  ════════════════════════════════════════════════════════════ */

  function rebuildTagIndex() {
    _tags = {};
    for (const item of Object.values(_items)) {
      if (!item.tags) continue;
      for (const tag of item.tags) {
        if (!_tags[tag]) _tags[tag] = new Set();
        _tags[tag].add(item.id);
      }
    }
  }

  function getAllTags() {
    return Object.keys(_tags).sort();
  }

  /* ════════════════════════════════════════════════════════════
     CONVERSION — ancien format arbre → nouveau format plat
  ════════════════════════════════════════════════════════════ */

  function importTree(nodes, parentId, posStart) {
    let pos = posStart || 1.0;
    for (const node of (nodes || [])) {
      const item = {
        id:         node.id || uid(),
        type:       node.type || 'bookmark',
        title:      node.title || '',
        url:        node.url || '',
        favicon:    node.favicon || '',
        parentId:   parentId || 'root',
        position:   pos,
        tags:       node.tags || [],
        createdAt:  node.createdAt || Date.now(),
        visitedAt:  node.visitedAt || 0,
        visitCount: node.visitCount || 0,
        pinned:     node.pinned || false,
        toolbar:    !!node.toolbar,
      };
      _items[item.id] = item;
      if (!_order[item.parentId]) _order[item.parentId] = [];
      _order[item.parentId].push(item.id);
      if (node.type === 'folder' && node.children?.length) {
        importTree(node.children, item.id, 1.0);
      }
      pos += 1.0;
    }
  }

  /* ════════════════════════════════════════════════════════════
     EXPORT — retour vers format arbre (pour compatibilité IPC)
  ════════════════════════════════════════════════════════════ */

  function exportTree(parentId) {
    const ids = getOrderedChildren(parentId || 'root');
    return ids.map(id => {
      const item = _items[id];
      if (!item) return null;
      const out = { ...item };
      if (item.type === 'folder') {
        out.children = exportTree(item.id);
      } else {
        out.children = [];
      }
      return out;
    }).filter(Boolean);
  }

  /* ════════════════════════════════════════════════════════════
     PERSISTANCE
  ════════════════════════════════════════════════════════════ */

  async function load() {
    const raw = await window.discowlAPI.favorites.get();
    _items = {};
    _order = {};
    importTree(raw, 'root', 1.0);
    rebuildTagIndex();
    render();
    renderToolbar();
  }

  async function persist() {
    const tree = exportTree('root');
    await window.discowlAPI.favorites.save(tree);
  }

  /* ════════════════════════════════════════════════════════════
     UNDO / REDO
  ════════════════════════════════════════════════════════════ */

  function snapshot() {
    return {
      items:  JSON.parse(JSON.stringify(_items)),
      order:  JSON.parse(JSON.stringify(_order)),
    };
  }

  function pushHistory(snap) {
    _history.push(snap);
    if (_history.length > MAX_HISTORY) _history.shift();
    _future = [];
  }

  function undo() {
    if (!_history.length) return;
    _future.push(snapshot());
    const prev = _history.pop();
    _items = prev.items;
    _order = prev.order;
    rebuildTagIndex();
    persist();
    render();
    renderToolbar();
    showToast('Undo ↩', 'info');
  }

  function redo() {
    if (!_future.length) return;
    _history.push(snapshot());
    const next = _future.pop();
    _items = next.items;
    _order = next.order;
    rebuildTagIndex();
    persist();
    render();
    renderToolbar();
    showToast('Redo ↪', 'info');
  }

  /* ════════════════════════════════════════════════════════════
     CRUD
  ════════════════════════════════════════════════════════════ */

  function addItem(data) {
    pushHistory(snapshot());
    const parentId = data.parentId || 'root';
    const siblings = getOrderedChildren(parentId);
    const lastPos  = siblings.length
      ? (_items[siblings[siblings.length - 1]]?.position || 0) + 1.0
      : 1.0;

    const item = {
      id:         uid(),
      type:       data.type || 'bookmark',
      title:      data.title || data.url || '',
      url:        data.url || '',
      favicon:    '',
      parentId,
      position:   lastPos,
      tags:       data.tags || [],
      createdAt:  Date.now(),
      visitedAt:  0,
      visitCount: 0,
      pinned:     false,
      toolbar:    !!data.toolbar,
    };
    _items[item.id] = item;
    if (!_order[parentId]) _order[parentId] = [];
    _order[parentId].push(item.id);

    for (const tag of item.tags) {
      if (!_tags[tag]) _tags[tag] = new Set();
      _tags[tag].add(item.id);
    }

    persist();
    render();
    renderToolbar();
    return item;
  }

  function updateItem(id, updates) {
    if (!_items[id]) return;
    pushHistory(snapshot());

    // Update tag index if tags changed
    if (updates.tags) {
      for (const tag of (_items[id].tags || [])) {
        _tags[tag]?.delete(id);
        if (_tags[tag]?.size === 0) delete _tags[tag];
      }
      for (const tag of updates.tags) {
        if (!_tags[tag]) _tags[tag] = new Set();
        _tags[tag].add(id);
      }
    }

    _items[id] = { ..._items[id], ...updates };
    persist();
    render();
    renderToolbar();
  }

  function deleteItem(id) {
    if (!_items[id]) return;
    pushHistory(snapshot());

    // Collect all descendant ids (for folders)
    const toDelete = [id];
    function collectChildren(pid) {
      for (const cid of (_order[pid] || [])) {
        toDelete.push(cid);
        collectChildren(cid);
      }
    }
    collectChildren(id);

    for (const did of toDelete) {
      const item = _items[did];
      if (!item) continue;
      // Remove from tag index
      for (const tag of (item.tags || [])) {
        _tags[tag]?.delete(did);
        if (_tags[tag]?.size === 0) delete _tags[tag];
      }
      // Remove from order
      const parentId = item.parentId || 'root';
      _order[parentId] = (_order[parentId] || []).filter(x => x !== did);
      // Remove the item itself
      delete _items[did];
      delete _order[did];
    }

    _selected.delete(id);
    persist();
    render();
    renderToolbar();
    showToast(i18n.t('toast.deleted'), 'info');
  }

  function deleteSelected() {
    if (!_selected.size) return;
    pushHistory(snapshot());
    const ids = [..._selected];
    for (const id of ids) {
      if (!_items[id]) continue;
      const parentId = _items[id].parentId || 'root';
      _order[parentId] = (_order[parentId] || []).filter(x => x !== id);
      for (const tag of (_items[id].tags || [])) {
        _tags[tag]?.delete(id);
        if (_tags[tag]?.size === 0) delete _tags[tag];
      }
      delete _items[id];
    }
    _selected.clear();
    persist();
    render();
    renderToolbar();
    showToast(`${ids.length} ${i18n.t('bm.deleted_count')}`, 'info');
  }

  function moveItem(id, newParentId, beforeId) {
    if (!_items[id]) return;
    pushHistory(snapshot());

    const item      = _items[id];
    const oldParent = item.parentId || 'root';
    const newParent = newParentId || 'root';

    // Remove from old parent
    _order[oldParent] = (_order[oldParent] || []).filter(x => x !== id);

    // Insert into new parent
    if (!_order[newParent]) _order[newParent] = [];

    if (beforeId && _items[beforeId]) {
      // Position between beforeId and its predecessor
      const siblings = getOrderedChildren(newParent);
      const beforeIdx = siblings.indexOf(beforeId);
      const prevId    = beforeIdx > 0 ? siblings[beforeIdx - 1] : null;
      const posA      = prevId ? _items[prevId].position : undefined;
      const posB      = _items[beforeId].position;
      _items[id].position = midPos(posA, posB);
      _order[newParent].push(id);
    } else {
      // Append at end
      const siblings = getOrderedChildren(newParent);
      const lastPos  = siblings.length
        ? (_items[siblings[siblings.length - 1]]?.position || 0) + 1.0
        : 1.0;
      _items[id].position = lastPos;
      _order[newParent].push(id);
    }

    _items[id].parentId = newParent;
    persist();
    render();
    renderToolbar();
  }

  function recordVisit(url) {
    const item = Object.values(_items).find(i => i.url === url && i.type === 'bookmark');
    if (!item) return;
    item.visitedAt  = Date.now();
    item.visitCount = (item.visitCount || 0) + 1;
    persist();
  }

  /* ════════════════════════════════════════════════════════════
     RECHERCHE SCORÉE
  ════════════════════════════════════════════════════════════ */

  function scoreItem(item, q) {
    if (!q) return 1;
    const lq    = q.toLowerCase();
    const title = (item.title || '').toLowerCase();
    const url   = (item.url   || '').toLowerCase();
    const tags  = (item.tags  || []).map(t => t.toLowerCase());

    let score = 0;
    if (title.startsWith(lq))  score += 1.0;
    else if (title.includes(lq)) score += 0.7;
    if (url.includes(lq))      score += 0.4;
    if (tags.some(t => t === lq))     score += 0.8;
    else if (tags.some(t => t.includes(lq))) score += 0.5;

    // Bonus fréquence (cap 0.5)
    score += Math.min((item.visitCount || 0) * 0.02, 0.5);
    // Bonus récence (<7 jours)
    const age = Date.now() - (item.visitedAt || item.createdAt || 0);
    if (age < 7 * 86400000) score += 0.3;

    return score;
  }

  function searchItems(q) {
    const all = Object.values(_items).filter(i => i.type === 'bookmark');
    const lq  = q.toLowerCase();
    return all
      .map(item => ({ item, score: scoreItem(item, lq) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  }

  /* ════════════════════════════════════════════════════════════
     VUES INTELLIGENTES
  ════════════════════════════════════════════════════════════ */

  function getSmartView(name) {
    const all = Object.values(_items).filter(i => i.type === 'bookmark');
    switch (name) {
      case 'recent':
        return all
          .filter(i => Date.now() - (i.createdAt || 0) < 30 * 86400000)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          .slice(0, 50);
      case 'frequent':
        return all
          .filter(i => (i.visitCount || 0) > 2)
          .sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0))
          .slice(0, 50);
      case 'unvisited':
        return all
          .filter(i => !(i.visitCount) && Date.now() - (i.createdAt || 0) > 7 * 86400000)
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      default:
        return [];
    }
  }

  function getTagView(tag) {
    const ids = _tags[tag];
    if (!ids) return [];
    return [...ids].map(id => _items[id]).filter(Boolean)
      .sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));
  }

  /* ════════════════════════════════════════════════════════════
     RENDU PRINCIPAL
  ════════════════════════════════════════════════════════════ */

  function render() {
    const container = document.getElementById('bookmarks-tree');
    if (!container) return;

    container.innerHTML = '';
    container.className = `bm-tree bm-view-${_view}`;

    // Update smart view counts
    updateSmartViewCounts();
    updateTagsList();
    updateViewToggle();

    // Recherche active
    if (_query.trim()) {
      renderSearchResults(container);
      return;
    }

    // Vue intelligente active
    if (_activeView !== 'all') {
      renderSmartView(container);
      return;
    }

    // Vue arborescente normale
    renderTree(container, 'root', 0);

    if (container.children.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bm-empty';
      empty.textContent = i18n.t('bm.no_bookmarks');
      container.appendChild(empty);
    }
  }

  function renderSearchResults(container) {
    const results = searchItems(_query);
    if (!results.length) {
      const el = document.createElement('div');
      el.className = 'bm-empty';
      el.textContent = i18n.t('bm.no_results');
      container.appendChild(el);
      return;
    }

    const header = document.createElement('div');
    header.className = 'bm-section-header';
    header.textContent = `${results.length} result${results.length > 1 ? 's' : ''}`;
    container.appendChild(header);

    for (const item of results) {
      container.appendChild(createBookmarkEl(item, 0, { showPath: true }));
    }
  }

  function renderSmartView(container) {
    let items = [];
    let title = '';

    if (_activeView === 'recent')   { items = getSmartView('recent');   title = i18n.t('bm.view_recent'); }
    if (_activeView === 'frequent') { items = getSmartView('frequent'); title = i18n.t('bm.view_frequent'); }
    if (_activeView === 'unvisited'){ items = getSmartView('unvisited');title = i18n.t('bm.view_unvisited'); }
    if (_activeView.startsWith('tag:')) {
      const tag = _activeView.slice(4);
      items = getTagView(tag);
      title = `# ${tag}`;
    }

    if (items.length === 0) {
      const el = document.createElement('div');
      el.className = 'bm-empty';
      el.textContent = i18n.t('bm.no_bookmarks');
      container.appendChild(el);
      return;
    }

    if (title) {
      const hdr = document.createElement('div');
      hdr.className = 'bm-section-header';
      hdr.textContent = title;
      // Delete all in unvisited view
      if (_activeView === 'unvisited') {
        const delBtn = document.createElement('button');
        delBtn.className = 'bm-section-action';
        delBtn.textContent = i18n.t('bm.delete_all');
        delBtn.addEventListener('click', () => {
          if (confirm(i18n.t('bm.delete_unvisited_confirm'))) {
            for (const item of items) deleteItem(item.id);
          }
        });
        hdr.appendChild(delBtn);
      }
      container.appendChild(hdr);
    }

    for (const item of items) {
      container.appendChild(createBookmarkEl(item, 0, { showPath: true }));
    }
  }

  function renderTree(container, parentId, depth) {
    const ids = getOrderedChildren(parentId || 'root');
    for (const id of ids) {
      const item = _items[id];
      if (!item) continue;
      if (item.type === 'folder') {
        container.appendChild(createFolderEl(item, depth));
      } else {
        container.appendChild(createBookmarkEl(item, depth, {}));
      }
    }
  }

  /* ════════════════════════════════════════════════════════════
     ÉLÉMENTS DOM — BOOKMARK
  ════════════════════════════════════════════════════════════ */

  function createBookmarkEl(item, depth, opts = {}) {
    const el = document.createElement('div');
    el.className = `bm-item bm-bookmark${_selected.has(item.id) ? ' selected' : ''}`;
    el.dataset.id = item.id;
    el.dataset.type = 'bookmark';
    el.draggable = true;

    if (_view !== 'grid') {
      el.style.paddingLeft = `${10 + depth * 14}px`;
    }

    // Favicon
    const fav = document.createElement('img');
    fav.className = 'bm-favicon';
    fav.src = faviconSrc(item.url);
    fav.loading = 'lazy';
    fav.onerror = () => {
      fav.replaceWith(defaultFavicon());
    };

    // Contenu
    const content = document.createElement('div');
    content.className = 'bm-content';

    const titleEl = document.createElement('span');
    titleEl.className = 'bm-title';
    titleEl.textContent = item.title || item.url;

    content.appendChild(titleEl);

    if (_view === 'list' || opts.showPath) {
      const meta = document.createElement('span');
      meta.className = 'bm-meta';
      if (opts.showPath) {
        const path = getItemPath(item.id);
        meta.textContent = path || tryHostname(item.url);
      } else {
        meta.textContent = tryHostname(item.url);
      }
      content.appendChild(meta);
    }

    // Tags (en vue liste seulement)
    if (_view === 'list' && item.tags?.length) {
      const tagsEl = document.createElement('div');
      tagsEl.className = 'bm-tags-row';
      for (const tag of item.tags.slice(0, 4)) {
        const t = document.createElement('span');
        t.className = 'bm-tag-pill';
        t.textContent = tag;
        t.addEventListener('click', (e) => {
          e.stopPropagation();
          setActiveView('tag:' + tag);
        });
        tagsEl.appendChild(t);
      }
      content.appendChild(tagsEl);
    }

    // Actions
    const actions = document.createElement('div');
    actions.className = 'bm-actions';
    actions.appendChild(actionBtn('✏', i18n.t('bm.rename_btn'), () => openEditPopup(item)));
    actions.appendChild(actionBtn('🗑', i18n.t('bm.delete'), () => deleteItem(item.id), 'danger'));

    el.appendChild(fav);
    el.appendChild(content);
    el.appendChild(actions);

    // Barre personnelle indicator
    if (item.toolbar) {
      const dot = document.createElement('span');
      dot.className = 'bm-toolbar-dot';
      dot.title = i18n.t('bm.in_bar');
      el.appendChild(dot);
    }

    // Events
    el.addEventListener('click', (e) => handleItemClick(e, item.id));
    el.addEventListener('dblclick', () => {
      window.DiscowlBrowser?.navigate(item.url);
      recordVisit(item.url);
    });
    setupItemDrag(el, item.id);
    setupItemDrop(el, item.id);

    return el;
  }

  /* ════════════════════════════════════════════════════════════
     ÉLÉMENTS DOM — FOLDER
  ════════════════════════════════════════════════════════════ */

  function createFolderEl(item, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'bm-folder-wrap';
    wrap.dataset.id = item.id;

    const row = document.createElement('div');
    row.className = `bm-item bm-folder${_selected.has(item.id) ? ' selected' : ''}`;
    row.dataset.id = item.id;
    row.dataset.type = 'folder';
    row.draggable = true;
    row.style.paddingLeft = `${10 + depth * 14}px`;

    // Chevron + icone
    const toggle = document.createElement('span');
    toggle.className = 'bm-chevron';
    toggle.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const icon = document.createElement('span');
    icon.className = 'bm-folder-icon';
    icon.textContent = '📁';

    const titleEl = document.createElement('span');
    titleEl.className = 'bm-title';
    titleEl.textContent = item.title || i18n.t('bm.new_folder');

    const count = document.createElement('span');
    count.className = 'bm-folder-count';
    count.textContent = getOrderedChildren(item.id).length || '';

    const actions = document.createElement('div');
    actions.className = 'bm-actions';
    actions.appendChild(actionBtn('+', i18n.t('bm.add_here'), (e) => {
      e.stopPropagation();
      openAddPopup({ parentId: item.id });
    }));
    actions.appendChild(actionBtn('✏', i18n.t('bm.rename'), (e) => {
      e.stopPropagation();
      openFolderRenamePopup(item);
    }));
    actions.appendChild(actionBtn('🗑', i18n.t('bm.delete_folder'), (e) => {
      e.stopPropagation();
      deleteItem(item.id);
    }, 'danger'));

    row.appendChild(toggle);
    row.appendChild(icon);
    row.appendChild(titleEl);
    row.appendChild(count);
    row.appendChild(actions);

    // Enfants
    const childrenEl = document.createElement('div');
    childrenEl.className = 'bm-folder-children';

    let isOpen = item._open || false;

    function setOpen(open) {
      isOpen = open;
      item._open = open;
      childrenEl.classList.toggle('open', open);
      toggle.classList.toggle('open', open);
      icon.textContent = open ? '📂' : '📁';
      if (open && !childrenEl.children.length) {
        renderTree(childrenEl, item.id, depth + 1);
      }
    }

    row.addEventListener('click', (e) => {
      if (e.target.closest('.bm-actions')) return;
      setOpen(!isOpen);
    });

    if (isOpen) {
      setOpen(true);
    }

    setupItemDrag(row, item.id);
    setupItemDrop(row, item.id);
    setupFolderDrop(childrenEl, item.id);

    wrap.appendChild(row);
    wrap.appendChild(childrenEl);
    return wrap;
  }

  /* ════════════════════════════════════════════════════════════
     HELPERS DOM
  ════════════════════════════════════════════════════════════ */

  function defaultFavicon() {
    const s = document.createElement('span');
    s.className = 'bm-favicon-default';
    s.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="var(--text-muted)" stroke-width="1.2"/><path d="M5 5.5c0-1.1.9-2 2-2s2 .9 2 2c0 1.1-1 1.5-1 2.5M7 11v.5" stroke="var(--text-muted)" stroke-width="1.2" stroke-linecap="round"/></svg>`;
    return s;
  }

  function actionBtn(iconText, title, onClick, variant = '') {
    const btn = document.createElement('button');
    btn.className = `bm-action-btn${variant ? ' bm-action-' + variant : ''}`;
    btn.title = title;
    btn.textContent = iconText;
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
    return btn;
  }

  function tryHostname(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }

  function getItemPath(id) {
    const parts = [];
    let current = _items[id];
    while (current && current.parentId && current.parentId !== 'root') {
      const parent = _items[current.parentId];
      if (!parent) break;
      parts.unshift(parent.title);
      current = parent;
    }
    return parts.join(' › ');
  }

  /* ════════════════════════════════════════════════════════════
     SÉLECTION
  ════════════════════════════════════════════════════════════ */

  function handleItemClick(e, id) {
    if (e.target.closest('.bm-actions')) return;

    if (e.shiftKey && _lastClickId && _lastClickId !== id) {
      // Shift+clic : sélection en plage
      const allIds = Object.values(_items)
        .filter(i => i.type === 'bookmark')
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map(i => i.id);
      const from = allIds.indexOf(_lastClickId);
      const to   = allIds.indexOf(id);
      if (from !== -1 && to !== -1) {
        const start = Math.min(from, to);
        const end   = Math.max(from, to);
        for (let i = start; i <= end; i++) _selected.add(allIds[i]);
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+clic : toggle sélection
      if (_selected.has(id)) _selected.delete(id);
      else _selected.add(id);
      _lastClickId = id;
    } else {
      // Clic simple : naviguer
      const item = _items[id];
      if (item?.url) {
        window.DiscowlBrowser?.navigate(item.url);
        recordVisit(item.url);
        _selected.clear();
        _lastClickId = id;
        return;
      }
    }

    _lastClickId = id;
    updateSelectionUI();
  }

  function updateSelectionUI() {
    document.querySelectorAll('#bookmarks-tree .bm-item').forEach(el => {
      el.classList.toggle('selected', _selected.has(el.dataset.id));
    });
    const bar = document.getElementById('bm-selection-bar');
    if (bar) {
      bar.classList.toggle('visible', _selected.size > 0);
      const count = bar.querySelector('.bm-sel-count');
      if (count) count.textContent = `${_selected.size} selected`;
    }
  }

  /* ════════════════════════════════════════════════════════════
     DRAG & DROP
  ════════════════════════════════════════════════════════════ */

  function setupItemDrag(el, id) {
    el.addEventListener('dragstart', (e) => {
      _dragId = id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      requestAnimationFrame(() => el.classList.add('dragging'));
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.bm-drop-indicator').forEach(d => d.remove());
      _dragId = null;
    });
  }

  function setupItemDrop(el, id) {
    el.addEventListener('dragover', (e) => {
      if (!_dragId || _dragId === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = el.getBoundingClientRect();
      const half = rect.top + rect.height / 2;
      el.classList.toggle('drop-above', e.clientY < half);
      el.classList.toggle('drop-below', e.clientY >= half);
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drop-above', 'drop-below');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-above', 'drop-below');
      if (!_dragId || _dragId === id) return;
      const dragItem  = _items[_dragId];
      const dropItem  = _items[id];
      if (!dragItem || !dropItem) return;
      const rect = el.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;
      const parentId = dropItem.parentId || 'root';
      moveItem(_dragId, parentId, insertBefore ? id : null);
    });
  }

  function setupFolderDrop(childrenEl, folderId) {
    childrenEl.addEventListener('dragover', (e) => {
      if (!_dragId) return;
      e.preventDefault();
      childrenEl.classList.add('drag-over');
    });
    childrenEl.addEventListener('dragleave', () => {
      childrenEl.classList.remove('drag-over');
    });
    childrenEl.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      childrenEl.classList.remove('drag-over');
      if (!_dragId) return;
      moveItem(_dragId, folderId, null);
    });
  }

  /* ════════════════════════════════════════════════════════════
     NAVIGATION CLAVIER
  ════════════════════════════════════════════════════════════ */

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      const sidebar = document.getElementById('left-sidebar');
      if (!sidebar || sidebar.classList.contains('closed')) return;

      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
      if (e.key === 'Escape') { _selected.clear(); updateSelectionUI(); }
      if (e.key === 'Delete' && _selected.size) { deleteSelected(); }
    });
  }

  /* ════════════════════════════════════════════════════════════
     SMART VIEWS UI
  ════════════════════════════════════════════════════════════ */

  function updateSmartViewCounts() {
    const recent   = document.getElementById('bm-view-recent-count');
    const frequent = document.getElementById('bm-view-frequent-count');
    const unvisited= document.getElementById('bm-view-unvisited-count');
    if (recent)    recent.textContent    = getSmartView('recent').length   || '';
    if (frequent)  frequent.textContent  = getSmartView('frequent').length || '';
    if (unvisited) unvisited.textContent = getSmartView('unvisited').length|| '';
  }

  function updateTagsList() {
    const container = document.getElementById('bm-tags-list');
    if (!container) return;
    container.innerHTML = '';
    for (const tag of getAllTags()) {
      const pill = document.createElement('button');
      pill.className = `bm-tag-filter${_activeView === 'tag:' + tag ? ' active' : ''}`;
      pill.textContent = tag;
      const cnt = document.createElement('span');
      cnt.textContent = _tags[tag]?.size || 0;
      pill.appendChild(cnt);
      pill.addEventListener('click', () => {
        setActiveView(_activeView === 'tag:' + tag ? 'all' : 'tag:' + tag);
      });
      container.appendChild(pill);
    }
    const tagsSection = document.getElementById('bm-tags-section');
    if (tagsSection) tagsSection.classList.toggle('hidden', getAllTags().length === 0);
  }

  function updateViewToggle() {
    document.querySelectorAll('[data-bm-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bmView === _view);
    });
    document.querySelectorAll('[data-bm-smart]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bmSmart === _activeView);
    });
  }

  function setActiveView(view) {
    _activeView = view;
    _query      = '';
    _selected.clear();
    const searchInput = document.getElementById('bookmarks-search');
    if (searchInput) searchInput.value = '';
    render();
  }

  /* ════════════════════════════════════════════════════════════
     BARRE DE SÉLECTION (actions sur plusieurs items)
  ════════════════════════════════════════════════════════════ */

  function buildSelectionBar() {
    const existing = document.getElementById('bm-selection-bar');
    if (existing) return;

    const bar = document.createElement('div');
    bar.id = 'bm-selection-bar';
    bar.className = 'bm-selection-bar';
    bar.innerHTML = `
      <span class="bm-sel-count">0 selected</span>
      <button class="bm-sel-btn bm-sel-delete" title="${i18n.t('bm.delete')}">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4 3V2h4v1m1 0l-.6 7H3.6L3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        ${i18n.t('bm.delete')}
      </button>
      <button class="bm-sel-btn bm-sel-cancel" title="${i18n.t('bm.cancel')}">✕</button>
    `;
    bar.querySelector('.bm-sel-delete').addEventListener('click', () => deleteSelected());
    bar.querySelector('.bm-sel-cancel').addEventListener('click', () => {
      _selected.clear();
      updateSelectionUI();
    });

    const sidebar = document.getElementById('left-sidebar');
    sidebar?.appendChild(bar);
  }

  /* ════════════════════════════════════════════════════════════
     RENDU BARRE PERSONNELLE
  ════════════════════════════════════════════════════════════ */

  function renderToolbar() {
    const bar = document.getElementById('bookmarks-toolbar-items');
    if (!bar) return;
    bar.innerHTML = '';

    const toolbarItems = Object.values(_items)
      .filter(i => i.toolbar && i.type === 'bookmark')
      .sort((a, b) => (a.position || 0) - (b.position || 0));

    for (const item of toolbarItems) {
      const btn = document.createElement('button');
      btn.className = 'bm-toolbar-item';
      btn.title = item.url;

      const img = document.createElement('img');
      img.className = 'bm-favicon';
      img.src = faviconSrc(item.url);
      img.loading = 'lazy';
      img.onerror = () => img.remove();

      const lbl = document.createElement('span');
      lbl.textContent = item.title;

      btn.appendChild(img);
      btn.appendChild(lbl);
      btn.addEventListener('click', () => {
        window.DiscowlBrowser?.navigate(item.url);
        recordVisit(item.url);
      });
      bar.appendChild(btn);
    }
  }

  /* ════════════════════════════════════════════════════════════
     STAR POPUP — ancré sous le bouton étoile
  ════════════════════════════════════════════════════════════ */

  function openStarPopup(title, url) {
    closeStarPopup();

    const existing = Object.values(_items).find(i => i.url === url && i.type === 'bookmark');
    const isEdit   = !!existing;

    const popup = document.createElement('div');
    popup.id = 'star-popup';
    popup.className = 'star-popup';

    // Position sous le bouton étoile
    const starBtn = document.getElementById('bookmark-star-btn');
    if (starBtn) {
      const r = starBtn.getBoundingClientRect();
      popup.style.top   = (r.bottom + 6) + 'px';
      popup.style.right = (window.innerWidth - r.right) + 'px';
    }

    // Construire les dossiers disponibles
    const folders = Object.values(_items)
      .filter(i => i.type === 'folder')
      .map(f => `<option value="${f.id}">📁 ${f.title}</option>`)
      .join('');

    // Tags existants de l'item ou vides
    const existingTags = existing?.tags?.join(', ') || '';

    popup.innerHTML = `
      <div class="sp-header">
        <span class="sp-title">${isEdit ? i18n.t('bm.edit_bookmark') : i18n.t('bm.add_bookmark')}</span>
        <button class="sp-close" id="sp-close">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="sp-body">
        <label class="sp-label">${i18n.t('bm.name')}
          <input class="sp-input" id="sp-name" type="text" value="${(isEdit ? existing.title : title || url).replace(/"/g, '&quot;')}" autocomplete="off"/>
        </label>
        <label class="sp-label">${i18n.t('bm.tags_label')}
          <input class="sp-input" id="sp-tags" type="text" value="${existingTags}" placeholder="${i18n.t('bm.tags_placeholder')}" autocomplete="off"/>
        </label>
        <label class="sp-label">${i18n.t('bm.folder_label')}
          <select class="sp-select" id="sp-folder">
            <option value="">${i18n.t('bm.all_title')}</option>
            ${folders}
          </select>
        </label>
        <label class="sp-checkbox-row">
          <input type="checkbox" id="sp-toolbar" ${(existing?.toolbar) ? 'checked' : ''}/>
          <span>${i18n.t('bm.show_in_bar')}</span>
        </label>
      </div>
      <div class="sp-footer">
        ${isEdit ? `<button class="sp-btn sp-btn-danger" id="sp-delete">${i18n.t('bm.delete')}</button>` : ''}
        <button class="sp-btn sp-btn-ghost" id="sp-cancel">${i18n.t('bm.cancel')}</button>
        <button class="sp-btn sp-btn-primary" id="sp-save">${isEdit ? i18n.t('bm.update') : i18n.t('bm.save')}</button>
      </div>
    `;

    document.body.appendChild(popup);
    setTimeout(() => { popup.classList.add('open'); }, 10);

    // Set folder select to current folder
    if (existing) {
      const folderId = existing.parentId !== 'root' ? existing.parentId : '';
      popup.querySelector('#sp-folder').value = folderId || '';
    }

    // Events
    popup.querySelector('#sp-close').addEventListener('click', closeStarPopup);
    popup.querySelector('#sp-cancel').addEventListener('click', closeStarPopup);

    popup.querySelector('#sp-save').addEventListener('click', () => {
      const name     = popup.querySelector('#sp-name').value.trim() || url;
      const tagsRaw  = popup.querySelector('#sp-tags').value;
      const tags     = tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      const toolbar  = popup.querySelector('#sp-toolbar').checked;
      const folderId = popup.querySelector('#sp-folder').value || 'root';

      if (isEdit) {
        updateItem(existing.id, { title: name, tags, toolbar });
        // Move to new folder if changed
        if (folderId !== (existing.parentId || 'root')) {
          moveItem(existing.id, folderId, null);
        }
        showToast(i18n.t('toast.bookmark_updated'), 'success');
      } else {
        addItem({ title: name, url, tags, toolbar, parentId: folderId });
        showToast(i18n.t('toast.bookmark_saved'), 'success');
      }

      closeStarPopup();
      updateStarBtn(url);
    });

    if (isEdit) {
      popup.querySelector('#sp-delete').addEventListener('click', () => {
        deleteItem(existing.id);
        closeStarPopup();
        updateStarBtn(url);
        showToast(i18n.t('toast.bookmark_removed'), 'info');
      });
    }

    // Fermer au clic extérieur
    setTimeout(() => document.addEventListener('mousedown', _onOutsideStarClick), 100);

    // Focus
    setTimeout(() => {
      const input = popup.querySelector('#sp-name');
      input?.focus();
      input?.select();
    }, 60);
  }

  function _onOutsideStarClick(e) {
    const p = document.getElementById('star-popup');
    if (p && !p.contains(e.target) && e.target.id !== 'bookmark-star-btn') closeStarPopup();
  }

  function closeStarPopup() {
    const p = document.getElementById('star-popup');
    if (p) { p.classList.remove('open'); setTimeout(() => p.remove(), 150); }
    document.removeEventListener('mousedown', _onOutsideStarClick);
  }

  /* ════════════════════════════════════════════════════════════
     POPUP AJOUT / ÉDITION (depuis sidebar)
  ════════════════════════════════════════════════════════════ */

  function openAddPopup(opts = {}) {
    openBookmarkPopup(null, opts.parentId || 'root');
  }

  function openEditPopup(item) {
    openBookmarkPopup(item, item.parentId || 'root');
  }

  function openBookmarkPopup(item, defaultParentId) {
    closeBookmarkPopup();
    const isEdit = !!item;

    const folders = Object.values(_items)
      .filter(i => i.type === 'folder')
      .map(f => `<option value="${f.id}"${(item?.parentId || defaultParentId) === f.id ? ' selected' : ''}>📁 ${f.title}</option>`)
      .join('');

    const overlay = document.createElement('div');
    overlay.id = 'bm-popup-overlay';
    overlay.className = 'bm-popup-overlay';

    const box = document.createElement('div');
    box.className = 'bm-popup-box';
    box.innerHTML = `
      <div class="bm-popup-header">
        <span>${isEdit ? i18n.t('bm.edit_bookmark') : i18n.t('bm.add_bookmark')}</span>
        <button class="bm-popup-close" id="bm-popup-close">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="bm-popup-body">
        <label class="bm-popup-label">${i18n.t('bm.name')}
          <input class="bm-popup-input" id="bmp-name" type="text" value="${(item?.title || '').replace(/"/g, '&quot;')}" autocomplete="off"/>
        </label>
        <label class="bm-popup-label">URL
          <input class="bm-popup-input" id="bmp-url" type="url" value="${(item?.url || '').replace(/"/g, '&quot;')}" autocomplete="off"/>
        </label>
        <label class="bm-popup-label">${i18n.t('bm.tags_label')}
          <input class="bm-popup-input" id="bmp-tags" type="text" value="${(item?.tags || []).join(', ')}" placeholder="${i18n.t('bm.tags_placeholder')}"/>
        </label>
        <label class="bm-popup-label">${i18n.t('bm.folder_label')}
          <select class="bm-popup-select" id="bmp-folder">
            <option value="root"${!item?.parentId || item.parentId === 'root' ? ' selected' : ''}>${i18n.t('bm.all_title')}</option>
            ${folders}
          </select>
        </label>
        <label class="bm-popup-checkbox">
          <input type="checkbox" id="bmp-toolbar" ${item?.toolbar ? 'checked' : ''}/>
          <span>${i18n.t('bm.show_in_bar')}</span>
        </label>
      </div>
      <div class="bm-popup-footer">
        <button class="btn btn-secondary" id="bmp-cancel">${i18n.t('bm.cancel')}</button>
        <button class="btn btn-primary" id="bmp-save">${isEdit ? i18n.t('bm.update') : i18n.t('bm.save')}</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('open'), 10);

    overlay.querySelector('#bm-popup-close').addEventListener('click', closeBookmarkPopup);
    overlay.querySelector('#bmp-cancel').addEventListener('click', closeBookmarkPopup);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeBookmarkPopup(); });

    overlay.querySelector('#bmp-save').addEventListener('click', () => {
      const name    = overlay.querySelector('#bmp-name').value.trim();
      const url     = overlay.querySelector('#bmp-url').value.trim();
      const tagsRaw = overlay.querySelector('#bmp-tags').value;
      const tags    = tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      const toolbar = overlay.querySelector('#bmp-toolbar').checked;
      const folder  = overlay.querySelector('#bmp-folder').value || 'root';

      if (!url) { showToast(i18n.t('toast.url_required'), 'error'); return; }

      if (isEdit) {
        updateItem(item.id, { title: name || url, url, tags, toolbar });
        if (folder !== (item.parentId || 'root')) moveItem(item.id, folder, null);
        showToast(i18n.t('toast.bookmark_updated'), 'success');
      } else {
        addItem({ title: name || url, url, tags, toolbar, parentId: folder });
        showToast(i18n.t('toast.bookmark_saved'), 'success');
      }
      closeBookmarkPopup();
    });

    overlay.querySelector('#bmp-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') overlay.querySelector('#bmp-save').click();
      if (e.key === 'Escape') closeBookmarkPopup();
    });

    setTimeout(() => overlay.querySelector('#bmp-name').focus(), 60);
  }

  function closeBookmarkPopup() {
    const el = document.getElementById('bm-popup-overlay');
    if (el) { el.classList.remove('open'); setTimeout(() => el.remove(), 200); }
  }

  /* ════════════════════════════════════════════════════════════
     POPUP RENOMMAGE DOSSIER
  ════════════════════════════════════════════════════════════ */

  function openFolderModal(existing) {
    closeFolderModal();
    const isEdit = !!existing;

    const overlay = document.createElement('div');
    overlay.id = 'folder-modal-overlay';
    overlay.className = 'bm-popup-overlay';

    const box = document.createElement('div');
    box.className = 'bm-popup-box bm-popup-small';
    box.innerHTML = `
      <div class="bm-popup-header">
        <span>${isEdit ? i18n.t('bm.rename_folder') : i18n.t('bm.new_folder')}</span>
        <button class="bm-popup-close" id="fm-close">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="bm-popup-body">
        <label class="bm-popup-label">${i18n.t('bm.folder_label_name')}
          <input class="bm-popup-input" id="fm-name" type="text" value="${(existing?.title || '').replace(/"/g, '&quot;')}" autocomplete="off"/>
        </label>
      </div>
      <div class="bm-popup-footer">
        <button class="btn btn-secondary" id="fm-cancel">${i18n.t('bm.cancel')}</button>
        <button class="btn btn-primary" id="fm-save">${isEdit ? i18n.t('bm.rename_btn') : i18n.t('bm.create')}</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('open'), 10);

    const dismiss = () => closeFolderModal();
    overlay.querySelector('#fm-close').addEventListener('click', dismiss);
    overlay.querySelector('#fm-cancel').addEventListener('click', dismiss);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });

    overlay.querySelector('#fm-save').addEventListener('click', () => {
      const name = overlay.querySelector('#fm-name').value.trim();
      if (!name) { showToast(i18n.t('toast.name_required'), 'error'); return; }
      if (isEdit) {
        updateItem(existing.id, { title: name });
        showToast(i18n.t('toast.folder_renamed'), 'success');
      } else {
        addItem({ type: 'folder', title: name, parentId: 'root' });
        showToast(i18n.t('toast.folder_created'), 'success');
      }
      closeFolderModal();
    });

    overlay.querySelector('#fm-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') overlay.querySelector('#fm-save').click();
      if (e.key === 'Escape') dismiss();
    });

    setTimeout(() => {
      const input = overlay.querySelector('#fm-name');
      input?.focus(); input?.select();
    }, 60);
  }

  function openFolderRenamePopup(item) { openFolderModal(item); }
  function closeFolderModal() {
    const el = document.getElementById('folder-modal-overlay');
    if (el) { el.classList.remove('open'); setTimeout(() => el.remove(), 200); }
  }

  /* ════════════════════════════════════════════════════════════
     ÉTOILE — ÉTAT VISUEL
  ════════════════════════════════════════════════════════════ */

  function isBookmarked(url) {
    return Object.values(_items).some(i => i.type === 'bookmark' && i.url === url);
  }

  function updateStarBtn(url) {
    const btn = document.getElementById('bookmark-star-btn');
    if (!btn) return;
    const marked = isBookmarked(url);
    btn.classList.toggle('bookmarked', marked);
    btn.title = marked ? i18n.t('bm.edit_remove') : i18n.t('bm.add_to_bm');
    const path = btn.querySelector('path');
    if (path) {
      path.setAttribute('fill', marked ? 'var(--accent)' : 'none');
      path.setAttribute('stroke', marked ? 'var(--accent)' : 'currentColor');
    }
  }

  /* ════════════════════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════════════════════ */

  function init() {
    load();
    buildSelectionBar();
    initKeyboard();

    // Recherche
    document.getElementById('bookmarks-search')?.addEventListener('input', (e) => {
      _query = e.target.value;
      _activeView = _query ? 'search' : 'all';
      render();
    });

    // Boutons toolbar sidebar
    document.getElementById('add-bookmark-btn')?.addEventListener('click', () => openAddPopup());
    document.getElementById('add-folder-btn')?.addEventListener('click', () => openFolderModal(null));

    // Smart view buttons
    document.querySelectorAll('[data-bm-smart]').forEach(btn => {
      btn.addEventListener('click', () => setActiveView(btn.dataset.bmSmart));
    });

    // View toggle buttons
    document.querySelectorAll('[data-bm-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        _view = btn.dataset.bmView;
        render();
      });
    });

    // Mise à jour depuis autre fenêtre
    window.discowlAPI.favorites.onUpdated((data) => {
      _items = {};
      _order = {};
      importTree(data, 'root', 1.0);
      rebuildTagIndex();
      render();
      renderToolbar();
    });
  }

  /* ════════════════════════════════════════════════════════════
     API PUBLIQUE
  ════════════════════════════════════════════════════════════ */

  return {
    init,
    load,
    render,
    renderToolbar,
    openAddModal:     openAddPopup,
    openStarPopup,
    closeStarPopup,
    isBookmarked,
    updateStarBtn,
    recordVisit,
    undo,
    redo,
    getAll: () => exportTree('root'),
  };

})();

window.addEventListener('DOMContentLoaded', () => BookmarksManager.init());
window.BookmarksManager = BookmarksManager;