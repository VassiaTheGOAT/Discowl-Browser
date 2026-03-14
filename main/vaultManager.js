'use strict';

/**
 * vaultManager.js — Gestionnaire de mots de passe chiffrés
 *
 * SÉCURITÉ :
 *   • Chaque entrée est chiffrée individuellement : AES-256-GCM
 *   • La clé vault est une clé aléatoire 32 bytes
 *   • Sans mot de passe maître : clé stockée dans vault.json (protégé par l'OS)
 *   • Avec mot de passe maître : clé vault elle-même chiffrée avec
 *     AES-256-GCM(key = scrypt(masterPassword, keySalt, 32))
 *   • Migration auto quand le mot de passe maître est activé/désactivé
 *   • Aucun mot de passe n'est jamais stocké en clair
 *
 * Format vault.json :
 * {
 *   version: 1,
 *   protected: bool,        // clé vault chiffrée avec mot de passe maître
 *   keyPlain: "hex",        // si !protected : clé vault en clair
 *   keySalt:  "hex",        // si protected  : sel scrypt
 *   keyIv:    "hex",        // si protected  : IV AES pour déchiffrer la clé
 *   keyTag:   "hex",        // si protected  : auth tag
 *   keyEnc:   "hex",        // si protected  : clé vault chiffrée
 *   entries: [{
 *     id, host, iv, tag, data  // data = AES-GCM({username, password})
 *   }]
 * }
 */

const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const { app } = require('electron');

const SCRYPT = { N: 16384, r: 8, p: 1, len: 32 };

class VaultManager {
  constructor() {
    this._key  = null;   // Buffer 32 bytes — clé en mémoire, null si verrouillé
    this._path = null;   // résolu lazily
  }

  _getPath() {
    if (!this._path) this._path = path.join(app.getPath('userData'), 'vault.json');
    return this._path;
  }

