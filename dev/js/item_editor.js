import { apiGet, apiPut, prettyJson, tryParse, escHtml, setStatus } from '/dev_js/shared.js';

const TYPE = 'item';
let manifest  = [];
let current   = null;
let _equipCfg = null;
async function getEquipCfg() {
  if (!_equipCfg) {
    const r = await fetch('/api/equip-config');
    if (!r.ok) throw new Error(`GET /api/equip-config → ${r.status}`);
    _equipCfg = await r.json();
  }
  return _equipCfg;
}

const $ = id => document.getElementById(id);
const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };

function renderList(filter = '') {
  const container = $('list-items');
  container.innerHTML = '';
  manifest.forEach((item, i) => {
    const name = item.name ?? item.id ?? '';
    if (filter && !item.id.includes(filter) && !name.toLowerCase().includes(filter)) return;
    const div = el('div', `list-entry${current === i ? ' active' : ''}`);
    const equip = item.equip && item.equip !== false ? `<span style="color:var(--yellow);font-size:9px">${item.equip}</span>` : '';
    div.innerHTML = `<div class="list-entry-id">${escHtml(item.id)} ${equip}</div><div class="list-entry-name">${escHtml(name)}</div>`;
    div.addEventListener('click', () => selectEntry(i));
    container.appendChild(div);
  });
}

$('list-search').addEventListener('input', e => renderList(e.target.value.toLowerCase()));
$('btn-new').addEventListener('click', () => {
  manifest.push({ id: `item_${Date.now()}`, name: 'New Item', image: '', inventory: true, equip: false });
  current = manifest.length - 1;
  renderList($('list-search').value.toLowerCase());
  renderDetail();
});

function selectEntry(i) { current = i; renderList($('list-search').value.toLowerCase()); renderDetail(); }

async function renderDetail() {
  const panel = $('detail-panel');
  if (current === null || !manifest[current]) { panel.innerHTML = '<div class="detail-empty">← Select an item</div>'; return; }
  const item = manifest[current];

  // equip options — unique codes derived from config (code ?? key)
  const equipCfg  = await getEquipCfg();
  const allCodes  = Object.entries(equipCfg ?? {}).map(([k, cfg]) => cfg.type ?? k);
  const codes     = [...new Set(allCodes)];
  const equipOpts = [false, ...codes].map(v =>
    `<option value="${v}" ${(item.equip ?? false).toString() === v.toString() ? 'selected' : ''}>${v === false ? 'false (not equippable)' : v}</option>`
  ).join('');

  panel.innerHTML = `
    <div class="detail-toolbar">
      <span class="entry-label" id="det-label">${escHtml(item.id)}</span>
      <div class="tab-bar">
        <button class="btn active" data-tab="form">Form</button>
        <button class="btn muted"  data-tab="json">JSON</button>
      </div>
      <button class="btn danger" id="btn-del" style="margin-left:auto">Delete</button>
      <button class="btn green"  id="btn-save">Save</button>
      <span id="det-status"></span>
    </div>
    <div class="detail-body">
      <div id="view-form">
        <div class="section-title">Basic</div>
        <div class="field-row">
          <div class="field-group"><div class="field-label">id</div><input type="text" id="f-id" value="${escHtml(item.id ?? '')}"></div>
          <div class="field-group"><div class="field-label">name</div><input type="text" id="f-name" value="${escHtml(item.name ?? '')}"></div>
        </div>
        <div class="field-row">
          <div class="field-group"><div class="field-label">image (filename)</div><input type="text" id="f-image" value="${escHtml(item.image ?? '')}"></div>
          <div class="field-group" style="flex:0 0 60px"><div class="field-label">level</div><input type="number" id="f-level" value="${item.level ?? ''}" min="1" placeholder="–"></div>
        </div>
        <div class="field-row">
          <div class="field-group"><div class="field-label">equip slot</div><select id="f-equip">${equipOpts}</select></div>
          <div class="field-group"><div class="field-label">function</div><input type="text" id="f-function" value="${escHtml(item.function ?? '')}" placeholder="e.g. gold, key_door"></div>
        </div>
        <div class="field-row">
          <label class="inline-label w-auto"><input type="checkbox" id="f-inventory" ${item.inventory !== false ? 'checked' : ''}> inventory</label>
          <label class="inline-label w-auto"><input type="checkbox" id="f-inventorybar" ${item.inventorybar ? 'checked' : ''}> inventorybar</label>
          <label class="inline-label w-auto"><input type="checkbox" id="f-use-destroy" ${item.use_destroy ? 'checked' : ''}> use_destroy</label>
        </div>

        <div class="section-title">Pricing</div>
        <div class="field-row">
          <div class="field-group"><div class="field-label">price_buy</div><input type="number" id="f-price-buy" value="${item.price_buy ?? ''}" min="0" placeholder="–"></div>
          <div class="field-group"><div class="field-label">price_sell</div><input type="number" id="f-price-sell" value="${item.price_sell ?? ''}" min="0" placeholder="–"></div>
        </div>

        <div class="section-title">Stats <span style="color:var(--muted);font-size:9px">JSON object — e.g. {"ability:attack:int": 12}</span></div>
        <textarea id="f-stats" rows="5">${escHtml(prettyJson(item.stats ?? {}))}</textarea>

        <div class="section-title">Use (consumable) <span style="color:var(--muted);font-size:9px">JSON — {in_combat:{hp:50}, out_combat:{hp:55}}</span></div>
        <textarea id="f-use" rows="5">${escHtml(prettyJson(item.use ?? null))}</textarea>

        <div class="section-title">Other fields <span style="color:var(--muted);font-size:9px">JSON — any extra fields</span></div>
        <textarea id="f-extra" rows="4">${escHtml(prettyJson(collectExtra(item)))}</textarea>
      </div>

      <div id="view-json" class="json-view">
        <div style="font-size:11px;color:var(--muted)">Edit raw JSON. Click "Form" to apply changes.</div>
        <textarea id="raw-json" rows="40" style="min-height:500px">${escHtml(prettyJson(item))}</textarea>
      </div>
    </div>
  `;

  // If image filename is set, show a preview
  if (item.image) {
    const img = document.createElement('img');
    img.src = `/assets/item/${item.image}`;
    img.style.cssText = 'max-width:64px;max-height:64px;margin-top:6px;border:1px solid var(--border);';
    img.onerror = () => img.style.display = 'none';
    $('f-image').closest('.field-group').appendChild(img);
  }

  // Tabs
  panel.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      panel.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.classList.toggle('muted', b.dataset.tab !== tab); });
      if (tab === 'json') { $('raw-json').value = prettyJson(collectForm()); $('view-form').style.display = 'none'; $('view-json').classList.add('visible'); }
      else {
        const parsed = tryParse($('raw-json').value);
        if (!parsed) { alert('Invalid JSON'); return; }
        manifest[current] = parsed; $('view-json').classList.remove('visible'); $('view-form').style.display = ''; renderDetail();
      }
    });
  });

  $('btn-save').addEventListener('click', async () => {
    const isJson = $('view-json').classList.contains('visible');
    if (isJson) { const p = tryParse($('raw-json').value); if (!p) { setStatus($('det-status'), 'Invalid JSON', true); return; } manifest[current] = p; }
    else { manifest[current] = collectForm(); }
    try { await apiPut(TYPE, manifest); setStatus($('det-status'), '✓ Saved'); $('det-label').textContent = manifest[current].id; renderList($('list-search').value.toLowerCase()); }
    catch (e) { setStatus($('det-status'), e.message, true); }
  });

  $('btn-del').addEventListener('click', async () => {
    if (!confirm(`Delete ${item.id}?`)) return;
    manifest.splice(current, 1); current = null;
    try { await apiPut(TYPE, manifest); renderList($('list-search').value.toLowerCase()); $('detail-panel').innerHTML = '<div class="detail-empty">← Select an item</div>'; }
    catch (e) { alert(e.message); }
  });
}

