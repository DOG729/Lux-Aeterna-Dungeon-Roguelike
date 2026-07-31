'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let D = null; // loaded data

const cfg = {
  level:   1,
  learned: new Set(),
  equip:   { weapon: null, shield: null, amulet: null, ring: null },
};

let activeBranch = 'battle';

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  const r = await fetch('/api/balance/data');
  const raw = await r.json();

  const skillsFlat = [
    ...raw.skills.battle.map(s => ({ ...s, _branch: 'battle' })),
    ...raw.skills.survival.map(s => ({ ...s, _branch: 'survival' })),
    ...raw.skills.magic.map(s => ({ ...s, _branch: 'magic' })),
  ];

  const equipSlots = Object.keys(raw.core.mechanics.equipment ?? {});
  const itemsBySlot = {};
  for (const slot of equipSlots) itemsBySlot[slot] = [];
  for (const item of raw.items) {
    if (item.equip && itemsBySlot[item.equip]) itemsBySlot[item.equip].push(item);
  }

  const maxPlayerLvl  = raw.progression.length;
  const maxDungeonLvl = Object.keys(raw.dungeon_levels ?? {})
    .filter(k => k !== 'default')
    .reduce((mx, k) => { const m = String(k).match(/(\d+)$/); return m ? Math.max(mx, +m[1]) : mx; }, 1);

  document.getElementById('lvl-range').max    = maxPlayerLvl;
  document.getElementById('dungeon-lvl').max  = maxDungeonLvl;

  D = { ...raw, skills_flat: skillsFlat, equip_slots: equipSlots, items_by_slot: itemsBySlot, max_player_lvl: maxPlayerLvl, max_dungeon_lvl: maxDungeonLvl };

  document.getElementById('sim-dungeon-lvl').max = maxDungeonLvl;

  buildEquipUI();
  buildSkillList(activeBranch);
  populateEnemySelect();
  refreshAll();
})();

// ── Skill ID helper ────────────────────────────────────────────────────────────
function refId(ref) { const p = ref.split(':'); return p.length > 1 ? p[1] : p[0]; }

function canLearn(skill) {
  const has = ref => cfg.learned.has(refId(ref));
  if (skill.requires?.length && !skill.requires.every(has)) return false;
  if (skill.requires_or?.length && !skill.requires_or.some(g => g.every(has))) return false;
  return true;
}

function prereqNames(skill) {
  if (!skill.requires?.length && !skill.requires_or?.length) return '';
  const parts = [];
  if (skill.requires?.length)
    parts.push(skill.requires.map(r => D.skills_flat.find(s => s.id === refId(r))?.name ?? refId(r)).join(' + '));
  if (skill.requires_or?.length) {
    const orParts = skill.requires_or.map(g =>
      g.map(r => D.skills_flat.find(s => s.id === refId(r))?.name ?? refId(r)).join('+')
    ).join(' или ');
    parts.push(orParts);
  }
  return parts.join('; ');
}

