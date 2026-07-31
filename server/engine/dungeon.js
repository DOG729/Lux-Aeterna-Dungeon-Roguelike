'use strict';
const path = require('path');
const fs   = require('fs');
const { ROOT, MAP, ITEMS, OBJECTS, NPCS, BOSSES, CORE, SCAVENGE } = require('./data');
const { uid, rng, OPP, DELTA, levelMatches, getDungeonLevelCfg, resolveMapLevel } = require('./helpers');
const { t } = require('./translation');
const { pickObjectDef, parseSpawnRange } = require('./items');
const { spawnMob } = require('./mob');
const { spawnNpc } = require('./npc');
const { spawnBoss } = require('./boss');

function _buildScavengeState(sec) {
  if (!CORE.scavenge_system?.active) return {};
  const sceneId = sec?.scavenge_scene;
  if (!sceneId || !SCAVENGE[sceneId]) return {};
  const chance = sec.chance_scavenge ?? 1;
  if (Math.random() > chance) return {};
  return {
    scavenge: {
      scene:          sceneId,
      name:           SCAVENGE[sceneId]?.name ?? null,
      autoOpen:       sec.scavenge_auto_open  ?? false,
      repeatOpen:     sec.scavenge_repeat_open ?? true,
      removedObjects:  [],
      usedObjects:     [],
      completedTasks:  [],
      activatedTasks:  [],
      currentImage:    null,
      visited:         false
    }
  };
}

function pickSection(passages, isSpawn, level = 1) {
  if (isSpawn) {
    const cands = MAP.section.filter(s => s.action === 'spawn' && levelMatches(s.level, level));
    return cands.length ? cands[rng(0, cands.length - 1)] : MAP.section.find(s => s.action === 'spawn') ?? null;
  }

  const DIRS = ['left', 'right', 'top', 'bottom'];
  const genSecs = MAP.section.filter(s => s.action === 'generation' && levelMatches(s.level, level));

  const exact = genSecs.filter(s => DIRS.every(d => !!s.passage[d] === !!passages[d]));
  if (exact.length) return exact[rng(0, exact.length - 1)];

  let best = null, bestCount = -1;
  for (const s of genSecs) {
    if (DIRS.some(d => s.passage[d] && !passages[d])) continue;
    const count = DIRS.filter(d => s.passage[d]).length;
    if (count > bestCount) { best = s; bestCount = count; }
  }
  return best ?? null;
}

const DEFAULT_PREVIEW = 'preview/default.png';
function sectionPreview(sec) {
  return sec?.preview ?? MAP.preview ?? DEFAULT_PREVIEW;
}

