'use strict';
import { api }   from './api.js';
import { music } from './music.js';
import { u }     from './i18n.js';

let _audio      = null;
let _bound      = false;
let _animFrame  = null;

// ── Open ──────────────────────────────────────────────────────────────────────

export async function openCredits() {
  const modal  = document.getElementById('modal-credits');
  const scroll = document.getElementById('credits-scroll');
  scroll.innerHTML = '';
  scroll.classList.remove('rolling');

  const [credits, tracks] = await Promise.all([
    api('GET', '/api/credits'),
    api('GET', '/api/credits-tracks'),
  ]);

  _buildContent(scroll, Array.isArray(credits) ? credits : []);

  modal.classList.remove('hidden');

  // Start scroll after layout paint so offsetHeight is correct
  requestAnimationFrame(() => requestAnimationFrame(() => {
    _startRoll(scroll);
  }));

  // Music
  music.suspend();
  const list = Array.isArray(tracks) ? tracks : [];
  if (list.length) {
    const src  = list[Math.floor(Math.random() * list.length)];
    _audio     = new Audio(src);
    _audio.volume = music._bgVol ?? 0.25;
    _audio.play().catch(() => {});
  }
}

// ── Close ─────────────────────────────────────────────────────────────────────

export function closeCredits() {
  if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
  document.getElementById('modal-credits').classList.add('hidden');
  if (_audio) { _audio.pause(); _audio.src = ''; _audio = null; }
  music.unsuspend();
}

// ── Init button bindings (call once) ─────────────────────────────────────────

export function initCreditsBtn() {
  if (_bound) return;
  _bound = true;
  document.getElementById('btn-credits').addEventListener('click', () => {
    document.getElementById('modal-settings').classList.add('hidden');
    openCredits();
  });
  document.getElementById('btn-credits-close').addEventListener('click', closeCredits);
}

// ── Scroll animation ─────────────────────────────────────────────────────────

function _startRoll(scroll) {
  const viewH      = window.innerHeight;
  const endY       = -scroll.offsetHeight;

  // translateY value at which the first section title hits screen center
  const firstTitle = scroll.querySelector('.cr-section-title');
  const titleTop   = firstTitle ? firstTitle.offsetTop : viewH * 0.3;
  const slowY      = viewH * 0.5 - titleTop;  // Y where we switch to slow speed

  const V_FAST = 80;  // px per second before slowpoint
  const V_SLOW = 40;  // px per second after slowpoint (2× slower)

  let y        = viewH;  // start below viewport
  let lastTime = null;

  function tick(now) {
    if (!lastTime) { lastTime = now; _animFrame = requestAnimationFrame(tick); return; }

    const dt  = Math.min((now - lastTime) / 1000, 0.05); // cap spike at 50ms
    lastTime  = now;

    y -= (y > slowY ? V_FAST : V_SLOW) * dt;
    scroll.style.transform = `translateY(${y}px)`;

    if (y > endY) _animFrame = requestAnimationFrame(tick);
    else           _animFrame = null;  // done — stay at end
  }

  scroll.style.transform = `translateY(${y}px)`;
  _animFrame = requestAnimationFrame(tick);
}

// ── DOM builder ───────────────────────────────────────────────────────────────

function _buildContent(scroll, sections) {
  // Leading space so first section starts below viewport
  _spacer(scroll, '30vh');

  for (const section of sections) {
    // Section title
    const title = document.createElement('div');
    title.className   = 'cr-section-title';
    title.textContent = section.name ?? '';
    scroll.appendChild(title);

    // Optional image
    if (section.image) {
      const img = document.createElement('img');
      img.className = 'cr-section-img';
      img.src       = `/${section.image}`;
      img.alt       = '';
      scroll.appendChild(img);
    }

    // Credit entries
    for (const credit of (section.credits ?? [])) {
      const entry = document.createElement('div');
      entry.className = 'cr-entry';

      const name = document.createElement('div');
      name.className   = 'cr-name';
      name.textContent = credit.name ?? '';

      const role = document.createElement('div');
      role.className   = 'cr-role';
      role.textContent = credit.role ?? '';

      const contrib = document.createElement('div');
      contrib.className   = 'cr-contrib';
      contrib.textContent = credit.contribution ?? '';

      entry.appendChild(name);
      entry.appendChild(role);
      entry.appendChild(contrib);
      scroll.appendChild(entry);
    }

    _spacer(scroll, '60px');
  }

  // End card
  _spacer(scroll, '60px');
  const thanks = document.createElement('div');
  thanks.className   = 'cr-thanks';
  thanks.textContent = u('html', 'credits_thanks', 'Спасибо за игру');
  scroll.appendChild(thanks);

  // Trailing space so "thanks" lingers before scroll ends
  _spacer(scroll, '40vh');
}

function _spacer(parent, height) {
  const el = document.createElement('div');
  el.style.height = height;
  parent.appendChild(el);
}