// ── Skill list ─────────────────────────────────────────────────────────────────
function buildSkillList(branch) {
  activeBranch = branch;
  document.querySelectorAll('.branch-tab').forEach(b => b.classList.toggle('active', b.dataset.branch === branch));
  const list = document.getElementById('skill-list');
  list.innerHTML = '';
  if (!D) return;

  for (const skill of D.skills[branch]) {
    const learned   = cfg.learned.has(skill.id);
    const available = canLearn(skill);
    const row = document.createElement('div');
    row.className = 'skill-row' +
      (skill.type === 'notables' ? ' notable' : '') +
      (learned  ? ' learned'  : '') +
      (!available && !learned ? ' unavail' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'skill-cb';
    cb.checked  = learned;
    cb.disabled = !available && !learned;
    cb.addEventListener('change', () => toggleSkill(skill, cb.checked));

    const info = document.createElement('div'); info.className = 'skill-info';
    const name = document.createElement('div'); name.className = 'skill-name'; name.textContent = skill.name;
    const desc = document.createElement('div'); desc.className = 'skill-desc'; desc.textContent = skill.description;
    info.appendChild(name); info.appendChild(desc);

    if (!available && !learned) {
      const pre = document.createElement('div'); pre.className = 'skill-prereq';
      pre.textContent = '▸ ' + prereqNames(skill);
      info.appendChild(pre);
    }

    const sp = document.createElement('div'); sp.className = 'skill-sp';
    sp.textContent = skill.uses_point + ' SP';

    row.appendChild(cb); row.appendChild(info); row.appendChild(sp);
    row.addEventListener('click', e => {
      if (e.target === cb || cb.disabled) return;
      cb.checked = !cb.checked;
      toggleSkill(skill, cb.checked);
    });
    list.appendChild(row);
  }
}

function toggleSkill(skill, learn) {
  if (learn) cfg.learned.add(skill.id);
  else cfg.learned.delete(skill.id);
  buildSkillList(activeBranch);
  refreshAll();
}

// ── Equipment UI ──────────────────────────────────────────────────────────────
function buildEquipUI() {
  const grid = document.getElementById('equip-grid');
  grid.innerHTML = '';
  const slotLabels = { weapon: 'Оружие', shield: 'Щит', amulet: 'Амулет', ring: 'Кольцо' };

  for (const slot of D.equip_slots) {
    const wrap = document.createElement('div'); wrap.className = 'equip-row';
    const lbl  = document.createElement('label'); lbl.textContent = slotLabels[slot] ?? slot;
    const sel  = document.createElement('select');
    sel.innerHTML = '<option value="">— нет —</option>';

    for (const item of (D.items_by_slot[slot] ?? [])) {
      const o = document.createElement('option');
      o.value = item.id;
      const statsStr = item.stats ? Object.entries(item.stats).map(([k, v]) => {
        const label = k.includes('max_hp') ? 'HP' : k.includes('max_energy') ? 'EN' :
                      k.includes('attack:int') ? 'ATK' : k.includes('defend:int') ? 'DEF' :
                      k.includes('magical_attack') ? 'MATK' : k.includes('magical_defend') ? 'MDEF' : k;
        return `+${v} ${label}`;
      }).join(', ') : '';
      o.textContent = item.name + (statsStr ? ` (${statsStr})` : '');
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      cfg.equip[slot] = D.items_by_slot[slot]?.find(i => i.id === sel.value) ?? null;
      refreshAll();
    });
    wrap.appendChild(lbl); wrap.appendChild(sel);
    grid.appendChild(wrap);
  }
}

