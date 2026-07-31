'use strict';
const { PLAYER_BASE, CORE, ALL_SKILLS, ACHIEVEMENTS } = require('./data');
const { clamp } = require('./helpers');

// Maps achievement bonus keys to the bonuses map connect format
const ACH_CONNECT = {
  hp:             'player:max_hp',
  energy:         'player:max_energy',
  armor:          'stats:armor:int',
  magical_armor:  'stats:magical_armor:int',
  attack:         'ability:attack:int',
  defend:         'ability:defend:int',
  chance_critical:'ability:attack:chance_critical',
};

function recalcStats(player) {
  const b   = {};
  const add = (k, v) => { b[k] = (b[k] ?? 0) + +v; };

  for (const item of Object.values(player.equip ?? {})) {
    if (!item?.stats) continue;
    for (const [k, v] of Object.entries(item.stats)) add(k, v);
  }
  for (const skillId of (player.learnedSkills ?? [])) {
    const sk = ALL_SKILLS.find(s => s.id === skillId);
    if (!sk?.function?.mode) continue;
    for (const { connect, value } of sk.function.mode) add(connect, value);
  }
  for (const [k, v] of Object.entries(player.levelBonuses ?? {})) add(k, v);

  // Achievement stat bonuses (applied every recalc so they survive save/load)
  const { account } = require('./account');
  for (const id of (account.achievements ?? [])) {
    const def = ACHIEVEMENTS.find(a => a.id === id);
    if (!def || def.type !== 'stats') continue;
    for (const [k, v] of Object.entries(def.bonus ?? {})) add(ACH_CONNECT[k] ?? k, v);
  }

  const statsDef = CORE.mechanics.stats;
  const stats = {};
  for (const [id, def] of Object.entries(statsDef)) {
    stats[id] = (PLAYER_BASE.stats?.[id] ?? def.int ?? 0) + (b[`stats:${id}:int`] ?? 0);
  }

  for (const [id, def] of Object.entries(statsDef)) {
    const val = stats[id];
    if (!val || !def.mode) continue;
    for (const { type, connect, impact } of def.mode) {
      const bonus = val * impact;
      if (type === 'stats') {
        const [statId] = connect.split(':');
        stats[statId] = (stats[statId] ?? 0) + bonus;
      } else if (type === 'ability') {
        add(`ability:${connect}`, bonus);
      } else if (type === 'effects') {
        add(`effects:${connect}`, bonus);
      }
    }
  }

  player.bonuses        = b;
  player.stats          = stats;
  player.maxHp          = PLAYER_BASE.hp     + (b['player:max_hp']     ?? 0);
  player.maxEnergy      = PLAYER_BASE.energy + (b['player:max_energy'] ?? 0);
  player.critChance     = clamp((PLAYER_BASE.function.attack.chance_critical     ?? 0.05) + (b['ability:attack:chance_critical']     ?? 0), 0, 1);
  player.critMultiplier = clamp((PLAYER_BASE.function.attack.multiplier_critical ?? 0.3)  + (b['ability:attack:multiplier_critical'] ?? 0), 0, 10);
  player.hp             = clamp(player.hp,     0, player.maxHp);
  player.energy         = clamp(player.energy, 0, player.maxEnergy);
}

function effectiveAbility(player, id) {
  const base = PLAYER_BASE.function?.[id] ?? {};
  const core = CORE.mechanics.ability[id] ?? {};
  const b    = player.bonuses ?? {};
  return {
    int:                 (base.int                 ?? core.int                 ?? 0) + (b[`ability:${id}:int`]                 ?? 0),
    chance_critical:     (base.chance_critical     ?? core.chance_critical     ?? 0) + (b[`ability:${id}:chance_critical`]     ?? 0),
    multiplier_critical: (base.multiplier_critical ?? core.multiplier_critical ?? 0) + (b[`ability:${id}:multiplier_critical`] ?? 0),
    energy_cost:         base.energy_cost ?? core.energy_cost ?? 0,
    loop:                base.loop ?? core.loop ?? 1,
  };
}

function checkRequired(required, player) {
  for (const req of required) {
    const [entity, id, val] = req.split(':');
    if (entity === 'skill' && !(player.learnedSkills ?? []).includes(id))                     return false;
    if (entity === 'level' && (player.level ?? 1) < +id)                                     return false;
    if (entity === 'item'  && !Object.values(player.equip ?? {}).some(it => it?.id === id))  return false;
    if (entity === 'stats' && ((player.bonuses?.[`stats:${id}:int`] ?? 0) < +val))            return false;
  }
  return true;
}

/** max * refresh_pct + current * leftover_mult, clamped; skip if both coeffs are 0 */
function refreshResource(current, max, cfg) {
  const refreshPct  = cfg?.refresh_pct   ?? 0;
  const leftoverMult = cfg?.leftover_mult ?? 0;
  if (refreshPct === 0 && leftoverMult === 0) return current;
  const maxN = Math.max(0, max);
  const cur  = clamp(current, 0, maxN);
  return clamp(Math.floor(maxN * refreshPct + cur * leftoverMult), 0, maxN);
}

function manaMax(player) {
  const def = CORE.mechanics.stats?.mana;
  if (!def) return player.stats?.mana ?? 0;
  return (PLAYER_BASE.stats?.mana ?? def.int ?? 0) + (player.bonuses?.['stats:mana:int'] ?? 0);
}

/** Post-combat recovery from combat_system.end_combat (victory / mercy). */
function applyEndCombatRefresh(player) {
  const cfg = CORE.mechanics?.end_combat;
  if (!cfg) return;

  if (cfg.energy) {
    player.energy = refreshResource(player.energy, player.maxEnergy, cfg.energy);
  }
  if (cfg.hp) {
    player.hp = refreshResource(player.hp, player.maxHp, cfg.hp);
  }
  if (cfg.mana && player.stats) {
    const max = manaMax(player);
    const cur = player.stats.mana ?? max;
    player.stats.mana = refreshResource(cur, max, cfg.mana);
  }
}

function resolveAbilities(player) {
  const result = {};
  for (const [id, ab] of Object.entries(CORE.mechanics.ability)) {
    const isDefault   = ab.default_action === true;
    const playerHasIt = PLAYER_BASE.function?.[id]?.action === true;
    const hasRequired = (ab.required ?? []).length > 0;

    if (!isDefault && !playerHasIt && !hasRequired) continue;
    if (hasRequired && !checkRequired(ab.required, player)) continue;

    const eff = effectiveAbility(player, id);
    result[id] = { ...ab, ...eff, id };
  }
  return result;
}

module.exports = {
  recalcStats, effectiveAbility, checkRequired, resolveAbilities,
  refreshResource, applyEndCombatRefresh
};
