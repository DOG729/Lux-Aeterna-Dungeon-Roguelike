'use strict';
// ── Generic "single optional tool call" adapter ─────────────────────────────────
//
// One place that knows how to run "the model may want to call ONE tool with a
// single string argument, then give a final reply" — native tool calling when the
// model/provider supports it (see ai.js's isToolsSupported/aiTestTools), nothing
// provider-specific leaks past this file. Every feature that wants this shape
// (NPC lore lookup today; trader actions like buy_item later — see roadmap) should
// go through buildSingleParamTool()/runToolTurn() instead of hand-rolling the
// tool_calls / follow-up message plumbing itself.
//
// JSON-mode fallback (for models/providers without reliable native tool calling)
// is NOT built here — it's a conditional field baked into the caller's own system
// prompt (e.g. npc.js's npcSystempromt "lore_topic" field), because that prompt is
// tightly coupled to caller-specific context (NPC memory, trader info, etc.) that
// doesn't belong in a generic adapter. This module only covers the native-tools path.

const { aiChatTools, isToolsSupported } = require('./ai');

// A tool with exactly one string parameter, constrained to a fixed set of options —
// covers everything this game currently needs a tool for (pick a lore topic, pick
// an item id, ...). Deliberately not a generic JSON-schema builder.
function buildSingleParamTool({ name, description, paramName, paramDescription, options }) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {
          [paramName]: {
            type: 'string',
            description: paramDescription,
            enum: options
          }
        },
        required: [paramName]
      }
    }
  };
}

// messages    — the conversation so far (system + history + latest user turn),
//               WITHOUT any JSON-format instructions — native tools don't need them.
// toolSchema  — from buildSingleParamTool().
// paramName   — same key passed to buildSingleParamTool(), used to read the argument.
// execute(value) → Promise<string|null> — runs the tool; return null to treat the
//               call as a no-op (falls back to the first pass's own reply).
// conf        — provider config (cfg or a settings-form override).
//
// Returns { content, used, toolExchange } — `used` is an array of the option
// values that actually resolved to something (empty array if the tool wasn't
// called, or every call was invalid/hallucinated — plain reply, no tool involved).
// `toolExchange` is [assistantToolCallMsg, ...toolResultMsgs] when at least one
// call fired, otherwise null — the caller decides whether to keep this in its own
// live conversation history (see routes/npc.js's "remember" flag); this adapter
// doesn't touch any history itself.
//
// Models can request several calls in the SAME turn (e.g. two lore lookups at
// once) — every tool_call_id in the assistant's message MUST get exactly one
// matching `role:'tool'` reply, or the follow-up request is a malformed
// conversation the provider may reject (or silently confuse the model on the
// NEXT turn if this exchange gets kept in history — this bit us for real, see
// conversation). So every call in `calls` gets a result message, even ones whose
// execute() returned null (using a placeholder) — never just drop a call.
//
// content is never empty on success: native tool-calling responses often leave
// `content` blank on a turn where a tool was called, so zero valid calls or a
// still-empty follow-up forces one more plain (tool-less) retry rather than
// surfacing an empty reply to the player.
async function runToolTurn({ messages, toolSchema, paramName, execute, conf }) {
  const first = await aiChatTools(messages, [toolSchema], conf);
  const calls = first.toolCalls.filter(c => c.name === toolSchema.function.name);

  if (calls.length) {
    const used     = [];
    const toolMsgs = [];
    for (const call of calls) {
      const value  = call.arguments?.[paramName];
      const result = value ? await execute(value) : null;
      if (result) used.push(value);
      toolMsgs.push({ role: 'tool', tool_call_id: call.id, content: result || 'No information available for this topic.' });
    }
    if (used.length) {
      const second = await aiChatTools([...messages, first.assistantMessage, ...toolMsgs], [toolSchema], conf);
      if (second.content.trim()) {
        return { content: second.content, used, toolExchange: [first.assistantMessage, ...toolMsgs] };
      }
    }
  }

  if (first.content.trim()) return { content: first.content, used: [], toolExchange: null };
  const plain = await aiChatTools(messages, [], conf);
  return { content: plain.content, used: [], toolExchange: null };
}

module.exports = { isToolsSupported, buildSingleParamTool, runToolTurn };
