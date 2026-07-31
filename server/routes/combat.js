'use strict';
const router = require('express').Router();
const { CORE, cfg, NARRATIVE, NPCS, NPC_COMBAT_CFG }           = require('../engine/data');
const { clamp }                                               = require('../engine/helpers');
const { itemDef, addToInventory }                             = require('../engine/items');
const { recalcStats, applyEndCombatRefresh, resolveAbilities } = require('../engine/player');
const { playerCanDo, mobCanDo, mobAvailable, resolveTurn,
        checkLevelUp }                                        = require('../engine/combat');
const { aiChat, mobSystempromt, parseMobReply,
        narrateText, loadNarratorPrompt,
        checkAiSurrender }                                      = require('../engine/ai');
const { trackKill, trackSpared, trackDefeat }                  = require('../engine/account');
const { npcInCurrentRoom, adjustNpcRelationship, pushNpcMemory, dreamAboutEncounter } = require('../engine/npc');
const { state, saveSessionAuto, clearSessionAuto,
        addJournal, pubSession }                              = require('../engine/session');
const { t }                                                   = require('../engine/translation');

const E  = (key, fb)  => t('server', 'errors',      key, fb);
const CL = (key, fb)  => t('server', 'combat_log',  key, fb);
const CT = (key, fb)  => t('server', 'combat_turn', key, fb);

// Player lines + mob speech actually said during the fight (from combat.chatLog,
// captured by the caller BEFORE state.session.combat is nulled) — this is what makes
// dream_ai remember the actual banter, not just a generic "won/lost" line.
function _buildCombatTranscript(mob, chatLog) {
  const lines = [];
  for (const entry of chatLog ?? []) {
    if (entry.playerMsg) lines.push(`Рыцарь: "${entry.playerMsg}"`);
    if (entry.mobSpeech)  lines.push(`${mob.name}: "${entry.mobSpeech}"`);
  }
  return lines.join('\n');
}

// ── NPC-sourced combat resolution (kill / spare / player_defeat) ──────────────
// See roadmap/npc_combat.md §5. Returns extra payload fields (or null if this
// combat wasn't against an NPC, or the NPC is no longer in the room).
// chatLog: combat.chatLog captured by the caller before state.session.combat = null.
function resolveNpcCombatOutcome(mob, outcomeType, chatLog = []) {
  const src = mob.sourceNpc;
  if (!src) return null;
  const npc = npcInCurrentRoom(state.session, src.instanceId);
  if (!npc) return null;
  const npcDef = NPCS.find(n => n.id === src.defId);
  if (!npcDef) return null;

  const floor = state.session.dungeon.level;
  const extras = {};

  if (outcomeType === 'kill') {
    const delta = src.onKill?.relationship_delta ?? NPC_COMBAT_CFG.relationship.default_kill_delta;
    adjustNpcRelationship(npc, npcDef, delta);

    // Kill ALWAYS removes the NPC from THIS floor's room — he's gone from this map either
    // way. permanent_death only decides whether he's also blocked from spawning on ANY
    // later floor for the rest of THIS session (true), or can still turn up there again
    // (false). A brand new game session is unaffected regardless — deadNpcIds lives on
    // `player`, which /api/new-game never inherits (roadmap/npc_combat.md §7).
    const mode = npcDef.relationship?.mode ?? 'session';
    if (src.permanentDeath) {
      // session-mode memory lives only on this (about to be discarded) npc instance —
      // pushing it would be pointless, nothing will ever read it back.
      if (mode === 'account') {
        pushNpcMemory(npc, npcDef, src.onKill?.memory_key ?? 'npc_memory_killed_permanent',
          'Рыцарь меня убил.', { floor });
      }
      const dead = state.session.player.deadNpcIds ?? (state.session.player.deadNpcIds = []);
      if (!dead.includes(npcDef.id)) dead.push(npcDef.id);
    } else {
      pushNpcMemory(npc, npcDef, src.onKill?.memory_key ?? 'npc_memory_defeated_fled',
        'На {floor} этаже рыцарь одолел меня в бою, и мне пришлось бежать.', { floor });
    }
    state.session.dungeon.rooms[state.session.dungeon.playerPos].npc = null;
  } else if (outcomeType === 'spare') {
    const delta = src.onSpare?.relationship_delta ?? NPC_COMBAT_CFG.relationship.default_spare_delta;
    adjustNpcRelationship(npc, npcDef, delta);
    pushNpcMemory(npc, npcDef, src.onSpare?.memory_key ?? 'npc_memory_spared',
      'На {floor} этаже рыцарь мог меня убить, но пощадил.', { floor });
    // Sparing also ends this NPC's combat availability — same as a non-permanent kill,
    // he's no longer a fight, just someone to talk to (see roadmap/npc_combat.md §5/§7).
    npc.defeated = true;
    if (src.onSpare?.event) {
      extras.npcOpen       = true;
      extras.npcInstanceId = npc.instanceId;
    }
  } else if (outcomeType === 'player_defeat') {
    const opd = src.onPlayerDefeat ?? {};
    if (opd.relationship_delta != null) adjustNpcRelationship(npc, npcDef, opd.relationship_delta);
    pushNpcMemory(npc, npcDef, opd.memory_key ?? 'npc_memory_won_fight',
      'На {floor} этаже я одолел(а) рыцаря в бою.', { floor });
    extras.npcSpecialDefeat = {
      outcome: opd.outcome ?? null,
      text: opd.text ?? t('server', 'npc_special_defeat', opd.text_key ?? 'default',
        'Ты проиграл(а) бой, но остался(ась) жив(а).')
    };
  }

  // dream_ai: async, non-blocking — see roadmap/npc_combat.md "dream_ai". Adds its own
  // AI-authored memory line + a bounded relationship nudge on top of the fixed deltas
  // above. Skipped when the npc instance is about to be discarded with nowhere to
  // persist to (session-mode + permanent kill — same reasoning as the static memory push).
  const npcMode = npcDef.relationship?.mode ?? 'session';
  const discarded = outcomeType === 'kill' && src.permanentDeath && npcMode !== 'account';
  if (npcDef.dream_ai && !discarded) {
    const outcomeLine = outcomeType === 'kill'
      ? (src.permanentDeath ? 'Рыцарь меня убил.' : 'Рыцарь одолел меня в бою, и мне пришлось бежать.')
      : outcomeType === 'spare'
      ? 'Рыцарь победил меня в бою, но решил пощадить.'
      : 'Я одолел(а) рыцаря в бою.';
    // What was actually said during the fight, not just the mechanical outcome —
    // this is what lets dream_ai remember specific taunts/lines, not just "won/lost".
    const transcript    = _buildCombatTranscript(mob, chatLog);
    const combatOutcome = [transcript, outcomeLine].filter(Boolean).join('\n');
    dreamAboutEncounter(npc, npcDef, { combatOutcome }).then(saveSessionAuto).catch(() => {});
  }

  return extras;
}