// ── Compute ───────────────────────────────────────────────────────────────────
function compute() {
  const b = {};
  const add = (k, v) => { b[k] = (b[k] ?? 0) + +v; };

  for (const slot of D.equip_slots) {
    const item = cfg.equip[slot];
    if (item?.stats) for (const [k, v] of Object.entries(item.stats)) add(k, v);
  }

  for (const id of cfg.learned) {
    const sk = D.skills_flat.find(s => s.id === id);
    if (sk?.function?.mode) for (const { connect, value } of sk.function.mode) add(connect, value);
  }

  // Secondary stats (armor, physique, etc.)
  const statsDef = D.core.mechanics.stats ?? {};
  const statVals = {};
  for (const [id, def] of Object.entries(statsDef)) {
    if (def.use === false) continue;
    statVals[id] = (D.player_base.stats?.[id] ?? def.int ?? 0) + (b[`stats:${id}:int`] ?? 0);
  }
  for (const [id, def] of Object.entries(statsDef)) {
    if (def.use === false || !def.mode) continue;
    const val = statVals[id]; if (!val) continue;
    for (const { type, connect, impact } of def.mode) {
      if (type === 'stats')        add('stats:' + connect, val * impact);
      else if (type === 'ability') add('ability:' + connect, val * impact);
    }
  }

  const abil = id => {
    const pb   = D.player_base.function?.[id] ?? {};
    const core = D.core.mechanics.ability?.[id] ?? {};
    return {
      int:                 (pb.int                 ?? core.int                 ?? 0) + (b[`ability:${id}:int`]                 ?? 0),
      chance_critical:     (pb.chance_critical     ?? core.chance_critical     ?? 0) + (b[`ability:${id}:chance_critical`]     ?? 0),
      multiplier_critical: (pb.multiplier_critical ?? core.multiplier_critical ?? 0) + (b[`ability:${id}:multiplier_critical`] ?? 0),
      energy_cost:          pb.energy_cost ?? core.energy_cost ?? 0,
      loop:                 pb.loop ?? core.loop ?? 1,
    };
  };

  const attack  = abil('attack');
  const mag_atk = abil('magical_attack');
  const usedSP  = [...cfg.learned].reduce((s, id) => s + (D.skills_flat.find(sk => sk.id === id)?.uses_point ?? 0), 0);
  const availSP = D.progression.slice(0, Math.min(cfg.level, D.max_player_lvl)).reduce((s, l) => s + (l.skillPoints ?? 0), 0);
  const hasMagic = cfg.learned.has('mg_magical_manifestation');

  return {
    maxHp:     D.player_base.hp     + (b['player:max_hp']     ?? 0),
    maxEnergy: D.player_base.energy + (b['player:max_energy'] ?? 0),
    attack, defend: abil('defend'), mag_atk, mag_def: abil('magical_defend'),
    heal: abil('heal'), wait: abil('wait'),
    usedSP, availSP, hasMagic,
    avgHit:     Math.round((attack.int  * (1 - attack.chance_critical)  + attack.int  * (1 + attack.multiplier_critical)  * attack.chance_critical) * (attack.loop  ?? 1)),
    critHit:    Math.round(attack.int  * (1 + attack.multiplier_critical)  * (attack.loop  ?? 1)),
    avgMagHit:  Math.round((mag_atk.int * (1 - mag_atk.chance_critical) + mag_atk.int * (1 + mag_atk.multiplier_critical) * mag_atk.chance_critical) * (mag_atk.loop ?? 1)),
    critMagHit: Math.round(mag_atk.int * (1 + mag_atk.multiplier_critical) * (mag_atk.loop ?? 1)),
  };
}

// ── Render stats ──────────────────────────────────────────────────────────────
function refreshAll() {
  if (!D) return;
  const s = compute();

  // HP / Energy
  const BASE_HP = 200; const BASE_EN = 200;
  document.getElementById('val-hp').textContent = s.maxHp;
  document.getElementById('val-en').textContent = s.maxEnergy;
  document.getElementById('bar-hp').style.width = Math.min(100, s.maxHp / BASE_HP * 100) + '%';
  document.getElementById('bar-en').style.width = Math.min(100, s.maxEnergy / BASE_EN * 100) + '%';

  // Attack
  const pct = v => (v * 100).toFixed(1) + '%';
  document.getElementById('s-atk-int').textContent = s.attack.int;
  document.getElementById('s-atk-cc').textContent  = pct(s.attack.chance_critical);
  document.getElementById('s-atk-cm').textContent  = '+' + pct(s.attack.multiplier_critical);
  document.getElementById('s-atk-ec').textContent  = s.attack.energy_cost + ' ⚡';
  document.getElementById('s-atk-avg').textContent = `Среднее: ${s.avgHit} | Крит: ${s.critHit}`;

  // Defend
  document.getElementById('s-def-int').textContent = s.defend.int;
  document.getElementById('s-def-ec').textContent  = s.defend.energy_cost + ' ⚡';

  // Magic (show/hide)
  document.getElementById('card-magic-atk').style.display = s.hasMagic ? '' : 'none';
  document.getElementById('card-magic-def').style.display = s.hasMagic ? '' : 'none';
  if (s.hasMagic) {
    document.getElementById('s-matk-int').textContent = s.mag_atk.int;
    document.getElementById('s-matk-cc').textContent  = pct(s.mag_atk.chance_critical);
    document.getElementById('s-matk-cm').textContent  = '+' + pct(s.mag_atk.multiplier_critical);
    document.getElementById('s-matk-ec').textContent  = s.mag_atk.energy_cost + ' ⚡';
    document.getElementById('s-matk-avg').textContent = `Среднее: ${s.avgMagHit} | Крит: ${s.critMagHit}`;
    document.getElementById('s-mdef-int').textContent = s.mag_def.int;
    document.getElementById('s-mdef-ec').textContent  = s.mag_def.energy_cost + ' ⚡';
  }

  // Heal / Wait
  document.getElementById('s-heal-int').textContent = s.heal.int;
  document.getElementById('s-heal-ec').textContent  = s.heal.energy_cost + ' ⚡';
  document.getElementById('s-wait-int').textContent = s.wait.int;

  // SP counter
  const spEl = document.getElementById('sp-counter');
  spEl.textContent = `SP: ${s.usedSP} / ${s.availSP}`;
  spEl.classList.toggle('over', s.usedSP > s.availSP);

  // XP calc
  refreshXP();
}

