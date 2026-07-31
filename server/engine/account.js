'use strict';
const fs   = require('fs');
const path = require('path');
const { SAVE_DIR, BOSSES, NPC_COMBAT_CFG } = require('./data');

const ACCOUNT_FILE = path.join(SAVE_DIR, 'account.json');

const DEFAULTS = {
  gamesStarted:      0,
  totalDefeats:      0,
  maxFloor:          0,
  totalKills:        0,
  totalSpared:       0,
  totalBossKills:    0,
  totalNpcMet:       0,
  npcsMet:           [],
  achievements:      [],
  npcRelationships:  {},
  npcMemory:         {},
  eventsFired:       []
};

// Cheap token estimate (no tokenizer dependency) — shared with session-scoped
// NPC memory (server/engine/npc.js) so both storage modes use the same budget logic.
function estimateTokens(text) {
  const ratio = NPC_COMBAT_CFG.memory.token_char_ratio || 4;
  return Math.ceil((text ?? '').length / ratio);
}

// Drops oldest entries until the list fits within maxTokens. Mutates and returns `list`.
function capMemoryTokens(list, maxTokens) {
  let total = list.reduce((sum, line) => sum + estimateTokens(line), 0);
  while (total > maxTokens && list.length) {
    total -= estimateTokens(list.shift());
  }
  return list;
}

// Hard count cap, independent of the token budget above. Mutates and returns `list`.
function capMemoryCount(list, maxCount) {
  while (list.length > maxCount) list.shift();
  return list;
}

const account = { ...DEFAULTS };
try {
  if (fs.existsSync(ACCOUNT_FILE)) {
    Object.assign(account, JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8')));
    account.npcsMet = account.npcsMet ?? [];
    account.npcMemory = account.npcMemory ?? {};
    account.eventsFired = account.eventsFired ?? [];
    // Pre-compaction saves stored npcMemory[id] as a flat array of lines — upgrade
    // in place to {records, summary, sinceCompact} the first time this loads.
    for (const id of Object.keys(account.npcMemory)) {
      if (Array.isArray(account.npcMemory[id])) {
        account.npcMemory[id] = { records: account.npcMemory[id], summary: '', sinceCompact: 0 };
      }
    }
  }
} catch { /* keep defaults */ }

function _save() {
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(account, null, 2));
}

function trackGameStarted() {
  account.gamesStarted++;
  _save();
}

// Called once per actual defeat (player HP reaches 0), regardless of what
// the player does next — restart or load a save.
function trackDefeat() {
  account.totalDefeats++;
  _save();
}

function trackFloor(floor) {
  if (floor > account.maxFloor) {
    account.maxFloor = floor;
    _save();
  }
}

function trackKill(mobId) {
  account.totalKills++;
  if (mobId && BOSSES.some(b => b.id === mobId)) account.totalBossKills++;
  _save();
}

function trackSpared() {
  account.totalSpared++;
  _save();
}

// Called once per NPC instance (first interact). defId = NPC type id.
function trackNpcMet(defId) {
  if (!defId) return;
  account.totalNpcMet++;
  if (!account.npcsMet.includes(defId)) account.npcsMet.push(defId);
  _save();
}

function resetAccount() {
  Object.assign(account, { ...DEFAULTS, npcsMet: [], npcRelationships: {}, npcMemory: {}, eventsFired: [] });
  _save();
}

// ── Cross-save "once" events (event.once_account — see assets/event/*.json, docs in assets/config/event.json) ──
// Unlike `once` (session-scoped, resets every new session/game), these persist in
// account.json forever, until an explicit account reset.

function hasFiredEvent(eventId) {
  return Array.isArray(account.eventsFired) && account.eventsFired.includes(eventId);
}

function markFiredEvent(eventId) {
  if (!Array.isArray(account.eventsFired)) account.eventsFired = [];
  if (!account.eventsFired.includes(eventId)) {
    account.eventsFired.push(eventId);
    _save();
  }
}

// ── NPC relationship (cross-save mode — see relationship.mode:"account" in NPC manifest) ──

function getAccountRelationship(defId, dflt = 0) {
  if (!account.npcRelationships) account.npcRelationships = {};
  if (!(defId in account.npcRelationships)) account.npcRelationships[defId] = dflt;
  return account.npcRelationships[defId];
}

function adjustAccountRelationship(defId, delta) {
  if (!account.npcRelationships) account.npcRelationships = {};
  const { min, max } = NPC_COMBAT_CFG.relationship;
  const cur  = account.npcRelationships[defId] ?? 0;
  const next = Math.max(min, Math.min(max, cur + delta));
  account.npcRelationships[defId] = next;
  _save();
  return next;
}

// ── NPC compact memory (cross-save mode) ──────────────────────────────────────

function getAccountMemory(defId) {
  if (!account.npcMemory) account.npcMemory = {};
  if (!account.npcMemory[defId]) account.npcMemory[defId] = { records: [], summary: '', sinceCompact: 0 };
  return account.npcMemory[defId];
}

function pushAccountMemory(defId, line) {
  const mem = getAccountMemory(defId);
  mem.records.push(line);
  capMemoryCount(mem.records, NPC_COMBAT_CFG.memory.max_records);
  capMemoryTokens(mem.records, NPC_COMBAT_CFG.memory.max_tokens_account);
  mem.sinceCompact = (mem.sinceCompact ?? 0) + 1;
  _save();
  return mem;
}

// Overwrites the running "opinion" after a compaction pass folds `records` into it.
function setAccountMemorySummary(defId, summary) {
  const mem = getAccountMemory(defId);
  mem.summary = summary;
  mem.sinceCompact = 0;
  _save();
  return mem;
}

// Returns true if newly granted, false if already owned
function grantAchievement(id) {
  if (!Array.isArray(account.achievements)) account.achievements = [];
  if (account.achievements.includes(id)) return false;
  account.achievements.push(id);
  _save();
  return true;
}

module.exports = {
  account, trackGameStarted, trackDefeat, trackFloor, trackKill, trackSpared, trackNpcMet, resetAccount, grantAchievement,
  getAccountRelationship, adjustAccountRelationship, getAccountMemory, pushAccountMemory, setAccountMemorySummary,
  estimateTokens, capMemoryTokens, capMemoryCount, hasFiredEvent, markFiredEvent
};
