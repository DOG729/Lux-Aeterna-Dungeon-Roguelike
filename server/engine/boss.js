'use strict';
const { BOSSES } = require('./data');
const { uid } = require('./helpers');
const { t, resolvePromt } = require('./translation');
const { loadLangFile } = require('./ai');
const { getAbilityMult, resolveMobStats, resolveMobAbilities, applyStatModes } = require('./mob');

// ── Server-side condition evaluator for phase `if` expressions ────────────────

function _deepGet(obj, parts) {
  let val = obj;
  for (const p of parts) { if (val == null) return 0; val = val[p]; }
  return Number(val) || 0;
}

function _resolveRef(ref, ctx) {
  if (Array.isArray(ref)) {
    const [base, op, scalar] = ref;
    const bv = _resolveRef(base, ctx);
    const sv = typeof scalar === 'number' ? scalar : _resolveRef(scalar, ctx);
    switch (op) {
      case '*': return bv * sv;
      case '/': return sv !== 0 ? bv / sv : 0;
      case '+': return bv + sv;
      case '-': return bv - sv;
      default:  return bv;
    }
  }
  const [ns, ...parts] = ref.split(':');
  switch (ns) {
    case 'mob':    return _deepGet(ctx.mob,    parts);
    case 'player': return _deepGet(ctx.player, parts);
    default:       return 0;
  }
}

const _CMP = new Set(['>', '>=', '<', '<=', '=', '==', '!=']);

function _evalCond(cond, ctx) {
  if (typeof cond === 'string')                               return _resolveRef(cond, ctx) !== 0;
  if (!Array.isArray(cond) || cond.length === 0)             return true;
  if (cond.length === 1)                                      return _resolveRef(cond[0], ctx) !== 0;
  const [lhsR, op, rhsR] = cond;
  if (typeof op === 'string' && _CMP.has(op)) {
    const l = _resolveRef(lhsR, ctx);
    const r = typeof rhsR === 'number' ? rhsR : _resolveRef(rhsR, ctx);
    switch (op) {
      case '>':            return l >  r;
      case '>=':           return l >= r;
      case '<':            return l <  r;
      case '<=':           return l <= r;
      case '=': case '==': return l === r;
      case '!=':           return l !== r;
      default:             return false;
    }
  }
  // Treat as AND-array of sub-conditions
  return cond.every(c => _evalCond(c, ctx));
}

/**
 * Evaluate a phase `if` expression. Supports two forms:
 *   Direct comparison:   ["mob:hp", "<", ["mob:maxHp", "*", 0.5]]
 *   AND array:           [["mob:hp", "<", 50], ["player:hp", "<", 30]]
 */
function evalPhaseIf(ifExpr, ctx) {
  if (!ifExpr || !Array.isArray(ifExpr) || ifExpr.length === 0) return false;
  // Second element is a comparison operator → direct comparison expression
  if (typeof ifExpr[1] === 'string' && _CMP.has(ifExpr[1])) return _evalCond(ifExpr, ctx);
  // Otherwise: array of conditions (AND semantics)
  return ifExpr.every(c => _evalCond(c, ctx));
}

// ── Phase resolution ──────────────────────────────────────────────────────────

/**
 * Pre-resolve all phases for a boss at spawn time (with multiplier scaling).
 * Translates phase_name and phase_text from the active language.
 * Fields:
 *   phase, phase_name, phase_text, if
 *   style   — merged into boss.style  (no scaling)
 *   imags   — merged into boss.imags  (no scaling)
 *   energy  — replaces boss.maxEnergy (no scaling)
 *   stats   — each stat value scaled by multiplier?.stats[id]
 *   function — per-ability partial overrides, int scaled by multiplier[abilId]
 */
function resolvePhases(base, level) {
  if (!base.phase?.length) return [];
  const MISS = '\x00';

  return base.phase.map(ph => {
    const nameKey   = `phase_${ph.phase}_name`;
    const textKey   = `phase_${ph.phase}_text`;
    const phaseName = t('boss', base.id, nameKey, ph.phase_name ?? `Phase ${ph.phase}`);
    const textRaw   = t('boss', base.id, textKey, MISS);

    const resolved = {
      phase:      ph.phase,
      phase_name: phaseName,
      phase_text: textRaw !== MISS ? textRaw : null,
      if:         ph.if
    };

    if (ph.style  != null) resolved.style  = ph.style;
    if (ph.imags  != null) resolved.imags  = ph.imags;
    if (ph.energy != null) resolved.energy = ph.energy;

    if (ph.stats) {
      resolved.stats = {};
      for (const [id, val] of Object.entries(ph.stats)) {
        const mult = getAbilityMult(base.multiplier?.stats, id, level);
        resolved.stats[id] = typeof val === 'number' ? val * mult : val;
      }
    }

    if (ph.function) {
      resolved.function = {};
      for (const [abilId, mobDef] of Object.entries(ph.function)) {
        const mult     = getAbilityMult(base.multiplier, abilId, level);
        const override = {};
        // Only copy fields that are explicitly set — merge-patch semantics
        if (mobDef.int                != null) override.int             = Math.round(mobDef.int * mult);
        if (mobDef.chance_critical     != null) override.crit_chance     = mobDef.chance_critical;
        if (mobDef.multiplier_critical != null) override.crit_multiplier = mobDef.multiplier_critical;
        if (mobDef.energy_cost         != null) override.energy_cost     = mobDef.energy_cost;
        if (mobDef.action              != null) override.enabled         = mobDef.action;
        if (mobDef.loop                != null) override.loop            = mobDef.loop;
        resolved.function[abilId] = override;
      }
    }

    return resolved;
  });
}