// ── Mob multiplier helper (mirrors server/engine/mob.js) ─────────────────────
function abilityMult(multiplier, key, level) {
  if (!multiplier || level <= 1) return 1;
  const m = typeof multiplier === 'number' ? multiplier : (multiplier[key] ?? 1);
  return Math.pow(m, level - 1);
}

// ── XP Calculator ─────────────────────────────────────────────────────────────
function refreshXP() {
  if (!D) return;
  const maxPL     = D.max_player_lvl;
  const maxDL     = D.max_dungeon_lvl;
  const fromLvl   = Math.min(maxPL - 1, Math.max(1, parseInt(document.getElementById('xp-from').value)    || 1));
  const toLvl     = Math.min(maxPL,     Math.max(2, parseInt(document.getElementById('xp-to').value)      || maxPL));
  const dungeonLv = Math.min(maxDL,     Math.max(1, parseInt(document.getElementById('dungeon-lvl').value) || 1));
  const safe      = l => D.progression[l - 1]?.xpRequired ?? 0; 
  const delta     = Math.max(0, safe(toLvl) - safe(fromLvl));

  document.getElementById('xp-delta').textContent = delta.toLocaleString();
  document.getElementById('dungeon-lvl-num').textContent = dungeonLv;

  // Level progress bar
  const prog = document.getElementById('level-progress');
  prog.innerHTML = '';
  for (let l = 1; l < D.progression.length; l++) {
    const xpL    = D.progression[l].xpRequired;
    const xpPrev = D.progression[l - 1].xpRequired;
    const span   = xpL - xpPrev;
    const row    = document.createElement('div'); row.className = 'lvl-row';
    row.innerHTML = `<span>Lv${l}→${l+1}</span><span style="color:#666">${xpPrev.toLocaleString()} → ${xpL.toLocaleString()}</span><span style="color:#888">(+${span})</span>`;
    prog.appendChild(row);
  }

  // Mob kill table
  const table = document.getElementById('mob-table');
  table.innerHTML = '';

  const allMobs = [...(D.mobs ?? [])];
  allMobs.sort((a, b) => (a.xp ?? 0) - (b.xp ?? 0));

  for (const mob of allMobs) {
    if (!mob.xp) continue;

    const xpMult  = abilityMult(mob.multiplier, 'xp',     dungeonLv);
    const hpMult  = abilityMult(mob.multiplier, 'hp',     dungeonLv);
    const atkMult = abilityMult(mob.multiplier, 'attack', dungeonLv);

    const effXP   = Math.round(mob.xp                          * xpMult);
    const effHP   = Math.round((mob.hp ?? 0)                   * hpMult);
    const effATK  = Math.round((mob.function?.attack?.int ?? 0) * atkMult);

    const kills = delta > 0 && effXP > 0 ? Math.ceil(delta / effXP) : 0;

    const lvlStr = Array.isArray(mob.level) ? mob.level.join(', ') : String(mob.level ?? '?');

    const row = document.createElement('div'); row.className = 'mob-tr';

    const name = document.createElement('span'); name.className = 'mob-name';
    name.textContent = mob.name;
    name.title = `Уровни: ${lvlStr}`;

    // HP / ATK column
    const statEl = document.createElement('span'); statEl.className = 'mob-xp';
    const hpStr  = dungeonLv > 1 ? `${effHP}` : `${mob.hp ?? 0}`;
    const atkStr = dungeonLv > 1 ? `${effATK}` : `${mob.function?.attack?.int ?? 0}`;
    statEl.innerHTML = `<span style="color:#3dff7a">${hpStr}hp</span> <span style="color:#c9aa6a">${atkStr}atk</span>`;

    // XP / Kills column
    const killEl = document.createElement('span');
    killEl.className = 'mob-kills' + (kills < 100 ? ' easy' : kills < 300 ? ' medium' : ' hard');
    const xpLabel = dungeonLv > 1 ? `${effXP}xp` : `${mob.xp}xp`;
    killEl.textContent = kills > 0 ? `${xpLabel} / ${kills.toLocaleString()}` : `${xpLabel}`;

    row.appendChild(name); row.appendChild(statEl); row.appendChild(killEl);
    table.appendChild(row);
  }
}

