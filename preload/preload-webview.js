'use strict';
/**
 * preload-webview.js
 * Injecté dans chaque page web chargée dans un webview.
 * Détecte les formulaires avec mot de passe et propose l'autofill.
 * Communique avec renderer.js via ipcRenderer.sendToHost().
 */

const { ipcRenderer } = require('electron');

/* ── Détection formulaire & soumission ─────────────────────── */
function getCredentials(form) {
  const pwField = form.querySelector('input[type="password"]');
  if (!pwField || !pwField.value) return null;

  // Chercher le champ username : email, text, ou champ précédant le password
  let userField = form.querySelector('input[type="email"]')
    || form.querySelector('input[type="text"][name*="user"]')
    || form.querySelector('input[type="text"][name*="email"]')
    || form.querySelector('input[type="text"][name*="login"]')
    || form.querySelector('input[type="text"][autocomplete="username"]')
    || form.querySelector('input[type="text"][autocomplete="email"]');

  // Fallback : premier champ text/email avant le password
  if (!userField) {
    const inputs = Array.from(form.querySelectorAll('input[type="text"], input[type="email"]'));
    userField = inputs.find(inp => {
      const pos = inp.compareDocumentPosition(pwField);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING;
    }) || inputs[0];
  }

  // Aussi chercher en dehors du form (certains sites structurent mal)
  if (!userField) {
    userField = document.querySelector('input[type="email"]')
      || document.querySelector('input[autocomplete="username"]');
  }

  const username = userField?.value?.trim() || '';
  const password = pwField.value;

  if (!password) return null;
  return { username, password, url: window.location.href };
}

// Observer les soumissions de formulaire
document.addEventListener('submit', (e) => {
  const form  = e.target;
  const creds = getCredentials(form);
  if (creds) {
    ipcRenderer.sendToHost('vault:credentials-submitted', creds);
  }
}, true);

// Certains sites évitent l'événement submit (SPAs) — observer les clics sur boutons
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[type="submit"], input[type="submit"], button:not([type])');
  if (!btn) return;
  const form = btn.closest('form') || document.querySelector('form');
  if (!form) return;
  setTimeout(() => {
    const creds = getCredentials(form);
    if (creds) ipcRenderer.sendToHost('vault:credentials-submitted', creds);
  }, 200); // laisser le temps au DOM de se mettre à jour
}, true);

/* ── Autofill depuis le renderer ───────────────────────────── */
ipcRenderer.on('vault:fill', (_, { username, password }) => {
  // Trouver les champs de la page
  const pwField   = document.querySelector('input[type="password"]');
  const userField = document.querySelector('input[type="email"]')
    || document.querySelector('input[type="text"][name*="user"]')
    || document.querySelector('input[type="text"][name*="email"]')
    || document.querySelector('input[type="text"][name*="login"]')
    || document.querySelector('input[autocomplete="username"]')
    || document.querySelector('input[type="text"]');

  function fillInput(el, value) {
    if (!el) return;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    nativeInputValueSetter?.call(el, value);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  fillInput(userField, username);
  fillInput(pwField,   password);
});

/* ── Signaler les champs de mot de passe présents ────────────
   Permet au renderer de savoir si la page a un formulaire de login
   et d'afficher le dropdown d'autofill. ─────────────────────── */
function checkForPasswordForms() {
  const hasPwField = !!document.querySelector('input[type="password"]');
  if (hasPwField) {
    ipcRenderer.sendToHost('vault:has-login-form', { url: window.location.href });
  }
}

// Au chargement initial
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkForPasswordForms);
} else {
  checkForPasswordForms();
}

// Observer les mutations DOM pour les SPAs (ex : Gmail qui charge le champ plus tard)
const observer = new MutationObserver(() => checkForPasswordForms());
observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
// Arrêter l'observation après 10s pour économiser les ressources
setTimeout(() => observer.disconnect(), 10000);