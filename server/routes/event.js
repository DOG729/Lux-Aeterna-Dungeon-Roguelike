'use strict';
const router = require('express').Router();
const { state, saveSessionAuto } = require('../engine/session');
const { resolveEvent }           = require('../engine/event_engine');
const { hasFiredEvent }          = require('../engine/account');
const { t } = require('../engine/translation');

const E = (key, fb) => t('server', 'errors', key, fb);

// ── POST /api/event/fire ──────────────────────────────────────────────────────
// Body: { eventId: string }
// Response:
//   { alreadyFired: true }                    — once/once_account event, already triggered
//   { actions: [{ type, value }, ...] }       — list for client to execute

router.post('/api/event/fire', (req, res) => {
  if (!state.session) return res.status(400).json({ error: E('no_game', 'Нет активной игры') });

  const { eventId } = req.body;
  if (!eventId || typeof eventId !== 'string') {
    return res.status(400).json({ error: 'eventId required' });
  }

  // Check if this is a `once`/`once_account` event that already fired
  const { EVENT } = require('../engine/data');
  const eventDef  = EVENT[eventId];
  if (!eventDef || typeof eventDef !== 'object') {
    return res.status(404).json({ error: `Event not found: ${eventId}` });
  }

  const FIRED_KEY = `event_fired_${eventId}`;
  if (eventDef.once && state.session.player.storyFlags?.[FIRED_KEY]) {
    return res.json({ alreadyFired: true, actions: [] });
  }
  if (eventDef.once_account && hasFiredEvent(eventId)) {
    return res.json({ alreadyFired: true, actions: [] });
  }

  const actions = resolveEvent(eventId, state.session);
  saveSessionAuto();
  res.json({ alreadyFired: false, actions });
});

module.exports = router;
