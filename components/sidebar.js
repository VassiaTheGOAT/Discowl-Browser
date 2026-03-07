/* ─── components/sidebar.js ─────────────────────────────────────
   Sidebar open/close animation and toggle state management.
─────────────────────────────────────────────────────────────── */

'use strict';

const SidebarManager = (() => {

  let leftOpen  = false;
  let rightOpen = false;

  function getLeft()  { return document.getElementById('left-sidebar'); }
  function getRight() { return document.getElementById('right-sidebar'); }
  function getLeftBtn()  { return document.getElementById('sidebar-left-toggle'); }
  function getRightBtn() { return document.getElementById('sidebar-right-toggle'); }

  function openLeft() {
    const el = getLeft();
    if (!el) return;
    el.classList.add('open');
    el.classList.remove('closed');
    leftOpen = true;
    getLeftBtn()?.classList.add('active');
  }

  function closeLeft() {
    const el = getLeft();
    if (!el) return;
    el.classList.remove('open');
    el.classList.add('closed');
    leftOpen = false;
    getLeftBtn()?.classList.remove('active');
  }

  function toggleLeft() {
    leftOpen ? closeLeft() : openLeft();
  }

  function openRight() {
    const el = getRight();
    if (!el) return;
    el.classList.add('open');
    el.classList.remove('closed');
    rightOpen = true;
    getRightBtn()?.classList.add('active');
  }

  function closeRight() {
    const el = getRight();
    if (!el) return;
    el.classList.remove('open');
    el.classList.add('closed');
    rightOpen = false;
    getRightBtn()?.classList.remove('active');
  }

  function toggleRight() {
    rightOpen ? closeRight() : openRight();
  }

  function init() {
    getLeftBtn()?.addEventListener('click',  () => toggleLeft());
    getRightBtn()?.addEventListener('click', () => toggleRight());

    // Close buttons inside sidebars
    document.querySelectorAll('.sidebar-close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        if (target === 'left-sidebar')  closeLeft();
        if (target === 'right-sidebar') closeRight();
      });
    });
  }

  return { init, openLeft, closeLeft, toggleLeft, openRight, closeRight, toggleRight };

})();

window.addEventListener('DOMContentLoaded', () => SidebarManager.init());
window.SidebarManager = SidebarManager;
