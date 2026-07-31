'use strict';
import { state }  from './state.js';
import { api }    from './api.js';
import { music }  from './music.js';
import { u }      from './i18n.js';
import { toast }  from './dom.js';

const BLINK_MS = 20000;

let _scene          = null;
let _roomState      = null;
let _hints          = {};
let _blinkTmr       = null;
let _helpTimers     = [];
let _sceneAudio     = null;
let _musicSuspended = false;
let _scale          = 1;
let _isOpen         = false;

// ── Public ────────────────────────────────────────────────────────────────────

export async function openScavenge(sceneData, roomState, opts = {}) {
  if (_isOpen) return;

  // Cinematic push-in on manual "Осмотреться" clicks (skipped for silent auto-open).
  // Zooms toward the player's current tile on the map, not the viewport center.
  if (opts.zoom) {
    const wrap = document.getElementById('dng-map-wrap');
    const tile = document.querySelector('#dng-map .map-tile.current');
    if (tile) {
      const wrapRect = wrap.getBoundingClientRect();
      const tileRect = tile.getBoundingClientRect();
      wrap.style.transformOrigin =
        `${tileRect.left + tileRect.width  / 2 - wrapRect.left}px ` +
        `${tileRect.top  + tileRect.height / 2 - wrapRect.top}px`;
    } else {
      wrap.style.transformOrigin = '';
    }
    wrap.classList.add('zoom-into-scavenge');
    await new Promise(r => setTimeout(r, 320));
    wrap.classList.remove('zoom-into-scavenge');
  }

  // Accept pre-loaded data (auto-open) or fetch from server
  let helpText   = null;
  let soundSrc   = null;
  let activeTasks = [];
  if (sceneData && roomState) {
    _scene     = sceneData;
    _roomState = roomState;
    helpText   = _scene.help_text ?? null;
    const s    = _scene.sound;
    if (s && /\.(mp3|wav|ogg)$/i.test(s)) soundSrc = `/assets/sound/${s}`;
  } else {
    const data = await api('GET', '/api/scavenge/scene');
    if (data.error) { toast(data.error ?? u('scavenge', 'no_scene', 'Нет сцены')); return; }
    _scene      = data.scene;
    _roomState  = data.state;
    _hints      = data.hints ?? {};
    helpText    = data.helpText  ?? _scene.help_text ?? null;
    soundSrc    = data.soundSrc  ?? null;
    activeTasks = data.activeTasks ?? [];
  }

  _isOpen = true;

  // Suspend game music only when scene has its own sound
  if (_scene.sound != null) {
    music.suspend();
    _musicSuspended = true;
    _playSceneSound(soundSrc);
  } else {
    _musicSuspended = false;
  }

  _render();
  document.getElementById('dng-map-wrap').classList.add('hidden');
  document.getElementById('room-actions').classList.add('hidden');
  const modal = document.getElementById('modal-scavenge');
  modal.classList.remove('hidden');
  if (opts.zoom) {
    modal.classList.add('zoom-enter');
    modal.addEventListener('animationend', () => modal.classList.remove('zoom-enter'), { once: true });
  }
  _updateExitBtn();
  _startBlink();
  _showHelp(helpText);
  _renderTasks(activeTasks);
}

