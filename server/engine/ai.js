'use strict';
const path = require('path');
const fs   = require('fs');
const { cfg, ROOT, CORE, AI_TEST_CFG } = require('./data');
const { t, CORE_LANG, langName } = require('./translation');
const { evalAll }      = require('./conditions');
const { DEV_MODE, pushAiLog } = require('./devlog');

// ── Strip reasoning/thinking tokens from model output ─────────────────────────
// Some models (DeepSeek-R1, QwQ, gpt-oss reasoning variants, etc.) embed
// thinking inside <think>…</think> tags in message.content.
// We always strip them — the game only needs the final reply.

function _stripThinking(text) {
  return (text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')  // <think>...</think> blocks
    .replace(/^[\s\n]+/, '')                     // leading whitespace after removal
    .trim();
}

// ── Transient network retry ────────────────────────────────────────────────────
// "fetch failed" (DNS hiccup/connection reset/timeout) and 5xx responses are
// usually transient — one quiet retry after a short delay covers most of them
// instead of surfacing "Ошибка AI" to the player for a blip that would've gone
// through a second later. 4xx responses are NOT retried — retrying a bad
// request/auth error won't fix it, just wastes a second.
async function _fetchWithRetry(url, options, retries = 1) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok && res.status >= 500 && attempt < retries) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw err;
    }
  }
}

async function ollamaChat(messages, jsonMode = false, conf = cfg) {
  const isCloud = conf.ollamaMode === 'cloud';
  const url     = isCloud ? 'https://ollama.com/api/chat' : `${conf.url}/api/chat`;
  const headers = { 'Content-Type': 'application/json' };
  if (isCloud && conf.ollamaCloudKey) headers['Authorization'] = `Bearer ${conf.ollamaCloudKey}`;
  const res = await _fetchWithRetry(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: conf.model, messages, stream: false,
      //think: false,                              // disable thinking for models that support it
      ...(conf.cacheMode && !isCloud ? { keep_alive: '30m' } : {}),
      ...(jsonMode ? { format: 'json' } : {})
    })
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const msg = (await res.json()).message ?? {};
  // Prefer message.content; thinking content (if any) goes to message.thinking
  return _stripThinking(msg.content ?? '');
}

