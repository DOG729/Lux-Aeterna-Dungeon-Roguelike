'use strict';

// ── SFX Manager ───────────────────────────────────────────────────────────────
// Plays one-shot sound effects (ability sounds, UI clicks, hovers, etc.)
// Separate from MusicManager so SFX volume is independent of music.
//
// Volume model:
//   finalVolume = userSfxVol × soundVolume
//   userSfxVol  — slider in settings (0–1), stored in _vol
//   soundVolume — per-ability or per-entity multiplier (core.default_sound_volume,
//                 ability.sound_volume, or entity sound_volume); stored/resolved at call time
//
// Sound resolution priority for playAbility():
//   1. Entity-specific sound map  (player.json / mob manifesto  "sound" field)
//   2. Core ability sound         (core.json  ability "sound"   field)
//   3. Global default             (core.json  "default_sound")
//
// Sound volume priority for playAbility():
//   1. entitySoundVolume arg      (player.json / mob manifesto  "sound_volume")
//   2. abilityDef.sound_volume    (core.json  ability "sound_volume")
//   3. _defaultVol                (core.json  "default_sound_volume")

class SfxManager {
  constructor() {
    this._vol              = 0.2;   // user sfx slider setting (0–1)
    this._defaultVol       = 1;     // core.default_sound_volume master multiplier
    this._defaultSrc       = null;  // core.default_sound global fallback path
    this._defaultMobSounds = null;  // core.default_sound_mob  { damage_received: { hit, crit } }
    this._uiSounds         = null;  // assets/config/media.json → sound (served via /api/ui-sounds)
    this._blipAudio        = null;  // currently-playing NPC dialogue typewriter blip (overlap guard)
  }

  setVolume(vol) {
    this._vol = Math.max(0, Math.min(1, +vol || 0));
  }

  // Set the global fallback sound (from core.mechanics.default_sound)
  setDefault(src) {
    this._defaultSrc = src || null;
  }

  // Set the master ability-sound volume multiplier (from core.mechanics.default_sound_volume)
  setDefaultVolume(vol) {
    this._defaultVol = Math.max(0, Math.min(2, +vol || 1));
  }

  // Set global mob event sounds (from core.mechanics.default_sound_mob)
  setDefaultMobSounds(spec) {
    this._defaultMobSounds = spec || null;
  }

  // Load the sound map from assets/config/media.json → sound (served via /api/ui-sounds)
  loadUiSounds(map) {
    this._uiSounds = map || null;
  }

  // Play a named sound event (UI or narrative).
  // Entry formats in media.json → sound:
  //   null                          → silent
  //   "path"                        → fixed file
  //   ["p1","p2"]                   → random pick
  //   { "src": "p" | [...], "volume": 0.8 } → with per-event volume
  playUi(key) {
    const norm = this._normalizeSoundEntry(this._uiSounds?.[key]);
    if (norm?.src) this.play(norm.src, norm.vol);
  }

  // ── NPC dialogue typewriter blip ──────────────────────────────────────────
  //
  // spec (optional per-node/per-dialogue override, from dialogue.json
  // node.text_blips / dialogue.text_blips_default) can be:
  //   undefined/null   → media.json "npc_text_blips_default" (global default)
  //   "some_key"       → looked up in media.json → sound (same registry as
  //                      event.json's sound hooks); falls back to treating the
  //                      string itself as a literal path if the key isn't registered
  //   {src, volume} / ["p1","p2"] → inline literal, used as-is (no registry lookup)
  //
  // Overlap guard: a new blip only starts once the previous one has finished —
  // typing fast otherwise stacks dozens of overlapping one-shots into noise.
  playTextBlip(spec) {
    if (this._blipAudio && !this._blipAudio.paused && !this._blipAudio.ended) return;

    let entry;
    if (spec == null)            entry = this._uiSounds?.npc_text_blips_default;
    else if (typeof spec === 'string') entry = this._uiSounds?.[spec] ?? spec;
    else                          entry = spec;

    const norm = this._normalizeSoundEntry(entry);
    if (!norm?.src) return;
    this._blipAudio = this.play(norm.src, norm.vol);
  }

