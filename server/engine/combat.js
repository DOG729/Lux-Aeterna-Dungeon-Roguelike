'use strict';
const { CORE, PLAYER_BASE, PROGRESSION } = require('./data');
const { clamp } = require('./helpers');
const { effectiveAbility } = require('./player');
const { t } = require('./translation');
const { checkPhases } = require('./boss');

// Energy costs: player.json → core.json fallback
const E_COST = {};
for (const [action, coreCfg] of Object.entries(CORE.mechanics.ability)) {
  E_COST[action] = PLAYER_BASE.function[action]?.energy_cost ?? coreCfg.energy_cost ?? 0;
}

function playerCanDo(p, action) {
  const coreDef = CORE.mechanics.ability[action];
  if (!coreDef) return false;
  const cd = (p.abilityCooldowns ?? {})[action] ?? 0;
  if (cd > 0) return false;
  return p.energy >= (E_COST[action] ?? 0);
}

function mobCanDo(mob, action) {
  const ab = mob.abilities?.[action];
  if (!ab?.enabled) return false;
  const cd = (mob.abilityCooldowns ?? {})[action] ?? 0;
  if (cd > 0) return false;
  return mob.energy >= (ab.energy_cost ?? 0);
}

function checkSurrenderReady(mob) {
  const diff = mob.surrender_difficulty ?? 1;
  if (typeof diff === 'object') {
    const hpOk = diff.hp     != null ? mob.hp     / mob.maxHp     < (1 - diff.hp)     : true;
    const enOk = diff.energy != null ? mob.energy / mob.maxEnergy < (1 - diff.energy) : true;
    return hpOk && enOk;
  }
  return mob.hp / mob.maxHp < (1 - diff);
}

function mobAvailable(mob, playerMsg = '', forceSurrenderReady = false) {
  const actions = Object.keys(mob.abilities ?? {}).filter(a => mobCanDo(mob, a));
  if (playerMsg && (forceSurrenderReady || checkSurrenderReady(mob))) {
    actions.push('surrender');
  }
  return actions;
}

// Returns block amount that defAbilityKey provides against attackKey, scaled by defInt
function blockFor(defAbilityKey, defInt, attackKey) {
  const applies = CORE.mechanics.ability[defAbilityKey]?.applies_to ?? [];
  const entry   = applies.find(a => a.connect === attackKey);
  return entry ? Math.round(defInt * entry.impact) : 0;
}

// Returns total stat-based armor against attackKey (iterates all stats with applies_to_ability)
function statsArmorFor(stats, attackKey) {
  const statsDef = CORE.mechanics.stats;
  let total = 0;
  for (const [sId, sDef] of Object.entries(statsDef)) {
    if (!sDef.applies_to_ability) continue;
    const entry = sDef.applies_to_ability.find(a => a.connect === attackKey);
    if (!entry) continue;
    total += Math.floor((stats?.[sId] ?? 0) * (sDef.impact ?? 0) * entry.impact);
  }
  return total;
}

