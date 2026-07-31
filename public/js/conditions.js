'use strict';
// ── Client-side condition evaluator + image/text resolvers ────────────────────
//
// Экспорты:
//   resolveRef(ref, G)                    — вычислить числовое значение ref
//   evalAll(conditions, G)                — AND-группа условий
//   resolveImagsSpec(spec, G, basePath)   — выбрать imags с учётом условий
//   resolveTextVariant(spec, G, vars)     — выбрать текстовый вариант
//   evalCond(idOrExpr)                    — вычислить по ID / инлайн / ref (state.G)
//   applyConditions(root?)                — обработать if/if-else/else в DOM
//
// ── HTML-директивы ──────────────────────────────────────────────────────────
//
//   <p if="berserk">Берсерк!</p>
//   <p if-else="karma_good">Хорошая карма</p>
//   <p if-else='[["session:player:kills",">",5]]'>Убил 5+</p>
//   <p else>Нейтрал</p>
//
import { state } from './state.js';

// ── Reference resolution ──────────────────────────────────────────────────────
//
// resolveRef(ref, G) → number
//
// ref may be a string (namespace:path) or an arithmetic expression array.
//
// String namespaces:
//   equip:id              — 1 if item is equipped, else 0
//   item:id               — 1 if item is in inventory, else 0
//   skills:id             — 1 if skill is learned, else 0
//   stats:name            — player stat value (e.g. stats:armor)
//   session:a:b:c         — deep path into G  (e.g. session:player:hp)
//
// Arithmetic expression (array):
//   [ref, op, scalar]     — computes a value from a reference and a scalar
//   op: "*" "/" "+" "-"
//   scalar: number | "N%" (= N/100) | string ref (resolved recursively)
//
//   Examples:
//     ["session:player:mobsEncountered", "*", 0.8]   → mobsEncountered × 0.8
//     ["session:player:maxHp",           "*", "50%"] → maxHp × 0.5
//     ["item:sword_iron:price_sell",     "+", 10]    → price + 10
export function resolveRef(ref, G) { 
  // ── Arithmetic expression ──
  if (Array.isArray(ref)) {
    const [base, op, scalar] = ref;
    const baseVal = resolveRef(base, G);
    let scalarVal;
    if (typeof scalar === 'string') {
      const pctM = scalar.match(/^(\d+(?:\.\d+)?)%$/);
      scalarVal = pctM ? parseFloat(pctM[1]) / 100 : resolveRef(scalar, G);
    } else {
      scalarVal = Number(scalar);
    }
    switch (op) {
      case '*': return baseVal * scalarVal;
      case '/': return scalarVal !== 0 ? baseVal / scalarVal : 0;
      case '+': return baseVal + scalarVal;
      case '-': return baseVal - scalarVal;
      default:  return baseVal;
    }
  }

  // ── String reference ──
  const parts = ref.split(':');
  switch (parts[0]) {
    case 'equip':
      // equip:id           → bool
      // equip:id:prop:sub  → property of the equipped item
      return _resolveEquip(parts.slice(1), G);

    case 'item':
      // item:id            → bool (in inventory)
      // item:id:prop:sub   → property of the inventory item
      return _resolveItem(parts.slice(1), G);

    case 'skills': {
      const id = parts.slice(1).join(':');
      return (G?.player?.learnedSkills ?? []).includes(id) ? 1 : 0;
    }

    case 'stats':
      return G?.player?.stats?.[parts[1]] ?? 0;

    case 'condition': {
      const id  = parts.slice(1).join(':');
      const def = (G?.conditions ?? []).find(c => c.id === id);
      if (!def) return 0;
      return evalAll(def.if, G) ? (def.int ?? 1) : 0;
    }

    case 'storyFlag': {
      const val = G?.player?.storyFlags?.[parts.slice(1).join(':')];
      return val ? 1 : 0;
    }

    case 'player':
      return _resolvePath(parts.slice(1), G?.player);

    case 'ability':
      return _resolvePath(parts.slice(1), G?.abilities);

    case 'session':
      return _resolvePath(parts.slice(1), G);

    default:
      return 0;
  }
}

