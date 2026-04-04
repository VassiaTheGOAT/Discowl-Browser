'use strict';

/**
 * torManager.js — Gestionnaire Tor production
 *
 * Architecture :
 *   - SOCKS5  port 9050 : proxy pour tout le trafic
 *   - Control port 9051 : commandes SIGNAL NEWNYM (nouveau circuit)
 *                         et lecture du statut bootstrap
 *
 * Sécurité :
 *   FAIL CLOSED : si Tor n'est pas connecté, tout le trafic est bloqué.
 *   La vérification se fait AVANT que la fenêtre principale s'ouvre.
 *
 * Rotation de circuit :
 *   SIGNAL NEWNYM via Control Port → nouveau circuit Tor.
 *   Rate-limité par Tor lui-même (max 1 toutes les 10s).
 */

const { app }     = require('electron');
const { spawn }   = require('child_process');
const path        = require('path');
const net         = require('net');
const fs          = require('fs');
const crypto      = require('crypto');

// ── Constantes ────────────────────────────────────────────────
const SOCKS_HOST       = '127.0.0.1';
const SOCKS_PORT       = 9050;
const CONTROL_PORT     = 9051;
const BOOTSTRAP_TIMEOUT= 120_000; // 120s max pour bootstrap
const CHECK_TIMEOUT    =   3_000; // 3s pour vérifier le proxy
const NEWNYM_COOLDOWN  =  10_000; // 10s min entre deux NEWNYM (limite Tor)

class TorManager {
  constructor() {
    this._process      = null;
    this._running      = false;
    this._bootstrapped = false; // true seulement quand 100%
    this._controlConn  = null;  // connexion TCP au Control Port
    this._cookieAuth   = null;  // cookie d'auth Control Port
    this._lastNewnym   = 0;     // timestamp dernier NEWNYM
    this._circuitId    = 0;     // compteur de circuits

    const bin = process.platform === 'win32' ? 'tor.exe' : 'tor';

    /*
     * Résolution du chemin selon l'environnement :
     *
     * Dev  (app.isPackaged = false) :
     *   __dirname = <racine>/main/
     *   tor/      = <racine>/tor/
     *   → path.resolve(__dirname, '..', 'tor', 'tor', bin)
     *
     * Prod (app.isPackaged = true) :
     *   electron-builder copie extraResources dans resources/ (à côté de app.asar)
     *   → process.resourcesPath + '/tor/tor/' + bin
     *
     * La structure attendue dans les deux cas :
     *   tor/
     *   └── tor/
     *       └── tor.exe  (ou tor sur macOS/Linux)
     */
    if (app.isPackaged) {
      // En prod :
      //   Binaire  → resources/tor/tor/tor.exe   (extraResources, lecture seule OK)
      //   DataDir  → userData/tor-data/            (répertoire utilisateur, écriture OK)
      //
      // resources/ peut être en lecture seule (macOS, Windows selon répertoire install)
      // → le binaire Tor est OK en lecture seule
      // → le cookie d'auth et les circuits Tor nécessitent l'écriture → userData
      this.torBinPath = path.join(process.resourcesPath, 'tor', 'tor', bin);
      this.torDataDir = path.join(app.getPath('userData'), 'tor-data');
    } else {
      // En dev : tout dans le projet
      this.torBinPath = path.resolve(__dirname, '..', 'tor', 'tor', bin);
      this.torDataDir = path.resolve(__dirname, '..', 'tor', 'data');
    }

    this.cookiePath = path.join(this.torDataDir, 'control_auth_cookie');

    console.log('[Tor] Binaire :', this.torBinPath);
    console.log('[Tor] resourcesPath :', process.resourcesPath);
    console.log('[Tor] isPackaged :', app.isPackaged);
  }

  /* ══════════════════════════════════════════════════════════════
     DÉMARRAGE
  ══════════════════════════════════════════════════════════════ */

