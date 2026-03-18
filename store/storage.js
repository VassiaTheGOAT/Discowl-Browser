'use strict';

const { app } = require('electron');
const fs   = require('fs');
const path = require('path');

class Storage {
  constructor() {
    this.userDataPath   = app.getPath('userData');
    this.favoritesPath  = path.join(this.userDataPath, 'favorites.json');   // <-- favorites.json
    this.historyPath    = path.join(this.userDataPath, 'history.json');
    this.settingsPath   = path.join(this.userDataPath, 'settings.json');
    this._ensureDir();
    this._initFiles();
  }

  /* ─── Helpers ──────────────────────────────────────────────── */

  _ensureDir() {
    try {
      fs.mkdirSync(this.userDataPath, { recursive: true });
      console.log('[Storage] Dossier de données :', this.userDataPath);
    } catch (e) {
      console.error('[Storage] Impossible de créer le dossier userData :', e.message);
    }
  }

  _read(filePath) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.warn('[Storage] Fichier corrompu — backup :', filePath);
        try { fs.renameSync(filePath, filePath + '.corrupted.' + Date.now()); } catch {}
      }
      return null;
    }
  }

  /**
   * Écriture atomique : .tmp → rename
   * Évite toute corruption en cas de crash pendant l'écriture.
   */
  _write(filePath, data) {
    try {
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, filePath);
    } catch (e) {
      console.error('[Storage] Erreur écriture :', filePath, e.message);
    }
  }

  _initFiles() {
    if (!fs.existsSync(this.favoritesPath)) {
      console.log('[Storage] Première utilisation — création de favorites.json');
      this._write(this.favoritesPath, this._defaultFavorites());
    } else {
      console.log('[Storage] favorites.json existant — chargement');
    }

    if (!fs.existsSync(this.historyPath)) {
      console.log('[Storage] Création de history.json');
      this._write(this.historyPath, []);
    } else {
      console.log('[Storage] history.json existant — chargement');
    }

    if (!fs.existsSync(this.settingsPath)) {
      this._write(this.settingsPath, this._defaultSettings());
    }
  }

  /* ─── Données par défaut ───────────────────────────────────── */

  _defaultFavorites() {
    return {
      /*
       * Structure :
       *   toolbar  : favoris affichés dans la barre personnelle (toolbar:true)
       *   bookmarks: arborescence complète (inclut les items toolbar)
       *
       * Format d'un item :
       *   { id, title, url, type: "bookmark"|"folder", toolbar: bool, children: [] }
       */
      bookmarks: [
        { id: 'bm-1', title: 'Google',      url: 'https://www.google.com',       type: 'bookmark', toolbar: true,  children: [] },
        { id: 'bm-2', title: 'DuckDuckGo',  url: 'https://duckduckgo.com',        type: 'bookmark', toolbar: true,  children: [] },
        { id: 'bm-3', title: 'GitHub',      url: 'https://github.com',            type: 'bookmark', toolbar: false, children: [] },
        { id: 'bm-4', title: 'MDN Web Docs',url: 'https://developer.mozilla.org', type: 'bookmark', toolbar: false, children: [] },
        {
          id: 'folder-1',
          title: 'Développement',
          type: 'folder',
          toolbar: false,
          children: [
            { id: 'bm-5', title: 'Stack Overflow', url: 'https://stackoverflow.com', type: 'bookmark', toolbar: false, children: [] },
            { id: 'bm-6', title: 'NPM',            url: 'https://npmjs.com',          type: 'bookmark', toolbar: false, children: [] },
            { id: 'bm-7', title: 'Can I Use',      url: 'https://caniuse.com',        type: 'bookmark', toolbar: false, children: [] }
          ]
        }
      ]
    };
  }

  _defaultSettings() {
    return {
      defaultEngine:        'duckduckgo',
      theme:                'dark',
      torEnabled:           false,
      homePage:             'https://duckduckgo.com',
      newTabPage:           'about:newtab',
      downloadPath:         '',
      language:             'fr',
      fontSize:             16,
      showBookmarksToolbar: true,
      blockAds:             false,
      doNotTrack:           true,
      saveCookies:          true,
      blockThirdPartyCookies: false,
      blockYoutubeAds:       false,
      customTitlebar:       false,
      // Privacy
      blockTrackers:        true,
      httpsUpgrade:         true,
      strictReferrer:       true,
      blockWebRTC:          false,
      clearOnExit:          false,
      doh:                  true,
      blockFingerprinting:  false,
      toolbarItems: [
        { id: 'back',       visible: true  },
        { id: 'forward',    visible: true  },
        { id: 'reload',     visible: true  },
        { id: 'home',       visible: true  },
        { id: 'bookmarks',  visible: true  },
        { id: 'history',    visible: true  },
        { id: 'downloads',  visible: true  },
        { id: 'zoom',       visible: true  }
      ]
    };
  }

  /* ─── Chemins exposés à l'UI ───────────────────────────────── */

  getDataPath() {
    return {
      folder:    this.userDataPath,
      favorites: this.favoritesPath,
      history:   this.historyPath,
      settings:  this.settingsPath
    };
  }

  /* ─── Favoris ──────────────────────────────────────────────── */

  getFavorites() {
    const data = this._read(this.favoritesPath);
    if (data && Array.isArray(data.bookmarks)) return data.bookmarks;
    // Compatibilité ancien format (tableau direct)
    if (Array.isArray(data)) return data;
    return this._defaultFavorites().bookmarks;
  }

  saveFavorites(bookmarks) {
    this._write(this.favoritesPath, { bookmarks });
  }

  /* ─── Historique ───────────────────────────────────────────── */

  getHistory() { return this._read(this.historyPath) || []; }

  addHistory(entry) {
    const history = this.getHistory();
    // Dédoublonnage : même URL dans les 30 dernières secondes
    const recent = history.find(h => h.url === entry.url && (Date.now() - h.timestamp) < 30000);
    if (recent) return;
    history.unshift({
      ...entry,
      id:        `h-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: Date.now()
    });
    if (history.length > 2000) history.splice(2000);
    this._write(this.historyPath, history);
  }

  clearHistory()    { this._write(this.historyPath, []); }

  deleteHistory(id) {
    const history = this.getHistory().filter(h => h.id !== id);
    this._write(this.historyPath, history);
  }

  /* ─── Paramètres ───────────────────────────────────────────── */

  getSettings()      { return { ...this._defaultSettings(), ...(this._read(this.settingsPath) || {}) }; }
  saveSettings(data) { this._write(this.settingsPath, { ...this.getSettings(), ...data }); }
}

module.exports = Storage;