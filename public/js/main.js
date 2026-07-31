'use strict';
import { state }                            from './state.js';
import { u, applyHtmlI18n }                 from './i18n.js';
import { api }                              from './api.js';
import { $, showScreen, loadIcons, applyIconAttrs } from './dom.js';
import { music }                            from './music.js';
import { sfx }                              from './sfx.js';
import { renderDungeon, moveTo }            from './dungeon.js';
import { enterCombat, renderCombat,
         updateCombatButtons, showMercyChoice } from './combat.js';
import { openInventory }                    from './inventory.js';
import { openJournal }                      from './journal.js';
import { openNpc, closeNpcModal }           from './npc.js';
import { openSettings, saveSettings,
         setSettingsTab, setProviderTab }   from './settings.js';
import { openSavesList, saveGame,
         getSavesFromGameover,
         clearSavesFromGameover }           from './saves.js';
import { openSkills }                        from './skills.js';
import { run as runPreloader }              from './preloader.js';
import { preloadMedia }                     from './event.js';
import { applyConditions }                  from './conditions.js';
import { closeScavenge }                   from './scavenge.js';
import { initCreditsBtn }                  from './credits.js';
import { ensureAiReady }                   from './ai_check.js';
import { playDefeatExitAnimation }         from './gameover.js';
import { initDevPanel }                    from './devpanel.js';

// Start preloader immediately — runs in parallel with the init IIFE below
runPreloader();
initCreditsBtn();
initDevPanel();

// Expose renderCombat for inventory.js useItem
window.renderCombat = renderCombat;

// ── Session restore ───────────────────────────────────────────────────────────

function restoreSession(data) {
  closeScavenge();
  state.G = data;
  if (data.coreSoundDefault       != null) sfx.setDefault(data.coreSoundDefault);
  if (data.coreSoundDefaultVolume != null) sfx.setDefaultVolume(data.coreSoundDefaultVolume);
  if (data.coreSoundDefaultMob    != null) sfx.setDefaultMobSounds(data.coreSoundDefaultMob);
  if (state.G.combat) {
    enterCombat();
    if (state.G.combat.pendingMercy) showMercyChoice();
  } else {
    showScreen('dungeon');
    renderDungeon();
  }
}

// ── Menu ──────────────────────────────────────────────────────────────────────

$('btn-continue').addEventListener('click', async () => {
  if (!await ensureAiReady()) return;
  const data = await api('GET', '/api/session');
  if (!data.has) { state.G = null; showScreen('menu'); return; }
  restoreSession(data);
});

$('btn-new-game').addEventListener('click', async () => {
  if (!await ensureAiReady()) return;
  closeScavenge();
  await api('POST', '/api/quit');
  const data = await api('POST', '/api/new-game');
  state.G = data;
  if (data.coreSoundDefault       != null) sfx.setDefault(data.coreSoundDefault);
  if (data.coreSoundDefaultVolume != null) sfx.setDefaultVolume(data.coreSoundDefaultVolume);
  if (data.coreSoundDefaultMob    != null) sfx.setDefaultMobSounds(data.coreSoundDefaultMob);
  showScreen('dungeon');
  renderDungeon();
});

$('btn-load-game').addEventListener('click', () => openSavesList());
$('btn-menu-settings').addEventListener('click', openSettings);

if (window.electronAPI) {
  $('btn-quit-game').classList.remove('hidden');
  $('btn-quit-game').addEventListener('click', () => window.electronAPI.quit());
}

// ── Dungeon top bar ───────────────────────────────────────────────────────────

$('btn-skills').addEventListener('click', openSkills);
$('btn-inventory').addEventListener('click', openInventory);
$('btn-journal').addEventListener('click', openJournal);
$('btn-save').addEventListener('click', saveGame);
$('btn-to-menu').addEventListener('click', () => showScreen('menu'));

// ── Skills modal ──────────────────────────────────────────────────────────────

$('btn-skills-close').addEventListener('click', () => $('modal-skills').classList.add('hidden'));
$('modal-skills').addEventListener('click', e => {
  if (e.target === $('modal-skills')) $('modal-skills').classList.add('hidden');
});

// ── Inventory modal ───────────────────────────────────────────────────────────

$('btn-inv-close').addEventListener('click', () => $('modal-inventory').classList.add('hidden'));
$('modal-inventory').addEventListener('click', e => {
  if (e.target === $('modal-inventory')) $('modal-inventory').classList.add('hidden');
});

// ── Journal modal ─────────────────────────────────────────────────────────────

$('btn-journal-close').addEventListener('click', () => $('modal-journal').classList.add('hidden'));
$('modal-journal').addEventListener('click', e => {
  if (e.target === $('modal-journal')) $('modal-journal').classList.add('hidden');
});

// ── Combat message counter ────────────────────────────────────────────────────

$('cbt-msg').addEventListener('input', () => {
  $('cbt-msg-count').textContent = `${$('cbt-msg').value.length}/255`;
});

// ── Settings ──────────────────────────────────────────────────────────────────