export function closeScavenge() {
  _isOpen = false;
  document.getElementById('modal-scavenge').classList.add('hidden');
  document.getElementById('dng-map-wrap').classList.remove('hidden');
  document.getElementById('room-actions').classList.remove('hidden');
  _stopBlink();
  _hidePopup();
  _hideHint();
  _hideHelp();
  _hideTasks();
  _stopSceneSound();
  if (_musicSuspended) {
    music.unsuspend();
    _musicSuspended = false;
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function _render() {
  const wrap    = document.getElementById('scavenge-scene');
  const removed = new Set(_roomState?.removedObjects ?? []);
  const imgFile = _roomState?.currentImage ?? _scene.image;
  const imgSrc  = `/assets/scavenge/scenes/${imgFile}`;

  wrap.innerHTML = '';

  const bg = document.createElement('img');
  bg.className = 'scavenge-bg';
  bg.src       = imgSrc;
  bg.draggable = false;
  bg.onload    = () => {
    const vp = document.getElementById('scavenge-viewport');
    const h  = vp.clientHeight;
    bg.style.height = h + 'px';
    bg.style.width  = 'auto';
    _scale = bg.naturalHeight ? h / bg.naturalHeight : 1;
    _positionElements(wrap);
    // Start from center of panorama
    vp.scrollLeft = (bg.offsetWidth - vp.clientWidth) / 2;
  };
  wrap.appendChild(bg);

  // Build elements — position after image loads
  wrap._pendingObjects = (_scene.objects ?? []).filter(o => !removed.has(o.id));
}

function _positionElements(wrap) {
  const s = _scale;
  for (const obj of wrap._pendingObjects ?? []) {
    const el = _buildElement(obj, s);
    if (el) wrap.appendChild(el);
  }
}

function _buildElement(obj, s) {
  const isSprite = (obj.type === 'item' || obj.type === 'examine') && obj.image;

  const el = isSprite ? document.createElement('img') : document.createElement('div');
  el.className = isSprite ? 'scavenge-obj' : 'scavenge-zone';

  el.style.left   = `${obj.x * s}px`;
  el.style.top    = `${obj.y * s}px`;
  el.style.width  = `${obj.w * s}px`;
  el.style.height = `${obj.h * s}px`;

  if (isSprite) {
    el.src      = `/assets/scavenge/${obj.image}`;
    el.draggable = false;
  }

  el.addEventListener('click', () => _interact(obj));

  const hintText = _hints[obj.id] ?? obj.hint ?? null;
  if (hintText) {
    el.addEventListener('mouseenter', () => _showHint(hintText));
    el.addEventListener('mouseleave', _hideHint);
  }

  return el;
}

// ── Interact ──────────────────────────────────────────────────────────────────

async function _interact(obj) {
  const data = await api('POST', '/api/scavenge/interact', { objectId: obj.id });

  if (data.exit === false && data.conditionFailed) {
    _showPopup(data.conditionText);
    return;
  }

  if (data.exit) {
    state.G = { ...state.G, ...data };
    closeScavenge();
    window.renderDungeon?.();
    return;
  }

  if (data.state) _roomState = data.state;
  if (data.player) state.G = { ...state.G, player: data.player };

  if (data.sceneChange || data.removed) {
    _render();
  }

  _updateExitBtn();

  if (data.completedTasks?.length) {
    for (const id of data.completedTasks) _completeTask(id);
  }
  if (data.activatedTasks?.length) {
    for (const task of data.activatedTasks) _addTask(task);
  }

  if (data.grantedAchievement) {
    const ach = data.grantedAchievement;
    toast(`${ach.name} — ${ach.description}`);
  }

  if (data.text) _showPopup(data.text);

  if (data.npcOpen && data.npcInstanceId) {
    window.openNpc(data.npcInstanceId);
  }
}

// ── Object hint (hover) ───────────────────────────────────────────────────────

function _showHint(text) {
  const el = document.getElementById('scavenge-hint');
  el.textContent = text;
  el.classList.remove('hidden');
}

function _hideHint() {
  document.getElementById('scavenge-hint')?.classList.add('hidden');
}

// ── Popup ─────────────────────────────────────────────────────────────────────

let _popupTimer = null;

function _showPopup(text) {
  const el = document.getElementById('scavenge-popup');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(_popupTimer);
  _popupTimer = setTimeout(_hidePopup, 5000);
}

function _hidePopup() {
  document.getElementById('scavenge-popup')?.classList.add('hidden');
  clearTimeout(_popupTimer);
}

// ── Exit button ───────────────────────────────────────────────────────────────

document.getElementById('btn-scavenge-exit').addEventListener('click', async () => {
  const exit = (_scene?.objects ?? []).find(o => o.type === 'exit' && _exitConditionMet(o));
  if (exit) await _interact(exit);
});

function _exitConditionMet(obj) {
  const removed = new Set(_roomState?.removedObjects ?? []);
  const req = obj.condition?.required_removed ?? [];
  return req.every(id => removed.has(id));
}

function _updateExitBtn() {
  const anyOpen = (_scene?.objects ?? [])
    .filter(o => o.type === 'exit')
    .some(_exitConditionMet);
  document.getElementById('btn-scavenge-exit').classList.toggle('hidden', !anyOpen);
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

function _renderTasks(tasks) {
  const panel = document.getElementById('scavenge-tasks');
  panel.innerHTML = '';
  if (!tasks?.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  for (const task of tasks) _addTask(task, false);
}

function _addTask(task, animate = true) {
  const panel = document.getElementById('scavenge-tasks');
  panel.classList.remove('hidden');
  const el = document.createElement('div');
  el.className   = 'sc-task' + (animate ? '' : ' no-anim');
  el.dataset.id  = task.id;

  const bullet = document.createElement('span');
  bullet.className   = 'sc-task-bullet';
  bullet.textContent = '◆';

  const text = document.createElement('span');
  text.className   = 'sc-task-text';
  text.textContent = task.text;

  el.appendChild(bullet);
  el.appendChild(text);
  panel.appendChild(el);
}

function _completeTask(id) {
  const el = document.querySelector(`#scavenge-tasks .sc-task[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.classList.add('done');
  setTimeout(() => {
    el.remove();
    const panel = document.getElementById('scavenge-tasks');
    if (!panel.querySelector('.sc-task')) panel.classList.add('hidden');
  }, 950);
}

function _hideTasks() {
  const panel = document.getElementById('scavenge-tasks');
  panel.innerHTML = '';
  panel.classList.add('hidden');
}

// ── Scene sound ───────────────────────────────────────────────────────────────

function _playSceneSound(src) {
  _stopSceneSound();
  if (!src) return;
  _sceneAudio = new Audio(src);
  _sceneAudio.loop   = true;
  _sceneAudio.volume = music._bgVol;
  _sceneAudio.play().catch(() => {});
}

function _stopSceneSound() {
  if (_sceneAudio) {
    _sceneAudio.pause();
    _sceneAudio.src = '';
    _sceneAudio = null;
  }
}

// ── Help hint ─────────────────────────────────────────────────────────────────

function _showHelp(text) {
  _hideHelp();
  if (!text) return;
  const el = document.getElementById('scavenge-help');
  el.textContent = text;
  el.classList.remove('hidden', 'fading');
  _helpTimers.push(setTimeout(() => el.classList.add('fading'), 4500));
  _helpTimers.push(setTimeout(() => el.classList.add('hidden'), 5800));
}

function _hideHelp() {
  _helpTimers.forEach(clearTimeout);
  _helpTimers = [];
  const el = document.getElementById('scavenge-help');
  el.classList.add('hidden');
  el.classList.remove('fading');
}

// ── Blink ─────────────────────────────────────────────────────────────────────

function _startBlink() {
  _stopBlink();
  _blinkTmr = setInterval(() => {
    const overlay = document.getElementById('scavenge-blink-overlay');
    overlay.classList.add('blinking');
    setTimeout(() => overlay.classList.remove('blinking'), 800);
  }, BLINK_MS);
}

function _stopBlink() {
  clearInterval(_blinkTmr);
  _blinkTmr = null;
}
