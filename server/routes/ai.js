'use strict';
const router = require('express').Router();
const { CORE, cfg } = require('../engine/data');
const { t }         = require('../engine/translation');
const { isAiVerified, markAiVerified, isToolsSupported, markToolsSupported,
        aiTestBasic, aiTestCombat, aiTestPerception, aiTestJson, aiTestTools, rateAiResults } = require('../engine/ai');

// Merge form overrides from the settings modal onto the saved cfg,
// so the player can test values before saving them. Nothing is persisted.
function confFromBody(body = {}) {
  const conf = { ...cfg };
  const strs = ['provider', 'model', 'url', 'ollamaMode', 'ollamaCloudKey',
                'openrouterKey', 'openrouterModel'];
  for (const k of strs) if (typeof body[k] === 'string' && body[k].trim()) conf[k] = body[k].trim();
  if (body.ollamaJsonMode     != null) conf.ollamaJsonMode     = !!body.ollamaJsonMode;
  if (body.openrouterJsonMode != null) conf.openrouterJsonMode = !!body.openrouterJsonMode;
  return conf;
}

const jsonModeOf = conf =>
  conf.provider === 'openrouter' ? (conf.openrouterJsonMode ?? true) : (conf.ollamaJsonMode ?? true);

// ── Entry gate: quick provider ping, cached for the process lifetime ──────────
// Re-checks automatically when provider settings change (signature-based cache).

router.post('/api/ai-check', async (_req, res) => {
  if (CORE.start_game?.required_ai_system !== true)
    return res.json({ ok: true, required: false });

  if (!isAiVerified()) {
    const result = await aiTestBasic();
    if (!result.ok) {
      return res.json({
        ok: false,
        error: result.detail,
        hint: t('server', 'ai_test', 'not_configured_hint',
                'AI-система недоступна. Настройте провайдера в настройках (Настройки → Провайдер).')
      });
    }
    markAiVerified();
  }

  // One-shot native tool-calling probe, folded into the same startup gate — not
  // re-attempted mid-conversation (see routes/npc.js: it just trusts the flag).
  // Not a hard requirement: failing it doesn't block ok:true, NPC lore lookup just
  // uses the JSON-mode fallback for the rest of the session.
  if (!isToolsSupported()) {
    const toolsResult = await aiTestTools();
    if (toolsResult.ok) markToolsSupported();
  }

  res.json({ ok: true });
});

// ── Stepped model test from the settings modal ────────────────────────────────
// One step per request so the client can drive a live progress bar.

const STEP_RUNNERS = {
  basic:      conf              => aiTestBasic(conf),
  combat:     (conf, jsonMode)  => aiTestCombat(conf, jsonMode),
  perception: conf              => aiTestPerception(conf),
  // Only meaningful (and only ever requested by the client) when JSON mode is
  // enabled for the active provider — see jsonModeOf() and public/js/settings.js.
  json:       conf              => aiTestJson(conf),
  // Optional/non-blocking — see public/js/settings.js: failing this just means
  // npc.js falls back to the JSON-mode lore-lookup pattern instead of native tools.
  tools:      conf              => aiTestTools(conf),
};

router.post('/api/ai-test-step', async (req, res) => {
  const { step } = req.body ?? {};
  const runner = STEP_RUNNERS[step];
  if (!runner) return res.status(400).json({ error: 'Unknown test step' });

  const conf     = confFromBody(req.body);
  const jsonMode = jsonModeOf(conf);
  const result   = await runner(conf, jsonMode);
  if (step === 'tools' && result.ok) markToolsSupported(conf);
  res.json({ result });
});

// ── Quality score for a completed step sequence ───────────────────────────────

router.post('/api/ai-rate', (req, res) => {
  const results = Array.isArray(req.body?.results) ? req.body.results : [];
  if (!results.length) return res.status(400).json({ error: 'results required' });

  const rating = rateAiResults(results);

  // A fully passed test on the current form values also satisfies the entry gate
  if (results.every(r => r.ok)) markAiVerified(confFromBody(req.body));

  res.json(rating);
});

module.exports = router;
