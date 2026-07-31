/**
 * Падающие частицы только для #screen-menu (вкл/выкл по классу .active).
 */
import { createFallingParticles } from './falling-particles-engine.js';
import { resolveMenuFallingParticles, flattenAppearanceForEngine } from './particle-urls-by-scene.js';

export async function initMenuFallingParticles() {
  const screen = document.getElementById('screen-menu');
  const layer = document.getElementById('menu-falling-layer');
  if (!screen || !layer) return; 

  const { entries, appearance } = await resolveMenuFallingParticles();
  const fx = createFallingParticles(layer, entries, {
    minIntervalMs: 220,
    maxIntervalMs: 780,
    maxAlive: 32,
    minDurationS: 7,
    maxDurationS: 16,
    minSizePx: 20,
    maxSizePx: 52,
    ...flattenAppearanceForEngine(appearance),
  });

  function sync() {
    if (screen.classList.contains('active') && entries.length > 0) {
      fx.start();
    } else {
      fx.stop();
    }
  }

  sync();
  const mo = new MutationObserver(sync);
  mo.observe(screen, { attributes: true, attributeFilter: ['class'] });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) fx.stop();
    else sync();
  });
}
