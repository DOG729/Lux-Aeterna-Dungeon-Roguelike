'use strict';
import { state }            from './state.js';
import { u, ufmt }          from './i18n.js';
import { api }              from './api.js';
import { $, showScreen, toast, icon } from './dom.js';
import { resolveImagsSpec, resolveTextVariant } from './conditions.js';
import { music }            from './music.js';
import { sfx }              from './sfx.js';

// ── Action labels ─────────────────────────────────────────────────────────────

function actionLabel() {
  return {
    attack:    u('combat', 'action_attack',    'Атака'),
    defend:    u('combat', 'action_defend',    'Защита'),
    wait:      u('combat', 'action_wait',      'Ожидание'),
    heal:      u('combat', 'action_heal',      'Исцеление'),
    surrender: u('combat', 'action_surrender', 'Сдаётся'),
    flee:      u('combat', 'action_flee',      'Побег')
  };
}

// ── Sprite / effect animation ─────────────────────────────────────────────────

let _fxTimers = [];

function _clearFx() {
  _fxTimers.forEach(clearTimeout);
  _fxTimers = [];
}

// Sync overlay layer <img>s inside wrap to match the resolved layers array.
function _applyPlayerLayers(wrap, layers) {
  wrap.querySelectorAll('.player-layer').forEach(el => el.remove());
  for (const url of layers) {
    const img = document.createElement('img');
    img.className = 'player-layer';
    img.src = url;
    img.alt = '';
    wrap.appendChild(img);
  }
}

function playSprite(imgEl, imags, action, totalMs = 680) {
  if (!imags) return;
  const src = imags[action];
  if (!src) return;
  const frames   = Array.isArray(src) ? src : [src];
  const perFrame = Math.max(80, Math.floor(totalMs / frames.length));
  frames.forEach((f, i) =>
    _fxTimers.push(setTimeout(() => { imgEl.src = f; }, i * perFrame))
  );
  if (imags.default) {
    _fxTimers.push(setTimeout(
      () => { imgEl.src = imags.default; },
      frames.length * perFrame + 80
    ));
  }
}

function showEffect(effectEl, src, durationMs = 750) {
  if (!src || !effectEl) return;
  effectEl.src = Array.isArray(src) ? src[0] : src;
  effectEl.classList.add('fx-on');
  _fxTimers.push(setTimeout(() => effectEl.classList.remove('fx-on'), durationMs));
}

export function playDeadSprite(imgEl, imags, delayMs, durationMs = 700) {
  if (!imags?.dead) return delayMs;
  const frames   = Array.isArray(imags.dead) ? imags.dead : [imags.dead];
  const perFrame = Math.max(80, Math.floor(durationMs / frames.length));
  frames.forEach((f, i) =>
    _fxTimers.push(setTimeout(() => { imgEl.src = f; }, delayMs + i * perFrame))
  );
  return delayMs + frames.length * perFrame;
}

let _combatCfg = null;

function _animatePlayer(playerAction, log, mobAction) {
  const playerImg   = $('cbt-player-img');
  const mobImg      = $('cbt-mob-img');
  const playerFx    = $('cbt-player-effect');
  const mobFx       = $('cbt-mob-effect');
  const { resolved: playerImags } = resolveImagsSpec(state.G?.playerImagsSpec, state.G, '/assets/');
  const pEffects    = playerImags?.effects ?? {};
  const playerCrit  = log.some(l => l.type === 'crit-ai');

  playSprite(playerImg, playerImags, playerAction);

  // ── SFX: player ability sound ──
  sfx.playAbility(
    state.G?.playerSoundSpec,
    playerAction,
    playerCrit,
    state.G?.abilities?.[playerAction],
    mobAction,
    state.G?.playerSoundVolume ?? null
  );

  const playerAbType = state.G?.abilities?.[playerAction]?.action ?? null;
  if (playerAbType === 'attack') {
    showEffect(mobFx, _getEffect(pEffects, playerAction, false));
    if (playerCrit) setTimeout(() => showEffect(mobFx, _getEffect(pEffects, playerAction, true)), 150);
    const pw = $('cbt-player-wrap');
    pw.classList.add('anim-attack');
    setTimeout(() => pw.classList.remove('anim-attack'), 420);
    const blocked = log.some(l => l.type === 'blocked' && !l.text.includes('Игрок блокирует'));
    if (!blocked) setTimeout(() => {
      mobImg.classList.add('anim-hit');
      setTimeout(() => mobImg.classList.remove('anim-hit'), 450);
    }, 250);
  } else {
    showEffect(playerFx, _getEffect(pEffects, playerAction, false));
  }
}

