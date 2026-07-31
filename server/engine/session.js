'use strict';
const path = require('path');
const fs   = require('fs');
const { PLAYER_BASE, CORE, SAVE_DIR, SESSION_FILE, ITEMS, OBJECTS, MOBS, BOSSES, NPCS, CONDITIONS, NARRATIVE, ACHIEVEMENTS, PROGRESSION } = require('./data');
const { resolveImags } = require('./helpers');
const { recalcStats, resolveAbilities } = require('./player');
const { itemDef } = require('./items');
const { resolveMobAbilities, resolveMobStats, applyStatModes } = require('./mob');
const { t, resolvePromt } = require('./translation');
const { loadLangFile } = require('./ai');
const { translateNpcNarrativeText } = require('./npc');
const { generateDungeon } = require('./dungeon');

// Shared mutable session state — all routes use state.session
const state = { session: null };

function saveSessionAuto() {
  if (!state.session) return;
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(slimSession(state.session))); } catch {}
}

function clearSessionAuto() {
  try { fs.unlinkSync(SESSION_FILE); } catch {}
}

function addJournal(sess, type, text) {
  if (!sess.journal) sess.journal = [];
  sess.journal.push({ type, text, dungeonLevel: sess.dungeon?.level ?? 1 });
  if (sess.journal.length > 1000) sess.journal.shift();
}

// ── Slim / Hydrate ────────────────────────────────────────────────────────────

function slimPlayer(player) {
  return {
    ...player,
    inventory: player.inventory.map(i => ({ id: i.id, count: i.count })),
    equip: Object.fromEntries(
      Object.entries(player.equip ?? {}).map(([slot, item]) => [slot, item?.id ?? null])
    )
  };
}

function hydratePlayer(slim) {
  const inventory = (slim.inventory ?? []).map(i => {
    if (i.name) return i; // already hydrated (old save format)
    const def = itemDef(i.id);
    return {
      id: i.id, count: i.count,
      name:         t('items', i.id, 'name', def?.name ?? i.id),
      image:        def?.image ? `/assets/item/${def.image}` : '',
      equip:        def?.equip ?? false,
      use:          def?.use   ?? null,
      stats:        def?.stats ?? null,
      price_sell:   def?.price_sell ?? 0,
      inventoryBar: def?.['inventorybar'] ?? def?.['inventory-bar'] ?? false
    };
  });

  const equip = {};
  for (const [slot, val] of Object.entries(slim.equip ?? {})) {
    if (!val) { equip[slot] = null; continue; }
    if (typeof val === 'object') { equip[slot] = val; continue; } // old format
    const def = itemDef(val);
    equip[slot] = def
      ? { id: def.id, name: t('items', def.id, 'name', def.name),
          image: `/assets/item/${def.image}`, stats: def.stats ?? null }
      : null;
  }

  return { ...slim, inventory, equip };
}

function slimMob(mob) {
  if (!mob) return null;
  return {
    instanceId:      mob.instanceId,
    defId:           mob.defId,
    level:           mob.level           ?? 1,
    hp:              mob.hp,
    energy:          mob.energy,
    abilityCooldowns: mob.abilityCooldowns ?? {},
    memory:          mob.memory          ?? [],
    // Persisted so a reload doesn't re-roll a fresh random pick out of an array-format
    // promt (server/engine/translation.js resolvePromt) — the personality picked at
    // spawn must stay fixed for the lifetime of this instance.
    promt:           mob.promt           ?? null,
    effects:         mob.effects         ?? null,
    source:          mob.source          ?? 'mob',
    triggeredPhases: mob.triggeredPhases ?? []
  };
}

