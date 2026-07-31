/**
 * Манифест: assets/image/animated/particles/manifest.json
 *
 * items[] — частицы (file, mode sand|boulder, speed, spin, …)
 *   У каждого item опционально appearance | effects — те же поля, что и глобально;
 *   заданные min/max переопределяют только этот ключ, остальное наследуется с корня.
 *
 * Корневой appearance — дефолт для всех items.
 *   zoom, blurPx, opacity, opacityEnd — { min, max }
 *
 * Алиасы: scale вместо zoom; blur вместо blurPx; alpha вместо opacity.
 */ 

const PARTICLES_MANIFEST = '/assets/image/animated/particles/manifest.json';
const PARTICLES_BASE = '/assets/image/animated/particles/';

/** Явные записи для меню (если не пусто — манифест не грузим). */
export const MENU_FALLING_PARTICLE_ENTRIES = [];

const MODE_PRESETS = {
  sand: {
    spin: false,
    speed: 0.9,
    driftVw: [-1.2, 1.2],
    sizeMinPx: 28,
    sizeMaxPx: 72,
  },
  boulder: {
    spin: true,
    speed: 1.35,
    driftVw: [-14, 14],
    sizeMinPx: 20,
    sizeMaxPx: 52,
  },
};

export const DEFAULT_PARTICLE_APPEARANCE = {
  zoom: { min: 1, max: 1 },
  blurPx: { min: 0, max: 0 },
  opacity: { min: 0.35, max: 0.95 },
  opacityEnd: { min: 0.1, max: 0.14 },
};


export const MENU_FALLING_PARTICLE_MANIFEST_FALLBACK = {
  appearance: {
    zoom: { min: 0.94, max: 1.06 },
    blurPx: { min: 0, max: 0.65 },
    opacity: { min: 0.38, max: 0.92 },
    opacityEnd: { min: 0.08, max: 0.16 },
  },
  items: [

  ],
}; 

export const COMBAT_FALLING_PARTICLE_URLS = [];
export const DUNGEON_FALLING_PARTICLE_URLS = [];

function clampPair(min, max, defMin, defMax) {
  let lo = Number(min);
  let hi = Number(max);
  if (Number.isNaN(lo)) lo = defMin;
  if (Number.isNaN(hi)) hi = defMax;
  if (lo > hi) [lo, hi] = [hi, lo];
  return { min: lo, max: hi };
}

function clampOpacityRange(min, max, defMin, defMax) {
  const p = clampPair(min, max, defMin, defMax);
  return {
    min: Math.min(1, Math.max(0, p.min)),
    max: Math.min(1, Math.max(0, p.max)),
  };
}

function clampZoomRange(min, max, defMin, defMax) {
  const p = clampPair(min, max, defMin, defMax);
  return {
    min: Math.min(3, Math.max(0.2, p.min)),
    max: Math.min(3, Math.max(0.2, p.max)),
  };
}

function clampBlurRange(min, max, defMin, defMax) {
  const p = clampPair(min, max, defMin, defMax);
  return {
    min: Math.min(24, Math.max(0, p.min)),
    max: Math.min(24, Math.max(0, p.max)),
  };
}

/** Нормализует блок appearance из манифеста. */
export function normalizeParticleAppearance(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const zoomSrc = src.zoom ?? src.scale;
  const blurSrc = src.blurPx ?? src.blur;
  const opSrc = src.opacity ?? src.alpha;
  const opEndSrc = src.opacityEnd ?? src.opacity_end;

  return {
    zoom: clampZoomRange(zoomSrc?.min, zoomSrc?.max, DEFAULT_PARTICLE_APPEARANCE.zoom.min, DEFAULT_PARTICLE_APPEARANCE.zoom.max),
    blurPx: clampBlurRange(blurSrc?.min, blurSrc?.max, DEFAULT_PARTICLE_APPEARANCE.blurPx.min, DEFAULT_PARTICLE_APPEARANCE.blurPx.max),
    opacity: clampOpacityRange(opSrc?.min, opSrc?.max, DEFAULT_PARTICLE_APPEARANCE.opacity.min, DEFAULT_PARTICLE_APPEARANCE.opacity.max),
    opacityEnd: clampOpacityRange(opEndSrc?.min, opEndSrc?.max, DEFAULT_PARTICLE_APPEARANCE.opacityEnd.min, DEFAULT_PARTICLE_APPEARANCE.opacityEnd.max),
  };
}

/**
 * Слияние: глобальный (уже normalizeParticleAppearance) + частичные поля item.
 * У item можно задать только blurPx — zoom/opacity останутся от глобального.
 */
export function mergeParticleAppearances(globalNorm, itemRaw) {
  const g = globalNorm;
  if (!itemRaw || typeof itemRaw !== 'object') return g;

  const zoomSrc = itemRaw.zoom ?? itemRaw.scale;
  const blurSrc = itemRaw.blurPx ?? itemRaw.blur;
  const opSrc = itemRaw.opacity ?? itemRaw.alpha;
  const opEndSrc = itemRaw.opacityEnd ?? itemRaw.opacity_end;

  const mergeAxis = (gr, partial, clampFn) => {
    if (!partial || typeof partial !== 'object') return gr;
    const nmin = partial.min !== undefined && partial.min !== null ? Number(partial.min) : gr.min;
    const nmax = partial.max !== undefined && partial.max !== null ? Number(partial.max) : gr.max;
    return clampFn(nmin, nmax, gr.min, gr.max);
  };

  return {
    zoom: mergeAxis(g.zoom, zoomSrc, clampZoomRange),
    blurPx: mergeAxis(g.blurPx, blurSrc, clampBlurRange),
    opacity: mergeAxis(g.opacity, opSrc, clampOpacityRange),
    opacityEnd: mergeAxis(g.opacityEnd, opEndSrc, clampOpacityRange),
  };
}