function _animateMob(mobAction, log, mobImags, playerAction) {
  const playerImg = $('cbt-player-img');
  const mobImg    = $('cbt-mob-img');
  const playerFx  = $('cbt-player-effect');
  const mobFx     = $('cbt-mob-effect');
  const mEffects  = mobImags?.effects ?? {};
  const mobCrit   = log.some(l => l.type === 'crit-player');

  playSprite(mobImg, mobImags, mobAction);

  // ── SFX: mob ability sound ──
  const mobAbDef  = state.G?.combat?.mob?.abilities?.[mobAction];
  const mobAbType = mobAbDef?.action ?? null;
  sfx.playAbility(
    state.G?.combat?.mob?.sound,
    mobAction,
    mobCrit,
    mobAbDef,
    playerAction,
    state.G?.combat?.mob?.soundVolume ?? null
  );

  // ── SFX: mob damage-received sound ────────────────────────────────────────
  // Plays when player lands an attack and mob did NOT use damage_reduction
  const playerAbDef = state.G?.abilities?.[playerAction];
  if (playerAbDef?.action === 'attack' && mobAbType !== 'damage_reduction') {
    const playerHitCrit = log.some(l => l.type === 'crit-ai');
    sfx.playDamageReceived(
      state.G?.combat?.mob?.sound,
      playerHitCrit,
      state.G?.combat?.mob?.soundVolume ?? null
    );
  }
  if (mobAbType === 'attack') {
    showEffect(playerFx, _getEffect(mEffects, mobAction, false));
    if (mobCrit) setTimeout(() => showEffect(playerFx, _getEffect(mEffects, mobAction, true)), 150);
    const mw = $('cbt-mob-wrap');
    mw.classList.add('anim-mob-attack');
    setTimeout(() => mw.classList.remove('anim-mob-attack'), 420);
    const blocked = log.some(l => l.type === 'blocked' && l.text.includes('Игрок блокирует'));
    if (!blocked) setTimeout(() => {
      playerImg.classList.add('anim-hit');
      setTimeout(() => playerImg.classList.remove('anim-hit'), 450);
    }, 250);
  } else {
    showEffect(mobFx, _getEffect(mEffects, mobAction, false));
  }
}

async function animateCombat(playerAction, mobAction, log, mobImags) {
  _clearFx();

  if (!_combatCfg) {
    try { _combatCfg = await api('GET', '/api/combat-config'); }
    catch { _combatCfg = { delay_ms: 700, sequential: ['attack:attack'] }; }
  }

  const isSequential = (_combatCfg.sequential ?? []).includes(`${playerAction}:${mobAction}`);
  const delayMs      = _combatCfg.delay_ms ?? 700;
  const mobFirst     = isSequential && _combatCfg.first_action === 'mob';
  const SPRITE_MS    = 680;

  if (isSequential) {
    if (mobFirst) {
      _animateMob(mobAction, log, mobImags, playerAction);
      _fxTimers.push(setTimeout(() => _animatePlayer(playerAction, log, mobAction), delayMs));
    } else {
      _animatePlayer(playerAction, log, mobAction);
      _fxTimers.push(setTimeout(() => _animateMob(mobAction, log, mobImags, playerAction), delayMs));
    }
    return delayMs + SPRITE_MS;
  } else {
    _animatePlayer(playerAction, log, mobAction);
    _animateMob(mobAction, log, mobImags, playerAction);
    return SPRITE_MS;
  }
}

