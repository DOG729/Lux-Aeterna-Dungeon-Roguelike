'use strict';
const path   = require('path');
const fs     = require('fs');
const router = require('express').Router();
const { ROOT, VERSION, PLAYER_BASE, SKILLS, SKILLS_CFG, CORE, COMBAT_CFG, MEDIA, ICONS, ACHIEVEMENTS, cfg, saveCfg, SESSION_FILE } = require('../engine/data');
const { state, listSaves, slimSession, hydrateSession, clearSessionAuto } = require('../engine/session');
const { account, resetAccount, grantAchievement } = require('../engine/account');
const { recalcStats }                              = require('../engine/player');
const { setLang, getSection, LANGS }               = require('../engine/translation');

router.get('/api/version',       (_req, res) => res.json({ version: VERSION }));
router.get('/api/manifesto',     (_req, res) => res.json({ player: PLAYER_BASE }));
router.get('/api/skills',        (_req, res) => res.json(SKILLS));
router.get('/api/skills-config', (_req, res) => res.json(SKILLS_CFG));
router.get('/api/skills-i18n',   (_req, res) => res.json(getSection('skills')));
router.get('/api/journal',   (_req, res) => res.json(state.session?.journal ?? []));

router.get('/api/saves', (_req, res) => res.json(listSaves()));
router.delete('/api/saves/:id', (req, res) => {
  const id  = req.params.id;
  const dir = path.join(ROOT, 'save', id);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Сохранение не найдено' });
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

router.get('/api/languages',  (_req, res) => res.json({ current: cfg.lang, langs: LANGS }));
router.get('/api/ui-strings',    (_req, res) => res.json(getSection('ui')));
router.get('/api/ui-sounds',     (_req, res) => res.json(MEDIA.sound));
router.get('/api/media',         (_req, res) => res.json(MEDIA));
router.get('/api/icons',         (_req, res) => res.json(ICONS));
router.get('/api/equip-config',  (_req, res) => res.json(CORE.mechanics.equipment ?? {}));
router.get('/api/combat-config', (_req, res) => {
  const mode = CORE.mechanics?.battle_queue ?? 'together';
  res.json(COMBAT_CFG[mode] ?? { delay_ms: 700, sequential: [] });
});

router.post('/api/language', (req, res) => {
  const { lang } = req.body;
  if (!lang || !LANGS.find(l => l.code === lang))
    return res.status(400).json({ error: 'Unknown language code' });
  setLang(lang);
  saveCfg();
  if (state.session) {
    const slim = slimSession(state.session);
    state.session = hydrateSession(slim);
    recalcStats(state.session.player);
  }
  res.json({ ok: true, lang });
});

router.get('/api/settings', (_req, res) => res.json(cfg));
router.post('/api/settings', (req, res) => {
  const { provider, model, url, ollamaMode, ollamaCloudKey,
          openrouterKey, openrouterModel,
          ollamaJsonMode, openrouterJsonMode, cacheMode,
          bgVolume, battleVolume, sfxVolume } = req.body;
  if (provider === 'ollama' || provider === 'openrouter') cfg.provider = provider;
  if (model)             cfg.model            = model.trim();
  if (url)               cfg.url              = url.trim();
  if (ollamaMode === 'local' || ollamaMode === 'cloud') cfg.ollamaMode = ollamaMode;
  if (ollamaCloudKey != null) cfg.ollamaCloudKey = ollamaCloudKey.trim();
  if (openrouterKey  != null) cfg.openrouterKey   = openrouterKey.trim();
  if (openrouterModel != null && openrouterModel.trim()) cfg.openrouterModel = openrouterModel.trim();
  if (ollamaJsonMode != null) cfg.ollamaJsonMode     = !!ollamaJsonMode;
  if (openrouterJsonMode != null) cfg.openrouterJsonMode = !!openrouterJsonMode;
  if (cacheMode      != null) cfg.cacheMode          = !!cacheMode;
  if (bgVolume     != null && !isNaN(+bgVolume))     cfg.bgVolume     = +bgVolume;
  if (battleVolume != null && !isNaN(+battleVolume)) cfg.battleVolume = +battleVolume;
  if (sfxVolume    != null && !isNaN(+sfxVolume))    cfg.sfxVolume    = +sfxVolume;
  saveCfg();
  res.json({ ok: true, cfg });
});

router.get('/api/credits', (_req, res) => {
  const file = path.join(ROOT, 'assets/db/credits.json');
  try { res.json(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { res.json([]); }
});

router.get('/api/credits-tracks', (_req, res) => {
  const dir = path.join(ROOT, 'assets/sound/credits');
  if (!fs.existsSync(dir)) return res.json([]);
  const tracks = fs.readdirSync(dir)
    .filter(f => /\.(mp3|ogg|wav)$/i.test(f))
    .map(f => `/assets/sound/credits/${f}`);
  res.json(tracks);
});

router.get('/api/music-tracks', (_req, res) => {
  const readDir = (dir, prefix) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => /\.(mp3|ogg|wav)$/i.test(f))
      .map(f => `${prefix}/${f}`);
  };
  res.json({
    bg:     readDir(path.join(ROOT, 'assets/sound/background_music'), '/assets/sound/background_music'),
    battle: readDir(path.join(ROOT, 'assets/sound/battle'),           '/assets/sound/battle')
  });
});

const ASSET_PRELOAD_EXT = /\.(png|jpe?g|webp|gif|svg|mp3|ogg|wav)$/i;
function listAssetUrlsForPreload() {
  const urls = [];
  function walk(relPosix) {
    const dir = path.join(ROOT, 'assets', ...relPosix.split('/').filter(Boolean));
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of ents) {
      const name = ent.name;
      if (ent.isDirectory()) walk(relPosix ? `${relPosix}/${name}` : name);
      else if (ASSET_PRELOAD_EXT.test(name)) {
        const rel = relPosix ? `${relPosix}/${name}` : name;
        urls.push('/assets/' + rel.replace(/\\/g, '/'));
      }
    }
  }
  walk('');
  return [...new Set(urls)].sort();
}

router.get('/api/preload-assets', (_req, res) => {
  res.json({ urls: listAssetUrlsForPreload() });
});

router.get('/api/account', (_req, res) => res.json(account));

router.get('/api/achievements', (_req, res) => res.json(ACHIEVEMENTS));

router.post('/api/achievement/grant', (req, res) => {
  const { id } = req.body ?? {};
  if (!id) return res.status(400).json({ error: 'id required' });

  const def = ACHIEVEMENTS.find(a => a.id === id);
  if (!def) return res.status(404).json({ error: 'Achievement not found' });

  const granted = grantAchievement(id);
  if (!granted) return res.json({ ok: true, already: true });

  // Apply to active session immediately
  if (state.session) {
    const player = state.session.player;
    if (def.type === 'point') {
      player.skillPoints = (player.skillPoints ?? 0) + (def.int ?? 0);
    } else if (def.type === 'stats') {
      const oldMaxHp     = player.maxHp;
      const oldMaxEnergy = player.maxEnergy;
      recalcStats(player);
      // Give the gained resources immediately on grant
      const hpGain     = player.maxHp     - oldMaxHp;
      const energyGain = player.maxEnergy - oldMaxEnergy;
      if (hpGain     > 0) player.hp     = Math.min(player.hp     + hpGain,     player.maxHp);
      if (energyGain > 0) player.energy = Math.min(player.energy + energyGain, player.maxEnergy);
    }
    const { saveSessionAuto, pubSession } = require('../engine/session');
    saveSessionAuto();
    return res.json({ ok: true, granted: true, ...pubSession(state.session) });
  }

  res.json({ ok: true, granted: true });
});

router.post('/api/account/reset', (_req, res) => {
  resetAccount();
  state.session = null;
  clearSessionAuto();
  try { if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); } catch { /* ignore */ }
  res.json({ ok: true });
});

module.exports = router;