  // Play a raw path.
  // Paths starting with '/' or 'http' are used as-is;
  // otherwise resolved relative to /assets/sound/
  // soundVolume: the ability/entity multiplier applied on top of the user volume setting.
  // Returns the Audio element (or null if nothing played) so callers can track playback state.
  play(src, soundVolume = null) {
    if (!src || this._vol <= 0) return null;
    const url = (src.startsWith('/') || src.startsWith('http'))
      ? src
      : `/assets/sound/${src}`;
    const a = new Audio(url);
    const vol = soundVolume ?? this._defaultVol;
    a.volume = Math.max(0, Math.min(1, this._vol * vol));
    a.play().catch(() => {});
    return a;
  }

  // Normalize a media.json-style sound entry into { src, vol }.
  // Formats: null | "path" | ["p1","p2"] | { src, volume }
  _normalizeSoundEntry(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') return { src: entry, vol: null };
    if (Array.isArray(entry))      return { src: _pick(entry), vol: null };
    if (typeof entry === 'object') return { src: Array.isArray(entry.src) ? _pick(entry.src) : (entry.src ?? null), vol: entry.volume ?? null };
    return null;
  }

  // ── Ability sound resolution ───────────────────────────────────────────────
  //
  // entitySoundMap   — "sound" object from player.json / mob manifesto (keyed by ability id)
  // abilityId        — ability name being used (e.g. "attack", "heal")
  // isCrit           — whether the hit was a critical strike
  // abilityDef       — full ability definition from core.json / state.G.abilities[id]
  //                    (has .action, .sound, .sound_volume, .applies_to)
  // opponentAction   — what the opponent did this turn (for damage_reduction keying)
  // entitySoundVolume — optional override from entity's own sound_volume field
  //
  // Entity map entry formats:
  //   "attack": "path.mp3"                              → always plays this
  //   "attack": ["p1.mp3","p2.mp3"]                     → random pick
  //   "attack": { "hit": "p.mp3", "crit": "c.mp3" }    → hit / crit variant
  //   any value can also be an array for random pick
  //
  // Core ability "sound" formats:
  //   action === "attack"           → { hit, crit }  (array values ok)
  //   action === "damage_reduction" → { <opponentAbilityId>: path, default: path }
  //   action === "add_*" / other    → string or array (plain play-on-use)
  playAbility(entitySoundMap, abilityId, isCrit, abilityDef, opponentAction, entitySoundVolume = null) {
    // Resolve sound volume: entity override → per-ability core → global default
    const vol = entitySoundVolume ?? abilityDef?.sound_volume ?? this._defaultVol;

    // 1. Entity-specific
    const entitySrc = this._resolveEntity(entitySoundMap, abilityId, isCrit);
    if (entitySrc) { this.play(entitySrc, vol); return; }

    // 2. Core ability sound
    if (abilityDef?.sound) {
      const coreSrc = this._resolveCore(abilityDef.sound, abilityDef.action, isCrit, opponentAction);
      if (coreSrc) { this.play(coreSrc, vol); return; }
    }

    // 3. Global default
    if (this._defaultSrc) this.play(this._defaultSrc, vol);
  }

