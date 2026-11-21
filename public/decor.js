// Décor de Noël en arrière-plan : ciel de nuit, neige légère, sapins à l'horizon, et une
// fine guirlande dorée en haut de la page (elle défile avec la page, ne reste jamais collée).
// Purement décoratif (aria-hidden), derrière tout le contenu, sans jamais intercepter les clics.
// Les tailles et positions sont posées via le CSSOM (autorisé par la politique de sécurité,
// contrairement aux attributs style="").

const NS = 'http://www.w3.org/2000/svg';
const BULB_COLORS = ['#F6D58E', '#F3C979', '#FBE7B8'];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function svg(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** Générateur pseudo-aléatoire stable : l'horizon est le même à chaque visite. */
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Une ligne de crête faite de silhouettes de sapins (trois étages chacun). */
function ridgePath({ width, height, base, minH, maxH, gap, seed }) {
  const r = seeded(seed);
  const pts = [[0, height], [0, base]];
  let x = -10;
  while (x < width + 40) {
    const h = minH + r() * (maxH - minH);
    const w = h * (0.46 + r() * 0.12);
    const b = base + Math.sin(x / 180 + seed) * 6;
    const half = w / 2;
    pts.push(
      [x - half, b],
      [x - half * 0.42, b - h * 0.36], [x - half * 0.68, b - h * 0.36],
      [x - half * 0.22, b - h * 0.68], [x - half * 0.42, b - h * 0.68],
      [x, b - h],
      [x + half * 0.42, b - h * 0.68], [x + half * 0.22, b - h * 0.68],
      [x + half * 0.68, b - h * 0.36], [x + half * 0.42, b - h * 0.36],
      [x + half, b],
    );
    x += half + gap * (0.4 + r());
  }
  pts.push([width, base], [width, height]);
  return `M${pts.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join('L')}Z`;
}

function horizon() {
  const W = 1600;
  const H = 160;
  const box = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMax slice', class: 'xmas-horizon', focusable: 'false' });
  const layers = [
    { fill: '#0F1D31', base: 118, minH: 46, maxH: 92, gap: 34, seed: 7, cls: 'ridge-back' },
    { fill: '#13243B', base: 136, minH: 36, maxH: 74, gap: 46, seed: 19, cls: 'ridge-mid' },
    { fill: '#0B1626', base: 150, minH: 24, maxH: 52, gap: 64, seed: 31, cls: 'ridge-front' },
  ];
  for (const l of layers) box.append(svg('path', { d: ridgePath({ width: W, height: H, ...l }), fill: l.fill, class: l.cls }));
  return box;
}

/** Guirlande : un fil doré en chaînette et quelques ampoules chaudes. */
function garland(reduceMotion) {
  const wrap = document.createElement('div');
  wrap.className = 'xmas-garland';
  wrap.setAttribute('aria-hidden', 'true');
  const count = window.innerWidth >= 1100 ? 9 : 7;
  const W = 1000;
  const sag = 22;
  // Le fil : une suite d'arcs entre des points d'accroche, en haut de la page.
  const anchors = count + 1;
  let d = 'M0 4';
  for (let i = 0; i < anchors; i += 1) {
    const x0 = (i / anchors) * W;
    const x1 = ((i + 1) / anchors) * W;
    d += ` Q${((x0 + x1) / 2).toFixed(1)} ${4 + sag * 2} ${x1.toFixed(1)} 4`;
  }
  const wire = svg('svg', { viewBox: `0 0 ${W} 40`, preserveAspectRatio: 'none', class: 'garland-wire', focusable: 'false' });
  wire.append(svg('path', { d, fill: 'none', stroke: 'rgba(201,164,92,.6)', 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke' }));
  wrap.append(wire);
  for (let i = 0; i < count; i += 1) {
    const bulb = document.createElement('span');
    bulb.className = 'bulb';
    // Au milieu de chaque arc, là où le fil pend le plus bas.
    bulb.style.setProperty('--x', `${((i + 1) / anchors) * 100 - 50 / anchors}%`);
    bulb.style.setProperty('--y', `${4 + sag - 1}px`);
    bulb.style.setProperty('--c', BULB_COLORS[i % BULB_COLORS.length]);
    if (!reduceMotion) bulb.style.setProperty('--d', `${-rand(0, 4).toFixed(2)}s`);
    wrap.append(bulb);
  }
  return wrap;
}

export function installDecor() {
  if (document.querySelector('.xmas')) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const layer = document.createElement('div');
  layer.className = 'xmas';
  layer.setAttribute('aria-hidden', 'true');

  const sky = document.createElement('div');
  sky.className = 'xmas-sky';
  layer.append(sky);

  // Neige légère : peu de flocons, petits et discrets.
  const snow = document.createElement('div');
  snow.className = 'xmas-snow';
  const flakes = window.innerWidth < 400 ? 14 : 20;
  for (let i = 0; i < flakes; i += 1) {
    const flake = document.createElement('span');
    flake.className = 'flake';
    flake.style.setProperty('--size', `${rand(3, 6).toFixed(1)}px`);
    flake.style.setProperty('--x', `${rand(0, 100).toFixed(1)}vw`);
    flake.style.setProperty('--drift', `${rand(-20, 20).toFixed(0)}px`);
    flake.style.setProperty('--dur', `${rand(14, 26).toFixed(1)}s`);
    flake.style.setProperty('--delay', `${-rand(0, 26).toFixed(1)}s`);
    flake.style.setProperty('--y', `${rand(55, 96).toFixed(1)}vh`); // position fixe si animations réduites
    flake.style.setProperty('--o', rand(0.3, 0.6).toFixed(2));
    snow.append(flake);
  }
  layer.append(snow);
  layer.append(horizon());

  document.body.prepend(layer);
  // Pas de guirlande sur la page organisateur (page de travail).
  if (!location.pathname.startsWith('/admin')) document.body.prepend(garland(reduceMotion));
}

if (document.body) installDecor();
else document.addEventListener('DOMContentLoaded', installDecor);
