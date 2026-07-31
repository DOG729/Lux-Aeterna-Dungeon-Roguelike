'use strict';
const router = require('express').Router();
const { SCAVENGE, CORE, MEDIA, ACHIEVEMENTS }      = require('../engine/data');
const { state, saveSessionAuto, pubSession }       = require('../engine/session');
const { addToInventory, removeFromInventory }      = require('../engine/items');
const { grantAchievement, account }               = require('../engine/account');
const { recalcStats }                             = require('../engine/player');
const { t }                                        = require('../engine/translation');
const { evalAll, applySet }                        = require('../engine/conditions');

const E  = (key, fb) => t('server', 'errors', key, fb);

function resolveSceneSound(scene) {
  const s = scene.sound;
  if (!s) return null;
  if (/\.(mp3|wav|ogg)$/i.test(s)) return `/assets/sound/${s}`;
  const entry = MEDIA?.sound?.[s];
  if (!entry) return null;
  const src = typeof entry === 'string' ? entry : entry?.src ?? null;
  return src ? `/assets/sound/${src}` : null;
}
// Try explicit _key field first, then auto-lookup by obj.id+field, then raw value
const ST = (obj, field, keyField) =>
  (keyField && obj[keyField] ? t('scavenge', obj.id, keyField.replace('_key',''), null) : null)
  ?? t('scavenge', obj.id, field, null)
  ?? obj[field] ?? null;

function tTask(scene, task) {
  const key = task.text_key ? task.text_key.split('.').pop() : null;
  return key ? t('scavenge', scene.id, key, task.text) : (task.text ?? '');
}

function resolveActiveTasks(scene, completedTasks, scriptActivated) {
  if (!scene.tasks) return [];
  const done      = new Set(completedTasks ?? []);
  const activated = new Set(scriptActivated ?? []);
  for (const [id, task] of Object.entries(scene.tasks)) {
    if (done.has(id) && task.activation) {
      for (const aid of task.activation) activated.add(aid);
    }
  }
  const result = [];
  for (const [id, task] of Object.entries(scene.tasks)) {
    if (done.has(id)) continue;
    if (task.start_active === false && !activated.has(id)) continue;
    result.push({ id, text: tTask(scene, task) });
  }
  return result;
}

function processTasks(scene, sc, objectId) {
  if (!scene.tasks) return { completed: [], activated: [] };
  if (!sc.completedTasks) sc.completedTasks = [];
  const completed = [];
  const activated = [];
  for (const [taskId, task] of Object.entries(scene.tasks)) {
    if (task.trigger !== objectId) continue;
    if (sc.completedTasks.includes(taskId)) continue;
    sc.completedTasks.push(taskId);
    completed.push(taskId);
    if (task.activation) {
      for (const aid of task.activation) {
        if (sc.completedTasks.includes(aid)) continue;
        const at = scene.tasks[aid];
        if (!at || at.start_active !== false) continue; // only newly activated ones
        activated.push({ id: aid, text: tTask(scene, at) });
      }
    }
  }
  return { completed, activated };
}

function applySceneScript(scene, sc, ctx) {
  if (!Array.isArray(scene.script) || !scene.script.length) return false;
  let changed = false;
  for (const entry of scene.script) {
    if (!evalAll(entry.if ?? [], ctx)) continue;
    for (const objId of (entry.remove ?? [])) {
      if (sc.removedObjects.includes(objId)) continue;
      sc.removedObjects.push(objId);
      processTasks(scene, sc, objId);
      changed = true;
    }
    for (const taskId of (entry.complete ?? [])) {
      if (sc.completedTasks.includes(taskId)) continue;
      sc.completedTasks.push(taskId);
      changed = true;
    }
    for (const taskId of (entry.activate ?? [])) {
      const task = scene.tasks?.[taskId];
      if (!task || sc.completedTasks.includes(taskId)) continue;
      // mark as explicitly activated so resolveActiveTasks shows it
      sc.activatedTasks = sc.activatedTasks ?? [];
      if (!sc.activatedTasks.includes(taskId)) { sc.activatedTasks.push(taskId); changed = true; }
    }
  }
  return changed;
}

function currentRoom(sess) {
  return sess?.dungeon?.rooms?.[sess.dungeon.playerPos] ?? null;
}

