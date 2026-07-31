'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let scene   = null;
let selId   = null;
let scale   = 1;
let bgList  = [];
let objList = [];
let drag    = null;

// ── API ───────────────────────────────────────────────────────────────────────
const api = (m, url, body) =>
  fetch(url, {
    method: m,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json());

// ── Sidebar tabs ──────────────────────────────────────────────────────────────
document.querySelectorAll('.sb-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sb-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const which = btn.dataset.panel;
    document.getElementById('panel-objects').style.display = which === 'objects' ? 'flex' : 'none';
    document.getElementById('panel-scene').style.display   = which === 'scene'   ? 'flex' : 'none';
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const [scenes, bgs, objs] = await Promise.all([
    api('GET', '/api/scavenge/scenes'),
    api('GET', '/api/scavenge/assets/bg'),
    api('GET', '/api/scavenge/assets/objects'),
  ]);
  bgList  = bgs  ?? [];
  objList = objs ?? [];

  const sceneSel = document.getElementById('scene-sel');
  for (const id of (scenes ?? [])) {
    const o = document.createElement('option');
    o.value = id; o.textContent = id;
    sceneSel.appendChild(o);
  }

  const bgSel = document.getElementById('bg-sel');
  bgSel.innerHTML = '<option value="">— нет —</option>';
  for (const f of bgList) {
    const o = document.createElement('option');
    o.value = f; o.textContent = f;
    bgSel.appendChild(o);
  }

  sceneSel.addEventListener('change', () => { if (sceneSel.value) loadScene(sceneSel.value); });
  bgSel.addEventListener('change', () => {
    if (!scene) return;
    scene.image = bgSel.value || null;
    loadBg(scene.image);
    markUnsaved();
  });
})();

// ── Scene load ────────────────────────────────────────────────────────────────
async function loadScene(id) {
  scene = await api('GET', `/api/scavenge/scene/${id}`);
  selId = null;
  document.getElementById('empty-msg').classList.add('hidden');
  document.getElementById('add-row').style.display  = '';
  document.getElementById('bg-label').style.display = '';
  document.getElementById('bg-sel').value = scene.image ?? '';
  document.getElementById('btn-save').disabled = false;
  document.getElementById('ib-scene').textContent = 'scene: ' + id;
  setSaved();
  loadBg(scene.image);
  renderList();
  renderProps();
  renderSceneMeta();
}

// ── Background ────────────────────────────────────────────────────────────────
function loadBg(imgFile) {
  const wrap   = document.getElementById('canvas-wrap');
  const canvas = document.getElementById('canvas');
  const img    = document.getElementById('bg-img');
  canvas.querySelectorAll('.zone').forEach(z => z.remove());

  if (!imgFile) {
    img.src = '';
    canvas.style.width  = wrap.clientWidth  + 'px';
    canvas.style.height = wrap.clientHeight + 'px';
    return;
  }
  img.src = `/assets/scavenge/scenes/${imgFile}`;
  img.onload = () => {
    const h = wrap.clientHeight;
    scale   = img.naturalHeight ? h / img.naturalHeight : 1;
    const w = Math.round(img.naturalWidth * scale);
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    img.style.width  = w + 'px';
    img.style.height = h + 'px';
    document.getElementById('ib-scale').textContent = `scale: ${scale.toFixed(3)}`;
    renderZones();
    wrap.scrollLeft = Math.max(0, (w - wrap.clientWidth) / 2);
  };
}

// ── Zones ─────────────────────────────────────────────────────────────────────
function renderZones() {
  const canvas = document.getElementById('canvas');
  canvas.querySelectorAll('.zone').forEach(z => z.remove());
  for (const obj of (scene?.objects ?? [])) canvas.appendChild(makeZone(obj));
}

function makeZone(obj) {
  const el = document.createElement('div');
  el.className  = 'zone' + (obj.id === selId ? ' sel' : '');
  el.dataset.id = obj.id;
  el.dataset.t  = obj.type;
  applyPos(el, obj);

  const lbl = document.createElement('div');
  lbl.className   = 'zone-lbl';
  lbl.textContent = `[${obj.type}] ${obj.id}`;
  el.appendChild(lbl);

  if (obj.type === 'item' && obj.image) {
    const sp = document.createElement('img');
    sp.className = 'zone-sprite';
    sp.src       = `/assets/scavenge/${obj.image}`;
    sp.draggable = false;
    el.appendChild(sp);
  }

  if (obj.id === selId) {
    for (const pos of ['nw','n','ne','e','se','s','sw','w']) {
      const h = document.createElement('div');
      h.className   = `rh ${pos}`;
      h.dataset.pos = pos;
      h.addEventListener('mousedown', e => { e.stopPropagation(); startResize(e, el, obj.id, pos); });
      el.appendChild(h);
    }
  }

  el.addEventListener('mousedown', e => {
    if (e.target.classList.contains('rh')) return;
    selectObj(obj.id);
    startMove(e, el, obj.id);
    e.stopPropagation();
  });
  return el;
}

