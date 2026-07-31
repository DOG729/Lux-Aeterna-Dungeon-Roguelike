'use strict';

export class MusicManager {
  constructor() {
    this._bgTracks     = [];
    this._btTracks     = [];
    this._bgIdx        = 0;
    this._audio        = null;
    this._inBattle     = false;
    this._bgVol        = 0.25;
    this._btVol        = 0.25;
    this._ready        = false;
    this._pendingStart = false;
  }

  async init() {
    try {
      const data = await fetch('/api/music-tracks').then(r => r.json());
      this._bgTracks = data.bg     ?? [];
      this._btTracks = data.battle ?? [];
      this._bgTracks = this._shuffle(this._bgTracks);
    } catch { /* no music available */ }
    this._ready = true;
    if (this._pendingStart) { this._pendingStart = false; this._playBg(); }
  }

  unlock() {
    if (this._audio) return;
    this._playBg();
  }

  setVolumes(bgVol, btVol) {
    this._bgVol = bgVol;
    this._btVol = btVol;
    if (this._audio) this._audio.volume = this._inBattle ? btVol : bgVol;
  }

  enterBattle() {
    if (this._inBattle) return;
    this._inBattle = true;
    this._stop();
    this._playBattle();
  }

  exitBattle() {
    if (!this._inBattle) return;
    this._inBattle = false;
    this._stop();
    this._playBg();
  }

  previewBg(play) {
    if (play) { this._inBattle = false; this._stop(); this._playBg(); }
    else this._stop();
  }

  previewBattle(play) {
    if (play) { this._inBattle = true; this._stop(); this._playBattle(); }
    else { this._inBattle = false; this._stop(); }
  }

  _stop() {
    if (this._audio) { this._audio.pause(); this._audio.src = ''; this._audio = null; }
  }

  _playBg() {
    if (!this._ready) { this._pendingStart = true; return; }
    if (!this._bgTracks.length) return;
    this._bgIdx = this._bgIdx % this._bgTracks.length;
    const src = this._bgTracks[this._bgIdx];
    this._bgIdx = (this._bgIdx + 1) % this._bgTracks.length;
    this._play(src, this._bgVol, () => { if (!this._inBattle) this._playBg(); });
  }

  _playBattle() {
    if (!this._btTracks.length) return;
    const src = this._btTracks[Math.floor(Math.random() * this._btTracks.length)];
    this._play(src, this._btVol, () => {});
  }

  _play(src, vol, onEnd) {
    this._stop();
    const a = new Audio(src);
    a.volume = vol;
    a.addEventListener('ended', onEnd);
    this._audio = a;
    a.play().catch(() => {});
  }

  suspend() {
    this._suspended = { inBattle: this._inBattle };
    this._stop();
  }

  unsuspend() {
    if (!this._suspended) return;
    this._inBattle = this._suspended.inBattle;
    this._suspended = null;
    if (this._inBattle) this._playBattle(); else this._playBg();
  }

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

export const music = new MusicManager();
