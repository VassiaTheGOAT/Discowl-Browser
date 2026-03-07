/* ─── components/bookmarks.js ───────────────────────────────────
   Système de favoris complet :
   • Arborescence avec dossiers et sous-dossiers
   • Barre personnelle (items avec toolbar:true)
   • Star popup (style Firefox) depuis la barre URL
   • Modal d'édition/ajout avec sélecteur de dossier destination
   • Modal de création de dossier (sans prompt() natif)
   • Drag & Drop pour réorganiser
   • Persistance dans favorites.json via IPC
─────────────────────────────────────────────────────────────── */

'use strict';

const BookmarksManager = (() => {

  /* ══════════════════════════════════════════════════════════
     ÉTAT
  ══════════════════════════════════════════════════════════ */
  let _bookmarks  = [];   // arborescence complète
  let _editingId  = null; // id en cours d'édition (null = ajout)
  let _filterText = '';

  /* ══════════════════════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════════════════════ */
  function uid() {
    return 'bm-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
  }

  /** Parcours récursif en profondeur → tableau plat */
  function flatAll(items) {
    const out = [];
    for (const it of items) {
      out.push(it);
      if (it.children?.length) out.push(...flatAll(it.children));
    }
    return out;
  }

  function findById(items, id) {
    for (const it of items) {
      if (it.id === id) return it;
      if (it.children?.length) {
        const found = findById(it.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  function removeById(items, id) {
    return items
      .filter(i => i.id !== id)
      .map(i => ({ ...i, children: i.children ? removeById(i.children, id) : [] }));
  }

  function updateById(items, id, updates) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === id) { items[i] = { ...items[i], ...updates }; return true; }
      if (items[i].children?.length && updateById(items[i].children, id, updates)) return true;
    }
    return false;
  }

  function insertIntoFolder(items, folderId, newItem) {
    for (const it of items) {
      if (it.id === folderId && it.type === 'folder') { it.children.push(newItem); return true; }
      if (it.children?.length && insertIntoFolder(it.children, folderId, newItem)) return true;
    }
    return false;
  }

  function filterItems(items, q) {
    const out = [];
    for (const it of items) {
      if (it.type === 'folder') {
        const sub = filterItems(it.children || [], q);
        if (sub.length) out.push({ ...it, children: sub });
      } else if (it.title?.toLowerCase().includes(q) || it.url?.toLowerCase().includes(q)) {
        out.push(it);
      }
    }
    return out;
  }

  /* ══════════════════════════════════════════════════════════
     PERSISTANCE
  ══════════════════════════════════════════════════════════ */
  async function load() {
    _bookmarks = await window.discowlAPI.favorites.get();
    render();
    renderToolbar();
  }

  async function persist() {
    await window.discowlAPI.favorites.save(_bookmarks);
  }

  /* ══════════════════════════════════════════════════════════
     RENDU — ARBORESCENCE
  ══════════════════════════════════════════════════════════ */
  function render() {
    const tree = document.getElementById('bookmarks-tree');
    if (!tree) return;
    const q = _filterText.toLowerCase().trim();
    const items = q ? filterItems(_bookmarks, q) : _bookmarks;
    tree.innerHTML = '';
    if (!items.length) {
      tree.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">Aucun favori</div>`;
      return;
    }
    items.forEach(item => tree.appendChild(createNode(item, 0)));
  }

  function createNode(item, depth) {
    return item.type === 'folder' ? createFolderNode(item, depth) : createBookmarkNode(item, depth);
  }

  function faviconSrc(url) {
    try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`; }
    catch { return ''; }
  }

  function createBookmarkNode(item, depth) {
    const div = document.createElement('div');
    div.className = 'bm-item';
    div.dataset.id = item.id;
    div.title = item.url || '';
    div.style.paddingLeft = `${8 + depth * 16}px`;

    // Favicon
    const fav = document.createElement('img');
    fav.style.cssText = 'width:14px;height:14px;flex-shrink:0;border-radius:2px;object-fit:contain';
    fav.src = faviconSrc(item.url);
    fav.onerror = () => { fav.replaceWith(makeSVGIcon()); };

    // Titre
    const lbl = document.createElement('span');
    lbl.className = 'bm-label';
    lbl.textContent = item.title || item.url;

    // Barre personnelle badge
    if (item.toolbar) {
      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:9px;color:var(--accent);flex-shrink:0;opacity:.7;letter-spacing:.02em';
      badge.textContent = '●';
      badge.title = 'Dans la barre personnelle';
      div.appendChild(fav);
      div.appendChild(lbl);
      div.appendChild(badge);
    } else {
      div.appendChild(fav);
      div.appendChild(lbl);
    }

    // Actions (visibles au hover)
    const actions = document.createElement('div');
    actions.className = 'bm-actions';
    actions.appendChild(makeActionBtn(
      'Edit',
      `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
      (e) => { e.stopPropagation(); openEditModal(item); }
    ));
    actions.appendChild(makeActionBtn(
      'Delete',
      `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4 3V1.5h4V3m1 0l-.7 7H3.7L3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      (e) => { e.stopPropagation(); deleteItem(item.id); },
      'delete'
    ));
    div.appendChild(actions);

    // Navigation
    div.addEventListener('click', () => window.DiscowlBrowser?.navigate(item.url));

    setupDrag(div, item);
    return div;
  }

  function makeSVGIcon() {
    const span = document.createElement('span');
    span.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="var(--text-muted)" stroke-width="1.2"/><path d="M5 5a2 2 0 114 0c0 1.5-2 1.5-2 3M7 11v.5" stroke="var(--text-muted)" stroke-width="1.2" stroke-linecap="round"/></svg>`;
    span.style.cssText = 'width:14px;height:14px;flex-shrink:0;display:flex;align-items:center';
    return span;
  }

  function makeActionBtn(title, svg, onClick, extraClass = '') {
    const btn = document.createElement('button');
    btn.className = `bm-action-btn${extraClass ? ' ' + extraClass : ''}`;
    btn.title = title;
    btn.innerHTML = svg;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function createFolderNode(item, depth) {
    const wrap = document.createElement('div');
    wrap.dataset.id = item.id;

    const div = document.createElement('div');
    div.className = 'bm-item';
    div.style.paddingLeft = `${8 + depth * 16}px`;

    // Chevron
    const chevron = document.createElement('span');
    chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    chevron.className = 'bm-folder-toggle';
    chevron.style.cssText = 'display:flex;align-items:center;flex-shrink:0;color:var(--text-muted);transition:transform .15s ease';

    const icon = document.createElement('span');
    icon.textContent = '📁';
    icon.style.cssText = 'font-size:13px;flex-shrink:0';

    const lbl = document.createElement('span');
    lbl.className = 'bm-label';
    lbl.textContent = item.title || 'Folder';

    const actions = document.createElement('div');
    actions.className = 'bm-actions';
    actions.appendChild(makeActionBtn(
      'Add bookmark here',
      `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      (e) => { e.stopPropagation(); openAddModal(item.id); }
    ));
    actions.appendChild(makeActionBtn(
      'Rename',
      `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
      (e) => { e.stopPropagation(); openFolderRenameModal(item); }
    ));
    actions.appendChild(makeActionBtn(
      'Delete folder',
      `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4 3V1.5h4V3m1 0l-.7 7H3.7L3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      (e) => { e.stopPropagation(); deleteItem(item.id); },
      'delete'
    ));

    div.appendChild(chevron);
    div.appendChild(icon);
    div.appendChild(lbl);
    div.appendChild(actions);

    // Enfants
    const children = document.createElement('div');
    children.className = 'bm-folder-children';
    (item.children || []).forEach(child => children.appendChild(createNode(child, depth + 1)));

    let isOpen = false;
    div.addEventListener('click', () => {
      isOpen = !isOpen;
      children.classList.toggle('open', isOpen);
      chevron.style.transform = isOpen ? 'rotate(90deg)' : '';
      icon.textContent = isOpen ? '📂' : '📁';
    });

    wrap.appendChild(div);
    wrap.appendChild(children);
    setupDrag(div, item);
    return wrap;
  }

  /* ══════════════════════════════════════════════════════════
     RENDU — BARRE PERSONNELLE
  ══════════════════════════════════════════════════════════ */
  function renderToolbar() {
    const bar = document.getElementById('bookmarks-toolbar-items');
    if (!bar) return;
    bar.innerHTML = '';

    const toolbarItems = flatAll(_bookmarks).filter(b => b.toolbar && b.type === 'bookmark');

    toolbarItems.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'bm-toolbar-item';
      btn.title = item.url;

      const img = document.createElement('img');
      img.className = 'bm-favicon';
      img.src = faviconSrc(item.url);
      img.onerror = () => img.remove();

      const lbl = document.createElement('span');
      lbl.textContent = item.title;

      btn.appendChild(img);
      btn.appendChild(lbl);
      btn.addEventListener('click', () => window.DiscowlBrowser?.navigate(item.url));
      bar.appendChild(btn);
    });
  }

  /* ══════════════════════════════════════════════════════════
     STAR POPUP — style Firefox
     S'ouvre ancré sous le bouton étoile dans la toolbar.
  ══════════════════════════════════════════════════════════ */
  function openStarPopup(title, url) {
    closeStarPopup(); // ferme si déjà ouvert

    const existing = flatAll(_bookmarks).find(b => b.url === url && b.type === 'bookmark');
    const isEdit   = !!existing;

    // Créer le popup
    const popup = document.createElement('div');
    popup.id = 'star-popup';
    popup.style.cssText = `
      position: fixed;
      z-index: 9998;
      width: 300px;
      background: var(--bg-modal);
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      box-shadow: 0 16px 48px rgba(0,0,0,.6);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      animation: menuIn .15s cubic-bezier(.4,0,.2,1);
    `;

    // Positionner sous le bouton étoile
    const starBtn = document.getElementById('bookmark-star-btn');
    if (starBtn) {
      const rect = starBtn.getBoundingClientRect();
      popup.style.top  = (rect.bottom + 6) + 'px';
      popup.style.right = (window.innerWidth - rect.right) + 'px';
    }

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
    const hTitle = document.createElement('span');
    hTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--text-primary)';
    hTitle.textContent = isEdit ? '✏️ Edit bookmark' : '⭐ Bookmark added';
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    closeBtn.style.cssText = 'background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:2px;border-radius:4px;display:flex;align-items:center';
    closeBtn.addEventListener('click', closeStarPopup);
    header.appendChild(hTitle);
    header.appendChild(closeBtn);
    popup.appendChild(header);

    // Champ Nom
    const nameLabel = document.createElement('label');
    nameLabel.style.cssText = 'display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text-secondary)';
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = (isEdit ? existing.title : title) || url;
    nameInput.style.cssText = '-webkit-user-select:text;user-select:text;background:var(--bg-input);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-primary);font-size:12px;font-family:var(--font-ui);outline:none;transition:border-color .15s';
    nameInput.addEventListener('focus', () => nameInput.style.borderColor = 'var(--accent)');
    nameInput.addEventListener('blur',  () => nameInput.style.borderColor = 'var(--border)');
    nameLabel.appendChild(nameInput);
    popup.appendChild(nameLabel);

    // Sélecteur dossier destination
    const folderLabel = document.createElement('label');
    folderLabel.style.cssText = 'display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text-secondary)';
    folderLabel.textContent = 'Folder';
    const folderSelect = document.createElement('select');
    folderSelect.style.cssText = 'background:var(--bg-input);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-primary);font-size:12px;font-family:var(--font-ui);outline:none;cursor:pointer';

    // Option racine
    const rootOpt = document.createElement('option');
    rootOpt.value = '';
    rootOpt.textContent = '📚 Bookmarks (root)';
    folderSelect.appendChild(rootOpt);

    // Tous les dossiers
    const folders = flatAll(_bookmarks).filter(b => b.type === 'folder');
    folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = '📁 ' + f.title;
      folderSelect.appendChild(opt);
    });

    folderLabel.appendChild(folderSelect);
    popup.appendChild(folderLabel);

    // Checkbox barre personnelle
    const toolbarRow = document.createElement('label');
    toolbarRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);cursor:pointer';
    const toolbarChk = document.createElement('input');
    toolbarChk.type = 'checkbox';
    toolbarChk.checked = isEdit ? !!existing.toolbar : false;
    toolbarChk.style.cssText = 'accent-color:var(--accent);cursor:pointer;width:14px;height:14px';
    toolbarRow.appendChild(toolbarChk);
    toolbarRow.appendChild(document.createTextNode('Show in bookmarks bar'));
    popup.appendChild(toolbarRow);

    // Boutons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:2px';

    if (isEdit) {
      // Bouton Supprimer
      const rmBtn = document.createElement('button');
      rmBtn.textContent = 'Delete';
      rmBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid rgba(248,113,113,.3);background:transparent;color:var(--red);font-size:12px;font-family:var(--font-ui);cursor:pointer;transition:background .15s';
      rmBtn.addEventListener('click', () => {
        deleteItem(existing.id);
        closeStarPopup();
        updateStarBtn(url);
        showToast('Bookmark removed', 'info');
      });
      btnRow.appendChild(rmBtn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid var(--border-strong);background:transparent;color:var(--text-secondary);font-size:12px;font-family:var(--font-ui);cursor:pointer;transition:background .15s';
    cancelBtn.addEventListener('click', closeStarPopup);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = isEdit ? 'Update' : 'Save';
    saveBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:none;background:var(--accent);color:#fff;font-size:12px;font-family:var(--font-ui);font-weight:500;cursor:pointer;transition:background .15s';
    saveBtn.addEventListener('click', () => {
      const newName    = nameInput.value.trim() || url;
      const newToolbar = toolbarChk.checked;
      const destFolder = folderSelect.value;

      if (isEdit) {
        // Mettre à jour
        updateById(_bookmarks, existing.id, { title: newName, toolbar: newToolbar });
        // Si changement de dossier : déplacer
        if (destFolder !== getFolderOf(existing.id)) {
          _bookmarks = removeById(_bookmarks, existing.id);
          const updated = { ...existing, title: newName, toolbar: newToolbar };
          if (destFolder) insertIntoFolder(_bookmarks, destFolder, updated);
          else _bookmarks.push(updated);
        }
      } else {
        // Nouveau favori
        const newItem = { id: uid(), title: newName, url, type: 'bookmark', toolbar: newToolbar, children: [] };
        if (destFolder) insertIntoFolder(_bookmarks, destFolder, newItem);
        else _bookmarks.push(newItem);
      }

      persist();
      render();
      renderToolbar();
      closeStarPopup();
      updateStarBtn(url);
      showToast(isEdit ? 'Bookmark updated' : 'Bookmark saved', 'success');
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    popup.appendChild(btnRow);

    document.body.appendChild(popup);

    // Focus auto sur le nom
    setTimeout(() => nameInput.focus(), 50);

    // Fermer si clic en dehors
    setTimeout(() => {
      document.addEventListener('mousedown', _starPopupOutsideClick);
    }, 100);
  }

  function _starPopupOutsideClick(e) {
    const popup = document.getElementById('star-popup');
    if (popup && !popup.contains(e.target) && e.target.id !== 'bookmark-star-btn') {
      closeStarPopup();
    }
  }

  function closeStarPopup() {
    document.getElementById('star-popup')?.remove();
    document.removeEventListener('mousedown', _starPopupOutsideClick);
  }

  /** Trouve dans quel dossier se trouve un item (retourne l'id du dossier ou '') */
  function getFolderOf(itemId) {
    function search(items, parentId) {
      for (const it of items) {
        if (it.id === itemId) return parentId;
        if (it.children?.length) {
          const found = search(it.children, it.id);
          if (found !== null) return found;
        }
      }
      return null;
    }
    return search(_bookmarks, '') ?? '';
  }

  /* ══════════════════════════════════════════════════════════
     MODAL — AJOUT / ÉDITION (depuis la sidebar)
  ══════════════════════════════════════════════════════════ */
  function openAddModal(parentId = null) {
    _editingId = null;
    const modal = document.getElementById('bookmark-modal');
    if (!modal) return;
    document.getElementById('bookmark-modal-title').textContent = 'Add bookmark';
    document.getElementById('bm-name-input').value    = window.DiscowlBrowser?.getCurrentTitle() || '';
    document.getElementById('bm-url-input').value     = window.DiscowlBrowser?.getCurrentUrl()   || '';
    document.getElementById('bm-toolbar-check').checked = false;
    modal.classList.remove('hidden');
    modal.dataset.parentId = parentId || '';
    document.getElementById('bm-name-input').focus();
    document.getElementById('bm-name-input').select();
  }

  function openEditModal(item) {
    _editingId = item.id;
    const modal = document.getElementById('bookmark-modal');
    if (!modal) return;
    document.getElementById('bookmark-modal-title').textContent = 'Edit bookmark';
    document.getElementById('bm-name-input').value    = item.title || '';
    document.getElementById('bm-url-input').value     = item.url || '';
    document.getElementById('bm-toolbar-check').checked = !!item.toolbar;
    modal.classList.remove('hidden');
    modal.dataset.parentId = '';
    document.getElementById('bm-name-input').focus();
  }

  function saveFromModal() {
    const name     = document.getElementById('bm-name-input').value.trim();
    const url      = document.getElementById('bm-url-input').value.trim();
    const toolbar  = document.getElementById('bm-toolbar-check').checked;
    const modal    = document.getElementById('bookmark-modal');
    const parentId = modal?.dataset.parentId || null;

    if (!url) { showToast('URL required', 'error'); return; }

    if (_editingId) {
      updateById(_bookmarks, _editingId, { title: name || url, url, toolbar });
    } else {
      const newItem = { id: uid(), title: name || url, url, type: 'bookmark', toolbar, children: [] };
      if (parentId) insertIntoFolder(_bookmarks, parentId, newItem);
      else _bookmarks.push(newItem);
    }

    persist();
    render();
    renderToolbar();
    closeModal();
    updateStarBtn(url);
    showToast(_editingId ? 'Bookmark updated' : 'Bookmark added', 'success');
    _editingId = null;
  }

  function closeModal() {
    document.getElementById('bookmark-modal')?.classList.add('hidden');
  }

  /* ══════════════════════════════════════════════════════════
     MODAL — CRÉATION / RENOMMAGE DOSSIER
     (Remplace l'affreux prompt() natif)
  ══════════════════════════════════════════════════════════ */
  let _folderEditingId = null;

  function openFolderModal(existingItem = null) {
    _folderEditingId = existingItem?.id || null;

    // Créer la modal si elle n'existe pas encore
    let modal = document.getElementById('folder-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'folder-modal';
      modal.className = 'modal hidden';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = `
        <div class="modal-overlay" id="folder-modal-overlay"></div>
        <div class="modal-box">
          <div class="modal-header">
            <h3 id="folder-modal-title">New folder</h3>
            <button class="modal-close" id="folder-modal-close">
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <label class="form-label">Nom du dossier
              <input id="folder-name-input" type="text" class="form-input" placeholder="My folder" autocomplete="off"/>
            </label>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="folder-modal-cancel">Cancel</button>
            <button class="btn btn-primary"   id="folder-modal-save">Créer</button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      document.getElementById('folder-modal-close')?.addEventListener('click',  closeFolderModal);
      document.getElementById('folder-modal-cancel')?.addEventListener('click', closeFolderModal);
      document.getElementById('folder-modal-overlay')?.addEventListener('click', closeFolderModal);
      document.getElementById('folder-modal-save')?.addEventListener('click',   saveFolderModal);
      document.getElementById('folder-name-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveFolderModal();
        if (e.key === 'Escape') closeFolderModal();
      });
    }

    document.getElementById('folder-modal-title').textContent = existingItem ? 'Rename folder' : 'New folder';
    document.getElementById('folder-modal-save').textContent  = existingItem ? 'Rename' : 'Créer';
    const input = document.getElementById('folder-name-input');
    input.value = existingItem?.title || '';
    modal.classList.remove('hidden');
    setTimeout(() => { input.focus(); input.select(); }, 50);
  }

  function openFolderRenameModal(item) { openFolderModal(item); }

  function saveFolderModal() {
    const name = document.getElementById('folder-name-input')?.value.trim();
    if (!name) { showToast('Name required', 'error'); return; }

    if (_folderEditingId) {
      updateById(_bookmarks, _folderEditingId, { title: name });
      showToast('Folder renamed', 'success');
    } else {
      _bookmarks.push({ id: uid(), title: name, type: 'folder', toolbar: false, children: [] });
      showToast('Folder created', 'success');
    }

    persist();
    render();
    closeFolderModal();
    _folderEditingId = null;
  }

  function closeFolderModal() {
    document.getElementById('folder-modal')?.classList.add('hidden');
    _folderEditingId = null;
  }

  /* ══════════════════════════════════════════════════════════
     CRUD
  ══════════════════════════════════════════════════════════ */
  function deleteItem(id) {
    _bookmarks = removeById(_bookmarks, id);
    persist();
    render();
    renderToolbar();
    showToast('Deleted', 'info');
  }

  /* ══════════════════════════════════════════════════════════
     ÉTOILE — état visuel
  ══════════════════════════════════════════════════════════ */
  function isBookmarked(url) {
    return flatAll(_bookmarks).some(b => b.type === 'bookmark' && b.url === url);
  }

  /** Met à jour l'étoile dans la barre URL */
  function updateStarBtn(url) {
    const btn = document.getElementById('bookmark-star-btn');
    if (!btn) return;
    const marked = isBookmarked(url);
    btn.classList.toggle('bookmarked', marked);
    btn.title = marked ? 'Edit / Remove bookmark' : 'Add to bookmarks';
    // Changer l'apparence de l'icône SVG (filled vs outline)
    const path = btn.querySelector('path');
    if (path) {
      path.setAttribute('fill', marked ? 'var(--accent)' : 'none');
      path.setAttribute('stroke', marked ? 'var(--accent)' : 'currentColor');
    }
  }

  /* ══════════════════════════════════════════════════════════
     DRAG & DROP
  ══════════════════════════════════════════════════════════ */
  function setupDrag(el, item) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.id);
      el.style.opacity = '.45';
    });
    el.addEventListener('dragend',  () => { el.style.opacity = ''; el.style.background = ''; });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.style.background = 'rgba(230,108,44,.1)'; });
    el.addEventListener('dragleave', () => { el.style.background = ''; });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.style.background = '';
      const fromId = e.dataTransfer.getData('text/plain');
      if (fromId && fromId !== item.id) moveItem(fromId, item.id);
    });
  }

  function moveItem(fromId, toId) {
    let moved = null;
    function extract(items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].id === fromId) { moved = { ...items[i] }; items.splice(i, 1); return true; }
        if (items[i].children && extract(items[i].children)) return true;
      }
    }
    extract(_bookmarks);
    if (!moved) return;

    function insertAfter(items, tid) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].id === tid) { items.splice(i + 1, 0, moved); return true; }
        if (items[i].children && insertAfter(items[i].children, tid)) return true;
      }
    }
    insertAfter(_bookmarks, toId);
    persist();
    render();
    renderToolbar();
  }

  /* ══════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════ */
  function init() {
    load();

    // Recherche
    document.getElementById('bookmarks-search')?.addEventListener('input', (e) => {
      _filterText = e.target.value;
      render();
    });

    // Bouton "Ajouter un favori" dans la sidebar
    document.getElementById('add-bookmark-btn')?.addEventListener('click', () => openAddModal());

    // Bouton "Nouveau dossier" dans la sidebar → modal propre, plus de prompt()
    document.getElementById('add-folder-btn')?.addEventListener('click', () => openFolderModal());

    // Modal favori — sauvegarder
    document.getElementById('bookmark-modal-save')?.addEventListener('click', saveFromModal);
    document.getElementById('bookmark-modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('bookmark-modal-close')?.addEventListener('click', closeModal);
    document.querySelector('.modal-overlay')?.addEventListener('click', closeModal);
    document.getElementById('bm-name-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveFromModal();
      if (e.key === 'Escape') closeModal();
    });

    // Mise à jour en direct depuis le processus main (autre fenêtre, etc.)
    window.discowlAPI.favorites.onUpdated((data) => {
      _bookmarks = data;
      render();
      renderToolbar();
    });
  }

  /* ══════════════════════════════════════════════════════════
     API PUBLIQUE
  ══════════════════════════════════════════════════════════ */
  return {
    init,
    load,
    render,
    renderToolbar,
    openAddModal,
    openStarPopup,    // appelé par renderer.js via l'étoile
    closeStarPopup,
    isBookmarked,
    updateStarBtn,
    getAll: () => _bookmarks
  };

})();

window.addEventListener('DOMContentLoaded', () => BookmarksManager.init());
window.BookmarksManager = BookmarksManager;