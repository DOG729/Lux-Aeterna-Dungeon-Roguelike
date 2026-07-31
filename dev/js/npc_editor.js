import { apiGet, apiPut, prettyJson, tryParse, escHtml, setStatus, createVariantEditor, createConditionPreview } from '/dev_js/shared.js';
import { resolveTextVariant } from '/pub_js/conditions.js';

const TYPE = 'npc';
let manifest = [];
let current  = null;

const $ = id => document.getElementById(id);
const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };

function renderList(filter = '') {
  const container = $('list-items');
  container.innerHTML = '';
  manifest.forEach((n, i) => {
    const name = n.name ?? n.id ?? '';
    if (filter && !n.id.includes(filter) && !name.toLowerCase().includes(filter)) return;
    const div = el('div', `list-entry${current === i ? ' active' : ''}`);
    div.innerHTML = `<div class="list-entry-id">${escHtml(n.id)}</div><div class="list-entry-name">${escHtml(name)} <span style="color:var(--muted);font-size:9px">${n.type ?? ''}</span></div>`;
    div.addEventListener('click', () => selectEntry(i));
    container.appendChild(div);
  });
}

$('list-search').addEventListener('input', e => renderList(e.target.value.toLowerCase()));
$('btn-new').addEventListener('click', () => {
  manifest.push({ id: `npc_${Date.now()}`, name: 'New NPC', type: 'other', level: ['1'], max_count_message: 5, message_ignores: '...', portrait: '', pawn: '', icon: '', promt: '', narrative_text: { default: '', is_ai: false, variants: [] } });
  current = manifest.length - 1;
  renderList($('list-search').value.toLowerCase());
  renderDetail();
});

function selectEntry(i) { current = i; renderList($('list-search').value.toLowerCase()); renderDetail(); }

function renderDetail() {
  const panel = $('detail-panel');
  if (current === null || !manifest[current]) { panel.innerHTML = '<div class="detail-empty">← Select an NPC</div>'; return; }
  const npc = manifest[current];

  panel.innerHTML = `
    <div class="detail-toolbar">
      <span class="entry-label" id="det-label">${escHtml(npc.id)}</span>
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
          <div class="field-group"><div class="field-label">id</div><input type="text" id="f-id" value="${escHtml(npc.id ?? '')}"></div>
          <div class="field-group"><div class="field-label">name</div><input type="text" id="f-name" value="${escHtml(npc.name ?? '')}"></div>
          <div class="field-group" style="flex:0 0 110px">
            <div class="field-label">type</div>
            <select id="f-type">
              <option value="other"  ${npc.type === 'other'  ? 'selected' : ''}>other</option>
              <option value="trader" ${npc.type === 'trader' ? 'selected' : ''}>trader</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field-group"><div class="field-label">level (JSON)</div><input type="text" id="f-level" value="${escHtml(JSON.stringify(npc.level ?? ['1']))}"></div>
          <div class="field-group"><div class="field-label">max messages</div><input type="number" id="f-max-msg" value="${npc.max_count_message ?? 5}" min="1"></div>
          <div class="field-group"><div class="field-label">count per level</div><input type="number" id="f-count" value="${npc.count_spawn_level ?? 1}" min="1"></div>
        </div>
        <div class="field-group">
          <div class="field-label">message_ignores (silence text)</div>
          <input type="text" id="f-ignores" value="${escHtml(npc.message_ignores ?? '')}">
        </div>
        <div class="field-row">
          <div class="field-group"><div class="field-label">portrait</div><input type="text" id="f-portrait" value="${escHtml(npc.portrait ?? '')}"></div>
          <div class="field-group"><div class="field-label">pawn</div><input type="text" id="f-pawn" value="${escHtml(npc.pawn ?? '')}"></div>
          <div class="field-group"><div class="field-label">icon</div><input type="text" id="f-icon" value="${escHtml(npc.icon ?? '')}"></div>
        </div>

        <div class="section-title">AI Prompt</div>
        <div class="field-group">
          <div class="field-label">promt (system prompt for AI chat)</div>
          <textarea id="f-promt" rows="8">${escHtml(typeof npc.promt === 'string' ? npc.promt : prettyJson(npc.promt ?? ''))}</textarea>
        </div>

        <div class="section-title">Narrative Text (on encounter)</div>
        <div class="field-group">
          <div class="field-label">default text</div>
          <textarea id="f-nar-default" rows="3">${escHtml(npc.narrative_text?.default ?? '')}</textarea>
        </div>
        <label class="inline-label" style="margin-bottom:10px"><input type="checkbox" id="f-nar-ai" ${npc.narrative_text?.is_ai ? 'checked' : ''}> is_ai</label>
        <div class="section-title" style="font-size:9px;color:var(--muted)">VARIANTS</div>
        <div id="f-variants"></div>
        <div id="f-preview"></div>

        <div class="section-title">Trader Items <span style="color:var(--muted);font-size:9px">JSON array (only for type=trader)</span></div>
        <textarea id="f-trader" rows="10">${escHtml(prettyJson(npc.trader ?? []))}</textarea>
      </div>

      <div id="view-json" class="json-view">
        <div style="font-size:11px;color:var(--muted)">Edit raw JSON. Click "Form" to apply changes.</div>
        <textarea id="raw-json" rows="40" style="min-height:500px">${escHtml(prettyJson(npc))}</textarea>
      </div>
    </div>
  `;

  const variantRoot = createVariantEditor(npc.narrative_text?.variants ?? [], variants => {
    npc.narrative_text = npc.narrative_text ?? {};
    npc.narrative_text.variants = variants;
  });
  $('f-variants').appendChild(variantRoot);

  $('f-preview').appendChild(createConditionPreview(() => ({
    default:  $('f-nar-default').value,
    is_ai:    $('f-nar-ai').checked,
    variants: npc.narrative_text?.variants ?? [],
  }), resolveTextVariant));

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
    if (!confirm(`Delete ${npc.id}?`)) return;
    manifest.splice(current, 1); current = null;
    try { await apiPut(TYPE, manifest); renderList($('list-search').value.toLowerCase()); $('detail-panel').innerHTML = '<div class="detail-empty">← Select an NPC</div>'; }
    catch (e) { alert(e.message); }
  });
}

function collectForm() {
  const npc = { ...manifest[current] };
  npc.id              = $('f-id').value.trim();
  npc.name            = $('f-name').value.trim();
  npc.type            = $('f-type').value;
  npc.level           = tryParse($('f-level').value, npc.level);
  npc.max_count_message = Number($('f-max-msg').value) || 5;
  npc.count_spawn_level = Number($('f-count').value)   || 1;
  npc.message_ignores = $('f-ignores').value;
  npc.portrait        = $('f-portrait').value.trim();
  npc.pawn            = $('f-pawn').value.trim();
  npc.icon            = $('f-icon').value.trim();
  npc.promt           = $('f-promt').value;
  npc.trader          = tryParse($('f-trader').value, npc.trader ?? []);
  npc.narrative_text  = { is_ai: $('f-nar-ai').checked, default: $('f-nar-default').value, variants: npc.narrative_text?.variants ?? [] };
  return npc;
}

(async () => {
  try { manifest = await apiGet(TYPE); renderList(); }
  catch (e) { $('list-items').textContent = 'Error: ' + e.message; }
})();