// GET /api/scavenge/scene — returns scene definition + room scavenge state
router.get('/api/scavenge/scene', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  if (!CORE.scavenge_system?.active) return res.status(403).json({ error: 'Scavenge disabled' });

  const room = currentRoom(state.session);
  if (!room?.scavenge) return res.status(404).json({ error: 'Нет сцены в этой комнате' });

  const scene = SCAVENGE[room.scavenge.scene];
  if (!scene) return res.status(404).json({ error: 'Сцена не найдена' });

  const sc = room.scavenge;
  if (applySceneScript(scene, sc, state.session)) saveSessionAuto();

  const helpText = scene.help_text
    ? t('scavenge', scene.id, 'help_text', scene.help_text)
    : null;
  const soundSrc   = resolveSceneSound(scene);
  const activeTasks = resolveActiveTasks(scene, sc.completedTasks, sc.activatedTasks);

  // Filter objects by their `if` condition (evaluated each request, not stored)
  const visibleObjects = (scene.objects ?? []).filter(
    obj => !obj.if || evalAll(obj.if, state.session)
  );
  const filteredScene = { ...scene, objects: visibleObjects };

  // Build translated hints map { objectId: text }
  const hints = {};
  for (const obj of visibleObjects) {
    if (obj.hint) hints[obj.id] = t('scavenge', scene.id, obj.id + '_hint', obj.hint);
  }

  res.json({ scene: filteredScene, helpText, soundSrc, activeTasks, state: sc, hints });
});

// POST /api/scavenge/interact — interact with an object in the scene
router.post('/api/scavenge/interact', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });

  const { objectId } = req.body;
  const room  = currentRoom(state.session);
  const sc    = room?.scavenge;
  if (!sc) return res.status(400).json({ error: 'Нет сцены' });

  const scene = SCAVENGE[sc.scene];
  const obj   = scene?.objects?.find(o => o.id === objectId);
  if (!obj) return res.status(404).json({ error: 'Объект не найден' });

  if (obj.if && !evalAll(obj.if, state.session))
    return res.status(403).json({ error: 'Объект недоступен' });

  if (sc.removedObjects.includes(objectId))
    return res.status(400).json({ error: 'Объект уже взаимодействован' });

  const result = { state: sc };

  if (obj.type === 'exit') {
    const cond = obj.condition;
    const failText = () =>
      ST(obj, 'condition_fail_text', 'condition_fail_text_key')
      ?? t('ui', 'scavenge', 'cannot_exit', 'Нельзя выйти');

    if (cond?.required_removed?.length) {
      const missing = cond.required_removed.filter(id => !sc.removedObjects.includes(id));
      if (missing.length)
        return res.json({ exit: false, conditionFailed: true, conditionText: failText() });
    }
    if (cond?.required_use?.length) {
      const missing = cond.required_use.filter(id => !(sc.usedObjects ?? []).includes(id));
      if (missing.length)
        return res.json({ exit: false, conditionFailed: true, conditionText: failText() });
    }
    processTasks(scene, sc, objectId);
    sc.visited = true;
    saveSessionAuto();
    return res.json({ exit: true, ...pubSession(state.session) });
  }

  if (obj.type === 'item' || obj.type === 'examine') {
    if (obj.remove) {
      sc.removedObjects.push(objectId);
      result.removed = true;
    }
    if (obj.add_item?.length) {
      for (const itemId of obj.add_item) addToInventory(state.session.player, itemId, 1);
    }
    if (obj.scene_change) {
      sc.currentImage = obj.scene_change + '.jpg';
      result.sceneChange = true;
    }
    // Text: own field first, then use.text_key, then use.text
    result.text = ST(obj, 'text', 'text_key')
      ?? (obj.use?.text_key ? t('scavenge', scene.id, obj.use.text_key.split('.').pop(), null) : null)
      ?? obj.use?.text ?? null;

    // Achievement grant
    const achId = obj.use?.grant_achievement;
    if (achId) {
      const granted = grantAchievement(achId);
      if (granted) {
        const def = ACHIEVEMENTS.find(a => a.id === achId);
        const player = state.session.player;
        if (def?.type === 'point') {
          player.skillPoints = (player.skillPoints ?? 0) + (def.int ?? 0);
        } else if (def?.type === 'stats') {
          const oldMaxHp = player.maxHp, oldMaxEnergy = player.maxEnergy;
          recalcStats(player);
          const hpGain     = player.maxHp     - oldMaxHp;
          const energyGain = player.maxEnergy - oldMaxEnergy;
          if (hpGain     > 0) player.hp     = Math.min(player.hp     + hpGain,     player.maxHp);
          if (energyGain > 0) player.energy = Math.min(player.energy + energyGain, player.maxEnergy);
        }
        result.grantedAchievement = { id: achId, name: def?.name ?? achId, description: def?.description ?? '' };
        const sess = pubSession(state.session);
        if (sess) result.player = sess.player;
      }
    }
  }

  const taskResult = processTasks(scene, sc, objectId);
  if (taskResult.completed.length)  result.completedTasks  = taskResult.completed;
  if (taskResult.activated.length)  result.activatedTasks  = taskResult.activated;

  if (obj.type === 'npc') {
    const npc = state.session.dungeon.rooms[state.session.dungeon.playerPos]?.npc;
    if (npc) result.npcOpen = true, result.npcInstanceId = npc.instanceId;
  }

  result.state = sc;
  saveSessionAuto();
  res.json(result);
});

