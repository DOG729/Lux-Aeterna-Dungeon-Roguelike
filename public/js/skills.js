'use strict';
import { state }         from './state.js';
import { u, ufmt }       from './i18n.js';
import { api }           from './api.js';
import { $, toast }      from './dom.js';
import { renderDungeon } from './dungeon.js';
import { sfx }           from './sfx.js';

// ── Fixed canvas geometry ─────────────────────────────────────────────────────
const CANVAS_W  = 1400;
const CANVAS_H  = 1100;
const CENTER_X  = 700;
const CENTER_Y  = 600;
const LOCAL_CX  = 210;
const DEPTH_OFF = 80;

// ── Tree angles from "upward", clockwise, radians ─────────────────────────────
const TREE_ANGLE = {
  magic:    0,
  battle:   (2 * Math.PI) / 3,
  survival: (4 * Math.PI) / 3,
};

// ── Runtime params (defaults; overwritten by _applyConfig once JSON loads) ────
let _minScale    = 0.35;
let _maxScale    = 1.5;
let _initScale   = 1.0;
let _zoomStep    = 1.1;
let _panPad      = 132;   // pan_pad(100) + notable_radius(32)
let _pawnSize    = 120;
let _labelOff    = 80;
let _ringRadius  = 22;
let _lineW       = 2.5;
let _orDash      = '6 4';
let _labelFontSz = 11;
let _nrPoint     = 18;
let _nrNotable   = 32;

// ── Module state ──────────────────────────────────────────────────────────────
let SKILLS_DATA = null;
let SKILLS_CFG  = null;
let SKILLS_TR   = null;
let _allNodes   = {};
let _bounds     = null;
let _panReady   = false;
let _scale      = _initScale;
let _gradId     = 0;
const _pan      = { x: 0, y: 0 };

