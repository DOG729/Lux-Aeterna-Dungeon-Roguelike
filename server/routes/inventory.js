'use strict';
const router = require('express').Router();
const { ALL_SKILLS, CORE }                              = require('../engine/data');
const { clamp }                                         = require('../engine/helpers');
const { itemDef, addToInventory, removeFromInventory } = require('../engine/items');
const { recalcStats }                                  = require('../engine/player');
const { state, saveSessionAuto, pubSession }            = require('../engine/session');
const { t }                                             = require('../engine/translation');

// Returns ordered slot keys that accept items with the given equip code.
// code defaults to slot key when the slot has no explicit "code" field.
function slotsForCode(code) {
  const equipment = CORE.mechanics.equipment ?? {};
  return Object.entries(equipment)
    .filter(([key, cfg]) => (cfg.type ?? key) === code)
    .map(([key]) => key);
}

const E  = (key, fb) => t('server', 'errors',   key, fb);
const UI = (key, fb) => t('server', 'use_item', key, fb);

// Strips optional "treeKey:skillId" prefix from cross-tree requires references
const TREE_KEYS = new Set(['battle', 'survival', 'magic']);
function _resolveSkillId(ref) {
  const col = ref.indexOf(':');
  if (col === -1) return ref;
  const prefix = ref.slice(0, col);
  return TREE_KEYS.has(prefix) ? ref.slice(col + 1) : ref;
}

router.post('/api/equip', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  if (state.session.combat) return res.status(400).json({ error: E('no_equip_in_combat', 'Нельзя менять экипировку в бою') });

  const { itemId } = req.body;
  const player = state.session.player;
  const inv    = player.inventory.find(i => i.id === itemId);
  if (!inv) return res.status(404).json({ error: E('item_not_in_inv', 'Предмет не найден в инвентаре') });

  const def  = itemDef(itemId);
  const code = def?.equip;
  if (!code) return res.status(400).json({ error: E('item_not_equippable', 'Предмет нельзя надеть') });

  const slots = slotsForCode(code);
  if (!slots.length) return res.status(400).json({ error: E('item_not_equippable', 'Предмет нельзя надеть') });

  // Prefer first empty slot; fall back to first slot (swaps current item out)
  const slot = slots.find(s => !player.equip[s]) ?? slots[0];

  if (player.equip[slot]) addToInventory(player, player.equip[slot].id, 1);
  player.equip[slot] = { id: def.id, name: def.name, image: `/assets/item/${def.image}`, stats: def.stats ?? null };
  removeFromInventory(player, itemId, 1);
  recalcStats(player);
  saveSessionAuto();
  res.json(pubSession(state.session));
});

router.post('/api/unequip', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  if (state.session.combat) return res.status(400).json({ error: E('no_equip_in_combat', 'Нельзя менять экипировку в бою') });

  const { slot } = req.body;
  const player   = state.session.player;
  if (!player.equip[slot]) return res.status(400).json({ error: E('slot_empty', 'Слот пуст') });

  addToInventory(player, player.equip[slot].id, 1);
  player.equip[slot] = null;
  recalcStats(player);
  saveSessionAuto();
  res.json(pubSession(state.session));
});

router.post('/api/use-item', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });

  const { itemId } = req.body;
  const player     = state.session.player;
  const def        = itemDef(itemId);
  if (!def?.use)   return res.status(400).json({ error: E('item_not_usable', 'Предмет нельзя использовать') });

  const inCombat = !!state.session.combat;
  const use      = inCombat ? def.use.in_combat : def.use.out_combat;
  if (!use) return res.status(400).json({
    error: inCombat ? E('no_use_in_combat', 'Нельзя использовать в бою') : E('only_in_combat', 'Только в бою')
  });

  if (inCombat && state.session.combat.elixirUsedThisTurn)
    return res.status(400).json({ error: E('elixir_used', 'Эликсир уже использован в этом ходу') });

  const inv = player.inventory.find(i => i.id === itemId);
  if (!inv || inv.count <= 0) return res.status(404).json({ error: E('item_no_stock', 'Нет в инвентаре') });

  let message = '';
  if (use.hp) {
    const healed = clamp(use.hp, 0, player.maxHp - player.hp);
    player.hp = clamp(player.hp + use.hp, 0, player.maxHp);
    message = UI('heal', 'Исцеление: +{hp} HP').replace('{hp}', healed);
  }
  if (use.energy) {
    const restored = clamp(use.energy, 0, player.maxEnergy - player.energy);
    player.energy = clamp(player.energy + use.energy, 0, player.maxEnergy);
    message = UI('energy', 'Энергия: +{en}').replace('{en}', restored); 
  }
  if (inCombat) state.session.combat.elixirUsedThisTurn = true;
  removeFromInventory(player, itemId, 1);
  saveSessionAuto();
  res.json({ message, ...pubSession(state.session) });
});

router.post('/api/skill/learn', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_session', 'Нет сессии') });
  const { player } = state.session;
  const { id } = req.body ?? {};
  if (!id) return res.status(400).json({ error: E('skill_id_required', 'id обязателен') });

  const skill = ALL_SKILLS.find(s => s.id === id);
  if (!skill) return res.status(404).json({ error: E('skill_not_found', 'Навык не найден') });

  player.learnedSkills = player.learnedSkills ?? [];
  if (player.learnedSkills.includes(id))
    return res.status(400).json({ error: E('skill_already_learned', 'Навык уже изучен') });

  const missing = (skill.requires ?? []).filter(r => !player.learnedSkills.includes(_resolveSkillId(r)));
  if (missing.length)
    return res.status(400).json({ error: E('skill_missing_reqs', 'Не выполнены требования: {missing}').replace('{missing}', missing.join(', ')) });

  // requires_or: at least one group must be fully satisfied (each group is AND)
  const requiresOr = skill.requires_or;
  if (requiresOr?.length) {
    const anyMet = requiresOr.some(group =>
      group.every(r => player.learnedSkills.includes(_resolveSkillId(r)))
    );
    if (!anyMet) {
      const desc = requiresOr.map(g => g.join(' + ')).join(' или ');
      return res.status(400).json({ error: E('skill_missing_reqs_or', 'Нужно одно из: {desc}').replace('{desc}', desc) });
    }
  }

  const cost = skill.uses_point ?? 1;
  if ((player.skillPoints ?? 0) < cost)
    return res.status(400).json({ error: E('skill_no_points', 'Недостаточно очков навыков') });

  player.learnedSkills.push(id);
  player.skillPoints = (player.skillPoints ?? 0) - cost;
  recalcStats(player);
  saveSessionAuto();
  res.json({ ok: true, player });
});

module.exports = router;
