'use strict';
/**
 * preload-webview.js
 * Injecté dans chaque page web chargée dans un webview.
 * - Déclenche l'autofill au focus d'un champ email/password/username
 * - Capture les credentials à la soumission du formulaire
 */

const { ipcRenderer } = require('electron');

/* ══════════════════════════════════════════════════════════════
   AUTOFILL — déclenché au focus d'un champ de login
══════════════════════════════════════════════════════════════ */
let _autofillArmed = false;

function isLoginField(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  const t  = (el.type || '').toLowerCase();
  const nm = (el.name || '').toLowerCase();
  const ac = (el.autocomplete || '').toLowerCase();
  const id = (el.id   || '').toLowerCase();

  if (t === 'password') return true;
  if (t === 'email')    return true;
  if (ac.match(/username|email|password/)) return true;
  if (nm.match(/user|email|login|mail|account/)) return true;
  if (id.match(/user|email|login|mail|account/)) return true;
  return false;
}

document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!isLoginField(el)) return;
  if (_autofillArmed) return;
  _autofillArmed = true;

  const r = el.getBoundingClientRect();
  ipcRenderer.sendToHost('vault:field-focused', {
    url:  window.location.href,
    rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width }
  });
}, true);

document.addEventListener('focusout', () => {
  setTimeout(() => {
    const active = document.activeElement;
    if (!active || !isLoginField(active)) _autofillArmed = false;
  }, 200);
}, true);

window.addEventListener('popstate',   () => { _autofillArmed = false; });
window.addEventListener('hashchange', () => { _autofillArmed = false; });

/* ── Remplissage depuis le renderer ────────────────────────── */
ipcRenderer.on('vault:fill', (_, { username, password }) => {
  const pwField   = document.querySelector('input[type="password"]');
  const userField = document.querySelector('input[type="email"]')
    || document.querySelector('input[autocomplete="username"]')
    || document.querySelector('input[autocomplete="email"]')
    || document.querySelector('input[type="text"][name*="user"]')
    || document.querySelector('input[type="text"][name*="email"]')
    || document.querySelector('input[type="text"][name*="login"]')
    || document.querySelector('input[type="text"]');

  function fillInput(el, value) {
    if (!el || !value) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  fillInput(userField, username);
  fillInput(pwField,   password);
  _autofillArmed = false;
});

/* ══════════════════════════════════════════════════════════════
   CAPTURE CREDENTIALS — soumission
══════════════════════════════════════════════════════════════ */
function getCredentials(root) {
  const ctx = root || document;
  const pwField = ctx.querySelector('input[type="password"]');
  if (!pwField?.value) return null;

  let userField = ctx.querySelector('input[type="email"]')
    || ctx.querySelector('input[autocomplete="username"]')
    || ctx.querySelector('input[autocomplete="email"]')
    || ctx.querySelector('input[type="text"][name*="user"]')
    || ctx.querySelector('input[type="text"][name*="email"]')
    || ctx.querySelector('input[type="text"][name*="login"]');

  if (!userField && root) {
    const inputs = Array.from(root.querySelectorAll('input[type="text"],input[type="email"]'));
    userField = inputs.find(i => i.compareDocumentPosition(pwField) & Node.DOCUMENT_POSITION_FOLLOWING) || inputs[0];
  }
  if (!userField) userField = document.querySelector('input[type="text"],input[type="email"]');

  return { username: userField?.value?.trim() || '', password: pwField.value, url: window.location.href };
}

document.addEventListener('submit', (e) => {
  const creds = getCredentials(e.target);
  if (creds?.password) ipcRenderer.sendToHost('vault:credentials-submitted', creds);
}, true);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[type="submit"],input[type="submit"]');
  if (!btn) return;
  setTimeout(() => {
    const creds = getCredentials(btn.closest('form'));
    if (creds?.password) ipcRenderer.sendToHost('vault:credentials-submitted', creds);
  }, 300);
}, true);