// ── Config apply ──────────────────────────────────────────────────────────────
function _applyConfig() {
  const c = SKILLS_CFG ?? {};
  const z = c.zoom ?? {};
  _minScale    = z.min     ?? 0.35;
  _maxScale    = z.max     ?? 1.5;
  _initScale   = z.initial ?? 1.0;
  _zoomStep    = z.step    ?? 1.1;
  _panPad      = (c.pan_pad ?? 100) + (c.node_radius?.notable ?? 32);
  _pawnSize    = c.pawn_size          ?? 120;
  _labelOff    = c.label_offset       ?? 80;
  _ringRadius  = c.center_ring_radius ?? 22;
  _lineW       = c.line_width         ?? 2.5;
  _orDash      = c.line_or_dash       ?? '6 4';
  _labelFontSz = c.label_font_size    ?? 11;
  _nrPoint     = c.node_radius?.point   ?? 18;
  _nrNotable   = c.node_radius?.notable ?? 32;
  _bounds = null;
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function _treeClr(key) {
  const base = SKILLS_CFG?.color ?? {};
  return {
    text: base[key]?.text ?? '#5566aa',
    line: base[key]?.line ?? '#222235',
  };
}
const _learnedClr = () => SKILLS_CFG?.color?.line_learned ?? '#7a5f20';
const _ringClr    = () => SKILLS_CFG?.color?.center_ring  ?? '#3344aa';

// ── Coordinate transform ──────────────────────────────────────────────────────
function treeToWorld(localX, localY, treeKey) {
  const theta = TREE_ANGLE[treeKey];
  const lx    = localX - LOCAL_CX;
  const depth = localY + DEPTH_OFF;
  return {
    x: CENTER_X + lx * Math.cos(theta) + depth * Math.sin(theta),
    y: CENTER_Y + lx * Math.sin(theta) - depth * Math.cos(theta),
  };
}

// ── Requires helpers ──────────────────────────────────────────────────────────
// Cross-tree refs: "treeKey:skillId" → strips prefix
function resolveId(ref) {
  const col = ref.indexOf(':');
  if (col === -1) return ref;
  const prefix = ref.slice(0, col);
  return TREE_ANGLE[prefix] !== undefined ? ref.slice(col + 1) : ref;
}

function reqdMet(skill, learned) {
  const andOk = (skill.requires ?? []).every(r => learned.has(resolveId(r)));
  const or    =  skill.requires_or;
  const orOk  = !or?.length || or.some(g => g.every(r => learned.has(resolveId(r))));
  return andOk && orOk;
}

// ── Index ─────────────────────────────────────────────────────────────────────
function _buildIndex() {
  _allNodes = {};
  _bounds   = null;
  for (const [treeKey, nodes] of Object.entries(SKILLS_DATA ?? {})) {
    for (const node of (Array.isArray(nodes) ? nodes : [])) {
      const pos = treeToWorld(node.position.x, node.position.y, treeKey);
      _allNodes[node.id] = { node, treeKey, wx: pos.x, wy: pos.y };
    }
  }
}

// ── Bounds (cached, depends on _panPad) ───────────────────────────────────────
function _computeBounds() {
  if (_bounds) return _bounds;
  let minX = CENTER_X, maxX = CENTER_X, minY = CENTER_Y, maxY = CENTER_Y;
  for (const { wx, wy } of Object.values(_allNodes)) {
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
  }
  _bounds = {
    minX: minX - _panPad,
    maxX: maxX + _panPad,
    minY: minY - _panPad,
    maxY: maxY + _panPad,
  };
  return _bounds;
}

// ── Open modal ────────────────────────────────────────────────────────────────
export async function openSkills() {
  if (!state.G?.player) return;
  if (!SKILLS_DATA || !SKILLS_CFG || !SKILLS_TR) {
    [SKILLS_DATA, SKILLS_CFG, SKILLS_TR] = await Promise.all([
      api('GET', '/api/skills'),
      api('GET', '/api/skills-config'),
      api('GET', '/api/skills-i18n'),
    ]);
    _applyConfig();
  }
  _buildIndex();
  _scale = _initScale;
  $('sk-points').textContent = state.G.player.skillPoints ?? 0;
  _render();
  _setupPan();
  $('modal-skills').classList.remove('hidden'); // visible before clientWidth measurement
  _centerView();
}

// ── Render all trees ──────────────────────────────────────────────────────────
function _render() {
  const svg   = $('skill-tree-svg');
  const nodes = $('skill-tree-nodes');
  svg.innerHTML   = '';
  nodes.innerHTML = '';

  svg.setAttribute('viewBox', `0 0 ${CANVAS_W} ${CANVAS_H}`);
  svg.setAttribute('width',   CANVAS_W);
  svg.setAttribute('height',  CANVAS_H);
  const canvas = $('skill-tree-canvas');
  canvas.style.width  = CANVAS_W + 'px';
  canvas.style.height = CANVAS_H + 'px';

  const learned  = new Set(state.G?.player?.learnedSkills ?? []);
  const lClr     = _learnedClr();

  // Center ring
  _svgCircle(svg, CENTER_X, CENTER_Y, _ringRadius, 'none', _ringClr(), 1.5);

  // Center → root node lines (nodes with no dependencies)
  for (const { node, treeKey, wx, wy } of Object.values(_allNodes)) {
    if (!(node.requires ?? []).length && !(node.requires_or ?? []).length) {
      const clr = learned.has(node.id) ? lClr : _treeClr(treeKey).line;
      _svgLine(svg, CENTER_X, CENTER_Y, wx, wy, clr, false);
    }
  }

  // Dependency lines
  _gradId = 0;
  for (const { node, treeKey, wx, wy } of Object.values(_allNodes)) {
    const inactiveClr = _treeClr(treeKey).line;

    const drawLine = (reqRef, dashed) => {
      const src = _allNodes[resolveId(reqRef)];
      if (!src) return;
      const bothLearned = learned.has(src.node.id) && learned.has(node.id);
      if (src.treeKey !== treeKey) {
        const clr1 = bothLearned ? lClr : _treeClr(src.treeKey).line;
        const clr2 = bothLearned ? lClr : inactiveClr;
        _svgGradientLine(svg, src.wx, src.wy, wx, wy, clr1, clr2, true);
      } else {
        _svgLine(svg, src.wx, src.wy, wx, wy, bothLearned ? lClr : inactiveClr, dashed);
      }
    };

    for (const reqRef of (node.requires    ?? []))        drawLine(reqRef, false);
    for (const group  of (node.requires_or ?? []))
      for (const reqRef of group)                         drawLine(reqRef, false);
  }

  // Tree labels — drawn after lines so they appear on top
  const treeLabels = {
    magic:    u('html', 'skill_tab_magic',    'Отрицание'),
    battle:   u('html', 'skill_tab_battle',   'Жестокость'),
    survival: u('html', 'skill_tab_survival', 'Смирение'),
  };
  for (const [key, label] of Object.entries(treeLabels)) {
    const theta = TREE_ANGLE[key];
    _svgText(svg,
      CENTER_X + _labelOff * Math.sin(theta),
      CENTER_Y - _labelOff * Math.cos(theta),
      label, _treeClr(key).text, _labelFontSz
    );
  }

  // Player pawn at center (below skill nodes in DOM order)
  const PW      = _pawnSize;
  const pawnEl  = document.createElement('img');
  pawnEl.src       = '/assets/player/pawn.png';
  pawnEl.draggable = false;
  pawnEl.style.cssText =
    `position:absolute;left:${CENTER_X - PW / 2}px;top:${CENTER_Y - PW / 2}px;` +
    `width:${PW}px;height:${PW}px;pointer-events:none;` +
    `filter:drop-shadow(0 0 6px rgba(232,176,74,.8));`;
  nodes.appendChild(pawnEl);

  // Skill nodes
  for (const { node, wx, wy } of Object.values(_allNodes)) {
    const isLearned = learned.has(node.id);
    const sp        = state.G?.player?.skillPoints ?? 0;
    const canLearn  = !isLearned && reqdMet(node, learned) && sp >= (node.uses_point ?? 1);
    const isNotable = node.type === 'notables';
    const r         = isNotable ? _nrNotable : _nrPoint;

    const el = document.createElement('div');
    el.className = [
      'skill-node',
      isNotable ? 'skill-notable' : 'skill-point',
      isLearned ? 'sk-learned' : canLearn ? 'sk-available' : 'sk-locked',
    ].join(' ');
    el.style.cssText = `left:${wx - r}px;top:${wy - r}px;width:${r * 2}px;height:${r * 2}px`;

    const img = document.createElement('img');
    img.src = (isNotable && node.images)
      ? `/assets/skills/${(isLearned || canLearn) ? node.images.active : node.images.disabled}`
      : (isLearned || canLearn) ? '/assets/skills/point.png' : '/assets/skills/point_disabled.png';
    img.draggable = false;
    el.appendChild(img);

    const badge = document.createElement('div');
    badge.className   = isLearned ? 'skill-learned-mark' : 'skill-cost';
    badge.textContent = isLearned ? '✓' : (node.uses_point ?? 1);
    el.appendChild(badge);

    el.addEventListener('pointerenter', e => { sfx.playUi('skill_hover'); _showTip(node, isLearned, canLearn, learned, e); });
    el.addEventListener('pointerleave', () => $('skill-tooltip').classList.add('hidden'));
    if (canLearn) el.addEventListener('click', () => learnSkill(node.id));

    nodes.appendChild(el);
  }
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
function _svgGradientLine(svg, x1, y1, x2, y2, clr1, clr2, dashed) {
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  const id   = `sg_${_gradId++}`;
  const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  grad.setAttribute('id', id);
  grad.setAttribute('gradientUnits', 'userSpaceOnUse');
  grad.setAttribute('x1', x1); grad.setAttribute('y1', y1);
  grad.setAttribute('x2', x2); grad.setAttribute('y2', y2);
  const s0 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  s0.setAttribute('offset', '0%');   s0.setAttribute('stop-color', clr1);
  const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  s1.setAttribute('offset', '100%'); s1.setAttribute('stop-color', clr2);
  grad.appendChild(s0); grad.appendChild(s1);
  defs.appendChild(grad);

  const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  el.setAttribute('x1', x1); el.setAttribute('y1', y1);
  el.setAttribute('x2', x2); el.setAttribute('y2', y2);
  el.setAttribute('stroke',         `url(#${id})`);
  el.setAttribute('stroke-width',   String(_lineW));
  el.setAttribute('stroke-linecap', 'round');
  if (dashed) el.setAttribute('stroke-dasharray', _orDash);
  svg.appendChild(el);
}

function _svgLine(svg, x1, y1, x2, y2, color, dashed) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  el.setAttribute('x1', x1); el.setAttribute('y1', y1);
  el.setAttribute('x2', x2); el.setAttribute('y2', y2);
  el.setAttribute('stroke',        color);
  el.setAttribute('stroke-width',  String(_lineW));
  el.setAttribute('stroke-linecap', 'round');
  if (dashed) el.setAttribute('stroke-dasharray', _orDash);
  svg.appendChild(el);
}

function _svgCircle(svg, cx, cy, r, fill, stroke, sw) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
  el.setAttribute('fill', fill);
  el.setAttribute('stroke', stroke);
  el.setAttribute('stroke-width', sw);
  svg.appendChild(el);
}