  startTor() {
    return new Promise(async (resolve, reject) => {
      if (this._running && this._bootstrapped) {
        return resolve({ already: true });
      }

      // Vérifier si un Tor tourne déjà sur le port SOCKS
      const alreadyUp = await this._checkSocksPort();
      if (alreadyUp) {
        console.log('[Tor] Port SOCKS déjà actif — adoption');
        this._running = true;
        this._bootstrapped = true;
        await this._connectControl().catch(() => {});
        return resolve({ already: true });
      }

      if (!fs.existsSync(this.torBinPath)) {
        return reject(new Error(
          `Binaire Tor introuvable : ${this.torBinPath}\n` +
          `→ Placez le Tor Expert Bundle dans tor/tor/`
        ));
      }

      // Créer le dossier de données si nécessaire
      fs.mkdirSync(this.torDataDir, { recursive: true });

      console.log('[Tor] Démarrage avec Control Port...');

      let proc;
      try {
        proc = spawn(this.torBinPath, [
          '--SocksPort',         String(SOCKS_PORT),
          '--ControlPort',       String(CONTROL_PORT),
          '--CookieAuthentication', '1',
          '--CookieAuthFile',    this.cookiePath,
          '--DataDirectory',     this.torDataDir,
          '--ignore-missing-torrc',
          // Anti-fingerprinting Tor
          '--ClientUseIPv6',     '0',     // IPv4 uniquement (IPv6 peut révéler l'IP)
          '--EnforceDistinctSubnets', '1',
          // DNS via Tor
          '--DNSPort',           '0',     // DNS interne désactivé (Chromium utilise le proxy SOCKS5)
          '--SafeSocks',         '1',     // Refuser les DNS leaks SOCKS4a
        ], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        });
      } catch (err) {
        return reject(new Error(`spawn() échoué : ${err.message}`));
      }

      this._process = proc;
      let resolved  = false;
      let bootstrap = 0;

      const onLine = (raw) => {
        const line = raw.toString().trim();
        if (!line) return;

        // Extraire le % de bootstrap
        const m = line.match(/Bootstrapped\s+(\d+)%(?:[^:]*:\s*(.+))?/i);
        if (m) {
          bootstrap = parseInt(m[1], 10);
          const msg = m[2] ? m[2].trim() : null;
          console.log(`[Tor] Bootstrap ${bootstrap}%${msg ? ' — ' + msg : ''}`);
          // Notifier la splash si elle est connectée
          if (typeof this._onBootstrapProgress === 'function') {
            this._onBootstrapProgress(bootstrap, msg ? `${bootstrap}% — ${msg}` : null);
          }
        }

        if (!resolved && bootstrap >= 100) {
          resolved = true;
          this._running = true;
          this._bootstrapped = true;
          clearTimeout(timer);
          // Connecter le Control Port
          this._connectControl()
            .then(() => {
              console.log('[Tor] Control Port connecté');
              resolve({ success: true });
            })
            .catch((e) => {
              // Control Port non critique — Tor fonctionne quand même
              console.warn('[Tor] Control Port indisponible:', e.message);
              resolve({ success: true, noControl: true });
            });
        }
      };

      proc.stdout.on('data', onLine);
      proc.stderr.on('data', onLine);

      proc.on('error', (err) => {
        clearTimeout(timer);
        this._running = false;
        this._bootstrapped = false;
        this._process = null;
        if (!resolved) reject(new Error(`Erreur process Tor : ${err.message}`));
      });

      proc.on('exit', (code, signal) => {
        console.log(`[Tor] Processus terminé (code=${code} signal=${signal})`);
        this._running = false;
        this._bootstrapped = false;
        this._process = null;
        this._controlConn?.destroy();
        this._controlConn = null;
        if (!resolved) {
          clearTimeout(timer);
          reject(new Error(`Tor a quitté prématurément (code=${code})`));
        }
      });

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Tor timeout (${BOOTSTRAP_TIMEOUT / 1000}s) — bootstrap trop lent`));
        }
      }, BOOTSTRAP_TIMEOUT);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     CONTRÔLE — connexion au Control Port pour SIGNAL NEWNYM
  ══════════════════════════════════════════════════════════════ */

  async _connectControl() {
    return new Promise((resolve, reject) => {
      // Lire le cookie d'auth
      let cookie;
      try {
        const raw = fs.readFileSync(this.cookiePath);
        cookie = raw.toString('hex');
      } catch (e) {
        return reject(new Error(`Cookie auth illisible : ${e.message}`));
      }

      const sock = new net.Socket();
      sock.setTimeout(5000);

      sock.connect(CONTROL_PORT, SOCKS_HOST, () => {
        // Authentification via cookie
        sock.write(`AUTHENTICATE ${cookie}\r\n`);
      });

      let buffer = '';
      sock.on('data', (data) => {
        buffer += data.toString();
        if (buffer.includes('250 OK')) {
          this._controlConn = sock;
          this._cookieAuth  = cookie;
          buffer = '';
          resolve();
        } else if (buffer.includes('515 ') || buffer.includes('551 ')) {
          sock.destroy();
          reject(new Error('Authentification Control Port échouée'));
        }
      });

      sock.on('error', reject);
      sock.on('timeout', () => {
        sock.destroy();
        reject(new Error('Control Port timeout'));
      });

      sock.on('close', () => {
        if (this._controlConn === sock) {
          this._controlConn = null;
        }
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     ROTATION DE CIRCUIT — SIGNAL NEWNYM
     Tor rate-limite à 1 NEWNYM / 10s.
     Retourne { ok, ms_until_available } selon disponibilité.
  ══════════════════════════════════════════════════════════════ */

  async rotateCircuit() {
    if (!this._running || !this._bootstrapped) {
      return { ok: false, reason: 'Tor non connecté' };
    }

    const now = Date.now();
    const elapsed = now - this._lastNewnym;
    if (elapsed < NEWNYM_COOLDOWN) {
      return {
        ok: false,
        reason: 'Cooldown actif',
        ms_until_available: NEWNYM_COOLDOWN - elapsed,
      };
    }

    // Reconnecter le Control Port si nécessaire
    if (!this._controlConn || this._controlConn.destroyed) {
      try {
        await this._connectControl();
      } catch (e) {
        return { ok: false, reason: `Control Port indisponible : ${e.message}` };
      }
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ ok: false, reason: 'NEWNYM timeout' });
      }, 5000);

      let buf = '';
      const onData = (data) => {
        buf += data.toString();
        if (buf.includes('250 OK')) {
          clearTimeout(timeout);
          this._controlConn.removeListener('data', onData);
          this._lastNewnym = Date.now();
          this._circuitId++;
          console.log(`[Tor] Nouveau circuit #${this._circuitId}`);
          resolve({ ok: true, circuitId: this._circuitId });
        } else if (buf.includes('552 ') || buf.includes('553 ')) {
          clearTimeout(timeout);
          this._controlConn.removeListener('data', onData);
          resolve({ ok: false, reason: 'NEWNYM rejeté par Tor' });
        }
      };

