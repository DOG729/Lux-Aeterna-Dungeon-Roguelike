'use strict';
import { state }           from './state.js';
import { applyConditions } from './conditions.js';
import { api }             from './api.js';

export function $(id) {
  return document.getElementById(id);
}

export const screens = {
  menu:    document.getElementById('screen-menu'),
  dungeon: document.getElementById('screen-dungeon'),
  combat:  document.getElementById('screen-combat')
};

export function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  if (name === 'menu') document.getElementById('btn-continue').classList.toggle('hidden', !state.G);
  applyConditions(screens[name]);
}

// msg may contain inline icon markup (see icon() below) — trusted local strings only.
export function toast(msg) {
  const el = document.getElementById('toast');
  el.innerHTML = msg;
  el.classList.remove('hidden');
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = '';
  setTimeout(() => el.classList.add('hidden'), 2600);
}

// ── Icon manifest (assets/config/icons.json, served via /api/icons) ──────────
// Single source of truth for icon key → file path, so JS never hardcodes an
// image path or filename directly — see icon()/applyIconAttrs() below.

let _icons = null;

export async function loadIcons() {
  try { _icons = await api('GET', '/api/icons'); } catch { _icons = {}; }
}

// Builds an inline "<img class="icon">" tag for use inside innerHTML strings
// (toasts, buttons, labels). `name` is a key from assets/config/icons.json.
export function icon(name, sizeClass = 'icon') { 
  const path = _icons?.[name];
  return `<img class="${sizeClass}" src="/assets/image/${path ?? ''}" alt="">`;
}

// Applies the icon manifest to any static <img data-icon="key"> markup
// (e.g. index.html elements that exist before any JS template runs).
export function applyIconAttrs(root = document) {
  root.querySelectorAll('img[data-icon]').forEach(img => {
    const path = _icons?.[img.dataset.icon];
    if (path) img.src = `/assets/image/${path}`;
  });
}

// ── Chat text formatting ────────────────────────────────────────────────────
// NPC dialogue (and players echoing the same convention) writes roleplay actions
// as *some action*, single asterisk open/close. formatChatText() escapes the raw
// text FIRST (this may be player-typed input — never trust it as HTML) and only
// then turns *...* pairs into a styled span, so nothing in the source text can
// itself inject markup.

export function escapeHtml(s) {
  return (s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function formatChatText(text) {
  return escapeHtml(text).replace(/\*([^*]+)\*/g, '<span class="chat-action">$1</span>');
}
