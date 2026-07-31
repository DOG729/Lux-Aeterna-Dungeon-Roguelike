'use strict';
// ── State ─────────────────────────────────────────────────────────────────────
let manifest        = null;
let level           = 1;
let rooms           = {};
let selected        = null;   // "x,y"
let palTab          = 'sections';
let palSel          = null;   // { tab, id }
let currentPlanFile = null;

const CELL  = 100;
const PAD   = 3;
const OPP   = { right: 'left', left: 'right', bottom: 'top', top: 'bottom' };
const DELTA = { right: [1, 0], left: [-1, 0], bottom: [0, 1], top: [0, -1] };

const $ = id => document.getElementById(id);

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
  const res  = await fetch('/api/manifest');
  manifest   = await res.json();

  document.querySelectorAll('.pal-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      palTab = btn.dataset.tab;
      document.querySelectorAll('.pal-tab').forEach(b => b.classList.toggle('active', b === btn));
      renderPalette();
    });
  });

  $('levelInput').addEventListener('change', e => { level = Math.max(1, +e.target.value || 1); renderPalette(); });
  $('generateBtn').addEventListener('click', generateMap);
  $('loadPlanBtn').addEventListener('click', loadPlan);
  $('savePlanBtn').addEventListener('click', savePlan);
  $('exportBtn').addEventListener('click', exportMap);
  $('clearBtn').addEventListener('click', () => {
    if (!confirm('Очистить карту?')) return;
    rooms = {}; selected = null; currentPlanFile = null;
    renderGrid(); renderInspector();
  });

  document.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected && document.activeElement === document.body) deleteRoom(selected);
    if (e.key === 'Escape') { selected = null; palSel = null; renderGrid(); renderPalette(); renderInspector(); }
  });

  await refreshPlanList();
  renderPalette();
  renderGrid();
}

// ── Map generation ────────────────────────────────────────────────────────────
async function generateMap() {
  if (Object.keys(rooms).length && !confirm('Сгенерировать новую карту? Текущая будет очищена.')) return;
  setStatus('Генерация...');
  const res  = await fetch(`/api/generate?level=${level}`);
  const data = await res.json();
  if (!res.ok) { setStatus(data.error ?? 'Ошибка'); return; }
  rooms = {}; selected = null; currentPlanFile = null;
  for (const [gid, rd] of Object.entries(data.rooms)) {
    rooms[gid] = { x: rd.x, y: rd.y, sectionId: rd.sectionId, type: rd.type ?? 'normal', passages: { ...rd.passages }, mob: null, mobChance: null, npc: null, objects: [], events: null };
  }
  renderGrid(); renderInspector();
  setStatus(`Сгенерировано ${Object.keys(rooms).length} комнат`);
}

