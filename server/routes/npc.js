'use strict';
const router = require('express').Router();
const { cfg, NPCS }                                    = require('../engine/data');
const { itemDef, addToInventory, removeFromInventory } = require('../engine/items');
const { pubNpc, npcSystempromt, parseNpcReply, lookupLore, npcLoreTopics,
        npcInCurrentRoom, spawnNpcCombat, dreamAboutEncounter } = require('../engine/npc');
const { aiChat, isToolsSupported }                     = require('../engine/ai');
const { buildSingleParamTool, runToolTurn }            = require('../engine/tools');
const { state, saveSessionAuto, addJournal, pubSession } = require('../engine/session');
const { trackNpcMet } = require('../engine/account');
const { t }                                            = require('../engine/translation');

const E  = (key, fb) => t('server', 'errors',      key, fb);
const CL = (key, fb) => t('server', 'combat_log',  key, fb);
const N  = (key, fb) => t('server', 'npc_system',  key, fb);

// Trims from the oldest, always removing a WHOLE turn (the leading 'user' message
// through the next 'user' message, exclusive) — a tool_call/tool_result pair kept
// for a "remember: true" lore lookup makes some turns 3-4 messages instead of the
// usual 2, so a naive fixed-size splice(0,2) could orphan a 'tool' message at the
// front without its preceding assistant tool_calls owner. See knows_lore's
// `remember` flag in docs/manifests.md.
function _trimNpcHistory(npc, maxLen = 20) {
  while (npc.history.length > maxLen) {
    let cut = 1;
    while (cut < npc.history.length && npc.history[cut].role !== 'user') cut++;
    npc.history.splice(0, cut);
  }
}

router.post('/api/npc/interact', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  if (state.session.combat) return res.status(400).json({ error: E('combat_active', 'Идёт бой') });
  const npc = npcInCurrentRoom(state.session, req.body.npcInstanceId);
  if (!npc) return res.status(404).json({ error: E('npc_not_found', 'NPC не найден') });
  if (!npc.metTracked) { npc.metTracked = true; trackNpcMet(npc.defId); }
  res.json({ npc: pubNpc(npc) });
});

