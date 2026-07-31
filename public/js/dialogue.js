'use strict';
// ── Dialogue UI ───────────────────────────────────────────────────────────────
//
// Renders the scripted dialogue modal step-by-step.
// Called from event.js when an event action { type: 'dialogue' } fires.
//
// Flow:
//   startDialogueUI(dialogueId) → Promise<ends_with | null>
//     resolves when dialogue closes ('combat' / 'shop' / 'free_chat' / 'close' / null)
//
import { api }         from './api.js';
import { toast, icon } from './dom.js';
import { sfx }     from './sfx.js';
import { state }   from './state.js';
import { u }       from './i18n.js';

// ── Modal singleton ───────────────────────────────────────────────────────────

let _modal   = null;
let _resolve = null;   // Promise resolver for the calling event

// ── Speaker resolver — pulls live data from current room ──────────────────────

function _resolveSpeaker(speakerKey) {
  const r = state.G?.currentRoom ?? {};
  switch (speakerKey) {
    case 'npc':
      return { label: r.npcName ?? 'NPC', portrait: r.npcPortrait ?? null };
    case 'mob':
      return { label: r.mobName ?? '???', portrait: r.mobImage ?? null };
    case 'narrator':
      return { label: null, portrait: null };
    case 'player':
      return { label: null, portrait: null };
    default:
      return { label: speakerKey, portrait: null };
  }
}

// ── Modal DOM factory ─────────────────────────────────────────────────────────

function _getModal() {
  if (_modal) return _modal;

  _modal = document.createElement('div');
  _modal.id        = 'modal-dialogue';
  _modal.className = 'dialogue-bg hidden';
  _modal.innerHTML = `
    <div class="dialogue-frame" data-speaker="">
      <div class="dialogue-portrait-col">
        <img class="dialogue-portrait-img" src="" alt="">
        <div class="dialogue-portrait-name"></div>
      </div>
      <div class="dialogue-content-col">
        <div class="dialogue-narrative hidden" id="dlg-narrative"></div>
        <div class="dialogue-text" id="dlg-text"></div>
        <div class="dialogue-options" id="dlg-options"></div>
        <button class="dialogue-advance hidden" id="dlg-advance"></button>
      </div>
    </div>`;

  document.body.appendChild(_modal);

  const advBtn0 = _modal.querySelector('#dlg-advance');
  advBtn0.innerHTML = `${u('dialogue', 'advance', 'Продолжить')} ▶`;
  advBtn0.addEventListener('click', _advance);

  // Click on text area → skip typewriter
  _modal.querySelector('#dlg-text').addEventListener('click', _skipTypewriter);

  // ESC → emergency close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !_modal.classList.contains('hidden')) _emergencyClose();
  });

  return _modal;
}

// ── Loading / lock state ──────────────────────────────────────────────────────
// Called before any API request. Shows "..." and blocks all buttons.
// _renderNode() naturally clears it by rewriting the content.

function _setLoading(on) {
  const modal = _getModal();
  const frame   = modal.querySelector('.dialogue-frame');
  const textEl  = modal.querySelector('#dlg-text');
  const optEl   = modal.querySelector('#dlg-options');
  const advBtn  = modal.querySelector('#dlg-advance');

  if (on) {
    _skipTyping = true;                    // abort any active typewriter
    frame.classList.add('loading');        // dims all buttons via CSS
    textEl.classList.remove('typing');
    textEl.innerHTML = '<span class="dlg-thinking">···</span>';
    textEl.style.cursor = 'var(--cursor)';
    optEl.innerHTML = '';
    advBtn.classList.add('hidden');
    advBtn.disabled = true;
  } else {
    frame.classList.remove('loading');
    /*textEl.style.cursor = 'var(--cursor-pointer)'; */
    advBtn.disabled = false;
  }
}

// ── Typewriter ────────────────────────────────────────────────────────────────

let _skipTyping = false;

function _skipTypewriter() {
  _skipTyping = true;
}

async function _typeWrite(el, text, blipsSpec = null) {
  _skipTyping = false;
  el.textContent = '';
  el.classList.add('typing');

  for (const char of text) {
    if (_skipTyping) break;
    el.textContent += char;
    sfx.playTextBlip(blipsSpec);   // no-ops while the previous blip is still playing
    await new Promise(r => setTimeout(r, 22));
  }

  // Guarantee full text is shown (skip or end of loop)
  el.textContent = text;
  el.classList.remove('typing');
}

// ── Render a node ─────────────────────────────────────────────────────────────

