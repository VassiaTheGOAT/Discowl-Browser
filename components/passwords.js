'use strict';

/* ─── components/passwords.js ────────────────────────────────────
   Gestionnaire de la page "Saved passwords" (about:passwords)
   Affiche, copie, supprime les credentials sauvegardés.
   Si mot de passe maître actif → demande avant d'afficher.
─────────────────────────────────────────────────────────────── */
const PasswordsManager = (() => {

  let _entries    = [];   // [{id, host, username}]
  let _unlocked   = false;
  let _filterText = '';

  /* ── Ouvrir la page ────────────────────────────────────────── */
  async function open() {
    // Ouvrir comme onglet spécial (géré par renderer.js)
    window.DiscowlBrowser?.openPasswordsTab?.();
  }

  /* ── Initialisation ────────────────────────────────────────── */
  async function init() {
    const page = document.getElementById('passwords-page');
    if (!page) return;

    // Bouton fermer
    document.getElementById('passwords-page-close')?.addEventListener('click', () => {
      window.DiscowlBrowser?.closePasswordsTab?.();
    });

    // Recherche
    document.getElementById('passwords-search')?.addEventListener('input', (e) => {
      _filterText = e.target.value.toLowerCase().trim();
      renderRows();
    });

    // Eye toggle sur le champ master password
    document.getElementById('passwords-lock-eye')?.addEventListener('click', () => {
      const inp = document.getElementById('passwords-master-input');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    // Bouton unlock
    document.getElementById('passwords-lock-unlock')?.addEventListener('click', doUnlock);
    document.getElementById('passwords-master-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doUnlock();
    });
  }

  /* ── Afficher la page ──────────────────────────────────────── */
  async function show() {
    const page = document.getElementById('passwords-page');
    if (!page) return;
    page.classList.remove('hidden');

    // Vérifier si le vault est déverrouillé
    try {
      _unlocked = await window.discowlAPI.vault.isUnlocked();
    } catch { _unlocked = false; }

    if (_unlocked) {
      await loadEntries();
    } else {
      // Soit pas de mot de passe maître (unlock anonyme), soit verrouillé
      const pwEnabled = await window.discowlAPI.password.isEnabled().catch(() => false);
      if (!pwEnabled) {
        // Pas de mot de passe maître — on peut voir les mots de passe directement
        _unlocked = true;
        await loadEntries();
      } else {
        showLockPrompt();
      }
    }
  }

  function hide() {
    document.getElementById('passwords-page')?.classList.add('hidden');
    // Reset state
    _filterText = '';
    const inp = document.getElementById('passwords-search');
    if (inp) inp.value = '';
  }

  /* ── Lock prompt ───────────────────────────────────────────── */
  function showLockPrompt() {
    document.getElementById('passwords-lock-prompt')?.classList.remove('hidden');
    document.getElementById('passwords-empty')?.classList.add('hidden');
    document.getElementById('passwords-list')?.classList.add('hidden');
    const inp = document.getElementById('passwords-master-input');
    if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 80); }
  }

  async function doUnlock() {
    const inp = document.getElementById('passwords-master-input');
    const pwd = inp?.value || '';
    if (!pwd) return;

    const btn = document.getElementById('passwords-lock-unlock');
    const err = document.getElementById('passwords-lock-error');
    if (btn) { btn.textContent = i18n.t('pw.verifying'); btn.disabled = true; }
    if (err) err.textContent = '';

    try {
      const ok = await window.discowlAPI.vault.unlock(pwd);
      if (ok) {
        _unlocked = true;
        document.getElementById('passwords-lock-prompt')?.classList.add('hidden');
        if (inp) inp.value = '';
        await loadEntries();
      } else {
        if (err) err.textContent = i18n.t('pw.incorrect');
        if (inp) { inp.value = ''; inp.focus(); }
      }
    } catch(e) {
      if (err) err.textContent = i18n.t('pw.error_retry');
    } finally {
      if (btn) { btn.textContent = i18n.t('pw.unlock_btn'); btn.disabled = false; }
    }
  }

  /* ── Chargement des entrées ────────────────────────────────── */
  async function loadEntries() {
    try {
      _entries = await window.discowlAPI.vault.getAll();
    } catch { _entries = []; }
    renderRows();
  }

  /* ── Rendu tableau ─────────────────────────────────────────── */
  function renderRows() {
    const list  = document.getElementById('passwords-list');
    const empty = document.getElementById('passwords-empty');
    const rows  = document.getElementById('passwords-rows');
    if (!rows) return;

    const filtered = _filterText
      ? _entries.filter(e => e.host.toLowerCase().includes(_filterText) || e.username.toLowerCase().includes(_filterText))
      : _entries;

    rows.innerHTML = '';

    if (!filtered.length) {
      list?.classList.add('hidden');
      empty?.classList.remove('hidden');
      return;
    }

    list?.classList.remove('hidden');
    empty?.classList.add('hidden');

    filtered.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'passwords-row';
      row.dataset.id = entry.id;

      // Favicon + host
      const hostCell = document.createElement('div');
      hostCell.className = 'passwords-cell passwords-host-cell';
      const fav = document.createElement('img');
      fav.src = `https://www.google.com/s2/favicons?domain=${entry.host}&sz=16`;
      fav.style.cssText = 'width:16px;height:16px;flex-shrink:0;border-radius:3px';
      fav.onerror = () => fav.remove();
      const hostSpan = document.createElement('span');
      hostSpan.textContent = entry.host;
      hostSpan.className = 'passwords-host-label';
      hostCell.appendChild(fav);
      hostCell.appendChild(hostSpan);

      // Username + copy
      const userCell = document.createElement('div');
      userCell.className = 'passwords-cell';
      const userSpan = document.createElement('span');
      userSpan.textContent = entry.username || '—';
      userSpan.className = 'passwords-value-text';
      const copyUserBtn = makeCopyBtn(() => {
        navigator.clipboard.writeText(entry.username || '').then(() => showToast(i18n.t('toast.username_copied'), 'success'));
      });
      userCell.appendChild(userSpan);
      userCell.appendChild(copyUserBtn);

      // Password (masqué) + reveal + copy
      const pwCell = document.createElement('div');
      pwCell.className = 'passwords-cell';
      const pwSpan = document.createElement('span');
      pwSpan.textContent = '••••••••';
      pwSpan.className = 'passwords-value-text passwords-pw-dots';
      let _revealed = false;
      const eyeBtn = document.createElement('button');
      eyeBtn.className = 'passwords-icon-btn';
      eyeBtn.title = i18n.t('pw.show_hide');
      eyeBtn.innerHTML = EYE_ICON;
      eyeBtn.addEventListener('click', async () => {
        _revealed = !_revealed;
        if (_revealed) {
          const full = await window.discowlAPI.vault.getById(entry.id);
          pwSpan.textContent = full?.password || '(error)';
          pwSpan.classList.remove('passwords-pw-dots');
        } else {
          pwSpan.textContent = '••••••••';
          pwSpan.classList.add('passwords-pw-dots');
        }
      });
      const copyPwBtn = makeCopyBtn(async () => {
        const full = await window.discowlAPI.vault.getById(entry.id);
        navigator.clipboard.writeText(full?.password || '').then(() => showToast(i18n.t('toast.password_copied'), 'success'));
      });
      pwCell.appendChild(pwSpan);
      pwCell.appendChild(eyeBtn);
      pwCell.appendChild(copyPwBtn);

      // Actions : supprimer
      const actCell = document.createElement('div');
      actCell.className = 'passwords-cell passwords-actions-cell';
      const delBtn = document.createElement('button');
      delBtn.className = 'passwords-icon-btn passwords-delete-btn';
      delBtn.title = i18n.t('pw.delete_password');
      delBtn.innerHTML = TRASH_ICON;
      delBtn.addEventListener('click', async () => {
        if (!confirm(i18n.t('pw.delete_confirm').replace('{host}', entry.host))) return;
        await window.discowlAPI.vault.delete(entry.id);
        _entries = _entries.filter(e => e.id !== entry.id);
        renderRows();
        showToast(i18n.t('toast.password_deleted'), 'info');
      });
      actCell.appendChild(delBtn);

      row.appendChild(hostCell);
      row.appendChild(userCell);
      row.appendChild(pwCell);
      row.appendChild(actCell);
      rows.appendChild(row);
    });
  }

  /* ── Helpers ───────────────────────────────────────────────── */
  function makeCopyBtn(onClick) {
    const btn = document.createElement('button');
    btn.className = 'passwords-icon-btn';
    btn.title = i18n.t('pw.copy_tip');
    btn.innerHTML = COPY_ICON;
    btn.addEventListener('click', onClick);
    return btn;
  }

  const EYE_ICON = `<svg width="14" height="14" viewBox="0 0 15 15" fill="none"><path d="M1 7.5C1 7.5 3.5 3 7.5 3s6.5 4.5 6.5 4.5S12 12 7.5 12 1 7.5 1 7.5z" stroke="currentColor" stroke-width="1.3"/><circle cx="7.5" cy="7.5" r="2" stroke="currentColor" stroke-width="1.3"/></svg>`;
  const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4" y="4" width="8" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M2 10V3a1 1 0 011-1h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
  const TRASH_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 3.5h11M5 3.5V2h4v1.5M3 3.5l.7 8h6.6l.7-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  /* ── Init ──────────────────────────────────────────────────── */
  window.addEventListener('DOMContentLoaded', init);

  return { open, show, hide, loadEntries };
})();

window.PasswordsManager = PasswordsManager;