function hydrateMob(slim) {
  if (!slim) return null;
  if (slim.name) return slim; // already hydrated (old save format)
  const isBoss = slim.source === 'boss';
  const pool   = isBoss ? BOSSES : MOBS;
  const ns     = isBoss ? 'boss'  : 'mob';
  const base   = pool.find(m => m.id === slim.defId);
  if (!base) return null;
  const { getAbilityMult } = require('./mob');
  const { loadLangFile } = require('./ai');
  const { translateBossEncounterText, resolvePhases, applyPhase } = require('./boss');
  const level     = slim.level ?? 1;
  const hpMult    = getAbilityMult(base.multiplier, 'hp', level);
  const xpMult    = getAbilityMult(base.multiplier, 'xp', level);
  const stats     = resolveMobStats(base, level);
  const abilities = resolveMobAbilities(base, level);
  applyStatModes(stats, abilities);
  const promt = slim.promt ?? (base.promt_path
    ? (loadLangFile(base.promt_path) ?? resolvePromt(ns, base.id, base.promt))
    : resolvePromt(ns, base.id, base.promt));
  const encounter_text = isBoss
    ? translateBossEncounterText(base.encounter_text, base.id)
    : require('./mob').translateEncounterText(base.encounter_text, base.id);

  const phases          = isBoss ? resolvePhases(base, level) : [];
  const triggeredPhases = slim.triggeredPhases ?? [];

  const mob = {
    instanceId:   slim.instanceId,
    defId:        slim.defId,
    name:         t(ns, base.id, 'name', base.name),
    image:        base.image,
    promt,
    level,
    hp:           slim.hp,
    maxHp:        Math.round(base.hp * hpMult),
    energy:       slim.energy,
    maxEnergy:    base.energy,
    abilityCooldowns: slim.abilityCooldowns ?? {},
    surrender_difficulty: base.surrender_difficulty ?? 1,
    stats,
    abilities,
    xp:           Math.round(base.xp * xpMult),
    items:        base.items ?? [],
    memory:       slim.memory ?? [],
    imags:        base.imags  ?? null,
    pawn:         base.pawn   ?? null,
    sound:        base.sound       ?? null,
    soundVolume:  base.sound_volume ?? null,
    effects:      slim.effects ?? null,
    style:        base.style  ?? null,
    events:       base.events ?? null,
    encounter_text,
    isBoss,
    source:       slim.source ?? 'mob',
    phases,
    triggeredPhases
  };

  // Re-apply all previously triggered phases to restore the boss to its correct state
  for (const phId of triggeredPhases) {
    const ph = phases.find(p => p.phase === phId);
    if (ph) applyPhase(mob, ph);
  }

  return mob;
}

function slimObject(obj) {
  const slim = { instanceId: obj.instanceId, defId: obj.defId };
  if (obj.opened  !== undefined) slim.opened  = obj.opened;
  if (obj.locked  !== undefined) slim.locked  = obj.locked;
  return slim;
}

function hydrateObject(slim) {
  if (slim.name) return slim; // already hydrated (old save format)
  const def = OBJECTS.find(o => o.id === slim.defId);
  if (!def) return slim;
  const obj = {
    instanceId: slim.instanceId,
    defId:      slim.defId,
    name:       t('objects', def.id, 'name', def.name),
    image:      def.image,
    action:     def.action,
    items:      def.items ?? []
  };
  if (slim.opened  !== undefined) obj.opened  = slim.opened;
  if (slim.locked  !== undefined) obj.locked  = slim.locked;
  return obj;
}

function slimNpc(npc) {
  if (!npc) return null;
  return {
    instanceId:   npc.instanceId,
    defId:        npc.defId,
    messageCount: npc.messageCount,
    history:      npc.history ?? [],
    shop: (npc.shop ?? []).map(i => ({ id: i.id, count: i.count, price: i.price })),
    // npc_combat state (roadmap/npc_combat.md) — must survive slim/hydrate round-trips
    // (language change, save/load, session-file reload) or "defeated" silently resets.
    defeated:     npc.defeated ?? false,
    relationship: npc.relationship ?? 0,
    memory:       npc.memory ?? { records: [], summary: '', sinceCompact: 0 },
    // dream_ai state — dreamedUpTo must match npc.history's length semantics exactly,
    // or a reload would re-summarize (or skip) chat that already happened.
    recentTrades: npc.recentTrades ?? [],
    dreamedUpTo:  npc.dreamedUpTo  ?? 0
  };
}