// ── Plans ─────────────────────────────────────────────────────────────────────
async function refreshPlanList() {
  const files = await fetch('/api/plans').then(r => r.json());
  const sel   = $('planSelect');
  const prev  = sel.value;
  sel.innerHTML = '<option value="">-- план --</option>';
  for (const f of files) {
    const opt = document.createElement('option');
    opt.value = f; opt.textContent = f;
    if (f === prev) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function loadPlan() {
  const file = $('planSelect').value;
  if (!file) { setStatus('Выберите файл'); return; }
  if (Object.keys(rooms).length && !confirm('Загрузить карту? Текущая будет очищена.')) return;
  const plan = await fetch(`/api/plans/${file}`).then(r => r.json());
  rooms = {}; selected = null;
  for (const [gid, rd] of Object.entries(plan.rooms)) {
    rooms[gid] = { x: rd.x, y: rd.y, sectionId: rd.sectionId, type: rd.type ?? 'normal', passages: { ...rd.passages }, mob: rd.spawn_mob?.[0] ?? null, mobChance: rd.chance_spawn_mob ?? null, npc: rd.spawn_npc?.[0] ?? null, objects: rd.spawn_object ?? [], events: rd.events ?? null };
  }
  currentPlanFile = file;
  const m = file.match(/(\d+)/);
  if (m) { level = +m[1]; $('levelInput').value = level; renderPalette(); }
  renderGrid(); renderInspector();
  setStatus(`Загружено: ${file}`);
}

async function savePlan() {
  if (!Object.keys(rooms).length) { setStatus('Карта пустая'); return; }
  let file = currentPlanFile;
  if (!file) {
    file = prompt('Имя файла (без .json):', `map_level_${level}_1`);
    if (!file) return;
    if (!file.endsWith('.json')) file += '.json';
  }
  const spawnRoom = Object.values(rooms).find(r => r.type === 'spawn');
  if (!spawnRoom) { setStatus('Нет spawn-комнаты!'); return; }
  const offX = spawnRoom.x, offY = spawnRoom.y;
  const out  = { rooms: {} };
  for (const room of Object.values(rooms)) {
    const nx = room.x - offX, ny = room.y - offY;
    const gid = `${nx},${ny}`;
    const sec = manifest.map.section.find(s => s.id === room.sectionId);
    const entry = { x: nx, y: ny, type: room.type, sectionId: room.sectionId, image: sec?.image ?? '', passages: { ...room.passages } };
    if (room.mob)           { entry.spawn_mob = [room.mob]; if (room.mobChance != null) entry.chance_spawn_mob = room.mobChance; }
    if (room.npc)             entry.spawn_npc    = [room.npc];
    if (room.objects?.length) entry.spawn_object = [...room.objects];
    if (room.events && Object.values(room.events).some(Boolean)) entry.events = { ...room.events };
    out.rooms[gid] = entry;
  }
  const res = await fetch(`/api/plans/${file}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) });
  if (res.ok) { currentPlanFile = file; await refreshPlanList(); $('planSelect').value = file; setStatus(`Сохранено: ${file}`); }
  else { setStatus('Ошибка сохранения'); }
}

// ── Level helpers ─────────────────────────────────────────────────────────────
function parseLevels(spec) {
  if (!spec) return null;
  const arr = Array.isArray(spec) ? spec : [spec];
  const s = new Set();
  for (const item of arr) {
    if (typeof item === 'number') { s.add(item); continue; }
    const m = String(item).match(/^(\d+)-(\d+)$/);
    if (m) for (let i = +m[1]; i <= +m[2]; i++) s.add(i);
    else { const n = Number(item); if (!isNaN(n)) s.add(n); }
  }
  return s;
}
function levelOk(spec, lv) { return !spec || parseLevels(spec).has(lv); }

// ── Palette ───────────────────────────────────────────────────────────────────
function renderPalette() {
  const list = $('paletteList');
  list.innerHTML = '';
  let items = [];
  if (palTab === 'sections') {
    items = manifest.map.section.map(s => ({ id: s.id, name: s.id, img: `/assets/map/${s.image}`, rec: levelOk(s.level, level), sub: passageStr(s.passage) + (s.always ? ' [always]' : '') }));
  } else if (palTab === 'mobs') {
    items = manifest.mobs.map(m => ({ id: m.id, name: m.name, img: m.imags?.default ? `/assets/mob/${m.imags.default}` : null, rec: levelOk(m.level, level), sub: `HP:${m.hp} ATK:${m.function?.attack?.int ?? '?'}` }));
  } else if (palTab === 'npcs') {
    items = manifest.npcs.map(n => ({ id: n.id, name: n.name, img: n.icon ? `/assets/npc/${n.icon}` : null, rec: levelOk(n.level, level), sub: n.type ?? 'npc' }));
  } else {
    items = manifest.objects.map(o => ({ id: o.id, name: o.name, img: o.image ? `/assets/object/${o.image}` : null, rec: levelOk(o.level, level), sub: `${o.action}${o.weight != null ? ' w:' + o.weight : ''}` }));
  }
  items.sort((a, b) => (b.rec ? 1 : 0) - (a.rec ? 1 : 0));
  for (const item of items) {
    const el = document.createElement('div');
    const isActive = palSel?.tab === palTab && palSel?.id === item.id;
    el.className = 'palette-item' + (item.rec ? '' : ' dimmed') + (isActive ? ' active' : '');
    el.innerHTML = `${item.img ? `<img class="palette-img" src="${item.img}" onerror="this.src='';this.style.background='#0d1117'">` : '<div class="palette-img"></div>'}
      <div class="palette-info">
        <div class="palette-name">${item.name}${item.rec ? ' <span class="rec-badge">✓</span>' : ''}</div>
        <div class="palette-sub">${item.sub}</div>
      </div>`;
    el.addEventListener('click', () => { palSel = { tab: palTab, id: item.id }; renderPalette(); setStatus(`Выбрано: ${item.name}`); });
    list.appendChild(el);
  }
}
function passageStr(p) { return p ? Object.entries(p).filter(([, v]) => v).map(([k]) => k[0].toUpperCase()).join('') || '—' : '—'; }

// ── Grid ──────────────────────────────────────────────────────────────────────
function bounds() {
  const keys = Object.keys(rooms).map(k => k.split(',').map(Number));
  if (!keys.length) return { minX: -2, maxX: 2, minY: -2, maxY: 2 };
  const xs = keys.map(([x]) => x), ys = keys.map(([, y]) => y);
  return { minX: Math.min(...xs) - PAD, maxX: Math.max(...xs) + PAD, minY: Math.min(...ys) - PAD, maxY: Math.max(...ys) + PAD };
}
function adjToRoom(x, y) { return Object.values(DELTA).some(([dx, dy]) => rooms[`${x + dx},${y + dy}`]); }

function renderGrid() {
  const canvas = $('mapCanvas');
  canvas.innerHTML = '';
  const { minX, maxX, minY, maxY } = bounds();
  canvas.style.width  = (maxX - minX + 1) * CELL + 'px';
  canvas.style.height = (maxY - minY + 1) * CELL + 'px';
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const gid  = `${x},${y}`;
      const room = rooms[gid];
      const cx   = (x - minX) * CELL;
      const cy   = (y - minY) * CELL;
      if (room) {
        canvas.appendChild(makeRoomCell(room, cx, cy));
      } else if (!Object.keys(rooms).length || adjToRoom(x, y)) {
        const el = document.createElement('div');
        el.className = 'cell cell-empty';
        el.style.cssText = `left:${cx}px;top:${cy}px`;
        el.innerHTML = '<div class="cell-empty-inner">+</div>';
        el.addEventListener('click', () => placeRoom(x, y));
        canvas.appendChild(el);
      }
    }
  }
}

function makeRoomCell(room, cx, cy) {
  const gid = `${room.x},${room.y}`;
  const sec = manifest.map.section.find(s => s.id === room.sectionId);
  const el  = document.createElement('div');
  el.className = `cell cell-room${selected === gid ? ' sel' : ''}`;
  el.style.cssText = `left:${cx}px;top:${cy}px`;
  el.dataset.gid = gid;
  el.innerHTML = sec?.image
    ? `<img class="room-img" src="/assets/map/${sec.image}" onerror="this.outerHTML='<div class=room-bg></div>'">`
    : '<div class="room-bg"></div>';
  if (room.type === 'spawn') el.innerHTML += '<div class="badge badge-type">SPAWN</div>';
  if (room.mob)              el.innerHTML += '<div class="badge badge-mob">👾</div>';
  if (room.npc)              el.innerHTML += '<div class="badge badge-npc">💬</div>';
  if (room.objects?.length)  el.innerHTML += `<div class="badge badge-obj">📦${room.objects.length}</div>`;
  if (room.events && Object.values(room.events).some(Boolean)) el.innerHTML += '<div class="badge badge-evt">⚡</div>';

  for (const [dir, open] of Object.entries(room.passages ?? sec?.passage ?? {})) {
    const p = document.createElement('div');
    p.className = `psg ${['top', 'bottom'].includes(dir) ? 'h' : 'v'} ${dir} ${open ? 'open' : 'closed'}`;
    p.title = `${dir}: ${open ? 'открыт' : 'закрыт'}`;
    p.addEventListener('click', e => { e.stopPropagation(); togglePassage(gid, dir); });
    el.appendChild(p);
  }
  el.addEventListener('click',       () => onRoomClick(gid));
  el.addEventListener('contextmenu', e  => { e.preventDefault(); deleteRoom(gid); });
  return el;
}

// ── Room actions ──────────────────────────────────────────────────────────────
function placeRoom(x, y) {
  if (!palSel || palSel.tab !== 'sections') { setStatus('Сначала выберите секцию'); return; }
  const sec = manifest.map.section.find(s => s.id === palSel.id);
  if (!sec) return;
  rooms[`${x},${y}`] = { x, y, sectionId: sec.id, type: !Object.keys(rooms).length ? 'spawn' : 'normal', passages: { ...sec.passage }, mob: null, mobChance: null, npc: null, objects: [], events: null };
  selected = `${x},${y}`;
  renderGrid(); renderInspector();
}

function onRoomClick(gid) {
  if (palSel && palSel.tab !== 'sections') { assignToRoom(gid); return; }
  selected = gid; renderGrid(); renderInspector();
}

function assignToRoom(gid) {
  const room = rooms[gid]; if (!room) return;
  if      (palSel.tab === 'mobs')    { room.mob = palSel.id; setStatus(`Моб → ${palSel.id}`); }
  else if (palSel.tab === 'npcs')    { room.npc = palSel.id; setStatus(`NPC → ${palSel.id}`); }
  else if (palSel.tab === 'objects') {
    if (!room.objects.includes(palSel.id)) { room.objects.push(palSel.id); setStatus(`Объект → ${palSel.id}`); }
    else { setStatus('Объект уже в комнате'); }
  }
  selected = gid; renderGrid(); renderInspector();
}

function togglePassage(gid, dir) {
  const room = rooms[gid]; if (!room) return;
  room.passages[dir] = !room.passages[dir];
  const [dx, dy] = DELTA[dir];
  const nbr = rooms[`${room.x + dx},${room.y + dy}`];
  if (nbr) nbr.passages[OPP[dir]] = room.passages[dir];
  renderGrid(); renderInspector();
}

function deleteRoom(gid) {
  delete rooms[gid];
  if (selected === gid) selected = null;
  renderGrid(); renderInspector();
}

// ── Inspector ─────────────────────────────────────────────────────────────────
function renderInspector() {
  const panel = $('inspector');
  if (!selected || !rooms[selected]) { panel.innerHTML = '<p class="inone">Выберите комнату</p>'; return; }
  const room = rooms[selected];
  const sec  = manifest.map.section.find(s => s.id === room.sectionId);
  const mob  = room.mob ? manifest.mobs.find(m => m.id === room.mob)   : null;
  const npc  = room.npc ? manifest.npcs.find(n => n.id === room.npc)   : null;

  let h = `<h3>Комната ${selected}</h3>`;

  // Type
  h += `<div class="iblock"><div class="ilabel">Тип</div>
    <select class="iselect" id="insp-type">
      ${['normal', 'spawn', 'door_area', 'key_area'].map(t => `<option value="${t}" ${room.type === t ? 'selected' : ''}>${t}</option>`).join('')}
    </select></div>`;

  // Section
  const secImg = sec?.image ? `<img src="/assets/map/${sec.image}" onerror="this.style.display='none'" style="width:24px;height:24px;image-rendering:pixelated">` : '';
  h += `<div class="iblock"><div class="ilabel">Секция</div><div class="ivalue">${secImg} ${room.sectionId}</div></div>`;

  // Passages
  h += `<div class="iblock"><div class="ilabel">Проходы</div><div class="psg-grid">`;
  for (const dir of ['top', 'bottom', 'left', 'right']) {
    const open = room.passages?.[dir] ?? false;
    h += `<label class="psg-chk"><input type="checkbox" data-psg="${dir}" ${open ? 'checked' : ''}> ${dir}</label>`;
  }
  h += `</div></div>`;

  // Mob
  h += `<div class="iblock"><div class="ilabel">Моб</div><div class="ilist">`;
  if (mob) {
    const img       = mob.imags?.default ? `<img src="/assets/mob/${mob.imags.default}" onerror="this.style.display='none'" style="width:20px;height:20px;image-rendering:pixelated">` : '';
    const chanceVal = room.mobChance != null ? Math.round(room.mobChance * 100) : '';
    h += `<div class="ivalue">${img} ${mob.name}
      <input type="number" id="insp-mob-chance" min="0" max="100" placeholder="авто" value="${chanceVal}" title="Шанс 0–100%" style="width:46px;margin-left:auto">%
      <span class="iremove" id="insp-mob-del">×</span></div>`;
  } else {
    h += `<div class="iempty">нет — выберите в палитре</div>`;
  }
  h += `</div></div>`;

  // NPC
  h += `<div class="iblock"><div class="ilabel">NPC</div><div class="ilist">`;
  if (npc) {
    const img = npc.portrait ? `<img src="/assets/npc/${npc.portrait}" onerror="this.style.display='none'" style="width:20px;height:20px;image-rendering:pixelated">` : '';
    h += `<div class="ivalue">${img} ${npc.name} <span class="iremove" id="insp-npc-del">×</span></div>`;
  } else {
    h += `<div class="iempty">нет — выберите в палитре</div>`;
  }
  h += `</div></div>`;

  // Objects
  h += `<div class="iblock"><div class="ilabel">Объекты</div><div class="ilist" id="insp-objs">`;
  if (room.objects?.length) {
    for (const oid of room.objects) {
      const obj = manifest.objects.find(o => o.id === oid);
      const img = obj?.image ? `<img src="/assets/object/${obj.image}" onerror="this.style.display='none'" style="width:20px;height:20px;image-rendering:pixelated">` : '';
      h += `<div class="ivalue">${img} ${obj?.name ?? oid} <span class="iremove" data-obj-del="${oid}">×</span></div>`;
    }
  } else {
    h += `<div class="iempty">нет — выберите в палитре</div>`;
  }
  h += `</div></div>`;

  // Events
  h += `<div class="iblock"><div class="ilabel">События комнаты</div>
    <div class="field-group" style="margin-bottom:4px">
      <div class="field-label" style="font-size:9px;color:#666">on_room_enter</div>
      <input type="text" id="insp-evt-enter" placeholder="event_id или пусто" value="${room.events?.on_room_enter ?? ''}" style="width:100%;background:#0d1117;border:1px solid #334;color:var(--text);padding:3px 5px;font-family:monospace;font-size:11px">
    </div>
    <div class="field-group">
      <div class="field-label" style="font-size:9px;color:#666">on_room_first_enter</div>
      <input type="text" id="insp-evt-first-enter" placeholder="event_id или пусто" value="${room.events?.on_room_first_enter ?? ''}" style="width:100%;background:#0d1117;border:1px solid #334;color:var(--text);padding:3px 5px;font-family:monospace;font-size:11px">
    </div>
  </div>`;

  h += `<button class="btn danger" id="insp-del-room" style="width:100%;margin-top:8px">✕ Удалить комнату</button>`;
  panel.innerHTML = h;

  // Event listeners (no inline handlers)
  panel.querySelector('#insp-type')?.addEventListener('change', e => { room.type = e.target.value; renderGrid(); });
  panel.querySelectorAll('[data-psg]').forEach(cb => cb.addEventListener('change', () => togglePassage(selected, cb.dataset.psg)));
  panel.querySelector('#insp-mob-chance')?.addEventListener('change', e => {
    room.mobChance = e.target.value === '' ? null : Math.max(0, Math.min(100, +e.target.value)) / 100;
  });
  panel.querySelector('#insp-mob-del')?.addEventListener('click', () => { room.mob = null; room.mobChance = null; renderGrid(); renderInspector(); });
  panel.querySelector('#insp-npc-del')?.addEventListener('click', () => { room.npc = null; renderGrid(); renderInspector(); });
  panel.querySelectorAll('[data-obj-del]').forEach(btn => btn.addEventListener('click', () => {
    room.objects = room.objects.filter(o => o !== btn.dataset.objDel); renderGrid(); renderInspector();
  }));
  const _evtUpdate = () => {
    const enter      = panel.querySelector('#insp-evt-enter')?.value.trim()      ?? '';
    const firstEnter = panel.querySelector('#insp-evt-first-enter')?.value.trim() ?? '';
    if (enter || firstEnter) {
      room.events = {};
      if (enter)      room.events.on_room_enter       = enter;
      if (firstEnter) room.events.on_room_first_enter = firstEnter;
    } else {
      room.events = null;
    }
    renderGrid();
  };
  panel.querySelector('#insp-evt-enter')?.addEventListener('change', _evtUpdate);
  panel.querySelector('#insp-evt-first-enter')?.addEventListener('change', _evtUpdate);
  panel.querySelector('#insp-del-room')?.addEventListener('click', () => deleteRoom(selected));
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportMap() {
  if (!Object.keys(rooms).length) { setStatus('Карта пустая'); return; }
  const spawnRoom = Object.values(rooms).find(r => r.type === 'spawn');
  if (!spawnRoom) { setStatus('Нет spawn-комнаты!'); return; }
  const offX = spawnRoom.x, offY = spawnRoom.y;
  const out  = { rooms: {} };
  for (const room of Object.values(rooms)) {
    const nx = room.x - offX, ny = room.y - offY;
    const sec   = manifest.map.section.find(s => s.id === room.sectionId);
    const entry = { x: nx, y: ny, type: room.type, sectionId: room.sectionId, image: sec?.image ?? '', passages: { ...room.passages } };
    if (room.mob)           { entry.spawn_mob = [room.mob]; if (room.mobChance != null) entry.chance_spawn_mob = room.mobChance; }
    if (room.npc)             entry.spawn_npc    = [room.npc];
    if (room.objects?.length) entry.spawn_object = [...room.objects];
    if (room.events && Object.values(room.events).some(Boolean)) entry.events = { ...room.events };
    out.rooms[`${nx},${ny}`] = entry;
  }
  const a  = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })), download: `map_level_${level}.json` });
  a.click();
  setStatus(`Экспортировано: map_level_${level}.json`);
}

// ── Util ──────────────────────────────────────────────────────────────────────
let _stTimer;
function setStatus(msg) {
  $('statusMsg').textContent = msg;
  clearTimeout(_stTimer);
  _stTimer = setTimeout(() => { $('statusMsg').textContent = ''; }, 2500);
}

init();
