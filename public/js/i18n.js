'use strict';
import { state } from './state.js';

export function u(cat, key, fb = '') {
  return state.UI[cat]?.[key] ?? fb;
}

export function ufmt(cat, key, vars, fb = '') {
  let s = u(cat, key, fb);
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function applyHtmlI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const [cat, key] = el.dataset.i18n.split('.');
    const text = u(cat, key);
    if (text) el.textContent = text;
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const [cat, key] = el.dataset.i18nTitle.split('.');
    const text = u(cat, key);
    if (text) el.title = text;
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const [cat, key] = el.dataset.i18nPlaceholder.split('.');
    const text = u(cat, key);
    if (text) el.placeholder = text;
  }
}