export function flattenAppearanceForEngine(a) {
  return {
    zoomMin: a.zoom.min,
    zoomMax: a.zoom.max,
    blurMin: a.blurPx.min,
    blurMax: a.blurPx.max,
    opacityMin: a.opacity.min,
    opacityMax: a.opacity.max,
    opacityEndMin: a.opacityEnd.min,
    opacityEndMax: a.opacityEnd.max,
  };
}

function coerceManifestSpin(value, presetSpin) {
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (typeof value === 'boolean') return value;
  return presetSpin;
}

function fileToUrl(file) {
  const f = String(file).trim();
  if (!f) return '';
  if (f.startsWith('/') || f.startsWith('http')) return f;
  return `${PARTICLES_BASE}${f.replace(/^\.\//, '')}`;
}

function attachMergedFx(out, globalAppearance, row) {
  const itemFx = row?.appearance ?? row?.effects;
  const merged = mergeParticleAppearances(globalAppearance, itemFx);
  Object.assign(out, flattenAppearanceForEngine(merged));
}

function entryFromPreset(mode, row, globalAppearance) {
  const preset = MODE_PRESETS[mode] ?? MODE_PRESETS.boulder;
  const url = fileToUrl(row.file);
  if (!url) return null;
  const spin = coerceManifestSpin(row.spin, preset.spin);
  const speed = typeof row.speed === 'number' && !Number.isNaN(row.speed) ? row.speed : preset.speed;
  const driftVw = Array.isArray(row.driftVw) && row.driftVw.length === 2
    ? [+row.driftVw[0], +row.driftVw[1]]
    : preset.driftVw;
  const out = {
    url,
    spin,
    speed,
    driftVw,
    sizeMinPx: typeof row.sizeMinPx === 'number' ? row.sizeMinPx : preset.sizeMinPx,
    sizeMaxPx: typeof row.sizeMaxPx === 'number' ? row.sizeMaxPx : preset.sizeMaxPx,
  };
  attachMergedFx(out, globalAppearance, row);
  return out;
}

function manifestItemsToEntries(items, globalAppearance) {
  if (!Array.isArray(items)) return [];
  return items
    .map((row) => {
      if (typeof row === 'string') {
        const url = fileToUrl(row);
        return url ? entryFromPreset('boulder', { file: row }, globalAppearance) : null;
      }
      if (!row || typeof row !== 'object') return null;
      if (typeof row.url === 'string' && row.url.trim()) {
        return resolvedRowToEntry(row, globalAppearance);
      }
      const file = row.file;
      if (!file || typeof file !== 'string') return null;
      const mode = row.mode === 'sand' || row.mode === 'boulder' ? row.mode : 'boulder';
      return entryFromPreset(mode, row, globalAppearance);
    })
    .filter(Boolean);
}

function resolvedRowToEntry(row, globalAppearance) {
  const spin = coerceManifestSpin(row.spin, true);
  const out = {
    url: row.url.trim(),
    spin,
    speed: typeof row.speed === 'number' && !Number.isNaN(row.speed) ? row.speed : 1,
    driftVw: Array.isArray(row.driftVw) && row.driftVw.length === 2
      ? [+row.driftVw[0], +row.driftVw[1]]
      : spin
        ? [-14, 14]
        : [-1.2, 1.2],
    sizeMinPx: row.sizeMinPx,
    sizeMaxPx: row.sizeMaxPx,
  };
  attachMergedFx(out, globalAppearance, row);
  return out;
}

function parseManifestData(data) {
  const appearance = normalizeParticleAppearance(
    data?.appearance ?? data?.effects ?? {},
  );

  if (!data) {
    return { entries: [], appearance };
  }
  if (Array.isArray(data)) {
    const g = normalizeParticleAppearance({});
    return { entries: manifestItemsToEntries(data, g), appearance: g };
  }

  let entries = [];
  if (Array.isArray(data.items) && data.items.length) {
    entries = manifestItemsToEntries(data.items, appearance);
  } else if (Array.isArray(data.files) && data.files.length) {
    entries = manifestItemsToEntries(data.files, appearance);
  }

  return { entries, appearance };
}

/** Готовые записи с полем `url` (без манифеста). */
function normalizeResolvedEntries(entries, globalAppearance) {
  if (!entries?.length) return [];
  return entries
    .map((row) => {
      if (typeof row === 'string' && row.trim()) {
        return entryFromPreset('boulder', { file: row }, globalAppearance);
      }
      if (row && typeof row.url === 'string' && row.url.trim()) {
        return resolvedRowToEntry(row, globalAppearance);
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * @returns {{ entries: Array, appearance: ReturnType<typeof normalizeParticleAppearance> }}
 */
export async function resolveMenuFallingParticles() {
  if (MENU_FALLING_PARTICLE_ENTRIES.length > 0) {
    const e = MENU_FALLING_PARTICLE_ENTRIES;
    const appearance = normalizeParticleAppearance(MENU_FALLING_PARTICLE_MANIFEST_FALLBACK.appearance);
    if (e[0] && typeof e[0].file === 'string') {
      return { entries: manifestItemsToEntries(e, appearance), appearance };
    }
    return { entries: normalizeResolvedEntries(e, appearance), appearance };
  }
  try {
    const r = await fetch(PARTICLES_MANIFEST, { cache: 'force-cache' });
    if (r.ok) {
      const data = await r.json();
      const bundle = parseManifestData(data);
      if (bundle.entries.length) return bundle;
    }
  } catch (_) {
    /* fallback */
  }
  return parseManifestData(MENU_FALLING_PARTICLE_MANIFEST_FALLBACK);
}
