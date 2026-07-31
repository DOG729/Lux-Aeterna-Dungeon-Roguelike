import { apiGet, apiPut, prettyJson, tryParse, escHtml, setStatus, createVariantEditor, createConditionPreview } from '/dev_js/shared.js';
import { resolveTextVariant } from '/pub_js/conditions.js';

const TYPE    = window.EDITOR_TYPE ?? 'mob';
const IS_BOSS = TYPE === 'boss';
const LABEL   = IS_BOSS ? 'Boss' : 'Mob';
const ASSET   = `/assets/${TYPE}/`;

let manifest = [];
let current  = null;
let coreCfg  = null;

const $  = id => document.getElementById(id);
const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };

// ── List ──────────────────────────────────────────────────────────────────────
function renderList(filter = '') {
  const c = $('list-items');
  c.innerHTML = '';
  manifest.forEach((m, i) => {
    const name = m.name ?? m.id ?? '';
    if (filter && !m.id?.includes(filter) && !name.toLowerCase().includes(filter)) return;
    const div = el('div', `list-entry${current === i ? ' active' : ''}`);
    div.innerHTML = `<div class="list-entry-id">${escHtml(m.id)}</div><div class="list-entry-name">${escHtml(name)}</div>`;
    div.addEventListener('click', () => selectEntry(i));
    c.appendChild(div);
  });
}

$('list-search').addEventListener('input', e => renderList(e.target.value.toLowerCase()));
$('btn-new').addEventListener('click', () => {
  manifest.push(IS_BOSS
    ? { id: `boss_${Date.now()}`, name: 'New Boss', hp: 100, energy: 100, count: 1, level: ['1'], multiplier: { hp: 1.1, attack: 1.1 }, stats: {}, function: {}, encounter_text: { default: '', is_ai: false, variants: [] }, phase: [] }
    : { id: `mob_${Date.now()}`,  name: 'New Mob',  hp: 50,  energy: 50,  weight: 5, level: ['1'], stats: {}, function: {}, encounter_text: { default: '', is_ai: false, variants: [] } }
  );
  current = manifest.length - 1;
  renderList($('list-search').value.toLowerCase());
  renderDetail();
});

function selectEntry(i) { current = i; renderList($('list-search').value.toLowerCase()); renderDetail(); }

// ── Phase editor (boss only) ──────────────────────────────────────────────────
function createPhaseEditor(phases, onChange) {
  const plist = (phases ?? []).map(p => ({ ...p }));
  const root  = document.createElement('div');
  const strip = arr => arr.map(p => { const c = { ...p }; delete c._open; return c; });

  function build() {
    root.innerHTML = '';
    plist.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'phase-card';
      card.innerHTML = `
        <div class="phase-header">
          <span>${p._open ? '▼' : '▶'}</span>
          <span style="flex:1">Phase ${p.phase ?? i + 1}${p.phase_name ? ` — <em style="color:#4ecca3">${escHtml(p.phase_name)}</em>` : ''}</span>
          <button class="btn danger p-del" style="padding:1px 7px;font-size:11px">×</button>
        </div>
        <div class="phase-body${p._open ? ' open' : ''}">
          <div class="field-row">
            <div class="field-group"><div class="field-label">phase #</div><input type="number" class="p-num" value="${p.phase ?? i + 1}" min="1"></div>
            <div class="field-group"><div class="field-label">phase_name</div><input type="text" class="p-name" value="${escHtml(p.phase_name ?? '')}"></div>
          </div>
          <div class="field-group"><div class="field-label">if (JSON array)</div><textarea class="p-if" rows="2">${escHtml(prettyJson(p.if ?? []))}</textarea></div>
          <div class="field-group"><div class="field-label">stats override (JSON)</div><textarea class="p-stats" rows="3">${escHtml(prettyJson(p.stats ?? {}))}</textarea></div>
          <div class="field-group"><div class="field-label">function override (JSON)</div><textarea class="p-function" rows="4">${escHtml(prettyJson(p.function ?? {}))}</textarea></div>
          <div class="field-group"><div class="field-label">style override (JSON)</div><textarea class="p-style" rows="3">${escHtml(prettyJson(p.style ?? {}))}</textarea></div>
          <div class="field-group"><div class="field-label">imags override (JSON)</div><textarea class="p-imags" rows="3">${escHtml(prettyJson(p.imags ?? {}))}</textarea></div>
        </div>`;
      card.querySelector('.phase-header').addEventListener('click', e => { if (e.target.closest('.p-del')) return; p._open = !p._open; build(); });
      card.querySelector('.p-del').addEventListener('click', () => { plist.splice(i, 1); onChange(strip(plist)); build(); });
      const body = card.querySelector('.phase-body');
      const emit = () => {
        p.phase      = Number(body.querySelector('.p-num').value) || i + 1;
        p.phase_name = body.querySelector('.p-name').value;
        p.if         = tryParse(body.querySelector('.p-if').value,       p.if ?? []);
        p.stats      = tryParse(body.querySelector('.p-stats').value,    p.stats ?? {});
        p.function   = tryParse(body.querySelector('.p-function').value, p.function ?? {});
        p.style      = tryParse(body.querySelector('.p-style').value,    p.style ?? {});
        p.imags      = tryParse(body.querySelector('.p-imags').value,    p.imags ?? {});
        onChange(strip(plist));
      };
      body.querySelectorAll('textarea, input').forEach(inp => inp.addEventListener('change', emit));
      root.appendChild(card);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'btn muted';
    addBtn.textContent = '+ Add Phase';
    addBtn.style.cssText = 'margin-top:6px;font-size:11px';
    addBtn.addEventListener('click', () => {
      plist.push({ phase: plist.length + 1, phase_name: '', if: [], stats: {}, function: {}, style: {}, imags: {}, _open: true });
      onChange(strip(plist)); build();
    });
    root.appendChild(addBtn);
  }
  build();
  return root;
}

