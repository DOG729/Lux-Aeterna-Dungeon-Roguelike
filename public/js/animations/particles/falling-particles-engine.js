/**
 * Падающие спрайты. entries — из манифеста (url + поведение).
 * Строки в массиве (legacy) считаются «валунами» с вращением.
 */
export function createFallingParticles(layerEl, entries, options = {}) {
  const list = normalizeEntries(entries);
  if (!layerEl || !list.length) {
    return { start() {}, stop() {}, destroy() {} };
  }

  const {
    minIntervalMs = 280,
    maxIntervalMs = 900,
    maxAlive = 28,
    minDurationS = 6,
    maxDurationS = 14,
    minSizePx = 22,
    maxSizePx = 56,
    zoomMin = 1,
    zoomMax = 1,
    blurMin = 0,
    blurMax = 0,
    opacityMin = 0.35,
    opacityMax = 0.95,
    opacityEndMin = 0.1,
    opacityEndMax = 0.14,
  } = options;

  let spawnTimer = null;
  let stopped = true;

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function pickEntry() {
    return list[(Math.random() * list.length) | 0];
  }

  function prune() {
    while (layerEl.children.length > maxAlive) {
      layerEl.firstElementChild?.remove();
    }
  }

  function spawnOne() {
    const spec = pickEntry();
    const img = document.createElement('img');
    img.className = 'falling-particle';
    img.src = spec.url;
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'eager';
    img.addEventListener('error', () => img.remove(), { once: true });

    const xvw = rand(-5, 105);
    const [d0, d1] = spec.driftVw;
    const driftvw = rand(d0, d1);
    const useSpin = spec.spin === true;
    const rotEnd = useSpin ? `${rand(-160, 160)}deg` : '0deg';
    const speed = Math.max(0.25, spec.speed || 1);
    const baseDur = rand(minDurationS, maxDurationS);
    const dur = baseDur / speed;

    const smin = spec.sizeMinPx ?? minSizePx;
    const smax = spec.sizeMaxPx ?? maxSizePx;
    const w = rand(Math.min(smin, smax), Math.max(smin, smax));

    const zm0 = spec.zoomMin ?? zoomMin;
    const zm1 = spec.zoomMax ?? zoomMax;
    const bm0 = spec.blurMin ?? blurMin;
    const bm1 = spec.blurMax ?? blurMax;
    const om0 = spec.opacityMin ?? opacityMin;
    const om1 = spec.opacityMax ?? opacityMax;
    const oe0 = spec.opacityEndMin ?? opacityEndMin;
    const oe1 = spec.opacityEndMax ?? opacityEndMax;

    const z0 = rand(zm0, zm1);
    const z1 = rand(zm0, zm1);
    const b0 = rand(bm0, bm1);
    const b1 = rand(bm0, bm1);
    const op0 = rand(om0, om1);
    const op1 = rand(oe0, oe1);

    img.style.setProperty('--xvw', String(xvw));
    img.style.setProperty('--driftvw', String(driftvw));
    img.style.setProperty('--rot-end', rotEnd);
    img.style.setProperty('--w', `${w}px`);
    img.style.setProperty('--scale0', String(z0));
    img.style.setProperty('--scale1', String(z1));
    img.style.setProperty('--blur0', `${b0}px`);
    img.style.setProperty('--blur1', `${b1}px`);
    img.style.setProperty('--op0', String(op0));
    img.style.setProperty('--op1', String(op1));
    img.style.animationDuration = `${dur}s`;

    const onEnd = () => img.remove();
    img.addEventListener('animationend', onEnd, { once: true });

    layerEl.appendChild(img);
    prune();
  }

  function scheduleNext() {
    if (stopped) return;
    spawnTimer = window.setTimeout(() => {
      spawnOne();
      scheduleNext();
    }, rand(minIntervalMs, maxIntervalMs));
  }

  return {
    start() {
      stopped = false;
      layerEl.innerHTML = '';
      scheduleNext();
    },
    stop() {
      stopped = true;
      if (spawnTimer != null) {
        clearTimeout(spawnTimer);
        spawnTimer = null;
      }
      layerEl.innerHTML = '';
    },
    destroy() {
      this.stop();
    },
  };
}

const FX_OPTION_KEYS = [
  'zoomMin', 'zoomMax', 'blurMin', 'blurMax',
  'opacityMin', 'opacityMax', 'opacityEndMin', 'opacityEndMax',
];

/** Строгое «крутить только при true»; строки из кривого JSON тоже учитываем. */
function coerceParticleSpin(value, defaultSpin) {
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (typeof value === 'boolean') return value;
  return defaultSpin;
}

function copyFxFromEntry(target, source) {
  for (const k of FX_OPTION_KEYS) {
    const v = source[k];
    if (v !== undefined && v !== null && typeof v === 'number' && !Number.isNaN(v)) {
      target[k] = v;
    }
  }
}

function normalizeEntries(entries) {
  if (!entries?.length) return [];
  return entries
    .map((e) => {
      if (typeof e === 'string') {
        const url = e.trim();
        if (!url) return null;
        return {
          url,
          spin: true,
          speed: 1,
          driftVw: [-16, 16],
        };
      }
      if (e && typeof e.url === 'string' && e.url.trim()) {
        const base = {
          url: e.url.trim(),
          spin: coerceParticleSpin(e.spin, true),
          speed: typeof e.speed === 'number' && !Number.isNaN(e.speed) ? e.speed : 1,
          driftVw: Array.isArray(e.driftVw) && e.driftVw.length === 2
            ? [e.driftVw[0], e.driftVw[1]]
            : e.spin === false
              ? [-1.2, 1.2]
              : [-16, 16],
          sizeMinPx: e.sizeMinPx,
          sizeMaxPx: e.sizeMaxPx,
        };
        copyFxFromEntry(base, e);
        return base;
      }
      return null; 
    })
    .filter(Boolean);
}