async function _renderNode(node) {
  const modal    = _getModal();
  const frame    = modal.querySelector('.dialogue-frame');
  const portImg  = modal.querySelector('.dialogue-portrait-img');
  const portName = modal.querySelector('.dialogue-portrait-name');
  const narEl    = modal.querySelector('#dlg-narrative');
  const textEl   = modal.querySelector('#dlg-text');
  const optEl    = modal.querySelector('#dlg-options');
  const advBtn   = modal.querySelector('#dlg-advance');

  modal.classList.remove('hidden');
  _setLoading(false);   // clear any loading/lock state from previous API wait

  // ── Speaker setup ──────────────────────────────────────────────────────────
  const speaker = node.speaker ?? 'narrator';
  frame.dataset.speaker = speaker;

  const { label, portrait } = _resolveSpeaker(speaker);

  // Portrait — hide for narrator / player
  const showPortrait = speaker !== 'narrator' && speaker !== 'player';
  if (showPortrait && portrait) {
    portImg.src   = portrait;
    portImg.style.display = '';
  } else {
    portImg.src   = '';
    portImg.style.display = 'none';
  }

  // Speaker name under portrait
  portName.textContent = label ?? '';
  portName.style.display = label ? '' : 'none';

  // ── Narrative text (gray italic) — appears instantly above the speech ──────
  if (node.narrative) {
    narEl.textContent = node.narrative;
    narEl.classList.remove('hidden');
  } else {
    narEl.textContent = '';
    narEl.classList.add('hidden');
  }

  // ── Clear previous buttons while text is typing ───────────────────────────
  optEl.innerHTML = '';
  advBtn.classList.add('hidden');

  // ── Typewrite speech text ──────────────────────────────────────────────────
  await _typeWrite(textEl, node.text ?? '', node.text_blips ?? null);

  // ── Render choices / advance button after text finishes ───────────────────
  if (node.options?.length) {
    node.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className   = 'dlg-option-btn';
      btn.textContent = opt.text ?? '...';
      btn.addEventListener('click', () => {
        sfx.playUi('ui_npc_open');
        _choose(opt.index);
      });
      optEl.appendChild(btn);
    });

  } else if (node.ends_with) {
    const btn = document.createElement('button');
    btn.className   = 'dlg-option-btn dlg-option-primary';
    btn.innerHTML = _endsWithLabel(node.ends_with);
    btn.addEventListener('click', () => _finish(node.ends_with));
    optEl.appendChild(btn);

  } else {
    advBtn.classList.remove('hidden');
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

async function _advance() {
  _setLoading(true);   // lock UI immediately, show "···"
  try {
    const result = await api('POST', '/api/dialogue/advance', {});
    _handleResult(result);
  } catch {
    toast(u('dialogue', 'error', 'Ошибка диалога'));
    _emergencyClose();
  }
}

async function _choose(index) {
  _setLoading(true);   // lock UI immediately, show "···"
  try {
    const result = await api('POST', '/api/dialogue/advance', { choiceIndex: index });
    _handleResult(result);
  } catch {
    toast(u('dialogue', 'error', 'Ошибка диалога'));
    _emergencyClose();
  }
}

function _handleResult(result) {
  if (result.done) {
    _finish(result.ends_with ?? null);
  } else {
    _renderNode(result.node ?? result);
  }
}

function _finish(endsWith) {
  _modal?.classList.add('hidden');
  if (_resolve) { _resolve(endsWith); _resolve = null; }
}

async function _emergencyClose() {
  try { await api('POST', '/api/dialogue/close', {}); } catch {}
  _finish('close');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _endsWithLabel(endsWith) {
  const MAP = {
    combat:    `${icon('attack')} ${u('dialogue', 'ends_combat', 'В бой')}`,
    free_chat: `${icon('speech-bubble')} ${u('dialogue', 'ends_free_chat', 'Говорить')}`,
    shop:      `${icon('cart')} ${u('dialogue', 'ends_shop', 'Торговать')}`,
    close:     u('dialogue', 'ends_close', 'Закрыть')
  };
  return MAP[endsWith] ?? `${u('dialogue', 'advance', 'Продолжить')} ▶`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start a scripted dialogue and wait for it to finish.
 * Returns a Promise that resolves to `ends_with` string or null.
 */
export async function startDialogueUI(dialogueId) {
  return new Promise(async (resolve) => {
    _resolve = resolve;

    // Show modal immediately — blocks all game input right away
    // and shows "···" while AI generates the first node
    const modal = _getModal();
    modal.classList.remove('hidden');
    _setLoading(true);

    try {
      const result = await api('POST', '/api/dialogue/start', { dialogueId });
      if (result.done) {
        _finish(result.ends_with ?? null);
      } else {
        await _renderNode(result.node);
      }
    } catch (err) {
      toast(`${u('dialogue', 'error', 'Ошибка диалога')}: ${err.message ?? ''}`);
      _finish(null);
    }
  });
}
