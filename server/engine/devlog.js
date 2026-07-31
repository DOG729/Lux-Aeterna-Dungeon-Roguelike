'use strict';
// ── Dev-mode AI call log ───────────────────────────────────────────────────────
// Active only when the process was started with `-developer` (node server.js
// -developer / packaged .exe -developer). Every aiChat() call (mob combat, NPC
// chat, narrator, dream_ai, dialogue, ai-test — it's the single choke point in
// ai.js) gets recorded here so the client-side dev panel can show what prompt
// was sent and what came back, without any of those call sites knowing this
// exists. In-memory only — never written to disk, cleared on restart.

const DEV_MODE = process.argv.includes('-developer');

const MAX_ENTRIES   = 300;
const MAX_FIELD_LEN = 20000;

const entries = [];
let nextId = 1;

function _trunc(v) {
  if (typeof v !== 'string') return v;
  return v.length > MAX_FIELD_LEN ? v.slice(0, MAX_FIELD_LEN) + '…[truncated]' : v;
}

function pushAiLog(entry) {
  if (!DEV_MODE) return;
  entries.push({
    id: nextId++,
    ts: Date.now(),
    ...entry,
    messages: (entry.messages ?? []).map(m => ({
      role: m.role, content: _trunc(m.content),
      ...(m.tool_calls    ? { tool_calls: m.tool_calls }       : {}),
      ...(m.tool_call_id  ? { tool_call_id: m.tool_call_id }   : {})
    })),
    response: entry.response != null ? _trunc(entry.response) : undefined
  });
  if (entries.length > MAX_ENTRIES) entries.shift();
}

function getAiLog(sinceId = 0) {
  return entries.filter(e => e.id > sinceId);
}

function clearAiLog() {
  entries.length = 0;
}

module.exports = { DEV_MODE, pushAiLog, getAiLog, clearAiLog };