router.post('/api/npc/chat', async (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  if (state.session.combat) return res.status(400).json({ error: E('combat_active', 'Идёт бой') });
  const npc = npcInCurrentRoom(state.session, req.body.npcInstanceId);
  if (!npc) return res.status(404).json({ error: E('npc_not_found', 'NPC не найден') });

  if (npc.messageCount >= npc.maxMessages)
    return res.json({ reply: npc.messageIgnores, exhausted: true, messageCount: npc.messageCount });

  const { message } = req.body;
  const npcDef      = NPCS.find(n => n.id === npc.defId);
  const jsonMode    = cfg.provider === 'openrouter' ? cfg.openrouterJsonMode : cfg.ollamaJsonMode;
  const loreTopics  = npcLoreTopics(npcDef, state.session);

  async function runJsonModeLore(userMsg) {
    const sysPmt = { role: 'system', content: npcSystempromt(npc, jsonMode, npcDef, false, state.session) };
    let rawRep       = await aiChat([sysPmt, ...npc.history, userMsg], jsonMode);
    let parsed       = parseNpcReply(rawRep, jsonMode);
    let speech        = parsed.speech;
    let rawForHistory = rawRep;
    let extraHistory  = [];

    // Conditional lore lookup (JSON-mode fallback) — at most one extra round-trip,
    // and only for a topic currently available to this NPC (loreTopics — already
    // filtered by knows_lore + `if`). A hallucinated/stale key from the model is
    // silently ignored (falls through to the first-pass speech instead of erroring).
    const topicEntry = parsed.loreTopic && loreTopics.find(e => e.id === parsed.loreTopic);
    if (topicEntry) {
      const loreText = lookupLore(topicEntry.id);
      if (loreText) {
        const loreMsg = { role: 'system', content: `${N('lore_context_header', 'Дополнительные знания по теме (используй в ответе, но не пересказывай дословно):')}\n${loreText}` };
        const rawRep2 = await aiChat([sysPmt, loreMsg, ...npc.history, userMsg], jsonMode);
        speech        = parseNpcReply(rawRep2, jsonMode).speech;
        rawForHistory = rawRep2;
        // remember (default true): keep the lore context in the LIVE chat history
        // for the rest of this session, so a follow-up question doesn't need
        // another round-trip — not the long-term cross-session npc.memory system.
        if (topicEntry.remember) extraHistory = [loreMsg];
      }
    }
    return { speech, rawForHistory, extraHistory };
  }

  // Native tools only when this NPC has something to look up AND the AI-system
  // startup check (see server/routes/ai.js's /api/ai-check, client's ai_check.js —
  // "Проверка AI-системы…") already confirmed this model/provider supports tool
  // calling this session. No re-probing here — the check is a deliberate one-shot
  // gate, not something to silently re-attempt mid-conversation.
  const useTools = loreTopics.length > 0 && isToolsSupported(cfg);

  try {
    const userMsg = { role: 'user', content: (message ?? '').trim().slice(0, 255) || '...' };
    let speech, rawForHistory, extraHistory = [];

    if (useTools) {
      const sysPmt = { role: 'system', content: npcSystempromt(npc, false, npcDef, true, state.session) };
      const toolSchema = buildSingleParamTool({
        name:              'lore_lookup',
        description:       N('lore_tool_description', 'Look up background knowledge on a specific lore topic you might know about.'),
        paramName:         'topic',
        paramDescription:  loreTopics.map(e => `"${e.id}": ${e.description}`).join('; '),
        options:           loreTopics.map(e => e.id)
      });
      const { content, used, toolExchange } = await runToolTurn({
        messages:  [sysPmt, ...npc.history, userMsg],
        toolSchema, paramName: 'topic',
        execute:   async topic => loreTopics.some(e => e.id === topic) ? lookupLore(topic) : null,
        conf: cfg
      });
      speech        = content.trim() || npc.messageIgnores;
      rawForHistory = content;

      // remember (default true): keep the tool_call+tool_result exchange in the
      // LIVE chat history for the rest of this session — otherwise the model
      // "forgets" it already looked this up the very next message. used can hold
      // several topics if the model batched multiple lookups in one turn — keep
      // the (single, combined) exchange if ANY of them wants to be remembered.
      const usedEntries = used.map(id => loreTopics.find(e => e.id === id)).filter(Boolean);
      if (usedEntries.some(e => e.remember) && toolExchange) extraHistory = toolExchange;
    } else {
      ({ speech, rawForHistory, extraHistory } = await runJsonModeLore(userMsg));
    }

    npc.history.push(userMsg, ...extraHistory, { role: 'assistant', content: rawForHistory });
    _trimNpcHistory(npc);
    npc.messageCount++;
    if (message?.trim()) addJournal(state.session, 'dialogue', CL('npc_dialogue', 'Вы ({npc}): "{msg}"').replace('{npc}', npc.name).replace('{msg}', message.slice(0, 120)));
    addJournal(state.session, 'dialogue', `${npc.name}: "${speech.slice(0, 120)}"`);
    saveSessionAuto();
    res.json({ reply: speech, exhausted: npc.messageCount >= npc.maxMessages, messageCount: npc.messageCount });
  } catch (err) {
    res.status(500).json({ error: E('ai_error', 'Ошибка AI: {msg}').replace('{msg}', err.message) });
  }
});

// "on_interact" aggro trigger — see roadmap/npc_combat.md §4
router.post('/api/npc/attack', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  if (state.session.combat) return res.status(400).json({ error: E('combat_active', 'Идёт бой') });
  const npc = npcInCurrentRoom(state.session, req.body.npcInstanceId);
  if (!npc) return res.status(404).json({ error: E('npc_not_found', 'NPC не найден') });

  const npcDef = NPCS.find(n => n.id === npc.defId);
  if (!npcDef?.npc_combat) return res.status(400).json({ error: E('npc_not_attackable', 'Этот NPC не боец') });
  if (npc.defeated) return res.status(400).json({ error: E('npc_already_defeated', 'NPC уже повержен') });

  const combatant = spawnNpcCombat(npc, state.session.dungeon.level, { player: state.session.player });
  if (!combatant) return res.status(400).json({ error: E('npc_not_attackable', 'Этот NPC не боец') });

  state.session.combat = { mob: combatant, history: [], turn: 0, sessionId: require('crypto').randomUUID(), chatLog: [], narratorText: null };
  state.session.player.abilityCooldowns = {};
  state.session.player.mobsEncountered = (state.session.player.mobsEncountered ?? 0) + 1;
  addJournal(state.session, 'combat',
    t('server', 'journal', 'combat_encounter', 'Встретил {name} (уровень {level})')
      .replace('{name}', combatant.name)
      .replace('{level}', state.session.dungeon.level)
  );

  saveSessionAuto();
  res.json({ ...pubSession(state.session), combatStarted: true });
});