function applyPos(el, obj) {
  el.style.left   = `${obj.x * scale}px`;
  el.style.top    = `${obj.y * scale}px`;
  el.style.width  = `${obj.w * scale}px`;
  el.style.height = `${obj.h * scale}px`;
}

function zoneEl(id) {
  return document.querySelector(`.zone[data-id="${CSS.escape(id)}"]`);
}

// ── Selection ─────────────────────────────────────────────────────────────────
function selectObj(id) {
  selId = id;
  renderZones(); renderList(); renderProps();
}

document.getElementById('canvas').addEventListener('mousedown', e => {
  if (e.target.id === 'canvas' || e.target.id === 'bg-img') {
    selId = null; renderZones(); renderList(); renderProps();
  }
});

document.getElementById('canvas').addEventListener('dblclick', e => {
  if (!scene) return;
  if (e.target.id !== 'canvas' && e.target.id !== 'bg-img') return;
  const canvas = document.getElementById('canvas');
  const wrap   = document.getElementById('canvas-wrap');
  const rect   = canvas.getBoundingClientRect();
  const x = Math.round((e.clientX - rect.left + wrap.scrollLeft) / scale);
  const y = Math.round((e.clientY - rect.top) / scale);
  addObj('examine', Math.max(0, x - 100), Math.max(0, y - 100));
});

// ── Drag ──────────────────────────────────────────────────────────────────────
function startMove(e, el, id) {
  drag = {
    kind: 'move', id,
    mx0: e.clientX, my0: e.clientY,
    l0: parseFloat(el.style.left), t0: parseFloat(el.style.top),
    scroll0: document.getElementById('canvas-wrap').scrollLeft,
  };
  bindDrag();
}

function startResize(e, el, id, pos) {
  drag = {
    kind: 'resize', id, pos,
    mx0: e.clientX, my0: e.clientY,
    l0: parseFloat(el.style.left), t0: parseFloat(el.style.top),
    w0: parseFloat(el.style.width), h0: parseFloat(el.style.height),
    scroll0: document.getElementById('canvas-wrap').scrollLeft,
  };
  bindDrag();
}

function bindDrag() {
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp, { once: true });
}

function onMove(e) {
  if (!drag) return;
  const wrap = document.getElementById('canvas-wrap');
  const scroll = wrap.scrollLeft - drag.scroll0;
  const dx = e.clientX - drag.mx0 + scroll;
  const dy = e.clientY - drag.my0;
  const obj = (scene?.objects ?? []).find(o => o.id === drag.id);
  const el  = zoneEl(drag.id);
  if (!obj || !el) return;

  if (drag.kind === 'move') {
    const nl = Math.max(0, drag.l0 + dx);
    const nt = Math.max(0, drag.t0 + dy);
    el.style.left = nl + 'px'; el.style.top = nt + 'px';
    obj.x = Math.round(nl / scale); obj.y = Math.round(nt / scale);
  } else {
    const MIN = 16;
    let nl = drag.l0, nt = drag.t0, nw = drag.w0, nh = drag.h0;
    const p = drag.pos;
    if (p.includes('e'))  nw = Math.max(MIN, drag.w0 + dx);
    if (p.includes('s'))  nh = Math.max(MIN, drag.h0 + dy);
    if (p.includes('w')) { nl = drag.l0 + dx; nw = Math.max(MIN, drag.w0 - dx); }
    if (p.includes('n')) { nt = drag.t0 + dy; nh = Math.max(MIN, drag.h0 - dy); }
    nl = Math.max(0, nl); nt = Math.max(0, nt);
    el.style.left = nl+'px'; el.style.top  = nt+'px';
    el.style.width = nw+'px'; el.style.height = nh+'px';
    obj.x = Math.round(nl/scale); obj.y = Math.round(nt/scale);
    obj.w = Math.round(nw/scale); obj.h = Math.round(nh/scale);
  }
  patchCoords(obj); markUnsaved();
}

function onUp() {
  drag = null;
  document.removeEventListener('mousemove', onMove);
}

function patchCoords(obj) {
  ['x','y','w','h'].forEach(k => {
    const el = document.getElementById('pi-' + k);
    if (el) el.value = obj[k];
  });
}

// ── Mouse info ────────────────────────────────────────────────────────────────
document.getElementById('canvas').addEventListener('mousemove', e => {
  const canvas = document.getElementById('canvas');
  const wrap   = document.getElementById('canvas-wrap');
  const rect   = canvas.getBoundingClientRect();
  const x = Math.round((e.clientX - rect.left + wrap.scrollLeft) / scale);
  const y = Math.round((e.clientY - rect.top) / scale);
  document.getElementById('ib-xy').textContent = `X: ${x}  Y: ${y}`;
});

