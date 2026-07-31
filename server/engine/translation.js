'use strict';
const path = require('path');
const fs   = require('fs');
const { ROOT, cfg } = require('./data');

const LANGS_FILE = path.join(ROOT, 'assets/config/translation.json');
const LANGS      = JSON.parse(fs.readFileSync(LANGS_FILE, 'utf8'));
const CORE_LANG  = LANGS.find(l => l.is_core)?.code ?? 'en';

// Full English name for a language code — used whenever a prompt needs to pin the
// model to the active game language explicitly (weak models drift to English
// otherwise instead of just mirroring the language of the surrounding instructions).
const LANG_NAMES = { ru: 'Russian', en: 'English', de: 'German', fr: 'French', es: 'Spanish', zh: 'Chinese', ja: 'Japanese' };
function langName(langCode = cfg.lang) {
  return LANG_NAMES[langCode] ?? langCode ?? 'English';
}

function loadLang(code) {
  const dir = path.join(ROOT, 'assets/translation', code);
  if (!fs.existsSync(dir)) return {};
  const result = {};
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const key = path.basename(file, '.json');
    try { result[key] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); }
    catch { /* skip broken file */ }
  }
  return result;
}

let TR_ACTIVE = loadLang(cfg.lang ?? 'ru');
let TR_CORE   = loadLang(CORE_LANG);

// Resolve: active → core → fallback
// field may be a string/number key, or [key, vars] where vars is an object for {placeholder} replacement
function t(type, id, field, fallback = '') { 
  const [key, vars] = Array.isArray(field) ? field : [field, null];
  let str = TR_ACTIVE[type]?.[id]?.[key]
         ?? TR_CORE[type]?.[id]?.[key]
         ?? fallback;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v));
  return str;
}

function setLang(code) {
  cfg.lang  = code;
  TR_ACTIVE = loadLang(code);
}

// Returns a merged section (core → active) for client consumption
function getSection(type) {
  const core   = TR_CORE[type]   ?? {};
  const active = TR_ACTIVE[type] ?? {};
  const result = {};
  for (const [id, fields] of Object.entries(core))   result[id] = { ...fields };
  for (const [id, fields] of Object.entries(active)) result[id] = { ...(result[id] ?? {}), ...fields };
  return result;
}

// t() returns whatever is stored at the key (string, object, or array), so
// "promt": "...", "promt": { "general": "...", ... } and "promt": [variant, ...]
// all work transparently. An array means "pick one variant at random" — same
// mob/NPC def, different personality per spawn, so repeat encounters don't
// all feel identical. Each array entry is itself a string or {general,...} object.
function resolvePromt(ns, id, basePromt) {
  const resolved = t(ns, id, 'promt', basePromt ?? '');
  if (Array.isArray(resolved) && resolved.length) {
    return resolved[Math.floor(Math.random() * resolved.length)];
  }
  return resolved;
}

module.exports = { t, setLang, getSection, resolvePromt, LANGS, CORE_LANG, langName };
