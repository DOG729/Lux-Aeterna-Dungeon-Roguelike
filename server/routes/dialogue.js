'use strict';
const router = require('express').Router();
const { state, saveSessionAuto }    = require('../engine/session');
const { startDialogue, advanceDialogue } = require('../engine/dialogue');
const { t } = require('../engine/translation');

const E = (key, fb) => t('server', 'errors', key, fb);

// ── POST /api/dialogue/start ──────────────────────────────────────────────────
// Body: { dialogueId: string }
// Response:
//   { node: PreparedNode }                     — script starts normally
//   { done: true, ends_with: string | null }    — 'once' dialogue already seen this
//                                                 session, skipped straight to free chat

router.post('/api/dialogue/start', async (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  if (state.session.combat) return res.status(400).json({ error: E('combat_active', 'Идёт бой') });

  const { dialogueId } = req.body;
  if (!dialogueId) return res.status(400).json({ error: 'dialogueId required' });

  try {
    const result = await startDialogue(dialogueId, state.session);
    saveSessionAuto();
    if (result.done) {
      res.json({ done: true, ends_with: result.ends_with ?? null });
    } else {
      res.json({ node: result });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/dialogue/advance ────────────────────────────────────────────────
// Body: { choiceIndex?: number }   — omit or null for linear advance
// Response:
//   { done: false, node: PreparedNode }         — next node
//   { done: true,  ends_with: string | null }   — dialogue finished

router.post('/api/dialogue/advance', async (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  if (!state.session.dialogue) return res.status(400).json({ error: 'No active dialogue' });

  const choiceIndex = req.body.choiceIndex ?? null;

  try {
    const result = await advanceDialogue(choiceIndex, state.session);
    saveSessionAuto();

    if (result.done) {
      res.json({ done: true, ends_with: result.ends_with ?? null });
    } else {
      res.json({ done: false, node: result });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/dialogue/close ──────────────────────────────────────────────────
// Аварийное закрытие диалога (игрок нажал ESC / закрыл окно).

router.post('/api/dialogue/close', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });
  state.session.dialogue = null;
  saveSessionAuto();
  res.json({ ok: true });
});

module.exports = router;