// ── Arena: animation ──────────────────────────────────────────────────────────
let _animTimers = [];
function _clearAnim() { _animTimers.forEach(clearTimeout); _animTimers = []; }

const _toUrl = s => (typeof s === 'string' && (s.startsWith('/') || s.startsWith('http'))) ? s : ASSET + s;

function _playAnim(imgEl, imags, key) {
  _clearAnim();
  const src = imags?.[key] ?? imags?.['default'];
  if (!src) return;
  const frames = (Array.isArray(src) ? src : [src]).map(_toUrl);
  imgEl.src = frames[0];
  if (frames.length === 1) return;
  frames.forEach((f, i) => i > 0 && _animTimers.push(setTimeout(() => { imgEl.src = f; }, i * 180)));
  _animTimers.push(setTimeout(() => _playAnim(imgEl, imags, key), frames.length * 180 + 200));
}

// ── Arena: stat calculation ───────────────────────────────────────────────────
function _calcMult(multiplier, key, level) {
  if (!multiplier || level <= 1) return 1;
  const m = typeof multiplier === 'number' ? multiplier : (multiplier[key] ?? 1);
  return Math.pow(m, level - 1);
}

function calcAtLevel(entity, level) {
  if (!coreCfg) return null;
  const { stats: statsDef, ability: abilDef } = coreCfg.mechanics;

  // Combat stats (armor, power, agility…)
  const stats = {};
  for (const [id, def] of Object.entries(statsDef)) {
    if (def.use === false) continue;
    const raw  = entity.stats?.[id];
    const base = raw == null ? 0 : (typeof raw === 'object' ? (raw.int ?? 0) : raw);
    stats[id]  = Math.round(base * _calcMult(entity.multiplier?.stats, id, level) * 100) / 100;
  }

  // Abilities — only those the mob uses (action:true) or core defaults
  const abilities = {};
  for (const [id, cDef] of Object.entries(abilDef)) {
    const mDef = entity.function?.[id];
    if (!mDef?.action && !cDef.default_action) continue;
    const baseInt = (mDef?.int ?? cDef.int ?? 0) * _calcMult(entity.multiplier, id, level);
    abilities[id] = {
      label:       mDef?.label ?? cDef.label ?? id,
      action:      cDef.action ?? null,
      int:         Math.round(baseInt),
      crit_chance: mDef?.chance_critical     ?? cDef.chance_critical     ?? 0,
      crit_mult:   mDef?.multiplier_critical ?? cDef.multiplier_critical ?? 0,
      energy_cost: mDef?.energy_cost ?? cDef.energy_cost ?? 0,
    };
  }

  // Apply stat modes: power→attack.int, physique→defend.int, agility→crit, etc.
  for (const [sid, sdef] of Object.entries(statsDef)) {
    if (sdef.use === false || !sdef.mode) continue;
    const val = stats[sid] ?? 0;
    if (!val) continue;
    for (const { type, connect, impact } of sdef.mode) {
      if (type !== 'ability') continue;
      const [abilId, field] = connect.split(':');
      if (abilities[abilId]) {
        abilities[abilId][field] = Math.round(((abilities[abilId][field] ?? 0) + val * impact) * 100) / 100;
      }
    }
  }

  return {
    hp:     Math.round((entity.hp     ?? 0) * _calcMult(entity.multiplier, 'hp',  level)),
    energy: entity.energy ?? 0,
    xp:     Math.round((entity.xp     ?? 0) * _calcMult(entity.multiplier, 'xp',  level)),
    stats,
    abilities,
  };
}