// POST /api/scavenge/open-event — trigger scavenge from an event (trigger type 1)
router.post('/api/scavenge/open-event', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });

  const { sceneId } = req.body;
  const scene = SCAVENGE[sceneId];
  if (!scene) return res.status(404).json({ error: 'Сцена не найдена' });

  const room = currentRoom(state.session);
  if (!room) return res.status(400).json({ error: 'Нет комнаты' });

  if (!room.scavenge) {
    room.scavenge = { scene: sceneId, autoOpen: false, removedObjects: [], usedObjects: [], completedTasks: [], activatedTasks: [], currentImage: null, visited: false };
  }
  saveSessionAuto();
  res.json({ scene, state: room.scavenge });
});

// POST /api/scavenge/use — intentional "use" interaction with an object
router.post('/api/scavenge/use', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });

  const { objectId } = req.body;
  const room  = currentRoom(state.session);
  const sc    = room?.scavenge;
  if (!sc) return res.status(400).json({ error: 'Нет сцены' });

  // Lazy-init new state fields for saves created before this version
  sc.usedObjects    = sc.usedObjects    ?? [];
  sc.activatedTasks = sc.activatedTasks ?? [];

  const scene = SCAVENGE[sc.scene];
  const obj   = scene?.objects?.find(o => o.id === objectId);
  if (!obj) return res.status(404).json({ error: 'Объект не найден' });

  if (obj.if && !evalAll(obj.if, state.session))
    return res.status(403).json({ error: 'Объект недоступен' });

  const useDef = obj.use;
  if (!useDef) return res.status(400).json({ error: 'Объект не поддерживает use' });

  const player = state.session.player;

  // ── Condition checks ──────────────────────────────────────────────────────
  const failText = (key, fb) =>
    (useDef.fail_text_key ? t('scavenge', scene.id, useDef.fail_text_key.split('.').pop(), null) : null)
    ?? useDef.fail_text ?? null;

  if (useDef.if?.length && !evalAll(useDef.if, state.session))
    return res.json({ blocked: true, reason: 'condition', failText: failText() });

  if (useDef.require_item?.length) {
    const missing = useDef.require_item.filter(id =>
      !player.inventory.some(i => i.id === id && i.count > 0)
    );
    if (missing.length)
      return res.json({ blocked: true, reason: 'items', missing, failText: failText() });
  }

  if (useDef.require_removed?.length) {
    const missing = useDef.require_removed.filter(id => !sc.removedObjects.includes(id));
    if (missing.length)
      return res.json({ blocked: true, reason: 'removed', missing, failText: failText() });
  }

  if (useDef.require_used?.length) {
    const missing = useDef.require_used.filter(id => !sc.usedObjects.includes(id));
    if (missing.length)
      return res.json({ blocked: true, reason: 'used', missing, failText: failText() });
  }

  // ── Apply effects ─────────────────────────────────────────────────────────
  for (const id of (useDef.consume_item ?? []))
    removeFromInventory(player, id, 1);

  for (const id of (useDef.remove ?? [])) {
    if (!sc.removedObjects.includes(id)) {
      sc.removedObjects.push(id);
      processTasks(scene, sc, id);
    }
  }

  if (useDef.scene_change)
    sc.currentImage = useDef.scene_change + (useDef.scene_change.endsWith('.jpg') ? '' : '.jpg');

  for (const id of (useDef.complete ?? [])) {
    if (!sc.completedTasks.includes(id)) sc.completedTasks.push(id);
  }

  for (const id of (useDef.activate ?? [])) {
    if (!sc.activatedTasks.includes(id)) sc.activatedTasks.push(id);
  }

  if (useDef.set) applySet(useDef.set, state.session);

  // Mark object as used (only once per scene reset — idempotent if re-used)
  if (!sc.usedObjects.includes(objectId)) sc.usedObjects.push(objectId);

  // Process task triggers for this object
  const taskResult = processTasks(scene, sc, objectId);

  saveSessionAuto();

  const result = {
    ok:   true,
    text: (useDef.text_key
      ? t('scavenge', scene.id, useDef.text_key.split('.').pop(), null)
      : null) ?? useDef.text ?? null,
    state: sc,
  };
  if (useDef.sound)               result.sound            = useDef.sound;
  if (useDef.event)               result.event            = useDef.event;
  if (useDef.scene_change)        result.sceneChange      = sc.currentImage;
  if (taskResult.completed.length) result.completedTasks  = taskResult.completed;
  if (taskResult.activated.length) result.activatedTasks  = taskResult.activated;

  res.json(result);
});

module.exports = router;
