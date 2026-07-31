'use strict';
const { MOBS, CORE } = require('./data');
const { uid, levelMatches, resolveMobLevel } = require('./helpers');
const { t, resolvePromt } = require('./translation');
const { loadLangFile } = require('./ai');
const { evalAll } = require('./conditions');

// Deep-merge patch into target (no mutation of nested originals — creates new objects)
function _deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)
        && target[k] !== null && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      target[k] = _deepMerge({ ...target[k] }, v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

// Apply type:edit script entries to base mob definition.
// Returns original base if nothing matched (no clone overhead).
// Tracks which top-level fields were touched (__scriptTouchedFields, transient — never
// copied into the final spawned object) so buildMobFromBase knows to skip translation
// lookup for those fields instead of letting t() silently override the patch.
function applyMobScript(base, ctx) {
  if (!base.script?.length || !ctx) return base;
  let patched = null;
  const touched = new Set();
  for (const entry of base.script) {
    if (entry.type !== 'edit') continue;
    if (!evalAll(entry.if ?? [], ctx)) continue;
    if (!patched) patched = JSON.parse(JSON.stringify(base));
    for (const patch of (entry.edit ?? [])) {
      _deepMerge(patched, patch);
      for (const k of Object.keys(patch)) touched.add(k);
    }
  }
  if (patched) patched.__scriptTouchedFields = [...touched];
  return patched ?? base;
}

function getAbilityMult(multiplier, key, level) {
  if (!multiplier || level <= 1) return 1;
  const m = typeof multiplier === 'number' ? multiplier : (multiplier[key] ?? 1);
  return Math.pow(m, level - 1);
}

function pickWeighted(pool) {
  const total = pool.reduce((s, m) => s + (m.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const m of pool) { r -= (m.weight ?? 1); if (r <= 0) return m; }
  return pool[pool.length - 1];
}

// Resolves a single action entry: coreDef from core.json, mobDef from mob/boss manifest (overrides)
// mob/boss manifest: action = true/false (enabled), default false
function resolveAction(mobDef, coreDef, mult = 1) {
  return {
    int:             Math.round((mobDef?.int ?? coreDef.int ?? 0) * mult),
    enabled:         mobDef?.action ?? false,
    action:          coreDef.action ?? null,   // engine type ('attack', 'damage_reduction', …) — used by client for animation routing
    loop:            mobDef?.loop            ?? coreDef.loop            ?? 3,
    crit_chance:     mobDef?.chance_critical ?? coreDef.chance_critical ?? 0,
    crit_multiplier: mobDef?.multiplier_critical ?? coreDef.multiplier_critical ?? 0,
    energy_cost:     mobDef?.energy_cost     ?? coreDef.energy_cost     ?? 0,
    sound:           coreDef.sound           ?? null,  // core ability sound for sfx fallback
    sound_volume:    coreDef.sound_volume    ?? null,  // per-ability volume multiplier
  };
}

function resolveMobStats(base, level = 1) {
  const statsDef = CORE.mechanics.stats;
  const stats    = {};
  for (const [id, def] of Object.entries(statsDef)) {
    const raw     = base.stats?.[id];
    // Accept both flat number (5) and object form ({int:5}) — manifest should use flat number
    const baseVal = raw == null ? (def.int ?? 0) : (typeof raw === 'object' ? (raw.int ?? 0) : raw);
    const mult    = getAbilityMult(base.multiplier?.stats, id, level);
    stats[id]     = baseVal * mult;
  }
  return stats;
}

function applyStatModes(stats, abilities) {
  const statsDef = CORE.mechanics.stats;
  for (const [id, def] of Object.entries(statsDef)) {
    const val = stats[id];
    if (!val || !def.mode) continue;
    for (const { type, connect, impact } of def.mode) {
      if (type !== 'ability') continue;
      const [abilId, field] = connect.split(':');
      if (abilities[abilId]) {
        abilities[abilId][field] = Math.round((abilities[abilId][field] ?? 0) + val * impact);
      }
    }
  }
}

function resolveMobAbilities(base, level = 1) {
  const abilities = {};
  for (const [id, coreDef] of Object.entries(CORE.mechanics.ability)) {
    const mobDef = base.function?.[id];
    const mult   = getAbilityMult(base.multiplier, id, level);
    abilities[id] = resolveAction(mobDef, coreDef, mult);
  }
  return abilities;
}

// skipTranslation: true when the caller already knows this field was explicitly patched
// (script edit or NPC combat overlay) — skips t() entirely so the patch can't be shadowed.
function translateEncounterText(enc, mobId, skipTranslation = false) {
  if (!enc) return null;
  if (skipTranslation) {
    return {
      default:  enc.default ?? null,
      is_ai:    enc.is_ai ?? false,
      variants: (enc.variants ?? [])
        .map(v => ({ if: v.if, text: v.text ?? null, is_ai: v.is_ai ?? false, priority: v.priority ?? 0, extension: v.extension ?? false }))
        .filter(v => v.text)
    };
  }
  const MISS = '\x00';
  const trKey = key => key ? t('mob', mobId, key, MISS) : MISS;
  const trDefault = trKey('encounter_default');
  return {
    default:  trDefault !== MISS ? trDefault : enc.default, // key or direct text — same logic
    is_ai:    enc.is_ai ?? false,
    variants: (enc.variants ?? []).map(v => {
      let text = trKey(v.key);
      if (text === MISS) text = v.text ?? null;
      if (!text) return null;  // skip: no key found, no text fallback
      return { if: v.if, text, is_ai: v.is_ai ?? false, priority: v.priority ?? 0, extension: v.extension ?? false };
    }).filter(Boolean)
  };
}

// Builds the final spawn-ready mob object from an already-resolved base (post-script,
// post-overlay — see spawnMob / spawnNpcCombat). Text fields (name/promt/encounter_text)
// skip translation lookup when `touchedFields` marks them as explicitly patched, so a
// script/overlay override can never be silently shadowed by the template's own translation.
function buildMobFromBase(base, level = 1) {
  const touched = new Set(base.__scriptTouchedFields ?? []);

  const hpMult     = getAbilityMult(base.multiplier, 'hp',     level);
  const energyMult = getAbilityMult(base.multiplier, 'energy', level);
  const xpMult     = getAbilityMult(base.multiplier, 'xp',     level);

  const stats     = resolveMobStats(base, level);
  const abilities = resolveMobAbilities(base, level);
  applyStatModes(stats, abilities);

  const name = touched.has('name') ? base.name : t('mob', base.id, 'name', base.name);
  const promt = base.promt_path
    ? (loadLangFile(base.promt_path) ?? resolvePromt('mob', base.id, base.promt))
    : (touched.has('promt') ? base.promt : resolvePromt('mob', base.id, base.promt));

  return {
    instanceId:   uid(),
    defId:        base.id,
    name,
    image:        base.image,
    promt,
    level,
    hp:           Math.round(base.hp     * hpMult),
    maxHp:        Math.round(base.hp     * hpMult),
    energy:       Math.round(base.energy * energyMult),
    maxEnergy:    Math.round(base.energy * energyMult),
    abilityCooldowns: {},
    surrender_difficulty: base.surrender_difficulty ?? 1,
    script:       base.script ?? null,
    stats,
    abilities,
    xp:           Math.round(base.xp * xpMult),
    items:        base.items   ?? [],
    memory:       [],
    imags:          base.imags          ?? null,
    effects:        base.effects        ?? null,
    style:          base.style          ?? null,
    encounter_text: translateEncounterText(base.encounter_text, base.id, touched.has('encounter_text'))
  };
}

function spawnMob(level, allowedIds = null, ctx = null) {
  const effLevel = resolveMobLevel(level);
  const valid = allowedIds && allowedIds.length
    ? MOBS.filter(m => allowedIds.includes(m.id) && levelMatches(m.level, effLevel))
    : MOBS.filter(m => levelMatches(m.level, effLevel) && m.random_spawn !== false);
  if (!valid.length) return null;

  const base = applyMobScript(pickWeighted(valid), ctx);
  return buildMobFromBase(base, level);
}

module.exports = {
  getAbilityMult, pickWeighted, resolveAction, resolveMobAbilities, resolveMobStats, applyStatModes,
  applyMobScript, spawnMob, buildMobFromBase, translateEncounterText,
  deepMerge: _deepMerge
};