async function openrouterChat(messages, jsonMode = false, conf = cfg) {
  if (!conf.openrouterKey) throw new Error('OpenRouter API key не задан');
  const outMessages = conf.cacheMode
    ? messages.map(m => m.role !== 'system' ? m : {
        ...m,
        content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }]
      })
    : messages;
  const res = await _fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${conf.openrouterKey}`,
      'HTTP-Referer': 'https://github.com/DOG729/Lux-Aeterna-Dungeon-Roguelike',
      'X-Title': 'Lux Aeterna Dungeon Game'
    },
    body: JSON.stringify({
      model: conf.openrouterModel, messages: outMessages,
      //include_reasoning: false,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    })
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  return _stripThinking((await res.json()).choices?.[0]?.message?.content ?? '');
}

// Caller identity for the dev log, without touching any call site: reads the
// stack frame just above aiChat() itself (raw[0]="Error", raw[1]=_callerLabel,
// raw[2]=aiChat, raw[3]=the actual caller).
function _callerLabel() {
  const raw  = (new Error().stack ?? '').split('\n');
  const line = (raw[3] ?? '').trim().replace(/^at\s+/, '');
  return line.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/'), '') || null;
}

function _modelLabel(conf) {
  return conf.provider === 'openrouter' ? conf.openrouterModel : conf.model;
}

async function aiChat(messages, jsonMode = false, conf = cfg) {
  const t0     = DEV_MODE ? Date.now()        : 0;
  const caller = DEV_MODE ? _callerLabel()     : null;
  try {
    const raw = conf.provider === 'openrouter'
      ? await openrouterChat(messages, jsonMode, conf)
      : await ollamaChat(messages, jsonMode, conf);
    if (DEV_MODE) pushAiLog({
      ok: true, provider: conf.provider, model: _modelLabel(conf),
      jsonMode, caller, messages, response: raw, ms: Date.now() - t0
    });
    return raw;
  } catch (err) { 
    if (DEV_MODE) pushAiLog({
      ok: false, provider: conf.provider, model: _modelLabel(conf),
      jsonMode, caller, messages,
      error: err.cause ? `${err.message}: ${err.cause.message ?? err.cause}` : err.message,
      ms: Date.now() - t0
    });
    throw err;
  }
}

// ── Native tool calling (OpenAI-style tools/tool_calls) ────────────────────────
// Both Ollama's /api/chat and OpenRouter's /v1/chat/completions accept the same
// request shape: tools: [{ type: 'function', function: { name, description, parameters } }].
// Response shapes differ slightly (OpenRouter nests under choices[0].message and
// stringifies `arguments`; Ollama returns message directly, arguments often already
// an object) — normalized here into { content, toolCalls: [{ name, arguments }] }.
// Separate from aiChat() (not a mode flag on it) so every existing string-returning
// call site is untouched — only code that explicitly wants tools opts in.

function _safeJsonParse(str) {
  if (typeof str !== 'string') return str ?? {};
  try { return JSON.parse(str); } catch { return {}; }
}

// id is preserved (with a positional fallback if the provider omits one, e.g. some
// Ollama models) so callers can echo it back exactly in a follow-up `role:'tool'`
// message — OpenAI-style providers match tool results to calls strictly by id.
function _normalizeToolCalls(rawCalls) {
  return (rawCalls ?? []).map((tc, i) => ({
    id:        tc.id ?? `call_${i}`,
    name:      tc.function?.name,
    arguments: _safeJsonParse(tc.function?.arguments)
  })).filter(tc => tc.name);
}

async function ollamaChatTools(messages, tools, conf = cfg) {
  const isCloud = conf.ollamaMode === 'cloud';
  const url     = isCloud ? 'https://ollama.com/api/chat' : `${conf.url}/api/chat`;
  const headers = { 'Content-Type': 'application/json' };
  if (isCloud && conf.ollamaCloudKey) headers['Authorization'] = `Bearer ${conf.ollamaCloudKey}`;
  const res = await _fetchWithRetry(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: conf.model, messages, tools, stream: false,
      ...(conf.cacheMode && !isCloud ? { keep_alive: '30m' } : {})
    })
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const msg = (await res.json()).message ?? {};
  return {
    content: _stripThinking(msg.content ?? ''),
    toolCalls: _normalizeToolCalls(msg.tool_calls),
    assistantMessage: { role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls ?? undefined }
  };
}

async function openrouterChatTools(messages, tools, conf = cfg) {
  if (!conf.openrouterKey) throw new Error('OpenRouter API key не задан');
  const outMessages = conf.cacheMode
    ? messages.map(m => m.role !== 'system' ? m : {
        ...m,
        content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }]
      })
    : messages;
  const res = await _fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${conf.openrouterKey}`,
      'HTTP-Referer': 'https://github.com/DOG729/Lux-Aeterna-Dungeon-Roguelike',
      'X-Title': 'Lux Aeterna Dungeon Game'
    },
    body: JSON.stringify({ model: conf.openrouterModel, messages: outMessages, tools })
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const msg = (await res.json()).choices?.[0]?.message ?? {};
  return {
    content: _stripThinking(msg.content ?? ''),
    toolCalls: _normalizeToolCalls(msg.tool_calls),
    assistantMessage: { role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls ?? undefined }
  };
}

// Returns { content, toolCalls: [{ id, name, arguments }], assistantMessage }.
// toolCalls is [] when the model just replied normally (no tool needed, or the
// model/provider ignored `tools`). assistantMessage is ready to push straight back
// into the next call's messages array (see npc.js's lore-lookup follow-up).
async function aiChatTools(messages, tools, conf = cfg) {
  const t0     = DEV_MODE ? Date.now()    : 0;
  const caller = DEV_MODE ? _callerLabel() : null;
  try {
    const result = conf.provider === 'openrouter'
      ? await openrouterChatTools(messages, tools, conf)
      : await ollamaChatTools(messages, tools, conf);
    if (DEV_MODE) pushAiLog({
      ok: true, provider: conf.provider, model: _modelLabel(conf), tools: true, caller, messages,
      toolsOffered: tools.map(x => x.function?.name),
      toolsCalled:  result.toolCalls.map(c => `${c.name}(${JSON.stringify(c.arguments)})`),
      response: result.toolCalls.length ? JSON.stringify(result.toolCalls) : result.content,
      ms: Date.now() - t0
    });
    return result;
  } catch (err) {
    if (DEV_MODE) pushAiLog({
      ok: false, provider: conf.provider, model: _modelLabel(conf), tools: true, caller, messages,
      toolsOffered: tools.map(x => x.function?.name),
      error: err.cause ? `${err.message}: ${err.cause.message ?? err.cause}` : err.message,
      ms: Date.now() - t0
    });
    throw err;
  }
}

