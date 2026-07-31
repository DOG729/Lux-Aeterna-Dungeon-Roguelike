'use strict';
import { state }       from './state.js';
import { u }           from './i18n.js';
import { api }         from './api.js';
import { $, toast, icon } from './dom.js';
import { sfx }         from './sfx.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _equipCfg = null;

const SLOT_ICONS = { weapon: 'attack', shield: 'shield', amulet: 'amulet', ring: 'ring' };

function slotLabels() {
  const cfg = _equipCfg ?? {};
  return Object.fromEntries(
    Object.entries(cfg).map(([slot, def]) => {
      const text = u('equip', slot, def.name ?? slot);
      const ic   = SLOT_ICONS[slot];
      return [slot, ic ? `${icon(ic, 'icon icon-sm')} ${text}` : text];
    })
  );
}

function formatStats(stats) {
  if (!stats) return '';
  return [
    stats.attack ? `${icon('attack', 'icon icon-sm')} +${stats.attack}` : '',
    stats.defend ? `${icon('shield', 'icon icon-sm')} +${stats.defend}` : '',
    stats.hp     ? `${icon('hp', 'icon icon-sm')} +${stats.hp}`         : '',
    stats.energy ? `${icon('energy', 'icon icon-sm')} +${stats.energy}` : ''
  ].filter(Boolean).join('  ');
}

// ── Tooltip (desktop grid) ────────────────────────────────────────────────────

let _tooltip        = null;
let _globalClkReady = false;

function _getTooltip() {
  if (!_tooltip) {
    _tooltip = document.createElement('div');
    _tooltip.id = 'inv-bag-tooltip';
    _tooltip.classList.add('hidden');
    _tooltip.addEventListener('click', e => e.stopPropagation());
  }
  const panel = document.querySelector('.inv-bag-panel');
  if (panel && _tooltip.parentElement !== panel) panel.appendChild(_tooltip);
  return _tooltip;
}

function _showTooltip(cell, item, btnsHtml) {
  const tt = _getTooltip();

  const useHint = item.use
    ? (item.use.out_combat && item.use.in_combat
        ? u('inventory', 'both',           'Вне боя / в бою')
        : item.use.in_combat
          ? u('inventory', 'in_combat_only', 'Только в бою')
          : u('inventory', 'out_combat_only','Только вне боя'))
    : '';

  tt.innerHTML = `
    <div class="inv-tt-name">${item.name}</div>
    ${item.stats ? `<div class="inv-tt-stats">${formatStats(item.stats)}</div>` : ''}
    ${item.use   ? `<div class="inv-tt-hint">${useHint}</div>`                 : ''}
    ${btnsHtml   ? `<div class="inv-tt-btns">${btnsHtml}</div>`               : ''}`;

  tt.classList.remove('hidden');

  // Position below the clicked cell (Diablo-style); fall back to above if needed
  const panel = tt.parentElement;
  if (!panel) return;
  const panelRect  = panel.getBoundingClientRect();
  const cellRect   = cell.getBoundingClientRect();
  const ttH        = tt.offsetHeight || 90;
  const INNER_TOP  = 62;                        // px from panel top
  const innerBot   = panel.offsetHeight - 62;   // px from panel top

  const cellTop    = cellRect.top  - panelRect.top;
  const cellBottom = cellTop + cellRect.height + 4;

  let top;
  if (cellBottom + ttH <= innerBot) {
    top = cellBottom;                     // fits below → show below
  } else if (cellTop - ttH - 4 >= INNER_TOP) {
    top = cellTop - ttH - 4;             // fits above → show above
  } else {
    top = INNER_TOP + 2;                  // fallback: top of inner area
  }
  tt.style.top = `${top}px`;
}

function _hideTooltip() {
  _tooltip?.classList.add('hidden');
  document.querySelectorAll('#inv-items .inv-item.inv-item-active')
    .forEach(el => el.classList.remove('inv-item-active'));
}

function _initGlobalClick() {
  if (_globalClkReady) return;
  _globalClkReady = true;
  document.addEventListener('click', e => {
    if (!e.target.closest('#inv-items') && !e.target.closest('#inv-bag-tooltip')) {
      _hideTooltip();
    }
  });
}

// ── Tabs (init once) ──────────────────────────────────────────────────────────

let _tabsReady = false;

function _initTabs() {
  if (_tabsReady) return;
  _tabsReady = true;
  document.querySelectorAll('.inv-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.inv-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.inv-tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(`inv-panel-${btn.dataset.tab}`)?.classList.remove('hidden');
    });
  });
}

// ── Переместить #inv-items в правильный контейнер ────────────────────────────
// Десктоп: внутрь .inv-bag-inner (кожаный рюкзак-окно)
// Мобилка: внутрь .inv-tab-bag-inner (рюкзак внутри таб-панели)