// ── Object list ───────────────────────────────────────────────────────────────
function renderList() {
  const list = document.getElementById('obj-list');
  list.innerHTML = '';
  const objs = scene?.objects ?? [];
  if (!objs.length) { list.innerHTML = '<div class="obj-empty">Нет объектов</div>'; return; }

  for (const obj of objs) {
    const row = document.createElement('div');
    row.className = 'obj-row' + (obj.id === selId ? ' sel' : '');

    const dot = document.createElement('div');
    dot.className = 'obj-dot';
    dot.style.background = typeColor(obj.type);

    const idSpan = document.createElement('span');
    idSpan.className = 'obj-id'; idSpan.textContent = obj.id;

    const typeSpan = document.createElement('span');
    typeSpan.className = 'obj-type'; typeSpan.textContent = obj.type;

    const del = document.createElement('span');
    del.className = 'obj-del'; del.textContent = '×'; del.title = 'Удалить';
    del.addEventListener('click', ev => { ev.stopPropagation(); removeObj(obj.id); });

    row.appendChild(dot); row.appendChild(idSpan);
    row.appendChild(typeSpan); row.appendChild(del);
    row.addEventListener('click', () => selectObj(obj.id));
    list.appendChild(row);
  }
}

function typeColor(t) {
  return { item:'#f0a500', examine:'#4a9eff', exit:'#3dff7a', npc:'#c060ff' }[t] ?? '#888';
}