function _svgText(svg, x, y, text, fill, size) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  el.setAttribute('x', x); el.setAttribute('y', y);
  el.setAttribute('text-anchor',       'middle');
  el.setAttribute('dominant-baseline', 'middle');
  el.setAttribute('fill',        fill);
  el.setAttribute('font-size',   size);
  el.setAttribute('font-family', 'sans-serif');
  el.textContent = text;
  svg.appendChild(el);
}

// ── Translation helpers ───────────────────────────────────────────────────────
function _trSkill(node) {
  const tr = SKILLS_TR?.[node.id];
  return {
    name: tr?.name        ?? node.name,
    desc: tr?.description ?? node.description,
  };
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function _showTip(node, isLearned, canLearn, learned, e) {
  const tip     = $('skill-tooltip');
  const getName = id => {
    const n = _allNodes[resolveId(id)];
    return n ? _trSkill(n.node).name : id;
  };

  let stateStr;
  if (isLearned) {
    stateStr = u('skills', 'learned_mark', '✓ Изучено');
  } else if (canLearn) {
    stateStr = ufmt('skills', 'learn_tip', { cost: node.uses_point },
      `Нажмите — стоит ${node.uses_point} оч.`);
  } else {
    const missingAnd = (node.requires ?? []).filter(r => !learned.has(resolveId(r)));
    const orGroups   =  node.requires_or ?? [];
    const parts = [];
    if (missingAnd.length)
      parts.push(missingAnd.map(getName).join(' + '));
    if (orGroups.length) {
      const orWord  = u('skills', 'or', 'или');
      const grouped = orGroups
        .map(g => g.length > 1 ? `(${g.map(getName).join(' + ')})` : getName(g[0]))
        .join(` ${orWord} `);
      parts.push(grouped);
    }
    stateStr = `🔒 ${parts.join(', ') || `${node.uses_point ?? 1} оч.`}`;
  }

  const { name, desc } = _trSkill(node);
  tip.innerHTML =
    `<div class="sk-tip-name">${name}</div>` +
    `<div class="sk-tip-desc">${desc}</div>` +
    `<div class="sk-tip-state">${stateStr}</div>`;
  tip.classList.remove('hidden');

  const TW = 200;
  let tx = e.clientX + 16, ty = e.clientY - 10;
  if (tx + TW > window.innerWidth)   tx = e.clientX - TW - 6;
  if (ty + 90  > window.innerHeight) ty = e.clientY - 100;
  tip.style.left = tx + 'px';
  tip.style.top  = ty + 'px';
}

// ── Pan + zoom ────────────────────────────────────────────────────────────────
function _setupPan() {
  if (_panReady) return;
  _panReady = true;

  const wrap = $('skill-tree-wrap');
  let dragging = false, sx = 0, sy = 0, px0 = 0, py0 = 0;

  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('.skill-node')) return;
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    px0 = _pan.x;   py0 = _pan.y;
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add('panning');
    $('skill-tooltip').classList.add('hidden');
  });

  wrap.addEventListener('pointermove', e => {
    if (!dragging) return;
    _pan.x = px0 + e.clientX - sx;
    _pan.y = py0 + e.clientY - sy;
    _clampPan();
    _applyPan();
  });

  const end = () => { dragging = false; wrap.classList.remove('panning'); };
  wrap.addEventListener('pointerup',     end);
  wrap.addEventListener('pointercancel', end);

  // Zoom — pivot around cursor; reads _minScale/_maxScale/_zoomStep at event time
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const factor   = e.deltaY < 0 ? _zoomStep : (1 / _zoomStep);
    const newScale = Math.max(_minScale, Math.min(_maxScale, _scale * factor));
    if (newScale === _scale) return;

    const rect   = wrap.getBoundingClientRect();
    const cx     = e.clientX - rect.left;
    const cy     = e.clientY - rect.top;
    const cvx    = (cx - _pan.x) / _scale;  // canvas point under cursor
    const cvy    = (cy - _pan.y) / _scale;

    _scale  = newScale;
    _pan.x  = cx - cvx * _scale;
    _pan.y  = cy - cvy * _scale;
    _clampPan();
    _applyPan();
  }, { passive: false });
}

