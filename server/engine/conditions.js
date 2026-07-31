'use strict';
// ── Server-side condition evaluator ──────────────────────────────────────────
//
// Supports the same namespaces as the client conditions.js, plus:
//   storyFlag:key        — sess.player.storyFlags[key]
//   !condition:id        — negation prefix
//   !storyFlag:key       — negation prefix
//
// ctx = state.session (full server session object)
//
const { CONDITIONS, NPC_COMBAT_CFG } = require('./data');
const { account }   = require('./account');

// ── Reference resolver ────────────────────────────────────────────────────────

function _deepGet(obj, parts) {
  let val = obj;
  for (const p of parts) {
    if (val == null) return undefined;
    val = val[p];
  }
  return val;
}

// Relationship number → tier key ("main_enemy".."main_friend"), see
// assets/config/npc_combat.json relationship.tiers. Falls back to "neutral".
function _relationshipTier(value) {
  const tiers = NPC_COMBAT_CFG.relationship?.tiers ?? [];
  const tier  = tiers.find(t => value >= t.min && value <= t.max);
  return tier?.key ?? 'neutral';
}

function resolveRef(ref, ctx) {
  // Arithmetic expression: [base, op, scalar]
  if (Array.isArray(ref)) {
    const [base, op, scalar] = ref;
    const bv = resolveRef(base, ctx);
    const sv = typeof scalar === 'number' ? scalar : resolveRef(scalar, ctx);
    switch (op) {
      case '*': return bv * sv;
      case '/': return sv !== 0 ? bv / sv : 0;
      case '+': return bv + sv;
      case '-': return bv - sv;
      default:  return bv;
    }
  }

  const [ns, ...parts] = ref.split(':');
  switch (ns) {
    // session:player:kills → ctx.player.kills
    case 'session':
      return Number(_deepGet(ctx, parts)) || 0;

    // player:hp → ctx.player.hp
    case 'player':
      return Number(_deepGet(ctx.player, parts)) || 0;

    // storyFlag:key → ctx.player.storyFlags.key (truthy → 1)
    case 'storyFlag': {
      const val = _deepGet(ctx.player?.storyFlags ?? {}, parts);
      return val ? 1 : 0;
    }

    // npc:defeated → the NPC in the player's current room (truthy → 1)
    // npc:status   → relationship tier key (string) — see `is` operator below,
    //                e.g. ["npc:status", "is", ["enemy", "main_enemy"]]
    // Used to hide dialogue/scavenge options once an npc_combat NPC can no longer be fought,
    // or to branch dialogue tone by how hostile/friendly the relationship currently is.
    case 'npc': {
      const npc = ctx.dungeon?.rooms?.[ctx.dungeon?.playerPos]?.npc;
      if (parts[0] === 'status') return npc ? _relationshipTier(npc.relationship ?? 0) : 'neutral';
      return npc && _deepGet(npc, parts) ? 1 : 0;
    }

    // condition:karma_good → evaluate condition def recursively
    case 'condition': {
      const id  = parts.join(':');
      const def = CONDITIONS.find(c => c.id === id);
      if (!def) return 0;
      return evalAll(def.if, ctx) ? (def.int ?? 1) : 0;
    }

    // skill:mg_magical_manifestation → player.learnedSkills includes it
    case 'skill':
      return (ctx.player?.learnedSkills ?? []).includes(parts.join(':')) ? 1 : 0;

    // account:totalKills, account:npcsMet:one_lost, etc.
    case 'account': {
      if (parts[0] === 'npcsMet') {
        if (parts.length === 1) return account.npcsMet.length;
        return account.npcsMet.includes(parts[1]) ? 1 : 0;
      }
      return Number(_deepGet(account, parts)) || 0;
    }

    // achievement:point_1 → 1 if earned, 0 if not
    case 'achievement':
      return (account.achievements ?? []).includes(parts.join(':')) ? 1 : 0;

    default:
      return 0;
  }
}

// ── Single condition ──────────────────────────────────────────────────────────

function evalCond(cond, ctx) {
  // Negation: "!condition:karma_good" or "!storyFlag:key"
  if (typeof cond === 'string') {
    if (cond.startsWith('!')) return resolveRef(cond.slice(1), ctx) === 0;
    return resolveRef(cond, ctx) !== 0;
  }

  // Empty / always-true
  if (!Array.isArray(cond) || cond.length === 0) return true;
  if (cond.length === 1) return resolveRef(cond[0], ctx) !== 0;

  const [lhsRef, op, rhsRaw] = cond;

  // "is" — string/tier membership check: ["npc:status", "is", ["enemy", "main_enemy"]]
  // or a single value: ["npc:status", "is", "friend"]. rhsRaw is a literal, never resolved
  // (it's a set of labels, not a ref).
  if (op === 'is') {
    const lhs = resolveRef(lhsRef, ctx);
    return Array.isArray(rhsRaw) ? rhsRaw.includes(lhs) : lhs === rhsRaw;
  }

  const lhs = resolveRef(lhsRef, ctx);
  const rhs = typeof rhsRaw === 'number' ? rhsRaw : resolveRef(rhsRaw, ctx);

  switch (op) {
    case '>':            return lhs >  rhs;
    case '>=':           return lhs >= rhs;
    case '<':            return lhs <  rhs;
    case '<=':           return lhs <= rhs;
    case '=': case '==': return lhs === rhs;
    case '!=':           return lhs !== rhs;
    default:             return false;
  }
}

// ── AND group ─────────────────────────────────────────────────────────────────

function evalAll(conditions, ctx) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every(c => evalCond(c, ctx));
}

// ── First-match entry resolver ────────────────────────────────────────────────
// Finds the first entry whose `if` passes.
// entries = [{ if: [...], node: '...' }, ...]

function resolveEntry(entries, ctx) {
  for (const e of (entries ?? [])) {
    if (evalAll(e.if ?? [], ctx)) return e;
  }
  return null;
}

// ── Apply `set` map to session ────────────────────────────────────────────────
// Supported namespaces: storyFlag:key, session:player:key

function applySet(setMap, sess) {
  if (!setMap || typeof setMap !== 'object') return;
  sess.player.storyFlags = sess.player.storyFlags ?? {};

  for (const [key, val] of Object.entries(setMap)) {
    const parts = key.split(':');
    const ns    = parts[0];

    if (ns === 'storyFlag') {
      sess.player.storyFlags[parts[1]] = val;

    } else if (ns === 'session' && parts[1] === 'player') {
      // session:player:someField = val
      const field = parts.slice(2).join(':');
      if (field) sess.player[field] = val;
    }
  }
}

module.exports = { resolveRef, evalCond, evalAll, resolveEntry, applySet, relationshipTier: _relationshipTier };