function loadPreMadeMap(filePath, dungeonLevel, ctx = null) {
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', filePath), 'utf8'));
  const rooms = {};

  const spawnRd = Object.values(plan.rooms).find(r => r.type === 'spawn');
  if (!spawnRd) throw new Error(`Pre-made map "${filePath}" has no spawn room`);
  const offX = spawnRd.x, offY = spawnRd.y;

  for (const [, rd] of Object.entries(plan.rooms)) {
    const nx = rd.x - offX, ny = rd.y - offY;
    const gid = `${nx},${ny}`;
    const sec = MAP.section.find(s => s.id === rd.sectionId) ?? null;
    rooms[gid] = {
      gid, x: nx, y: ny,
      type:      rd.type ?? 'normal',
      image:     rd.image ?? sec?.image ?? 'block/1/start_block_[t_b_r].png',
      preview:   sectionPreview(sec),
      passages:  { ...rd.passages },
      objects: [], mob: null, npc: null,
      discovered: gid === '0,0',
      ..._buildScavengeState(sec),
      _mobChance:    rd.chance_spawn_mob ?? sec?.chance_spawn_mob ?? null,
      _mobIds:       rd.spawn_mob  ?? [],
      _npcChance:    rd.chance_spawn_npc ?? sec?.chance_spawn_npc ?? 0,
      _npcIds:       rd.spawn_npc  ?? [],
      _bossChance:   rd.chance_spawn_boss ?? sec?.chance_spawn_boss ?? 0,
      _bossIds:      rd.spawn_boss ?? sec?.spawn_boss ?? [],
      _spawnObjects: rd.spawn_object ?? []
    };
  }

  const nonSpawn = Object.values(rooms).filter(r => r.type !== 'spawn');

  const hasDoor = Object.values(rooms).some(r =>
    r._spawnObjects.some(id => OBJECTS.find(o => o.id === id)?.type === 'door_area')
  );
  const hasKey = Object.values(rooms).some(r =>
    r._spawnObjects.some(id => OBJECTS.find(o => o.id === id)?.type === 'key_area')
  );

  for (const room of Object.values(rooms)) {
    for (const defId of room._spawnObjects) {
      const def = OBJECTS.find(o => o.id === defId);
      if (!def) continue;
      if (def.type === 'door_area') {
        room.type = 'door_area';
        room.objects.push({ instanceId: uid(), defId: def.id,
          name: t('objects', def.id, 'name', def.name), image: def.image, action: 'door', locked: true });
      } else if (def.type === 'key_area') {
        room.type = 'key_area';
        room.objects.push({ instanceId: uid(), defId: def.id,
          name: t('objects', def.id, 'name', def.name), image: def.image,
          action: def.action ?? 'pickup',
          items: def.items ?? [{ id: 'key_door_inventory', count: 1 }] });
      } else {
        const objData = { instanceId: uid(), defId: def.id,
          name: t('objects', def.id, 'name', def.name), image: def.image, action: def.action, items: def.items ?? [] };
        if (def.action === 'chest') objData.opened = false;
        room.objects.push(objData);
      }
    }
    delete room._spawnObjects;
  }

  if (!hasDoor) {
    const doorDef  = pickObjectDef('door_area', dungeonLevel, true);
    const doorPool = nonSpawn.filter(r => r.type === 'normal');
    if (doorDef && doorPool.length) {
      const doorRoom = doorPool.reduce((best, r) =>
        (Math.abs(r.x) + Math.abs(r.y)) > (Math.abs(best.x) + Math.abs(best.y)) ? r : best);
      doorRoom.type = 'door_area';
      doorRoom.objects.push({ instanceId: uid(), defId: doorDef.id,
        name: t('objects', doorDef.id, 'name', doorDef.name), image: doorDef.image, action: 'door', locked: true });
    }
  }
  if (!hasKey) {
    const keyDef  = pickObjectDef('key_area', dungeonLevel, true);
    const keyPool = nonSpawn.filter(r => r.type === 'normal');
    if (keyDef && keyPool.length) {
      const keyRoom = keyPool[rng(0, keyPool.length - 1)];
      keyRoom.type = 'key_area';
      keyRoom.objects.push({ instanceId: uid(), defId: keyDef.id,
        name: t('objects', keyDef.id, 'name', keyDef.name), image: keyDef.image,
        action: keyDef.action ?? 'pickup',
        items: keyDef.items ?? [{ id: 'key_door_inventory', count: 1 }] });
    }
  }

  const defaultMobChance = { normal: 0.45, key_area: 0.55, door_area: 0 };
  for (const room of nonSpawn) {
    const chance = room.type === 'door_area' ? 0
      : (room._mobChance ?? defaultMobChance[room.type] ?? 0.4);
    const mobIds = room._mobIds ?? [];
    delete room._mobChance; delete room._mobIds;
    if (Math.random() < chance)
      room.mob = spawnMob(dungeonLevel, mobIds.length ? mobIds : null, ctx);
  }

  const npcSpawnCount = {};
  for (const room of Object.values(rooms)) {
    const npcChance = room._npcChance ?? 0;
    const npcIds    = room._npcIds    ?? [];
    delete room._npcChance; delete room._npcIds;
    if (room.mob || room.type === 'door_area' || room.type === 'spawn' || !npcChance || !npcIds.length) continue;
    if (Math.random() >= npcChance) continue;
    const deadNpcIds = ctx?.player?.deadNpcIds ?? [];
    const eligibleIds = npcIds.filter(id => {
      const base = NPCS.find(n => n.id === id);
      return base && levelMatches(base.level, dungeonLevel)
        && (npcSpawnCount[id] ?? 0) < (base.count_spawn_level ?? 1)
        && !deadNpcIds.includes(id);
    });
    if (!eligibleIds.length) continue;
    const npc = spawnNpc(dungeonLevel, eligibleIds);
    if (npc) { room.npc = npc; npcSpawnCount[npc.defId] = (npcSpawnCount[npc.defId] ?? 0) + 1; }
  }

  // ── Section boss spawn ────────────────────────────────────────────────────
  const bossSpawnCount = {};
  for (const room of Object.values(rooms)) {
    const bossChance = room._bossChance ?? 0;
    const bossIds    = room._bossIds    ?? [];
    delete room._bossChance; delete room._bossIds;
    if (room.mob || room.npc || !bossChance || !bossIds.length) continue;
    if (Math.random() >= bossChance) continue;
    const eligibleIds = bossIds.filter(id => {
      const base = BOSSES.find(b => b.id === id);
      return base && levelMatches(base.level, dungeonLevel)
        && (bossSpawnCount[id] ?? 0) < (base.count_spawn_level ?? 1);
    });
    if (!eligibleIds.length) continue;
    const id   = eligibleIds[rng(0, eligibleIds.length - 1)];
    const boss = spawnBoss(id, dungeonLevel);
    if (boss) { room.mob = boss; bossSpawnCount[id] = (bossSpawnCount[id] ?? 0) + 1; }
  }

  // ── Door boss spawn ───────────────────────────────────────────────────────
  const bossList = getDungeonLevelCfg(dungeonLevel).boss ?? [];
  for (const bossEntry of bossList) {
    if (bossEntry.action === 'door') {
      const doorRoom = Object.values(rooms).find(r => r.type === 'door_area');
      if (doorRoom && !doorRoom.mob) {
        doorRoom.mob = spawnBoss(bossEntry.id, dungeonLevel);
      }
    }
  }

  return rooms;
}

