'use strict';
const { NPCS, MOBS, BOSSES, NPC_COMBAT_CFG, LORE } = require('./data');
const { uid, rng, levelMatches } = require('./helpers');
const { itemDef } = require('./items');
const { t, resolvePromt } = require('./translation');
const { buildPromtText, loadLangFile, aiChat } = require('./ai');
const { applyMobScript, buildMobFromBase, deepMerge } = require('./mob');
const { buildBossFromBase } = require('./boss');
const { getAccountRelationship, adjustAccountRelationship,
        getAccountMemory, pushAccountMemory, setAccountMemorySummary,
        capMemoryTokens, capMemoryCount } = require('./account');
const { relationshipTier, evalAll } = require('./conditions');

function parseCount(count) {
  if (typeof count === 'string') {
    const [a, b] = count.split('-').map(Number);
    return rng(a, b);
  }
  return count ?? 1;
}

function translateNpcNarrativeText(enc, npcId) {
  if (!enc) return null;
  const MISS = '\x00';
  const trKey = key => key ? t('npc', npcId, key, MISS) : MISS;
  const trDefault = trKey('narrative_default');
  return {
    default:  trDefault !== MISS ? trDefault : enc.default,
    is_ai:    enc.is_ai ?? false,
    variants: (enc.variants ?? []).map(v => {
      let text = trKey(v.key);
      if (text === MISS) text = v.text ?? null;
      if (!text) return null;
      return { if: v.if, text, is_ai: v.is_ai ?? false, priority: v.priority ?? 0, extension: v.extension ?? false };
    }).filter(Boolean)
  };
}

function spawnNpc(dungeonLevel, allowedIds) {
  const valid = NPCS.filter(n => allowedIds.includes(n.id) && levelMatches(n.level, dungeonLevel));
  if (!valid.length) return null;
  const base = valid[rng(0, valid.length - 1)];

  const shop = [];
  if (base.type === 'trader') {
    for (const entry of (base.trader ?? [])) {
      if (Math.random() > (entry.chance_appearance ?? 1)) continue;
      const def = itemDef(entry.item);
      if (!def) continue;
      const cnt   = parseCount(entry.count);
      const price = Math.round((def.price_buy ?? 0) * (1 - (entry.discount ?? 0)));
      shop.push({
        id: def.id, name: def.name, image: `/assets/item/${def.image}`,
        count: cnt, price, stats: def.stats ?? null, equip: def.equip ?? false
      });
    }
  }

  const relMode    = base.relationship?.mode ?? 'session';
  const relDefault = base.relationship?.default ?? 0;

  return {
    instanceId:     uid(),
    defId:          base.id,
    name:           t('npc', base.id, 'name',  base.name),
    type:           base.type,
    promt:          base.promt_path ? (loadLangFile(base.promt_path) ?? resolvePromt('npc', base.id, base.promt)) : resolvePromt('npc', base.id, base.promt),
    portrait:       `/assets/npc/${base.portrait}`,
    pawn:           `/assets/npc/${base.pawn}`,
    icon:           `/assets/npc/${base.icon}`,
    messageCount:   0,
    maxMessages:    base.max_count_message ?? 5,
    messageIgnores: base.message_ignores  ?? '...',
    narrative_text: translateNpcNarrativeText(base.narrative_text, base.id),
    events:         base.events ?? null,
    history:        [],
    shop,
    // Combat/relationship state (see roadmap/npc_combat.md)
    relationship:   relMode === 'account' ? getAccountRelationship(base.id, relDefault) : relDefault,
    memory:         relMode === 'account' ? getAccountMemory(base.id) : { records: [], summary: '', sinceCompact: 0 },
    defeated:       false,
    // dream_ai state: recentTrades accumulates since the last dream; dreamedUpTo is the
    // npc.history index already summarized, so re-opening chat without new messages
    // never re-dreams the same conversation.
    recentTrades:   [],
    dreamedUpTo:    0
  };
}

// ── Relationship (-100..100, per §3 of roadmap/npc_combat.md) ─────────────────

function adjustNpcRelationship(npc, base, delta) {
  const mode = base.relationship?.mode ?? 'session';
  if (mode === 'account') {
    npc.relationship = adjustAccountRelationship(base.id, delta);
  } else {
    const { min, max } = NPC_COMBAT_CFG.relationship;
    npc.relationship = Math.max(min, Math.min(max, (npc.relationship ?? 0) + delta));
  }
  return npc.relationship;
}

// ── Compact memory ("на этаже 1 он мне надрал задницу", §3.3) ─────────────────
// key/fallback go through t('server','npc_memory', key, fallback); vars replace {name} tokens.

