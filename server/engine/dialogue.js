'use strict';
// ── Dialogue engine ───────────────────────────────────────────────────────────
//
// Manages the active dialogue state inside state.session.dialogue
// and drives it node-by-node via startDialogue() / advanceDialogue().
//
// Session shape: sess.dialogue = {
//   id:          string          — dialogue id in DIALOGUE config
//   phase:       'before'|'main'|'outro'
//   currentNode: string          — id of the current node in the active script
// }
//
const { DIALOGUE, NPCS, NARRATIVE, NPC_COMBAT_CFG } = require('./data');
const { evalAll, resolveEntry, applySet } = require('./conditions');
const { aiChat, narrateText, loadNarratorPrompt, loadLangFile } = require('./ai');
const { cfg }                 = require('./data');
const { translateNpcNarrativeText, pushNpcMemoryLine, adjustNpcRelationship } = require('./npc');
const { t, langName }         = require('./translation');

// ── World lore context ────────────────────────────────────────────────────────
// Every AI dialogue line gets ONE lore block: the dialogue's own `lore` field
// (per-NPC, per-language file — e.g. "assets/translation/{lang}/promts/lore/one_lost.md")
// if set, otherwise the common doc at assets/translation/{lang}/promts/lore/default.md.
// Never both — a personal lore file exists precisely so an NPC that only knows a
// sliver of the world isn't handed the whole church/paladin backstory on every line.

const DEFAULT_LORE_PATH = 'assets/translation/{lang}/promts/lore/default.md';

function _loreFor(dialogue) {
  const personal = dialogue.lore ? loadLangFile(dialogue.lore) : null;
  return personal ?? loadLangFile(DEFAULT_LORE_PATH) ?? '';
}

// ── Conversation history (per dialogue instance, sess.dialogue.history) ──────
// So the model can see what it said last turn and what the player picked, instead
// of generating every line from a blank slate. Reset naturally each time a new
// dialogue starts (sess.dialogue is recreated); persists across before/main/outro
// phase transitions since sess.dialogue is mutated in place, not replaced.

const MAX_DIALOGUE_HISTORY = 16;

