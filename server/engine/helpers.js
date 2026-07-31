'use strict';
const { MAP, MOBS, DUNGEON_LEVELS } = require('./data');

let _uid = 0;
const uid   = () => `u${++_uid}${Math.random().toString(36).slice(2, 6)}`;
const rng   = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const OPP   = { right: 'left', left: 'right', bottom: 'top', top: 'bottom' };
const DELTA = { right: [1, 0], left: [-1, 0], bottom: [0, 1], top: [0, -1] };

// Parses level specs: 5, [1,2,3], "3-7", ["1-5", 8] → Set<number>
function parseLevels(spec) {
  if (spec == null) return null;
  const arr = Array.isArray(spec) ? spec : [spec];
  const out = new Set();
  for (const item of arr) {
    if (typeof item === 'number') {
      out.add(item);
    } else {
      const m = String(item).match(/^(\d+)-(\d+)$/);
      if (m) for (let i = +m[1]; i <= +m[2]; i++) out.add(i);
      else { const n = Number(item); if (!isNaN(n)) out.add(n); }
    }
  }
  return out;
}

function levelMatches(spec, level) {
  if (spec == null) return true;
  return parseLevels(spec).has(level);
}

function getDungeonLevelCfg(level) {
  for (const [key, val] of Object.entries(DUNGEON_LEVELS)) {
    if (key === 'default') continue;
    if (parseLevels(key).has(level)) return val;
  }
  return DUNGEON_LEVELS.default ?? { min: 8, max: 14 };
}

// Fallback: find highest level ≤ requested that has matching map generation sections
function resolveMapLevel(requested) {
  for (let l = requested; l >= 1; l--)
    if (MAP.section.some(s => s.action === 'generation' && levelMatches(s.level, l))) return l;
  return requested;
}

// Fallback: find highest level ≤ requested that has matching mobs
function resolveMobLevel(requested) {
  for (let l = requested; l >= 1; l--)
    if (MOBS.some(m => levelMatches(m.level, l))) return l;
  return requested;
}

// Resolves imags/effects paths by prepending basePath.
// imags.effects and top-level effects are merged into a single effects map.
//
// Effect values are keyed by ability ID and support two forms:
//   Simple:  "heal": "path.png"  or  "heal": ["f1.png","f2.png"]
//   Object:  "attack": { "hit": "path.png", "crit": "crit.png" }
//            (both hit/crit accept string or array of frames)
function resolveImags(imags, effects, basePath) {
  if (!imags && !effects) return null;
  const resolvePath = v => Array.isArray(v) ? v.map(f => basePath + f) : basePath + v;
  const out = {};
  if (imags) {
    for (const [k, v] of Object.entries(imags)) {
      if (k === 'effects') continue;
      out[k] = resolvePath(v);
    }
  }
  const effectSrc = { ...(imags?.effects ?? {}), ...(effects ?? {}) };
  if (Object.keys(effectSrc).length) {
    out.effects = {};
    for (const [k, v] of Object.entries(effectSrc)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // Nested hit/crit object — resolve each sub-value individually
        const resolved = {};
        for (const [sk, sv] of Object.entries(v)) resolved[sk] = resolvePath(sv);
        out.effects[k] = resolved;
      } else {
        out.effects[k] = resolvePath(v);
      }
    }
  }
  return out;
}

module.exports = {
  uid, rng, clamp,
  OPP, DELTA,
  parseLevels, levelMatches, getDungeonLevelCfg,
  resolveMapLevel, resolveMobLevel,
  resolveImags
};