function _placeItems() {
  const el     = document.getElementById('inv-items');
  if (!el) return;
  const mobile = window.innerWidth <= 720;
  const target = mobile
    ? document.querySelector('.inv-tab-bag-inner')
    : document.querySelector('.inv-bag-inner');
  if (target && el.parentElement !== target) target.appendChild(el);
}

window.addEventListener('resize', () => {
  if (!$('modal-inventory').classList.contains('hidden')) _placeItems();
}, { passive: true });

// ── Public: open inventory ────────────────────────────────────────────────────

export async function openInventory() {
  if (!_equipCfg) _equipCfg = await api('GET', '/api/equip-config');
  _initTabs();
  _initGlobalClick();
  _placeItems();
  renderInventoryModal();
  $('modal-inventory').classList.remove('hidden');
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderInventoryModal() {
  if (!state.G) return;
  const { player } = state.G;
  const inCombat   = !!state.G.combat;

  _renderEquip(player, inCombat);
  _renderStats(player);
  _renderBag(player, inCombat);
}

// ── Equipment tab ─────────────────────────────────────────────────────────────

function _renderEquip(player, inCombat) {
  const slotsEl = $('inv-slots');
  slotsEl.innerHTML = '';

  for (const [slot, label] of Object.entries(slotLabels())) {
    const item = player.equip?.[slot];
    const div  = document.createElement('div');
    div.className = 'equip-slot' + (item ? ' filled' : '');

    if (item) {
      div.innerHTML = `
        <div class="equip-slot-label">${label}</div>
        <img class="equip-slot-img" src="${item.image}" alt="${item.name}" onerror="this.style.display='none'">
        <div class="equip-slot-info">
          <div class="equip-slot-name">${item.name}</div>
          ${item.stats ? `<div class="equip-slot-stats">${formatStats(item.stats)}</div>` : ''}
        </div>
        <button class="slot-btn" onclick="unequipItem('${slot}')" ${inCombat ? 'disabled' : ''}>
          ${u('inventory', 'unequip_btn', 'Снять')}
        </button>`;
    } else {
      div.innerHTML = `
        <div class="equip-slot-label">${label}</div>
        <div class="equip-slot-empty">${u('inventory', 'slot_empty', '— пусто')}</div>`;
    }
    slotsEl.appendChild(div);
  }
}

// ── Stats tab ─────────────────────────────────────────────────────────────────

function _renderStats(player) {
  const hpPct  = player.maxHp     ? player.hp     / player.maxHp     : 0;
  const enPct  = player.maxEnergy ? player.energy / player.maxEnergy : 0;

  // Боевые показатели живут в state.G.abilities, не в player напрямую
  const ab      = state.G?.abilities ?? {};
  const attack  = ab.attack?.int  != null ? Math.round(ab.attack.int)  : '—';
  const defend  = ab.defend?.int  != null ? Math.round(ab.defend.int)  : '—';

  const xpNext  = player.nextLevelXp != null ? player.nextLevelXp : 'MAX';

  const row  = (label, value) =>
    `<div class="inv-stat-row">
       <span class="inv-stat-label">${label}</span>
       <span class="inv-stat-value">${value}</span>
     </div>`;

  const bar = (label, value, max, pct, cls) =>
    `<div class="inv-stat-row">
       <span class="inv-stat-label">${label}</span>
       <div class="inv-stat-bar-wrap"><div class="inv-stat-bar ${cls}" style="width:${Math.min(1, pct) * 100}%"></div></div>
       <span class="inv-stat-value">${value}/${max}</span>
     </div>`;

  const sep = label => `<div class="inv-stat-sep">${label}</div>`;

  const statHp     = `${icon('hp', 'icon icon-sm')} ${u('inventory', 'stat_hp', 'HP')}`;
  const statEnergy = `${icon('energy', 'icon icon-sm')} ${u('inventory', 'stat_energy', 'Энергия')}`;
  const statExp    = `${icon('xp', 'icon icon-sm')} ${u('inventory', 'stat_xp', 'Опыт')}`;

  $('inv-player-stats').innerHTML = [
    bar(statHp,     player.hp     ?? 0, player.maxHp     ?? 0, hpPct, 'hp'),
    bar(statEnergy, player.energy ?? 0, player.maxEnergy ?? 0, enPct, 'energy'),
    sep(u('inventory', 'stat_combat_sep',   'Боевые')),
    row(`${icon('attack', 'icon icon-sm')} ${u('inventory', 'stat_attack', 'Атака')}`,   attack),
    row(`${icon('shield', 'icon icon-sm')} ${u('inventory', 'stat_defend', 'Защита')}`,  defend),
    sep(u('inventory', 'stat_progress_sep', 'Прогресс')),
    row(`${icon('target',  'icon icon-sm')} ${u('inventory', 'stat_level', 'Уровень')}`, player.charLevel ?? 1),
    row(statExp, `${player.xp ?? 0} / ${xpNext}`),
    row(`${icon('compass', 'icon icon-sm')} ${u('inventory', 'stat_floor', 'Этаж')}`,    player.floor ?? 1),
    sep(u('inventory', 'stat_history_sep',  'История')),
    row(`${icon('skull',   'icon icon-sm')} ${u('inventory', 'stat_kills', 'Убито')}`,   player.kills ?? 0),
  ].join('');
}

// ── Bag tab ───────────────────────────────────────────────────────────────────

function _renderBag(player, inCombat) {
  const itemsEl = $('inv-items');
  itemsEl.innerHTML = '';
  _hideTooltip();  // clear stale tooltip from previous render

  const inv = player.inventory ?? [];

  if (!inv.length) {
    itemsEl.innerHTML = `<p style="color:rgba(200,175,120,.35);font-size:.72rem;text-align:center;padding:32px 0;font-style:italic">${u('inventory', 'empty_bar', 'Пусто')}</p>`;
    return;
  }

  for (const item of inv) {
    const div = document.createElement('div');
    div.className = 'inv-item';

    // Build action buttons HTML (used both inline on mobile and in tooltip on desktop)
    let btns = '';
    if (item.equip) {
      btns += `<button class="inv-action-btn equip-btn" onclick="equipItem('${item.id}')" ${inCombat ? 'disabled' : ''}>${u('inventory', 'equip_btn', 'Надеть')}</button>`;
    }
    if (item.use) {
      const canUse   = inCombat ? !!item.use.in_combat : !!item.use.out_combat;
      const hint     = !canUse ? (inCombat ? u('inventory', 'out_combat_only', 'Только вне боя') : u('inventory', 'in_combat_only', 'Только в бою')) : '';
      const useLabel = inCombat && item.use.in_combat ? u('inventory', 'drink_btn', 'Выпить') : u('inventory', 'use_btn', 'Использовать');
      btns += `<button class="inv-action-btn use-btn" onclick="useItem('${item.id}')" ${canUse ? '' : `disabled title="${hint}"`}>${useLabel}</button>`;
    }

    const useHint = item.use
      ? (item.use.out_combat && item.use.in_combat
          ? u('inventory', 'both',          'Вне боя / в бою')
          : item.use.in_combat
            ? u('inventory', 'in_combat_only', 'Только в бою')
            : u('inventory', 'out_combat_only', 'Только вне боя'))
      : '';

    // Unified HTML — CSS switches layout between desktop grid and mobile list
    div.innerHTML = `
      <img class="inv-item-img" src="${item.image}" alt="${item.name}" onerror="this.style.visibility='hidden'">
      <span class="inv-item-badge">×${item.count}</span>
      <div class="inv-item-info">
        <div class="inv-item-name">${item.name}</div>
        ${item.stats ? `<div class="inv-item-stats">${formatStats(item.stats)}</div>` : ''}
        ${item.use   ? `<div class="inv-item-hint">${useHint}</div>`                 : ''}
        <div class="inv-item-count">×${item.count}</div>
      </div>
      <div class="inv-item-btns">${btns}</div>`;

    // Desktop grid: click toggles tooltip card
    div.addEventListener('click', e => {
      if (!div.closest('.inv-bag-inner')) return;  // mobile path — skip
      e.stopPropagation();
      const wasActive = div.classList.contains('inv-item-active');
      _hideTooltip();
      if (!wasActive) {
        div.classList.add('inv-item-active');
        _showTooltip(div, item, btns);
      }
    });

    itemsEl.appendChild(div);
  }
}

// ── API actions ───────────────────────────────────────────────────────────────

export async function equipItem(itemId) {
  const data = await api('POST', '/api/equip', { itemId });
  if (data.error) { toast(data.error); return; }
  state.G = data;
  sfx.playUi('item_equip');
  renderInventoryModal();
  window.renderDungeon();
}

export async function unequipItem(slot) {
  const data = await api('POST', '/api/unequip', { slot });
  if (data.error) { toast(data.error); return; }
  state.G = data;
  sfx.playUi('item_unequip');
  renderInventoryModal();
  window.renderDungeon();
}

export async function useItem(itemId) {
  const data = await api('POST', '/api/use-item', { itemId });
  if (data.error) { toast(data.error); return; }
  if (data.message) toast(data.message);
  sfx.playUi('item_use');
  state.G = data;
  if (!$('modal-inventory').classList.contains('hidden')) renderInventoryModal();
  if (state.G.combat) window.renderCombat?.(); else window.renderDungeon();
}

// Expose on window — called from inline onclick attributes
window.equipItem   = equipItem;
window.unequipItem = unequipItem;
window.useItem     = useItem;