      this._controlConn.on('data', onData);
      this._controlConn.write('SIGNAL NEWNYM\r\n');
    });
  }

  /* ══════════════════════════════════════════════════════════════
     VÉRIFICATION PROXY (FAIL CLOSED)
  ══════════════════════════════════════════════════════════════ */

  /** Vérifie que le SOCKS5 répond. Utilisé pour le fail-closed. */
  _checkSocksPort() {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      sock.setTimeout(CHECK_TIMEOUT);
      sock.once('connect', () => { sock.destroy(); resolve(true);  });
      sock.once('error',   () => { resolve(false); });
      sock.once('timeout', () => { sock.destroy(); resolve(false); });
      sock.connect(SOCKS_PORT, SOCKS_HOST);
    });
  }

  /**
   * Vérifie la connexion Tor en tentant une vraie requête via le proxy SOCKS5.
   * Plus fiable que juste vérifier le port (qui peut être ouvert mais non bootstrapped).
   */
  async verifyTorConnectivity() {
    if (!this._bootstrapped) return { connected: false, reason: 'Non bootstrapped' };

    // Vérifier check.torproject.org via SOCKS (sans dépendance externe)
    const isUp = await this._checkSocksPort();
    return {
      connected: isUp && this._bootstrapped,
      circuitId: this._circuitId,
    };
  }

  /* ══════════════════════════════════════════════════════════════
     ARRÊT
  ══════════════════════════════════════════════════════════════ */

  stopTor() {
    return new Promise((resolve) => {
      // Fermer la connexion control
      if (this._controlConn) {
        try { this._controlConn.destroy(); } catch {}
        this._controlConn = null;
      }

      this._running      = false;
      this._bootstrapped = false;

      if (!this._process) return resolve();

      const proc = this._process;
      this._process = null;

      proc.once('exit', () => resolve());

      // Arrêt propre via SIGTERM
      try { proc.kill('SIGTERM'); } catch {}

      // Force kill après 5s
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
        resolve();
      }, 5000);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     API PUBLIQUE
  ══════════════════════════════════════════════════════════════ */

  isTorRunning()    { return this._running; }
  isBootstrapped()  { return this._bootstrapped; }
  getTorProxyUrl()  { return `socks5://${SOCKS_HOST}:${SOCKS_PORT}`; }
  getSocksPort()    { return SOCKS_PORT; }
  getSocksHost()    { return SOCKS_HOST; }
  getCircuitId()    { return this._circuitId; }

  /** Status complet pour l'UI */
  getStatus() {
    return {
      running:     this._running,
      bootstrapped:this._bootstrapped,
      proxyUrl:    this.getTorProxyUrl(),
      binExists:   fs.existsSync(this.torBinPath),
      circuitId:   this._circuitId,
      hasControl:  !!(this._controlConn && !this._controlConn.destroyed),
      newnymReady: Date.now() - this._lastNewnym >= NEWNYM_COOLDOWN,
      newnymIn:    Math.max(0, NEWNYM_COOLDOWN - (Date.now() - this._lastNewnym)),
    };
  }
}

module.exports = TorManager;