// Resolve deep path segments into obj, returning a number.
function _resolvePath(segs, obj) {
  let val = obj;
  for (const s of segs) { if (val == null) return 0; val = val[s]; }
  return Number(val) || 0;
}

// equip:id → 1/0; equip:id:prop → numeric property of equipped item
function _resolveEquip(parts, G) {
  const [id, ...rest] = parts;
  const allEquipped = Object.values(G?.player?.equip ?? {});
  const item = allEquipped.find(e => e?.id === id);
  if (!rest.length) return item ? 1 : 0;
  if (!item) return 0;
  return _resolvePath(rest, item);
}

// item:id → 1/0; item:id:prop → numeric property of inventory item
function _resolveItem(parts, G) {
  const [id, ...rest] = parts;
  const inv  = G?.player?.inventory ?? [];
  const item = inv.find(i => i.id === id);
  if (!rest.length) return item ? 1 : 0;
  if (!item) return 0;
  return _resolvePath(rest, item);
}

// ── Single condition (internal) ───────────────────────────────────────────────
function _evalCond(cond, G) {
  // Negation: "!condition:used_magic", "!storyFlag:key"
  if (typeof cond === 'string') {
    if (cond.startsWith('!')) return resolveRef(cond.slice(1), G) === 0;
    return resolveRef(cond, G) !== 0;
  }
  if (!Array.isArray(cond) || cond.length === 0) return true;
  if (cond.length === 1) return resolveRef(cond[0], G) !== 0;
  const [lhsRef, op, rhsRaw] = cond;
  const lhs = resolveRef(lhsRef, G);
  const rhs = (typeof rhsRaw === 'number') ? rhsRaw : resolveRef(rhsRaw, G);
  switch (op) {
    case '>':            return lhs >  rhs;
    case '>=':           return lhs >= rhs;
    case '<':            return lhs <  rhs;
    case '<=':           return lhs <= rhs;
    case '=': case '==': return lhs === rhs;
    case '!=':           return lhs !== rhs;
    default:             return false;
  }
}

// ── AND group ─────────────────────────────────────────────────────────────────
//
// Every condition in the array must pass (logical AND). Empty array → true.
export function evalAll(conditions, G) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every(c => _evalCond(c, G));
}

// ── Imags spec resolver ───────────────────────────────────────────────────────
//
// Resolves the raw `imags` block (from player.json) against game state G.
// Returns { resolved, layers } where:
//   resolved — effective imags object with basePath-prefixed URLs
//   layers   — ordered array of additional image URLs to overlay
export function resolveImagsSpec(spec, G, basePath = '/assets/') {
  if (!spec) return { resolved: null, layers: [] };

  const prefix = v => Array.isArray(v) ? v.map(f => basePath + f) : basePath + v;

  // First matching replacement wins
  let base = spec;
  for (const repl of (spec.replacement ?? [])) {
    if (evalAll(repl.if, G)) { base = { ...spec, ...repl.imags }; break; }
  }

  const resolved = {};
  for (const [k, v] of Object.entries(base)) {
    if (k === 'replacement' || k === 'layers' || k === 'effects') continue;
    resolved[k] = prefix(v);
  }

  const effectSrc = base.effects ?? {};
  if (Object.keys(effectSrc).length) {
    resolved.effects = {};
    for (const [k, v] of Object.entries(effectSrc)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // Nested hit/crit object — prefix each sub-value individually
        const nested = {};
        for (const [sk, sv] of Object.entries(v)) nested[sk] = prefix(sv);
        resolved.effects[k] = nested;
      } else {
        resolved.effects[k] = prefix(v);
      }
    }
  }

  const layers = (spec.layers ?? [])
    .filter(l => evalAll(l.if, G))
    .map(l => basePath + l.add);

  return { resolved, layers };
}

// ── Text variant resolver ─────────────────────────────────────────────────────
//
// Picks the first matching text variant from a narrative spec.
// Returns { text, is_ai } — if is_ai is true, caller should send text to /api/narrate.
//
// spec may be:
//   string                — returned as-is, is_ai: false
//   { default, variants, is_ai? } — variants filtered by conditions,
//                                   sorted by priority, extensions appended
//
// vars: template variables substituted in text, e.g. { mob_name, player_level }
//   {mob_name} in text → replaced with vars.mob_name
function _applyVars(text, vars) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