// ── Arena: render ─────────────────────────────────────────────────────────────
function renderArena(entity, root) {
  let level    = 1;
  let phaseIdx = -1;
  let animKey  = 'default';

  function effEntity() {
    if (!IS_BOSS || phaseIdx < 0) return entity;
    const ph = entity.phase?.[phaseIdx];
    if (!ph) return entity;
    return { ...entity, stats: { ...entity.stats, ...(ph.stats ?? {}) }, function: { ...entity.function, ...(ph.function ?? {}) } };
  }

  function getImags() {
    const base = entity.imags ?? {};
    if (!IS_BOSS || phaseIdx < 0) return base;
    return { ...base, ...(entity.phase?.[phaseIdx]?.imags ?? {}) };
  }

  function build() {
    _clearAnim();
    const data  = calcAtLevel(effEntity(), level);
    const imags = getImags();
    const keys  = Object.keys(imags).filter(k => k !== 'effects');
    if (keys.length && !keys.includes(animKey)) animKey = keys[0];

    const phaseBtns = IS_BOSS ? `
      <div class="arena-phases">
        <button class="arena-pbtn${phaseIdx < 0 ? ' active' : ''}" data-phase="-1">Base</button>
        ${(entity.phase ?? []).map((p, i) =>
          `<button class="arena-pbtn${phaseIdx === i ? ' active' : ''}" data-phase="${i}">Phase ${p.phase ?? i + 1}${p.phase_name ? ' · ' + escHtml(p.phase_name) : ''}</button>`
        ).join('')}
      </div>` : '';

    root.innerHTML = `
      <div class="arena-wrap">
        ${phaseBtns}
        <div class="arena-body">
          <div class="arena-col-l">
            <div class="arena-sprite-box"><img id="ar-img" class="arena-sprite" src="" alt=""></div>
            <div class="arena-anim-row">
              ${keys.map(k => `<button class="btn muted arena-ab${k === animKey ? ' active' : ''}" data-k="${escHtml(k)}">${escHtml(k)}</button>`).join('') || '<span style="color:#555;font-size:10px">no imags</span>'}
            </div>
            <div class="arena-level-row">
              <span>Lv</span>
              <input type="range" id="ar-lvl" min="1" max="15" value="${level}">
              <span class="arena-lv-val">${level}</span>
            </div>
          </div>
          <div class="arena-col-r">
            ${data ? renderStats(data) : '<div style="color:var(--muted);font-size:11px;padding:8px">No core.json loaded</div>'}
          </div>
        </div>
      </div>`;

    // Sprite
    const imgEl = root.querySelector('#ar-img');
    if (keys.length) {
      _playAnim(imgEl, imags, animKey);
    } else if (entity.image) {
      imgEl.src = _toUrl(entity.image);
    }

    // Level slider
    root.querySelector('#ar-lvl').addEventListener('input', e => {
      level = Number(e.target.value);
      root.querySelector('.arena-lv-val').textContent = level;
      build();
    });

    // Anim buttons
    root.querySelectorAll('.arena-ab').forEach(btn => {
      btn.addEventListener('click', () => {
        animKey = btn.dataset.k;
        root.querySelectorAll('.arena-ab').forEach(b => b.classList.toggle('active', b.dataset.k === animKey));
        _playAnim(root.querySelector('#ar-img'), getImags(), animKey);
      });
    });

    // Phase tabs (boss)
    root.querySelectorAll('.arena-pbtn').forEach(btn => {
      btn.addEventListener('click', () => { phaseIdx = Number(btn.dataset.phase); build(); });
    });
  }

  build();
}

