'use strict';
const { ITEMS, OBJECTS } = require('./data');
const { rng, levelMatches } = require('./helpers');
const { t } = require('./translation');

function itemDef(id) {
  return ITEMS.find(i => i.id === id) ?? null;
}

function addToInventory(player, id, count) {
  if (id === 'gold') { player.gold = (player.gold ?? 0) + count; return; }
  const def = itemDef(id);
  const existing = player.inventory.find(i => i.id === id);
  if (existing) { existing.count += count; return; }
  player.inventory.push({
    id, count,
    name:         t('items', id, 'name', def?.name ?? id),
    image:        def?.image ? `/assets/item/${def.image}` : '',
    equip:        def?.equip ?? false,
    use:          def?.use   ?? null,
    stats:        def?.stats ?? null,
    price_sell:   def?.price_sell ?? 0,
    inventoryBar: def?.['inventorybar'] ?? def?.['inventory-bar'] ?? false
  });
}

function removeFromInventory(player, id, count = 1) {
  const it = player.inventory.find(i => i.id === id);
  if (!it) return;
  it.count -= count;
  if (it.count <= 0) player.inventory = player.inventory.filter(i => i.id !== id);
}

function pickObjectDef(type, dungeonLevel, withFallback = true) {
  const matching = OBJECTS.filter(o => o.type === type && levelMatches(o.level, dungeonLevel));
  if (matching.length) return matching[rng(0, matching.length - 1)];
  if (!withFallback) return null;
  for (let l = dungeonLevel - 1; l >= 1; l--) {
    const fb = OBJECTS.filter(o => o.type === type && levelMatches(o.level, l));
    if (fb.length) return fb[rng(0, fb.length - 1)];
  }
  return null;
}

function parseSpawnRange(val, def = [1, 3]) {
  if (typeof val === 'string' && val.includes('-')) {
    const [a, b] = val.split('-').map(Number);
    return [a, b];
  }
  if (typeof val === 'number') return [val, val];
  return def;
}

module.exports = {
  itemDef, addToInventory, removeFromInventory,
  pickObjectDef, parseSpawnRange
};