const KNOWN_FIELDS = new Set(['id', 'name', 'image', 'level', 'equip', 'function', 'inventory', 'inventorybar', 'use_destroy', 'price_buy', 'price_sell', 'stats', 'use', 'object_use']);
function collectExtra(item) {
  const out = {};
  for (const [k, v] of Object.entries(item)) { if (!KNOWN_FIELDS.has(k)) out[k] = v; }
  return Object.keys(out).length ? out : {};
}

function collectForm() {
  const item = {};
  item.id         = $('f-id').value.trim();
  item.name       = $('f-name').value.trim();
  item.image      = $('f-image').value.trim();
  const lvl       = $('f-level').value;
  if (lvl) item.level = Number(lvl);
  const equipVal  = $('f-equip').value;
  item.equip      = equipVal === 'false' ? false : equipVal;
  item.inventory  = $('f-inventory').checked;
  if ($('f-inventorybar').checked) item.inventorybar = true;
  if ($('f-use-destroy').checked)  item.use_destroy  = true;
  const fn        = $('f-function').value.trim();
  if (fn) item.function = fn;
  const pBuy  = $('f-price-buy').value;
  const pSell = $('f-price-sell').value;
  if (pBuy  !== '') item.price_buy  = Number(pBuy);
  if (pSell !== '') item.price_sell = Number(pSell);
  const stats = tryParse($('f-stats').value, null);
  if (stats && Object.keys(stats).length) item.stats = stats;
  const use   = tryParse($('f-use').value, null);
  if (use)   item.use  = use;
  // Merge extra fields
  const extra = tryParse($('f-extra').value, {});
  return { ...item, ...extra };
}

(async () => {
  try { manifest = await apiGet(TYPE); renderList(); }
  catch (e) { $('list-items').textContent = 'Error: ' + e.message; }
})();
