'use strict';
import { showScreen } from './dom.js';

const root = document.getElementById('game-preloader');

function setProgress(ratio) {
  const t = Math.max(0, Math.min(1, ratio));
  if (!root) return;
  root.style.setProperty('--preload', String(t));
  root.style.setProperty('--bar-pct', (t * 100).toFixed(2) + '%');
}

function loadImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

async function loadAudioUrl(url) {
  try { await fetch(url, { cache: 'force-cache', mode: 'same-origin' }); } catch { /* ignore */ }
} 

function loadOne(url) {
  const ext = (url.split('.').pop() || '').toLowerCase();
  if (['mp3', 'ogg', 'wav'].includes(ext)) return loadAudioUrl(url);
  return loadImage(url);
}

async function preloadPool(urls, concurrency, onEachDone) {
  let i = 0, done = 0;
  const total = Math.max(1, urls.length);

  async function worker() {
    while (i < urls.length) {
      const cur = urls[i++];
      await loadOne(cur);
      onEachDone(++done / total);
    }
  }

  const n = Math.min(concurrency, Math.max(1, urls.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
}

function finish() {
  setTimeout(() => {
    root.setAttribute('aria-busy', 'false');
    root.classList.add('preloader--out');
    root.classList.add('hidden');
    showScreen('menu');
  }, 500);
}

async function run() {
  let urls = [];
  try {
    const res = await fetch('/api/preload-assets');
    if (res.ok) {
      const data = await res.json();
      urls = Array.isArray(data.urls) ? data.urls : [];
    }
  } catch { /* offline / old server */ }

  if (!urls.length) {
    setProgress(1);
    await new Promise(r => setTimeout(r, 280));
    finish();
    return;
  }

  await preloadPool(urls, 10, r => setProgress(r));
  setProgress(1);
  await new Promise(r => setTimeout(r, 160));
  finish();
}

export { run };