  /* ── Lecture/écriture atomique ─────────────────────────── */
  _read() {
    try {
      const p = this._getPath();
      if (!fs.existsSync(p)) return { version: 1, protected: false, keyPlain: null, entries: [] };
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { return { version: 1, protected: false, keyPlain: null, entries: [] }; }
  }

  _write(data) {
    const p = this._getPath();
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  }

  /* ── Dérivation de clé (scrypt) ────────────────────────── */
  _deriveKey(password, salt) {
    return new Promise((resolve, reject) => {
      crypto.scrypt(
        Buffer.from(password, 'utf8'),
        Buffer.from(salt, 'hex'),
        SCRYPT.len,
        { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
        (err, key) => err ? reject(err) : resolve(key)
      );
    });
  }

  /* ── AES-256-GCM helpers ───────────────────────────────── */
  _encrypt(plaintext, key) {
    const iv       = crypto.randomBytes(12);
    const cipher   = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc      = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    const tag      = cipher.getAuthTag();
    return { iv: iv.toString('hex'), tag: tag.toString('hex'), data: enc.toString('hex') };
  }

  _decrypt(iv, tag, data, key) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]);
    return dec.toString('utf8');
  }

  /* ══════════════════════════════════════════════════════════
     DÉVERROUILLAGE
  ══════════════════════════════════════════════════════════ */

  /**
   * Sans mot de passe maître — charge/crée une clé aléatoire locale.
   */
  unlockAnonymous() {
    const vault = this._read();
    if (vault.protected) {
      // Vault était protégé mais mot de passe maître supprimé
      // → impossible de déchiffrer sans le mot de passe — réinitialiser
      console.warn('[Vault] Vault protégé mais pas de mot de passe → réinitialisation');
      const newKey = crypto.randomBytes(32);
      this._write({ version: 1, protected: false, keyPlain: newKey.toString('hex'), entries: [] });
      this._key = newKey;
      return;
    }
    if (!vault.keyPlain) {
      // Première utilisation — créer une clé
      const newKey = crypto.randomBytes(32);
      vault.keyPlain = newKey.toString('hex');
      vault.entries  = vault.entries || [];
      this._write(vault);
      this._key = newKey;
    } else {
      this._key = Buffer.from(vault.keyPlain, 'hex');
    }
    console.log('[Vault] Déverrouillé (mode anonyme)');
  }

  /**
   * Avec mot de passe maître — déchiffre la clé vault.
   * @returns {Promise<boolean>}
   */
  async unlock(masterPassword) {
    const vault = this._read();

    if (!vault.protected) {
      // Pas encore protégé — déverrouiller en mode anonyme puis migrer
      this.unlockAnonymous();
      // Migrer vers protection par mot de passe maître
      await this._protectWithPassword(masterPassword);
      return true;
    }

    try {
      const derivedKey = await this._deriveKey(masterPassword, vault.keySalt);
      const keyPlain   = this._decrypt(vault.keyIv, vault.keyTag, vault.keyEnc, derivedKey);
      this._key = Buffer.from(keyPlain, 'hex');
      console.log('[Vault] Déverrouillé (mode protégé)');
      return true;
    } catch(e) {
      console.error('[Vault] Échec déverrouillage :', e.message);
      this._key = null;
      return false;
    }
  }

  /**
   * Chiffre la clé vault avec le mot de passe maître (migration).
   */
  async _protectWithPassword(masterPassword) {
    if (!this._key) return;
    const vault      = this._read();
    const keySalt    = crypto.randomBytes(32).toString('hex');
    const derivedKey = await this._deriveKey(masterPassword, keySalt);
    const { iv, tag, data } = this._encrypt(this._key.toString('hex'), derivedKey);
    vault.protected = true;
    vault.keySalt   = keySalt;
    vault.keyIv     = iv;
    vault.keyTag    = tag;
    vault.keyEnc    = data;
    delete vault.keyPlain;
    this._write(vault);
    console.log('[Vault] Migré vers protection par mot de passe');
  }

  /**
   * Retire la protection par mot de passe (migration inverse).
   */
  removePasswordProtection() {
    if (!this._key) return;
    const vault = this._read();
    vault.protected = false;
    vault.keyPlain  = this._key.toString('hex');
    delete vault.keySalt;
    delete vault.keyIv;
    delete vault.keyTag;
    delete vault.keyEnc;
    this._write(vault);
    console.log('[Vault] Protection par mot de passe retirée');
  }

  isUnlocked() { return this._key !== null; }

  lock() { this._key = null; }

  /* ══════════════════════════════════════════════════════════
     CRUD
  ══════════════════════════════════════════════════════════ */

  /**
   * Sauvegarde ou met à jour un credential pour un host.
   */
  save(host, username, password) {
    if (!this._key) throw new Error('Vault locked');
    const vault = this._read();

    // Chercher une entrée existante pour ce host+username
    const idx = vault.entries.findIndex(e => {
      try {
        const plain = JSON.parse(this._decrypt(e.iv, e.tag, e.data, this._key));
        return e.host === host && plain.username === username;
      } catch { return false; }
    });

    const plaintext = JSON.stringify({ username, password });
    const { iv, tag, data } = this._encrypt(plaintext, this._key);
    const entry = { id: idx >= 0 ? vault.entries[idx].id : this._uid(), host, iv, tag, data };

    if (idx >= 0) vault.entries[idx] = entry;
    else vault.entries.push(entry);

    this._write(vault);
    return { ok: true };
  }

  /**
   * Retourne les credentials pour un host (URL → hostname).
   */
  getForHost(url) {
    if (!this._key) return [];
    try {
      const host  = new URL(url).hostname;
      const vault = this._read();
      return vault.entries
        .filter(e => e.host === host)
        .map(e => {
          try {
            const plain = JSON.parse(this._decrypt(e.iv, e.tag, e.data, this._key));
            return { id: e.id, host: e.host, username: plain.username, password: plain.password };
          } catch { return null; }
        })
        .filter(Boolean);
    } catch { return []; }
  }

  /**
   * Retourne toutes les entrées (sans mots de passe — pour l'affichage).
   */
  getAll() {
    if (!this._key) return [];
    const vault = this._read();
    return vault.entries.map(e => {
      try {
        const plain = JSON.parse(this._decrypt(e.iv, e.tag, e.data, this._key));
        return { id: e.id, host: e.host, username: plain.username };
      } catch { return { id: e.id, host: e.host, username: '(error)' }; }
    });
  }

  /**
   * Retourne une entrée complète par id (avec mot de passe).
   */
  getById(id) {
    if (!this._key) return null;
    const vault = this._read();
    const entry = vault.entries.find(e => e.id === id);
    if (!entry) return null;
    try {
      const plain = JSON.parse(this._decrypt(entry.iv, entry.tag, entry.data, this._key));
      return { id: entry.id, host: entry.host, username: plain.username, password: plain.password };
    } catch { return null; }
  }

  delete(id) {
    if (!this._key) throw new Error('Vault locked');
    const vault = this._read();
    vault.entries = vault.entries.filter(e => e.id !== id);
    this._write(vault);
    return { ok: true };
  }

  _uid() {
    return 'v-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  }
}

module.exports = new VaultManager();