$('btn-settings-save').addEventListener('click', saveSettings);
$('btn-settings-close').addEventListener('click', () => $('modal-settings').classList.add('hidden'));
$('modal-settings').addEventListener('click', e => {
  if (e.target === $('modal-settings')) $('modal-settings').classList.add('hidden');
});
document.querySelectorAll('.stab').forEach(tab => {
  tab.addEventListener('click', () => setSettingsTab(tab.dataset.stab));
});
document.querySelectorAll('.provider-tab').forEach(tab => {
  tab.addEventListener('click', () => setProviderTab(tab.dataset.provider));
});

// ── Volume sliders ────────────────────────────────────────────────────────────

$('inp-bg-vol').addEventListener('input', () => {
  const v = parseFloat($('inp-bg-vol').value);
  $('lbl-bg-vol').textContent = Math.round(v * 100) + '%';
  music.setVolumes(v, parseFloat($('inp-bt-vol').value));
});
$('inp-bt-vol').addEventListener('input', () => {
  const v = parseFloat($('inp-bt-vol').value);
  $('lbl-bt-vol').textContent = Math.round(v * 100) + '%';
  music.setVolumes(parseFloat($('inp-bg-vol').value), v);
});
$('inp-sfx-vol').addEventListener('input', () => {
  const v = parseFloat($('inp-sfx-vol').value);
  $('lbl-sfx-vol').textContent = Math.round(v * 100) + '%';
  sfx.setVolume(v);
});

$('btn-bg-play').addEventListener('click', () => music.previewBg(true));
$('btn-bg-stop').addEventListener('click', () => music.previewBg(false));
$('btn-bt-play').addEventListener('click', () => music.previewBattle(true));
$('btn-bt-stop').addEventListener('click', () => music.previewBattle(false));

// ── Saves modal ───────────────────────────────────────────────────────────────

$('btn-saves-close').addEventListener('click', () => {
  $('modal-saves').classList.add('hidden');
  if (getSavesFromGameover()) {
    clearSavesFromGameover();
    $('modal-gameover').classList.remove('hidden');
  }
});

// ── Game over modal ───────────────────────────────────────────────────────────

$('btn-go-continue').addEventListener('click', () => {
  $('modal-gameover').classList.add('hidden');
  showScreen('dungeon');
  renderDungeon();
});
$('btn-go-load').addEventListener('click', async () => {
  await playDefeatExitAnimation();
  $('modal-gameover').classList.add('hidden');
  openSavesList(true);
});
$('btn-go-new').addEventListener('click', async () => {
  if (!await ensureAiReady()) return;
  await playDefeatExitAnimation();
  $('modal-gameover').classList.add('hidden');
  await api('POST', '/api/quit');
  const data = await api('POST', '/api/new-game');
  state.G = data;
  showScreen('dungeon');
  renderDungeon();
});

// ── Level up modal ────────────────────────────────────────────────────────────

$('btn-lu-ok').addEventListener('click', () => {
  $('modal-levelup').classList.add('hidden');
  renderDungeon();
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Escape') {
    const modals = ['modal-npc', 'modal-skills', 'modal-inventory', 'modal-journal', 'modal-settings', 'modal-saves'];
    const open = modals.find(id => !$(id)?.classList.contains('hidden'));
    if (open === 'modal-npc') { closeNpcModal(); return; }
    if (open) { $(open).classList.add('hidden'); return; }
    if ($('screen-dungeon').classList.contains('active') || $('screen-combat').classList.contains('active')) {
      showScreen('menu');
    }
    return;
  }
  if (!$('screen-dungeon').classList.contains('active') || !state.G?.player) return;
  if (e.code === 'KeyI') { e.preventDefault(); openInventory(); }
  if (e.code === 'KeyP') { e.preventDefault(); openSkills(); }
  if (e.code === 'KeyJ') { e.preventDefault(); openJournal(); }
});

// ── Chrome autoplay unlock ────────────────────────────────────────────────────

document.addEventListener('click', () => music.unlock(), { once: true });

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  try { state.UI = await api('GET', '/api/ui-strings'); } catch { /* fallbacks apply */ }
  applyHtmlI18n();
  await loadIcons();
  applyIconAttrs();
  try {
    const { version } = await api('GET', '/api/version');
    if (version) $('game-version').textContent = `v${version}`;
  } catch { /* leave blank */ }
  try { sfx.loadUiSounds(await api('GET', '/api/ui-sounds')); } catch { /* no ui sounds */ }
  preloadMedia().catch(() => {});

  try {
    const cfg = await api('GET', '/api/settings');
    music.setVolumes(cfg.bgVolume ?? 0.25, cfg.battleVolume ?? 0.25);
    sfx.setVolume(cfg.sfxVolume ?? 0.2);
  } catch { /* use defaults */ }
  music.init();
  sfx.initUI();

  try {
    const sess = await api('GET', '/api/session');
    if (sess.coreSoundDefault       != null) sfx.setDefault(sess.coreSoundDefault);
    if (sess.coreSoundDefaultVolume != null) sfx.setDefaultVolume(sess.coreSoundDefaultVolume);
    if (sess.coreSoundDefaultMob    != null) sfx.setDefaultMobSounds(sess.coreSoundDefaultMob);
    if (sess.has) {
      state.G = sess;
      $('btn-continue').classList.remove('hidden');
    }
  } catch { /* no session */ }

  // Применить if/if-else/else директивы на начальном меню
  applyConditions(document.getElementById('screen-menu'));
})();