// Player closed the NPC chat modal — see roadmap/npc_combat.md "dream_ai".
// Fires the async dream (if configured) and returns immediately; the client never
// waits on this, it's fire-and-forget so it can't stall the game.
router.post('/api/npc/close', (req, res) => {
  const npc    = state.session ? npcInCurrentRoom(state.session, req.body.npcInstanceId) : null;
  const npcDef = npc ? NPCS.find(n => n.id === npc.defId) : null;
  if (npcDef?.dream_ai) {
    dreamAboutEncounter(npc, npcDef, {}).then(saveSessionAuto).catch(() => {});
  }
  res.json({ ok: true });
});

router.post('/api/npc/trade/buy', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  if (state.session.combat) return res.status(400).json({ error: E('combat_active', 'Идёт бой') });
  const npc = npcInCurrentRoom(state.session, req.body.npcInstanceId);
  if (!npc) return res.status(404).json({ error: E('npc_not_found', 'NPC не найден') });
  if (npc.type !== 'trader') return res.status(400).json({ error: E('npc_not_trader_buy', 'Этот NPC не торгует') });

  const { itemId } = req.body;
  const shopItem = npc.shop.find(i => i.id === itemId && i.count > 0);
  if (!shopItem) return res.status(404).json({ error: E('item_unavailable', 'Товар недоступен') });

  const { player } = state.session;
  if ((player.gold ?? 0) < shopItem.price)
    return res.status(400).json({ error: E('not_enough_gold', 'Недостаточно золота') });

  player.gold -= shopItem.price;
  addToInventory(player, shopItem.id, 1);
  shopItem.count--;
  if (shopItem.count <= 0) npc.shop = npc.shop.filter(i => i !== shopItem);

  npc.recentTrades = npc.recentTrades ?? [];
  npc.recentTrades.push({ action: 'buy', itemId: shopItem.id, price: shopItem.price });
  if (npc.recentTrades.length > 20) npc.recentTrades.shift();

  saveSessionAuto();
  res.json({ ok: true, npc: pubNpc(npc), ...pubSession(state.session) });
});

router.post('/api/npc/trade/sell', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  if (state.session.combat) return res.status(400).json({ error: E('combat_active', 'Идёт бой') });
  const npc = npcInCurrentRoom(state.session, req.body.npcInstanceId);
  if (!npc) return res.status(404).json({ error: E('npc_not_found', 'NPC не найден') });
  if (npc.type !== 'trader') return res.status(400).json({ error: E('npc_not_trader_sell', 'Этот NPC не покупает') });

  const { itemId } = req.body;
  const { player } = state.session;

  for (const eqItem of Object.values(player.equip ?? {})) {
    if (eqItem?.id === itemId) return res.status(400).json({ error: E('cannot_sell_equipped', 'Нельзя продать надетый предмет') });
  }

  const inv = player.inventory.find(i => i.id === itemId);
  if (!inv || inv.count <= 0) return res.status(404).json({ error: E('item_not_in_inv', 'Предмет не найден в инвентаре') });

  const def       = itemDef(itemId);
  const sellPrice = def?.price_sell ?? 0;
  if (!sellPrice) return res.status(400).json({ error: E('item_not_sellable', 'Предмет нельзя продать') });

  removeFromInventory(player, itemId, 1);
  player.gold = (player.gold ?? 0) + sellPrice;

  npc.recentTrades = npc.recentTrades ?? [];
  npc.recentTrades.push({ action: 'sell', itemId, price: sellPrice });
  if (npc.recentTrades.length > 20) npc.recentTrades.shift();

  saveSessionAuto();
  res.json({ ok: true, goldGained: sellPrice, npc: pubNpc(npc), ...pubSession(state.session) });
});

module.exports = router;