// ── Bar fill ──────────────────────────────────────────────────────────────────

function updateBarFill(el, value, max) {
  const p = Math.max(0, Math.min(1, value / max));
  const L = 14, R = 14, T = 30, B = 28;
  const rightClip = R + (1 - p) * (100 - L - R);
  el.style.clipPath = `inset(${T}% ${rightClip.toFixed(1)}% ${B}% ${L}%)`;
}

// ── Ability buttons ───────────────────────────────────────────────────────────

function renderAbilities(abilities, playerActions) {
  const container = $('cbt-actions');
  if (!container) return;

  const labels = actionLabel();
  const makeBtn = (id, ab, extraClass = '') => {
    const cost = ab.energy_cost ?? 0;
    const fleeChance = u('combat', 'flee_chance', '% шанс');
    const enIcon = icon('energy', 'icon icon-sm');
    const hpIcon = icon('hp', 'icon icon-sm');
    const costText = cost > 0
      ? `−${cost} ${enIcon}${ab.action === 'add_hp'
          ? ` | +${ab.int} ${hpIcon}`
          : ab.action === 'flee'
            ? ` | ${Math.round((ab.chance ?? 0) * 100)}${fleeChance}`
            : ''}`
      : `+${ab.int ?? 0} ${enIcon}`;
    const cdSpan = (ab.loop ?? 1) > 1 ? `<span class="act-cd" id="c-${id}-cd"></span>` : '';
    const abIconImg = ab.icon ? `<img src="/assets/${ab.icon}" alt="" onerror="this.style.display='none'">` : '';
    return `<button class="act-btn${extraClass}" id="c-btn-${id}" data-action="${id}">`
      + `<span>${labels[id] ?? ab.label ?? id}</span>${abIconImg}<small>${costText}</small>${cdSpan}</button>`;
  };

  const abilityHtml      = Object.entries(abilities ?? {}).map(([id, ab]) => makeBtn(id, ab)).join('');
  const playerActionHtml = Object.entries(playerActions ?? {}).map(([id, ab]) => makeBtn(id, ab, ` act-btn-${id}`)).join('');
  container.innerHTML = abilityHtml + playerActionHtml;

  container.querySelectorAll('[data-action]').forEach(btn => {
    const id = btn.dataset.action;
    btn.addEventListener('click', () => {
      if (state.G?.player_actions?.[id]) doFlee();
      else doTurn(id);
    });
  });
}

export function updateCombatButtons() {
  if (!state.G) return;
  const { player, combat } = state.G;
  const off   = state.busy || !combat;
  const mercy = !!state.G.combat?.pendingMercy;

  for (const [id, ab] of Object.entries(state.G.abilities ?? {})) {
    const btn = document.getElementById(`c-btn-${id}`);
    if (!btn) continue;
    const onCd = (player.abilityCooldowns?.[id] ?? 0) > 0;
    btn.disabled = off || mercy || player.energy < (ab.energy_cost ?? 0) || onCd;
  }
  for (const [id, pa] of Object.entries(state.G.player_actions ?? {})) {
    const btn = document.getElementById(`c-btn-${id}`);
    if (!btn) continue;
    let dis = off || mercy || player.energy < (pa.energy_cost ?? 0);
    if (pa.once_per_combat)                dis ||= !!state.G.combat?.fleeAttempted;
    if (pa.condition?.hp_ratio_below != null) dis ||= (player.hp / player.maxHp) >= pa.condition.hp_ratio_below;
    btn.disabled = dis;
  }
}

