'use strict';

/**
 * adBlockEngine.js — main/adBlockEngine.js
 *
 * Moteur de blocage réseau production-grade.
 *
 * Architecture :
 *   ┌──────────────────────────────────────────────────────┐
 *   │  FilterList (EasyList, EasyPrivacy, custom)          │
 *   │      ↓ parse()                                       │
 *   │  RuleSet { domains: Map, keywords: Map, regex: [] }  │
 *   │      ↓ match(url, type, firstParty)                  │
 *   │  Decision { blocked: bool, rule: string }            │
 *   │      ↓                                               │
 *   │  session.webRequest.onBeforeRequest → cancel: true   │
 *   └──────────────────────────────────────────────────────┘
 *
 * Performance :
 *   - Lookup domaine exact : Map O(1)
 *   - Lookup keyword       : Map<keyword → rules[]>, O(n règles du keyword)
 *   - Regex                : uniquement en dernier recours (< 5% des règles)
 *   - Pas de regex pour les règles de domaine simple
 *
 * Format de règles supporté (sous-ensemble d'Adblock Plus) :
 *   ||example.com^          → bloquer tout sous-domaine
 *   ||example.com/path      → bloquer chemin spécifique
 *   @@||example.com^        → exception (ne pas bloquer)
 *   example.com##.ad-class  → CSS cosmetic (géré dans adBlockDOM.js)
 *   /regex/                 → règle regex
 *   ! commentaire           → ignoré
 */

const fs   = require('fs');
const path = require('path');
const https= require('https');
const { app } = require('electron');

/* ══════════════════════════════════════════════════════════════
   CONSTANTES
══════════════════════════════════════════════════════════════ */

// Listes de filtres à télécharger
const FILTER_LISTS = [
  {
    name:    'easylist',
    url:     'https://easylist.to/easylist/easylist.txt',
    enabled: true,
  },
  {
    name:    'easyprivacy',
    url:     'https://easylist.to/easylist/easyprivacy.txt',
    enabled: true,
  },
  {
    name:    'peter-lowe',       // Domaines pub + malware
    url:     'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0',
    enabled: true,
  },
  {
    name:    'ublock-filters',
    url:     'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
    enabled: true,
  },
];

// Mise à jour toutes les 24h
const UPDATE_INTERVAL_MS = 24 * 3600 * 1000;

// Dossier de cache local
const CACHE_DIR = () => path.join(app.getPath('userData'), 'adblock-cache');

/* ══════════════════════════════════════════════════════════════
   STRUCTURES DE DONNÉES
══════════════════════════════════════════════════════════════ */

/**
 * RuleSet — index rapide pour le matching
 *
 * domains    : Map<domaine → {block:bool, rule:str}[]>
 *              ex: "doubleclick.net" → [{ block: true, rule: "||doubleclick.net^" }]
 *
 * keywords   : Map<keyword → Rule[]>
 *              Les 5-8 premiers chars d'un chemin URL commun dans les règles
 *
 * exceptions : Map<domaine → true>
 *              Règles @@ — ne jamais bloquer
 *
 * cosmetic   : Map<domaine → selector[]>
 *              Règles CSS ##
 *
 * regexRules : Rule[]
 *              Règles /regex/ — évaluées en dernier
 */
class RuleSet {
  constructor() {
    this.domains    = new Map();
    this.keywords   = new Map();
    this.exceptions = new Map();
    this.cosmetic   = new Map();
    this.regexRules = [];
    this.count      = 0;
  }

  addDomain(domain, block, rule) {
    const key = domain.toLowerCase();
    if (!this.domains.has(key)) this.domains.set(key, []);
    this.domains.get(key).push({ block, rule });
    this.count++;
  }

  addException(domain) {
    this.exceptions.set(domain.toLowerCase(), true);
  }

  addKeyword(kw, ruleObj) {
    const key = kw.toLowerCase();
    if (!this.keywords.has(key)) this.keywords.set(key, []);
    this.keywords.get(key).push(ruleObj);
  }