  // ── Damage-received sound for mob/boss ────────────────────────────────────
  //
  // Called when the player lands a hit on a mob that did NOT use damage_reduction.
  //
  // mobSoundMap  — mob.sound entity map (may contain a "damage_received" key)
  //                Format: "damage_received": { "hit": "path.mp3", "crit": "c.mp3" }
  //                or plain string / array.
  // isCrit       — whether the player's hit was a critical strike
  // soundVolume  — entity-level volume (mob.soundVolume ?? this._defaultVol)
  //
  // Priority:
  //   1. mob.sound.damage_received  (entity-specific)
  //   2. core.default_sound_mob.damage_received  (global fallback)
  playDamageReceived(mobSoundMap, isCrit, soundVolume = null) {
    const vol = soundVolume ?? this._defaultVol;

    // 1. Entity-specific
    const entitySpec = mobSoundMap?.damage_received;
    if (entitySpec) {
      const src = this._resolveDamageReceived(entitySpec, isCrit);
      if (src) { this.play(src, vol); return; }
    }

    // 2. Global default from core.default_sound_mob
    const defaultSpec = this._defaultMobSounds?.damage_received;
    if (defaultSpec) {
      const src = this._resolveDamageReceived(defaultSpec, isCrit);
      if (src) this.play(src, vol);
    }
  }

  // ── UI sounds ─────────────────────────────────────────────────────────────
  // Scans `root` for elements with data-sound-hover / data-sound-click
  // and attaches the appropriate event listeners (idempotent).
  initUI(root = document) {
    root.querySelectorAll('[data-sound-hover]').forEach(el => {
      if (el._sfxHoverBound) return;
      el._sfxHoverBound = true;
      el.addEventListener('mouseenter', () => {
        const vol = el.dataset.soundVolume != null ? +el.dataset.soundVolume : null;
        this.play(el.dataset.soundHover, vol);
      }, { passive: true });
    });
    root.querySelectorAll('[data-sound-click]').forEach(el => {
      if (el._sfxClickBound) return;
      el._sfxClickBound = true;
      el.addEventListener('click', () => {
        const vol = el.dataset.soundVolume != null ? +el.dataset.soundVolume : null;
        this.play(el.dataset.soundClick, vol);
      }, { passive: true });
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  // Resolve from entity-specific sound map (player.json / manifesto)
  _resolveEntity(soundMap, abilityId, isCrit) {
    const entry = soundMap?.[abilityId];
    if (!entry) return null;
    if (typeof entry === 'string') return entry;
    if (Array.isArray(entry)) return _pick(entry);
    if (typeof entry === 'object') {
      if (isCrit && entry.crit) return _pick(entry.crit);
      const h = entry.hit ?? entry.default ?? null;
      return h ? _pick(h) : null;
    }
    return null;
  }

  // Resolve from core ability "sound" field based on action type
  _resolveCore(sound, action, isCrit, opponentAction) {
    if (!sound) return null;

    // Plain string or array → play as-is (used for add_*, flee, etc.)
    if (typeof sound === 'string') return sound;
    if (Array.isArray(sound)) return _pick(sound);

    // Object — interpretation depends on action type
    if (action === 'attack') {
      // { hit, crit } — crit overrides hit when applicable
      if (isCrit && sound.crit) return _pick(sound.crit);
      if (sound.hit)            return _pick(sound.hit);
      if (sound.default)        return _pick(sound.default);
      // Fallback: first value in object
      return _pick(Object.values(sound)[0] ?? null);
    }

    if (action === 'damage_reduction') {
      // Keyed by the opponent's ability id; "default" is the fallback
      if (opponentAction && sound[opponentAction]) return _pick(sound[opponentAction]);
      if (sound.default)                           return _pick(sound.default);
      return null;
    }

    // add_hp / add_energy / add_mana / other — pick first value or "default"
    if (sound.default) return _pick(sound.default);
    const first = Object.values(sound)[0];
    return first ? _pick(first) : null;
  }

  // Resolve damage_received spec: string | array | { hit, crit }
  _resolveDamageReceived(spec, isCrit) {
    if (!spec) return null;
    if (typeof spec === 'string') return spec;
    if (Array.isArray(spec))     return _pick(spec);
    if (typeof spec === 'object') {
      if (isCrit && spec.crit) return _pick(spec.crit);
      if (spec.hit)            return _pick(spec.hit);
    }
    return null;
  }
}

function _pick(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val.length ? val[Math.floor(Math.random() * val.length)] : null;
  return val;
}

export const sfx = new SfxManager();