// ── Effect lookup by ability ID ───────────────────────────────────────────────
//
// effects map keyed by ability ID:
//   "heal":   "path.png"                          → plain (no crit variant)
//   "attack": { "hit": "path.png", "crit": "c.png" } → hit + optional crit
//   any value can also be an array of frame paths
//
function _getEffect(effects, abilityId, isCrit = false) {
  const entry = effects?.[abilityId];
  if (!entry) return null;
  if (typeof entry === 'string' || Array.isArray(entry)) return entry;   // plain path/frames
  if (typeof entry === 'object') return (isCrit && entry.crit) ? entry.crit : (entry.hit ?? null);
  return null;
}

// ── Boss phase banner ─────────────────────────────────────────────────────────

let _phaseBannerTimer = null;

function _showPhaseBanner(phaseName) {
  let banner = document.getElementById('phase-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'phase-banner';
    document.body.appendChild(banner);
  }
  banner.textContent = phaseName;
  banner.classList.remove('phase-banner-out');
  banner.classList.add('phase-banner-in');
  clearTimeout(_phaseBannerTimer);
  _phaseBannerTimer = setTimeout(() => {
    banner.classList.remove('phase-banner-in');
    banner.classList.add('phase-banner-out');
  }, 3000);
}

// ── Mob shadow style ──────────────────────────────────────────────────────────

const MOB_SHADOW_DEFAULT = '0 4px 12px rgba(80, 80, 255, 0.3)';

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function applyMobShadow(style) {
  const el = $('cbt-mob-img');
  if (!el) return;
  if (!style?.shadow_color) {
    el.style.filter = `drop-shadow(${MOB_SHADOW_DEFAULT})`;
    return;
  }
  const rgb     = hexToRgb(style.shadow_color);
  const opacity = style.shadow_opacity ?? 0.3;
  el.style.filter = `drop-shadow(0 4px 12px rgba(${rgb}, ${opacity}))`;
}

// ── Render combat screen ──────────────────────────────────────────────────────

export function renderCombat() {
  if (!state.G?.combat) return;
  const { player, combat } = state.G;
  const mob = combat.mob;

  $('c-php').textContent = player.hp;
  updateBarFill($('c-php-bar'), player.hp, player.maxHp);
  $('c-pen').textContent = player.energy;
  updateBarFill($('c-pen-bar'), player.energy, player.maxEnergy);

  $('c-mob-name').textContent = mob.name;
  $('c-mhp').textContent = mob.hp;
  updateBarFill($('c-mhp-bar'), mob.hp, mob.maxHp);
  $('c-men').textContent = mob.energy;
  updateBarFill($('c-men-bar'), mob.energy, mob.maxEnergy);

  const { resolved: playerImags, layers: playerLayers } = resolveImagsSpec(state.G.playerImagsSpec, state.G, '/assets/');
  const mobImags = mob.imags;
  if (playerImags?.default) $('cbt-player-img').src = playerImags.default;
  _applyPlayerLayers($('cbt-player-wrap'), playerLayers);
  $('cbt-mob-img').src = mobImags?.default ?? mob.image;
  applyMobShadow(mob.style);

  renderAbilities(state.G.abilities, state.G.player_actions);
  for (const [id] of Object.entries(state.G.abilities ?? {})) {
    const cdEl = document.getElementById(`c-${id}-cd`);
    if (!cdEl) continue;
    const cd = player.abilityCooldowns?.[id] ?? 0;
    cdEl.textContent = cd > 0 ? `${cd}` : '';
  }

  const cbtItemsEl    = $('cbt-items');
  const elixirBlocked = !!state.G.combat?.elixirUsedThisTurn;
  cbtItemsEl.innerHTML = '';
  for (const item of (player.inventory ?? []).filter(i => i.use?.in_combat)) {
    const btn = document.createElement('button');
    btn.className = 'cbt-use-btn';
    btn.disabled  = elixirBlocked;
    btn.title     = elixirBlocked ? u('combat', 'elixir_blocked', 'Эликсир уже использован в этом ходу') : '';
    btn.innerHTML = `<img src="${item.image}" alt="" onerror="this.style.display='none'"> ${item.name} ×${item.count}`;
    btn.addEventListener('click', () => window.useItem(item.id));
    cbtItemsEl.appendChild(btn);
  }

  updateCombatButtons();
}