// ── Level slider ──────────────────────────────────────────────────────────────
document.getElementById('lvl-range').addEventListener('input', function () {
  cfg.level = parseInt(this.value);
  document.getElementById('lvl-num').textContent = cfg.level;
  if (D) { buildSkillList(activeBranch); refreshAll(); }
});

// ── Branch tabs ───────────────────────────────────────────────────────────────
document.querySelectorAll('.branch-tab').forEach(btn => {
  btn.addEventListener('click', () => { if (D) buildSkillList(btn.dataset.branch); });
});

// ── Reset buttons ─────────────────────────────────────────────────────────────
document.getElementById('btn-reset-skills').addEventListener('click', () => {
  cfg.learned.clear();
  if (D) { buildSkillList(activeBranch); refreshAll(); }
});

document.getElementById('btn-reset-equip').addEventListener('click', () => {
  for (const slot of (D?.equip_slots ?? [])) cfg.equip[slot] = null;
  document.querySelectorAll('#equip-grid select').forEach(s => { s.value = ''; });
  if (D) refreshAll();
});

// ── XP inputs ─────────────────────────────────────────────────────────────────
document.getElementById('xp-from').addEventListener('input', refreshXP);
document.getElementById('xp-to').addEventListener('input', refreshXP);
document.getElementById('dungeon-lvl').addEventListener('input', refreshXP);

// ── Combat Simulation ─────────────────────────────────────────────────────────

function rollAbility(ability) {
  const crit = Math.random() < (ability.chance_critical ?? 0);
  return Math.round((ability.int ?? 0) * (crit ? 1 + (ability.multiplier_critical ?? 0) : 1));
}

function getMobAbility(mob, id, dungeonLevel) {
  const fn   = mob.function?.[id] ?? {};
  const mult = abilityMult(mob.multiplier, id, dungeonLevel);
  return {
    int:                 Math.round((fn.int ?? 0) * mult),
    energy_cost:         fn.energy_cost         ?? 0,
    chance_critical:     fn.chance_critical      ?? 0,
    multiplier_critical: fn.multiplier_critical  ?? 0,
    loop:                fn.loop                 ?? 1,
    enabled:             fn.action               ?? false,
  };
}