router.post('/api/narrate', async (req, res) => {
  const { text, section: sectionKey } = req.body ?? {};
  if (!text) return res.status(400).json({ error: E('narrate_no_text', 'Текст не передан') });
  if (!NARRATIVE?.narrative) return res.json({ text });

  const sectionMap = {
    after_combat:      NARRATIVE.after_combat,
    after_defeat:      NARRATIVE.after_defeat,
    npc_trader:        NARRATIVE.NPC?.trader,
    npc_other:         NARRATIVE.NPC?.other,
    // NPC-combat variants reuse the same section object, just a different prompt file
    npc_trader_combat: NARRATIVE.NPC?.trader,
    npc_other_combat:  NARRATIVE.NPC?.other
  };
  const sectionCfg  = sectionMap[sectionKey] ?? NARRATIVE.beffore_combat;
  const isNpcCombat = sectionKey === 'npc_trader_combat' || sectionKey === 'npc_other_combat';
  const promptPath  = isNpcCombat
    ? (sectionCfg?.path_promt_narrator_combat ?? sectionCfg?.path_promt_narrator)
    : sectionCfg?.path_promt_narrator;
  const narratorPrompt = promptPath ? loadNarratorPrompt(promptPath) : null;

  try {
    const narrated = await narrateText(text, narratorPrompt);
    res.json({ text: narrated });
  } catch {
    res.json({ text });
  }
});

router.post('/api/combat/narrator', (req, res) => {
  if (!state.session?.combat) return res.json({});
  const { text } = req.body ?? {};
  if (typeof text === 'string' && text) state.session.combat.narratorText = text;
  saveSessionAuto();
  res.json({});
});