// ── AI availability check (cached per settings signature for process lifetime) ─
// Verified state auto-invalidates when the player changes provider settings,
// because the signature is derived from the current cfg values.

function _aiSignature(c = cfg) {
  return [c.provider, c.model, c.url, c.ollamaMode, c.ollamaCloudKey,
          c.openrouterModel, c.openrouterKey].join('|');
}

let _verifiedSig = null;
const isAiVerified   = (conf = cfg) => _verifiedSig === _aiSignature(conf);
const markAiVerified = (conf = cfg) => { _verifiedSig = _aiSignature(conf); };

// Separate cache: does the CURRENT model/provider reliably use native tool calling?
// Set by aiTestTools() passing in the settings modal. Runtime code (npc.js lore
// lookup) checks this to pick native tools vs the JSON-mode fallback pattern —
// never re-tests tools on every chat call, only on settings changes.
let _toolsVerifiedSig = null;
const isToolsSupported   = (conf = cfg) => _toolsVerifiedSig === _aiSignature(conf);
const markToolsSupported = (conf = cfg) => { _toolsVerifiedSig = _aiSignature(conf); };

// ── Model self-tests ──────────────────────────────────────────────────────────
// Each test returns { id, ok, ms, detail }.

const TEST_ACTIONS = ['attack', 'defend', 'wait', 'heal'];

async function _timed(id, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { id, ok: true,  ms: Date.now() - t0, detail: detail ?? '' };
  } catch (e) {
    return { id, ok: false, ms: Date.now() - t0, detail: e.message ?? String(e) };
  }
}

// 1. Connectivity: does the provider answer at all?
function aiTestBasic(conf = cfg) {
  const T = (key, fb) => t('server', 'ai_test', key, fb);
  return _timed('basic', async () => {
    const reply = await aiChat([
      { role: 'system', content: 'You are a connectivity test. Reply with the single word: PONG' },
      { role: 'user',   content: 'ping' }
    ], false, conf);
    if (!reply) throw new Error(T('basic_empty', 'Провайдер вернул пустой ответ'));
    return T('basic_ok_detail', 'Модель на связи и отвечает');
  });
}

// 2. Combat analog: mob roleplay prompt — model must reply in the combat format
//    and pick a valid action command (same contract as a real battle turn).
function aiTestCombat(conf = cfg, jsonMode = false) {
  const T = (key, fb) => t('server', 'ai_test', key, fb);
  return _timed('combat', async () => {
    const formatInstr = jsonMode
      ? T('format_json', 'Отвечай СТРОГО в формате JSON без markdown (одна строка):\n{"action":"[attack/defend/wait/heal]","speech":"что говоришь вслух 1-2 предложения","notes":"заметка или пусто"}')
      : T('format_text', 'Отвечай СТРОГО в таком формате (три строки, не больше):\nACTION: [attack/defend/wait/heal]\nSPEECH: [что ты говоришь вслух — 1-2 предложения]\nNOTES: [личная заметка, или пусто]');
    const system = `${T('combat_system', 'Ты — Тестовый Скелет в подземелье. Ты дерзкий и самоуверенный. Твои пределы: HP=100, Энергия=100.')}\n${formatInstr}`;
    const user   = T('combat_turn', 'Противник заносит меч для удара. Твой ход.');

    const reply  = await aiChat([
      { role: 'system', content: system },
      { role: 'user',   content: user }
    ], jsonMode, conf);
    const parsed = parseMobReply(reply, jsonMode);
    if (!TEST_ACTIONS.includes(parsed.action))
      throw new Error(t('server', 'ai_test', ['combat_bad_action', { action: parsed.action }],
        `Модель выбрала неизвестное действие «${parsed.action}»`));
    if (!parsed.speech || parsed.speech === '...')
      throw new Error(T('combat_no_speech', 'Модель не сформировала реплику персонажа'));

    const actionLabel = CORE.mechanics?.ability?.[parsed.action]?.label ?? parsed.action;
    return t('server', 'ai_test', ['combat_ok_detail', { action: actionLabel }],
      `Выбрала действие «${actionLabel}» и ответила в нужном формате`);
  });
}

