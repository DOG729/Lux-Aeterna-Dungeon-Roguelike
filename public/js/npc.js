'use strict';
import { state }                    from './state.js';
import { u, ufmt }                  from './i18n.js';
import { api }                      from './api.js';
import { $, toast, icon, escapeHtml, formatChatText } from './dom.js';
import { resolveTextVariant }       from './conditions.js';
import { sfx }                      from './sfx.js';
import { fireEvent }                from './event.js';

let _npcModal      = null;
let _currentNpc    = null;
let _narrationSeq  = 0;

// Player-initiated close (button/backdrop/ESC) — as opposed to attackNpc() hiding the
// modal programmatically when combat starts. Fires the async dream_ai summarization
// (fire-and-forget, roadmap/npc_combat.md "dream_ai") — the game never waits on it.
export function closeNpcModal() {
  if (_currentNpc) api('POST', '/api/npc/close', { npcInstanceId: _currentNpc.instanceId }).catch(() => {});
  $('modal-npc')?.classList.add('hidden');
}

function _createNpcModal() {
  const bg = document.createElement('div');
  bg.id        = 'modal-npc';
  bg.className = 'modal-bg hidden';
  bg.innerHTML = `
    <div class="modal npc-modal">
      <div class="npc-layout">
        <div class="npc-left">
          <img id="npc-portrait" src="" alt="">
          <div id="npc-name" class="npc-name"></div>
          <div id="npc-type-badge" class="npc-type-badge"></div>
          <div id="npc-msg-count" class="npc-msg-count"></div>
          <button id="btn-npc-attack" class="danger-btn hidden">${icon('attack')} ${u('npc', 'attack_btn', 'Напасть')}</button>
        </div>
        <div class="npc-right">
          <div id="npc-chat-log" class="npc-chat-log"></div>
          <div class="npc-input-row">
            <input id="npc-msg" type="text" maxlength="255" placeholder="${u('npc', 'say_placeholder', 'Сказать…')}">
            <button id="btn-npc-send">${u('npc', 'send_btn', 'Отправить')}</button>
          </div>
        </div>
      </div>
      <div id="npc-trade-section" class="hidden">
        <div class="npc-trade-tabs">
          <button class="npc-trade-tab active" data-trade="buy">${icon('cart')} ${u('npc', 'buy_tab', 'Купить')}</button>
          <button class="npc-trade-tab" data-trade="sell">${icon('sell')} ${u('npc', 'sell_tab', 'Продать')}</button>
        </div>
        <div id="npc-trade-buy"  class="npc-trade-panel"></div>
        <div id="npc-trade-sell" class="npc-trade-panel hidden"></div>
      </div>
      <div class="modal-footer">
        <button id="btn-npc-close">${u('npc', 'close_btn', 'Закрыть')}</button>
      </div>
    </div>`;
  document.body.appendChild(bg);

  bg.querySelectorAll('.npc-trade-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      bg.querySelectorAll('.npc-trade-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $('npc-trade-buy').classList.toggle('hidden',  tab.dataset.trade !== 'buy');
      $('npc-trade-sell').classList.toggle('hidden', tab.dataset.trade !== 'sell');
    });
  });

  $('btn-npc-send').addEventListener('click', sendNpcMessage);
  $('npc-msg').addEventListener('keydown', e => { if (e.key === 'Enter') sendNpcMessage(); });
  $('btn-npc-attack').addEventListener('click', () => attackNpc());
  $('btn-npc-close').addEventListener('click', closeNpcModal);
  bg.addEventListener('click', e => { if (e.target === bg) closeNpcModal(); });
  return bg;
}