function choosePlayerAction(pHP, pEN, pl, pCD, strategy) {
  const ok    = (id, cost) => pEN >= cost && !(pCD[id] > 0);
  const canAttack = ok('attack',         pl.attack.energy_cost);
  const canMagic  = pl.hasMagic && ok('magical_attack', pl.mag_atk.energy_cost);
  const canHeal   = pl.heal.int > 0 && pHP < pl.maxHp && ok('heal', pl.heal.energy_cost);
  const canDefend = pl.defend.int > 0 && ok('defend', pl.defend.energy_cost);

  if (strategy === 'aggressive') {
    if (canMagic)  return 'magical_attack';
    if (canAttack) return 'attack';
    return 'wait';
  }
  if (strategy === 'balanced') {
    if (canHeal && pHP < pl.maxHp * 0.5) return 'heal';
    if (canMagic)  return 'magical_attack';
    if (canAttack) return 'attack';
    return 'wait';
  }
  if (strategy === 'defensive') {
    if (canHeal && pHP < pl.maxHp * 0.7) return 'heal';
    if (canDefend && Math.random() < 0.35) return 'defend';
    if (canMagic)  return 'magical_attack';
    if (canAttack) return 'attack';
    return 'wait';
  }
  if (canAttack) return 'attack'; return 'wait';
}

function chooseMobAction(mHP, mobMaxHP, mEN, mob, mCD) {
  const fn = mob.function ?? {};
  const ok = (id, cost) => mEN >= cost && !(mCD[id] > 0);
  const hasHeal   = fn.heal?.action   && (fn.heal?.int   ?? 0) > 0 && ok('heal',   fn.heal?.energy_cost   ?? 0);
  const hasDefend = fn.defend?.action && (fn.defend?.int ?? 0) > 0 && ok('defend', fn.defend?.energy_cost ?? 0);
  if (hasHeal   && mHP < mobMaxHP * 0.4)              return 'heal';
  if (hasDefend && Math.random() < 0.25)               return 'defend';
  if (ok('attack', fn.attack?.energy_cost ?? 0))       return 'attack';
  return 'wait';
}

const ACT_LABEL = { attack: 'Атака', magical_attack: 'Маг.атака', heal: 'Лечение', defend: 'Защита', wait: 'Ожидание' };