// 3. Combat-info perception: model gets explicit battle numbers and must
//    correctly interpret them as structured JSON (persuasion-classifier analog).
function aiTestPerception(conf = cfg) {
  const T = (key, fb) => t('server', 'ai_test', key, fb);
  return _timed('perception', async () => {
    const reply = await aiChat([
      { role: 'system', content:
        'You are a combat state classifier for an RPG.\n' +
        'You will get a battle report. Reply ONLY with valid JSON on one line:\n' +
        '{"low_hp":true|false,"enemy_stronger":true|false}' },
      { role: 'user', content:
        'Your HP: 12 of 100. Your energy: 80 of 100. Enemy HP: 95 of 100. Enemy hits for 30, you hit for 10.' }
    ], true, conf);
    const j = JSON.parse(reply.replace(/```(?:json)?\n?/g, '').trim());
    if (j.low_hp !== true)
      throw new Error(T('perception_bad_hp', 'Не распознала критически низкое здоровье'));
    if (j.enemy_stronger !== true)
      throw new Error(T('perception_bad_threat', 'Не распознала превосходство противника'));
    return T('perception_ok_detail', 'Верно оценила низкое здоровье и угрозу от противника');
  });
}

// 4. JSON-mode reliability for the "lore lookup" pattern — a nullable field the
//    model must only fill in when it actually applies (not just "produce any JSON").
//    This is the exact shape used by knows_lore lookups in npc.js: {speech, lore_topic}.
//    Only meaningful when the provider's JSON mode is actually enabled — callers should
//    skip this step entirely otherwise (see routes/ai.js STEP_RUNNERS / public/js/settings.js).
function aiTestJson(conf = cfg) {
  const T = (key, fb) => t('server', 'ai_test', key, fb);
  return _timed('json', async () => {
    const reply = await aiChat([
      { role: 'system', content:
        'You are testing structured output for an RPG NPC. Reply ONLY with valid JSON on one line:\n' +
        '{"speech":"a short in-character reply","lore_topic":"topic key, or null if none apply"}\n' +
        'Available topics: {"weather":"information about the weather"}.\n' +
        'The player is asking about the weather, so lore_topic must be "weather".' },
      { role: 'user', content: 'What is the weather like today?' }
    ], true, conf);
    const clean = reply.replace(/```(?:json)?\n?/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { throw new Error(T('json_invalid', 'Ответ не является валидным JSON')); }
    if (!parsed.speech) throw new Error(T('json_no_speech', 'JSON валиден, но не хватает поля speech'));
    if (parsed.lore_topic !== 'weather') throw new Error(T('json_bad_topic', 'Не заполнила условное поле по инструкции'));
    return T('json_ok_detail', 'Надёжно возвращает структурированный JSON с условными полями');
  });
}

// 5. Native tool-calling capability (OpenAI-style tools/tool_calls) — separate from
//    JSON mode. Passing this marks the model via markToolsSupported() so runtime code
//    (npc.js lore lookup) prefers native tools; failing it just means the JSON-mode
//    pattern (aiTestJson) is used instead — not a hard blocker, see routes/ai.js.
const TEST_TOOL = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the current weather for a location',
    parameters: {
      type: 'object',
      properties: { location: { type: 'string', description: 'City name' } },
      required: ['location']
    }
  }
};

function aiTestTools(conf = cfg) {
  const T = (key, fb) => t('server', 'ai_test', key, fb);
  return _timed('tools', async () => {
    const { toolCalls } = await aiChatTools([
      { role: 'system', content: 'You are a test assistant. Use the get_weather tool whenever asked about weather.' },
      { role: 'user',   content: 'What is the weather like in Paris right now?' }
    ], [TEST_TOOL], conf);
    const call = toolCalls.find(c => c.name === 'get_weather');
    if (!call) throw new Error(T('tools_not_called', 'Модель не вызвала инструмент'));
    if (!call.arguments?.location) throw new Error(T('tools_bad_args', 'Вызвала инструмент, но без нужных аргументов'));
    return T('tools_ok_detail', 'Надёжно вызывает инструменты (native tool calling)');
  });
}

// ── Quality score: how well the model fits real-time turn-based combat ────────
// allPassed → score 70..100 driven by average latency (faster = better fit for
// a turn-based battle loop); any failed test caps the score low regardless of speed.
function rateAiResults(results, testCfg = AI_TEST_CFG) {
  const total  = results.length;
  const passed = results.filter(r => r.ok).length;
  const allPassed = total > 0 && passed === total;

  let score, avgMs = null;
  if (allPassed) {
    avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / total);
    const { excellent, good, fair } = testCfg.speed_ms;
    const speedScore = avgMs <= excellent ? 1 : avgMs <= good ? 0.7 : avgMs <= fair ? 0.4 : 0.15;
    score = Math.round(testCfg.score_all_passed_base + speedScore * testCfg.score_all_passed_speed_weight);
  } else {
    score = Math.round((passed / total) * testCfg.score_partial_multiplier);
  }
  score = Math.max(0, Math.min(100, score));

  const rating = [...testCfg.ratings]
    .sort((a, b) => b.min_score - a.min_score)
    .find(r => score >= r.min_score) ?? testCfg.ratings[testCfg.ratings.length - 1];

  return { score, ratingKey: rating.key, avgMs };
}