function _addNpcChat(speaker, text, type) {
  const log = $('npc-chat-log');
  const el  = document.createElement('div');
  el.className = `npc-chat-entry npc-chat-${type}`;
  el.innerHTML  = speaker ? `<strong>${speaker}:</strong> ${text}` : text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function _updateNpcMsgCount(npc) {
  const rem = npc.maxMessages - npc.messageCount;
  $('npc-msg-count').textContent = rem > 0
    ? ufmt('npc', 'msg_status', { count: npc.messageCount, max: npc.maxMessages }, `${npc.messageCount}/${npc.maxMessages} сообщений`)
    : u('npc', 'msg_exhausted', 'Не хочет говорить');
}

function _renderNpcShop(shop, npcInstanceId) {
  const el = $('npc-trade-buy');
  el.innerHTML = '';
  if (!shop.length) {
    el.innerHTML = `<div class="npc-shop-empty">${u('npc', 'no_items', 'Нет товаров')}</div>`;
    return;
  }
  for (const item of shop) {
    const canAfford = (state.G?.player?.gold ?? 0) >= item.price;
    const div = document.createElement('div');
    div.className = 'npc-shop-item';
    div.innerHTML = `
      <img class="npc-shop-img" src="${item.image}" alt="${item.name}" onerror="this.style.display='none'">
      <div class="npc-shop-info">
        <div class="npc-shop-name">${item.name}</div>
        ${item.stats ? `<div class="npc-shop-stats">${_formatStats(item.stats)}</div>` : ''}
        <div class="npc-shop-count">×${item.count}</div>
      </div>
      <div class="npc-shop-price">${icon('gold', 'icon icon-sm')} ${item.price}</div>
      <button class="npc-shop-btn" ${canAfford && item.count > 0 ? '' : 'disabled'}
        onclick="buyFromNpc('${npcInstanceId}','${item.id}')">${u('npc', 'buy_btn', 'Купить')}</button>`;
    el.appendChild(div);
  }
}

function _renderNpcSell(npcInstanceId) {
  const el = $('npc-trade-sell');
  el.innerHTML = '';
  const sellable = (state.G?.player?.inventory ?? []).filter(i => (i.price_sell ?? 0) > 0);
  if (!sellable.length) {
    el.innerHTML = `<div class="npc-shop-empty">${u('npc', 'nothing_sell', 'Нечего продать')}</div>`;
    return;
  }
  for (const item of sellable) {
    const div = document.createElement('div');
    div.className = 'npc-shop-item';
    div.innerHTML = `
      <img class="npc-shop-img" src="${item.image}" alt="${item.name}" onerror="this.style.display='none'">
      <div class="npc-shop-info">
        <div class="npc-shop-name">${item.name}</div>
        ${item.stats ? `<div class="npc-shop-stats">${_formatStats(item.stats)}</div>` : ''}
        <div class="npc-shop-count">×${item.count}</div>
      </div>
      <div class="npc-shop-price">${icon('gold', 'icon icon-sm')} ${item.price_sell}</div>
      <button class="npc-shop-btn sell-btn"
        onclick="sellToNpc('${npcInstanceId}','${item.id}')">${u('npc', 'sell_btn', 'Продать')}</button>`;
    el.appendChild(div);
  }
}

function _formatStats(stats) {
  if (!stats) return '';
  return [
    stats.attack ? `${icon('attack', 'icon icon-sm')} +${stats.attack} ${u('stats', 'atk', 'Атк')}` : '',
    stats.defend ? `${icon('shield', 'icon icon-sm')} +${stats.defend} ${u('stats', 'def', 'Блк')}` : '',
    stats.hp     ? `${icon('hp', 'icon icon-sm')} +${stats.hp} HP`  : '',
    stats.energy ? `${icon('energy', 'icon icon-sm')} +${stats.energy} ${u('stats', 'en', 'Эн')}` : ''
  ].filter(Boolean).join('  ');
}

async function _showNpcNarration(npc) {
  const seq = ++_narrationSeq;

  const narrative = state.G?.narrative;
  if (!narrative?.narrative) return;

  const npcSection = narrative.NPC;
  if (!npcSection?.active) return;

  const type    = npc.type === 'trader' ? 'trader' : 'other';
  const section = npcSection[type];
  const spec    = npc.narrative_text ?? (section?.active ? section : null);
  if (!spec) return;

  const vars = { npc_name: npc.name ?? '' };
  const { text, is_ai } = resolveTextVariant(spec, state.G, vars);
  if (!text) return;

  if (seq !== _narrationSeq) return;

  const sectionKey = type === 'trader' ? 'npc_trader' : 'npc_other';

  if (is_ai) {
    const el = _addNpcChat('', '…', 'narrator thinking');
    try {
      const data = await api('POST', '/api/narrate', { text, section: sectionKey });
      if (seq !== _narrationSeq) { el.remove(); return; }
      el.innerHTML = data.text || text;
    } catch {
      if (seq !== _narrationSeq) { el.remove(); return; }
      el.innerHTML = text;
    }
    el.classList.remove('thinking');
  } else {
    _addNpcChat('', text, 'narrator');
  }
}

// ── Event-aware entry point ───────────────────────────────────────────────────
//
// Checks the room's NPC event hooks before opening the chat modal.
// Priority: on_first_encounter (once) → on_encounter → modal fallback
//
// After a scripted event/dialogue the old modal opens only when
// ends_with === 'free_chat'  (chat NPC)
// ends_with === 'shop'       (trader)
//
export async function openNpc(instanceId) {
  const events = state.G?.currentRoom?.npcEvents;

  if (events) {
    // ── on_first_encounter — fires once, then falls through ──────────────────
    if (events.on_first_encounter) {
      const r = await fireEvent(events.on_first_encounter);
      if (!r.alreadyFired) {
        if (r.endsWith === 'combat') { await attackNpc(instanceId); return; }
        // Event ran — open modal, but skip narration (event/dialogue already showed it)
        if (r.endsWith !== 'close') {
          await _openNpcModal(instanceId, { skipNarration: true });
        }
        return;
      }
      // Already seen once — fall through to on_encounter below
    }

    // ── on_encounter — fires on every interaction ─────────────────────────────
    if (events.on_encounter) {
      const r = await fireEvent(events.on_encounter);
      if (!r.alreadyFired) {
        if (r.endsWith === 'combat') { await attackNpc(instanceId); return; }
        // Event ran — skip narration (dialogue just happened)
        if (r.endsWith !== 'close') {
          await _openNpcModal(instanceId, { skipNarration: true });
        }
        return;
      }
      // on_encounter fired but was 'once' and already used — fall through to modal
    }
  }

  // ── Fallback: no events, or all once-events exhausted → show narration normally
  await _openNpcModal(instanceId);
}

// ── Low-level NPC modal opener ────────────────────────────────────────────────
//
// skipNarration — true when called after an event/dialogue that already
//                 showed the encounter context. False (default) = old behaviour.

async function _openNpcModal(instanceId, { skipNarration = false } = {}) {
  sfx.playUi('npc_open');
  if (!_npcModal) _npcModal = _createNpcModal();
  _currentNpc = null;
  $('npc-chat-log').innerHTML = '';
  $('npc-trade-section').classList.add('hidden');

  const data = await api('POST', '/api/npc/interact', { npcInstanceId: instanceId });
  if (data.error) { toast(data.error); return; }

  _currentNpc = data.npc;
  $('npc-portrait').src           = data.npc.portrait;
  $('npc-name').textContent       = data.npc.name;
  $('npc-type-badge').innerHTML = data.npc.type === 'trader'
    ? `${u('npc', 'trader_badge', 'Торговец')} ${icon('trader', 'icon icon-md')}` 
    : `${u('npc', 'npc_badge', 'NPC')} ${icon('speech-bubble', 'icon icon-md')}`;  
  _updateNpcMsgCount(data.npc);
  $('btn-npc-attack').classList.toggle('hidden', !data.npc.canAttack);

  if (data.npc.type === 'trader') {
    $('npc-trade-section').classList.remove('hidden');
    $('npc-trade-buy').classList.remove('hidden');
    $('npc-trade-sell').classList.add('hidden');
    $('modal-npc').querySelectorAll('.npc-trade-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
    _renderNpcShop(data.npc.shop, instanceId);
    _renderNpcSell(instanceId);
  }

  $('modal-npc').classList.remove('hidden');

  // Focus the chat input immediately — in Electron the first click after a
  // window/modal appears sometimes only activates the window instead of
  // focusing the field underneath, leaving it looking unclickable.
  $('npc-msg')?.focus();

  // Show ambient narration only when there was no scripted event before this
  if (!skipNarration) _showNpcNarration(data.npc);
}

async function sendNpcMessage() {
  if (!_currentNpc) return;
  const msg = $('npc-msg').value.trim();
  if (!msg) return;
  $('npc-msg').value = '';
  $('btn-npc-send').disabled = true;

  // formatChatText() escapes the raw text FIRST (msg is player-typed, data.reply
  // comes from the model) and only then turns *action* markers into styled spans
  // — nothing in either source can inject markup through this path.
  _addNpcChat(escapeHtml(u('npc', 'you_prefix', 'Вы')), formatChatText(msg), 'player');
  const thinkEl = _addNpcChat('', `${icon('hourglass', 'icon icon-sm')} …`, 'system');

  const data = await api('POST', '/api/npc/chat', { npcInstanceId: _currentNpc.instanceId, message: msg });
  thinkEl.remove();
  $('btn-npc-send').disabled = false;

  if (data.error) { _addNpcChat('', `${icon('error', 'icon icon-sm')} ${data.error}`, 'system'); return; }

  _addNpcChat(escapeHtml(_currentNpc.name), formatChatText(data.reply), 'npc');
  _currentNpc.messageCount = data.messageCount ?? _currentNpc.messageCount;
  _updateNpcMsgCount(_currentNpc);
  if (data.exhausted) _addNpcChat('', u('npc', 'exhausted_note', '(Больше не хочет говорить)'), 'system');
}

async function attackNpc(instanceId) {
  const id = instanceId ?? _currentNpc?.instanceId;
  if (!id) return;
  const data = await api('POST', '/api/npc/attack', { npcInstanceId: id });
  if (data.error) { toast(data.error); return; }

  state.G = data;
  // Modal may not exist yet if combat was triggered straight from a dialogue
  // choice (ends_with:"combat") without the NPC chat modal ever opening.
  $('modal-npc')?.classList.add('hidden');
  window.renderDungeon();
  if (data.combatStarted || state.G.combat) window.enterCombat(); // set by combat.js
}

export async function buyFromNpc(npcInstanceId, itemId) {
  const data = await api('POST', '/api/npc/trade/buy', { npcInstanceId, itemId });
  if (data.error) { toast(data.error); return; }
  sfx.playUi('item_buy');
  state.G     = data;
  _currentNpc = data.npc;
  toast(`${ufmt('npc', 'bought_toast', { gold: state.G.player.gold }, `Куплено! ${state.G.player.gold}`)} ${icon('gold', 'icon icon-sm')}`);
  _renderNpcShop(data.npc.shop, npcInstanceId);
  _renderNpcSell(npcInstanceId);
  window.renderDungeon();
}

export async function sellToNpc(npcInstanceId, itemId) {
  const data = await api('POST', '/api/npc/trade/sell', { npcInstanceId, itemId });
  if (data.error) { toast(data.error); return; }
  sfx.playUi('item_sell');
  state.G     = data;
  _currentNpc = data.npc;
  toast(`${ufmt('npc', 'sold_toast', { gained: data.goldGained }, `Продано! +${data.goldGained}`)} ${icon('gold', 'icon icon-sm')}`);
  _renderNpcShop(data.npc.shop, npcInstanceId);
  _renderNpcSell(npcInstanceId);
  window.renderDungeon();
}

// Expose on window — openNpc called from map.js, buy/sell from inline onclick
window.openNpc     = openNpc;
window.buyFromNpc  = buyFromNpc;
window.sellToNpc   = sellToNpc;
