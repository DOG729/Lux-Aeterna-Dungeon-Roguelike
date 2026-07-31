'use strict';
import { state } from './state.js';
import { $, showScreen } from './dom.js';
import { u } from './i18n.js';

export const TILE    = 200;
export const CORR    = 25;
export const OVERLAP = 50;
export const PITCH   = TILE + CORR;
export const DELTAS  = { right: [1,0], left: [-1,0], bottom: [0,1], top: [0,-1] };

function getDir(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx ===  1) return 'right';
  if (dx === -1) return 'left';
  if (dy ===  1) return 'bottom';
  return 'top';
}

export function renderDungeonMap() {
  const { G } = state;
  const { dungeon } = G;
  const rooms  = dungeon.rooms;
  const mapEl  = $('dng-map');
  mapEl.innerHTML = '';

  if (!rooms?.length) return;

  const xs   = rooms.map(r => r.x);
  const ys   = rooms.map(r => r.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const maxX = Math.max(...xs), maxY = Math.max(...ys);

  mapEl.style.width  = (CORR + (maxX - minX) * PITCH + TILE + CORR) + 'px';
  mapEl.style.height = (CORR + (maxY - minY) * PITCH + TILE + CORR) + 'px';

  const curRoom = rooms.find(r => r.gid === dungeon.playerPos);
  const adjGids = new Set();
  if (curRoom) {
    for (const [dir, [dx, dy]] of Object.entries(DELTAS)) {
      if (curRoom.passages[dir]) adjGids.add(`${curRoom.x + dx},${curRoom.y + dy}`);
    }
  }

  const pxOf = r => CORR + (r.x - minX) * PITCH;
  const pyOf = r => CORR + (r.y - minY) * PITCH;

  let curPx = 0, curPy = 0;

  for (const room of rooms) {
    const px = pxOf(room);
    const py = pyOf(room);
    const isCur = room.gid === dungeon.playerPos;
    const isAdj = adjGids.has(room.gid);

    if (isCur) { curPx = px; curPy = py; }

    const tile = document.createElement('div');
    tile.className = 'map-tile';
    tile.style.left   = px + 'px';
    tile.style.top    = py + 'px';
    tile.style.width  = TILE + 'px';
    tile.style.height = TILE + 'px';
    tile.style.backgroundImage = `url("${room.image}")`;

    if      (isCur)            tile.classList.add('current');
    else if (isAdj)            tile.classList.add('adjacent');
    else if (!room.discovered) tile.classList.add('fog');

    // Click on adjacent tile → move (window.moveTo set by dungeon.js)
    if (isAdj && curRoom) {
      const dir = getDir(curRoom, room);
      tile.addEventListener('click', () => window.moveTo(dir));
    }

    if (isCur) {
      const pawn = document.createElement('img');
      pawn.src       = '/assets/player/pawn.png';
      pawn.className = 'map-pawn';
      tile.appendChild(pawn);
    }

    if (room.discovered) {
      let objIndex = 0;
      for (const obj of room.objects ?? []) {
        if (obj.opened) continue;
        const icon = document.createElement('img');
        icon.src       = obj.image;
        icon.className = `map-obj map-obj-${objIndex++}`;
        icon.title     = (obj.locked && !dungeon.hasKey) ? `🔒 ${obj.name}` : obj.name;
        if (isCur) {
          icon.style.cursor = 'var(--cursor-pointer)';  
          icon.addEventListener('click', e => {
            e.stopPropagation();
            window.interactWith(obj.instanceId);
          });
        }
        tile.appendChild(icon);
      }

      if (room.hasBoss) {
        const pawn = document.createElement('img');
        pawn.src       = room.mobPawn ?? '';
        pawn.className = 'map-boss-pawn';
        pawn.title     = room.mobName ?? 'Boss';
        pawn.onerror   = () => {
          pawn.remove();
          const dot = document.createElement('div');
          dot.className = 'map-boss-dot';
          tile.appendChild(dot);
        };
        tile.appendChild(pawn);
      } else if (room.hasMob) {
        const dot = document.createElement('div');
        dot.className = 'map-mob-dot';
        tile.appendChild(dot);
      }

      if (room.hasNpc) {
        const pawn = document.createElement('img');
        pawn.src       = room.npcPawn ?? '';
        pawn.className = 'map-npc-pawn';
        pawn.title     = room.npcName ?? 'NPC';
        pawn.onerror   = () => pawn.remove();
        if (isCur) {
          pawn.style.cursor = 'var(--cursor-pointer)'; 
          pawn.addEventListener('click', e => {
            e.stopPropagation();
            window.openNpc(room.npcInstanceId);
          });
        }
        tile.appendChild(pawn);
      }
    }

    mapEl.appendChild(tile);

    if (room.passages.right) {
      const c = document.createElement('img');
      c.src          = '/assets/map/transition_01.png';
      c.className    = 'map-corr' + (isCur ? '' : ' fog');
      c.style.left   = (px + TILE - OVERLAP) + 'px';
      c.style.top    = (py + TILE / 2 - 22) + 'px';
      c.style.width  = (CORR + OVERLAP * 2) + 'px';
      c.style.height = '45px';
      mapEl.appendChild(c);
    }
    if (room.passages.bottom) {
      const c = document.createElement('img');
      c.src          = '/assets/map/transition_0.png';
      c.className    = 'map-corr' + (isCur ? '' : ' fog');
      c.style.left   = (px + TILE / 2 - 28) + 'px';
      c.style.top    = (py + TILE - OVERLAP) + 'px';
      c.style.width  = '50px';
      c.style.height = (CORR + OVERLAP * 2) + 'px';
      mapEl.appendChild(c);
    }
  }

  const wrap = $('dng-map-wrap');
  setTimeout(() => {
    wrap.scrollTo({
      left: curPx - wrap.clientWidth  / 2 + TILE / 2,
      top:  curPy - wrap.clientHeight / 2 + TILE / 2,
      behavior: 'smooth'
    });
  }, 40);
}
