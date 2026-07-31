'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app = express();
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

// ── Manifest resolution (mirrors server/engine/data.js loadManifest) ──────────
// A manifesto.json entry can be an inline object OR a string filename pointing
// at assets/<kind>/<file>.json ("split" format, one entity per file). This dev
// server used to read manifests with a bare JSON.parse, which — unlike the real
// game server — never resolved string entries. That made the editor crash on
// split manifests (list items had no .id) and, worse, made "Save" flatten the
// whole split layout into inline objects on the very first write.
function loadManifestFlat(filePath) {
  const dir = path.dirname(filePath);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw)) return raw;
  const result = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') { result.push(entry); continue; }
    const val = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8'));
    if (Array.isArray(val)) result.push(...val); else result.push(val);
  }
  return result;
}

// Same resolution, but each entry resolved from a string reference is tagged
// with __sourceFile so a later save can write it back to that exact file
// instead of collapsing it into the manifest array.
function loadManifestTagged(filePath) {
  const dir = path.dirname(filePath);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw)) return raw;
  const result = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') { result.push(entry); continue; }
    const val = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8'));
    result.push({ ...val, __sourceFile: entry });
  }
  return result;
}

// Inverse of loadManifestTagged: entries carrying __sourceFile get written back
// to that file (split layout preserved); everything else goes inline into the
// manifest array itself, in the order the client sent them.
function saveManifestTagged(filePath, entries) {
  const dir = path.dirname(filePath);
  const manifestList = [];
  for (const raw of entries) {
    const { __sourceFile, ...entry } = raw ?? {};
    if (__sourceFile) {
      fs.writeFileSync(path.join(dir, __sourceFile), JSON.stringify(entry, null, 2), 'utf8');
      if (!manifestList.includes(__sourceFile)) manifestList.push(__sourceFile);
    } else {
      manifestList.push(entry);
    }
  }
  fs.writeFileSync(filePath, JSON.stringify(manifestList, null, 2), 'utf8');
}

// ── Manifests (map generation) ────────────────────────────────────────────────
const MAP         = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'map',    'manifesto.json'), 'utf8'));
const MOBS        = loadManifestFlat(path.join(__dirname, '..', 'assets', 'mob',    'manifesto.json'));
const OBJECTS     = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'object', 'manifesto.json'), 'utf8'));
const NPCS        = loadManifestFlat(path.join(__dirname, '..', 'assets', 'npc',    'manifesto.json'));
const CORE        = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'config', 'core.json'),      'utf8'));
const PLAYER_BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'player.json'),             'utf8'));
const SKILLS      = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'skills', 'manifesto.json'),'utf8'));
const ITEMS       = loadManifestFlat(path.join(__dirname, '..', 'assets', 'item',   'manifesto.json'));
const PROGRESSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'config', 'progression.json'),'utf8'));
const BOSSES_PATH = path.join(__dirname, '..', 'assets', 'boss', 'manifesto.json');
const BOSSES      = fs.existsSync(BOSSES_PATH) ? loadManifestFlat(BOSSES_PATH) : [];

const PLAN_DIR       = path.join(__dirname, '..', 'assets', 'level_plan');
const DUNGEON_LEVELS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'config', 'dungeon_levels.json'), 'utf8'));

// ── Map generation helpers ────────────────────────────────────────────────────
const rng   = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const OPP   = { right: 'left', left: 'right', bottom: 'top', top: 'bottom' };
const DELTA = { right: [1, 0], left: [-1, 0], bottom: [0, 1], top: [0, -1] };

