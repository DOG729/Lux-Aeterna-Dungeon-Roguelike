'use strict';
// ── Event engine (server-side) ────────────────────────────────────────────────
//
// Resolves an event from event.json against the current session:
//   - Evaluates `if` conditions
//   - Applies server-side effects (set, chain events)
//   - Returns a flat list of client-side actions (video, sound, music, narrator, dialogue)
//
// Client receives the action list and executes media/dialogue in order.
//
const { EVENT }             = require('./data');
const { evalAll, applySet } = require('./conditions');
const { hasFiredEvent, markFiredEvent } = require('./account');

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIRED_PREFIX = 'event_fired_';

// once — session-scoped, resets every new session/game.
function _hasFired(eventId, sess) {
  return !!(sess.player.storyFlags?.[FIRED_PREFIX + eventId]);
}

function _markFired(eventId, sess) {
  sess.player.storyFlags = sess.player.storyFlags ?? {};
  sess.player.storyFlags[FIRED_PREFIX + eventId] = true;
}

// Client-side action types
const CLIENT_TYPES = new Set(['video', 'sound', 'music', 'narrator', 'dialogue']);

function _extractClientAction(item) {
  for (const type of CLIENT_TYPES) {
    if (type in item) {
      return { type, value: item[type] };
    }
  }
  return null;
}

// ── Core resolver ─────────────────────────────────────────────────────────────

function resolveEvent(eventId, sess, _visited = new Set()) {
  // Guard against circular chains
  if (_visited.has(eventId)) return [];
  _visited.add(eventId);

  // Strip internal keys (separator strings like __BOSSES__)
  const event = EVENT[eventId];
  if (!event || typeof event !== 'object' || Array.isArray(event)) return [];

  // once: already fired this session → skip
  if (event.once && _hasFired(eventId, sess)) return [];
  // once_account: already fired ever (cross-save) → skip
  if (event.once_account && hasFiredEvent(eventId)) return [];

  if (event.once) _markFired(eventId, sess);
  if (event.once_account) markFiredEvent(eventId);

  const clientActions = [];

  for (const action of (event.actions ?? [])) {
    // ── select block: first matching item wins ────────────────────────────
    if (Array.isArray(action.select)) {
      for (const item of action.select) {
        if (!evalAll(item.if ?? [], sess)) continue;

        // Server-side: apply set
        if (item.set) applySet(item.set, sess);

        // Server-side: chain sub-event
        if (item.event) {
          clientActions.push(...resolveEvent(item.event, sess, _visited));
        }

        // Client-side: media or dialogue
        const ca = _extractClientAction(item);
        if (ca) clientActions.push(ca);

        break; // first match only
      }
      continue;
    }

    // ── Regular action: evaluate own `if` ────────────────────────────────
    if (!evalAll(action.if ?? [], sess)) continue;

    // Server-side: apply set
    if (action.set) applySet(action.set, sess);

    // Server-side: chain sub-event
    if (action.event) {
      clientActions.push(...resolveEvent(action.event, sess, _visited));
      continue;
    }

    // Client-side: media or dialogue
    // Special case: music null = stop music (still a valid action)
    if ('music' in action) {
      clientActions.push({ type: 'music', value: action.music });
      continue;
    }

    const ca = _extractClientAction(action);
    if (ca) clientActions.push(ca);
  }

  return clientActions;
}

module.exports = { resolveEvent };