  addCosmetic(domain, selector) {
    const key = domain || '*';
    if (!this.cosmetic.has(key)) this.cosmetic.set(key, []);
    this.cosmetic.get(key).push(selector);
  }

  addRegex(regex, block, original) {
    this.regexRules.push({ regex, block, original });
    this.count++;
  }
}

/* ══════════════════════════════════════════════════════════════
   PARSER — FORMAT ADBLOCK PLUS
══════════════════════════════════════════════════════════════ */

/**
 * Parse une liste de règles au format Adblock Plus.
 * Retourne un RuleSet.
 */
function parseFilterList(text) {
  const rs   = new RuleSet();
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;

    // ── Règles cosmétiques (##, #@#) ─────────────────────────
    const cosmeticMatch = line.match(/^([^#]*)##(.+)$/);
    if (cosmeticMatch) {
      const domains  = cosmeticMatch[1].split(',').map(d => d.trim()).filter(Boolean);
      const selector = cosmeticMatch[2];
      if (domains.length === 0) {
        rs.addCosmetic('*', selector);
      } else {
        for (const d of domains) {
          rs.addCosmetic(d.replace(/^~/, ''), selector);
        }
      }
      continue;
    }

    // ── Exceptions (@@) ──────────────────────────────────────
    if (line.startsWith('@@')) {
      const inner = line.slice(2);
      const domain = extractDomain(inner);
      if (domain) rs.addException(domain);
      continue;
    }

    // ── Règles regex (/pattern/) ─────────────────────────────
    if (line.startsWith('/') && line.lastIndexOf('/') > 0) {
      const end    = line.lastIndexOf('/');
      const source = line.slice(1, end);
      const flags  = line.slice(end + 1).replace(/[^gi]/g, '');
      try {
        rs.addRegex(new RegExp(source, flags), true, line);
      } catch {} // Ignorer les regex invalides
      continue;
    }

    // ── Règles de domaine (||domain^) ────────────────────────
    // Format le plus courant — O(1) matching
    const domainRule = line.match(/^\|\|([a-zA-Z0-9._*-]+)\^?(\$.*)?$/);
    if (domainRule) {
      const domain = domainRule[1].toLowerCase();
      // Ignorer les options $script, $image, etc. pour l'instant
      // (gérées si présentes en option dans matchRequest)
      if (!domain.includes('*')) {
        rs.addDomain(domain, true, line);
      } else {
        // Wildcard → keyword matching
        const keyword = bestKeyword(domain);
        if (keyword) rs.addKeyword(keyword, { type: 'wildcard', pattern: domain, block: true, rule: line });
      }
      continue;
    }

    // ── Règles de chemin ─────────────────────────────────────
    // ex: /ads/, /banner/, /tracking/pixel
    if (line.includes('/') && !line.startsWith('|') && line.length > 5) {
      const keyword = bestKeyword(line);
      if (keyword && keyword.length >= 5) {
        rs.addKeyword(keyword, { type: 'path', pattern: line, block: true, rule: line });
      }
      continue;
    }

    // ── Règle générique (|http://..., etc.) ──────────────────
    if (line.startsWith('|')) {
      const inner  = line.slice(1).replace(/\|$/, '');
      const domain = extractDomain(inner);
      if (domain) rs.addDomain(domain, true, line);
    }
  }

  return rs;
}

/** Extrait le hostname d'une règle de filtre */
function extractDomain(rule) {
  let s = rule.replace(/^\|+/, '').replace(/\^.*$/, '').replace(/\*.*$/, '');
  s = s.replace(/^https?:\/\//, '').replace(/^\/\//, '');
  const slash = s.indexOf('/');
  if (slash >= 0) s = s.slice(0, slash);
  // Validation stricte :
  // - caractères autorisés uniquement
  // - au moins 2 segments séparés par un point (domaine.tld minimum)
  // - chaque segment non vide
  // - ne pas extraire des TLDs purs comme "com", "net", "io"
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) return null;
  const parts = s.toLowerCase().split('.');
  if (parts.length < 2) return null;
  if (parts.some(p => !p)) return null;
  if (parts.length === 1) return null; // TLD seul
  // Rejeter si c'est juste "tld" sans domaine (ex: "com", "net", "co.uk")
  const TLDS = new Set(['com','net','org','io','co','gov','edu','mil','int','eu','uk','de','fr','ru','cn','br','au','jp','in','it','es','nl','pl','ca','us']);
  if (parts.length === 2 && TLDS.has(parts[0]) && TLDS.has(parts[1])) return null;
  return s.toLowerCase();
}

/** Choisit le meilleur keyword (6+ chars, le moins courant possible) */
function bestKeyword(rule) {
  const COMMON = new Set([
    'http', 'https', 'www.', '.com', '.net', '.org', '.io',
    'ads.', 'ad.', '/ads', '/ad/', 'page', 'home', 'index',
    'script', 'style', 'image', 'img/', 'js/', 'css/',
  ]);
  let best = null;
  // Minimum 7 chars pour éviter les faux positifs sur des chemins courants
  for (let i = 0; i <= rule.length - 7; i++) {
    const kw = rule.slice(i, i + 7).toLowerCase();
    if (kw.includes('*') || kw.includes('|') || kw.includes('^')) continue;
    let tooCommon = false;
    for (const c of COMMON) { if (kw.includes(c)) { tooCommon = true; break; } }
    if (tooCommon) continue;
    if (!best || kw.replace(/[a-z.]/g, '').length > best.replace(/[a-z.]/g, '').length) {
      best = kw;
    }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════
   MATCHING ENGINE
══════════════════════════════════════════════════════════════ */

/**
 * Vérifie si une URL doit être bloquée.
 *
 * @param {RuleSet} rs
 * @param {string}  url          - URL complète de la requête
 * @param {string}  type         - 'script'|'image'|'stylesheet'|'xmlhttprequest'|...
 * @param {string}  pageUrl      - URL de la page parente (pour 1st/3rd party)
 * @returns {{ blocked: boolean, rule?: string }}
 */
function matchRequest(rs, url, type, pageUrl) {
  if (!url || !rs) return { blocked: false };

  let hostname = '';
  let pathname = '';
  try {
    const u = new URL(url);
    hostname = u.hostname.toLowerCase();
    pathname = u.pathname.toLowerCase();
  } catch {
    return { blocked: false };
  }

  // ── 1. Exception check (whitelist) ───────────────────────
  if (rs.exceptions.has(hostname)) return { blocked: false };
  // Vérifier les sous-domaines dans les exceptions
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const sub = parts.slice(i).join('.');
    if (rs.exceptions.has(sub)) return { blocked: false };
  }

  // ── 2. Domaine exact + sous-domaines ─────────────────────
  // ex: hostname = "ad.doubleclick.net"
  // vérifie: "ad.doubleclick.net", "doubleclick.net"
  // NE vérifie PAS "net" seul (TLD) — évite de bloquer tous les .net/.com
  const domainParts = hostname.split('.');
  for (let i = 0; i < domainParts.length - 1; i++) {
    const check = domainParts.slice(i).join('.');
    // Ignorer les TLDs purs (1 seul segment) ou les ccTLD+TLD (co.uk, etc.)
    // Un vrai domaine ad a au moins 2 segments (domaine.tld)
    if (check.split('.').length < 2) continue;
    const rules = rs.domains.get(check);
    if (rules) {
      for (const r of rules) {
        if (r.block) return { blocked: true, rule: r.rule };
      }
    }
  }

  // ── 3. Keyword matching sur le chemin URL ─────────────────
  // Guard : seulement si l'URL est clairement une ressource tierce
  // (évite les faux positifs sur les ressources de la page elle-même)
  const fullUrl = hostname + pathname;
  const isFirstParty = pageUrl && (() => {
    try {
      const p = new URL(pageUrl);
      return p.hostname === hostname || hostname.endsWith('.' + p.hostname) || p.hostname.endsWith('.' + hostname);
    } catch { return false; }
  })();

  if (!isFirstParty) {
    for (const [kw, kwRules] of rs.keywords) {
      if (fullUrl.includes(kw)) {
        for (const r of kwRules) {
          if (matchPattern(url, r.pattern) && r.block) {
            return { blocked: true, rule: r.rule };
          }
        }
      }
    }
  }

  // ── 4. Regex (dernier recours) ────────────────────────────
  for (const r of rs.regexRules) {
    if (r.regex.test(url)) {
      return { blocked: r.block, rule: r.original };
    }
  }

  return { blocked: false };
}

/** Correspondance de pattern avec wildcards */
function matchPattern(url, pattern) {
  if (!pattern.includes('*') && !pattern.includes('|')) {
    return url.includes(pattern);
  }
  // Convertir en regex simple
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/^\|\|/, '')
    .replace(/\^/g, '[/?#]?');
  try {
    return new RegExp(escaped).test(url);
  } catch {
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════
   GESTION DES FILTER LISTS (cache + mise à jour)
══════════════════════════════════════════════════════════════ */

async function ensureCacheDir() {
  const dir = CACHE_DIR();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getCachePath(name) {
  return path.join(CACHE_DIR(), `${name}.txt`);
}

function getMetaPath(name) {
  return path.join(CACHE_DIR(), `${name}.meta.json`);
}

function readMeta(name) {
  try { return JSON.parse(fs.readFileSync(getMetaPath(name), 'utf8')); }
  catch { return null; }
}

function writeMeta(name, data) {
  fs.writeFileSync(getMetaPath(name), JSON.stringify(data));
}

async function downloadList(list) {
  return new Promise((resolve, reject) => {
    const req = https.get(list.url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
  });
}

async function loadOrUpdateList(list, forceUpdate = false) {
  await ensureCacheDir();
  const cachePath = getCachePath(list.name);
  const meta      = readMeta(list.name);
  const now       = Date.now();
  const needsUpdate = forceUpdate ||
    !meta ||
    !fs.existsSync(cachePath) ||
    (now - (meta.updatedAt || 0)) > UPDATE_INTERVAL_MS;

  if (!needsUpdate) {
    // Utiliser le cache
    try {
      return fs.readFileSync(cachePath, 'utf8');
    } catch {}
  }

  // Télécharger
  try {
    console.log(`[AdBlock] Téléchargement ${list.name}...`);
    const text = await downloadList(list);
    fs.writeFileSync(cachePath, text, 'utf8');
    writeMeta(list.name, { updatedAt: now, url: list.url });
    console.log(`[AdBlock] ${list.name} mis à jour (${(text.length / 1024).toFixed(0)} KB)`);
    return text;
  } catch (e) {
    console.warn(`[AdBlock] Échec téléchargement ${list.name}:`, e.message);
    // Fallback sur le cache si disponible
    if (fs.existsSync(cachePath)) {
      return fs.readFileSync(cachePath, 'utf8');
    }
    return '';
  }
}

/* ══════════════════════════════════════════════════════════════
   RULES PERSONNALISÉES
   Stockées dans userData/adblock-cache/custom.txt
══════════════════════════════════════════════════════════════ */

function getCustomRulesPath() {
  return path.join(CACHE_DIR(), 'custom.txt');
}

function readCustomRules() {
  try { return fs.readFileSync(getCustomRulesPath(), 'utf8'); }
  catch { return ''; }
}

function writeCustomRules(text) {
  fs.mkdirSync(CACHE_DIR(), { recursive: true });
  fs.writeFileSync(getCustomRulesPath(), text, 'utf8');
}

/* ══════════════════════════════════════════════════════════════
   CLASSE PRINCIPALE
══════════════════════════════════════════════════════════════ */

class AdBlockEngine {
  constructor() {
    this._ruleSet       = null;   // RuleSet courant
    this._enabled       = false;
    this._stats         = { blocked: 0, allowed: 0 };
    this._updateTimer   = null;
    this._cosmeticCache = new Map(); // domaine → selectors[]
  }

  /* ── Initialisation ──────────────────────────────────────── */

  async init(enabled = true) {
    this._enabled = enabled;
    if (!enabled) return;

    await this._buildRuleSet();
    this._scheduleUpdates();
    console.log(`[AdBlock] Initialisé — ${this._ruleSet?.count || 0} règles réseau chargées`);
  }

  async _buildRuleSet(forceUpdate = false) {
    const texts = await Promise.all(
      FILTER_LISTS
        .filter(l => l.enabled)
        .map(l => loadOrUpdateList(l, forceUpdate))
    );

    // Règles custom
    texts.push(readCustomRules());

    // Merger tous les RuleSets
    const merged = new RuleSet();
    for (const text of texts) {
      if (!text) continue;
      const rs = parseFilterList(text);
      rs.domains.forEach((v, k)    => { const cur = merged.domains.get(k); merged.domains.set(k, cur ? [...cur, ...v] : [...v]); });
      rs.keywords.forEach((v, k)   => { const cur = merged.keywords.get(k); merged.keywords.set(k, cur ? [...cur, ...v] : [...v]); });
      rs.exceptions.forEach((v, k) => merged.exceptions.set(k, v));
      rs.cosmetic.forEach((v, k)   => { const cur = merged.cosmetic.get(k); merged.cosmetic.set(k, cur ? [...cur, ...v] : [...v]); });
      merged.regexRules.push(...rs.regexRules);
      merged.count += rs.count;
    }

    this._ruleSet = merged;
    console.log(`[AdBlock] RuleSet rebuilt — ${merged.count} règles, ${merged.domains.size} domaines, ${merged.cosmetic.size} sélecteurs cosmétiques`);
  }

  _scheduleUpdates() {
    if (this._updateTimer) clearInterval(this._updateTimer);
    this._updateTimer = setInterval(async () => {
      console.log('[AdBlock] Mise à jour des listes...');
      await this._buildRuleSet(true);
    }, UPDATE_INTERVAL_MS);
  }

  /* ── Matching ────────────────────────────────────────────── */

  shouldBlock(url, type = '', pageUrl = '') {
    if (!this._enabled || !this._ruleSet) return false;
    const result = matchRequest(this._ruleSet, url, type, pageUrl);
    if (result.blocked) {
      this._stats.blocked++;
    } else {
      this._stats.allowed++;
    }
    return result.blocked;
  }

  /* ── Sélecteurs CSS cosmétiques pour un domaine ─────────── */

  getCosmeticSelectors(hostname) {
    if (!this._enabled || !this._ruleSet) return [];

    if (this._cosmeticCache.has(hostname)) {
      return this._cosmeticCache.get(hostname);
    }

    const selectors = new Set();

    // Règles globales (domaine = *)
    const global = this._ruleSet.cosmetic.get('*') || [];
    global.forEach(s => selectors.add(s));

    // Règles spécifiques au domaine et ses parents
    const parts = hostname.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const sub = parts.slice(i).join('.');
      const rules = this._ruleSet.cosmetic.get(sub) || [];
      rules.forEach(s => selectors.add(s));
    }

    const result = [...selectors];
    this._cosmeticCache.set(hostname, result);
    return result;
  }

  /* ── API publique ────────────────────────────────────────── */

  enable()  { this._enabled = true; }
  disable() { this._enabled = false; }
  toggle()  { this._enabled = !this._enabled; return this._enabled; }

  isEnabled()    { return this._enabled; }
  getStats()     { return { ...this._stats }; }
  resetStats()   { this._stats = { blocked: 0, allowed: 0 }; }
  getCustomRules() { return readCustomRules(); }
  saveCustomRules(text) { writeCustomRules(text); this._buildRuleSet(); }

  async forceUpdate() {
    await this._buildRuleSet(true);
    return this._ruleSet?.count || 0;
  }

  getInfo() {
    return {
      enabled:    this._enabled,
      ruleCount:  this._ruleSet?.count || 0,
      domainCount:this._ruleSet?.domains.size || 0,
      stats:      this._stats,
    };
  }

  destroy() {
    if (this._updateTimer) clearInterval(this._updateTimer);
  }
}

/* ══════════════════════════════════════════════════════════════
   EXPORTS
══════════════════════════════════════════════════════════════ */

module.exports = { AdBlockEngine, parseFilterList, matchRequest };