'use strict';
// ── Client event runner ───────────────────────────────────────────────────────
//
// Fires an event by ID:
//   1. Calls POST /api/event/fire → gets list of actions
//   2. Executes each action in order (await — sequential)
//
// Action types from server:
//   { type: 'sound',    value: 'key' }
//   { type: 'music',    value: 'key' | null }
//   { type: 'video',    value: 'key' }
//   { type: 'narrator', value: { text, text_key?, skippable? } }
//   { type: 'dialogue', value: 'dialogue_id' }
//
import { api }             from './api.js';
import { sfx }             from './sfx.js';
import { music }           from './music.js';
import { startDialogueUI } from './dialogue.js';
import { toast, icon }     from './dom.js';
import { u }               from './i18n.js';

// ── Media registry (loaded once) ─────────────────────────────────────────────

let _media = null;

async function _getMedia() {
  if (_media) return _media;
  try {
    _media = await api('GET', '/api/media');
  } catch {
    _media = { sound: {}, music: {}, video: {} };
  }
  return _media;
}

// ── Action executors ──────────────────────────────────────────────────────────

async function _execSound(key) {
  // Try media registry first (event sounds), then fall back to ui sound map
  const med = await _getMedia();
  const entry = med.sound?.[key];
  if (entry !== undefined) {
    // Resolve through sfx directly by path
    if (!entry) return;
    const src = typeof entry === 'object' ? entry.src : entry;
    const vol = typeof entry === 'object' ? (entry.volume ?? null) : null;
    if (src) sfx.play(Array.isArray(src) ? src[Math.floor(Math.random() * src.length)] : src, vol);
  } else {
    // Fallback: treat as UI sound key
    sfx.playUi(key);
  }
}

async function _execMusic(key) {
  if (key === null) {
    music.stopOverride?.();  // stop any override track
    return;
  }
  const med = await _getMedia();
  const entry = med.music?.[key];
  if (!entry) return;
  const src = typeof entry === 'object' ? entry.src : entry;
  if (src) music.playOverride?.(src);
}

async function _execVideo(key) {
  const med = await _getMedia();
  const entry = med.video?.[key];
  if (!entry) {
    console.warn('[event] video stub:', key);
    return;
  }
  const src      = typeof entry === 'object' ? entry.src : entry;
  const skippable = typeof entry === 'object' ? (entry.skippable ?? false) : false;
  await _playVideo(src, skippable);
}

function _playVideo(src, skippable) {
  return new Promise(resolve => {
    // TODO: Replace with real video player when video assets exist
    // For now: log and resolve immediately (dev stub)
    console.log('[video]', src, skippable ? '(skippable)' : '');
    resolve();
  });
}

async function _execNarrator(spec) {
  return new Promise(resolve => {
    const text      = spec.text ?? '';
    const skippable = spec.skippable !== false;

    const overlay = document.createElement('div');
    overlay.className = 'narrator-overlay';
    overlay.innerHTML = `<div class="narrator-text">${text}</div>`;

    if (skippable) {
      const btn = document.createElement('button');
      btn.className   = 'narrator-skip';
      btn.innerHTML = `${u('dialogue', 'narrator_skip', 'Продолжить')} ▶`; 
      btn.addEventListener('click', () => { overlay.remove(); resolve(); });
      overlay.appendChild(btn);
      overlay.addEventListener('click', e => {
        if (e.target === overlay) { overlay.remove(); resolve(); }
      });
    }

    document.body.appendChild(overlay);

    // Auto-advance after 8 seconds if not skippable
    if (!skippable) setTimeout(() => { overlay.remove(); resolve(); }, 8000);
  });
}

// ── Run action list ───────────────────────────────────────────────────────────
// Returns the `ends_with` value from the last dialogue action, or null.

async function _runActions(actions) {
  let endsWith = null;
  for (const action of actions) {
    switch (action.type) {
      case 'sound':
        await _execSound(action.value);
        break;

      case 'music':
        await _execMusic(action.value);
        break;

      case 'video':
        await _execVideo(action.value);
        break;

      case 'narrator':
        await _execNarrator(action.value ?? {});
        break;

      case 'dialogue': {
        const result = await startDialogueUI(action.value);
        if (result != null) endsWith = result;
        break;
      }

      default:
        console.warn('[event] unknown action type:', action.type);
    }
  }
  return endsWith;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fire a game event by ID.
 * Returns { alreadyFired: bool, endsWith: string|null }
 *   alreadyFired — true when the event was marked `once` and already fired before
 *   endsWith     — the `ends_with` value from the last dialogue in the event
 *                  ('free_chat' | 'shop' | 'combat' | 'close' | null)
 */
export async function fireEvent(eventId) {
  try {
    const result = await api('POST', '/api/event/fire', { eventId });
    if (result.alreadyFired) return { alreadyFired: true, endsWith: null };
    const endsWith = await _runActions(result.actions ?? []);
    return { alreadyFired: false, endsWith };
  } catch (err) {
    console.error('[event] fire failed:', eventId, err);
    toast(u('event', 'error', 'Ошибка события'));
    return { alreadyFired: false, endsWith: null };
  }
}

/**
 * Pre-load media registry into cache.
 * Call once on game init for faster first event.
 */
export async function preloadMedia() {
  await _getMedia();
}
