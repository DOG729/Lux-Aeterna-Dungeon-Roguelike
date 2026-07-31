'use strict';
import { state }    from './state.js';
import { api }      from './api.js';
import { $, toast } from './dom.js';
import { u, ufmt }  from './i18n.js';
import { music }    from './music.js';
import { sfx }      from './sfx.js';

let _selectedLang  = null;
let _ollamaMode    = 'local';

export function setSettingsTab(name) {
  document.querySelectorAll('.stab').forEach(t =>
    t.classList.toggle('active', t.dataset.stab === name)
  );
  document.querySelectorAll('.stab-pane').forEach(p =>
    p.classList.toggle('hidden', p.id !== `stab-${name}`)
  );
}

export function setProviderTab(provider) {
  document.querySelectorAll('.provider-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.provider === provider)
  );
  $('settings-ollama').classList.toggle('hidden',     provider !== 'ollama');
  $('settings-openrouter').classList.toggle('hidden', provider !== 'openrouter');
}

function _applyOllamaMode(mode) {
  _ollamaMode = mode;
  document.querySelectorAll('.ollama-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.omode === mode)
  );
  $('ollama-local-fields').classList.toggle('hidden', mode !== 'local');
  $('ollama-cloud-fields').classList.toggle('hidden', mode !== 'cloud');
}

let _ollamaModesBound = false;
function _initOllamaModeButtons() {
  if (_ollamaModesBound) return;
  _ollamaModesBound = true;
  document.querySelectorAll('.ollama-mode-btn').forEach(btn =>
    btn.addEventListener('click', () => _applyOllamaMode(btn.dataset.omode))
  );
}

function buildLangButtons(langs, current) {
  _selectedLang = current;
  const grid = $('lang-buttons');
  grid.innerHTML = '';
  for (const lang of langs) {
    const btn = document.createElement('button');
    btn.className    = 'lang-btn' + (lang.code === current ? ' active' : '');
    btn.dataset.code = lang.code;
    btn.innerHTML    = `<span>${lang.name}</span><span class="lang-code">${lang.code}</span>`;
    btn.addEventListener('click', () => {
      _selectedLang = lang.code;
      grid.querySelectorAll('.lang-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.code === lang.code)
      );
    });
    grid.appendChild(btn);
  }
}

function _renderAccountStats(acc) {
  const row = (label, value) =>
    `<div class="account-stat-row"><span class="account-stat-label">${label}</span><span class="account-stat-value">${value}</span></div>`;
  $('account-stats').innerHTML = [
    row(u('html', 'acc_total_defeats', 'Поражений'), acc.totalDefeats ?? 0),
    row(u('html', 'acc_floor',   'Макс. этаж'),         acc.maxFloor       ?? 0),
    row(u('html', 'acc_kills',   'Всего убито'),        acc.totalKills     ?? 0),
    row(u('html', 'acc_spared',  'Всего помиловано'),   acc.totalSpared    ?? 0),
    row(u('html', 'acc_bosses',  'Боссов убито'),       acc.totalBossKills ?? 0),
    row(u('html', 'acc_npc',     'NPC встречено'),      acc.totalNpcMet    ?? 0),
  ].join('');
}

let _resetBound = false;
function _initResetBtn() {
  if (_resetBound) return;
  _resetBound = true;
  $('btn-reset-account').addEventListener('click', async () => {
    if (!confirm(u('html', 'reset_game_confirm', 'Сбросить аккаунт и текущую сессию?'))) return;
    await api('POST', '/api/account/reset');
    state.G = null;
    toast(u('html', 'reset_game_done', 'Аккаунт сброшен'));
    $('modal-settings').classList.add('hidden');
    window.location.reload();
  });
}

// ── AI model test ─────────────────────────────────────────────────────────────

function _collectProviderForm() {
  const activeTab = document.querySelector('.provider-tab.active');
  return {
    provider:           activeTab?.dataset.provider ?? 'ollama',
    model:              $('inp-model').value.trim(),
    url:                $('inp-url').value.trim(),
    ollamaMode:         _ollamaMode,
    ollamaCloudKey:     $('inp-ollama-cloud-key').value.trim(),
    openrouterKey:      $('inp-or-key').value.trim(),
    openrouterModel:    $('inp-or-model').value.trim(),
    ollamaJsonMode:     $('inp-ollama-json').checked,
    openrouterJsonMode: $('inp-or-json').checked,
  };
}

const AI_TEST_STEPS_BASE = [
  { id: 'basic',      labelKey: 'ai_test_basic' },
  { id: 'combat',     labelKey: 'ai_test_combat' },
  { id: 'perception', labelKey: 'ai_test_perception' },
];

// 'json' only makes sense (and is only ever requested) when JSON mode is on for
// the active provider — mirrors server's jsonModeOf() in routes/ai.js.
function _jsonModeOf(form) {
  return form.provider === 'openrouter' ? form.openrouterJsonMode : form.ollamaJsonMode;
}

