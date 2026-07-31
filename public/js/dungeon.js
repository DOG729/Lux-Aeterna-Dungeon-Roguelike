'use strict';
import { state }         from './state.js';
import { u, ufmt }       from './i18n.js';
import { api }           from './api.js';
import { $, toast, icon } from './dom.js';
import { sfx }           from './sfx.js';
import { renderDungeonMap }        from './map.js';
import { updateSkillsBadge }       from './skills.js';
import { openScavenge } from './scavenge.js';

// ── Dungeon render ────────────────────────────────────────────────────────────

export function renderDungeon() {
  if (!state.G) return;
  const { player } = state.G;
  updateSkillsBadge();

  $('d-hp').textContent    = player.hp;
  $('d-maxhp').textContent = player.maxHp;
  $('d-en').textContent    = player.energy;
  $('d-maxen').textContent = player.maxEnergy;
  $('d-xp').textContent    = player.xp   ?? 0;
  $('d-gold').textContent  = player.gold ?? 0;
  $('d-level').textContent = player.charLevel ?? 1;
  $('d-floor').textContent = state.G.dungeon?.level ?? 1;

  renderInventoryBar();
  renderDungeonMap();
  renderRoomActions();

  // Auto-open scavenge for rooms flagged autoOpen (e.g. start_room)
  const curRoom = state.G.dungeon?.rooms?.find(r => r.gid === state.G.dungeon?.playerPos);
  if (curRoom?.scavenge?.autoOpen && !curRoom.scavenge.visited) openScavenge();
}

function renderInventoryBar() {
  const { player } = state.G;
  const bar = $('inventory-items');
  bar.innerHTML = '';

  const barItems = (player.inventory ?? []).filter(i => i.inventoryBar);

  if (!barItems.length) {
    const c = document.createElement('span');
    c.style.color    = '#555';
    c.style.fontSize = '.75rem';
    c.textContent    = u('inventory', 'empty_bar', 'Пусто');
    bar.appendChild(c);
    return;
  }

  for (const item of barItems) {
    const c = document.createElement('span');
    c.className = 'inv-chip';
    if (item.image) {
      const img = document.createElement('img');
      img.src    = item.image;
      img.style.cssText = 'width:14px;height:14px;object-fit:contain;vertical-align:middle;margin-right:3px';
      img.onerror = () => img.remove();
      c.appendChild(img);
    }
    c.appendChild(document.createTextNode(`${item.name} ×${item.count}`));
    bar.appendChild(c);
  }
}

