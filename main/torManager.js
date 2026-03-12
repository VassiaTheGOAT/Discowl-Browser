'use strict';

const { spawn } = require('child_process');
const path = require('path');
const net  = require('net');
const fs   = require('fs');

class TorManager {
  constructor() {
    this._process    = null;
    this._running    = false;
    this.torHost     = '127.0.0.1';
    this.torPort     = 9050;

    /*
     * En dev      : __dirname = <racine>/main  → tor est à <racine>/tor/tor/
     * En packagé  : le binaire est extrait de l'asar via asarUnpack
     *               dans <resources>/app.asar.unpacked/tor/tor/
     *               process.resourcesPath pointe vers <resources>/
     *
     * On détecte app.isPackaged pour choisir le bon chemin.
     */
    const { app } = require('electron');
    const bin = process.platform === 'win32' ? 'tor.exe' : 'tor';

    if (app.isPackaged) {
      // extraResources copie tor/ dans resources/tor/
      // → C:\...\resources\tor\tor\tor.exe
      this.torBinPath = path.join(process.resourcesPath, 'tor', 'tor', bin);
    } else {
      // Dev — chemin relatif au dossier source
      this.torBinPath = path.resolve(__dirname, '..', 'tor', 'tor', bin);
    }
    console.log('[Tor] Chemin binaire :', this.torBinPath);
  }

  /* ─────────────────────────────────────────────────────────────
     Démarrage
  ───────────────────────────────────────────────────────────── */
  startTor() {
    return new Promise(async (resolve, reject) => {
      if (this._running) {
        console.log('[Tor] Déjà actif, rien à faire');
        return resolve({ already: true });
      }

      // Si le port 9050 répond déjà, une instance Tor tourne (session précédente,
      // Tor Browser, etc.) — on l'adopte sans spawner un nouveau process.
      const alreadyUp = await this.checkProxy();
      if (alreadyUp) {
        console.log('[Tor] Port 9050 déjà actif — adoption de l\'instance existante');
        this._running = true;
        return resolve({ already: true });
      }

      if (!fs.existsSync(this.torBinPath)) {
        return reject(new Error(
          `Binaire Tor introuvable :\n${this.torBinPath}\n` +
          `→ Placez le Tor Expert Bundle dans tor/tor/ à la racine du projet.`
        ));
      }

      console.log('[Tor] Lancement…');

      let proc;
      try {
        /*
         * On ne passe QUE le port SOCKS — pas de ControlPort,
         * pas de CookieAuthentication, pour rester simple.
         * Tor démarre en mode "default torrc" + notre SocksPort.
         */
        proc = spawn(
          this.torBinPath,
          ['--SocksPort', String(this.torPort), '--ignore-missing-torrc'],
          { stdio: ['ignore', 'pipe', 'pipe'] }
        );
      } catch (err) {
        return reject(new Error(`spawn() échoué : ${err.message}`));
      }

      this._process = proc;
      let resolved = false;

      const checkLine = (raw) => {
        const line = raw.toString();
        // Tor écrit sa progression sur stderr (la plupart des versions)
        process.stdout.write('[Tor] ' + line);

        if (!resolved && (
          line.includes('Bootstrapped 100%') ||
          line.includes('100%: Done')
        )) {
          resolved = true;
          this._running = true;
          clearTimeout(timer);
          resolve({ success: true });
        }
      };

      proc.stdout.on('data', checkLine);
      proc.stderr.on('data', checkLine);  // ← CRUCIAL : Tor écrit sur stderr

      proc.on('error', (err) => {
        clearTimeout(timer);
        this._running = false;
        this._process = null;
        if (!resolved) reject(new Error(`Erreur process : ${err.message}`));
      });

      proc.on('exit', (code, signal) => {
        console.log(`[Tor] Processus terminé (code=${code} signal=${signal})`);
        this._running = false;
        this._process = null;
        if (!resolved) {
          clearTimeout(timer);
          reject(new Error(`Tor a quitté prématurément (code ${code})`));
        }
      });

      // Timeout 120s — Tor peut être lent sur premier démarrage (création du circuit)
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Tor timeout (120s) — bootstrap trop lent ou binaire incompatible'));
        }
      }, 120000);
    });
  }

  /* ─────────────────────────────────────────────────────────────
     Arrêt
  ───────────────────────────────────────────────────────────── */
  stopTor() {
    return new Promise((resolve) => {
      if (!this._process) {
        this._running = false;
        return resolve();
      }
      const proc = this._process;
      this._process = null;
      this._running = false;

      proc.once('exit', () => resolve());
      try   { proc.kill('SIGTERM'); }
      catch { try { proc.kill(); } catch {} }

      // Force kill après 5s
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} resolve(); }, 5000);
    });
  }

  /* ─────────────────────────────────────────────────────────────
     État
  ───────────────────────────────────────────────────────────── */
  isTorRunning()   { return this._running; }
  getTorProxyUrl() { return `socks5://${this.torHost}:${this.torPort}`; }

  /** Vérifie que le port 9050 répond (SOCKS5 ouvert) */
  checkProxy() {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      sock.setTimeout(3000);
      sock.once('connect', () => { sock.destroy(); resolve(true);  });
      sock.once('error',   () => { resolve(false); });
      sock.once('timeout', () => { sock.destroy(); resolve(false); });
      sock.connect(this.torPort, this.torHost);
    });
  }
}

module.exports = TorManager;