// ── Properties ────────────────────────────────────────────────────────────────
function renderProps() {
  const panel = document.getElementById('props-scroll');
  if (!selId) { panel.innerHTML = '<div class="pr-empty">Выберите объект</div>'; return; }
  const obj = (scene?.objects ?? []).find(o => o.id === selId);
  if (!obj) { panel.innerHTML = ''; return; }
  panel.innerHTML = '';

  // ID
  panel.appendChild(pr('ID', txt('pi-id', obj.id, v => {
    const old = obj.id; obj.id = v; selId = v;
    for (const o of scene.objects) {
      if (o.condition?.required_removed)
        o.condition.required_removed = o.condition.required_removed.map(x => x === old ? v : x);
      if (o.condition?.required_use)
        o.condition.required_use = o.condition.required_use.map(x => x === old ? v : x);
      if (o.use?.remove)
        o.use.remove = o.use.remove.map(x => x === old ? v : x);
    }
    renderList(); renderZones(); markUnsaved();
  })));

  // Type
  panel.appendChild(pr('Тип', sel('pi-type', ['examine','item','exit','npc'], obj.type, v => {
    obj.type = v; renderZones(); renderList(); renderProps(); markUnsaved();
  })));

  // X Y W H
  const xy = document.createElement('div'); xy.className = 'pr-row';
  xy.appendChild(pr('X', num('pi-x', obj.x, v => { obj.x = v; applyPos(zoneEl(obj.id), obj); markUnsaved(); })));
  xy.appendChild(pr('Y', num('pi-y', obj.y, v => { obj.y = v; applyPos(zoneEl(obj.id), obj); markUnsaved(); })));
  panel.appendChild(xy);
  const wh = document.createElement('div'); wh.className = 'pr-row';
  wh.appendChild(pr('W', num('pi-w', obj.w, v => { obj.w = v; applyPos(zoneEl(obj.id), obj); markUnsaved(); })));
  wh.appendChild(pr('H', num('pi-h', obj.h, v => { obj.h = v; applyPos(zoneEl(obj.id), obj); markUnsaved(); })));
  panel.appendChild(wh);

  // ── item ──
  if (obj.type === 'item') {
    panel.appendChild(sec('Предмет'));
    panel.appendChild(pr('Картинка', sel('pi-img', ['', ...objList], obj.image ?? '',
      v => { obj.image = v || undefined; renderZones(); markUnsaved(); },
      f => f || '— нет —'
    )));
    panel.appendChild(pr('Шанс (0–1)', num('pi-chance', obj.chance ?? 1,
      v => { obj.chance = Math.min(1, Math.max(0, v)); markUnsaved(); },
      { min:0, max:1, step:0.1 }
    )));
    panel.appendChild(ck('pi-remove', 'Удалить при взятии', obj.remove ?? true,
      v => { obj.remove = v; markUnsaved(); }));
    panel.appendChild(pr('Добавить предметы (id через запятую)',
      txt('pi-add', (obj.add_item ?? []).join(', '),
        v => { obj.add_item = v.split(',').map(s => s.trim()).filter(Boolean); markUnsaved(); })
    ));
    panel.appendChild(pr('Сменить фон (img id без .jpg)',
      txt('pi-sc', obj.scene_change ?? '', v => { obj.scene_change = v || undefined; markUnsaved(); })
    ));
  }

  // ── examine ──
  if (obj.type === 'examine') {
    panel.appendChild(sec('Осмотр'));
    panel.appendChild(pr('Текст', ta('pi-text', obj.text ?? '',
      v => { obj.text = v; markUnsaved(); })));
    panel.appendChild(pr('Ключ i18n',
      txt('pi-tkey', obj.text_key ?? '', v => { obj.text_key = v || undefined; markUnsaved(); })
    ));
    panel.appendChild(pr('Сменить фон (img id без .jpg)',
      txt('pi-sc2', obj.scene_change ?? '', v => { obj.scene_change = v || undefined; markUnsaved(); })
    ));
  }

  // ── use (examine + item) ──
  if (obj.type === 'examine' || obj.type === 'item') {
    panel.appendChild(sec('При взаимодействии (use)'));
    const use = obj.use ?? {};
    const otherObjs = (scene.objects ?? []).filter(o => o.id !== obj.id);
    const taskIds   = Object.keys(scene.tasks ?? {});

    // Условия (if) — JSON
    const ifTa = document.createElement('textarea');
    ifTa.value = JSON.stringify(use.if ?? [], null, 2);
    ifTa.rows  = 2; ifTa.style.fontFamily = 'monospace'; ifTa.style.fontSize = '10px';
    ifTa.addEventListener('change', () => {
      try {
        if (!obj.use) obj.use = {};
        const p = JSON.parse(ifTa.value);
        obj.use.if = p.length ? p : undefined;
        ifTa.style.borderColor = ''; cleanUse(obj); markUnsaved();
      } catch { ifTa.style.borderColor = '#f55'; }
    });
    ifTa.addEventListener('input', () => { ifTa.style.borderColor = ''; });
    panel.appendChild(pr('Условия if (JSON)', ifTa));

    // require_item
    panel.appendChild(pr('Нужны предметы (require_item)',
      txt('pi-use-req-item', (use.require_item ?? []).join(', '), v => {
        if (!obj.use) obj.use = {};
        obj.use.require_item = v.split(',').map(s => s.trim()).filter(Boolean);
        if (!obj.use.require_item.length) delete obj.use.require_item;
        cleanUse(obj); markUnsaved();
      })
    ));

    // consume_item
    panel.appendChild(pr('Потребить предметы (consume_item)',
      txt('pi-use-consume', (use.consume_item ?? []).join(', '), v => {
        if (!obj.use) obj.use = {};
        obj.use.consume_item = v.split(',').map(s => s.trim()).filter(Boolean);
        if (!obj.use.consume_item.length) delete obj.use.consume_item;
        cleanUse(obj); markUnsaved();
      })
    ));

    // require_removed — checkboxes
    if (otherObjs.length) {
      const reqRemWrap = document.createElement('div'); reqRemWrap.className = 'pr-req';
      for (const o of otherObjs) {
        const lbl = document.createElement('label');
        const cb  = document.createElement('input'); cb.type = 'checkbox';
        cb.checked = (use.require_removed ?? []).includes(o.id);
        cb.addEventListener('change', () => {
          if (!obj.use) obj.use = {};
          if (!obj.use.require_removed) obj.use.require_removed = [];
          if (cb.checked) { if (!obj.use.require_removed.includes(o.id)) obj.use.require_removed.push(o.id); }
          else obj.use.require_removed = obj.use.require_removed.filter(x => x !== o.id);
          if (!obj.use.require_removed.length) delete obj.use.require_removed;
          cleanUse(obj); markUnsaved();
        });
        lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' ' + o.id));
        reqRemWrap.appendChild(lbl);
      }
      panel.appendChild(pr('Нужно убрать (require_removed)', reqRemWrap));
    }

    // require_used — checkboxes
    if (otherObjs.length) {
      const reqUseWrap = document.createElement('div'); reqUseWrap.className = 'pr-req';
      for (const o of otherObjs) {
        const lbl = document.createElement('label');
        const cb  = document.createElement('input'); cb.type = 'checkbox';
        cb.checked = (use.require_used ?? []).includes(o.id);
        cb.addEventListener('change', () => {
          if (!obj.use) obj.use = {};
          if (!obj.use.require_used) obj.use.require_used = [];
          if (cb.checked) { if (!obj.use.require_used.includes(o.id)) obj.use.require_used.push(o.id); }
          else obj.use.require_used = obj.use.require_used.filter(x => x !== o.id);
          if (!obj.use.require_used.length) delete obj.use.require_used;
          cleanUse(obj); markUnsaved();
        });
        lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' ' + o.id));
        reqUseWrap.appendChild(lbl);
      }
      panel.appendChild(pr('Нужно использовать (require_used)', reqUseWrap));
    }

    // remove — checkboxes
    if (otherObjs.length) {
      const remReq = document.createElement('div'); remReq.className = 'pr-req';
      for (const o of otherObjs) {
        const lbl = document.createElement('label');
        const cb  = document.createElement('input'); cb.type = 'checkbox';
        cb.checked = (use.remove ?? []).includes(o.id);
        cb.addEventListener('change', () => {
          if (!obj.use) obj.use = {};
          if (!obj.use.remove) obj.use.remove = [];
          if (cb.checked) { if (!obj.use.remove.includes(o.id)) obj.use.remove.push(o.id); }
          else obj.use.remove = obj.use.remove.filter(x => x !== o.id);
          if (!obj.use.remove.length) delete obj.use.remove;
          cleanUse(obj); markUnsaved();
        });
        lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' ' + o.id));
        remReq.appendChild(lbl);
      }
      panel.appendChild(pr('Убрать объекты (remove)', remReq));
    }

    // scene_change
    panel.appendChild(pr('Сменить фон (scene_change)',
      txt('pi-use-sc', use.scene_change ?? '', v => {
        if (!obj.use) obj.use = {};
        obj.use.scene_change = v || undefined;
        cleanUse(obj); markUnsaved();
      })
    ));

    // sound
    panel.appendChild(pr('Звук (sound id)',
      txt('pi-use-sound', use.sound ?? '', v => {
        if (!obj.use) obj.use = {};
        obj.use.sound = v || undefined;
        cleanUse(obj); markUnsaved();
      })
    ));

    // event
    panel.appendChild(pr('Событие (event id)',
      txt('pi-use-event', use.event ?? '', v => {
        if (!obj.use) obj.use = {};
        obj.use.event = v || undefined;
        cleanUse(obj); markUnsaved();
      })
    ));

    // complete tasks — checkboxes
    if (taskIds.length) {
      const compReq = document.createElement('div'); compReq.className = 'pr-req';
      for (const tid of taskIds) {
        const lbl = document.createElement('label');
        const cb  = document.createElement('input'); cb.type = 'checkbox';
        cb.checked = (use.complete ?? []).includes(tid);
        cb.addEventListener('change', () => {
          if (!obj.use) obj.use = {};
          if (!obj.use.complete) obj.use.complete = [];
          if (cb.checked) { if (!obj.use.complete.includes(tid)) obj.use.complete.push(tid); }
          else obj.use.complete = obj.use.complete.filter(x => x !== tid);
          if (!obj.use.complete.length) delete obj.use.complete;
          cleanUse(obj); markUnsaved();
        });
        lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' ' + tid));
        compReq.appendChild(lbl);
      }
      panel.appendChild(pr('Завершить tasks (complete)', compReq));
    }

    // activate tasks — checkboxes
    if (taskIds.length) {
      const actReq = document.createElement('div'); actReq.className = 'pr-req';
      for (const tid of taskIds) {
        const lbl = document.createElement('label');
        const cb  = document.createElement('input'); cb.type = 'checkbox';
        cb.checked = (use.activate ?? []).includes(tid);
        cb.addEventListener('change', () => {
          if (!obj.use) obj.use = {};
          if (!obj.use.activate) obj.use.activate = [];
          if (cb.checked) { if (!obj.use.activate.includes(tid)) obj.use.activate.push(tid); }
          else obj.use.activate = obj.use.activate.filter(x => x !== tid);
          if (!obj.use.activate.length) delete obj.use.activate;
          cleanUse(obj); markUnsaved();
        });
        lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' ' + tid));
        actReq.appendChild(lbl);
      }
      panel.appendChild(pr('Активировать tasks (activate)', actReq));
    }

    // text / fail_text
    panel.appendChild(pr('Текст успеха (text)',
      txt('pi-use-text', use.text ?? '', v => {
        if (!obj.use) obj.use = {};
        obj.use.text = v || undefined;
        cleanUse(obj); markUnsaved();
      })
    ));
    panel.appendChild(pr('Текст провала (fail_text)',
      txt('pi-use-fail', use.fail_text ?? '', v => {
        if (!obj.use) obj.use = {};
        obj.use.fail_text = v || undefined;
        cleanUse(obj); markUnsaved();
      })
    ));
  }

  // ── exit ──
  if (obj.type === 'exit') {
    panel.appendChild(sec('Выход'));
    const others = (scene.objects ?? []).filter(o => o.id !== obj.id).map(o => o.id);

    // required_removed
    const reqRem = obj.condition?.required_removed ?? [];
    const wrapRem = document.createElement('div'); wrapRem.className = 'pr-req';
    if (!others.length) {
      wrapRem.innerHTML = '<span style="color:var(--muted);font-size:11px">Нет других объектов</span>';
    } else {
      for (const oid of others) {
        const lbl = document.createElement('label');
        const cb  = document.createElement('input'); cb.type = 'checkbox'; cb.checked = reqRem.includes(oid);
        cb.addEventListener('change', () => {
          if (!obj.condition) obj.condition = {};
          if (!obj.condition.required_removed) obj.condition.required_removed = [];
          if (cb.checked) { if (!obj.condition.required_removed.includes(oid)) obj.condition.required_removed.push(oid); }
          else obj.condition.required_removed = obj.condition.required_removed.filter(x => x !== oid);
          markUnsaved();
        });
        lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' ' + oid));
        wrapRem.appendChild(lbl);
      }
    }
    panel.appendChild(pr('Требует удалить (removed)', wrapRem));

    // required_use
    const reqUse = obj.condition?.required_use ?? [];
    const wrapUse = document.createElement('div'); wrapUse.className = 'pr-req';
    if (!others.length) {
      wrapUse.innerHTML = '<span style="color:var(--muted);font-size:11px">Нет других объектов</span>';
    } else {
      for (const oid of others) {
        const lbl = document.createElement('label');
        const cb  = document.createElement('input'); cb.type = 'checkbox'; cb.checked = reqUse.includes(oid);
        cb.addEventListener('change', () => {
          if (!obj.condition) obj.condition = {};
          if (!obj.condition.required_use) obj.condition.required_use = [];
          if (cb.checked) { if (!obj.condition.required_use.includes(oid)) obj.condition.required_use.push(oid); }
          else obj.condition.required_use = obj.condition.required_use.filter(x => x !== oid);
          markUnsaved();
        });
        lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' ' + oid));
        wrapUse.appendChild(lbl);
      }
    }
    panel.appendChild(pr('Требует использовать (used)', wrapUse));

    panel.appendChild(pr('Текст блокировки',
      ta('pi-fail', obj.condition_fail_text ?? '', v => { obj.condition_fail_text = v || undefined; markUnsaved(); })
    ));
  }

  // ── npc ──
  if (obj.type === 'npc') {
    panel.appendChild(sec('NPC'));
    const note = document.createElement('div'); note.className = 'pr-note';
    note.textContent = 'Открывает диалог NPC текущей комнаты'; panel.appendChild(note);
  }
}

