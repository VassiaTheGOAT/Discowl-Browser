/* ─── components/settings.js ────────────────────────────────────
   Settings panel — all categories fully wired to discowlAPI.
─────────────────────────────────────────────────────────────── */

'use strict';

const SettingsManager = (() => {

  let _settings = {};

  const ENGINES = {
    duckduckgo: { label: 'DuckDuckGo', icon: '🦆' },
    google:     { label: 'Google',     icon: '🔍' },
    bing:       { label: 'Bing',       icon: '🔷' },
    brave:      { label: 'Brave Search', icon: '🦁' },
    ecosia:     { label: 'Ecosia',     icon: '🌱' }
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
    lbl.textContent = label;
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
      if (vEl) vEl.textContent = v || '1.0.0';
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

    sec.appendChild(makeGroup('Texte', [
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

    const engineOptions = {};
    for (const [k, v] of Object.entries(ENGINES)) engineOptions[k] = `${v.icon} ${v.label}`;

    sec.appendChild(makeGroup('Default search engine', [
      makeRow('Default engine', 'Used when searching from the address bar',
        makeSelect(engineOptions, _settings.defaultEngine, v => {
          save({ defaultEngine: v });
          if (window.DiscowlBrowser) window.DiscowlBrowser.setEngine(v);
        })
      )
    ]));

    sec.appendChild(makeGroup('Available engines', [
      ...Object.entries(ENGINES).map(([k, v]) => {
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:11px;padding:2px 7px;border-radius:4px;background:var(--bg-input);color:var(--text-muted)';
        badge.textContent = k === _settings.defaultEngine ? '✓ default' : '';
        return makeRow(`${v.icon} ${v.label}`, null, badge);
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