function renderStats(data) {
  const abRows = Object.entries(data.abilities).map(([id, v]) => {
    let info = '';
    if      (v.action === 'attack')             info = `<b>${v.int}</b> dmg`;
    else if (v.action === 'damage_reduction')   info = `<b>${v.int}</b> block`;
    else if (v.action === 'add_energy')         info = `+<b>${v.int}</b> energy`;
    else if (v.action === 'add_hp')             info = `+<b>${v.int}</b> hp`;
    else                                        info = `int <b>${v.int}</b>`;
    const crit = v.crit_chance > 0
      ? ` <em class="ar-crit">crit ${Math.round(v.crit_chance * 100)}% ×${(1 + (v.crit_mult ?? 0)).toFixed(2)}</em>` : '';
    const cost = v.energy_cost ? ` <em class="ar-cost">−${v.energy_cost}⚡</em>` : '';
    return `<tr><td class="ars-k">${escHtml(v.label ?? id)}</td><td class="ars-v">${info}${crit}${cost}</td></tr>`;
  }).join('');

  const stRows = Object.entries(data.stats).filter(([, v]) => v !== 0).map(([k, v]) =>
    `<tr><td class="ars-k">${escHtml(k)}</td><td class="ars-v"><b>${v}</b></td></tr>`
  ).join('');

  return `
    <div class="arena-vitals">
      <div class="ar-vital hp">❤ <b>${data.hp}</b></div>
      <div class="ar-vital">⚡ <b>${data.energy}</b></div>
      <div class="ar-vital xp">⭐ <b>${data.xp}</b> xp</div>
    </div>
    ${abRows ? `<div class="arena-sec">Abilities</div><table class="arena-tbl">${abRows}</table>` : ''}
    ${stRows ? `<div class="arena-sec">Stats</div><table class="arena-tbl">${stRows}</table>` : ''}`;
}

// ── Form HTML builder ─────────────────────────────────────────────────────────
function buildFormHtml(e) {
  return `
    <div class="section-title">Basic</div>
    <div class="field-row">
      <div class="field-group"><div class="field-label">id</div><input type="text" id="f-id" value="${escHtml(e.id ?? '')}"></div>
      <div class="field-group"><div class="field-label">name</div><input type="text" id="f-name" value="${escHtml(e.name ?? '')}"></div>
      ${IS_BOSS
        ? `<div class="field-group" style="flex:0 0 70px"><div class="field-label">count</div><input type="number" id="f-count" value="${e.count ?? 1}" min="1"></div>`
        : `<div class="field-group" style="flex:0 0 80px"><div class="field-label">weight</div><input type="number" id="f-weight" value="${e.weight ?? 5}" min="0"></div>`}
    </div>
    <div class="field-row">
      <div class="field-group"><div class="field-label">HP</div><input type="number" id="f-hp" value="${e.hp ?? 50}" min="1"></div>
      <div class="field-group"><div class="field-label">Energy</div><input type="number" id="f-energy" value="${e.energy ?? 50}" min="0"></div>
      <div class="field-group"><div class="field-label">XP</div><input type="number" id="f-xp" value="${e.xp ?? 0}" min="0"></div>
    </div>
    <div class="field-row">
      <div class="field-group"><div class="field-label">level (JSON)</div><input type="text" id="f-level" value="${escHtml(JSON.stringify(e.level ?? ['1']))}"></div>
      <div class="field-group"><div class="field-label">pawn image</div><input type="text" id="f-pawn" value="${escHtml(e.pawn ?? '')}"></div>
    </div>
    ${IS_BOSS ? `
    <div class="field-row">
      <div class="field-group"><div class="field-label">multiplier.hp</div><input type="number" id="f-mult-hp" value="${e.multiplier?.hp ?? 1}" step="0.01"></div>
      <div class="field-group"><div class="field-label">multiplier.attack</div><input type="number" id="f-mult-atk" value="${e.multiplier?.attack ?? 1}" step="0.01"></div>
    </div>` : ''}
    <div class="field-row">
      <div class="field-group"><div class="field-label">surrender.hp (0–1)</div><input type="number" id="f-sur-hp" value="${e.surrender_difficulty?.hp ?? ''}" step="0.05" min="0" max="1" placeholder="e.g. 0.55"></div>
      <div class="field-group"><div class="field-label">surrender.energy (0–1)</div><input type="number" id="f-sur-en" value="${e.surrender_difficulty?.energy ?? ''}" step="0.05" min="0" max="1" placeholder="e.g. 0.60"></div>
    </div>

    <div class="section-title">Stats <span style="color:var(--muted);font-size:9px;font-weight:normal">JSON object</span></div>
    <textarea id="f-stats" rows="4">${escHtml(prettyJson(e.stats ?? {}))}</textarea>

    <div class="section-title">Function <span style="color:var(--muted);font-size:9px;font-weight:normal">JSON — ability overrides</span></div>
    <textarea id="f-function" rows="8">${escHtml(prettyJson(e.function ?? {}))}</textarea>

    <div class="section-title">Items (loot) <span style="color:var(--muted);font-size:9px;font-weight:normal">JSON array</span></div>
    <textarea id="f-items" rows="3">${escHtml(prettyJson(e.items ?? []))}</textarea>

    <div class="section-title">Imags <span style="color:var(--muted);font-size:9px;font-weight:normal">JSON object</span></div>
    <textarea id="f-imags" rows="6">${escHtml(prettyJson(e.imags ?? {}))}</textarea>

    ${IS_BOSS ? `
    <div class="section-title">Style <span style="color:var(--muted);font-size:9px;font-weight:normal">JSON object</span></div>
    <textarea id="f-style" rows="3">${escHtml(prettyJson(e.style ?? {}))}</textarea>` : ''}

    <div class="section-title">Encounter Text</div>
    <div class="field-group"><div class="field-label">default text</div>
      <textarea id="f-enc-default" rows="3">${escHtml(e.encounter_text?.default ?? '')}</textarea>
    </div>
    <label class="inline-label" style="margin-bottom:10px">
      <input type="checkbox" id="f-enc-ai" ${e.encounter_text?.is_ai ? 'checked' : ''}> is_ai
    </label>
    <div class="section-title" style="font-size:9px;color:var(--muted)">VARIANTS</div>
    <div id="f-variants"></div>
    <div id="f-preview"></div>
    ${IS_BOSS ? `<div class="section-title">Phases</div><div id="f-phases"></div>` : ''}`;
}