function _getAiTestSteps(form) {
  const steps = [...AI_TEST_STEPS_BASE];
  if (_jsonModeOf(form)) steps.push({ id: 'json', labelKey: 'ai_test_json' });
  // 'tools' (native tool calling) is always attempted — doesn't depend on the JSON
  // mode toggle at all. optional:true = doesn't block the sequence or affect the
  // score if it fails; npc.js just falls back to the JSON-mode lore-lookup pattern.
  steps.push({ id: 'tools', labelKey: 'ai_test_tools', optional: true });
  return steps;
}

function _buildAiTestSteps(steps) {
  $('ai-test-steps').innerHTML = steps.map(s => `
    <div class="ai-test-step-row pending" data-step="${s.id}">
      <div class="ai-test-step-main">
        <span class="ai-test-step-icon">…</span>
        <span class="ai-test-step-label">${u('html', s.labelKey, s.id)}</span>
        <span class="ai-test-step-ms"></span>
      </div>
      <div class="ai-test-step-detail hidden"></div>
    </div>`
  ).join('');
}

function _setAiTestStepState(stepId, state, result) {
  const row = $('ai-test-steps').querySelector(`[data-step="${stepId}"]`);
  if (!row) return;
  row.className = `ai-test-step-row ${state}` + (state === 'done' ? (result.ok ? ' ok' : ' fail') : '');

  const icon   = row.querySelector('.ai-test-step-icon');
  const msEl   = row.querySelector('.ai-test-step-ms');
  const detail = row.querySelector('.ai-test-step-detail');

  if (state === 'running') {
    icon.innerHTML   = '<span class="ai-test-spinner-sm"></span>';
    msEl.textContent = '';
    detail.classList.add('hidden');
  } else if (state === 'done') {
    icon.textContent = result.ok ? '✓' : '✗';
    msEl.textContent = `${result.ms} ms`;
    detail.textContent = result.detail || '';
    detail.classList.toggle('hidden', !result.detail);
  }
}

function _setAiTestProgress(ratio) {
  $('ai-test-progress-fill').style.width = `${Math.round(ratio * 100)}%`;
}

function _showAiTestScore(rating) {
  const box = $('ai-test-score');
  box.className = `ai-test-score ${rating.ratingKey}`;
  $('ai-test-score-value').textContent = String(rating.score);
  $('ai-test-score-title').textContent = u('html', `ai_rating_${rating.ratingKey}_title`, rating.ratingKey);
  $('ai-test-score-desc').textContent  = u('html', `ai_rating_${rating.ratingKey}_desc`, '');
  box.classList.remove('hidden');
}

let _aiTestBound = false;
function _initAiTestBtn() {
  if (_aiTestBound) return;
  _aiTestBound = true;

  $('btn-ai-test').addEventListener('click', async () => {
    const form  = _collectProviderForm();
    const steps = _getAiTestSteps(form);
    _buildAiTestSteps(steps);
    _setAiTestProgress(0);
    $('ai-test-score').classList.add('hidden');
    $('modal-ai-test').classList.remove('hidden');

    const results = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      _setAiTestStepState(step.id, 'running');

      let result;
      try {
        const r = await api('POST', '/api/ai-test-step', { step: step.id, ...form });
        result = r.result;
      } catch (e) {
        result = { id: step.id, ok: false, ms: 0, detail: e.message ?? String(e) };
      }

      results.push(result);
      _setAiTestStepState(step.id, 'done', result);
      _setAiTestProgress((i + 1) / steps.length);
      if (!result.ok && !step.optional) break; // remaining steps stay in "pending" state
    }

    // Optional steps (currently just 'tools') don't count toward the score —
    // they're a capability probe with a working fallback, not a requirement.
    const scoredIds = new Set(steps.filter(s => !s.optional).map(s => s.id));
    const scoredResults = results.filter(r => scoredIds.has(r.id));

    try {
      const rating = await api('POST', '/api/ai-rate', { results: scoredResults, ...form });
      _showAiTestScore(rating);
    } catch { /* step results are already visible even if rating fails */ }
  });

  $('btn-ai-test-close').addEventListener('click', () => $('modal-ai-test').classList.add('hidden'));
  $('modal-ai-test').addEventListener('click', e => {
    if (e.target === $('modal-ai-test')) $('modal-ai-test').classList.add('hidden');
  });
}

const RESOLUTIONS = [
  [3840, 2160], [3440, 1440], [2560, 1600],
  [2560, 1440], [2560, 1080], [2048, 1152],
  [1920, 1200], [1920, 1080], [1680, 1050],
  [1600, 1024], [1600, 900],  [1440, 1080],
  [1440, 900],  [1366, 768],  [1360, 768],
  [1280, 1024], [1280, 800],  [1280, 720],
  [1152, 864],  [1024, 768],
];