// ── Apply phase ───────────────────────────────────────────────────────────────

/**
 * Apply a resolved phase onto a live boss object (merge-patch semantics).
 * style / imags are deep-merged. stats / abilities are field-patched.
 * Energy is clamped to new maxEnergy.
 * Re-runs applyStatModes when stats change to keep ability bonuses in sync.
 */
function applyPhase(boss, phase) {
  if (phase.style  != null) boss.style  = { ...(boss.style  ?? {}), ...phase.style  };
  if (phase.imags  != null) boss.imags  = { ...(boss.imags  ?? {}), ...phase.imags  };
  if (phase.energy != null) {
    boss.maxEnergy = phase.energy;
    boss.energy    = Math.min(boss.energy, boss.maxEnergy);
  }
  if (phase.stats) {
    boss.stats = { ...(boss.stats ?? {}), ...phase.stats };
    applyStatModes(boss.stats, boss.abilities);   // keep stat → ability bonuses in sync
  }
  if (phase.function) {
    for (const [id, override] of Object.entries(phase.function)) {
      if (!boss.abilities[id]) boss.abilities[id] = {};
      Object.assign(boss.abilities[id], override);
    }
  }
}

// ── Check phases ──────────────────────────────────────────────────────────────

/**
 * Evaluate all unresolved boss phases against the current combat state.
 * Triggered phases are applied immediately and permanently (one-way, irreversible).
 * Returns array of newly triggered phase objects (may be empty).
 */
function checkPhases(combat, player) {
  const boss = combat.mob;
  if (!boss?.isBoss || !boss.phases?.length || boss.hp <= 0) return [];
  if (!boss.triggeredPhases) boss.triggeredPhases = [];
  const ctx       = { mob: boss, player };
  const triggered = [];
  for (const phase of boss.phases) {
    if (boss.triggeredPhases.includes(phase.phase)) continue;
    if (evalPhaseIf(phase.if, ctx)) {
      boss.triggeredPhases.push(phase.phase);
      applyPhase(boss, phase);
      triggered.push(phase);
    }
  }
  return triggered;
}

// ── Encounter text translation ────────────────────────────────────────────────

function translateBossEncounterText(enc, bossId, skipTranslation = false) {
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
  const MISS   = '\x00';
  const trKey  = key => key ? t('boss', bossId, key, MISS) : MISS;
  const trDef  = trKey('encounter_default');
  return {
    default:  trDef !== MISS ? trDef : enc.default,
    is_ai:    enc.is_ai ?? false,
    variants: (enc.variants ?? []).map(v => {
      let text = trKey(v.key);
      if (text === MISS) text = v.text ?? null;
      if (!text) return null;
      return { if: v.if, text, is_ai: v.is_ai ?? false, priority: v.priority ?? 0, extension: v.extension ?? false };
    }).filter(Boolean)
  };
}

// ── Build / spawn boss ─────────────────────────────────────────────────────────
// buildBossFromBase takes an already-resolved base (post NPC-overlay merge, if any —
// see server/engine/npc.js spawnNpcCombat) so the same resolution logic (stats,
// abilities, phases) is shared between plain boss spawns and NPC-driven boss combat.

function buildBossFromBase(base, level = 1) {
  const touched = new Set(base.__scriptTouchedFields ?? []);

  const hpMult    = getAbilityMult(base.multiplier, 'hp', level);
  const xpMult    = getAbilityMult(base.multiplier, 'xp', level);
  const stats     = resolveMobStats(base, level);
  const abilities = resolveMobAbilities(base, level);
  applyStatModes(stats, abilities);

  const name  = touched.has('name') ? base.name : t('boss', base.id, 'name', base.name);
  const promt = base.promt_path
    ? (loadLangFile(base.promt_path) ?? resolvePromt('boss', base.id, base.promt))
    : (touched.has('promt') ? base.promt : resolvePromt('boss', base.id, base.promt));

  return {
    instanceId:      uid(),
    defId:           base.id,
    name,
    image:           base.image,
    promt,
    level,
    hp:              Math.round(base.hp * hpMult),
    maxHp:           Math.round(base.hp * hpMult),
    energy:          base.energy,
    maxEnergy:       base.energy,
    abilityCooldowns: {},
    surrender_difficulty: base.surrender_difficulty ?? 1,
    stats,
    abilities,
    xp:              Math.round(base.xp * xpMult),
    items:           base.items ?? [],
    memory:          [],
    imags:           base.imags  ?? null,
    pawn:            base.pawn   ?? null,
    effects:         null,
    style:           base.style  ?? null,
    encounter_text:  translateBossEncounterText(base.encounter_text, base.id, touched.has('encounter_text')),
    isBoss:          true,
    source:          'boss',
    phases:          resolvePhases(base, level),
    triggeredPhases: []
  };
}

function spawnBoss(bossId, level = 1) {
  const base = BOSSES.find(b => b.id === bossId);
  if (!base) return null;
  return buildBossFromBase(base, level);
}

module.exports = {
  spawnBoss,
  buildBossFromBase,
  translateBossEncounterText,
  resolvePhases,
  applyPhase,
  checkPhases
};
