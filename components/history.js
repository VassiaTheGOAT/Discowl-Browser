/* ─── components/history.js ─────────────────────────────────────
   Manages browsing history display and operations.
─────────────────────────────────────────────────────────────── */

'use strict';

const HistoryManager = (() => {

  /* ── State ─────────────────────────────────────────────────── */
  let _history     = [];
  let _filterText  = '';

  /* ── DOM ───────────────────────────────────────────────────── */
  const listEl   = () => document.getElementById('history-list');
  const searchEl = () => document.getElementById('history-search');

  /* ── Load ──────────────────────────────────────────────────── */
  async function load() {
    _history = await window.discowlAPI.history.get();
    render();
  }

  /* ── Add entry (called from renderer.js on navigation) ─────── */
  async function addEntry(title, url, favicon) {
    if (!url || url.startsWith('about:') || url.startsWith('data:')) return;
    await window.discowlAPI.history.add({ title: title || url, url, favicon: favicon || '' });
    _history = await window.discowlAPI.history.get();
    render();
  }

  /* ── Clear ─────────────────────────────────────────────────── */
  async function clearAll() {
    if (!confirm('Clear all history?')) return;
    await window.discowlAPI.history.clear();
    _history = [];
    render();
    showToast('History cleared', 'info');
  }

  /* ── Delete single ─────────────────────────────────────────── */
  async function deleteEntry(id) {
    await window.discowlAPI.history.delete(id);
    _history = _history.filter(h => h.id !== id);
    render();
  }

  /* ── Filter ────────────────────────────────────────────────── */
  function filtered() {
    if (!_filterText) return _history;
    const q = _filterText.toLowerCase();
    return _history.filter(h =>
      h.title?.toLowerCase().includes(q) ||
      h.url?.toLowerCase().includes(q)
    );
  }

  /* ── Group by date ─────────────────────────────────────────── */
  function groupByDate(items) {
    const groups = {};
    const now = Date.now();
    const today     = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

    for (const item of items) {
      const d = new Date(item.timestamp);
      d.setHours(0,0,0,0);
      let label;
      if (d.getTime() === today.getTime())     label = "Today";
      else if (d.getTime() === yesterday.getTime()) label = 'Yesterday';
      else label = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

      if (!groups[label]) groups[label] = [];
      groups[label].push(item);
    }
    return groups;
  }

  /* ── Render ────────────────────────────────────────────────── */
  function render() {
    const list = listEl();
    if (!list) return;
    list.innerHTML = '';

    const items = filtered();
    if (!items.length) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">No history</div>`;
      return;
    }

    const groups = groupByDate(items);

    for (const [date, entries] of Object.entries(groups)) {
      const group = document.createElement('div');
      group.className = 'history-day-group';

      const label = document.createElement('div');
      label.className = 'history-day-label';
      label.textContent = date;
      group.appendChild(label);

      for (const entry of entries) {
        group.appendChild(createHistoryItem(entry));
      }

      list.appendChild(group);
    }
  }

  function createHistoryItem(entry) {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.role = 'listitem';
    div.title = entry.url;

    const favicon = document.createElement('img');
    favicon.className = 'h-favicon';
    favicon.src = entry.favicon || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(entry.url || '')}&sz=16`;
    favicon.onerror = () => {
      favicon.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="%2355556a"/></svg>';
    };

    const title = document.createElement('span');
    title.className = 'h-title';
    title.textContent = entry.title || entry.url;

    const time = document.createElement('span');
    time.className = 'h-time';
    const d = new Date(entry.timestamp);
    time.textContent = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const del = document.createElement('button');
    del.className = 'h-delete';
    del.title = 'Delete';
    del.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteEntry(entry.id); });

    div.appendChild(favicon);
    div.appendChild(title);
    div.appendChild(time);
    div.appendChild(del);

    div.addEventListener('click', () => {
      if (window.DiscowlBrowser) window.DiscowlBrowser.navigate(entry.url);
    });

    return div;
  }

  /* ── Init ──────────────────────────────────────────────────── */
  function init() {
    load();

    searchEl()?.addEventListener('input', (e) => {
      _filterText = e.target.value;
      render();
    });

    document.getElementById('clear-history-btn')?.addEventListener('click', clearAll);

    // Live updates
    window.discowlAPI.history.onUpdated((data) => {
      _history = data;
      render();
    });
  }

  return { init, load, render, addEntry };

})();

window.addEventListener('DOMContentLoaded', () => HistoryManager.init());
window.HistoryManager = HistoryManager;