function renderRoomActions() {
  const panel = $('room-actions');
  if (!panel) return;
  panel.innerHTML = '';

  const dungeon = state.G?.dungeon;
  if (!dungeon || state.G?.combat) { panel.classList.add('hidden'); return; }

  const room = dungeon.rooms?.find(r => r.gid === dungeon.playerPos);
  if (!room?.discovered) { panel.classList.add('hidden'); return; }

  const items = [];

  for (const obj of room.objects ?? []) {
    if (obj.opened) continue;
    const isLocked = obj.locked && !dungeon.hasKey;

    let label, btnClass = '', onClick = null;
    if (obj.action === 'chest') {
      label   = u('room', 'open', 'Открыть');
      onClick = () => interactWith(obj.instanceId);
    } else if (obj.action === 'door') {
      label    = isLocked ? `${icon('lock', 'icon icon-sm')} ${u('room', 'locked', 'Заперта')}` : u('room', 'enter', 'Войти');
      btnClass = isLocked ? ' locked' : '';
      onClick  = isLocked ? null : () => interactWith(obj.instanceId);
    } else {
      label   = u('room', 'pickup', 'Подобрать');
      onClick = () => interactWith(obj.instanceId);
    }

    const div  = document.createElement('div');
    div.className = 'ra-item';
    const icon = document.createElement('img');
    icon.className = 'ra-icon';
    icon.src = obj.image ?? '';
    icon.onerror = () => { icon.style.display = 'none'; };
    const name = document.createElement('span');
    name.className   = 'ra-name';
    name.textContent = obj.name ?? '';
    const btn = document.createElement('button');
    btn.className = 'ra-btn' + btnClass;
    btn.innerHTML = label;
    if (onClick) btn.addEventListener('click', onClick);
    else btn.disabled = true;

    div.appendChild(icon); div.appendChild(name); div.appendChild(btn);
    items.push(div);
  }

  if (room.hasNpc && room.npcInstanceId) {
    const div  = document.createElement('div');
    div.className = 'ra-item';
    const icon = document.createElement('img');
    icon.className = 'ra-icon';
    icon.src = room.npcImage ?? '';
    icon.onerror = () => { icon.style.display = 'none'; };
    const name = document.createElement('span');
    name.className   = 'ra-name';
    name.textContent = room.npcName ?? 'NPC';
    const btn = document.createElement('button');
    btn.className   = 'ra-btn';
    btn.textContent = u('room', 'talk', 'Говорить');
    btn.addEventListener('click', () => window.openNpc(room.npcInstanceId));
    div.appendChild(icon); div.appendChild(name); div.appendChild(btn);
    items.push(div);
  }

  // Eye icon — scavenge available in this room
  const sc = room.scavenge;
  console.log(sc);
  if (sc && (!sc.visited || sc.repeatOpen)) {
    const div = document.createElement('div');
    div.className = 'ra-item';
    const icon = document.createElement('img');
    icon.className = 'ra-icon scavenge-eye-icon';
    icon.src = '/assets/image/views_close.png';
    const name = document.createElement('span');
    name.className   = 'ra-name';
    name.textContent = u('scavenge', sc.scene, sc.name ?? '');
    const btn = document.createElement('button');
    btn.className = 'ra-btn-scavenge';
    btn.textContent = u('scavenge', 'look_name', 'Осмотреться');
    btn.addEventListener('click', () => openScavenge(undefined, undefined, { zoom: true }));
    div.appendChild(icon); 
    div.appendChild(name); 
    div.appendChild(btn);
    items.push(div);
  }

  if (!items.length) { panel.classList.add('hidden'); return; }
  items.forEach(el => panel.appendChild(el));
  panel.classList.remove('hidden');
}

// ── Navigation & interaction ──────────────────────────────────────────────────

export async function moveTo(direction) {
  if (state.busy) return;
  state.busy = true;

  const data = await api('POST', '/api/move', { direction });
  if (data.error) { toast(data.error); state.busy = false; return; }
  state.G    = data;
  state.busy = false;

  sfx.playUi('dungeon_move');

  if (data.combatStarted || state.G.combat) {
    renderDungeon();
    window.enterCombat(); // set by combat.js
  } else {
    renderDungeon();
  }
}

export async function interactWith(objectId) {
  if (state.busy) return;
  state.busy = true;

  const data = await api('POST', '/api/interact', { objectId });
  state.busy = false;

  if (data.error) { toast(data.error); return; }

  // UI sound based on interaction type reported by server
  if      (data.interactType === 'chest') sfx.playUi('chest_open');
  else if (data.interactType === 'key')   sfx.playUi('item_pickup_key');
  else if (data.interactType === 'item')  sfx.playUi('item_pickup');
  else if (data.interactType === 'door')  sfx.playUi('dungeon_stairs');

  if (data.levelUp) {
    state.G = data;
    sfx.playUi('level_up');
    $('lu-title').textContent = ufmt('dungeon', 'level_title', { level: data.newLevel }, `Уровень ${data.newLevel}!`);
    $('lu-sub').textContent   = u('dungeon', 'level_sub', 'Подземелье углубляется…');
    $('modal-levelup').classList.remove('hidden');
    return;
  }
  state.G = data;
  if (data.message) toast(data.message);
  renderDungeon();
}

// Expose on window — called from map.js event listeners and npc/combat cross-module
window.moveTo      = moveTo;
window.interactWith = interactWith;
window.renderDungeon = renderDungeon;