function pushNpcMemory(npc, base, key, fallback, vars = {}) {
  let line = t('server', 'npc_memory', key, fallback);
  for (const [k, v] of Object.entries(vars)) line = line.replaceAll(`{${k}}`, String(v));
  return pushNpcMemoryLine(npc, base, line);
}

// Same storage/capping as pushNpcMemory, but takes an already-finished line (used by
// dream_ai, whose memory text comes straight from the AI — no t()/key resolution needed).
function pushNpcMemoryLine(npc, base, line) {
  const mode = base.relationship?.mode ?? 'session';
  if (mode === 'account') {
    npc.memory = pushAccountMemory(base.id, line);
  } else {
    const mem = (npc.memory ??= { records: [], summary: '', sinceCompact: 0 });
    mem.records.push(line);
    capMemoryCount(mem.records, NPC_COMBAT_CFG.memory.max_records);
    capMemoryTokens(mem.records, NPC_COMBAT_CFG.memory.max_tokens_session);
    mem.sinceCompact = (mem.sinceCompact ?? 0) + 1;
  }
  if ((npc.memory.sinceCompact ?? 0) >= NPC_COMBAT_CFG.memory.compact_every) {
    _compactMemory(npc, base).catch(err => console.error('[npc memory compact] failed:', base.id, err.message));
  }
  return npc.memory;
}

// Every `compact_every` raw records, fold the whole batch (up to `max_records`) plus
// the existing running opinion into ONE new opinion — so the flavor of records that
// eventually age out of the ring buffer survives instead of just vanishing.
async function _compactMemory(npc, base) {
  const mem = npc.memory;
  if (!mem?.records?.length) return;
  // Reset optimistically: a failed pass just waits for the next batch instead of
  // retrying (and re-calling the AI) on every subsequent push.
  mem.sinceCompact = 0;

  const tierKey = relationshipTier(npc.relationship ?? 0);
  const status  = t('server', 'relationship_tiers', tierKey, tierKey);

  const T = (key, fb) => t('server', 'npc_memory_compact', key, fb);
  const system = T('system',
    'Ты — {name}, персонаж тёмного фэнтезийного мира. Ниже — твоё текущее общее впечатление об этом ' +
    'человеке (игроке) и отдельные воспоминания о встречах с ним, накопленные с тех пор, пронумерованные ' +
    'в хронологическом порядке (1 — самое старое, последнее число — самое свежее). Учитывай эту ' +
    'последовательность: если тон встреч со временем меняется (например, грубость сменяется теплотой или ' +
    'наоборот), отражай в первую очередь актуальное состояние, а не усредняй все события одинаково. Твоё ' +
    'текущее отношение к нему: {rel} ({status}). Объедини всё это в одно новое, связное личное мнение о нём — ' +
    '2-4 предложения от первого лица, конкретика важнее общих фраз, самое важное и яркое не теряй. ' +
    'Ответ — только текст мнения, без markdown, без пояснений.'
  ).replace(/\{name\}/g, npc.name)
   .replace(/\{rel\}/g, npc.relationship ?? 0)
   .replace(/\{status\}/g, status);
  const numberedRecords = mem.records.map((line, i) => `${i + 1}) ${line}`).join('\n');
  const userText = T('prompt', 'Текущее мнение о нём:\n{summary}\n\nВоспоминания по порядку (от старых к новым):\n{records}')
    .replace('{summary}', mem.summary || T('summary_empty', '(мнения ещё не сложилось)'))
    .replace('{records}', numberedRecords);

  const raw = await aiChat([
    { role: 'system', content: system },
    { role: 'user',   content: userText }
  ], false);
  const summary = raw.trim();
  if (!summary) return;

  const mode = base.relationship?.mode ?? 'session';
  if (mode === 'account') setAccountMemorySummary(base.id, summary);
  else mem.summary = summary;
}

// ── dream_ai: AI-authored memory + bounded relationship nudge ─────────────────
// See roadmap/npc_combat.md "dream_ai". Fires async after a chat closes and/or combat
// resolves — summarizes what just happened (chat + trades + combat, whichever apply)
// into one short first-person memory line, and lets the AI nudge relationship within
// a hard-clamped ±max_change (never trusts the AI's number beyond that bound).

function _dreamConfig(base) {
  if (!base.dream_ai) return null;
  const maxChange = typeof base.dream_ai === 'object'
    ? (base.dream_ai.max_change ?? NPC_COMBAT_CFG.dream.max_change_default)
    : NPC_COMBAT_CFG.dream.max_change_default;
  return { maxChange };
}