function buildPromtText(promt) {
  if (!promt || typeof promt === 'string') return promt ?? '';
  const L    = key => t('server', 'mob_system', key, key);
  const parts = [];
  if (promt.general)             parts.push(`${L('promt_general')}: ${promt.general}`);
  if (promt.soul)                parts.push(`${L('promt_soul')}: ${promt.soul}`);
  if (promt.behavior)            parts.push(`${L('promt_behavior')}: ${promt.behavior}`);
  if (promt.communication_style) parts.push(`${L('promt_communication_style')}: ${promt.communication_style}`);
  return parts.join('. ');
}

function loadLangFile(pathTemplate) {
  const resolve = lang => path.join(ROOT, pathTemplate.replace('{lang}', lang));
  const active  = resolve(cfg.lang ?? 'en');
  if (fs.existsSync(active)) return fs.readFileSync(active, 'utf8').trim();
  const fallback = resolve(CORE_LANG);
  if (fs.existsSync(fallback)) return fs.readFileSync(fallback, 'utf8').trim();
  return null;
}

const loadNarratorPrompt = loadLangFile;

async function narrateText(text, syspromptOverride = null) {
  const base = syspromptOverride
    ?? t('server', 'mob_system', 'narrate_system',
        'You are a narrator of a dark fantasy RPG. Rephrase the following encounter description — one paragraph, atmospheric, dark fantasy style. Add nothing extra.');
  const sysprompt = `${base}\nRespond only in ${langName()}.`;
  return aiChat([
    { role: 'system', content: sysprompt },
    { role: 'user',   content: text }
  ]);
}

// Returns the static part of the mob system prompt (stable for the entire combat).
// Dynamic per-turn info (player hints, surrender note, memory) is added to the
// user turn message by the caller when cacheMode is enabled.
function mobSystempromt(mob, canSurrender = false, jsonMode = false, player = null) {
  const M = (key, fb) => t('server', 'mob_system', key, fb);

  const hasMemory = mob.memory.length > 0;
  const memoryStr = hasMemory
    ? mob.memory.slice(-5).join('\n')
    : M('memory_empty', 'Ничего пока.');
  // Context alone is easy for weaker models to ignore — spell out that it must
  // actually shape behavior, not just sit there as inert background text.
  const memoryInstr = hasMemory
    ? M('memory_instruction', 'Учитывай эти заметки в бою — пусть они влияют на твоё поведение и тон, но не пересказывай их дословно.')
    : '';

  // playerHints: in system only when cacheMode OFF (otherwise → turn message)
  let playerHintStr = '';
  if (!cfg.cacheMode && player) {
    const playerHints = [];
    if (player.hp     / player.maxHp     < 0.3) playerHints.push(M('obs_player_hurt',  'твой противник сильно ранен'));
    if (player.energy / player.maxEnergy < 0.3) playerHints.push(M('obs_player_tired', 'твой противник сильно устал'));
    if (playerHints.length) playerHintStr = `\n${M('obs_prefix', 'Наблюдение')}: ${playerHints.join(', ')}.`;
  }

  // surrenderNote always in system (both modes) — one cache miss when surrender unlocks,
  // but keeps the instruction authoritative so the mob actually acts on it.
  let surrenderNote = '';
  if (canSurrender) {
    const lowHp = mob.hp     / mob.maxHp     < 0.3;
    const lowEn = mob.energy / mob.maxEnergy < 0.3;
    const st    = lowHp && lowEn ? M('state_low_hp_energy', 'Ты тяжело ранен и полностью измотан')
                : lowHp          ? M('state_low_hp',         'Ты тяжело ранен')
                : lowEn          ? M('state_low_energy',     'Ты полностью измотан')
                :                  M('state_weak',            'Ты слаб');
    surrenderNote = '\n\n' + M(
      'surrender_note',
      'Противник пытается тебя убедить. {state} — можешь выбрать surrender, чтобы признать поражение и сохранить жизнь. Решай согласно своему характеру.'
    ).replace('{state}', st);
  }

  const actionList = `attack/defend/wait/heal${canSurrender ? '/surrender' : ''}`;

  const formatInstr = jsonMode
    ? M('format_json', `Отвечай СТРОГО в формате JSON без markdown (одна строка):\n{"action":"[{actions}]","speech":"что говоришь вслух 1-2 предложения","notes":"заметка или пусто"}`).replace('{actions}', actionList)
    : M('format_text', `Отвечай СТРОГО в таком формате (три строки, не больше):\nACTION: [{actions}]\nSPEECH: [что ты говоришь вслух — 1-2 предложения]\nNOTES: [личная заметка о поведении врага в этом ходу, или пусто]`).replace('{actions}', actionList);

  const header    = M('header',        'Ты — {name} в подземелье. {promt}')
    .replace('{name}', mob.name).replace('{promt}', buildPromtText(mob.promt));
  const statsLine = M('stats_line', 'Твои пределы: HP={maxHp}, Энергия={maxEnergy}.')
    .replace('{maxHp}', mob.maxHp).replace('{maxEnergy}', mob.maxEnergy);
  const memHeader = M('memory_header', 'Твои заметки о противнике:');
  const langHint  = M('lang_hint',     'Говори коротко, по-русски, оставаясь в образе.');

  return `${header}\n${statsLine}\n${memHeader}\n${memoryStr}\n${memoryInstr}${playerHintStr}${surrenderNote}\n\n${langHint}\n${formatInstr}`;
}