router.post('/api/combat/turn', async (req, res) => {
  if (!state.session?.combat) return res.status(400).json({ error: E('no_combat', 'Нет боя') });

  const { message: playerMsg, action: playerAction } = req.body;
  const { player, combat } = state.session;
  const mob = combat.mob;

  if (!resolveAbilities(player)[playerAction])
    return res.status(400).json({ error: E('invalid_action', 'Неверное действие') });
  if (!playerCanDo(player, playerAction))
    return res.status(400).json({ error: E('action_unavailable', 'Действие недоступно') });

  try {
    const jsonMode        = cfg.provider === 'openrouter' ? cfg.openrouterJsonMode : cfg.ollamaJsonMode;
    const aiSurrenderOk   = await checkAiSurrender(mob, playerMsg ?? '', state.session);
    const avail           = mobAvailable(mob, playerMsg ?? '', aiSurrenderOk);
    const canSurrender    = avail.includes('surrender');
    const sysPmt  = { role: 'system', content: mobSystempromt(mob, canSurrender, jsonMode, player) };

    const turnLines = [
      CT('turn_header',       '[Ход {turn}]').replace('{turn}', combat.turn + 1),
      CT('mob_stats',         'Твои параметры: HP={hp}/{maxHp}, Энергия={energy}/{maxEnergy}.')
        .replace('{hp}', mob.hp).replace('{maxHp}', mob.maxHp)
        .replace('{energy}', mob.energy).replace('{maxEnergy}', mob.maxEnergy),
      CT('player_stats',      'Противник: HP={hp}/{maxHp}, Энергия={energy}/{maxEnergy}.')
        .replace('{hp}', player.hp).replace('{maxHp}', player.maxHp)
        .replace('{energy}', player.energy).replace('{maxEnergy}', player.maxEnergy),
      playerMsg
        ? CT('player_says',   'Противник говорит: "{msg}"').replace('{msg}', playerMsg.slice(0, 255))
        : CT('player_silent', 'Противник молчит.'),
      CT('available_actions', 'Доступные действия: {actions}.').replace('{actions}', avail.join(', '))
    ];

    // In cacheMode: playerHints go in the turn message (system stays static).
    // surrenderNote stays in system (see mobSystempromt) — one cache miss when it unlocks.
    if (cfg.cacheMode) {
      const M = (key, fb) => t('server', 'mob_system', key, fb);
      const playerHints = [];
      if (player.hp     / player.maxHp     < 0.3) playerHints.push(M('obs_player_hurt',  'твой противник сильно ранен'));
      if (player.energy / player.maxEnergy < 0.3) playerHints.push(M('obs_player_tired', 'твой противник сильно устал'));
      if (playerHints.length) turnLines.push(`${M('obs_prefix', 'Наблюдение')}: ${playerHints.join(', ')}.`);
    }

    // If ai_surrender was triggered, hint that peaceful resolution is possible — mob decides itself
    if (aiSurrenderOk) {
      turnLines.push(t('server', 'mob_system', 'ai_surrender_hint',
        'Противник хочет разойтись мирно. Если ты тоже этого хочешь — выбери surrender.'));
    }

    const pickMsg = { role: 'user', content: turnLines.join('\n') };

    const msgs   = [sysPmt, ...combat.history, pickMsg];
    const rawRep = await aiChat(msgs, jsonMode);
    const parsed = parseMobReply(rawRep, jsonMode);

    const mobAction = avail.includes(parsed.action) ? parsed.action : (avail[0] ?? 'wait');
    combat.history.push(pickMsg, { role: 'assistant', content: rawRep });

    if (playerMsg) addJournal(state.session, 'dialogue', CL('player_says', 'Вы: "{msg}"').replace('{msg}', playerMsg.slice(0, 120)));
    if (parsed.speech && parsed.speech !== '...') addJournal(state.session, 'dialogue', `${mob.name}: "${parsed.speech}"`);

    if (parsed.notes?.length > 3) {
      mob.memory.push(`[${CT('turn_header', 'Ход {turn}').replace('{turn}', combat.turn + 1)}]: ${parsed.notes}`);
      if (mob.memory.length > 10) mob.memory.shift();
    }

    const { log, result: rawResult } = resolveTurn(state.session, playerAction, mobAction, canSurrender);
    let result = rawResult;
    const { rng } = require('../engine/helpers');

    // Accumulate this turn into chatLog (before result processing may clear combat)
    combat.chatLog.push({
      kind:         'turn',
      turn:         combat.turn,
      playerMsg:    playerMsg || null,
      playerAction,
      mobName:      mob.name,
      mobAction,
      mobSpeech:    (parsed.speech && parsed.speech !== '...') ? parsed.speech : null,
      log
    });

    let reward = null;
    let npcExtras = null;
    if (result === 'victory') {
      state.session.player.xp    = (state.session.player.xp    ?? 0) + mob.xp;
      state.session.player.kills = (state.session.player.kills  ?? 0) + 1;
      trackKill(mob.id);
      const drops = [];
      for (const drop of (mob.items ?? [])) {
        if (Math.random() > (drop.chance ?? 1)) continue;
        const cnt = Array.isArray(drop.count) ? rng(drop.count[0], drop.count[1]) : drop.count;
        addToInventory(state.session.player, drop.id, cnt);
        const def = itemDef(drop.id);
        drops.push(drop.id === 'gold'
          ? CL('gold_drop', '{count} золота').replace('{count}', cnt)
          : `${def?.name ?? drop.id} ×${cnt}`);
      }
      state.session.dungeon.rooms[state.session.dungeon.playerPos].mob = null;
      state.session.combat = null;
      reward = { xp: mob.xp, drops };
      const victoryKey = drops.length ? 'victory_drop' : 'victory';
      const victoryFb  = drops.length ? 'Победа над {name}. +{xp} XP. Дроп: {drops}' : 'Победа над {name}. +{xp} XP';
      addJournal(state.session, 'combat',
        CL(victoryKey, victoryFb).replace('{name}', mob.name).replace('{xp}', mob.xp).replace('{drops}', drops.join(', '))
      );
      const lu = checkLevelUp(state.session.player);
      if (lu.leveled) {
        if (lu.grants && Object.keys(lu.grants).length) {
          const lb = state.session.player.levelBonuses ?? {};
          for (const [k, v] of Object.entries(lu.grants)) lb[k] = (lb[k] ?? 0) + v;
          state.session.player.levelBonuses = lb;
          recalcStats(state.session.player);
        }
        reward.levelUp = { newLevel: lu.newLevel, spGained: lu.spGained };
        addJournal(state.session, 'event',
          CL('levelup', 'Уровень {level}! +{sp} SP').replace('{level}', lu.newLevel).replace('{sp}', lu.spGained)
        );
      }
      applyEndCombatRefresh(state.session.player);
      npcExtras = resolveNpcCombatOutcome(mob, 'kill', combat.chatLog);
    } else if (result === 'defeat') {
      state.session.combat = null;
      if (mob.sourceNpc?.onPlayerDefeat) {
        // Special non-lethal outcome (see roadmap/npc_combat.md §5) — not a real game over,
        // the run continues, no trackDefeat().
        npcExtras = resolveNpcCombatOutcome(mob, 'player_defeat', combat.chatLog);
        result = 'npc_special_defeat';
        addJournal(state.session, 'combat',
          t('server', 'journal', 'npc_special_defeat', 'Проиграл(а) бой с {name}, но остался(ась) жив(а)')
            .replace('{name}', mob.name));
      } else {
        addJournal(state.session, 'combat', CL('defeat', 'Поражение от {name}').replace('{name}', mob.name));
        trackDefeat();
      }
    }

    const payload = {
      playerAction, mobAction,
      mobSpeech: parsed.speech,
      log, result, reward,
      ...(npcExtras ?? {}),
      ...pubSession(state.session)
    };

    if (result === 'defeat') {
      state.session = null;
      clearSessionAuto();
    } else {
      saveSessionAuto();
    }

    res.json(payload);

  } catch (err) {
    console.error('AI error:', err.message);
    res.status(500).json({ error: E('ai_error', 'Ошибка AI: {msg}').replace('{msg}', err.message) });
  }
});