function cleanUse(obj) {
  if (!obj.use) return;
  const u = obj.use;
  const empty = !u.event && !u.sound && !u.scene_change && !u.text && !u.fail_text
    && !u.if?.length && !u.require_item?.length && !u.consume_item?.length
    && !u.require_removed?.length && !u.require_used?.length
    && !u.remove?.length && !u.complete?.length && !u.activate?.length
    && !u.set && !u.fail_text_key && !u.text_key;
  if (empty) delete obj.use;
}

// ── Prop helpers ───────────────────────────────────────────────────────────────
function pr(label, input) {
  const d = document.createElement('div'); d.className = 'pr';
  const l = document.createElement('label'); l.className = 'fl'; l.textContent = label;
  d.appendChild(l); d.appendChild(input); return d;
}
function txt(id, val, cb) {
  const i = document.createElement('input'); i.type = 'text'; i.id = id; i.value = val;
  i.addEventListener('change', () => cb(i.value)); return i;
}
function num(id, val, cb, attrs = {}) {
  const i = document.createElement('input'); i.type = 'number'; i.id = id; i.value = val;
  if (attrs.min !== undefined) i.min = attrs.min;
  if (attrs.max !== undefined) i.max = attrs.max;
  if (attrs.step !== undefined) i.step = attrs.step;
  i.addEventListener('input', () => cb(parseFloat(i.value) || 0)); return i;
}
function sel(id, opts, val, cb, labelFn = null) {
  const s = document.createElement('select'); s.id = id;
  for (const o of opts) {
    const el = document.createElement('option');
    el.value = o; el.textContent = labelFn ? labelFn(o) : o;
    if (o === val) el.selected = true;
    s.appendChild(el);
  }
  s.addEventListener('change', () => cb(s.value)); return s;
}
function ta(id, val, cb) {
  const t = document.createElement('textarea'); t.id = id; t.value = val;
  t.addEventListener('change', () => cb(t.value)); return t;
}
function ck(id, label, checked, cb) {
  const d = document.createElement('div'); d.className = 'pr-ck';
  const c = document.createElement('input'); c.type = 'checkbox'; c.id = 'pi-' + id; c.checked = checked;
  c.addEventListener('change', () => cb(c.checked));
  const l = document.createElement('label'); l.htmlFor = 'pi-' + id; l.textContent = label;
  d.appendChild(c); d.appendChild(l); return d;
}
function sec(text) {
  const d = document.createElement('div'); d.className = 'pr-sec'; d.textContent = text; return d;
}