// ── Pan limits ────────────────────────────────────────────────────────────────
// Canvas point (wx,wy) → viewport (wx*s + px, wy*s + py).
// Constraint: viewport [0..vw] must overlap [b.minX..b.maxX] in canvas coords.
function _clampPan() {
  const wrap = $('skill-tree-wrap');
  const vw   = wrap.clientWidth;
  const vh   = wrap.clientHeight;
  const b    = _computeBounds();
  const s    = _scale;
  _pan.x = Math.max(-b.maxX * s, Math.min(_pan.x, vw - b.minX * s));
  _pan.y = Math.max(-b.maxY * s, Math.min(_pan.y, vh - b.minY * s));
}

function _centerView() {
  const wrap = $('skill-tree-wrap');
  _pan.x = wrap.clientWidth  / 2 - CENTER_X * _scale;
  _pan.y = wrap.clientHeight / 2 - CENTER_Y * _scale;
  _clampPan();
  _applyPan();
}

// transform-origin:0 0 in CSS → translate then scale keeps math simple:
// canvas (wx,wy) → viewport (wx*s + px, wy*s + py)
function _applyPan() {
  $('skill-tree-canvas').style.transform =
    `translate(${_pan.x}px, ${_pan.y}px) scale(${_scale})`;
}

// ── Skill badge (red dot on topbar button) ────────────────────────────────────
export function updateSkillsBadge() {
  const sp = state.G?.player?.skillPoints ?? 0;
  document.getElementById('btn-skills')?.classList.toggle('has-sp', sp > 0);
}

// ── Learn skill ───────────────────────────────────────────────────────────────
export async function learnSkill(id) {
  const data = await api('POST', '/api/skill/learn', { id });
  if (data.error) { toast(data.error); return; }
  sfx.playUi('skill_learn');
  state.G.player = data.player;
  $('sk-points').textContent = state.G.player.skillPoints ?? 0;
  updateSkillsBadge();
  renderDungeon();
  _buildIndex();
  _render();
  toast(u('skills', 'learned_toast', '✦ Навык изучен!'));
}
