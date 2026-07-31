'use strict';
const path = require('path');
const fs   = require('fs');

const ROOT = process.env.ELECTRON_ASSETS_PATH
  ? path.dirname(process.env.ELECTRON_ASSETS_PATH)
  : path.join(__dirname, '..', '..');

// Each entry in a manifesto can be a string (relative file path) or inline object/array.
// Array manifests  → flat array  (string entries are loaded and spread if they're arrays).
//   merge:true     → flat object (entries merged via Object.assign — for keyed-by-id collections).
// Object manifests → object      (string values replaced by loaded file content).
function loadManifest(filePath, { merge = false } = {}) {
  const dir = path.dirname(filePath);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  function resolve(entry) {
    if (typeof entry === 'string') return JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8'));
    return entry;
  }
  if (Array.isArray(raw)) {
    if (merge) {
      const result = {};
      for (const entry of raw) Object.assign(result, resolve(entry));
      return result;
    }
    const result = [];
    for (const entry of raw) {
      const val = resolve(entry);
      if (Array.isArray(val)) result.push(...val); else result.push(val);
    }
    return result;
  }
  const result = {};
  for (const [k, v] of Object.entries(raw)) result[k] = typeof v === 'string' ? resolve(v) : v;
  return result;
}

// Metadata of the BUILT app (name/version/author/license/…) — assets/meta.json,
// not package.json. Lives under assets/ so it ships with the game via the same
// extraResources copy as everything else, instead of needing package.json
// bundled into the packaged app just for this one field.
const META    = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/meta.json'), 'utf8'));
const VERSION = META.version ?? '0.0.0';

const PLAYER_BASE    = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/player.json'), 'utf8'));
const MOBS           = loadManifest(path.join(ROOT, 'assets/mob/manifesto.json'));
const BOSSES         = loadManifest(path.join(ROOT, 'assets/boss/manifesto.json'));
const ITEMS          = loadManifest(path.join(ROOT, 'assets/item/manifesto.json'));
const OBJECTS        = loadManifest(path.join(ROOT, 'assets/object/manifesto.json'));
const MAP            = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/map/manifesto.json'), 'utf8'));
const SKILLS         = loadManifest(path.join(ROOT, 'assets/skills/manifesto.json'));
const ALL_SKILLS     = [...(SKILLS.battle ?? []), ...(SKILLS.survival ?? []), ...(SKILLS.magic ?? [])];
const NPCS           = loadManifest(path.join(ROOT, 'assets/npc/manifesto.json'));

const PROGRESSION    = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/progression.json'), 'utf8'));
const DUNGEON_LEVELS = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/dungeon_levels.json'), 'utf8'));
const CORE           = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/core.json'), 'utf8'));
const COMBAT_CFG     = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/combat.json'), 'utf8'));
const SKILLS_CFG     = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/skills.json'), 'utf8'));
const CONDITIONS     = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/conditions.json'), 'utf8'));
const NARRATIVE      = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/narrative.json'), 'utf8'));
const ACHIEVEMENTS   = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/achievements.json'), 'utf8'));
const MEDIA          = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/media.json'),     'utf8'));
const ICONS          = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/icons.json'),     'utf8'));
const AI_TEST_CFG    = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/ai_test.json'),   'utf8'));
const NPC_COMBAT_CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/npc_combat.json'), 'utf8'));
// Lore topic registry (key -> {path, description}) — see assets/config/lore.json's
// _doc. Actual content lives per-language under assets/translation/{lang}/promts/lore/.
const LORE            = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/config/lore.json'),      'utf8'));

const DIALOGUE_MFST = path.join(ROOT, 'assets/dialogue/manifesto.json');
const DIALOGUE = fs.existsSync(DIALOGUE_MFST) ? loadManifest(DIALOGUE_MFST, { merge: true }) : {};

const EVENT_MFST = path.join(ROOT, 'assets/event/manifesto.json');
const EVENT = fs.existsSync(EVENT_MFST) ? loadManifest(EVENT_MFST, { merge: true }) : {};

// Load all scavenge scenes from assets/scavenge/scenes/
const SCAVENGE_SCENES_DIR = path.join(ROOT, 'assets/scavenge/scenes');
const SCAVENGE = {};
if (fs.existsSync(SCAVENGE_SCENES_DIR)) {
  for (const f of fs.readdirSync(SCAVENGE_SCENES_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const scene = JSON.parse(fs.readFileSync(path.join(SCAVENGE_SCENES_DIR, f), 'utf8'));
      SCAVENGE[scene.id] = scene;
    } catch { /* skip malformed */ }
  }
}

const SAVE_DIR     = process.env.ELECTRON_USER_DATA
  ? path.join(process.env.ELECTRON_USER_DATA, 'save')
  : path.join(ROOT, 'save');
const CFG_FILE     = path.join(SAVE_DIR, 'config.json');
const SESSION_FILE = path.join(SAVE_DIR, '.session.json');
if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR);

const CFG_DEFAULTS = {
  provider: 'ollama',
  model: 'gpt-oss:20b-cloud', url: 'http://127.0.0.1:11434',
  ollamaMode: 'local', ollamaCloudKey: '',
  openrouterKey: '', openrouterModel: 'openai/gpt-oss-120b:free',
  ollamaJsonMode: true, openrouterJsonMode: true,
  cacheMode: true,
  bgVolume: 0.25, battleVolume: 0.25, sfxVolume: 0.2,
  lang: 'ru'
};
const cfg = { ...CFG_DEFAULTS };
if (fs.existsSync(CFG_FILE)) {
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); }
  catch { /* keep defaults */ }
}
function saveCfg() {
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));
}

module.exports = {
  ROOT, META, VERSION,
  PLAYER_BASE, MOBS, BOSSES, ITEMS, OBJECTS, MAP, PROGRESSION, SKILLS, ALL_SKILLS,
  NPCS, DUNGEON_LEVELS, CORE, COMBAT_CFG, SKILLS_CFG, CONDITIONS, NARRATIVE, ACHIEVEMENTS, MEDIA, ICONS, AI_TEST_CFG, NPC_COMBAT_CFG, DIALOGUE, EVENT, LORE, SCAVENGE,
  SAVE_DIR, CFG_FILE, SESSION_FILE,
  cfg, saveCfg
};
