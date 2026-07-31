'use strict';
// ── API ───────────────────────────────────────────────────────────────────────
export async function apiGet(type) {
  const r = await fetch(`/api/data/${type}`);
  if (!r.ok) throw new Error(`GET /api/data/${type} → ${r.status}`);
  return r.json();
}

export async function apiPut(type, data) {
  const r = await fetch(`/api/data/${type}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`PUT /api/data/${type} → ${r.status}`);
  return r.json();
}

export const prettyJson = v => JSON.stringify(v, null, 2);
export const tryParse   = (s, fb = null) => { try { return JSON.parse(s); } catch { return fb; } };
export const escHtml    = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Status helper ─────────────────────────────────────────────────────────────
export function setStatus(el, msg, isErr = false) {
  if (!el) return;
  el.textContent = msg;
  el.className = isErr ? 'status-err' : 'status-ok';
  if (!isErr) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
}

// ── Nav: mark current page active ─────────────────────────────────────────────
export function initNav() {
  document.querySelectorAll('.dev-nav a').forEach(a => {
    if (a.href === location.href || location.pathname.endsWith(a.getAttribute('href') ?? '')) {
      a.classList.add('active');
    }
  });
}

// ── Variant editor ────────────────────────────────────────────────────────────
// Returns a root DOM element that renders an editable variant list.
// variants : initial array of variant objects
// onChange(clean) : called with a clean copy (no _ui_ keys) whenever data changes
export function createVariantEditor(variants, onChange) {
  const vlist = (variants ?? []).map(v => ({ ...v }));
  const root  = document.createElement('div');

  function clean(arr) { return arr.map(v => { const c = { ...v }; delete c._open; return c; }); }

  function build() {
    root.innerHTML = '';

    vlist.forEach((v, i) => {
      const isOpen = !!v._open;

      const tags = [
        v.extension             ? '<span class="tag ext">ext</span>'       : '',
        v.is_ai                 ? '<span class="tag ai">ai</span>'          : '',
        (v.priority ?? 0) > 0  ? `<span class="tag pri">p:${v.priority}</span>` : '',
      ].join('');

      const card = document.createElement('div');
      card.className = 'variant-card';
      card.innerHTML = `
        <div class="variant-header">
          <span>${isOpen ? '▼' : '▶'}</span>
          <span style="flex:1">Variant #${i + 1}${v.key ? ` <em style="color:#778;font-size:10px">[${escHtml(v.key)}]</em>` : ''}</span>
          ${tags}
          <button class="btn muted v-del" style="padding:1px 7px;margin-left:4px;font-size:11px">×</button>
        </div>
        <div class="variant-body${isOpen ? ' open' : ''}">
          <div class="field-group">
            <div class="field-label">if — conditions array (JSON)</div>
            <textarea class="v-if" rows="2" style="width:100%;font-size:11px">${escHtml(prettyJson(v.if ?? []))}</textarea>
          </div>
          <div class="field-group">
            <div class="field-label">text</div>
            <textarea class="v-text" rows="3" style="width:100%">${escHtml(v.text ?? '')}</textarea>
          </div>
          <div class="field-row" style="margin-bottom:8px">
            <div class="field-group" style="margin:0;flex:1">
              <div class="field-label">key (translation key)</div>
              <input type="text" class="v-key" value="${escHtml(v.key ?? '')}">
            </div>
          </div>
          <div class="variant-meta">
            <label class="inline-label">priority
              <input type="number" class="v-priority" value="${v.priority ?? 0}" min="0" max="999" style="width:60px">
            </label>
            <label class="inline-label"><input type="checkbox" class="v-extension" ${v.extension ? 'checked' : ''}> extension</label>
            <label class="inline-label"><input type="checkbox" class="v-is_ai"     ${v.is_ai     ? 'checked' : ''}> is_ai</label>
          </div>
        </div>
      `;

      card.querySelector('.variant-header').addEventListener('click', e => {
        if (e.target.closest('.v-del')) return;
        v._open = !v._open;
        build();
      });

      card.querySelector('.v-del').addEventListener('click', () => {
        vlist.splice(i, 1);
        onChange(clean(vlist));
        build();
      });

      const body = card.querySelector('.variant-body');
      const emit = () => {
        v.if        = tryParse(body.querySelector('.v-if').value, v.if ?? []);
        v.text      = body.querySelector('.v-text').value;
        v.key       = body.querySelector('.v-key').value;
        v.priority  = Number(body.querySelector('.v-priority').value) || 0;
        v.extension = body.querySelector('.v-extension').checked;
        v.is_ai     = body.querySelector('.v-is_ai').checked;
        onChange(clean(vlist));
      };
      body.querySelectorAll('textarea, input').forEach(el => el.addEventListener('change', emit));

      root.appendChild(card);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'btn muted';
    addBtn.textContent = '+ Add Variant';
    addBtn.style.cssText = 'margin-top:6px;font-size:11px';
    addBtn.addEventListener('click', () => {
      vlist.push({ if: [], text: '', key: '', priority: 0, extension: false, is_ai: false, _open: true });
      onChange(clean(vlist));
      build();
    });
    root.appendChild(addBtn);
  }

  build();
  return root;
}

// ── Condition preview panel ───────────────────────────────────────────────────
// Builds a "Condition Preview" box.
// getSpec()          : fn returning the current encounter_text / narrative_text spec
// resolveTextVariant : imported from conditions.js
export function createConditionPreview(getSpec, resolveTextVariant) {
  const box = document.createElement('div');
  box.className = 'preview-box';
  box.innerHTML = `
    <div class="preview-title">🔍 Condition Preview</div>
    <div class="preview-controls">
      <label class="inline-label">HP <input type="number" id="pv-hp"    value="100" min="0" max="9999" style="width:64px"></label>
      <label class="inline-label">maxHP <input type="number" id="pv-maxhp" value="100" min="1" max="9999" style="width:64px"></label>
      <label class="inline-label"><input type="checkbox" id="pv-berserk"> berserk</label>
      <button class="btn muted" id="pv-btn" style="font-size:11px">▶ Preview</button>
    </div>
    <div class="preview-result empty" id="pv-result">—</div>
  `;

  box.querySelector('#pv-btn').addEventListener('click', () => {
    const hp       = Number(box.querySelector('#pv-hp').value)    || 100;
    const maxHp    = Number(box.querySelector('#pv-maxhp').value) || 100;
    const berserk  = box.querySelector('#pv-berserk').checked;

    const mockG = {
      player: { hp, maxHp, energy: 100, maxEnergy: 100, kills: 0, mobsEncountered: 0, inventory: [], equip: {}, learnedSkills: [], stats: {} },
      conditions: berserk ? [{ id: 'berserk', if: [], int: 1 }] : [],
    };

    const spec = getSpec();
    const res  = resolveTextVariant(spec, mockG, { mob_name: 'MOB', npc_name: 'NPC' });
    const el   = box.querySelector('#pv-result');
    if (res.text) {
      el.textContent = (res.is_ai ? '[AI] ' : '') + res.text;
      el.classList.remove('empty');
    } else {
      el.textContent = '(пусто — нет совпадений)';
      el.classList.add('empty');
    }
  });

  return box;
}