async function initGraphicsTab() {
  const tab = document.querySelector('.stab[data-stab="graphics"]');
  if (!window.electronAPI || !tab) return;
  tab.classList.remove('hidden');
  if (tab._gfxBound) return;
  tab._gfxBound = true;

  const info = await window.electronAPI.getWindowInfo();

  // Mode buttons
  const modeGroup = document.querySelector('.gfx-mode-group');
  function setMode(mode) {
    modeGroup.querySelectorAll('.gfx-mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === mode)
    );
    const isWindowed = mode === 'windowed';
    $('gfx-res-label').classList.toggle('hidden', !isWindowed);
    $('inp-resolution').classList.toggle('hidden', !isWindowed);
    window.electronAPI.setWindowMode(
      mode,
      isWindowed ? +$('inp-resolution').value.split('x')[0] : null,
      isWindowed ? +$('inp-resolution').value.split('x')[1] : null
    );
  }

  modeGroup.querySelectorAll('.gfx-mode-btn').forEach(btn =>
    btn.addEventListener('click', () => setMode(btn.dataset.mode))
  );

  // Resolution select
  const sel = $('inp-resolution');
  sel.innerHTML = RESOLUTIONS
    .filter(([w, h]) => w <= info.screenW && h <= info.screenH)
    .map(([w, h]) => `<option value="${w}x${h}">${w} × ${h}</option>`)
    .join('');
  const curW = info.bounds.width, curH = info.bounds.height;
  sel.value = `${curW}x${curH}`;
  sel.addEventListener('change', () => {
    const [w, h] = sel.value.split('x').map(Number);
    window.electronAPI.setWindowMode('windowed', w, h);
  });

  setMode(info.mode);
}

export async function openSettings() {
  const [data, langData, accData] = await Promise.all([
    api('GET', '/api/settings'),
    api('GET', '/api/languages'),
    api('GET', '/api/account')
  ]);
  _renderAccountStats(accData);
  _initResetBtn();
  _initAiTestBtn();

  buildLangButtons(langData.langs ?? [], langData.current ?? 'ru');
  setSettingsTab('lang');

  const provider = data.provider ?? 'ollama';
  setProviderTab(provider);
  _initOllamaModeButtons();
  _applyOllamaMode(data.ollamaMode ?? 'local');
  $('inp-model').value    = data.model           ?? '';
  $('inp-url').value      = data.url             ?? '';
  $('inp-ollama-cloud-key').value = data.ollamaCloudKey ?? '';
  $('inp-or-key').value   = data.openrouterKey   ?? '';
  $('inp-or-model').value = data.openrouterModel ?? 'openai/gpt-4o-mini';
  $('inp-ollama-json').checked     = data.ollamaJsonMode  ?? true;
  $('inp-or-json').checked         = data.openrouterJsonMode ?? true;
  $('inp-cache-mode').checked      = data.cacheMode      ?? true;

  const bgVol  = data.bgVolume     ?? 0.25;
  const btVol  = data.battleVolume ?? 0.25;
  const sfxVol = data.sfxVolume    ?? 0.2;
  $('inp-bg-vol').value  = bgVol;
  $('inp-bt-vol').value  = btVol;
  $('inp-sfx-vol').value = sfxVol;
  $('lbl-bg-vol').textContent  = Math.round(bgVol  * 100) + '%';
  $('lbl-bt-vol').textContent  = Math.round(btVol  * 100) + '%';
  $('lbl-sfx-vol').textContent = Math.round(sfxVol * 100) + '%';

  initGraphicsTab();

  $('modal-settings').classList.remove('hidden');
}

export async function saveSettings() {
  const activeTab    = document.querySelector('.provider-tab.active');
  const provider     = activeTab?.dataset.provider ?? 'ollama';
  const bgVolume     = parseFloat($('inp-bg-vol').value);
  const battleVolume = parseFloat($('inp-bt-vol').value);
  const sfxVolume    = parseFloat($('inp-sfx-vol').value);
  const langChanged  = _selectedLang && _selectedLang !== (await api('GET', '/api/languages')).current;

  const promises = [
    api('POST', '/api/settings', {
      provider,
      model:              $('inp-model').value.trim(),
      url:                $('inp-url').value.trim(),
      ollamaMode:         _ollamaMode,
      ollamaCloudKey:     $('inp-ollama-cloud-key').value.trim(),
      openrouterKey:      $('inp-or-key').value.trim(),
      openrouterModel:    $('inp-or-model').value.trim(),
      ollamaJsonMode:     $('inp-ollama-json').checked,
      openrouterJsonMode: $('inp-or-json').checked,
      cacheMode:          $('inp-cache-mode').checked,
      bgVolume, battleVolume, sfxVolume
    })
  ];
  if (_selectedLang) promises.push(api('POST', '/api/language', { lang: _selectedLang }));

  await Promise.all(promises);
  music.setVolumes(bgVolume, battleVolume);
  sfx.setVolume(sfxVolume);

  if (langChanged) {
    location.reload();
  } else {
    $('modal-settings').classList.add('hidden');
  }
}