// ── Chat log ──────────────────────────────────────────────────────────────────

// iconName: optional assets/image/icon/<name>.png prefix (status lines only —
// `text` always goes in as a text node, never HTML, since player-typed chat
// messages flow through this same function).
function addChat(text, type = '', iconName = null) {
  const el = document.createElement('div');
  el.className = 'chat-entry' + (type ? ' ' + type : '');
  if (iconName) {
    el.insertAdjacentHTML('beforeend', icon(iconName, 'icon icon-sm'));
    el.appendChild(document.createTextNode(' ' + text));
  } else {
    el.textContent = text;
  }
  $('cbt-log').appendChild(el);
  $('cbt-chat-area').scrollTop = $('cbt-chat-area').scrollHeight;
  return el;
}

function addChatSep(turn) {
  const el = document.createElement('div');
  el.className   = 'chat-sep';
  el.textContent = ufmt('combat', 'turn_sep', { n: turn }, `── ХОД ${turn} ──`);
  $('cbt-log').appendChild(el);
}

// ── Enter combat ──────────────────────────────────────────────────────────────

async function _showNarration() {
  const narrative = state.G?.narrative;
  if (!narrative?.narrative) return;

  const mob    = state.G.combat?.mob;
  const npcSrc = mob?.sourceNpc;

  // Fighting a known NPC gets its own narrator (personal tension, not monster
  // horror) — see roadmap/npc_combat.md and narrative.json's *_combat prompts.
  const section = npcSrc
    ? (npcSrc.npcType === 'trader' ? narrative.NPC?.trader : narrative.NPC?.other)
    : narrative.beffore_combat;
  if (!section?.active) return;

  const vars = { mob_name: mob?.name ?? '', npc_name: mob?.name ?? '' };
  const spec = npcSrc ? section : (mob?.encounter_text ?? section);
  const { text, is_ai } = resolveTextVariant(spec, state.G, vars);
  if (!text) return;

  const narrateSection = npcSrc
    ? (npcSrc.npcType === 'trader' ? 'npc_trader_combat' : 'npc_other_combat')
    : undefined;

  let finalText = text;
  if (is_ai) {
    state.busy = true;
    updateCombatButtons();
    const el = addChat('…', 'narrator thinking');
    try {
      const data = await api('POST', '/api/narrate', { text, section: narrateSection });
      finalText = data.text || text;
      el.textContent = finalText;
    } catch {
      el.textContent = text;
    }
    el.classList.remove('thinking');
    state.busy = false;
    updateCombatButtons();
  } else {
    addChat(text, 'narrator');
  }
  api('POST', '/api/combat/narrator', { text: finalText }).catch(() => {});
}

function _restoreChatLog(chatLog) {
  const AL = actionLabel();
  for (const entry of chatLog) {
    const mobName = entry.mobName ?? u('combat', 'mob_placeholder', 'Противник');
    if (entry.playerMsg) addChat(`${u('combat', 'player_prefix', 'Вы')}: "${entry.playerMsg}"`, 'player-msg');
    addChatSep(entry.turn);
    addChat(
      `${u('combat', 'player_prefix', 'Вы')}: ${AL[entry.playerAction] ?? entry.playerAction}  |  ${mobName}: ${AL[entry.mobAction] ?? entry.mobAction}`,
      'actions'
    );
    for (const e of entry.log ?? []) addChat(e.text, e.type ?? '');
    if (entry.mobSpeech) addChat(`${mobName}: "${entry.mobSpeech}"`, 'mob-speech');
  }
}

