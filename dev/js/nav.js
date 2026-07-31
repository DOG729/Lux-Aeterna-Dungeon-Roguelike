'use strict';
// Injects the shared dev-editor nav as first child of <body>.
// Include as a plain <script> (not module) so document.currentScript works.
(function () {
  const ITEMS = [
    { href: '/editors/', label: 'Hub' },
    { href: '/map',              label: 'Map' },
    { href: '/editors/mob.html', label: 'Mobs' },
    { href: '/editors/boss.html',label: 'Bosses' },
    { href: '/editors/npc.html', label: 'NPCs' },
    { href: '/editors/item.html',label: 'Items' },
    { href: '/scavenge',         label: 'Scavenge' },
    { href: '/balance',          label: 'Balance' },
  ];

  const nav = document.createElement('nav');
  nav.className = 'dev-nav';

  const brand = document.createElement('span');
  brand.className = 'dev-nav-brand';
  brand.textContent = '⚙ DEV EDITOR';
  nav.appendChild(brand);

  const p = location.pathname;
  for (const { href, label } of ITEMS) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    const isHub = href === '/editors/';
    if (isHub ? (p === '/editors/' || p === '/') : p === href || p.endsWith(href)) {
      a.classList.add('active');
    }
    nav.appendChild(a);
  }

  const me = document.currentScript;
  (me ? me.parentNode : document.body).insertBefore(nav, me ?? document.body.firstChild);
})();