function runOneFight(pl, mob, dungeonLevel, strategy, record) {
  const mobMaxHP = Math.round((mob.hp     ?? 50) * abilityMult(mob.multiplier, 'hp',     dungeonLevel));
  const mobMaxEN = Math.round((mob.energy ?? 60) * abilityMult(mob.multiplier, 'energy', dungeonLevel));

  let pHP = pl.maxHp, pEN = pl.maxEnergy;
  let mHP = mobMaxHP, mEN = mobMaxEN;
  const pCD = {}, mCD = {};
  let dmgDealt = 0, dmgTaken = 0, turns = 0;
  const log = record ? [] : null;

  const tickCD = (cd, usedAction) => {
    for (const ab of Object.keys(cd)) {
      if (ab === usedAction) continue;
      cd[ab]--;
      if (cd[ab] <= 0) delete cd[ab];
    }
  };
  const setCDifLoop = (cd, action, abilDef) => {
    const loop = D?.core.mechanics.ability?.[action]?.loop ?? abilDef?.loop;
    if (loop) cd[action] = loop;
  };

  while (pHP > 0 && mHP > 0 && turns < 150) {
    const pAct = choosePlayerAction(pHP, pEN, pl, pCD, strategy);
    const mAct = chooseMobAction(mHP, mobMaxHP, mEN, mob, mCD);

    // Player side
    let pDmg = 0, pHeal = 0, pBlock = 0;
    if      (pAct === 'attack')         { pDmg  = rollAbility(pl.attack);  pEN -= pl.attack.energy_cost; }
    else if (pAct === 'magical_attack') { pDmg  = rollAbility(pl.mag_atk); pEN -= pl.mag_atk.energy_cost; }
    else if (pAct === 'heal')           { pHeal = rollAbility(pl.heal);     pEN -= pl.heal.energy_cost; }
    else if (pAct === 'defend')         { pBlock = pl.defend.int;           pEN -= pl.defend.energy_cost; }
    else                                { pEN += pl.wait.int; }

    // Mob side
    const mAtk = getMobAbility(mob, 'attack',  dungeonLevel);
    const mHlA = getMobAbility(mob, 'heal',    dungeonLevel);
    const mDfA = getMobAbility(mob, 'defend',  dungeonLevel);
    const mWtA = getMobAbility(mob, 'wait',    dungeonLevel);
    let mDmg = 0, mHeal = 0, mBlock = 0;
    if      (mAct === 'attack') { mDmg  = rollAbility(mAtk); mEN -= mAtk.energy_cost; }
    else if (mAct === 'heal')   { mHeal = rollAbility(mHlA); mEN -= mHlA.energy_cost; }
    else if (mAct === 'defend') { mBlock = mDfA.int;         mEN -= mDfA.energy_cost; }
    else                        { mEN += (mWtA.int || 20); }

    const realPDmg = Math.max(0, pDmg - mBlock);
    const realMDmg = Math.max(0, mDmg - pBlock);

    mHP -= realPDmg;
    if (mHP > 0) mHP = Math.min(mobMaxHP, mHP + mHeal);
    pHP -= realMDmg;
    if (pHP > 0) pHP = Math.min(pl.maxHp, pHP + pHeal);

    pEN = Math.min(pl.maxEnergy, Math.max(0, pEN));
    mEN = Math.min(mobMaxEN,     Math.max(0, mEN));

    // Cooldowns: set for used ability if it has loop, then tick others
    setCDifLoop(pCD, pAct, pl[pAct === 'magical_attack' ? 'mag_atk' : pAct]);
    setCDifLoop(mCD, mAct, getMobAbility(mob, mAct, dungeonLevel));
    tickCD(pCD, pAct);
    tickCD(mCD, mAct);

    dmgDealt += realPDmg; dmgTaken += realMDmg;
    turns++;

    if (log) {
      const pPart = pAct === 'attack' || pAct === 'magical_attack'
        ? `<span class="p">${ACT_LABEL[pAct]} (${realPDmg} dmg)</span>`
        : pAct === 'heal'   ? `<span class="p">Лечение (+${pHeal} HP)</span>`
        : pAct === 'defend' ? `<span class="p">Защита (блок ${pBlock})</span>`
        : `<span class="p">Ожидание (+${pl.wait.int} ⚡)</span>`;
      const mPart = mAct === 'attack'
        ? `<span class="m">Атака (${realMDmg} dmg)</span>`
        : mAct === 'heal'   ? `<span class="m">Лечение (+${mHeal} HP)</span>`
        : mAct === 'defend' ? `<span class="m">Защита (блок ${mBlock})</span>`
        : `<span class="m">Ожидание (+${mWtA.int||20} ⚡)</span>`;
      const hpInfo = `HP ${Math.max(0,Math.round(pHP))}/${pl.maxHp} vs ${Math.max(0,Math.round(mHP))}/${mobMaxHP}`;
      log.push(`<div class="sim-log-turn">Ход ${turns}: ${pPart} | ${mPart} &mdash; <span style="color:#444">${hpInfo}</span></div>`);
    }
  }

  return { win: mHP <= 0 && pHP > 0, turns, dmgDealt, dmgTaken, playerHPLeft: Math.max(0, Math.round(pHP)), log };
}