function parseLevels(spec) {
  if (spec == null) return null;
  const arr = Array.isArray(spec) ? spec : [spec];
  const out = new Set();
  for (const item of arr) {
    if (typeof item === 'number') { out.add(item); continue; }
    const m = String(item).match(/^(\d+)-(\d+)$/);
    if (m) for (let i = +m[1]; i <= +m[2]; i++) out.add(i);
    else { const n = Number(item); if (!isNaN(n)) out.add(n); }
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
function pickBestSection(passages, genSecs) {
  const DIRS  = ['left', 'right', 'top', 'bottom'];
  const exact = genSecs.filter(s => DIRS.every(d => !!s.passage[d] === !!passages[d]));
  if (exact.length) return exact[rng(0, exact.length - 1)];
  let best = null, bestCount = -1;
  for (const s of genSecs) {
    if (DIRS.some(d => s.passage[d] && !passages[d])) continue;
    const count = DIRS.filter(d => s.passage[d]).length;
    if (count > bestCount) { best = s; bestCount = count; }
  }
  return best;
}
function generateLayout(level) {
  const cfg = getDungeonLevelCfg(level);
  if (cfg.plan) return null;
  const TARGET = rng(cfg.min ?? 8, cfg.max ?? 14);

  const spawnCands = MAP.section.filter(s => s.action === 'spawn' && levelMatches(s.level, level));
  const spawnSec   = spawnCands.length ? spawnCands[rng(0, spawnCands.length - 1)] : MAP.section.find(s => s.action === 'spawn');
  const spawnP     = spawnSec?.passage ?? { left: false, right: true, top: false, bottom: false };

  const rooms        = { '0,0': { gid: '0,0', x: 0, y: 0, type: 'spawn', sectionId: spawnSec?.id ?? 'start', image: spawnSec?.image ?? '', passages: { ...spawnP } } };
  const genSecs      = MAP.section.filter(s => s.action === 'generation' && levelMatches(s.level, level));
  const deadEndSecs  = genSecs.filter(s => Object.values(s.passage).filter(Boolean).length === 1);
  const sectionPlaced = {};
  const frontier     = [];
  const placed       = new Set(['0,0']);

  for (const [dir, open] of Object.entries(spawnP)) {
    if (!open) continue;
    const [dx, dy] = DELTA[dir];
    frontier.push({ x: dx, y: dy, required: OPP[dir], parentGid: '0,0', parentDir: dir });
  }

  while (frontier.length > 0 && placed.size < TARGET) {
    const fi = rng(0, frontier.length - 1);
    const { x, y, required, parentGid, parentDir } = frontier.splice(fi, 1)[0];
    const gid = `${x},${y}`;
    if (placed.has(gid)) continue;

    let cands = genSecs.filter(s => s.passage[required]);
    if (!cands.length) { if (rooms[parentGid]) rooms[parentGid].passages[parentDir] = false; continue; }
    cands = cands.filter(s => !s.count || (sectionPlaced[s.id] ?? 0) < s.count);
    if (!cands.length) { if (rooms[parentGid]) rooms[parentGid].passages[parentDir] = false; continue; }

    const budget   = TARGET - placed.size;
    if (frontier.length === 0 && budget > 1) { const nd = cands.filter(s => Object.values(s.passage).filter(Boolean).length > 1); if (nd.length) cands = nd; }
    const forceEnd = budget <= 1 || (budget <= frontier.length && Math.random() < 0.6);
    if (forceEnd && deadEndSecs.some(s => s.passage[required])) { const dc = cands.filter(s => Object.values(s.passage).filter(Boolean).length === 1); if (dc.length) cands = dc; }
    const pending = cands.filter(s => s.always && !(sectionPlaced[s.id] ?? 0));
    if (pending.length) cands = pending;

    const sec = cands[rng(0, cands.length - 1)];
    sectionPlaced[sec.id] = (sectionPlaced[sec.id] ?? 0) + 1;
    rooms[gid] = { gid, x, y, type: 'normal', sectionId: sec.id, image: sec.image, passages: { ...sec.passage } };
    placed.add(gid);

    for (const [dir, open] of Object.entries(rooms[gid].passages)) {
      if (!open || dir === required) continue;
      const [dx, dy] = DELTA[dir];
      const nx = x + dx, ny = y + dy;
      if (!placed.has(`${nx},${ny}`)) frontier.push({ x: nx, y: ny, required: OPP[dir], parentGid: gid, parentDir: dir });
    }
  }

  for (const { parentGid, parentDir } of frontier) {
    const r = rooms[parentGid]; if (!r) continue;
    r.passages[parentDir] = false;
    if (r.type !== 'spawn') { const s = pickBestSection(r.passages, genSecs); if (s) { r.sectionId = s.id; r.image = s.image; } }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [gid, room] of Object.entries(rooms)) {
      if (room.type !== 'spawn' && !Object.values(room.passages).some(Boolean)) { delete rooms[gid]; changed = true; continue; }
      for (const dir of ['left', 'right', 'top', 'bottom']) {
        if (!room.passages[dir]) continue;
        const [dx, dy] = DELTA[dir];
        const nbr = rooms[`${room.x + dx},${room.y + dy}`];
        if (!nbr || !nbr.passages[OPP[dir]]) {
          room.passages[dir] = false;
          if (room.type !== 'spawn') { const s = pickBestSection(room.passages, genSecs); if (s) { room.sectionId = s.id; room.image = s.image; } }
          changed = true;
        }
      }
    }
  }
  return rooms;
}

// ── Map API routes ────────────────────────────────────────────────────────────
app.get('/api/manifest', (_req, res) => res.json({ map: MAP, mobs: MOBS, objects: OBJECTS, npcs: NPCS }));
app.get('/api/core',     (_req, res) => res.json(CORE));

app.get('/api/generate', (req, res) => {
  const level = Math.max(1, parseInt(req.query.level) || 1);
  const rooms = generateLayout(level);
  if (!rooms) return res.status(400).json({ error: 'Уровень использует готовую карту (plan)' });
  res.json({ rooms });
});

app.get('/api/plans', (_req, res) => {
  if (!fs.existsSync(PLAN_DIR)) return res.json([]);
  res.json(fs.readdirSync(PLAN_DIR).filter(f => f.endsWith('.json')).sort());
});
app.get('/api/equip-config', (_req, res) => res.json(CORE.mechanics?.equipment ?? {}));
app.get('/api/balance/data', (_req, res) => res.json({ player_base: PLAYER_BASE, skills: SKILLS, items: ITEMS, mobs: MOBS, bosses: BOSSES, progression: PROGRESSION, core: CORE, dungeon_levels: DUNGEON_LEVELS }));

app.get('/api/plans/:file', (req, res) => {
  const file = path.basename(req.params.file);
  if (!file.endsWith('.json')) return res.status(400).json({ error: 'Invalid file' });
  const full = path.join(PLAN_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(full);
});
app.put('/api/plans/:file', (req, res) => {
  const file = path.basename(req.params.file);
  if (!file.endsWith('.json')) return res.status(400).json({ error: 'Invalid file' });
  if (!fs.existsSync(PLAN_DIR)) fs.mkdirSync(PLAN_DIR, { recursive: true });
  fs.writeFileSync(path.join(PLAN_DIR, file), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// ── Data CRUD (mob / boss / npc / item) ───────────────────────────────────────
const DATA_PATHS = {
  mob:  path.join(__dirname, '..', 'assets', 'mob',  'manifesto.json'),
  boss: path.join(__dirname, '..', 'assets', 'boss', 'manifesto.json'),
  npc:  path.join(__dirname, '..', 'assets', 'npc',  'manifesto.json'),
  item: path.join(__dirname, '..', 'assets', 'item', 'manifesto.json'),
};
app.get('/api/data/:type', (req, res) => {
  const fp = DATA_PATHS[req.params.type];
  if (!fp) return res.status(404).json({ error: 'Unknown type' });
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try { res.json(loadManifestTagged(fp)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/data/:type', (req, res) => {
  const fp = DATA_PATHS[req.params.type];
  if (!fp) return res.status(404).json({ error: 'Unknown type' });
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected an array' });
  try { saveManifestTagged(fp, req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Scavenge scene editor API ─────────────────────────────────────────────────
const SCAVENGE_DIR  = path.join(__dirname, '..', 'assets', 'scavenge', 'scenes');
const SCAVENGE_OBJS = path.join(__dirname, '..', 'assets', 'scavenge', 'objects');

app.get('/api/scavenge/scenes', (_req, res) => {
  if (!fs.existsSync(SCAVENGE_DIR)) return res.json([]);
  res.json(fs.readdirSync(SCAVENGE_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
});
app.get('/api/scavenge/scene/:id', (req, res) => {
  const file = path.join(SCAVENGE_DIR, req.params.id + '.json');
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});
app.put('/api/scavenge/scene/:id', (req, res) => {
  const scene = req.body;
  if (!scene?.id) return res.status(400).json({ error: 'missing id' });
  if (!fs.existsSync(SCAVENGE_DIR)) fs.mkdirSync(SCAVENGE_DIR, { recursive: true });
  fs.writeFileSync(path.join(SCAVENGE_DIR, req.params.id + '.json'), JSON.stringify(scene, null, 2), 'utf8');
  res.json({ ok: true });
});
app.get('/api/scavenge/assets/bg', (_req, res) => {
  if (!fs.existsSync(SCAVENGE_DIR)) return res.json([]);
  res.json(fs.readdirSync(SCAVENGE_DIR).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)));
});
app.get('/api/scavenge/assets/objects', (_req, res) => {
  if (!fs.existsSync(SCAVENGE_OBJS)) return res.json([]);
  res.json(fs.readdirSync(SCAVENGE_OBJS).filter(f => /\.(png|jpg|webp)$/i.test(f)).map(f => 'objects/' + f));
});

// ── Static ────────────────────────────────────────────────────────────────────
app.use('/editors', express.static(path.join(__dirname, 'editors')));
app.use('/dev_js',  express.static(path.join(__dirname, 'js')));
app.use('/dev_css', express.static(path.join(__dirname, 'css')));
app.use('/dev_image', express.static(path.join(__dirname, 'image')));
app.use('/pub_js',  express.static(path.join(__dirname, '..', 'public', 'js')));

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/',        (_req, res) => res.sendFile(path.join(__dirname, 'editors', 'index.html')));
app.get('/map',     (_req, res) => res.sendFile(path.join(__dirname, 'editors', 'map.html')));
app.get('/scavenge',(_req, res) => res.sendFile(path.join(__dirname, 'editors', 'scavenge.html')));
app.get('/balance', (_req, res) => res.sendFile(path.join(__dirname, 'editors', 'balance.html')));

const PORT = 3001;
app.listen(PORT, () => console.log(`\n  ⚙  Dev Editor: http://localhost:${PORT}\n`));