export function enterCombat() {
  const isBoss = !!state.G?.combat?.mob?.isBoss;
  isBoss ? music.enterBattle('boss') : music.enterBattle();
  // Sync sfx defaults from core.json (sent with every pubSession)
  if (state.G?.coreSoundDefault       != null) sfx.setDefault(state.G.coreSoundDefault);
  if (state.G?.coreSoundDefaultVolume != null) sfx.setDefaultVolume(state.G.coreSoundDefaultVolume);
  if (state.G?.coreSoundDefaultMob    != null) sfx.setDefaultMobSounds(state.G.coreSoundDefaultMob);
  showScreen('combat');
  $('cbt-log').innerHTML = '';

  const preview = state.G.currentRoom?.preview ?? 'preview/default.png';
  $('cbt-arena').style.backgroundImage = `url('/assets/map/${preview}')`;

  // Boss indicator
  document.body.classList.toggle('boss-fight', isBoss);

  renderCombat();

  const savedLog = state.G.combat?.chatLog ?? [];
  if (savedLog.length > 0) {
    if (state.G.combat?.narratorText) addChat(state.G.combat.narratorText, 'narrator');
    _restoreChatLog(savedLog);
  } else {
    _showNarration();
  }
}

// ── Turn ──────────────────────────────────────────────────────────────────────

export async function doTurn(action) {
  if (state.busy || !state.G?.combat) return;
  state.busy = true;
  updateCombatButtons();

  const msg = $('cbt-msg').value.trim();
  if (msg) addChat(`${u('combat', 'player_prefix', 'Вы')}: "${msg}"`, 'player-msg');
  $('cbt-msg').value = '';
  $('cbt-msg-count').textContent = '0/255';

  const thinkEl = addChat(u('combat', 'thinking', 'Противник думает…'), 'thinking', 'hourglass');
  const data    = await api('POST', '/api/combat/turn', { message: msg, action });
  thinkEl.remove();

  if (data.error) {
    addChat(data.error, 'damage-player', 'error');
    state.busy = false;
    updateCombatButtons();
    return;
  }

  const prevMob         = state.G.combat?.mob ?? null;
  const prevMobImags    = prevMob?.imags ?? null;
  const prevPlayerImags = resolveImagsSpec(state.G.playerImagsSpec, state.G, '/assets/').resolved;

  state.G = data;

  const turnNum = state.G.combat?.turn ?? '?';
  addChatSep(turnNum);
  const AL = actionLabel();
  addChat(
    `${u('combat', 'player_prefix', 'Вы')}: ${AL[data.playerAction] ?? data.playerAction}  |  ${state.G.combat?.mob?.name ?? u('combat', 'mob_placeholder', 'Противник')}: ${AL[data.mobAction] ?? data.mobAction}`,
    'actions'
  );

  for (const entry of data.log ?? []) {
    addChat(entry.text, entry.type ?? '');
    if (entry.type === 'phase') _showPhaseBanner(entry.phase_name);
  }

  if (data.mobSpeech) {
    addChat(`${state.G.combat?.mob?.name ?? u('combat', 'mob_placeholder', 'Противник')}: "${data.mobSpeech}"`, 'mob-speech');
  }

  const animDuration = await animateCombat(data.playerAction, data.mobAction, data.log ?? [], prevMobImags);

  if (state.G.combat) {
    renderCombat();
    if (state.G.combat.pendingMercy) showMercyChoice();
    state.busy = false;
    updateCombatButtons();
  } else {
    const { player } = state.G;
    $('c-php').textContent = Math.max(0, player.hp);
    updateBarFill($('c-php-bar'), Math.max(0, player.hp), player.maxHp);
    $('c-pen').textContent = player.energy;
    updateBarFill($('c-pen-bar'), player.energy, player.maxEnergy);
    if (data.result === 'victory' || data.result === 'kill') {
      $('c-mhp').textContent = 0;
      updateBarFill($('c-mhp-bar'), 0, prevMob?.maxHp ?? 1);
      $('c-men').textContent = 0;
      updateBarFill($('c-men-bar'), 0, prevMob?.maxEnergy ?? 1);
    }

    const deadStartMs = animDuration + 100;
    let endMs = deadStartMs;
    if (data.result === 'victory' || data.result === 'kill') {
      endMs = playDeadSprite($('cbt-mob-img'), prevMobImags, deadStartMs);
    } else if (data.result === 'defeat' || data.result === 'npc_special_defeat') {
      endMs = playDeadSprite($('cbt-player-img'), prevPlayerImags, deadStartMs);
    }

    setTimeout(() => {
      if (data.result === 'npc_special_defeat') {
        // Special non-lethal NPC outcome (roadmap/npc_combat.md §5) — run continues,
        // no gameover modal.
        document.body.classList.remove('boss-fight');
        music.exitBattle();
        showScreen('dungeon');
        window.renderDungeon();
        toast(data.npcSpecialDefeat?.text ?? '');
      } else {
        handleCombatEnd(data.result, data.reward, prevMob);
      }
      state.busy = false;
      updateCombatButtons();
    }, endMs + 300);
  }
}