// ── Collect form values ───────────────────────────────────────────────────────
function collectForm() {
  const e      = { ...manifest[current] };
  e.id         = $('f-id').value.trim();
  e.name       = $('f-name').value.trim();
  e.hp         = Number($('f-hp').value)     || 0;
  e.energy     = Number($('f-energy').value) || 0;
  e.xp         = Number($('f-xp').value)     || 0;
  e.pawn       = $('f-pawn').value.trim();
  e.level      = tryParse($('f-level').value,    e.level);
  e.stats      = tryParse($('f-stats').value,    e.stats    ?? {});
  e.function   = tryParse($('f-function').value, e.function ?? {});
  e.items      = tryParse($('f-items').value,    e.items    ?? []);
  e.imags      = tryParse($('f-imags').value,    e.imags    ?? {});

  if (IS_BOSS) {
    e.count = Number($('f-count').value) || 1;
    const mHp = parseFloat($('f-mult-hp').value), mAtk = parseFloat($('f-mult-atk').value);
    e.multiplier = {};
    if (!isNaN(mHp))  e.multiplier.hp     = mHp;
    if (!isNaN(mAtk)) e.multiplier.attack  = mAtk;
    e.style = tryParse($('f-style').value, e.style ?? {});
  } else {
    e.weight = Number($('f-weight').value) || 0;
  }

  const surHp = parseFloat($('f-sur-hp').value);
  const surEn = parseFloat($('f-sur-en').value);
  if (!isNaN(surHp) || !isNaN(surEn)) {
    e.surrender_difficulty = {};
    if (!isNaN(surHp)) e.surrender_difficulty.hp     = surHp;
    if (!isNaN(surEn)) e.surrender_difficulty.energy = surEn;
  } else delete e.surrender_difficulty;

  e.encounter_text = {
    is_ai:    $('f-enc-ai').checked,
    default:  $('f-enc-default').value,
    variants: e.encounter_text?.variants ?? [],
  };
  return e;
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function renderDetail() {
  const panel = $('detail-panel');
  if (current === null || !manifest[current]) {
    panel.innerHTML = `<div class="detail-empty">← Select a ${LABEL.toLowerCase()}</div>`; return;
  }
  const entity = manifest[current];
  let _tab = 'form';

  panel.innerHTML = `
    <div class="detail-toolbar">
      <span class="entry-label" id="det-label">${escHtml(entity.id)}</span>
      <div class="tab-bar">
        <button class="btn active" data-tab="form">Form</button>
        <button class="btn muted"  data-tab="json">JSON</button>
        <button class="btn muted"  data-tab="arena">🗡 Arena</button>
      </div>
      <button class="btn danger" id="btn-del" style="margin-left:auto">Delete</button>
      <button class="btn green"  id="btn-save">Save</button>
      <span id="det-status"></span>
    </div>
    <div class="detail-body">
      <div id="view-form">${buildFormHtml(entity)}</div>
      <div id="view-json" style="display:none;flex-direction:column;gap:6px">
        <div style="font-size:11px;color:var(--muted)">Edit raw JSON. Click "Form" to apply changes.</div>
        <textarea id="raw-json" style="min-height:500px;font-size:11px"></textarea>
      </div>
      <div id="view-arena" style="display:none"></div>
    </div>`;

  // Variant editor
  $('f-variants').appendChild(createVariantEditor(entity.encounter_text?.variants ?? [], vs => {
    if (!entity.encounter_text) entity.encounter_text = {};
    entity.encounter_text.variants = vs;
  }));

  // Condition preview
  $('f-preview').appendChild(createConditionPreview(() => ({
    default:  $('f-enc-default').value,
    is_ai:    $('f-enc-ai').checked,
    variants: entity.encounter_text?.variants ?? [],
  }), resolveTextVariant));

  // Phase editor (boss only)
  if (IS_BOSS) {
    $('f-phases').appendChild(createPhaseEditor(entity.phase ?? [], phases => { entity.phase = phases; }));
  }

  // ── Tab switching ──
  panel.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const newTab = btn.dataset.tab;
      if (newTab === _tab) return;
      const oldTab = _tab;

      // Leaving JSON → apply parsed data
      if (oldTab === 'json') {
        const parsed = tryParse($('raw-json').value);
        if (!parsed) { alert('Invalid JSON'); return; }
        manifest[current] = parsed;
        if (newTab === 'form') { renderDetail(); return; } // full re-render into form
      }

      _tab = newTab;
      panel.querySelectorAll('[data-tab]').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === newTab);
        b.classList.toggle('muted',  b.dataset.tab !== newTab);
      });
      $('view-form').style.display  = newTab === 'form'  ? '' : 'none';
      $('view-json').style.display  = newTab === 'json'  ? 'flex' : 'none';
      $('view-arena').style.display = newTab === 'arena' ? '' : 'none';

      if (newTab === 'json') {
        $('raw-json').value = prettyJson(oldTab === 'form' ? collectForm() : manifest[current]);
      } else if (newTab === 'arena') {
        const snap = oldTab === 'form' ? collectForm() : manifest[current];
        renderArena(snap, $('view-arena'));
      }
    });
  });

  // ── Save ──
  $('btn-save').addEventListener('click', async () => {
    let saved;
    if (_tab === 'json') {
      const parsed = tryParse($('raw-json').value);
      if (!parsed) { setStatus($('det-status'), 'Invalid JSON', true); return; }
      saved = manifest[current] = parsed;
    } else if (_tab === 'arena') {
      saved = manifest[current]; // arena doesn't edit, save current manifest state
    } else {
      saved = manifest[current] = collectForm();
    }
    try {
      await apiPut(TYPE, manifest);
      setStatus($('det-status'), '✓ Saved');
      $('det-label').textContent = saved.id;
      renderList($('list-search').value.toLowerCase());
    } catch (err) { setStatus($('det-status'), err.message, true); }
  });

  // ── Delete ──
  $('btn-del').addEventListener('click', async () => {
    if (!confirm(`Delete ${entity.id}?`)) return;
    manifest.splice(current, 1);
    current = null;
    try {
      await apiPut(TYPE, manifest);
      renderList($('list-search').value.toLowerCase());
      panel.innerHTML = `<div class="detail-empty">← Select a ${LABEL.toLowerCase()}</div>`;
    } catch (err) { alert(err.message); }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    [manifest, coreCfg] = await Promise.all([
      apiGet(TYPE),
      fetch('/api/core').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    renderList();
  } catch (err) { $('list-items').textContent = 'Error: ' + err.message; }
})();