router.post('/api/combat/flee', (_req, res) => {
  if (!state.session?.combat) return res.status(400).json({ error: E('no_combat', 'Нет боя') });
  const { player } = state.session;
  const fleeCfg    = CORE.mechanics.function_only_player?.flee ?? {};
  const energyCost = fleeCfg.energy_cost ?? 25;
  const chance     = fleeCfg.chance     ?? 0.3;
  const hpThresh   = fleeCfg.condition?.hp_ratio_below ?? 0.3;

  if (player.hp / player.maxHp >= hpThresh)
    return res.status(400).json({ error: E('flee_hp_required', 'Побег возможен только при HP < {pct}%').replace('{pct}', Math.round(hpThresh * 100)) });
  if (player.energy < energyCost)
    return res.status(400).json({ error: E('flee_energy', 'Недостаточно энергии для побега') });
  if (state.session.combat.fleeAttempted)
    return res.status(400).json({ error: E('flee_already_used', 'Побег уже был использован в этом бою') });

  player.energy = clamp(player.energy - energyCost, 0, player.maxEnergy);
  state.session.combat.fleeAttempted = true;

  const mobName = state.session.combat.mob.name;
  const success = Math.random() < chance;
  if (success) {
    addJournal(state.session, 'combat', CL('flee_success', 'Побег от {name} успешен').replace('{name}', mobName));
    state.session.combat = null;
  } else {
    addJournal(state.session, 'combat', CL('flee_fail', 'Попытка побега от {name} провалилась').replace('{name}', mobName));
  }

  saveSessionAuto();
  res.json({ fled: success, ...pubSession(state.session) });
});

