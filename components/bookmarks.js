/* ─── components/bookmarks.js ───────────────────────────────────
   Système de favoris v2 :
   • Deux dossiers racine indestructibles :
       root-bar   → Bookmarks Bar (affiché dans la toolbar)
       root-other → All Bookmarks (dossier général)
   • Tri libre : drag-and-drop avec indicateur before/after/into
   • Arborescence avec sous-dossiers illimités
   • Star popup style Firefox
   • Persistance via favorites.json
─────────────────────────────────────────────────────────────── */
'use strict';

const BookmarksManager = (() => {

  /* ══════════════════════════════════════════════════════════
     ÉTAT
  ══════════════════════════════════════════════════════════ */
  let _bookmarks  = [];
  let _editingId  = null;
  let _filterText = '';

  const ROOT_BAR   = 'root-bar';
  const ROOT_OTHER = 'root-other';

  /* ══════════════════════════════════════════════════════════
     RACINES SYSTÈME
  ══════════════════════════════════════════════════════════ */
  function makeRoots() {
    return [
      { id: ROOT_BAR,   title: 'Bookmarks Bar',  type: 'folder', system: true, open: true,  children: [] },
      { id: ROOT_OTHER, title: 'All Bookmarks',  type: 'folder', system: true, open: false, children: [] },
    ];
  }

  /** Assure que les deux racines système existent, migre les anciens bookmarks */
  function ensureRoots(data) {
    const hasBar   = data.some(x => x.id === ROOT_BAR);
    const hasOther = data.some(x => x.id === ROOT_OTHER);

    if (hasBar && hasOther) return data;

    // Migration depuis l'ancien format plat
    const roots  = makeRoots();
    const barR   = roots[0];
    const otherR = roots[1];

    // Si les deux racines existent séparément mais sans les ids fixes, conserver
    // Sinon répartir : toolbar:true → bar, reste → other
    for (const item of data) {
      if (item.id === ROOT_BAR || item.id === ROOT_OTHER) continue;
      if (item.toolbar && item.type === 'bookmark') barR.children.push(item);
      else otherR.children.push(item);
    }
    return roots;
  }

  /* ══════════════════════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════════════════════ */
  function uid() {
    return 'bm-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
  }

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
        const f = findById(it.children, id);
        if (f) return f;
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
    return search(_bookmarks, '') ?? ROOT_OTHER;
  }

  function isInBar(item) {
    function search(items) {
      for (const it of items) {
        if (it.id === item.id) return true;
        if (it.children?.length && search(it.children)) return true;
      }
      return false;
    }
    const barRoot = findById(_bookmarks, ROOT_BAR);
    return barRoot ? search(barRoot.children) : false;
  }

  /* ══════════════════════════════════════════════════════════
     PERSISTANCE
  ══════════════════════════════════════════════════════════ */
  async function load() {
    const raw  = await window.discowlAPI.favorites.get();
    _bookmarks = ensureRoots(Array.isArray(raw) ? raw : []);
    render();
    renderToolbar();
  }

  async function persist() {
    await window.discowlAPI.favorites.save(_bookmarks);
  }

  /* ══════════════════════════════════════════════════════════
     RENDU — SIDEBAR
  ══════════════════════════════════════════════════════════ */
  function render() {
    const tree = document.getElementById('bookmarks-tree');
    if (!tree) return;
    const q = _filterText.toLowerCase().trim();

    tree.innerHTML = '';
    if (q) {
      // Recherche — affichage plat filtré, sans les racines système
      const all = flatAll(_bookmarks).filter(b =>
        b.type === 'bookmark' &&
        (b.title?.toLowerCase().includes(q) || b.url?.toLowerCase().includes(q))
      );
      if (!all.length) {
        tree.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">No results</div>`;
        return;
      }
      all.forEach(item => tree.appendChild(createBookmarkNode(item, 1)));
      return;
    }

    // Affichage normal — les deux racines système toujours en tête
    _bookmarks.forEach(item => tree.appendChild(createNode(item, 0)));
  }

  function createNode(item, depth) {
    return item.type === 'folder' ? createFolderNode(item, depth) : createBookmarkNode(item, depth);
  }

  function faviconSrc(url) {
    try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`; }
    catch { return ''; }
  }

  /* ── Bookmark node ── */
  function createBookmarkNode(item, depth) {
    const div = document.createElement('div');
    div.className = 'bm-item';
    div.dataset.id = item.id;
    div.title = item.url || '';
    div.style.paddingLeft = `${8 + depth * 16}px`;

    const fav = document.createElement('img');
    fav.style.cssText = 'width:14px;height:14px;flex-shrink:0;border-radius:2px;object-fit:contain';
    fav.src = faviconSrc(item.url);
    fav.onerror = () => { fav.replaceWith(makeSVGIcon()); };

    const lbl = document.createElement('span');
    lbl.className = 'bm-label';
    lbl.textContent = item.title || item.url;

    div.appendChild(fav);
    div.appendChild(lbl);

    const actions = document.createElement('div');
    actions.className = 'bm-actions';
    actions.appendChild(makeActionBtn('Edit',
      `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
      (e) => { e.stopPropagation(); openEditModal(item); }
    ));
    actions.appendChild(makeActionBtn('Delete',
      `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4 3V1.5h4V3m1 0l-.7 7H3.7L3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      (e) => { e.stopPropagation(); deleteItem(item.id); },
      'delete'
    ));
    div.appendChild(actions);

    div.addEventListener('click', () => window.DiscowlBrowser?.navigate(item.url));
    setupDrag(div, item);
    return div;
  }

  /* ── Folder node ── */
  function createFolderNode(item, depth) {
    const wrap = document.createElement('div');
    wrap.dataset.id = item.id;

    const div = document.createElement('div');
    div.className = 'bm-item' + (item.system ? ' bm-item-system' : '');
    div.style.paddingLeft = `${8 + depth * 16}px`;

    const chevron = document.createElement('span');
    chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    chevron.className = 'bm-folder-toggle';
    chevron.style.cssText = 'display:flex;align-items:center;flex-shrink:0;color:var(--text-muted);transition:transform .15s ease';

    const icon = document.createElement('span');
    icon.style.cssText = 'font-size:13px;flex-shrink:0';

    const lbl = document.createElement('span');
    lbl.className = 'bm-label';
    lbl.textContent = item.title || 'Folder';
    if (item.system) lbl.style.fontWeight = '600';

    const actions = document.createElement('div');
    actions.className = 'bm-actions';

    // Bouton "Ajouter ici" — toujours présent
    actions.appendChild(makeActionBtn('Add bookmark here',
      `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      (e) => { e.stopPropagation(); openAddModal(item.id); }
    ));

    if (!item.system) {
      // Renommer — seulement les dossiers non-système
      actions.appendChild(makeActionBtn('Rename',
        `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
        (e) => { e.stopPropagation(); openFolderRenameModal(item); }
      ));
      // Supprimer — seulement non-système
      actions.appendChild(makeActionBtn('Delete folder',
        `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4 3V1.5h4V3m1 0l-.7 7H3.7L3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        (e) => { e.stopPropagation(); deleteItem(item.id); },
        'delete'
      ));
    }

    div.appendChild(chevron);
    div.appendChild(icon);
    div.appendChild(lbl);
    div.appendChild(actions);

    const children = document.createElement('div');
    children.className = 'bm-folder-children';

    // Ouvrir par défaut les racines système
    let isOpen = !!item.open;
    const applyOpen = () => {
      children.classList.toggle('open', isOpen);
      chevron.style.transform = isOpen ? 'rotate(90deg)' : '';
      icon.textContent = isOpen ? '📂' : '📁';
    };
    applyOpen();

    (item.children || []).forEach(child => children.appendChild(createNode(child, depth + 1)));

    div.addEventListener('click', () => {
      isOpen = !isOpen;
      item.open = isOpen; // mémoriser l'état
      applyOpen();
    });

    wrap.appendChild(div);
    wrap.appendChild(children);

    if (!item.system) setupDrag(div, item);
    setupDropZone(div, item);
    return wrap;
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

  /* ══════════════════════════════════════════════════════════
     RENDU — BARRE PERSONNELLE
  ══════════════════════════════════════════════════════════ */
  function renderToolbar() {
    const bar = document.getElementById('bookmarks-toolbar-items');
    if (!bar) return;
    bar.innerHTML = '';

    const barRoot = findById(_bookmarks, ROOT_BAR);
    if (!barRoot) return;

    // Afficher tous les items directs de la barre (profondeur 1 seulement pour éviter l'encombrement)
    const items = flatAll(barRoot.children).filter(b => b.type === 'bookmark');
    items.forEach(item => {
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
     STAR POPUP
  ══════════════════════════════════════════════════════════ */
  function openStarPopup(title, url) {
    closeStarPopup();

    const existing = flatAll(_bookmarks).find(b => b.url === url && b.type === 'bookmark');
    const isEdit   = !!existing;
    const inBar    = existing ? isInBar(existing) : false;

    const popup = document.createElement('div');
    popup.id = 'star-popup';
    popup.style.cssText = `
      position:fixed;z-index:10002;width:300px;
      background:var(--bg-modal);border:1px solid var(--border-strong);
      border-radius:10px;box-shadow:0 16px 48px rgba(0,0,0,.6);
      padding:16px;display:flex;flex-direction:column;gap:12px;
      animation:menuIn .15s cubic-bezier(.4,0,.2,1);
    `;

    const starBtn = document.getElementById('bookmark-star-btn');
    if (starBtn) {
      const rect = starBtn.getBoundingClientRect();
      popup.style.top   = (rect.bottom + 6) + 'px';
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

    // Champ nom
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

    // Sélecteur dossier : racines système + tous sous-dossiers
    const folderLabel = document.createElement('label');
    folderLabel.style.cssText = 'display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--text-secondary)';
    folderLabel.textContent = 'Save in';
    const folderSelect = document.createElement('select');
    folderSelect.style.cssText = 'background:var(--bg-input);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text-primary);font-size:12px;font-family:var(--font-ui);outline:none;cursor:pointer';

    function addFolderOptions(items, depth) {
      for (const it of items) {
        if (it.type !== 'folder') continue;
        const opt = document.createElement('option');
        opt.value = it.id;
        const prefix = depth === 0 ? (it.id === ROOT_BAR ? '⭐ ' : '📚 ') : '  '.repeat(depth) + '📁 ';
        opt.textContent = prefix + it.title;
        if (it.system) opt.style.fontWeight = '600';
        folderSelect.appendChild(opt);
        if (it.children?.length) addFolderOptions(it.children, depth + 1);
      }
    }
    addFolderOptions(_bookmarks, 0);

    // Sélectionner le dossier courant si édition
    if (isEdit) {
      const currentFolder = getFolderOf(existing.id);
      folderSelect.value = currentFolder || ROOT_OTHER;
    } else {
      folderSelect.value = ROOT_OTHER;
    }

    folderLabel.appendChild(folderSelect);
    popup.appendChild(folderLabel);

    // Boutons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:2px';

    if (isEdit) {
      const rmBtn = document.createElement('button');
      rmBtn.textContent = 'Delete';
      rmBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid rgba(248,113,113,.3);background:transparent;color:var(--red);font-size:12px;font-family:var(--font-ui);cursor:pointer';
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
    cancelBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid var(--border-strong);background:transparent;color:var(--text-secondary);font-size:12px;font-family:var(--font-ui);cursor:pointer';
    cancelBtn.addEventListener('click', closeStarPopup);

    const saveBtn = document.createElement('button');
    saveBtn.textContent = isEdit ? 'Update' : 'Save';
    saveBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:none;background:var(--accent);color:#fff;font-size:12px;font-family:var(--font-ui);font-weight:500;cursor:pointer';
    saveBtn.addEventListener('click', () => {
      const newName    = nameInput.value.trim() || url;
      const destFolder = folderSelect.value || ROOT_OTHER;

      if (isEdit) {
        const curFolder = getFolderOf(existing.id);
        const updated   = { ...existing, title: newName, toolbar: destFolder === ROOT_BAR };
        if (destFolder !== curFolder) {
          _bookmarks = removeById(_bookmarks, existing.id);
          insertIntoFolder(_bookmarks, destFolder, updated);
        } else {
          updateById(_bookmarks, existing.id, { title: newName, toolbar: destFolder === ROOT_BAR });
        }
      } else {
        const newItem = { id: uid(), title: newName, url, type: 'bookmark', toolbar: destFolder === ROOT_BAR, children: [] };
        insertIntoFolder(_bookmarks, destFolder, newItem);
      }

      persist(); render(); renderToolbar();
      closeStarPopup();
      updateStarBtn(url);
      showToast(isEdit ? 'Bookmark updated' : 'Bookmark saved', 'success');
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    popup.appendChild(btnRow);

    document.body.appendChild(popup);
    setTimeout(() => nameInput.focus(), 50);
    setTimeout(() => document.addEventListener('mousedown', _starPopupOutsideClick), 100);
  }

  function _starPopupOutsideClick(e) {
    const popup = document.getElementById('star-popup');
    if (popup && !popup.contains(e.target) && e.target.id !== 'bookmark-star-btn') closeStarPopup();
  }

  function closeStarPopup() {
    document.getElementById('star-popup')?.remove();
    document.removeEventListener('mousedown', _starPopupOutsideClick);
  }

  /* ══════════════════════════════════════════════════════════
     MODAL — AJOUT / ÉDITION (sidebar)
  ══════════════════════════════════════════════════════════ */
  function openAddModal(parentId = null) {
    _editingId = null;
    const modal = document.getElementById('bookmark-modal');
    if (!modal) return;
    document.getElementById('bookmark-modal-title').textContent = 'Add bookmark';
    document.getElementById('bm-name-input').value  = window.DiscowlBrowser?.getCurrentTitle() || '';
    document.getElementById('bm-url-input').value   = window.DiscowlBrowser?.getCurrentUrl()   || '';
    document.getElementById('bm-toolbar-check').checked = (parentId === ROOT_BAR);
    modal.classList.remove('hidden');
    modal.dataset.parentId = parentId || ROOT_OTHER;
    document.getElementById('bm-name-input').focus();
    document.getElementById('bm-name-input').select();
  }

  function openEditModal(item) {
    _editingId = item.id;
    const modal = document.getElementById('bookmark-modal');
    if (!modal) return;
    document.getElementById('bookmark-modal-title').textContent = 'Edit bookmark';
    document.getElementById('bm-name-input').value  = item.title || '';
    document.getElementById('bm-url-input').value   = item.url   || '';
    document.getElementById('bm-toolbar-check').checked = isInBar(item);
    modal.classList.remove('hidden');
    modal.dataset.parentId = '';
    document.getElementById('bm-name-input').focus();
  }

  function saveFromModal() {
    const name     = document.getElementById('bm-name-input').value.trim();
    const url      = document.getElementById('bm-url-input').value.trim();
    const toolbar  = document.getElementById('bm-toolbar-check').checked;
    const modal    = document.getElementById('bookmark-modal');
    const parentId = modal?.dataset.parentId || ROOT_OTHER;

    if (!url) { showToast('URL required', 'error'); return; }

    const destFolder = toolbar ? ROOT_BAR : (parentId || ROOT_OTHER);

    if (_editingId) {
      const curFolder = getFolderOf(_editingId);
      const existing  = findById(_bookmarks, _editingId);
      const updated   = { ...existing, title: name || url, url, toolbar };
      if (destFolder !== curFolder) {
        _bookmarks = removeById(_bookmarks, _editingId);
        insertIntoFolder(_bookmarks, destFolder, updated);
      } else {
        updateById(_bookmarks, _editingId, { title: name || url, url, toolbar });
      }
    } else {
      const newItem = { id: uid(), title: name || url, url, type: 'bookmark', toolbar, children: [] };
      insertIntoFolder(_bookmarks, destFolder, newItem);
    }

    persist(); render(); renderToolbar();
    closeModal();
    updateStarBtn(url);
    showToast(_editingId ? 'Bookmark updated' : 'Bookmark added', 'success');
    _editingId = null;
  }

  function closeModal() {
    document.getElementById('bookmark-modal')?.classList.add('hidden');
  }

  /* ══════════════════════════════════════════════════════════
     MODAL — DOSSIER
  ══════════════════════════════════════════════════════════ */
  let _folderEditingId = null;

  function openFolderModal(existingItem = null) {
    _folderEditingId = existingItem?.id || null;
    let modal = document.getElementById('folder-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'folder-modal';
      modal.className = 'modal hidden';
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
            <label class="form-label">Folder name
              <input id="folder-name-input" type="text" class="form-input" placeholder="My folder" autocomplete="off"/>
            </label>
            <label class="form-label" style="margin-top:10px">Parent
              <select id="folder-parent-select" class="form-input"></select>
            </label>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="folder-modal-cancel">Cancel</button>
            <button class="btn btn-primary"   id="folder-modal-save">Create</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      document.getElementById('folder-modal-close')?.addEventListener('click',   closeFolderModal);
      document.getElementById('folder-modal-cancel')?.addEventListener('click',  closeFolderModal);
      document.getElementById('folder-modal-overlay')?.addEventListener('click', closeFolderModal);
      document.getElementById('folder-modal-save')?.addEventListener('click',    saveFolderModal);
      document.getElementById('folder-name-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveFolderModal();
        if (e.key === 'Escape') closeFolderModal();
      });
    }

    // Remplir le sélecteur de parent
    const sel = document.getElementById('folder-parent-select');
    if (sel) {
      sel.innerHTML = '';
      function addOpts(items, depth) {
        for (const it of items) {
          if (it.type !== 'folder') continue;
          if (_folderEditingId && it.id === _folderEditingId) continue;
          const opt = document.createElement('option');
          opt.value = it.id;
          const prefix = depth === 0 ? (it.id === ROOT_BAR ? '⭐ ' : '📚 ') : '  '.repeat(depth) + '📁 ';
          opt.textContent = prefix + it.title;
          if (it.system) opt.style.fontWeight = '600';
          sel.appendChild(opt);
          if (it.children?.length) addOpts(it.children, depth + 1);
        }
      }
      addOpts(_bookmarks, 0);
      sel.value = ROOT_OTHER;
    }

    document.getElementById('folder-modal-title').textContent = existingItem ? 'Rename folder' : 'New folder';
    document.getElementById('folder-modal-save').textContent  = existingItem ? 'Rename' : 'Create';
    const input = document.getElementById('folder-name-input');
    input.value = existingItem?.title || '';
    if (existingItem) {
      // Cacher le parent pour le renommage
      const parentRow = document.getElementById('folder-parent-select')?.closest('label');
      if (parentRow) parentRow.style.display = 'none';
    } else {
      const parentRow = document.getElementById('folder-parent-select')?.closest('label');
      if (parentRow) parentRow.style.display = '';
    }
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
      const parentId = document.getElementById('folder-parent-select')?.value || ROOT_OTHER;
      const newFolder = { id: uid(), title: name, type: 'folder', system: false, open: false, children: [] };
      insertIntoFolder(_bookmarks, parentId, newFolder);
      showToast('Folder created', 'success');
    }

    persist(); render();
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
    const item = findById(_bookmarks, id);
    if (item?.system) { showToast('Cannot delete system folder', 'error'); return; }
    _bookmarks = removeById(_bookmarks, id);
    persist(); render(); renderToolbar();
    showToast('Deleted', 'info');
  }

  /* ══════════════════════════════════════════════════════════
     ÉTOILE
  ══════════════════════════════════════════════════════════ */
  function isBookmarked(url) {
    return flatAll(_bookmarks).some(b => b.type === 'bookmark' && b.url === url);
  }

  function updateStarBtn(url) {
    const btn = document.getElementById('bookmark-star-btn');
    if (!btn) return;
    const marked = isBookmarked(url);
    btn.classList.toggle('bookmarked', marked);
    btn.title = marked ? 'Edit / Remove bookmark' : 'Add to bookmarks';
    const svg = document.getElementById('star-icon') || btn.querySelector('svg');
    if (svg) {
      svg.innerHTML = marked
        ? `<path d="M8 1l1.85 3.75 4.15.6-3 2.9.7 4.1L8 10.25 4.3 12.35l.7-4.1L2 5.35l4.15-.6L8 1z" fill="var(--accent)" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>`
        : `<path d="M8 1l1.85 3.75 4.15.6-3 2.9.7 4.1L8 10.25 4.3 12.35l.7-4.1L2 5.35l4.15-.6L8 1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`;
    }
  }

  /* ══════════════════════════════════════════════════════════
     DRAG & DROP — with before/after indicator
  ══════════════════════════════════════════════════════════ */
  let _dragId = null;
  let _dropIndicator = null;

  function getOrCreateIndicator() {
    if (!_dropIndicator) {
      _dropIndicator = document.createElement('div');
      _dropIndicator.style.cssText = 'height:2px;background:var(--accent);border-radius:2px;margin:0 8px;pointer-events:none;transition:opacity .1s';
      _dropIndicator.id = 'bm-drop-indicator';
    }
    return _dropIndicator;
  }

  function hideIndicator() {
    document.getElementById('bm-drop-indicator')?.remove();
  }

  function setupDrag(el, item) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      _dragId = item.id;
      e.dataTransfer.effectAllowed = 'move';
      el.style.opacity = '.45';
    });
    el.addEventListener('dragend', () => {
      el.style.opacity = '';
      hideIndicator();
      _dragId = null;
    });
  }

  function setupDropZone(el, item) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!_dragId || _dragId === item.id) return;
      const rect   = el.getBoundingClientRect();
      const isTop  = e.clientY < rect.top + rect.height / 2;
      const ind    = getOrCreateIndicator();

      if (item.type === 'folder' && !isTop) {
        // Drop INTO folder
        hideIndicator();
        el.style.outline = '1.5px solid var(--accent)';
        el.dataset.dropMode = 'into';
      } else {
        el.style.outline = '';
        el.dataset.dropMode = isTop ? 'before' : 'after';
        // Insert indicator
        if (isTop) el.parentNode?.insertBefore(ind, el);
        else el.parentNode?.insertBefore(ind, el.nextSibling);
      }
    });

    el.addEventListener('dragleave', () => {
      el.style.outline = '';
      delete el.dataset.dropMode;
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.style.outline = '';
      const mode = el.dataset.dropMode || 'after';
      delete el.dataset.dropMode;
      hideIndicator();
      if (!_dragId || _dragId === item.id) return;
      moveItem(_dragId, item.id, mode);
    });
  }

  function moveItem(fromId, toId, mode = 'after') {
    // Empêcher de déplacer une racine système
    const fromItem = findById(_bookmarks, fromId);
    if (fromItem?.system) return;
    // Empêcher de déplacer dans ses propres enfants
    if (fromItem?.type === 'folder') {
      if (findById(fromItem.children || [], toId)) return;
    }

    let moved = null;
    function extract(items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].id === fromId) { moved = { ...items[i] }; items.splice(i, 1); return true; }
        if (items[i].children && extract(items[i].children)) return true;
      }
    }
    extract(_bookmarks);
    if (!moved) return;

    if (mode === 'into') {
      // Insérer dans le dossier cible
      insertIntoFolder(_bookmarks, toId, moved);
    } else {
      // Insérer before ou after toId
      function insertRelative(items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].id === toId) {
            const pos = mode === 'before' ? i : i + 1;
            items.splice(pos, 0, moved);
            return true;
          }
          if (items[i].children && insertRelative(items[i].children)) return true;
        }
        return false;
      }
      if (!insertRelative(_bookmarks)) _bookmarks.push(moved);
    }

    persist(); render(); renderToolbar();
  }

  /* ══════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════ */
  function init() {
    load();

    document.getElementById('bookmarks-search')?.addEventListener('input', (e) => {
      _filterText = e.target.value;
      render();
    });

    document.getElementById('add-bookmark-btn')?.addEventListener('click', () => openAddModal());
    document.getElementById('add-folder-btn')?.addEventListener('click',   () => openFolderModal());

    document.getElementById('bookmark-modal-save')?.addEventListener('click',   saveFromModal);
    document.getElementById('bookmark-modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('bookmark-modal-close')?.addEventListener('click',  closeModal);
    document.querySelector('.modal-overlay')?.addEventListener('click', closeModal);
    document.getElementById('bm-name-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveFromModal();
      if (e.key === 'Escape') closeModal();
    });

    window.discowlAPI.favorites.onUpdated((data) => {
      _bookmarks = ensureRoots(Array.isArray(data) ? data : []);
      render();
      renderToolbar();
    });
  }

  return {
    init, load, render, renderToolbar,
    openAddModal, openStarPopup, closeStarPopup,
    isBookmarked, updateStarBtn,
    getAll: () => _bookmarks
  };

})();

window.addEventListener('DOMContentLoaded', () => BookmarksManager.init());
window.BookmarksManager = BookmarksManager;