function simulateCombat(pl, mob, dungeonLevel, strategy, runs) {
  const first = runOneFight(pl, mob, dungeonLevel, strategy, true);
  let wins = first.win ? 1 : 0;
  let tTurns = first.turns, tHP = first.playerHPLeft, tDealt = first.dmgDealt, tTaken = first.dmgTaken;
  for (let i = 1; i < runs; i++) {
    const r = runOneFight(pl, mob, dungeonLevel, strategy, false);
    if (r.win) wins++;
    tTurns += r.turns; tHP += r.playerHPLeft; tDealt += r.dmgDealt; tTaken += r.dmgTaken;
  }
  return {
    winRate:  wins / runs, runs,
    avgTurns: Math.round(tTurns / runs * 10) / 10,
    avgHP:    Math.round(tHP    / runs),
    avgDealt: Math.round(tDealt / runs),
    avgTaken: Math.round(tTaken / runs),
    exampleWin: first.win, exampleLog: first.log,
  };
}

// ── Sim UI helpers ────────────────────────────────────────────────────────────
function populateEnemySelect() {
  if (!D) return;
  const type = document.getElementById('sim-enemy-type').value;
  const pool = type === 'boss' ? (D.bosses ?? []) : (D.mobs ?? []);
  const sel  = document.getElementById('sim-enemy-id');
  sel.innerHTML = '';
  for (const e of pool) {
    const o = document.createElement('option'); o.value = e.id;
    const lvlStr = Array.isArray(e.level) ? e.level.join(', ') : String(e.level ?? '?');
    o.textContent = e.name + ` [${lvlStr}]`;
    sel.appendChild(o);
  }
}

function runSimulation() {
  if (!D) return;
  const type = document.getElementById('sim-enemy-type').value;
  const id   = document.getElementById('sim-enemy-id').value;
  const pool = type === 'boss' ? (D.bosses ?? []) : (D.mobs ?? []);
  const mob  = pool.find(m => m.id === id);
  if (!mob) return;

  const dungeonLv = Math.min(D.max_dungeon_lvl, Math.max(1, parseInt(document.getElementById('sim-dungeon-lvl').value) || 1));
  const strategy  = document.getElementById('sim-strategy').value;
  const runs      = parseInt(document.getElementById('sim-runs').value) || 500;

  const s = compute();
  const pl = { maxHp: s.maxHp, maxEnergy: s.maxEnergy, attack: s.attack, defend: s.defend, mag_atk: s.mag_atk, heal: s.heal, wait: s.wait, hasMagic: s.hasMagic };
  const result = simulateCombat(pl, mob, dungeonLv, strategy, runs);

  document.getElementById('sim-results').style.display = '';
  document.getElementById('sim-runs-total').textContent = runs;

  const pct   = Math.round(result.winRate * 100);
  const pctEl = document.getElementById('sim-win-pct');
  pctEl.textContent = pct + '%';
  pctEl.className   = 'sim-big-pct ' + (pct >= 70 ? 'win' : pct >= 40 ? 'mid' : 'lose');

  document.getElementById('sim-avg-turns').textContent = result.avgTurns;
  document.getElementById('sim-avg-hp').textContent    = `${result.avgHP}/${s.maxHp}`;
  document.getElementById('sim-avg-dealt').textContent = result.avgDealt;
  document.getElementById('sim-avg-taken').textContent = result.avgTaken;

  const logEl = document.getElementById('sim-log');
  logEl.innerHTML = (result.exampleLog ?? []).join('') +
    `<div class="sim-log-outcome ${result.exampleWin ? 'win' : 'lose'}">${result.exampleWin ? '✓ Победа' : '✗ Поражение'}</div>`;
}

document.getElementById('sim-enemy-type').addEventListener('change', populateEnemySelect);
document.getElementById('sim-run').addEventListener('click', runSimulation);

document.getElementById('sim-log-toggle').addEventListener('click', function () {
  const log = document.getElementById('sim-log');
  const open = log.style.display !== 'none';
  log.style.display    = open ? 'none' : '';
  this.textContent     = (open ? '▸' : '▾') + ' Пример боя';
});