function resolveTurn(sess, playerAction, mobAction, canSurrender = false) {
  const { player, combat } = sess;
  const mob = combat.mob;
  const log = [];


  const C = (key, fb) => t('server', 'combat', key, fb);

  // Action types drive all resolution — not hardcoded ability keys
  const playerType = CORE.mechanics.ability[playerAction]?.action ?? null;
  const mobType    = CORE.mechanics.ability[mobAction]?.action    ?? null;

  // ── Surrender ─────────────────────────────────────────────────────────────
  if (mobAction === 'surrender') {
    if (playerType === 'add_energy') {
      player.energy = clamp(player.energy + effectiveAbility(player, playerAction).int, 0, player.maxEnergy);
    } else {
      player.energy = clamp(player.energy - (E_COST[playerAction] ?? 0), 0, player.maxEnergy);
    }
    log.push({ text: C('mob_surrender', '{name} поднимает руки — сдаётся!').replace('{name}', mob.name), type: 'info' });
    combat.turn++;
    combat.pendingMercy = true;
    return { log, result: 'mercy_choice' };
  }

  // ── Energy ────────────────────────────────────────────────────────────────
  if (playerType === 'add_energy') {
    player.energy = clamp(player.energy + effectiveAbility(player, playerAction).int, 0, player.maxEnergy);
  } else {
    player.energy = clamp(player.energy - (E_COST[playerAction] ?? 0), 0, player.maxEnergy);
  }
  if (mobType === 'add_energy') {
    mob.energy = clamp(mob.energy + (mob.abilities[mobAction]?.int ?? 0), 0, mob.maxEnergy);
  } else {
    mob.energy = clamp(mob.energy - (mob.abilities[mobAction]?.energy_cost ?? 0), 0, mob.maxEnergy);
  }

  // ── HP recovery (add_hp) ──────────────────────────────────────────────────
  if (playerType === 'add_hp') {
    const healAb = effectiveAbility(player, playerAction);
    player.hp = clamp(player.hp + healAb.int, 0, player.maxHp);
    log.push({ text: C('player_heal', 'Игрок исцелился на {int} HP.').replace('{int}', healAb.int), type: 'heal' });
  }
  if (mobType === 'add_hp') {
    const mobHeal = mob.abilities[mobAction];
    mob.hp = clamp(mob.hp + mobHeal.int, 0, mob.maxHp);
    log.push({ text: C('mob_heal', '{name} исцелился на {int} HP.').replace('{name}', mob.name).replace('{int}', mobHeal.int), type: 'heal' });
  }

  // ── Add energy log ────────────────────────────────────────────────────────
  if (playerType === 'add_energy') log.push({ text: C('player_wait', 'Игрок ожидает, восстанавливает энергию.'), type: 'info' });
  if (mobType   === 'add_energy') log.push({ text: C('mob_wait', '{name} выжидает.').replace('{name}', mob.name), type: 'info' });

  // ── Attack: player → mob ──────────────────────────────────────────────────
  if (playerType === 'attack') {
    const avoidVal = (mob.stats?.avoidance ?? 0) * (CORE.mechanics.stats.avoidance?.impact ?? 0);
    if (avoidVal > 0 && Math.random() < avoidVal) {
      log.push({ text: C('mob_dodge', '{name} уклонился!').replace('{name}', mob.name), type: 'info' });
    } else {
      const atkAb  = effectiveAbility(player, playerAction);
      const isCrit = Math.random() < atkAb.chance_critical;
      const rawDmg = isCrit ? Math.round(atkAb.int * (1 + atkAb.multiplier_critical)) : atkAb.int;
      // block: only if mob chose a damage_reduction ability, scaled by its applies_to for this attack key
      const block  = mobType === 'damage_reduction'
        ? blockFor(mobAction, mob.abilities[mobAction]?.int ?? 0, playerAction)
        : 0;
      const armor  = statsArmorFor(mob.stats, playerAction);

      const dmg = Math.max(0, rawDmg - block - armor);
      mob.hp = clamp(mob.hp - dmg, 0, mob.maxHp);
      if (isCrit && dmg > 0)
        log.push({ text: C('player_crit', 'КРИТ! Игрок атакует — {name} получает {dmg} урона!').replace('{name}', mob.name).replace('{dmg}', dmg), type: 'crit-ai' });
      else if (block > 0 || armor > 0)
        log.push({ text: C('player_attack_blocked', 'Игрок атакует! {name} блокирует {block}, получает {dmg} урона.').replace('{name}', mob.name).replace('{block}', block + armor).replace('{dmg}', dmg), type: dmg > 0 ? 'damage-ai' : 'blocked' });
      else
        log.push({ text: C('player_attack', 'Игрок атакует — {name} получает {dmg} урона!').replace('{name}', mob.name).replace('{dmg}', dmg), type: 'damage-ai' });
    }
  }

  // ── Attack: mob → player ──────────────────────────────────────────────────
  if (mobType === 'attack') {
    const dodgeChance = (player.stats?.avoidance ?? 0) * (CORE.mechanics.stats.avoidance?.impact ?? 0);
    if (dodgeChance > 0 && Math.random() < dodgeChance) {
      log.push({ text: C('player_dodge', 'Игрок уклонился от удара!'), type: 'info' });
    } else {
      const mobAtk = mob.abilities[mobAction];
      const isCrit = Math.random() < (mobAtk.crit_chance ?? 0);
      const rawDmg = isCrit ? Math.round(mobAtk.int * (1 + (mobAtk.crit_multiplier ?? 0))) : mobAtk.int;
      // block: only if player chose a damage_reduction ability, scaled by its applies_to for this attack key
      const block  = playerType === 'damage_reduction'
        ? blockFor(playerAction, effectiveAbility(player, playerAction).int, mobAction)
        : 0;
      const armor  = statsArmorFor(player.stats, mobAction);

      const dmg = Math.max(0, rawDmg - block - armor);
      player.hp = clamp(player.hp - dmg, 0, player.maxHp);
      if (isCrit && dmg > 0)
        log.push({ text: C('mob_crit', 'КРИТ! {name} атакует — Игрок получает {dmg} урона!').replace('{name}', mob.name).replace('{dmg}', dmg), type: 'crit-player' });
      else if (block > 0 || armor > 0)
        log.push({ text: C('mob_attack_blocked', '{name} атакует! Игрок блокирует {block}, получает {dmg} урона.').replace('{name}', mob.name).replace('{block}', block + armor).replace('{dmg}', dmg), type: dmg > 0 ? 'damage-player' : 'blocked' });
      else
        log.push({ text: C('mob_attack', '{name} атакует — Игрок получает {dmg} урона!').replace('{name}', mob.name).replace('{dmg}', dmg), type: 'damage-player' });
    }
  }

  // ── Cooldowns ─────────────────────────────────────────────────────────────
  // Set cooldown for any ability with loop, then tick down all others
  const pLoop = CORE.mechanics.ability[playerAction]?.loop;
  if (pLoop) {
    player.abilityCooldowns = player.abilityCooldowns ?? {};
    player.abilityCooldowns[playerAction] = pLoop;
  }
  const mLoop = CORE.mechanics.ability[mobAction]?.loop;
  if (mLoop) {
    mob.abilityCooldowns = mob.abilityCooldowns ?? {};
    mob.abilityCooldowns[mobAction] = mLoop;
  }
  for (const ab of Object.keys(player.abilityCooldowns ?? {})) {
    if (ab === playerAction) continue;
    player.abilityCooldowns[ab]--;
    if (player.abilityCooldowns[ab] <= 0) delete player.abilityCooldowns[ab];
  }
  for (const ab of Object.keys(mob.abilityCooldowns ?? {})) {
    if (ab === mobAction) continue;
    mob.abilityCooldowns[ab]--;
    if (mob.abilityCooldowns[ab] <= 0) delete mob.abilityCooldowns[ab];
  }

  // ── Boss phase transitions ─────────────────────────────────────────────────
  // Checked after all damage/healing so HP-based conditions reflect this turn.
  // Phases are one-way: once triggered they can never be reverted or re-triggered.
  for (const ph of checkPhases(combat, player)) {
    const txt = ph.phase_text
      ? ph.phase_text.replace(/\{mob_name\}/g, mob.name)
      : C('phase_entered', '{name}: {phase}!').replace('{name}', mob.name).replace('{phase}', ph.phase_name);
    log.push({ text: txt, type: 'phase', phase: ph.phase, phase_name: ph.phase_name });
  }

  combat.turn++;
  combat.elixirUsedThisTurn = false;

  let result = null;
  if (player.hp <= 0) {
    result = 'defeat';
  } else if (mob.hp <= 0) {
    if (canSurrender) {
      mob.hp = 1;
      log.push({ text: C('mob_defeated_surrender', '{name} едва жив и поднимает руки — сдаётся!').replace('{name}', mob.name), type: 'info' });
      combat.pendingMercy = true;
      result = 'mercy_choice';
    } else {
      result = 'victory';
    }
  }

  return { log, result };
}

function checkLevelUp(player) {
  const prevLevel = player.charLevel ?? 1;
  let newLevel = 1;
  for (const tier of PROGRESSION) {
    if (player.xp >= tier.xpRequired) newLevel = tier.level;
  }
  if (newLevel <= prevLevel) return { leveled: false };

  const spGained = PROGRESSION
    .filter(t => t.level > prevLevel && t.level <= newLevel)
    .reduce((sum, t) => sum + t.skillPoints, 0);

  const grants = {};
  PROGRESSION
    .filter(t => t.level > prevLevel && t.level <= newLevel)
    .forEach(tier => {
      for (const [k, v] of Object.entries(tier.grants ?? {}))
        grants[k] = (grants[k] ?? 0) + v;
    });

  player.charLevel   = newLevel;
  player.skillPoints = (player.skillPoints ?? 0) + spGained;
  return { leveled: true, newLevel, spGained, grants };
}

module.exports = {
  E_COST,
  playerCanDo, mobCanDo,
  checkSurrenderReady, mobAvailable,
  resolveTurn, checkLevelUp
};