function hydrateNpc(slim) {
  if (!slim) return null;
  if (slim.name) return slim; // already hydrated (old save format)
  const base = NPCS.find(n => n.id === slim.defId);
  if (!base) return null;
  const shop = (slim.shop ?? []).map(i => {
    const def = itemDef(i.id);
    return {
      id: i.id, count: i.count, price: i.price,
      name:  t('items', i.id, 'name', def?.name ?? i.id),
      image: def?.image ? `/assets/item/${def.image}` : '',
      stats: def?.stats ?? null,
      equip: def?.equip ?? false
    };
  });
  // relationship.mode:"account" NPCs re-fetch the live cross-save value instead of
  // trusting the slimmed session snapshot, so it always reflects the latest account.json.
  const relMode = base.relationship?.mode ?? 'session';
  const { getAccountRelationship, getAccountMemory } = require('./account');

  return {
    instanceId:     slim.instanceId,
    defId:          slim.defId,
    name:           t('npc', base.id, 'name',  base.name),
    type:           base.type,
    promt:          base.promt_path ? (loadLangFile(base.promt_path) ?? resolvePromt('npc', base.id, base.promt)) : resolvePromt('npc', base.id, base.promt),
    portrait:       `/assets/npc/${base.portrait}`,
    pawn:           `/assets/npc/${base.pawn}`,
    icon:           `/assets/npc/${base.icon}`,
    messageCount:   slim.messageCount ?? 0,
    maxMessages:    base.max_count_message ?? 5,
    messageIgnores: base.message_ignores  ?? '...',
    narrative_text: translateNpcNarrativeText(base.narrative_text, base.id),
    history:        slim.history ?? [],
    shop,
    defeated:       slim.defeated ?? false,
    relationship:   relMode === 'account'
      ? getAccountRelationship(base.id, base.relationship?.default ?? 0)
      : (slim.relationship ?? base.relationship?.default ?? 0),
    memory:         relMode === 'account' ? getAccountMemory(base.id) : (slim.memory ?? { records: [], summary: '', sinceCompact: 0 }),
    recentTrades:   slim.recentTrades ?? [],
    dreamedUpTo:    slim.dreamedUpTo  ?? 0
  };
}

function slimRoom(room) {
  return {
    ...room,
    objects: (room.objects ?? []).map(slimObject),
    mob:     slimMob(room.mob),
    npc:     slimNpc(room.npc)
  };
}

function hydrateRoom(room) {
  return {
    ...room,
    objects: (room.objects ?? []).map(hydrateObject),
    mob:     hydrateMob(room.mob),
    npc:     hydrateNpc(room.npc)
  };
}

function slimSession(sess) {
  return {
    player:  slimPlayer(sess.player),
    dungeon: {
      ...sess.dungeon,
      rooms: Object.fromEntries(
        Object.entries(sess.dungeon.rooms).map(([gid, r]) => [gid, slimRoom(r)])
      )
    },
    combat:  sess.combat,
    journal: sess.journal ?? []
  };
}

function hydrateSession(slim) {
  const player = hydratePlayer(slim.player);
  const dungeon = {
    ...slim.dungeon,
    rooms: Object.fromEntries(
      Object.entries(slim.dungeon.rooms).map(([gid, r]) => [gid, hydrateRoom(r)])
    )
  };
  return { player, dungeon, combat: slim.combat ?? null, journal: slim.journal ?? [] };
}

function newSession(level = 1, inheritPlayer = null, inheritJournal = []) {
  const { account } = require('./account');
  const achSP = (account.achievements ?? []).reduce((sum, id) => {
    const def = ACHIEVEMENTS.find(a => a.id === id);
    return sum + (def?.type === 'point' ? (def.int ?? 0) : 0);
  }, 0);

  const player = inheritPlayer ?? {
    level, xp: 0, gold: 0, charLevel: 1,
    skillPoints: (PROGRESSION.find(p => p.level === 1)?.skillPoints ?? 0) + achSP,
    hp: PLAYER_BASE.hp, maxHp: PLAYER_BASE.hp,
    energy: PLAYER_BASE.energy, maxEnergy: PLAYER_BASE.energy,
    abilityCooldowns: {}, inventory: [],
    equip: Object.fromEntries(Object.keys(CORE.mechanics.equipment ?? {}).map(k => [k, null])),
    bonuses: {}, levelBonuses: {}, learnedSkills: [],
    critChance:     PLAYER_BASE.function.attack.chance_critical    ?? 0.05,
    critMultiplier: PLAYER_BASE.function.attack.multiplier_critical ?? 0.3,
    kills: 0, peacefulWins: 0, mobsEncountered: 0,
    magicUsed:   0,
    storyFlags:  {}
  };
  player.energy = player.maxEnergy;
  recalcStats(player);
  const ctx = { player };
  return {
    player,
    dungeon: { level, rooms: generateDungeon(level, ctx), playerPos: '0,0', hasKey: false },
    combat: null,
    journal: inheritJournal
  };
}

