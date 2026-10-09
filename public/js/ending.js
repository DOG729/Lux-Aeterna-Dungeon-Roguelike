'use strict';
// ── Final screen (end of the run) ─────────────────────────────────────────────
//
// Shown after the final boss's on_death event has set storyFlag:ending
// (assets/event/fatum_tuum.json) or when the player uses a door with
// use_door.function === 'end_game' (assets/config/dungeon_levels.json).
// Reuses the game-over modal; btn-go-credits / btn-go-menu are bound in main.js.
//
import { u }         from './i18n.js';
import { $ }         from './dom.js';
import { api }       from './api.js';
import { state }     from './state.js';
import { music }     from './music.js';
import { fireEvent } from './event.js';

const ENDINGS = ['liberation', 'merge', 'neutral'];

export function showEnding(ending) {
  const id = ENDINGS.includes(ending) ? ending : 'neutral';
  document.body.classList.remove('boss-fight');
  music.exitBattle();

  $('go-icon-img').src      = '/assets/image/victory.png';
  $('go-icon-img').alt      = '';
  $('go-title').textContent = `${u('ending', 'title', 'КОНЕЦ')} — ${u('ending', id, id)}`;
  $('go-title').style.color = id === 'merge' ? '#ff4444' : id === 'liberation' ? '#ffd700' : '#cccccc';
  $('go-sub').textContent   = u('ending', `sub_${id}`, '');

  $('btn-go-continue').classList.add('hidden');
  $('btn-go-load').classList.add('hidden');
  $('btn-go-new').classList.remove('hidden');
  $('btn-go-credits').classList.remove('hidden');
  $('btn-go-menu').classList.remove('hidden');
  $('modal-gameover').classList.remove('hidden');
}

/**
 * Fires the defeated enemy's on_death hook (if any), then re-reads the session.
 * Returns true when the run is over (storyFlag:ending set) and the ending screen is shown.
 */
export async function runDeathEvent(mob) {
  const eventId = mob?.events?.on_death;
  if (!eventId || mob.sourceNpc) return false;

  await fireEvent(eventId);
  const sess = await api('GET', '/api/session');
  if (sess?.has) state.G = sess;

  const ending = state.G?.player?.storyFlags?.ending;
  if (!ending) return false;
  showEnding(ending);
  return true;
}