function parseMobReply(text, jsonMode = false) {
  if (jsonMode) {
    try {
      const clean = text.replace(/```(?:json)?\n?/g, '').trim();
      const j = JSON.parse(clean);
      return {
        action: (j.action ?? 'wait').toLowerCase().trim(),
        speech: j.speech ?? '...',
        notes:  j.notes  ?? ''
      };
    } catch { /* fallback to regex */ }
  }
  const action = (text.match(/ACTION:\s*(\w+)/i)?.[1] ?? 'wait').toLowerCase().trim();
  const speech  = text.match(/SPEECH:\s*(.+?)(?=\nNOTES:|$)/si)?.[1]?.trim() ?? '...';
  const notes   = text.match(/NOTES:\s*(.+?)$/si)?.[1]?.trim()               ?? '';
  return { action, speech, notes };
}

// Evaluates whether the player's message genuinely appeals to THIS mob's specific
// personality, desires or motivations — not just generic "I want peace".
// Returns true only if: matching ai_surrender script exists, msg is long enough, and AI agrees.
async function checkAiSurrender(mob, playerMsg, ctx) {
  if (!mob.script?.length || !playerMsg) return false;

  const entries = mob.script.filter(e =>
    e.type === 'ai_surrender' && evalAll(e.if ?? [], ctx)
  );
  if (!entries.length) return false;

  const minLen = Math.min(...entries.map(e => e.min_msg_length ?? 20));
  if (playerMsg.length < minLen) return false;

  // Collect hints from all matching entries
  const hints = entries.map(e => e.hint).filter(Boolean);

  const mobDesc = typeof mob.promt === 'string' ? mob.promt
    : mob.promt ? buildPromtText(mob.promt) : '';

  const hintLine = hints.length
    ? `\nAdditional context: ${hints.join(' ')}`
    : '';

  const systemPrompt =
    `You are a persuasion classifier for a dark fantasy RPG.\n` +
    `Character: ${mob.name}\n` +
    `Character's personality and desires: ${mobDesc}${hintLine}\n\n` +
    `Does the player's message specifically appeal to this character's desires, fears, or motivations ` +
    `in a way that could genuinely convince them to surrender or stop fighting? ` +
    `Generic peace appeals don't count — the argument must resonate with WHO this character is.\n` +
    `Reply ONLY with valid JSON on one line: {"persuasion":true} or {"persuasion":false}. Any language.`;

  try {
    const raw = await aiChat([
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: playerMsg.slice(0, 255) }
    ], true);
    const j = JSON.parse(raw.replace(/```(?:json)?\n?/g, '').trim());
    return j.persuasion === true;
  } catch {
    return false;
  }
}

module.exports = { aiChat, aiChatTools, buildPromtText, loadLangFile, mobSystempromt, parseMobReply, narrateText, loadNarratorPrompt, checkAiSurrender,
                   isAiVerified, markAiVerified, isToolsSupported, markToolsSupported,
                   aiTestBasic, aiTestCombat, aiTestPerception, aiTestJson, aiTestTools, rateAiResults };