router.post('/api/combat/mercy', (req, res) => {
  if (!state.session?.combat) return res.status(400).json({ error: E('no_combat', 'Нет боя') });
  if (!state.session.combat.pendingMercy) return res.status(400).json({ error: E('no_mercy_pending', 'Нет ожидающего решения') });

  const { choice } = req.body;
  if (choice !== 'spare' && choice !== 'kill') return res.status(400).json({ error: E('invalid_choice', 'Неверный выбор') });

  const mob = state.session.combat.mob;
  if (choice === 'spare' && mob.sourceNpc?.spareable === false)
    return res.status(400).json({ error: E('npc_not_spareable', 'Этого нельзя пощадить') });
  if (choice === 'kill' && mob.sourceNpc?.killable === false)
    return res.status(400).json({ error: E('npc_not_killable', 'Этого нельзя добить') });

  const { rng } = require('../engine/helpers');
  let reward = null;
  let npcExtras = null;

  if (choice === 'spare') {
    const halfXp = Math.round(mob.xp / 2);
    state.session.player.xp           = (state.session.player.xp           ?? 0) + halfXp;
    state.session.player.peacefulWins  = (state.session.player.peacefulWins  ?? 0) + 1;
    trackSpared();
    reward = { xp: halfXp, peaceful: true };
    addJournal(state.session, 'combat', CL('spare', '{name} помилован. +{xp} XP (мирная победа)').replace('{name}', mob.name).replace('{xp}', halfXp));
    npcExtras = resolveNpcCombatOutcome(mob, 'spare', state.session.combat.chatLog);
  } else {
    state.session.player.xp   = (state.session.player.xp   ?? 0) + mob.xp;
    state.session.player.kills = (state.session.player.kills ?? 0) + 1;
    trackKill(mob.id);
    const drops = [];
    for (const drop of (mob.items ?? [])) {
      if (Math.random() > (drop.chance ?? 1)) continue;
      const cnt = Array.isArray(drop.count) ? rng(drop.count[0], drop.count[1]) : drop.count;
      addToInventory(state.session.player, drop.id, cnt);
      const def = itemDef(drop.id);
      drops.push(drop.id === 'gold'
        ? CL('gold_drop', '{count} золота').replace('{count}', cnt)
        : `${def?.name ?? drop.id} ×${cnt}`);
    }
    reward = { xp: mob.xp, drops };
    const killKey = drops.length ? 'kill_drop' : 'kill';
    const killFb  = drops.length ? '{name} добит. +{xp} XP. Дроп: {drops}' : '{name} добит. +{xp} XP';
    addJournal(state.session, 'combat',
      CL(killKey, killFb).replace('{name}', mob.name).replace('{xp}', mob.xp).replace('{drops}', drops.join(', '))
    );
    npcExtras = resolveNpcCombatOutcome(mob, 'kill', state.session.combat.chatLog);
  }

  state.session.dungeon.rooms[state.session.dungeon.playerPos].mob = null;
  state.session.combat = null;

  const lu = checkLevelUp(state.session.player);
  if (lu.leveled) {
    if (lu.grants && Object.keys(lu.grants).length) {
      const lb = state.session.player.levelBonuses ?? {};
      for (const [k, v] of Object.entries(lu.grants)) lb[k] = (lb[k] ?? 0) + v;
      state.session.player.levelBonuses = lb;
      recalcStats(state.session.player);
    }
    reward = reward ?? {};
    reward.levelUp = { newLevel: lu.newLevel, spGained: lu.spGained };
    addJournal(state.session, 'event',
      CL('levelup', 'Уровень {level}! +{sp} SP').replace('{level}', lu.newLevel).replace('{sp}', lu.spGained)
    );
  }
  applyEndCombatRefresh(state.session.player);

  saveSessionAuto();
  res.json({ choice, reward, ...(npcExtras ?? {}), ...pubSession(state.session) });
});

module.exports = router;