function listSaves() {
  if (!fs.existsSync(SAVE_DIR)) return [];
  return fs.readdirSync(SAVE_DIR)
    .filter(d => fs.statSync(path.join(SAVE_DIR, d)).isDirectory())
    .map(d => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(SAVE_DIR, d, 'player.json'), 'utf8'));
        return { id: d, level: p.level, hp: p.hp, xp: p.xp, gold: p.gold ?? 0 };
      } catch { return { id: d }; }
    })
    .sort((a, b) => b.id.localeCompare(a.id));
}

function doSave(sess) {
  const slim = slimSession(sess);
  const now  = new Date();
  const pad  = n => String(n).padStart(2, '0');
  const id   = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const dir  = path.join(SAVE_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'player.json'),  JSON.stringify(slim.player,  null, 2));
  fs.writeFileSync(path.join(dir, 'world.json'),   JSON.stringify(slim.dungeon, null, 2));
  fs.writeFileSync(path.join(dir, 'journal.json'), JSON.stringify(slim.journal ?? [], null, 2));
  return id;
}

function doLoad(saveId) {
  const dir     = path.join(SAVE_DIR, saveId);
  const player  = JSON.parse(fs.readFileSync(path.join(dir, 'player.json'), 'utf8'));
  const dungeon = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'),  'utf8'));
  let journal = [];
  try { journal = JSON.parse(fs.readFileSync(path.join(dir, 'journal.json'), 'utf8')); } catch {}
  return hydrateSession({ player, dungeon, combat: null, journal });
}

// ── Public views ──────────────────────────────────────────────────────────────

function mobAssetBase(mob) {
  return mob?.isBoss ? '/assets/boss/' : '/assets/mob/';
}

function pubRoom(r) {
  const base = {
    gid: r.gid, x: r.x, y: r.y, type: r.type,
    image:   `/assets/map/${r.image}`,
    preview: r.preview ?? 'preview/default.png',
    passages: r.passages,
    discovered: r.discovered
  };
  if (!r.discovered) return base;
  return {
    ...base,
    objects: r.objects.map(o => ({
      instanceId: o.instanceId, defId: o.defId, name: o.name,
      image: `/assets/object/${o.image}`,
      action: o.action, opened: o.opened ?? null, locked: o.locked ?? null
    })),
    hasMob:       !!r.mob,
    hasBoss:      !!r.mob?.isBoss,
    mobName:      r.mob ? t('mob', r.mob.id, 'name', r.mob.name) : null,
    mobImage:     r.mob ? `${mobAssetBase(r.mob)}${r.mob.imags?.default ?? r.mob.image ?? ''}` : null,
    mobPawn:      r.mob?.pawn ? `${mobAssetBase(r.mob)}${r.mob.pawn}` : null,
    mobEvents:    r.mob?.events       ?? null,
    hasNpc:        !!r.npc,
    npcName:       r.npc ? t('npc', r.npc.id, 'name', r.npc.name) : null,
    npcPortrait:   r.npc?.portrait    ?? null,
    npcPawn:       r.npc?.pawn        ?? null,
    npcImage:      r.npc?.icon        ?? null,
    npcType:       r.npc?.type        ?? null,
    npcInstanceId: r.npc?.instanceId  ?? null,
    npcEvents:     r.npc?.events      ?? null,
    scavenge:      r.scavenge         ?? null
  };
}

