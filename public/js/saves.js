'use strict';
import { state }       from './state.js';
import { u, ufmt }     from './i18n.js';
import { api }         from './api.js';
import { $, showScreen, toast, icon } from './dom.js';
import { sfx }                  from './sfx.js';
import { closeScavenge }        from './scavenge.js';
import { ensureAiReady }        from './ai_check.js';

let _savesFromGameover = false;

export async function openSavesList(fromGameover = false) {
  _savesFromGameover = fromGameover;
  const saves = await api('GET', '/api/saves');
  const list  = $('saves-list');
  list.innerHTML = '';

  if (!saves.length) {
    list.innerHTML = `<p style="color:#666;font-size:.82rem;text-align:center">${u('saves', 'empty', 'Сохранений нет')}</p>`;
  } else {
    for (const s of saves) {
      const el = document.createElement('div');
      el.className = 'save-entry';
      el.innerHTML = `
        <div class="save-main">
          <div class="save-info">${ufmt('saves', 'save_info', { level: s.level ?? '?', hp: s.hp ?? '?', xp: s.xp ?? '?', gold: `${icon('gold', 'icon icon-sm')} ${s.gold ?? 0}` }, `Уровень ${s.level ?? '?'} · HP ${s.hp ?? '?'} · XP ${s.xp ?? '?'} · {gold}`)}</div>
          <div class="save-date">${s.id.replace(/-/g, ' ').substring(0, 16)}</div>
        </div>
        <button class="save-del-btn" title="${u('saves', 'delete_btn_title', 'Удалить')}">✕</button>
      `;
      el.querySelector('.save-main').addEventListener('click', () => loadSave(s.id));
      el.querySelector('.save-del-btn').addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(u('saves', 'delete_confirm', 'Удалить это сохранение?'))) return;
        await api('DELETE', `/api/saves/${s.id}`);
        openSavesList(_savesFromGameover);
      });
      list.appendChild(el);
    }
  }
  $('modal-saves').classList.remove('hidden');
}

export async function loadSave(id) {
  if (!await ensureAiReady()) return;
  _savesFromGameover = false;
  $('modal-saves').classList.add('hidden');
  $('modal-gameover').classList.add('hidden');
  closeScavenge();
  await api('POST', '/api/quit');
  const data = await api('POST', '/api/load', { saveId: id });
  if (data.error) { alert(data.error); return; }
  state.G = data;
  showScreen('dungeon');
  window.renderDungeon();
}

export async function saveGame() {
  const data = await api('POST', '/api/save');
  if (data.ok) {
    sfx.playUi('save_game');
    toast(`${icon('save', 'icon icon-sm')} ${ufmt('saves', 'saved_toast', { id: data.saveId }, `Сохранено: ${data.saveId}`)}`);
  }
}

export function getSavesFromGameover() { return _savesFromGameover; }
export function clearSavesFromGameover() { _savesFromGameover = false; }