// ── Object management ─────────────────────────────────────────────────────────
function addObj(type, x = 100, y = 100) {
  if (!scene) return;
  const id  = type + '_' + Date.now().toString(36);
  const obj = { id, type, x: Math.round(x), y: Math.round(y), w: 200, h: 200 };
  if (type === 'item')    Object.assign(obj, { chance: 1, remove: true, add_item: [] });
  if (type === 'examine') Object.assign(obj, { text: '' });
  if (type === 'exit')    Object.assign(obj, { condition: { required_removed: [] }, condition_fail_text: '' });
  scene.objects.push(obj);
  selectObj(id); markUnsaved();
}

function removeObj(id) {
  if (!scene) return;
  scene.objects = scene.objects.filter(o => o.id !== id);
  if (selId === id) selId = null;
  renderZones(); renderList(); renderProps(); markUnsaved();
}

document.getElementById('btn-add').addEventListener('click', () => {
  if (!scene) return;
  const type = document.getElementById('new-type').value;
  const wrap = document.getElementById('canvas-wrap');
  const cx = Math.max(0, Math.round((wrap.scrollLeft + wrap.clientWidth  / 2) / scale - 100));
  const cy = Math.max(0, Math.round(wrap.clientHeight / 2 / scale - 100));
  addObj(type, cx, cy);
});