function generateDungeon(dungeonLevel, ctx = null) {
  const lvlCfg = getDungeonLevelCfg(dungeonLevel);
  if (lvlCfg.plan?.length) {
    const planFile = lvlCfg.plan[rng(0, lvlCfg.plan.length - 1)];
    return loadPreMadeMap(planFile, dungeonLevel, ctx);
  }

  const level = resolveMapLevel(dungeonLevel);
  const rooms = {};

  const spawnCands = MAP.section.filter(s => s.action === 'spawn' && levelMatches(s.level, level));
  const spawnSec   = spawnCands.length
    ? spawnCands[rng(0, spawnCands.length - 1)]
    : MAP.section.find(s => s.action === 'spawn');
  const spawnP = spawnSec?.passage ?? { left: false, right: true, top: false, bottom: false };

  rooms['0,0'] = {
    gid: '0,0', x: 0, y: 0, type: 'spawn',
    image: spawnSec?.image ?? 'block/1/start_block_[t_b_r].png',
    preview: sectionPreview(spawnSec),
    passages: { ...spawnP },
    objects: [], mob: null, npc: null, discovered: true,
    ..._buildScavengeState(spawnSec)
  };

  const genSecs = MAP.section.filter(s => s.action === 'generation' && levelMatches(s.level, level));
  const sectionPlacedCount = {};
  const deadEndSecs = genSecs.filter(s => Object.values(s.passage).filter(Boolean).length === 1);

  const frontier = [];
  for (const [dir, open] of Object.entries(spawnP)) {
    if (!open) continue;
    const [dx, dy] = DELTA[dir];
    frontier.push({ x: dx, y: dy, required: OPP[dir], parentGid: '0,0', parentDir: dir });
  }

  const TARGET = rng(lvlCfg.min ?? 8, lvlCfg.max ?? 14);
  const placed  = new Set(['0,0']);

  while (frontier.length > 0 && placed.size < TARGET) {
    const fi = rng(0, frontier.length - 1);
    const { x, y, required, parentGid, parentDir } = frontier.splice(fi, 1)[0];
    const gid = `${x},${y}`;
    if (placed.has(gid)) continue;

    let cands = genSecs.filter(s => s.passage[required]);
    if (!cands.length) {
      if (rooms[parentGid]) rooms[parentGid].passages[parentDir] = false;
      continue;
    }

    cands = cands.filter(s => !s.count || (sectionPlacedCount[s.id] ?? 0) < s.count);
    if (!cands.length) {
      if (rooms[parentGid]) rooms[parentGid].passages[parentDir] = false;
      continue;
    }

    const budget = TARGET - placed.size;

    if (frontier.length === 0 && budget > 1) {
      const nonDead = cands.filter(s => Object.values(s.passage).filter(Boolean).length > 1);
      if (nonDead.length) cands = nonDead;
    }

    const forceEnd = budget <= 1 || (budget <= frontier.length && Math.random() < 0.6);
    if (forceEnd && deadEndSecs.some(s => s.passage[required])) {
      const deadCands = cands.filter(s => Object.values(s.passage).filter(Boolean).length === 1);
      if (deadCands.length) cands = deadCands;
    }

    const pendingAlways = cands.filter(s => s.always && !(sectionPlacedCount[s.id] ?? 0));
    if (pendingAlways.length) cands = pendingAlways;

    const sec      = cands[rng(0, cands.length - 1)];
    sectionPlacedCount[sec.id] = (sectionPlacedCount[sec.id] ?? 0) + 1;
    const passages = { ...sec.passage };

    rooms[gid] = {
      gid, x, y, type: 'normal',
      image: sec.image,
      preview: sectionPreview(sec),
      passages,
      objects: [], mob: null, npc: null, discovered: false,
      ..._buildScavengeState(sec),
      _mobChance:         sec.chance_spawn_mob    ?? null,
      _mobIds:            sec.spawn_mob           ?? [],
      _spawnObjects:      sec.spawn_object        ?? [],
      _chanceSpawnObject: sec.chance_spawn_object ?? null,
      _objectWeight:      0,
      _npcChance:  sec.chance_spawn_npc  ?? 0,
      _npcIds:     sec.spawn_npc         ?? [],
      _bossChance: sec.chance_spawn_boss ?? 0,
      _bossIds:    sec.spawn_boss        ?? []
    };
    placed.add(gid);

    for (const [dir, open] of Object.entries(passages)) {
      if (!open || dir === required) continue;
      const [dx, dy] = DELTA[dir];
      const nx = x + dx, ny = y + dy;
      if (!placed.has(`${nx},${ny}`)) {
        frontier.push({ x: nx, y: ny, required: OPP[dir], parentGid: gid, parentDir: dir });
      }
    }
  }

  for (const { parentGid, parentDir } of frontier) {
    const r = rooms[parentGid];
    if (!r) continue;
    r.passages[parentDir] = false;
    if (r.type !== 'spawn') { const s = pickSection(r.passages, false, level); r.image = s?.image ?? 'block/1/block_[t_b_l_r].png'; r.preview = sectionPreview(s); }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [gid, room] of Object.entries(rooms)) {
      if (room.type !== 'spawn' && !Object.values(room.passages).some(Boolean)) {
        delete rooms[gid];
        changed = true;
        continue;
      }
      for (const dir of ['left', 'right', 'top', 'bottom']) {
        if (!room.passages[dir]) continue;
        const [dx, dy] = DELTA[dir];
        const nbr = rooms[`${room.x + dx},${room.y + dy}`];
        if (!nbr || !nbr.passages[OPP[dir]]) {
          room.passages[dir] = false;
          if (room.type !== 'spawn') { const s = pickSection(room.passages, false, level); room.image = s?.image ?? 'block/1/block_[t_b_l_r].png'; room.preview = sectionPreview(s); }
          changed = true;
        }
      }
    }
  }

  const nonSpawn  = Object.values(rooms).filter(r => r.type !== 'spawn');
  const deadEnds  = nonSpawn.filter(r =>
    Object.values(r.passages).filter(Boolean).length === 1
  );
  const anyNormal = nonSpawn.length ? nonSpawn : Object.values(rooms);

  const doorDef    = pickObjectDef('door_area', level, true);
  const doorObjId  = doorDef?.id ?? 'door1';
  const doorWeight = doorDef?.weight ?? 1;
  const basePool   = deadEnds.length ? deadEnds : anyNormal;
  const doorFiltered = basePool.filter(r => r._spawnObjects?.includes(doorObjId));
  const doorPool   = doorFiltered.length ? doorFiltered : basePool;
  const doorRoom   = doorPool.reduce((best, r) =>
    (Math.abs(r.x) + Math.abs(r.y)) > (Math.abs(best.x) + Math.abs(best.y)) ? r : best
  );
  doorRoom.type = 'door_area';
  doorRoom._objectWeight += doorWeight;
  doorRoom.objects.push({
    instanceId: uid(), defId: doorObjId,
    name: t('objects', doorObjId, 'name', doorDef?.name ?? 'Дверь'), image: doorDef?.image ?? 'door.png',
    action: 'door', locked: true
  });

  const keyDef    = pickObjectDef('key_area', level, true);
  const keyObjId  = keyDef?.id ?? 'key_dor1';
  const keyWeight = keyDef?.weight ?? 0.5;
  const keyBase   = deadEnds.filter(r => r !== doorRoom);
  const keyFiltered = keyBase.filter(r => r._spawnObjects?.includes(keyObjId));
  const keyEligible = (keyFiltered.length ? keyFiltered : keyBase)
    .filter(r => r._objectWeight + keyWeight <= 1);
  const keyRoom = keyEligible.length
    ? keyEligible[rng(0, keyEligible.length - 1)]
    : anyNormal.find(r => r !== doorRoom && r._objectWeight + keyWeight <= 1) ?? null;
  if (keyRoom) {
    keyRoom.type = 'key_area';
    keyRoom._objectWeight += keyWeight;
    keyRoom.objects.push({
      instanceId: uid(), defId: keyObjId,
      name: t('objects', keyObjId, 'name', keyDef?.name ?? 'Ключ от двери'), image: keyDef?.image ?? 'key.png',
      action: keyDef?.action ?? 'pickup',
      items: keyDef?.items ?? [{ id: 'key_door_inventory', count: 1 }]
    });
  }

  for (const aSec of genSecs.filter(s => s.always)) {
    if ((sectionPlacedCount[aSec.id] ?? 0) > 0) continue;
    const pool = nonSpawn.filter(r => r !== doorRoom && r !== keyRoom);
    const exact  = pool.filter(r => ['left','right','top','bottom'].every(d => !!r.passages[d] === !!aSec.passage[d]));
    const compat = exact.length ? exact : pool.filter(r => ['left','right','top','bottom'].every(d => !r.passages[d] || aSec.passage[d]));
    if (!compat.length) continue;
    const target = compat[rng(0, compat.length - 1)];
    target.image      = aSec.image;
    target.preview    = sectionPreview(aSec);
    target._mobChance         = aSec.chance_spawn_mob    ?? null;
    target._mobIds            = aSec.spawn_mob           ?? [];
    target._spawnObjects      = aSec.spawn_object        ?? [];
    target._chanceSpawnObject = aSec.chance_spawn_object ?? null;
    target._npcChance         = aSec.chance_spawn_npc    ?? 0;
    target._npcIds            = aSec.spawn_npc           ?? [];
    target._bossChance        = aSec.chance_spawn_boss   ?? 0;
    target._bossIds           = aSec.spawn_boss          ?? [];
    sectionPlacedCount[aSec.id] = 1;
  }

  const spawnableDefs = OBJECTS.filter(o =>
    o.type !== 'door_area' && o.type !== 'key_area' && levelMatches(o.level, level)
  );
  const seenDef = new Set();
  for (const def of spawnableDefs) {
    if (seenDef.has(def.id)) continue;
    seenDef.add(def.id);
    const objWeight = def.weight ?? 0.5;
    const eligible = nonSpawn
      .filter(r => r !== doorRoom && r !== keyRoom)
      .filter(r => r._spawnObjects?.includes(def.id))
      .filter(r => r._objectWeight + objWeight <= 1)
      .sort(() => Math.random() - 0.5);
    if (!eligible.length) continue;
    const [minSpawn, maxSpawn] = parseSpawnRange(def.spawn, [1, 1]);
    const spawnTarget = rng(minSpawn, maxSpawn);
    let placed = 0;
    for (const room of eligible) {
      if (placed >= spawnTarget) break;
      const chance = room._chanceSpawnObject ?? 0.3;
      if (Math.random() > chance) continue;
      const objData = {
        instanceId: uid(), defId: def.id,
        name: t('objects', def.id, 'name', def.name), image: def.image,
        action: def.action, items: def.items ?? []
      };
      if (def.action === 'chest') objData.opened = false;
      room.objects.push(objData);
      room._objectWeight += objWeight;
      placed++;
    }
  }
  for (const room of Object.values(rooms)) {
    delete room._spawnObjects;
    delete room._chanceSpawnObject;
    delete room._objectWeight;
  }

  const defaultMobChance = { normal: 0.45, key_area: 0.55, door_area: 0 };
  for (const room of nonSpawn) {
    const chance = room.type === 'door_area' ? 0
      : (room._mobChance ?? defaultMobChance[room.type] ?? 0.4);
    const mobIds = room._mobIds ?? [];
    delete room._mobChance;
    delete room._mobIds;
    if (Math.random() < chance)
      room.mob = spawnMob(level, mobIds.length ? mobIds : null, ctx);
  }

  const npcSpawnCount = {};
  for (const room of Object.values(rooms)) {
    const npcChance = room._npcChance ?? 0;
    const npcIds    = room._npcIds    ?? [];
    delete room._npcChance;
    delete room._npcIds;
    if (room.mob || room.type === 'door_area' || room.type === 'spawn' || !npcChance || !npcIds.length) continue;
    if (Math.random() >= npcChance) continue;
    const deadNpcIds = ctx?.player?.deadNpcIds ?? [];
    const eligibleIds = npcIds.filter(id => {
      const base = NPCS.find(n => n.id === id);
      return base && levelMatches(base.level, dungeonLevel)
        && (npcSpawnCount[id] ?? 0) < (base.count_spawn_level ?? 1)
        && !deadNpcIds.includes(id);
    });
    if (!eligibleIds.length) continue;
    const npc = spawnNpc(dungeonLevel, eligibleIds);
    if (npc) { room.npc = npc; npcSpawnCount[npc.defId] = (npcSpawnCount[npc.defId] ?? 0) + 1; }
  }

  // ── Section boss spawn ────────────────────────────────────────────────────
  const bossSpawnCountG = {};
  for (const room of Object.values(rooms)) {
    const bossChance = room._bossChance ?? 0;
    const bossIds    = room._bossIds    ?? [];
    delete room._bossChance; delete room._bossIds;
    if (room.mob || room.npc || !bossChance || !bossIds.length) continue;
    if (Math.random() >= bossChance) continue;
    const eligibleIds = bossIds.filter(id => {
      const base = BOSSES.find(b => b.id === id);
      return base && levelMatches(base.level, dungeonLevel)
        && (bossSpawnCountG[id] ?? 0) < (base.count_spawn_level ?? 1);
    });
    if (!eligibleIds.length) continue;
    const id   = eligibleIds[rng(0, eligibleIds.length - 1)];
    const boss = spawnBoss(id, dungeonLevel);
    if (boss) { room.mob = boss; bossSpawnCountG[id] = (bossSpawnCountG[id] ?? 0) + 1; }
  }

  // ── Door boss spawn ───────────────────────────────────────────────────────
  const bossListG = getDungeonLevelCfg(dungeonLevel).boss ?? [];
  for (const bossEntry of bossListG) {
    if (bossEntry.action === 'door') {
      const doorRoom = Object.values(rooms).find(r => r.type === 'door_area');
      if (doorRoom && !doorRoom.mob) {
        doorRoom.mob = spawnBoss(bossEntry.id, dungeonLevel);
      }
    }
  }

  // ── min_mob guarantee ─────────────────────────────────────────────────────
  const minMob = lvlCfg.min_mob ?? 0;
  if (minMob > 0) {
    const currentCount = Object.values(rooms).filter(r => r.mob).length;
    if (currentCount < minMob) {
      const eligible = nonSpawn
        .filter(r => !r.mob && r.type !== 'door_area')
        .sort(() => Math.random() - 0.5);
      let needed = minMob - currentCount;
      for (const room of eligible) {
        if (needed <= 0) break;
        const mob = spawnMob(level, null, ctx);
        if (mob) { room.mob = mob; needed--; }
      }
    }
  }

  return rooms;
}

module.exports = { pickSection, sectionPreview, loadPreMadeMap, generateDungeon };