function _pushDialogueTurn(sess, role, content) {
  if (!content) return;
  const hist = (sess.dialogue.history ??= []);
  hist.push({ role, content });
  if (hist.length > MAX_DIALOGUE_HISTORY) hist.splice(0, hist.length - MAX_DIALOGUE_HISTORY);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _script(dialogue, phase) {
  if (phase === 'before') return dialogue.before?.script ?? [];
  if (phase === 'outro')  return dialogue.outro?.script  ?? [];
  return dialogue.script ?? [];
}

function _findNode(dialogue, phase, nodeId) {
  return _script(dialogue, phase).find(n => n.id === nodeId) ?? null;
}

// ── AI text generation ────────────────────────────────────────────────────────

// Resolve text_key "ns.id.field" → t(ns, id, field, fallback)
function _resolveTextKey(key, fallback) {
  if (!key) return fallback;
  const parts = key.split('.');
  if (parts.length !== 3) return fallback;
  return t(parts[0], parts[1], parts[2], fallback);
}

// node.dream_ai (only meaningful together with is_ai:true — see roadmap/npc_combat.md
// "dream_ai"), two forms:
//   true              — just inject this NPC's npcMemory as context for the line
//   {max_change: N}   — ALSO judge this specific scripted moment: AI returns a memory
//                        note + a relationship_delta clamped to ±N, saved immediately.
// Silently does nothing if there's no npc_combat NPC in the current room (e.g. a boss
// dialogue like fatum_tuum) — falls straight through to plain generation.
async function _generateText(node, dialogue, sess) {
  if (!node.is_ai) return _resolveTextKey(node.text_key, node.text ?? '');

  const hint = node.ai_hint ?? '';
  const lang = langName(cfg.lang);

  const npc    = node.dream_ai ? sess?.dungeon?.rooms?.[sess.dungeon.playerPos]?.npc : null;
  const npcDef = npc ? NPCS.find(n => n.id === npc.defId) : null;

  // summary — мнение, records — мысли.
  const memorySummary = npcDef && npc.memory?.summary
    ? npc.memory.summary
    : '';
  const memoryRecords = npcDef && npc.memory?.records?.length
    ? npc.memory.records.slice(-5).join('\n') 
    : '';

  const memoryBlock = (memorySummary || memoryRecords)
    ? (
        '\n---\nTHINGS YOU REMEMBER ABOUT THIS PERSON:\n'
        + (memorySummary ? `OPINION:\n${memorySummary}\n` : '')
        + (memoryRecords ? `THOUGHTS:\n${memoryRecords}` : '')
      ) + "\n\n"
    : '';

  const wantsSave = !!(npcDef && typeof node.dream_ai === 'object');
  const maxChange = wantsSave
    ? (node.dream_ai.max_change ?? NPC_COMBAT_CFG.dream.max_change_default)
    : 0;

  const formatInstr = wantsSave
    ? `Respond STRICTLY as JSON on one line, in ${lang}: ` +
      `{"text":"the line","memory":"one short first-person note about this moment",` +
      `"relationship_delta":integer from -${maxChange} to ${maxChange}}`
    : `Respond ONLY with the line text, in ${lang}. No explanations, no quotes, no JSON.`;

  const system = [
    _loreFor(dialogue),
    '---',
    'INSTRUCTION FOR THIS LINE:',
    hint,
    memoryBlock,
    formatInstr
  ].filter(Boolean).join('\n');

  // Prior turns of THIS conversation (what the NPC already said, what the player
  // picked) so the model isn't generating every line from a blank slate — see
  // sess.dialogue.history above.
  const historyMsgs = (sess.dialogue?.history ?? []).map(h => ({ role: h.role, content: h.content }));

  try {
    const raw = await aiChat(
      [{ role: 'system', content: system }, ...historyMsgs, { role: 'user', content: 'Line:' }],
      wantsSave
    );
    if (!wantsSave) return raw.trim() || (node.text ?? '');

    try {
      const clean  = raw.replace(/```(?:json)?\n?/g, '').trim();
      const parsed = JSON.parse(clean);
      const line   = (parsed.text ?? '').toString().trim() || (node.text ?? '');
      const note   = (parsed.memory ?? '').toString().trim();
      if (note) pushNpcMemoryLine(npc, npcDef, note);
      const delta = Math.max(-maxChange, Math.min(maxChange, Number(parsed.relationship_delta) || 0));
      if (delta) adjustNpcRelationship(npc, npcDef, delta);
      return line;
    } catch {
      return node.text ?? '';
    }
  } catch {
    return node.text ?? '';
  }
}

// ── Narrative resolver ────────────────────────────────────────────────────────
//
// node.narrative can be:
//   "npc:some_id:narrative_text"  — pull text from NPC manifest + narrator AI prompt
//   "plain text string"           — use as-is (no AI)
//   { text, is_ai, ai_hint }      — inline spec; is_ai uses generic narrator prompt
//
// AI generation for NPC references uses the same narrator prompt system as
// /api/narrate — loads path_promt_narrator from narrative.json by NPC type.
//
async function _resolveNarrative(spec) {
  if (!spec) return null;

  // ── Inline object ──────────────────────────────────────────────────────────
  if (typeof spec === 'object') {
    if (!spec.is_ai) return spec.text ?? null;
    // Use generic narrator prompt (no section-specific prompt for inline)
    try { return await narrateText(spec.ai_hint ?? spec.text ?? '', null) || null; }
    catch { return spec.text ?? null; }
  }

  if (typeof spec !== 'string') return null;

  // ── Manifest reference: "npc:defId:narrative_text" ─────────────────────────
  const refMatch = spec.match(/^(npc|mob):([^:]+):(.+)$/);
  if (refMatch) {
    const [, kind, defId] = refMatch;

    if (kind === 'npc') {
      const base = (NPCS ?? []).find(n => n.id === defId);
      if (!base?.narrative_text) return null;

      // Resolve i18n and pick default text
      const narSpec = translateNpcNarrativeText(base.narrative_text, defId);
      let raw = narSpec.default ?? '';

      // Substitute {npc_name}
      const npcName = t('npc', defId, 'name', base.name);
      raw = raw.replace(/\{npc_name\}/g, npcName);
      if (!raw) return null;

      // No AI requested — return static text
      if (!narSpec.is_ai) return raw;

      // AI: pick narrator prompt by NPC type (trader vs other), same as /api/narrate
      const npcType  = base.type === 'trader' ? 'trader' : 'other';
      const section  = NARRATIVE?.NPC?.[npcType];
      const promptPath = section?.path_promt_narrator;
      const narPrompt  = promptPath ? loadNarratorPrompt(promptPath) : null;

      // A failed AI call must fall back to the static text, not take the whole
      // node down — narrateText() itself never catches (see server/engine/ai.js).
      try { return await narrateText(raw, narPrompt) || raw; }
      catch { return raw; }
    }
    return null;
  }

  // ── Plain string — return as-is ────────────────────────────────────────────
  return spec || null;
}

// ── Prepare node for client ───────────────────────────────────────────────────

async function _prepareNode(node, dialogue, sess) {
  // Run speech text and narrative generation in parallel for speed
  const [text, narrative] = await Promise.all([
    _generateText(node, dialogue, sess),
    _resolveNarrative(node.narrative ?? null)
  ]);

  // Record what the NPC/mob just said so the next AI line (and dream_ai) sees it —
  // narrator lines aren't part of the spoken exchange, so they're excluded.
  if (node.speaker === 'npc' || node.speaker === 'mob') {
    _pushDialogueTurn(sess, 'assistant', text);
  }

  // Filter options by conditions; resolve text_key for each option
  const options = node.options
    ? node.options
        .filter(opt => evalAll(opt.if ?? [], sess))
        .map((opt, visibleIdx) => ({
          index:    visibleIdx,
          text:     _resolveTextKey(opt.text_key, opt.text ?? '...'),
          text_key: opt.text_key ?? null
        }))
    : null;

  return {
    id:         node.id,
    speaker:    node.speaker,
    narrative:  narrative ?? null,      // gray italic text shown above speech
    text,
    text_key:   node.text_key ?? null,
    // Typewriter blip sound: per-node override → per-dialogue default → null
    // (client falls back to media.json's own "npc_text_blips_default" — see public/js/sfx.js).
    text_blips: node.text_blips ?? dialogue.text_blips_default ?? null,
    ends_with:  node.ends_with ?? null,
    options,                            // null = linear node (advance button)
    skippable:  false
  };
}

// ── Phase transition ──────────────────────────────────────────────────────────

function _nextPhaseEntry(dialogue, nextPhase, sess) {
  if (nextPhase === 'main') {
    const e = resolveEntry(dialogue.entry ?? [], sess);
    return { phase: 'main', nodeId: e?.node ?? (dialogue.script?.[0]?.id ?? null) };
  }
  if (nextPhase === 'outro' && dialogue.outro) {
    const e = resolveEntry(dialogue.outro.entry ?? [], sess);
    return { phase: 'outro', nodeId: e?.node ?? (dialogue.outro.script?.[0]?.id ?? null) };
  }
  return null;
}

// ── Seen-once tracking ────────────────────────────────────────────────────────

function _seenKey(dialogueId)  { return `dlg_seen_${dialogueId}`; }
function _markSeen(dialogueId, sess) {
  sess.player.storyFlags = sess.player.storyFlags ?? {};
  sess.player.storyFlags[_seenKey(dialogueId)] = true;
}
function _hasSeen(dialogueId, sess) {
  return !!(sess.player.storyFlags?.[_seenKey(dialogueId)]);
}

// ── Public: start dialogue ────────────────────────────────────────────────────

async function startDialogue(dialogueId, sess) {
  const dialogue = DIALOGUE[dialogueId];
  if (!dialogue || dialogueId.startsWith('_')) {
    throw new Error(`Dialogue not found: ${dialogueId}`);
  }

  // 'once' dialogue already played this session → straight to free chat,
  // don't replay the scripted intro (and don't re-run its AI narrative/text calls).
  if (dialogue.once && _hasSeen(dialogueId, sess)) {
    sess.dialogue = null;
    return { done: true, ends_with: 'free_chat' };
  }

  let phase, nodeId;

  // Try 'before' phase first
  if (dialogue.before?.script?.length) {
    const e = resolveEntry(dialogue.before.entry ?? [], sess);
    nodeId  = e?.node ?? dialogue.before.script[0].id;
    phase   = 'before';
  } else {
    // Main script entry
    const e = resolveEntry(dialogue.entry ?? [], sess);
    nodeId  = e?.node ?? (dialogue.script?.[0]?.id ?? null);
    phase   = 'main';
  }

  if (!nodeId) throw new Error(`No entry node in dialogue: ${dialogueId}`);

  // Mark 'once' dialogues as seen
  if (dialogue.once && !_hasSeen(dialogueId, sess)) {
    _markSeen(dialogueId, sess);
  }

  sess.dialogue = { id: dialogueId, phase, currentNode: nodeId };

  const node = _findNode(dialogue, phase, nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId} in ${dialogueId}/${phase}`);

  // Apply node-level 'set' immediately (e.g. narrator nodes that set flags)
  if (node.set) applySet(node.set, sess);

  return _prepareNode(node, dialogue, sess);
}

// ── Public: advance dialogue (linear or by choice) ───────────────────────────

async function advanceDialogue(choiceIndex, sess) {
  if (!sess.dialogue) throw new Error('No active dialogue');

  const { id: dialogueId, phase, currentNode } = sess.dialogue;
  const dialogue = DIALOGUE[dialogueId];
  if (!dialogue) throw new Error(`Dialogue not found: ${dialogueId}`);

  const node = _findNode(dialogue, phase, currentNode);
  if (!node) {
    sess.dialogue = null;
    return { done: true, ends_with: null };
  }

  let nextNodeId = null;
  let endsWith   = node.ends_with ?? null;

  // ── Resolve next node ─────────────────────────────────────────────────────
  if (node.options && choiceIndex != null) {
    // Player chose an option
    const visible = node.options.filter(opt => evalAll(opt.if ?? [], sess));
    const chosen  = visible[choiceIndex];
    if (!chosen) throw new Error(`Invalid choice index: ${choiceIndex}`);

    // Record what the player picked so the next AI line sees it too.
    _pushDialogueTurn(sess, 'user', _resolveTextKey(chosen.text_key, chosen.text ?? '...'));

    if (chosen.set)       applySet(chosen.set, sess);
    nextNodeId = chosen.next  ?? null;
    endsWith   = chosen.ends_with ?? endsWith;

  } else {
    // Linear advance
    nextNodeId = node.next ?? null;
  }

  // ── Determine where to go ─────────────────────────────────────────────────

  // This node/phase ends — try phase transition
  if (!nextNodeId) {
    if (endsWith === 'combat' || endsWith === 'free_chat' ||
        endsWith === 'shop'   || endsWith === 'close') {
      // Explicit end — close dialogue
      sess.dialogue = null;
      return { done: true, ends_with: endsWith };
    }

    // Try transitioning to next phase
    let transition = null;
    if (phase === 'before') {
      transition = _nextPhaseEntry(dialogue, 'main', sess);
    } else if (phase === 'main' && dialogue.outro) {
      transition = _nextPhaseEntry(dialogue, 'outro', sess);
    }

    if (transition?.nodeId) {
      sess.dialogue.phase       = transition.phase;
      sess.dialogue.currentNode = transition.nodeId;
      const nextNode = _findNode(dialogue, transition.phase, transition.nodeId);
      if (!nextNode) { sess.dialogue = null; return { done: true, ends_with: null }; }
      if (nextNode.set) applySet(nextNode.set, sess);
      const prepared = await _prepareNode(nextNode, dialogue, sess);
      return { done: false, ...prepared };
    }

    // Nothing left — end dialogue
    sess.dialogue = null;
    return { done: true, ends_with: endsWith };
  }

  // ── Advance within current phase ──────────────────────────────────────────
  sess.dialogue.currentNode = nextNodeId;
  const nextNode = _findNode(dialogue, phase, nextNodeId);
  if (!nextNode) {
    sess.dialogue = null;
    return { done: true, ends_with: null };
  }

  if (nextNode.set) applySet(nextNode.set, sess);

  const prepared = await _prepareNode(nextNode, dialogue, sess);
  return { done: false, ends_with: nextNode.ends_with ?? null, ...prepared };
}

module.exports = { startDialogue, advanceDialogue };
