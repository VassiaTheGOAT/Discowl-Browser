'use strict';

const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const { app } = require('electron');

const SCRYPT_PARAMS = {
  N: 16384,  // ~16 MB RAM — compatible Electron, ~200ms/tentative
  r: 8,
  p: 1,
  keyLen: 64
};

class PasswordManager {
  /* ── Chemin du fichier auth ────────────────────────────────
     Résolu à la demande (pas dans le constructeur) car app.getPath()
     n'est disponible qu'après app.ready.
  ─────────────────────────────────────────────────────────── */
  _getPath() {
    return path.join(app.getPath('userData'), 'auth.json');
  }

  /* ── Lecture/écriture atomique ─────────────────────────── */
  _read() {
    try {
      const p = this._getPath();
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { return null; }
  }

  _write(data) {
    const p   = this._getPath();
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, p);
  }

  _delete() {
    try { fs.rmSync(this._getPath(), { force: true }); } catch {}
  }

  /* ── Hash scrypt ───────────────────────────────────────── */
  _hash(password, salt) {
    return new Promise((resolve, reject) => {
      crypto.scrypt(
        Buffer.from(password, 'utf8'),
        Buffer.from(salt, 'hex'),
        SCRYPT_PARAMS.keyLen,
        { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p },
        (err, derived) => err ? reject(err) : resolve(derived.toString('hex'))
      );
    });
  }

  /* ── API publique ─────────────────────────────────────── */

  isEnabled() {
    const data = this._read();
    return !!(data?.enabled && data?.hash && data?.salt);
  }

  async setup(password) {
    if (!password?.length) throw new Error('Empty password');
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = await this._hash(password, salt);
    this._write({ enabled: true, hash, salt });
    return { ok: true };
  }

  async verify(password) {
    const data = this._read();
    if (!data?.hash || !data?.salt) return false;
    try {
      const attempt = await this._hash(password, data.salt);
      const a = Buffer.from(attempt,   'hex');
      const b = Buffer.from(data.hash, 'hex');
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch { return false; }
  }

  async disable(password) {
    const ok = await this.verify(password);
    if (!ok) return { ok: false, error: 'Incorrect password' };
    this._delete();
    return { ok: true };
  }
}

module.exports = new PasswordManager();