// ── New scene ─────────────────────────────────────────────────────────────────
document.getElementById('btn-new').addEventListener('click', () => {
  const id = prompt('ID новой сцены (латиница, underscore):');
  if (!id) return;
  scene = { id, image: null, sound: null, objects: [] };
  selId = null;
  document.getElementById('empty-msg').classList.add('hidden');
  document.getElementById('add-row').style.display  = '';
  document.getElementById('bg-label').style.display = '';
  document.getElementById('bg-sel').value = '';
  document.getElementById('btn-save').disabled = false;
  document.getElementById('ib-scene').textContent = 'scene: ' + id;
  const sceneSel = document.getElementById('scene-sel');
  if (!sceneSel.querySelector(`option[value="${id}"]`)) {
    const o = document.createElement('option'); o.value = id; o.textContent = id;
    sceneSel.appendChild(o);
  }
  sceneSel.value = id;
  loadBg(null); renderList(); renderProps(); markUnsaved();
});

// ── Scene Meta (help_text / tasks / script) ───────────────────────────────────

function renderSceneMeta() {
  const root = document.getElementById('scene-meta-scroll');
  if (!root) return;
  root.innerHTML = '';
  if (!scene) { root.innerHTML = '<div class="pr-empty">Выберите сцену</div>'; return; }

  // ── help_text ────────────────────────────────────────────────────────────────
  root.appendChild(smSec('Справка (help_text)'));
  const htWrap = document.createElement('div'); htWrap.className = 'sm-field';
  const htTa   = document.createElement('textarea');
  htTa.value   = scene.help_text ?? '';
  htTa.rows    = 2;
  htTa.addEventListener('change', () => { scene.help_text = htTa.value || undefined; markUnsaved(); });
  htWrap.appendChild(htTa);
  root.appendChild(htWrap);

  // ── tasks ─────────────────────────────────────────────────────────────────────
  root.appendChild(smSec('Tasks'));

  const tasks = scene.tasks ?? {};
  const taskIds = Object.keys(tasks);
  const objIds  = (scene.objects ?? []).map(o => o.id);

  for (const tid of taskIds) {
    const task = tasks[tid];
    const card = smTaskCard(tid, task, taskIds, objIds, () => { delete scene.tasks[tid]; markUnsaved(); renderSceneMeta(); });
    root.appendChild(card);
  }

  const addTaskBtn = document.createElement('button');
  addTaskBtn.className = 'btn sm-add';
  addTaskBtn.textContent = '+ Добавить task';
  addTaskBtn.addEventListener('click', () => {
    const id = prompt('ID задачи (латиница, underscore):');
    if (!id || id.trim() === '') return;
    if (!scene.tasks) scene.tasks = {};
    scene.tasks[id.trim()] = { text: '', trigger: '', start_active: true };
    markUnsaved(); renderSceneMeta();
  });
  root.appendChild(addTaskBtn);

  // ── script ────────────────────────────────────────────────────────────────────
  root.appendChild(smSec('Script (JSON)'));

  const scriptHint = document.createElement('div');
  scriptHint.style.cssText = 'font-size:10px;color:var(--muted);margin-bottom:3px';
  scriptHint.textContent = 'Массив правил: [ { "if": [...], "remove": [...], "complete": [...] } ]';
  root.appendChild(scriptHint);

  const scriptTa = document.createElement('textarea');
  scriptTa.value = JSON.stringify(scene.script ?? [], null, 2);
  scriptTa.rows  = 12;
  scriptTa.style.cssText = 'font-family:monospace;font-size:10px;width:100%;resize:vertical';
  scriptTa.addEventListener('change', () => {
    try {
      const parsed = JSON.parse(scriptTa.value);
      scene.script = parsed.length ? parsed : undefined;
      scriptTa.style.borderColor = '';
      markUnsaved();
    } catch { scriptTa.style.borderColor = '#f55'; }
  });
  scriptTa.addEventListener('input', () => { scriptTa.style.borderColor = ''; });
  root.appendChild(scriptTa);
}