export function resolveTextVariant(spec, G, vars = {}) {
  if (!spec) return { text: '', is_ai: false };
  if (typeof spec === 'string') return { text: _applyVars(spec, vars), is_ai: false };

  // ── Partition matching variants ──────────────────────────────────────────
  const normalMatches    = [];
  const extensionMatches = [];
  for (const v of (spec.variants ?? [])) {
    if (!v.text) continue;
    if (!evalAll(v.if, G)) continue;
    (v.extension ? extensionMatches : normalMatches).push(v);
  }

  // Highest-priority normal variant wins; ties resolved by declaration order.
  const baseVariant = normalMatches.length
    ? normalMatches.reduce((best, v) => (v.priority ?? 0) > (best.priority ?? 0) ? v : best)
    : null;

  // All matching extensions, highest priority first.
  extensionMatches.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // ── Build result ─────────────────────────────────────────────────────────
  let baseText, baseIsAi;
  if (baseVariant) {
    baseText = _applyVars(baseVariant.text, vars);
    baseIsAi = baseVariant.is_ai ?? spec.is_ai ?? false;
  } else {
    baseText = _applyVars(spec.default ?? '', vars);
    baseIsAi = spec.is_ai ?? false;
  }

  const parts   = [baseText];
  let extIsAi   = false;
  for (const ext of extensionMatches) {
    parts.push(_applyVars(ext.text, vars));
    if (ext.is_ai) extIsAi = true;
  }

  return {
    text:  parts.filter(Boolean).join(' '),
    is_ai: baseIsAi || extIsAi,
  };
}

// ── Public: evalCond(idOrExpr) ────────────────────────────────────────────────
// Удобная обёртка для проверки условий по текущему state.G.
// Принимает:
//   "berserk"                            — condition ID из G.conditions
//   '[["session:player:kills", ">", 5]]' — инлайн JSON-массив условий
//   "session:player:kills"               — прямой ref-путь
//   Array                                — уже готовый массив условий
export function evalCond(idOrExpr) {
  const G = state.G;
  if (!G) return false;

  if (Array.isArray(idOrExpr)) return evalAll(idOrExpr, G);

  const s = String(idOrExpr ?? '').trimStart();

  // Инлайн JSON: '[...]'
  if (s.startsWith('[')) {
    try { return evalAll(JSON.parse(s), G); } catch { return false; }
  }

  // Именованное условие из conditions.json
  const def = (G.conditions ?? []).find(c => c.id === s);
  if (def) return evalAll(def.if ?? [], G);

  // Прямой ref или одиночное условие
  return _evalCond(s, G);
}

// ── Public: applyConditions(root?) ────────────────────────────────────────────
// Обходит root, находит if / if-else / else цепочки и управляет .hidden.
//
// Правила:
//   if        — начало цепочки
//   if-else   — продолжение (прямой сосед после if / if-else)
//   else      — завершение (прямой сосед)
//   Любой другой элемент между ними — разрывает цепочку
//
// Вызывать после рендера, добавляющего условные элементы:
//   applyConditions(document.getElementById('panel'));
//   applyConditions(); // весь document.body
export function applyConditions(root = document.body) {
  const seen  = new Set();
  const ifEls = Array.from(root.querySelectorAll('[if]'));

  for (const el of ifEls) {
    if (seen.has(el)) continue;
    seen.add(el);

    let matched = evalCond(el.getAttribute('if'));
    el.classList.toggle('hidden', !matched);

    let sib = el.nextElementSibling;
    while (sib) {
      if (sib.hasAttribute('if-else')) {
        seen.add(sib);
        if (matched) {
          sib.classList.add('hidden');
        } else {
          const m = evalCond(sib.getAttribute('if-else'));
          sib.classList.toggle('hidden', !m);
          if (m) matched = true;
        }
        sib = sib.nextElementSibling;
      } else if (sib.hasAttribute('else')) {
        seen.add(sib);
        sib.classList.toggle('hidden', matched);
        break;
      } else {
        break;
      }
    }
  }
}

// Глобальный доступ для DevTools и не-модульного кода
window.evalCond        = evalCond;
window.applyConditions = applyConditions;
