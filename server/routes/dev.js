'use strict';
const router = require('express').Router();
const { DEV_MODE, getAiLog, clearAiLog } = require('../engine/devlog');

// Client checks this first to decide whether to even render the dev button —
// stays 404/off for anyone not launched with -developer.
router.get('/api/dev/status', (_req, res) => {
  res.json({ enabled: DEV_MODE });
});

router.get('/api/dev/log', (req, res) => {
  if (!DEV_MODE) return res.status(404).json({ error: 'Dev mode is off' });
  res.json({ entries: getAiLog(Number(req.query.since) || 0) });
});

router.post('/api/dev/log/clear', (_req, res) => {
  if (!DEV_MODE) return res.status(404).json({ error: 'Dev mode is off' });
  clearAiLog();
  res.json({ ok: true });
});

module.exports = router;