function translateNarrative(narrative) {
  if (!narrative) return null;
  const MISS = '\x00';
  const trSection = (sec, sectionId) => {
    if (!sec) return sec;
    const trKey = key => key ? t('narrative', sectionId, key, MISS) : MISS;
    return {
      ...sec,
      default:  t('narrative', sectionId, 'default', sec.default),
      variants: (sec.variants ?? []).map(v => {
        let text = trKey(v.key);
        if (text === MISS) text = v.text ?? null;
        if (!text) return null;
        return { ...v, text };
      }).filter(Boolean)
    };
  };
  const result = { ...narrative };
  if (result.beffore_combat) result.beffore_combat = trSection(result.beffore_combat, 'before_combat');
  if (result.after_combat)   result.after_combat   = trSection(result.after_combat,   'after_combat');
  if (result.after_defeat)   result.after_defeat   = trSection(result.after_defeat,   'after_defeat');
  if (result.NPC) {
    result.NPC = { ...result.NPC };
    if (result.NPC.trader) result.NPC.trader = trSection(result.NPC.trader, 'npc_trader');
    if (result.NPC.other)  result.NPC.other  = trSection(result.NPC.other,  'npc_other');
  }
  return result;
}

function pubSession(sess) {
  const mob      = sess.combat?.mob;
  const charLv   = sess.player.charLevel ?? 1;
  const nextTier = PROGRESSION.find(t => t.level > charLv);
  const player   = {
    ...sess.player,
    floor:       sess.dungeon.level,                // текущий этаж подземелья
    nextLevelXp: nextTier?.xpRequired ?? null       // XP до следующего уровня (null = макс)
  };
  return {
    player,
    abilities:       resolveAbilities(sess.player),
    player_actions:  CORE.mechanics.function_only_player ?? {},
    playerImagsSpec:       PLAYER_BASE.imags,
    playerSoundSpec:       PLAYER_BASE.sound        ?? null,
    playerSoundVolume:     PLAYER_BASE.sound_volume ?? null,
    coreSoundDefault:      CORE.mechanics.default_sound        ?? null,
    coreSoundDefaultVolume: CORE.mechanics.default_sound_volume ?? 1,
    coreSoundDefaultMob:   CORE.mechanics.default_sound_mob    ?? null,
    conditions:      CONDITIONS,
    narrative:       translateNarrative(NARRATIVE),
    dungeon: {
      level:     sess.dungeon.level,
      playerPos: sess.dungeon.playerPos,
      hasKey:    sess.dungeon.hasKey,
      rooms:     Object.values(sess.dungeon.rooms).map(pubRoom)
    },
    currentRoom: pubRoom(sess.dungeon.rooms[sess.dungeon.playerPos]),
    combat: sess.combat ? {
      turn:         sess.combat.turn,
      narratorText: sess.combat.narratorText ?? null,
      chatLog:      sess.combat.chatLog      ?? [],
      mob: {
        name:         t('mob', mob.id, 'name', mob.name),
        image:        `${mobAssetBase(mob)}${mob.imags?.default ?? mob.image ?? ''}`,
        imags:        resolveImags(mob.imags, mob.effects, mobAssetBase(mob)),
        hp:           mob.hp,
        maxHp:        mob.maxHp,
        energy:       mob.energy,
        maxEnergy:    mob.maxEnergy,
        abilities:    mob.abilities,
        abilityCooldowns: mob.abilityCooldowns ?? {},
        xp:             mob.xp,
        sound:          mob.sound        ?? null,
        soundVolume:    mob.soundVolume  ?? null,
        encounter_text: mob.encounter_text ?? null,
        isBoss:          mob.isBoss ?? false,
        style:           mob.style  ?? null,
        sourceNpc:       mob.sourceNpc ?? null,
        // Lean phase list (name only) + which phases are currently active.
        // Full phase conditions/overrides stay server-side.
        phases:          (mob.phases ?? []).map(p => ({ phase: p.phase, phase_name: p.phase_name })),
        triggeredPhases: mob.triggeredPhases ?? []
      },
      elixirUsedThisTurn: !!sess.combat.elixirUsedThisTurn,
      fleeAttempted:      !!sess.combat.fleeAttempted,
      pendingMercy:       !!sess.combat.pendingMercy
    } : null
  };
}

module.exports = {
  state,
  saveSessionAuto, clearSessionAuto,
  addJournal, newSession,
  slimSession, hydrateSession,
  listSaves, doSave, doLoad,
  pubRoom, pubSession,
  recalcStats
};