// ── Flee ──────────────────────────────────────────────────────────────────────

export async function doFlee() {
  if (state.busy || !state.G?.combat) return;
  state.busy = true;
  updateCombatButtons();

  const data = await api('POST', '/api/combat/flee');

  if (data.error) {
    addChat(data.error, 'damage-player', 'error');
    state.busy = false;
    updateCombatButtons();
    return;
  }

  state.G = data;

  if (data.fled) {
    sfx.playUi('combat_flee_success');
    addChat(u('combat', 'fled', 'Вы сбежали из боя!'), 'info');
    setTimeout(() => {
      music.exitBattle();
      showScreen('dungeon');
      window.renderDungeon();
      state.busy = false;
    }, 600);
  } else {
    sfx.playUi('combat_flee_fail');
    addChat(u('combat', 'flee_fail', 'Побег не удался!'), 'damage-player');
    renderCombat();
    state.busy = false;
    updateCombatButtons();
  }
}

// ── Mercy ─────────────────────────────────────────────────────────────────────

let _mercyModal = null;

function _createMercyModal() {
  const bg = document.createElement('div');
  bg.id        = 'modal-mercy';
  bg.className = 'modal-bg hidden';
  bg.innerHTML = `
    <div class="modal mercy-modal">
      <div id="go-icon"><img id="go-icon-img" class="go-icon-img" src="/assets/image/victory.png" alt=""></div>
      <h1 id="mercy-title"></h1>
      <p id="mercy-sub">${u('mercy', 'sub', 'Что делать с поверженным врагом?')}</p>
      <div class="modal-footer mercy-footer">
        <button id="btn-mercy-spare" class="mercy-btn spare-btn">${u('mercy', 'spare', 'Пощадить')}</button>
        <button id="btn-mercy-kill"  class="mercy-btn kill-btn">${u('mercy', 'kill', 'Добить')}</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
  document.getElementById('btn-mercy-spare').addEventListener('click', () => doMercy('spare'));
  document.getElementById('btn-mercy-kill').addEventListener('click',  () => doMercy('kill'));
  return bg;
}

export function showMercyChoice() {
  if (!_mercyModal) _mercyModal = _createMercyModal();
  const mobName = state.G.combat?.mob?.name ?? 'Враг';
  document.getElementById('mercy-title').textContent = ufmt('mercy', 'title', { name: mobName }, `${mobName} сдаётся!`);
  document.getElementById('modal-mercy').classList.remove('hidden');
}

async function doMercy(choice) {
  document.getElementById('modal-mercy').classList.add('hidden');
  state.busy = true;

  const data = await api('POST', '/api/combat/mercy', { choice });
  if (data.error) {
    addChat(data.error, 'damage-player', 'error');
    state.busy = false;
    updateCombatButtons();
    return;
  }

  state.G = data;

  setTimeout(() => {
    handleCombatEnd(data.choice, data.reward);
    state.busy = false;
    updateCombatButtons();
  }, 300);
}

// ── Combat end ────────────────────────────────────────────────────────────────

async function _showAfterCombatNarration(mob, sectionKey = 'after_combat') {
  const narrative = state.G?.narrative;
  if (!narrative?.narrative) return;

  const section = narrative[sectionKey];
  if (!section?.active) return;

  const vars = { mob_name: mob?.name ?? '' };
  const { text, is_ai } = resolveTextVariant(section, state.G, vars);
  if (!text) return;

  if (is_ai) {
    $('go-sub').textContent = '…';
    try {
      const data = await api('POST', '/api/narrate', { text, section: sectionKey });
      $('go-sub').textContent = data.text || text;
    } catch {
      $('go-sub').textContent = text;
    }
  } else {
    $('go-sub').textContent = text;
  }
}

function handleCombatEnd(result, reward, prevMob = null) {
  document.body.classList.remove('boss-fight');
  music.exitBattle();

  const _luLine = lu => {
    const sp = lu.spGained, pts = sp !== 1 ? 'points' : 'point';
    return '\n' + ufmt('gameover', 'levelup_line', { level: lu.newLevel, sp, pts },
      `⬆️ Уровень ${lu.newLevel}! +${sp} skill ${pts}`);
  };

  if (result === 'victory' || result === 'kill') {
    $('go-icon-img').src      = '/assets/image/victory.png';
    $('go-icon-img').alt      = '';
    $('go-title').textContent = result === 'kill'
      ? u('gameover', 'kill_title',    'ДОБИТ!')
      : u('gameover', 'victory_title', 'ПОБЕДА!');
    $('go-title').style.color = '#ffd700';
    let sub = reward ? ufmt('gameover', 'xp_label', { xp: reward.xp }, `+${reward.xp} XP`) : '';
    if (reward?.drops?.length) sub += `\n${u('gameover', 'drop_label', 'Дроп:')} ${reward.drops.join(', ')}`;
    if (reward?.levelUp) sub += _luLine(reward.levelUp);
    $('go-sub').textContent = sub;
    $('btn-go-continue').classList.remove('hidden');
    $('btn-go-load').classList.add('hidden');
    $('btn-go-new').classList.add('hidden');
    _showAfterCombatNarration(prevMob, 'after_combat');
  } else if (result === 'surrender' || result === 'spare') {
    $('go-icon-img').src      = '/assets/image/victory.png';
    $('go-icon-img').alt      = '';
    $('go-title').textContent = u('gameover', 'surrender_title', 'ПРОТИВНИК СДАЛСЯ!');
    $('go-title').style.color = '#7af77a';
    let sub = reward
      ? ufmt('gameover', 'xp_label', { xp: reward.xp }, `+${reward.xp} XP`) + '  ' + u('gameover', 'peaceful_suffix', '(мирная победа)')
      : u('gameover', 'peaceful_sub', 'Мирная победа!');
    if (reward?.levelUp) sub += _luLine(reward.levelUp);
    $('go-sub').textContent = sub;
    $('btn-go-continue').classList.remove('hidden');
    $('btn-go-load').classList.add('hidden');
    $('btn-go-new').classList.add('hidden');
  } else {
    $('go-icon-img').src      = '/assets/image/game_over.png';
    $('go-icon-img').alt      = '';
    $('go-title').textContent = u('gameover', 'defeat_title', 'ПОРАЖЕНИЕ!');
    $('go-title').style.color = '#ff4444';
    $('go-sub').textContent   = u('gameover', 'defeat_sub', 'Вы пали в бою…');
    $('btn-go-continue').classList.add('hidden');
    $('btn-go-load').classList.remove('hidden');
    $('btn-go-new').classList.remove('hidden');
    _showAfterCombatNarration(prevMob, 'after_defeat');
  }
  $('modal-gameover').classList.remove('hidden');
}

// Expose on window — enterCombat called by dungeon.js/moveTo
window.enterCombat = enterCombat;
