'use strict';
const fs     = require('fs');
const router = require('express').Router();
const { SESSION_FILE, NPCS }                                    = require('../engine/data');
const { DELTA }                                                 = require('../engine/helpers');
const { t }                                                     = require('../engine/translation');
const { addToInventory, removeFromInventory, itemDef } = require('../engine/items');
const { recalcStats }                                  = require('../engine/player');
const { spawnNpcCombat }                               = require('../engine/npc');
const { state, saveSessionAuto, clearSessionAuto, newSession,
        hydrateSession, doSave, doLoad, pubSession, addJournal } = require('../engine/session');
const { trackGameStarted, trackFloor } = require('../engine/account');

const E = (key, fb) => t('server', 'errors',  key, fb);
const D = (key, fb) => t('ui',     'dungeon',  key, fb);

router.get('/api/session', (_req, res) => {
  if (state.session) return res.json({ has: true, ...pubSession(state.session) });
  try {
    const raw = fs.readFileSync(SESSION_FILE, 'utf8');
    state.session = hydrateSession(JSON.parse(raw));
    state.session.player.learnedSkills = state.session.player.learnedSkills ?? [];
    recalcStats(state.session.player);
    return res.json({ has: true, ...pubSession(state.session) });
  } catch {
    return res.json({ has: false });
  }
});

router.post('/api/quit', (_req, res) => {
  state.session = null;
  clearSessionAuto();
  res.json({ ok: true });
});

router.post('/api/new-game', (_req, res) => {
  state.session = newSession(1);
  trackGameStarted();
  saveSessionAuto();
  res.json(pubSession(state.session));
});

router.post('/api/load', (req, res) => {
  try {
    state.session = doLoad(req.body.saveId);
    const p = state.session.player;
    p.learnedSkills = p.learnedSkills ?? [];
    recalcStats(p);
    saveSessionAuto();
    res.json(pubSession(state.session));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/api/save', (_req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  const id = doSave(state.session);
  res.json({ ok: true, saveId: id });
});

router.post('/api/move', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  if (state.session.combat) return res.status(400).json({ error: E('combat_active', 'Идёт бой') });

  const { direction } = req.body;
  const cur = state.session.dungeon.rooms[state.session.dungeon.playerPos];
  if (!cur.passages[direction]) return res.status(400).json({ error: E('no_passage', 'Нет прохода') });

  const [dx, dy] = DELTA[direction];
  const nGid = `${cur.x + dx},${cur.y + dy}`;
  const next = state.session.dungeon.rooms[nGid];
  if (!next) return res.status(400).json({ error: E('room_not_found', 'Комната не найдена') });

  next.discovered = true;
  state.session.dungeon.playerPos = nGid;

  let combatant = next.mob;

  // NPC "on_sight" aggro — see roadmap/npc_combat.md §4
  if (!combatant && next.npc && !next.npc.defeated) {
    const npcDef   = NPCS.find(n => n.id === next.npc.defId);
    const combatCfg = npcDef?.npc_combat ? npcDef.combat : null;
    const relOk = combatCfg?.aggro_relationship_below == null
      || (next.npc.relationship ?? 0) <= combatCfg.aggro_relationship_below;
    if (combatCfg?.aggro === 'on_sight' && relOk) {
      combatant = spawnNpcCombat(next.npc, state.session.dungeon.level, { player: state.session.player });
    }
  }

  if (combatant) {
    state.session.combat = { mob: combatant, history: [], turn: 0, sessionId: require('crypto').randomUUID(), chatLog: [], narratorText: null };
    state.session.player.abilityCooldowns = {};
    state.session.player.mobsEncountered = (state.session.player.mobsEncountered ?? 0) + 1;
    addJournal(state.session, 'combat',
      t('server', 'journal', 'combat_encounter', 'Встретил {name} (уровень {level})')
        .replace('{name}', combatant.name)
        .replace('{level}', state.session.dungeon.level)
    );
  }

  saveSessionAuto();
  res.json({ ...pubSession(state.session), combatStarted: !!combatant });
});

router.post('/api/interact', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  if (state.session.combat) return res.status(400).json({ error: E('combat_active', 'Идёт бой') });

  const { objectId } = req.body;
  const room = state.session.dungeon.rooms[state.session.dungeon.playerPos];
  const obj  = room.objects.find(o => o.instanceId === objectId);
  if (!obj) return res.status(404).json({ error: E('object_not_found', 'Объект не найден') });

  const { rng } = require('../engine/helpers');
  let message = '';
  let interactType = null;

  if (obj.action === 'pickup' || obj.action === 'items') {
    interactType = 'item';
    for (const item of obj.items ?? []) {
      if (item.id === 'key_door_inventory') {
        state.session.dungeon.hasKey = true;
        addToInventory(state.session.player, 'key_door_inventory', 1);
        message = D('key_pickup', '🗝️ Вы подобрали ключ от двери!');
        interactType = 'key';
      } else {
        const cnt = Array.isArray(item.count) ? rng(item.count[0], item.count[1]) : item.count;
        addToInventory(state.session.player, item.id, cnt);
        const def = itemDef(item.id);
        message = item.id === 'gold'
          ? D('gold_pickup', '🪙 Вы подобрали {count} золота!').replace('{count}', cnt)
          : D('item_pickup', 'Вы подобрали: {name}').replace('{name}', def?.name ?? item.id);
      }
    }
    room.objects = room.objects.filter(o => o.instanceId !== objectId);

  } else if (obj.action === 'chest') {
    interactType = 'chest';
    if (obj.opened) return res.status(400).json({ error: E('chest_opened', 'Сундук уже открыт') });
    obj.opened = true;
    const gained = [];
    for (const item of obj.items ?? []) {
      if (Math.random() > (item.chance ?? 1)) continue;
      const cnt = Array.isArray(item.count) ? rng(item.count[0], item.count[1]) : item.count;
      addToInventory(state.session.player, item.id, cnt);
      const def = itemDef(item.id);
      gained.push(item.id === 'gold'
        ? `${cnt} ${D('gold_label', 'золота')}`
        : `${def?.name ?? item.id} ×${cnt}`);
    }
    message = gained.length
      ? D('chest_open',  '📦 Сундук открыт! Найдено: {items}.').replace('{items}', gained.join(', '))
      : D('chest_empty', '📦 Сундук пуст.');

  } else if (obj.action === 'door') {
    if (!state.session.dungeon.hasKey)
      return res.status(400).json({ error: E('need_key', '🔒 Нужен ключ от двери!') });
    removeFromInventory(state.session.player, 'key_door_inventory', 1);
    const nextLevel   = state.session.dungeon.level + 1;
    const prevJournal = state.session.journal ?? [];
    const old = { ...state.session.player };
    state.session = newSession(nextLevel, old, prevJournal);
    state.session.player.level = nextLevel;
    trackFloor(nextLevel);
    addJournal(state.session, 'event',
      t('server', 'journal', 'next_floor', 'Переход на этаж {level}')
        .replace('{level}', nextLevel)
    );
    saveSessionAuto();
    return res.json({ levelUp: true, newLevel: nextLevel, interactType: 'door', ...pubSession(state.session) });
  }

  saveSessionAuto();
  res.json({ message, interactType, ...pubSession(state.session) });
});

module.exports = router;