function smSec(text) {
  const d = document.createElement('div'); d.className = 'sm-sec'; d.textContent = text; return d;
}

function smField(label, input) {
  const w = document.createElement('div'); w.className = 'sm-field';
  const l = document.createElement('label'); l.textContent = label;
  w.appendChild(l); w.appendChild(input); return w;
}

function smTaskCard(tid, task, taskIds, objIds, onDelete) {
  const card = document.createElement('div'); card.className = 'sm-card';

  // Header
  const hd = document.createElement('div'); hd.className = 'sm-card-hd';
  const idSpan = document.createElement('span'); idSpan.className = 'sm-card-id'; idSpan.textContent = tid;
  const del = document.createElement('span'); del.className = 'sm-card-del'; del.textContent = '×';
  del.title = 'Удалить task';
  del.addEventListener('click', onDelete);
  hd.appendChild(idSpan); hd.appendChild(del);
  card.appendChild(hd);

  // text
  const textTa = document.createElement('textarea');
  textTa.value = task.text ?? ''; textTa.rows = 2;
  textTa.addEventListener('change', () => { task.text = textTa.value; markUnsaved(); });
  card.appendChild(smField('text', textTa));

  // text_key
  const tkIn = document.createElement('input'); tkIn.type = 'text'; tkIn.value = task.text_key ?? '';
  tkIn.placeholder = 'scavenge.scene_id.task_id';
  tkIn.addEventListener('change', () => { task.text_key = tkIn.value || undefined; markUnsaved(); });
  card.appendChild(smField('text_key (i18n)', tkIn));

  // trigger
  const trigSel = document.createElement('select');
  trigSel.innerHTML = '<option value="">— нет —</option>';
  for (const oid of objIds) {
    const o = document.createElement('option'); o.value = oid; o.textContent = oid;
    if (oid === task.trigger) o.selected = true;
    trigSel.appendChild(o);
  }
  trigSel.addEventListener('change', () => { task.trigger = trigSel.value || undefined; markUnsaved(); });
  card.appendChild(smField('trigger (объект)', trigSel));

  // start_active
  const actWrap = document.createElement('div'); actWrap.className = 'pr-ck';
  const actCb = document.createElement('input'); actCb.type = 'checkbox';
  actCb.checked = task.start_active !== false;
  actCb.addEventListener('change', () => {
    if (actCb.checked) delete task.start_active;
    else task.start_active = false;
    markUnsaved();
  });
  const actLbl = document.createElement('label'); actLbl.textContent = 'start_active';
  actWrap.appendChild(actCb); actWrap.appendChild(actLbl);
  card.appendChild(actWrap);

  // activation (tasks that unlock this task)
  const otherTasks = taskIds.filter(t => t !== tid);
  if (otherTasks.length) {
    const actSec = document.createElement('div');
    actSec.className = 'sm-field';
    const lbl = document.createElement('label'); lbl.textContent = 'activation (разблокируется после)';
    actSec.appendChild(lbl);
    for (const ot of otherTasks) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:6px';
      const cb  = document.createElement('input'); cb.type = 'checkbox';
      cb.checked = (task.activation ?? []).includes(ot);
      cb.addEventListener('change', () => {
        if (!task.activation) task.activation = [];
        if (cb.checked) { if (!task.activation.includes(ot)) task.activation.push(ot); }
        else task.activation = task.activation.filter(x => x !== ot);
        if (!task.activation.length) delete task.activation;
        markUnsaved();
      });
      const ll = document.createElement('span'); ll.textContent = ot; ll.style.fontSize = '11px';
      row.appendChild(cb); row.appendChild(ll);
      actSec.appendChild(row);
    }
    card.appendChild(actSec);
  }

  return card;
}

// ── Save ──────────────────────────────────────────────────────────────────────
document.getElementById('btn-save').addEventListener('click', save);
async function save() {
  if (!scene) return;
  await api('PUT', `/api/scavenge/scene/${scene.id}`, scene);
  setSaved();
}

function markUnsaved() {
  const el = document.getElementById('saveStatus');
  el.textContent = '● не сохранено'; el.className = 'unsaved';
}
function setSaved() {
  const el = document.getElementById('saveStatus');
  el.textContent = '✓ Сохранено'; el.className = 'saved';
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selId) removeObj(selId);
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  if (selId && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
    e.preventDefault();
    const obj = (scene?.objects ?? []).find(o => o.id === selId);
    if (!obj) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft')  obj.x = Math.max(0, obj.x - step);
    if (e.key === 'ArrowRight') obj.x += step;
    if (e.key === 'ArrowUp')    obj.y = Math.max(0, obj.y - step);
    if (e.key === 'ArrowDown')  obj.y += step;
    const el = zoneEl(obj.id); if (el) applyPos(el, obj);
    patchCoords(obj); markUnsaved();
  }
});