// Anything to summarize since the last dream? (new chat messages or pending trades).
// Combat outcomes always count as new material regardless (checked by the caller).
function hasNewDreamMaterial(npc) {
  const newHistory = (npc.history?.length ?? 0) - (npc.dreamedUpTo ?? 0);
  return newHistory > 0 || (npc.recentTrades?.length ?? 0) > 0;
}

function _buildDreamTranscript(npc) {
  const lines = [];
  const newMsgs = (npc.history ?? []).slice(npc.dreamedUpTo ?? 0);
  if (newMsgs.length) {
    lines.push('[Разговор]');
    for (const m of newMsgs) {
      if (m.role === 'user')       lines.push(`Рыцарь: ${m.content}`);
      else if (m.role === 'assistant') lines.push(`${npc.name}: ${m.content}`);
    }
  }
  if (npc.recentTrades?.length) {
    lines.push('[Торговля]');
    for (const tr of npc.recentTrades) {
      lines.push(tr.action === 'buy'
        ? `Купил у меня: ${tr.itemId} за ${tr.price} золота`
        : `Продал мне: ${tr.itemId} за ${tr.price} золота`);
    }
  }
  return lines.join('\n');
}

async function dreamAboutEncounter(npc, base, { combatOutcome = null } = {}) {
  const dreamCfg = _dreamConfig(base);
  if (!dreamCfg) return;
  if (!combatOutcome && !hasNewDreamMaterial(npc)) return; // nothing new — don't re-dream

  const transcript = _buildDreamTranscript(npc);
  const parts = [];
  if (transcript) parts.push(transcript);
  if (combatOutcome) parts.push(`[Бой]\n${combatOutcome}`);
  const userText = parts.join('\n\n');
  if (!userText) return;

  const T = (key, fb) => t('server', 'npc_dream', key, fb);
  const system = T('system',
    'Ты — {name}, персонаж тёмного фэнтезийного мира. Только что закончилось взаимодействие ' +
    'с игроком (рыцарем в изувеченных доспехах). Опиши ОДНОЙ короткой фразой от первого лица ' +
    'компактное личное воспоминание об этом. Также реши, как должно измениться твоё отношение ' +
    'к нему: целое число от -{max} до {max} (0, если ничего не изменилось). ' +
    'Текущее отношение: {rel}. Отвечай СТРОГО в формате JSON без markdown (одна строка):\n' +
    '{"memory":"...","relationship_delta":N}')
    .replace(/\{name\}/g, npc.name)
    .replace(/\{max\}/g, dreamCfg.maxChange)
    .replace(/\{rel\}/g, npc.relationship ?? 0);

  try {
    const raw   = await aiChat([
      { role: 'system', content: system },
      { role: 'user',   content: userText }
    ], true);
    const clean  = raw.replace(/```(?:json)?\n?/g, '').trim();
    const parsed = JSON.parse(clean);

    const line = (parsed.memory ?? '').toString().trim();
    if (line) pushNpcMemoryLine(npc, base, line);

    const rawDelta = Number(parsed.relationship_delta) || 0;
    const delta    = Math.max(-dreamCfg.maxChange, Math.min(dreamCfg.maxChange, rawDelta));
    if (delta) adjustNpcRelationship(npc, base, delta);
  } catch (err) {
    console.error('[npc dream] failed:', base.id, err.message);
  } finally {
    npc.dreamedUpTo  = npc.history?.length ?? 0;
    npc.recentTrades = [];
  }
}

// ── Combat spawn: build a mob/boss-shaped combatant from this NPC's own template ──
// See roadmap/npc_combat.md §4/§6. Pipeline: template base → mob-level script (if
// source:"mob") → NPC combat.overrides (deepMerge, applied LAST) → build → re-resolve
// name/promt translation under the NPC's own id so the overlay can't be shadowed by
// the template's own translation.

function spawnNpcCombat(npc, level = 1, ctx = null) {
  const base = NPCS.find(n => n.id === npc.defId);
  if (!base?.npc_combat || !base.combat) return null;

  const { template, overrides } = base.combat;
  const templateBase = (template.source === 'boss' ? BOSSES : MOBS).find(x => x.id === template.id);
  if (!templateBase) return null;

  const scripted = template.source === 'mob' ? applyMobScript(templateBase, ctx) : templateBase;
  const merged   = overrides ? deepMerge(JSON.parse(JSON.stringify(scripted)), overrides) : scripted;

  const combatant = template.source === 'boss'
    ? buildBossFromBase(merged, level)
    : buildMobFromBase(merged, level);

  // Overlay wins over the template's own translation for explicitly overridden text fields
  if (overrides?.name != null) {
    combatant.name = t('npc', npc.defId, 'combat_name', overrides.name);
  }
  if (overrides?.promt != null) {
    combatant.promt = base.combat.promt_path
      ? (loadLangFile(base.combat.promt_path) ?? resolvePromt('npc', npc.defId, overrides.promt))
      : resolvePromt('npc', npc.defId, overrides.promt);
  }

  combatant.sourceNpc = {
    instanceId:     npc.instanceId,
    defId:          npc.defId,
    npcType:        base.type === 'trader' ? 'trader' : 'other',
    killable:       base.combat.killable        !== false,
    spareable:      base.combat.spareable       !== false,
    permanentDeath: base.combat.permanent_death !== false,
    onKill:         base.combat.on_kill          ?? null,
    onSpare:        base.combat.on_spare         ?? null,
    onPlayerDefeat: base.combat.on_player_defeat ?? null,
  };
  return combatant;
}

function pubNpc(npc) {
  const base = NPCS.find(n => n.id === npc.defId);
  return {
    instanceId:     npc.instanceId,
    defId:          npc.defId,
    name:           npc.name,
    type:           npc.type,
    portrait:       npc.portrait,
    icon:           npc.icon,
    messageCount:   npc.messageCount,
    maxMessages:    npc.maxMessages,
    messageIgnores: npc.messageIgnores,
    narrative_text: npc.narrative_text ?? null,
    shop:           npc.shop ?? [],
    // Combat (see roadmap/npc_combat.md) — canAttack gates the "Attack" button client-side
    canAttack:      !!(base?.npc_combat && !npc.defeated),
    defeated:       npc.defeated ?? false
  };
}

// knows_lore entries can be a plain string (id, always available, remembered for
// the rest of the live chat) or an object for conditional/opt-out control:
//   { id, if: [...], remember: true|false }
//   if       — same condition syntax as dialogue.json/event.json (evalAll). Empty/absent = always.
//   remember — keep the tool_call+tool_result in npc.history for the rest of THIS
//              chat session once looked up (default true) — see routes/npc.js.
//              This is NOT the long-term cross-session npc.memory system.
function _normalizeLoreEntry(e) {
  return typeof e === 'string'
    ? { id: e, if: [], remember: true }
    : { id: e.id, if: e.if ?? [], remember: e.remember ?? true };
}

// Topics this NPC is allowed to pull lore context for — see assets/config/lore.json
// and npc.knows_lore in assets/npc/*.json. Filters out keys with no matching
// registry entry (stale/typo'd knows_lore) and, when a session is given, entries
// whose `if` condition doesn't currently hold.
function _npcLoreTopics(npcDef, sess = null) {
  return (npcDef?.knows_lore ?? [])
    .map(_normalizeLoreEntry)
    .filter(e => LORE[e.id]?.path)
    .filter(e => !sess || evalAll(e.if, sess))
    .map(e => ({ id: e.id, description: LORE[e.id].description, remember: e.remember }));
}

// Loads the actual lore snippet text for a topic key (per-language, with CORE_LANG
// fallback via loadLangFile). Returns null if the key/file is missing.
function lookupLore(key) {
  const entry = LORE[key];
  if (!entry?.path) return null;
  return loadLangFile(`assets/translation/{lang}/promts/lore/${entry.path}`); 
}

// useTools=true → native tool calling is doing the lore lookup (see
// server/engine/tools.js + routes/npc.js): no JSON wrapping, no lore text baked
// into the prompt — the tool schema itself carries the topic list. `content` from
// aiChatTools() is used as speech directly, nothing to parse.
function npcSystempromt(npc, jsonMode = false, npcDef = null, useTools = false, sess = null) {
  const N = (key, fb) => t('server', 'npc_system', key, fb);
  let npc_subpromt = '';

  if (npc.type === 'trader' && Array.isArray(npc.shop)) {
    const itemsList = npc.shop.map(item => `${item.name} (${item.price})`).join(', ');
    if (itemsList) {
      const buyReply = N('buy_reply', 'Нажмите кнопку, чтобы купить');
      npc_subpromt = N('trader_intro', 'Ты торговец. Вот твой ассортимент: {items}.')
        .replace('{items}', itemsList)
        + ' ('
        + N('trader_price_hint', 'Если игрок спрашивает цену – отвечай с ценой.')
        + ' '
        + N('trader_buy_instruction', 'Если в сообщении игрока встречаются фразы покупки, отвечай STRICTLY: «{buy_reply}» И ничего более.')
          .replace('{buy_reply}', buyReply)
        + ')';
    } else {
      npc_subpromt = N('trader_empty', 'Ты торговец, но сейчас у тебя нет товаров.');
    }
  }

  // Topic list is needed for BOTH paths now — not just the JSON fallback. Native
  // tool calling still needs an explicit textual nudge naming the tool and what
  // it's for: models trained on agentic system prompts associate tool use with
  // being told in plain text "you have function X for Y", not just with the API's
  // `tools` array quietly sitting in the request — a pure-roleplay system prompt
  // with zero mention of tools can leave that association dormant even though the
  // API-level schema is technically present (see runToolTurn dev-log evidence).
  const loreTopics = jsonMode || useTools ? _npcLoreTopics(npcDef, sess) : [];
  const formatInstr = useTools
    ? (loreTopics.length
        ? N('format_tools_lore', 'Отвечай коротко, 1-3 предложения, оставаясь в образе. У тебя есть инструмент lore_lookup — используй его, если вопрос игрока прямо касается одной из тем ниже:')
          + '\n' + loreTopics.map(e => `- "${e.id}": ${e.description}`).join('\n')
        : N('format_tools', 'Отвечай коротко, 1-3 предложения, оставаясь в образе. Если нужно — используй доступный инструмент, чтобы узнать больше по теме, прежде чем ответить.'))
    : jsonMode
      ? (loreTopics.length
          ? N('format_json_lore', 'Отвечай СТРОГО в формате JSON без markdown (одна строка):\n{"speech":"твой ответ игроку 1-3 предложения","lore_topic":"ключ темы или null"}')
            + '\n' + N('lore_hint', 'Заполняй lore_topic ТОЛЬКО если вопрос игрока прямо касается одной из тем ниже, иначе null:')
            + '\n' + loreTopics.map(e => `- "${e.id}": ${e.description}`).join('\n')
            + '\n' + N('lore_speech_skip', 'Если заполняешь lore_topic — можешь оставить speech коротким или пустым ("…"), тебе дадут ответить ещё раз, уже зная тему.')
          : N('format_json', 'Отвечай СТРОГО в формате JSON без markdown (одна строка):\n{"speech":"твой ответ игроку 1-3 предложения"}'))
      : N('format_text', 'Отвечай СТРОГО в таком формате:\nSPEECH: [твой ответ — 1-3 предложения]');

  const header   = N('header',    'Ты — {name} в подземелье (лабиринте).').replace('{name}', npc.name);
  const langHint = N('lang_hint', 'Говори коротко, по-русски, оставаясь в образе.');

  const records   = npc.memory?.records ?? [];
  const summary   = npc.memory?.summary ?? '';
  const hasMemory = records.length > 0 || !!summary;
  const memoryStr = hasMemory
    ? [summary, records.slice(-5).join('\n')].filter(Boolean).join('\n')
    : N('memory_empty', 'Ничего пока.');
  const memHeader = N('memory_header', 'Твои воспоминания об этом человеке:');
  // Context alone is easy for weaker models to ignore — spell out that it must
  // actually shape the reply, not just sit there as inert background text.
  const memoryInstr = hasMemory
    ? N('memory_instruction', 'Учитывай эти воспоминания в разговоре — пусть они влияют на твой тон и отношение к собеседнику, но не пересказывай их дословно.')
    : '';

  return `${header}\n${buildPromtText(npc.promt)}\n${memHeader}\n${memoryStr}\n${memoryInstr}\n${npc_subpromt}\n${langHint}\n${formatInstr}`;
}

// Returns { speech, loreTopic }. loreTopic is only ever non-null in jsonMode,
// when the model filled in the conditional lore_topic field (see npcSystempromt).
function parseNpcReply(text, jsonMode = false) {
  if (jsonMode) {
    try {
      const clean  = text.replace(/```(?:json)?\n?/g, '').trim();
      const parsed = JSON.parse(clean);
      return { speech: parsed.speech ?? text.trim(), loreTopic: parsed.lore_topic || null };
    } catch {}
  }
  return { speech: text.match(/SPEECH:\s*(.+?)$/si)?.[1]?.trim() ?? text.trim(), loreTopic: null };
}

function npcInCurrentRoom(sess, instanceId) {
  const npc = sess.dungeon.rooms[sess.dungeon.playerPos]?.npc;
  return npc?.instanceId === instanceId ? npc : null;
}

module.exports = {
  parseCount, spawnNpc, pubNpc,
  npcSystempromt, parseNpcReply, lookupLore, npcLoreTopics: _npcLoreTopics,
  npcInCurrentRoom, translateNpcNarrativeText,
  adjustNpcRelationship, pushNpcMemory, pushNpcMemoryLine, spawnNpcCombat,
  dreamAboutEncounter
};
