/* ─── components/settings.js ────────────────────────────────────
   Settings panel — all categories fully wired to discowlAPI.
─────────────────────────────────────────────────────────────── */

'use strict';

const SettingsManager = (() => {

  let _settings = {};

  const ENGINES = {
    duckduckgo: { name: 'DuckDuckGo',  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="16" height="16"><circle cx="64" cy="64" r="64" fill="#de5833"/><ellipse cx="64" cy="54" rx="28" ry="32" fill="#fff"/><circle cx="54" cy="46" r="5" fill="#3d3d3d"/><circle cx="56" cy="45" r="2" fill="#fff"/><path d="M50 66 Q64 76 78 66" stroke="#de5833" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="64" cy="96" rx="18" ry="10" fill="#4c9a2a"/><path d="M46 90 Q64 106 82 90" fill="#4c9a2a"/></svg>` },
    google:     { name: 'Google',      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>` },
    bing:       { name: 'Bing',        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M5 2v14.7l4.2 2.4 8.3-4.8-4.2-1.5V5.3L5 2z" fill="#00809d"/><path d="M9.2 19.1V11l8.3 3-4.1 2.3-4.2-1.5v2.8l4.2 2.4 4.6-2.7-8.8-8.5v10z" fill="#008373"/></svg>` },
    brave:      { name: 'Brave Search',svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M19.7 7.3L21 5.5l-1.4-.6-1 1.4c-.4-.3-.9-.6-1.4-.8l.3-1.7-1.5-.3-.4 1.7c-.5-.1-1-.1-1.6-.1s-1.1 0-1.6.1L13 3.5l-1.5.3.3 1.7c-.5.2-1 .5-1.4.8L9.4 4.9 8 5.5l1.3 1.8c-.4.4-.8.9-1.1 1.4l-1.7-.5-.5 1.4 1.6.7c-.2.5-.3 1.1-.4 1.7l-1.7.1v1.5l1.7.1c.1.6.2 1.2.4 1.7l-1.6.7.5 1.4 1.7-.5c.3.5.7 1 1.1 1.4L8 21.5l1.4.6 1-1.4c.4.3.9.6 1.4.8l-.3 1.7 1.5.3.4-1.7c.5.1 1 .1 1.6.1s1.1 0 1.6-.1l.4 1.7 1.5-.3-.3-1.7c.5-.2 1-.5 1.4-.8l1 1.4 1.4-.6-1.3-1.8c.4-.4.8-.9 1.1-1.4l1.7.5.5-1.4-1.6-.7c.2-.5.3-1.1.4-1.7l1.7-.1v-1.5l-1.7-.1c-.1-.6-.2-1.2-.4-1.7l1.6-.7-.5-1.4-1.7.5c-.3-.5-.7-1-1.1-1.4zM12 17.5c-3 0-5.5-2.5-5.5-5.5S9 6.5 12 6.5s5.5 2.5 5.5 5.5-2.5 5.5-5.5 5.5z" fill="#fb542b"/><circle cx="12" cy="12" r="3" fill="#fb542b"/></svg>` },
    ecosia:     { name: 'Ecosia',      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="11" fill="#4a9b3f"/><path d="M12 4C7.6 4 4 7.6 4 12s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm3.5 11.5c-.8.8-2 1.3-3.5 1.3-1.4 0-2.6-.5-3.5-1.3-.9-.9-1.5-2.1-1.5-3.5 0-1.4.5-2.6 1.4-3.5h5.7c.3.3.5.6.7 1H9.6c-.5.6-.8 1.5-.8 2.4h7.5c0 .1-.1.3-.1.4 0 .8-.3 1.6-.7 2.2h-5.6c.4.5 1 .9 1.7 1.1 1.5.4 3.1-.1 4.1-1.1l1.1 1.1c-.4.4-.8.7-1.3.9z" fill="#fff"/></svg>` }
  };

  /* ── Load & Save ───────────────────────────────────────────── */
  async function load() {
    _settings = await window.discowlAPI.settings.get();
    buildAllSections();
  }

  async function save(updates) {
    _settings = { ..._settings, ...updates };
    await window.discowlAPI.settings.save(_settings);
    showToast('Settings saved', 'success');
    // Notify renderer of setting change
    if (window.DiscowlBrowser) window.DiscowlBrowser.onSettingsChanged(_settings);
  }

  /* ── Build UI ──────────────────────────────────────────────── */
  function buildAllSections() {
    buildGeneral();
    buildAppearance();
    buildSearch();
    buildPrivacy();
    buildNetwork();
    buildTor();
  }

  /* ── Toggle helper ─────────────────────────────────────────── */
  function makeToggle(id, checked, onChange) {
    const label = document.createElement('label');
    label.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    label.appendChild(input);
    label.appendChild(slider);
    return label;
  }

  function makeRow(label, desc, control) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const left = document.createElement('div');
    left.className = 'settings-row-left';
    const lbl = document.createElement('div');
    lbl.className = 'settings-row-label';
    if (label instanceof HTMLElement) lbl.appendChild(label);
    else lbl.textContent = label;
    left.appendChild(lbl);
    if (desc) {
      const d = document.createElement('div');
      d.className = 'settings-row-desc';
      d.textContent = desc;
      left.appendChild(d);
    }
    row.appendChild(left);
    if (control) row.appendChild(control);
    return row;
  }

  function makeGroup(title, rows) {
    const g = document.createElement('div');
    g.className = 'settings-group';
    const h = document.createElement('div');
    h.className = 'settings-group-title';
    h.textContent = title;
    g.appendChild(h);
    rows.forEach(r => g.appendChild(r));
    return g;
  }

  function makeSelect(options, value, onChange) {
    const sel = document.createElement('select');
    sel.className = 'form-select';
    for (const [val, label] of Object.entries(options)) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (val === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  // Sélecteur custom avec logos SVG (pour les moteurs de recherche)
  function makeEngineSelect(currentKey, onChange) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;display:inline-block;';

    const btn = document.createElement('button');
    btn.className = 'settings-engine-select';
    btn.type = 'button';

    // Dropdown injecté dans body une seule fois pour éviter le clipping
    const dropdown = document.createElement('div');
    dropdown.className = 'settings-engine-dropdown hidden';
    dropdown.style.position = 'fixed';
    document.body.appendChild(dropdown);

    function updateBtn(key) {
      const e = ENGINES[key];
      if (!e) return;
      btn.innerHTML = `<span class="engine-logo">${e.svg}</span><span>${e.name}</span><svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="margin-left:4px;opacity:.5"><path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    }
    updateBtn(currentKey);

    for (const [key, eng] of Object.entries(ENGINES)) {
      const item = document.createElement('div');
      item.className = 'settings-engine-option' + (key === currentKey ? ' active' : '');
      item.innerHTML = `<span class="engine-logo">${eng.svg}</span><span>${eng.name}</span>`;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.add('hidden');
        dropdown.querySelectorAll('.settings-engine-option').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        updateBtn(key);
        onChange(key);
      });
      dropdown.appendChild(item);
    }

    function openDropdown() {
      // Fermer tous les autres
      document.querySelectorAll('.settings-engine-dropdown').forEach(d => {
        if (d !== dropdown) d.classList.add('hidden');
      });
      const rect = btn.getBoundingClientRect();
      dropdown.style.top      = (rect.bottom + 4) + 'px';
      dropdown.style.left     = rect.left + 'px';
      dropdown.style.minWidth = rect.width + 'px';
      dropdown.classList.remove('hidden');
    }

    function closeDropdown() {
      dropdown.classList.add('hidden');
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.classList.contains('hidden')) {
        openDropdown();
        setTimeout(() => {
          document.addEventListener('click', closeDropdown, { once: true });
        }, 0);
      } else {
        closeDropdown();
      }
    });

    // Nettoyer le dropdown si le panel est fermé
    const observer = new MutationObserver(() => {
      if (!document.body.contains(btn)) {
        dropdown.remove();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    wrapper.appendChild(btn);
    return wrapper;
  }

  function makeInput(placeholder, value, onChange) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'form-input-text';
    inp.placeholder = placeholder;
    inp.value = value || '';
    inp.style.cssText = '-webkit-user-select:text;user-select:text;width:220px;';
    inp.addEventListener('change', () => onChange(inp.value));
    return inp;
  }

  function makeButton(text, cls, onClick) {
    const btn = document.createElement('button');
    btn.className = `settings-btn ${cls}`;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /* ── General ───────────────────────────────────────────────── */
  async function buildGeneral() {
    const sec = document.getElementById('settings-general');
    if (!sec) return;
    sec.innerHTML = '';

    const homeInput = makeInput('https://...', _settings.homePage, v => save({ homePage: v }));

    sec.appendChild(makeGroup('Navigation', [
      makeRow("Home page", 'Loaded on startup and with the Home button', homeInput),
      makeRow("Show bookmarks bar", "Always visible below the navigation bar",
        makeToggle('toggle-bm-toolbar', _settings.showBookmarksToolbar, v => {
          save({ showBookmarksToolbar: v });
          document.getElementById('bookmarks-toolbar').style.display = v ? 'flex' : 'none';
        })
      )
    ]));

    // ── Donnees persistantes (APPDATA) ──────────────────────────
    let dataPath = { folder: 'chargement...', bookmarks: '', history: '', settings: '' };
    try { dataPath = await window.discowlAPI.storage.getDataPath(); } catch(e) {}

    const pathContainer = document.createElement('div');
    pathContainer.style.cssText = 'padding:14px 20px 16px;display:flex;flex-direction:column;gap:10px';

    const makePathLine = (label, value) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:600';
      lbl.textContent = label;
      const val = document.createElement('span');
      val.style.cssText = 'font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);word-break:break-all;line-height:1.5;background:var(--bg-base);padding:4px 8px;border-radius:4px;border:1px solid var(--border)';
      val.textContent = value || '—';
      wrap.appendChild(lbl);
      wrap.appendChild(val);
      return wrap;
    };

    pathContainer.appendChild(makePathLine('Data folder', dataPath.folder));
    pathContainer.appendChild(makePathLine('Bookmarks (favorites.json)', dataPath.favorites));
    pathContainer.appendChild(makePathLine('History (history.json)', dataPath.history));
    pathContainer.appendChild(makePathLine('Settings (settings.json)', dataPath.settings));

    const openBtn = makeButton('📂 Open folder', 'settings-btn-secondary', () => {
      window.discowlAPI.shell.openPath(dataPath.folder);
    });
    openBtn.style.marginTop = '6px';
    openBtn.style.alignSelf = 'flex-start';
    pathContainer.appendChild(openBtn);

    const dataGroup = makeGroup('Persistent data (AppData)', [
      makeRow('Location', 'Your bookmarks, history and settings are saved here', null)
    ]);
    dataGroup.appendChild(pathContainer);
    sec.appendChild(dataGroup);

    // Lire la version réelle depuis l'API
    window.discowlAPI.app.getVersion().then(v => {
      const vEl = document.getElementById('settings-version-label');
      if (vEl) vEl.textContent = v || '1.0.6';
    }).catch(() => {});

    sec.appendChild(makeGroup('Application', [
      makeRow('Version', null, (() => {
        const span = document.createElement('span');
        span.id = 'settings-version-label';
        span.style.cssText = 'color:var(--text-muted);font-size:12px;font-family:var(--font-mono)';
        span.textContent = '…';
        return span;
      })()),
      makeRow('Updates', 'Check for a newer version of Discowl',
        makeButton('Check now', 'settings-btn-secondary', async () => {
          if (window.discowlAPI.updates) {
            showToast('Checking for updates…', 'info');
            await window.discowlAPI.updates.check();
          } else {
            showToast('Updates only available in packaged app', 'info');
          }
        })
      ),
      makeRow("Clear cache", "Frees up disk space",
        makeButton('Clear', 'settings-btn-secondary', () => {
          showToast("Restart the app to clear the cache", 'info');
        })
      )
    ]));
  }


  /* ── Appearance ────────────────────────────────────────────── */
  function buildAppearance() {
    const sec = document.getElementById('settings-appearance');
    if (!sec) return;
    sec.innerHTML = '';

    sec.appendChild(makeGroup('Theme', [
      makeRow('Interface theme', 'Applied instantly to the entire browser',
        makeSelect({ dark: 'Dark', light: 'Light' }, _settings.theme, v => {
          save({ theme: v });
          // Appliquer immediatement via le renderer
          if (window.DiscowlBrowser?.setTheme) {
            window.DiscowlBrowser.setTheme(v);
          } else {
            document.documentElement.setAttribute('data-theme', v);
          }
        })
      )
    ]));

    sec.appendChild(makeGroup('Text', [
      makeRow('Base font size', 'Affects web pages',
        makeSelect({ '12': '12px', '14': '14px', '16': '16px', '18': '18px', '20': '20px' },
          String(_settings.fontSize),
          v => save({ fontSize: parseInt(v) })
        )
      )
    ]));
  }

  /* ── Search ────────────────────────────────────────────────── */
  function buildSearch() {
    const sec = document.getElementById('settings-search');
    if (!sec) return;
    sec.innerHTML = '';

    sec.appendChild(makeGroup('Default search engine', [
      makeRow('Default engine', 'Used when searching from the address bar',
        makeEngineSelect(_settings.defaultEngine, v => {
          save({ defaultEngine: v });
          if (window.DiscowlBrowser) window.DiscowlBrowser.setEngine(v);
        })
      )
    ]));

    sec.appendChild(makeGroup('Available engines', [
      ...Object.entries(ENGINES).map(([k, v]) => {
        const labelEl = document.createElement('span');
        labelEl.style.cssText = 'display:flex;align-items:center;gap:8px;';
        labelEl.innerHTML = `${v.svg}<span>${v.name}</span>`;
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:11px;padding:2px 7px;border-radius:4px;background:var(--bg-input);color:var(--text-muted)';
        badge.textContent = k === _settings.defaultEngine ? '✓ default' : '';
        return makeRow(labelEl, null, badge);
      })
    ]));
  }

  /* ── Privacy ───────────────────────────────────────────────── */
  function buildPrivacy() {
    const sec = document.getElementById('settings-privacy');
    if (!sec) return;
    sec.innerHTML = '';

    sec.appendChild(makeGroup('Tracking & cookies', [
      makeRow('Do Not Track (DNT)', 'Sends the DNT header to websites',
        makeToggle('toggle-dnt', _settings.doNotTrack, v => save({ doNotTrack: v }))
      ),
      makeRow('Keep cookies', 'Disabling clears cookies between sessions',
        makeToggle('toggle-cookies', _settings.saveCookies, v => save({ saveCookies: v }))
      )
    ]));

    sec.appendChild(makeGroup('Browsing data', [
      makeRow('Clear history', 'Permanently deletes all history',
        makeButton('Clear now', 'settings-btn-danger', async () => {
          if (confirm('Clear all browsing history?')) {
            await window.discowlAPI.history.clear();
            showToast('History cleared', 'info');
          }
        })
      )
    ]));
  }

  /* ── Network ───────────────────────────────────────────────── */
  function buildNetwork() {
    const sec = document.getElementById('settings-network');
    if (!sec) return;
    sec.innerHTML = '';

    sec.appendChild(makeGroup('Proxy', [
      makeRow(
        'Proxy configuration',
        'By default, no proxy (direct connection)',
        (() => {
          const span = document.createElement('span');
          span.style.cssText = 'color:var(--text-muted);font-size:12px';
          span.textContent = _settings.torEnabled ? 'socks5://127.0.0.1:9050 (Tor)' : 'Direct';
          return span;
        })()
      )
    ]));
  }

  /* ── Tor ────────────────────────────────────────────────────── */
  function buildTor() {
    const sec = document.getElementById('settings-tor');
    if (!sec) return;
    sec.innerHTML = '';

    // Dot de statut
    const statusRow = document.createElement('div');
    statusRow.style.cssText = 'display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--border)';

    const dot = document.createElement('div');
    dot.className = 'tor-dot';
    dot.id = 'tor-dot';

    const statusLbl = document.createElement('span');
    statusLbl.id = 'tor-status-lbl';
    statusLbl.style.cssText = 'font-size:13px;color:var(--text-primary)';
    statusLbl.textContent = 'Checking...';

    statusRow.appendChild(dot);
    statusRow.appendChild(statusLbl);

    // Toggle "Activer au demarrage"
    const toggleRow = makeRow(
      'Enable Tor on startup',
      'Starts tor/tor/tor.exe on launch and routes traffic through socks5://127.0.0.1:9050',
      makeToggle('toggle-tor', _settings.torEnabled, v => {
        save({ torEnabled: v });
        refreshTorUI();
      })
    );

    // Bouton Redemarrer (visible seulement si Tor tourne)
    const restartBtn = makeButton('', 'settings-btn-primary', () => {
      window.discowlAPI.app.relaunch();
    });
    restartBtn.id = 'tor-restart-btn';
    restartBtn.style.cssText += ';margin:14px 20px 16px;display:none';

    const binRow = document.createElement('div');
    binRow.id = 'tor-bin-row';
    binRow.style.cssText = 'padding:10px 20px;font-size:11px;color:var(--text-muted);font-family:var(--font-mono);word-break:break-all;display:none;border-top:1px solid var(--border)';

    const group = document.createElement('div');
    group.className = 'settings-group';
    group.appendChild(statusRow);
    group.appendChild(toggleRow);
    group.appendChild(restartBtn);
    group.appendChild(binRow);
    sec.appendChild(group);

    refreshTorUI();
  }

  async function refreshTorUI() {
    const dot        = document.getElementById('tor-dot');
    const lbl        = document.getElementById('tor-status-lbl');
    const restartBtn = document.getElementById('tor-restart-btn');
    const binRow     = document.getElementById('tor-bin-row');
    if (!dot || !lbl) return;

    const status = await window.discowlAPI.tor.status();

    // Afficher le chemin du binaire
    if (binRow) {
      binRow.style.display = 'block';
      binRow.textContent = 'Binary: ' + status.binPath + (status.binExists ? ' ✓' : ' ✗ NOT FOUND');
      binRow.style.color = status.binExists ? 'var(--text-muted)' : 'var(--red)';
    }

    // Statut : proxyActive = le switch Chromium est actif (= au démarrage torEnabled=true)
    if (status.proxyActive && status.running) {
      dot.className = 'tor-dot active';
      lbl.textContent = 'Tor active — proxy: ' + status.proxyUrl;
    } else if (status.proxyActive && !status.running) {
      dot.className = 'tor-dot loading';
      lbl.textContent = 'Proxy configured — tor.exe starting…';
    } else {
      dot.className = 'tor-dot';
      lbl.textContent = 'Tor disabled — direct connection';
    }

    // Bouton Restart : visible dès que le toggle ne correspond pas à la config actuelle
    const toggleEl  = document.getElementById('toggle-tor');
    const shouldRun = toggleEl ? toggleEl.checked : _settings.torEnabled;
    // proxyActive reflète la config au dernier démarrage
    const needsRestart = shouldRun !== status.proxyActive;

    if (restartBtn) {
      restartBtn.style.display = needsRestart ? 'inline-flex' : 'none';
      restartBtn.textContent = shouldRun
        ? '↺ Restart to enable Tor'
        : '↺ Restart to disable Tor';
    }
  }



  /* ── Panel navigation ──────────────────────────────────────── */
  function initNavigation() {
    document.querySelectorAll('.settings-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        const sec = document.getElementById(`settings-${btn.dataset.section}`);
        if (sec) sec.classList.add('active');
      });
    });
  }

  /* ── Open / Close ──────────────────────────────────────────── */
  function open() {
    document.getElementById('settings-panel')?.classList.remove('hidden');
  }

  function close() {
    document.getElementById('settings-panel')?.classList.add('hidden');
  }

  /* ── Init ──────────────────────────────────────────────────── */
  function init() {
    load();
    initNavigation();

    document.getElementById('settings-close-btn')?.addEventListener('click', close);
  }

  return { init, load, open, close };

})();

window.addEventListener('DOMContentLoaded', () => SettingsManager.init());
window.SettingsManager = SettingsManager;