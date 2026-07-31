'use strict';
import { state }    from './state.js';
import { u }        from './i18n.js';
import { api }      from './api.js';
import { $ }        from './dom.js';

export async function openJournal() {
  if (!state.G) return;
  const entries = await api('GET', '/api/journal');
  const list    = $('journal-list');
  list.innerHTML = '';

  if (!entries.length) {
    list.innerHTML = `<div class="journal-empty">${u('journal', 'empty', 'Журнал пуст')}</div>`;
  } else {
    for (const e of [...entries].reverse()) {
      const el = document.createElement('div');
      el.className = `journal-entry journal-${e.type}`;
      el.innerHTML = `<span class="journal-level-tag">Ур.${e.dungeonLevel}</span>${e.text}`;
      list.appendChild(el);
    }
  }
  $('modal-journal').classList.remove('hidden');
}
