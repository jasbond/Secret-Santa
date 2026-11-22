// Fond de la forêt vivante : sapins enneigés, chouette sur sa branche, renne qui marche
// puis broute, renard qui trotte et renifle, lapin qui bondit, oiseaux, et le Père Noël
// qui traverse le ciel de temps en temps. Purement décoratif (aria-hidden), derrière tout.
// Pas d'attribut style="" (refusé par la politique de sécurité) : tout passe par les
// classes de forest.css et le CSSOM.

const rnd = (i, n) => ((i * 9301 + 49297) % 233280) / 233280 * n; // pseudo-aléatoire stable
// Sapin réaliste : plusieurs étages de branches tombantes, lumière à gauche, ombre à droite,
// neige posée au bout des branches. Plus il est loin, plus il est pâle et bleuté.
const TONES = { '#1b4538': 'far', '#173f33': 'far', '#145a3a': 'mid', '#0f5132': 'near', '#0f4d30': 'near' };
function tree(x, y, s, c) {
  const tone = TONES[c] || 'mid';
  const tiers = 5;
  let g = `<rect x="-3.2" y="-6" width="6.4" height="14" rx="1.5" fill="${tone === 'far' ? '#3c3f4a' : '#3b2414'}"/>`;
  for (let i = 0; i < tiers; i++) {
    const bot = -i * 13, top = bot - 30 + i * 1.5, hw = 31 - i * 6;
    const tip = (k) => `${(hw * k).toFixed(1)}`;
    // étage de branches : bord du bas en festons (bouts de branches qui tombent)
    g += `<path d="M0 ${top} C ${tip(0.35)} ${top + 10} ${tip(0.7)} ${bot - 8} ${hw} ${bot}
      Q ${tip(0.78)} ${bot - 3} ${tip(0.62)} ${bot + 2} Q ${tip(0.45)} ${bot - 4} ${tip(0.28)} ${bot + 3} Q ${tip(0.12)} ${bot - 3} 0 ${bot + 2}
      Q ${tip(-0.12)} ${bot - 3} ${tip(-0.28)} ${bot + 3} Q ${tip(-0.45)} ${bot - 4} ${tip(-0.62)} ${bot + 2} Q ${tip(-0.78)} ${bot - 3} ${-hw} ${bot}
      C ${tip(-0.7)} ${bot - 8} ${tip(-0.35)} ${top + 10} 0 ${top} Z" fill="url(#pine-${tone})"/>`;
    // neige au bout des branches (surtout du côté éclairé)
    g += `<path d="M${-hw} ${bot} Q ${tip(-0.78)} ${bot - 3} ${tip(-0.62)} ${bot + 2} Q ${tip(-0.45)} ${bot - 4} ${tip(-0.28)} ${bot + 3} Q ${tip(-0.12)} ${bot - 3} 0 ${bot + 2}
      Q ${tip(0.2)} ${bot - 2} ${tip(0.4)} ${bot + 1} L ${tip(0.35)} ${bot - 3.5} Q 0 ${bot - 7} ${tip(-0.4)} ${bot - 4} Q ${tip(-0.75)} ${bot - 6} ${-hw} ${bot} Z" fill="url(#snow-${tone})"/>`;
  }
  // petit chapeau de neige au sommet
  const topY = -(tiers - 1) * 13 - 30 + (tiers - 1) * 1.5;
  g += `<path d="M0 ${topY - 1} L -5 ${topY + 9} Q 0 ${topY + 6} 5 ${topY + 9} Z" fill="url(#snow-${tone})"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s * 0.9})">${g}</g>`;
}

// ---------- Forêt vivante : une seule scène SVG, animaux posés sur la neige ----------
// La largeur de la scène suit celle de l'écran (téléphone ou ordinateur) : rien n'est
// coupé et les animaux marchent toujours sur le sol, à la bonne taille.
const GROUND = 252; // ligne où marchent les animaux (dans le dessin)
const DEER_G = `
  <g class="leg a"><rect x="10" y="32" width="4" height="19" rx="2" fill="#6e4320"/><rect x="9.5" y="49" width="5" height="3" rx="1" fill="#2a180c"/></g>
  <g class="leg b"><rect x="35" y="32" width="4" height="19" rx="2" fill="#6e4320"/><rect x="34.5" y="49" width="5" height="3" rx="1" fill="#2a180c"/></g>
  <ellipse cx="5" cy="23" rx="3.5" ry="2.5" fill="#fff"/><ellipse cx="25" cy="27" rx="21" ry="10.5" fill="#8b5a2b"/><ellipse cx="25" cy="32" rx="13" ry="4" fill="#c89a6a"/>
  <g class="leg b"><rect x="14" y="31" width="4" height="20" rx="2" fill="#8b5a2b"/><rect x="13.5" y="49" width="5" height="3" rx="1" fill="#2a180c"/></g>
  <g class="leg a"><rect x="39" y="31" width="4" height="20" rx="2" fill="#8b5a2b"/><rect x="38.5" y="49" width="5" height="3" rx="1" fill="#2a180c"/></g>
  <g class="graze"><polygon points="36,22 43,6 51,8 45,27" fill="#8b5a2b"/>
  <path d="M46 3 L43 -7 M43 -7 L39 -10 M43 -7 L45 -13 M50 3 L53 -7 M53 -7 L50 -12 M53 -7 L58 -10" stroke="#6b4a2b" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  <ellipse cx="44" cy="3" rx="3.5" ry="1.6" fill="#7a4b22" transform="rotate(-25 44 3)"/>
  <ellipse cx="51" cy="8" rx="8.5" ry="5.5" fill="#8b5a2b"/><ellipse cx="58" cy="10" rx="4.5" ry="3.2" fill="#a87545"/><circle cx="62" cy="9.5" r="2.8" fill="#e8202f"/><circle cx="51" cy="6" r="1.1" fill="#1b120c"/></g>`;
const FOX_G = `
  <path d="M8 20 Q 0 6 16 4 Q 24 4 26 16 Q 16 22 8 20 Z" fill="#e2762b"/><path d="M8 20 Q 4 12 9 8 Q 12 14 14 19 Z" fill="#fff"/>
  <g class="leg a"><rect x="24" y="26" width="4" height="15" rx="2" fill="#3a2418"/></g><g class="leg b"><rect x="50" y="26" width="4" height="15" rx="2" fill="#3a2418"/></g>
  <ellipse cx="40" cy="22" rx="20" ry="9" fill="#e2762b"/><ellipse cx="44" cy="26" rx="10" ry="4" fill="#fff3e6"/>
  <g class="leg b"><rect x="28" y="26" width="4" height="15" rx="2" fill="#2a1a12"/></g><g class="leg a"><rect x="54" y="26" width="4" height="15" rx="2" fill="#2a1a12"/></g>
  <g class="fox-head"><path d="M56 18 L 66 8 L 80 18 L 66 24 Z" fill="#e2762b"/><path d="M70 20 L 80 18 L 72 24 Z" fill="#fff"/><polygon points="62,10 64,1 68,9" fill="#e2762b"/><polygon points="66,9 70,1 71,10" fill="#c45e1c"/>
  <circle cx="80" cy="18" r="1.6" fill="#222"/><circle cx="68" cy="14" r="1.1" fill="#222"/></g>`;
const RABBIT_G = `<g class="rab"><ellipse cx="18" cy="26" rx="13" ry="10" fill="#f4f4f8"/><circle cx="6" cy="24" r="4" fill="#fff"/><circle cx="31" cy="18" r="7" fill="#f4f4f8"/>
  <ellipse cx="29" cy="6" rx="2.6" ry="8" fill="#f4f4f8" transform="rotate(-12 29 6)"/><ellipse cx="34" cy="6" rx="2.6" ry="8" fill="#f4f4f8" transform="rotate(14 34 6)"/><ellipse cx="34" cy="6" rx="1.2" ry="5.5" fill="#f6c1cc" transform="rotate(14 34 6)"/>
  <circle cx="34" cy="17" r="1.2" fill="#222"/><circle cx="38" cy="19.5" r="1.3" fill="#f39aac"/><ellipse cx="22" cy="35" rx="7" ry="2.5" fill="#e4e4ea"/></g>`;
const OWL_G = `<ellipse cx="23" cy="38" rx="16" ry="19" fill="#8a6a4a"/><ellipse cx="23" cy="42" rx="10" ry="13" fill="#d9c3a2"/>
  <g class="owl-head"><circle cx="23" cy="17" r="15" fill="#8a6a4a"/><polygon points="10,6 13,0 16,6" fill="#8a6a4a"/><polygon points="30,6 33,0 36,6" fill="#8a6a4a"/>
  <g class="owl-eyes"><circle cx="16" cy="17" r="6" fill="#fff"/><circle cx="30" cy="17" r="6" fill="#fff"/><circle cx="16.5" cy="17.5" r="3" fill="#2a1a12"/><circle cx="29.5" cy="17.5" r="3" fill="#2a1a12"/></g>
  <polygon points="23,20 20,24 26,24" fill="#f2b84b"/></g><path d="M15 56 l-3 3 M19 56 l0 4 M27 56 l0 4 M31 56 l3 3" stroke="#f2b84b" stroke-width="2" stroke-linecap="round"/>`;
const BIRD_G = `<g class="flap"><path d="M0 6 Q 8 -2 14 6 Q 20 -2 28 6" stroke="#1b2a44" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>`;


function forestSVG() {
  const W = Math.round(Math.max(520, Math.min(1500, 300 * (window.innerWidth / Math.max(260, window.innerHeight * 0.42)))));
  const r = (i, n) => rnd(i, n);
  let back = '', mid = '', front = '';
  for (let x = 10, i = 0; x < W + 40; x += 62 + r(i, 18), i++) back += tree(x, 150 + r(i * 3, 12), 0.6 + r(i * 5, .25), '#1b4538');
  for (let x = 30, i = 0; x < W + 40; x += 95 + r(i * 7, 40), i++) mid += tree(x, 212 + r(i * 2, 10), 0.85 + r(i * 11, .3), '#145a3a');
  // Quelques sapins devant : les animaux passent derrière, ça donne de la profondeur
  for (let x = 120, i = 0; x < W; x += 260 + r(i * 13, 120), i++) front += tree(x, 292, 1.15 + r(i * 17, .25), '#0f4d30');
  const owlTreeX = Math.round(W * 0.12);
  return `<svg class="forest" viewBox="0 0 ${W} 300" preserveAspectRatio="xMidYMax meet" aria-hidden="true" data-w="${W}"><defs>
  <linearGradient id="pine-far" x1="0" x2="1"><stop offset="0" stop-color="#4f7d82"/><stop offset=".55" stop-color="#3b676d"/><stop offset="1" stop-color="#2c5359"/></linearGradient>
  <linearGradient id="pine-mid" x1="0" x2="1"><stop offset="0" stop-color="#2f7350"/><stop offset=".55" stop-color="#1f5a3d"/><stop offset="1" stop-color="#15452e"/></linearGradient>
  <linearGradient id="pine-near" x1="0" x2="1"><stop offset="0" stop-color="#256445"/><stop offset=".55" stop-color="#174b32"/><stop offset="1" stop-color="#0d3523"/></linearGradient>
  <linearGradient id="snow-far" x1="0" x2="1"><stop offset="0" stop-color="#e6eef8"/><stop offset="1" stop-color="#b9c8dc"/></linearGradient>
  <linearGradient id="snow-mid" x1="0" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfdcee"/></linearGradient>
  <linearGradient id="snow-near" x1="0" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d6e2f2"/></linearGradient>
</defs>
    <path d="M0 150 Q ${W * .18} 108 ${W * .36} 140 T ${W * .72} 128 T ${W} 140 L ${W} 300 L 0 300 Z" fill="#c9d8ee"/>
    ${back}
    <path d="M0 212 Q ${W * .2} 175 ${W * .45} 205 T ${W} 200 L ${W} 300 L 0 300 Z" fill="#e3ecf8"/>
    ${mid}
    <!-- Arbre nu avec la chouette sur sa branche -->
    <g transform="translate(${owlTreeX} 0)">
      <path d="M-7 ${GROUND} L -5 120 Q 0 100 6 120 L 8 ${GROUND} Z" fill="#4a3020"/>
      <path d="M0 165 Q 30 150 58 152" stroke="#4a3020" stroke-width="6" stroke-linecap="round" fill="none"/>
      <path d="M0 140 Q -25 120 -45 118" stroke="#4a3020" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path d="M2 125 Q 18 100 30 92" stroke="#4a3020" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M8 160 Q 30 148 56 150" stroke="#f4f8ff" stroke-width="2.5" stroke-linecap="round" fill="none"/>
      <path d="M-3 136 Q -25 117 -43 115" stroke="#f4f8ff" stroke-width="2" stroke-linecap="round" fill="none"/>
      <g transform="translate(20 92) scale(.95)">${OWL_G}</g>
    </g>
    <path d="M0 246 Q ${W * .3} 238 ${W * .55} 246 T ${W} 244 L ${W} 300 L 0 300 Z" fill="#f2f6fd"/>
    <g id="an-fox" class="animal fox">${FOX_G}</g>
    <g id="an-deer" class="animal deer">${DEER_G}</g>
    <g id="an-rabbit" class="animal rabbit">${RABBIT_G}</g>
    ${front}
    <path d="M0 278 Q ${W * .3} 268 ${W * .6} 278 T ${W} 274 L ${W} 300 L 0 300 Z" fill="#f8fbff"/>
    <g class="cross bird b1"><g transform="translate(0 60)">${BIRD_G}</g></g>
    <g class="cross bird rtl b2"><g transform="translate(0 86) scale(.8)">${BIRD_G}</g></g>
  </svg>`;
}


// Traîneau détaillé (le même que l'animation du prénom)
const deerSvg = (x, y, rudolph, late) => `
<g transform="translate(${x} ${y})"><g class="bob${late ? ' late' : ''}">
  <g class="leg a"><rect x="10" y="32" width="4" height="19" rx="2" fill="#7a4b22"/><rect x="9.5" y="49" width="5" height="3.5" rx="1" fill="#3b2414"/></g>
  <g class="leg b"><rect x="35" y="32" width="4" height="19" rx="2" fill="#7a4b22"/><rect x="34.5" y="49" width="5" height="3.5" rx="1" fill="#3b2414"/></g>
  <ellipse cx="5" cy="23" rx="3.5" ry="2.5" fill="#fff"/>
  <ellipse cx="25" cy="27" rx="21" ry="10.5" fill="#8b5a2b"/>
  <ellipse cx="25" cy="32" rx="13" ry="4" fill="#c89a6a"/>
  <g class="leg b"><rect x="14" y="31" width="4" height="20" rx="2" fill="#8b5a2b"/><rect x="13.5" y="49" width="5" height="3.5" rx="1" fill="#3b2414"/></g>
  <g class="leg a"><rect x="39" y="31" width="4" height="20" rx="2" fill="#8b5a2b"/><rect x="38.5" y="49" width="5" height="3.5" rx="1" fill="#3b2414"/></g>
  <polygon points="36,22 43,6 51,8 45,27" fill="#8b5a2b"/>
  <path d="M46 3 L43 -7 M43 -7 L39 -10 M43 -7 L45 -13 M50 3 L53 -7 M53 -7 L50 -12 M53 -7 L58 -10" stroke="#6b4a2b" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  <ellipse cx="44" cy="3" rx="3.5" ry="1.6" fill="#7a4b22" transform="rotate(-25 44 3)"/>
  <ellipse cx="51" cy="8" rx="8.5" ry="5.5" fill="#8b5a2b"/>
  <ellipse cx="58" cy="10" rx="4.5" ry="3.2" fill="#a87545"/>
  <circle cx="62" cy="9.5" r="${rudolph ? 2.8 : 2}" fill="${rudolph ? '#e8202f' : '#3b2414'}"${rudolph ? ' class="rudolph"' : ''}/>
  <circle cx="51" cy="6" r="1.1" fill="#1b120c"/>
  <path d="M38 21 Q 44 25 49 13" stroke="#c8283b" stroke-width="2.5" fill="none"/>
  <circle cx="44" cy="22.5" r="1.6" fill="#f2b84b"/>
</g></g>`;

// Le Père Noël dans son traîneau, tiré par deux rennes (Rudolph devant).
const SLEIGH_FULL = `<svg viewBox="-6 -26 250 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M70 38 Q 100 46 132 30 M70 38 Q 140 44 198 28" stroke="#5a3a1e" stroke-width="1.4" fill="none"/>
  ${deerSvg(112, 6, false, true)}
  ${deerSvg(176, 4, true, false)}
  <g class="santa">
    <rect x="8" y="6" width="16" height="14" rx="2" fill="#1f6b47"/><rect x="14.5" y="6" width="3" height="14" fill="#f2b84b"/><rect x="8" y="11.5" width="16" height="3" fill="#f2b84b"/>
    <rect x="20" y="10" width="12" height="10" rx="2" fill="#3a6fd8"/><rect x="25" y="10" width="2.5" height="10" fill="#fff"/>
    <ellipse cx="44" cy="22" rx="14" ry="12" fill="#d32f3f"/>
    <rect x="31" y="24" width="26" height="4" rx="1.5" fill="#2a1a14"/><rect x="42" y="23.5" width="5" height="5" rx="1" fill="#f2b84b"/>
    <path d="M52 18 Q 60 20 68 33" stroke="#d32f3f" stroke-width="6" stroke-linecap="round" fill="none"/>
    <circle cx="69" cy="35" r="3.6" fill="#1f6b47"/>
    <circle cx="47" cy="3" r="8.5" fill="#f5c9a8"/>
    <path d="M38 5 Q 40 18 48 19 Q 57 18 56 5 Q 52 10 47 9 Q 42 10 38 5 Z" fill="#fff"/>
    <ellipse cx="47" cy="8.5" rx="4.5" ry="1.8" fill="#fff"/>
    <circle cx="50" cy="1" r="1.1" fill="#1b120c"/><circle cx="53" cy="5" r="1.8" fill="#f29a9a" opacity=".7"/>
    <path d="M38 -1 Q 44 -20 62 -12 L 57 -3 Z" fill="#d32f3f"/>
    <rect x="37" y="-4" width="21" height="5" rx="2.5" fill="#fff"/><circle cx="63" cy="-12" r="3.4" fill="#fff"/>
  </g>
  <path d="M2 22 L2 44 Q 2 50 9 50 L 80 50 Q 90 50 93 38 L 96 24 Q 84 30 72 25 L 72 22 Z" fill="#c8283b" stroke="#9c1b2b" stroke-width="1.5"/>
  <path d="M6 27 L 70 27" stroke="#f2b84b" stroke-width="2"/><path d="M10 40 Q 40 46 86 38" stroke="#f2b84b" stroke-width="1.5" fill="none"/>
  <path d="M12 50 L 12 58 M 78 50 L 78 58" stroke="#c9a45c" stroke-width="2.5"/>
  <path d="M-4 56 Q 4 62 16 60 L 86 60 Q 100 60 102 48" stroke="#e0b450" stroke-width="3.5" stroke-linecap="round" fill="none"/>
</svg>`;



// ---------- Comportement des animaux de la forêt ----------
// Chacun a sa façon de bouger : le renne marche puis s'arrête pour brouter, le renard trotte
// et s'arrête pour renifler, le lapin fait quelques bonds puis s'assoit. Quand un animal
// sort de l'écran, il revient un peu plus tard dans l'autre sens.
const FOREST_ANIMALS = {
  deer: { footY: 52, scale: 1.35, w: 64, ground: 252, speed: 20, x: 0.22, dir: 1 },
  fox: { footY: 41, scale: 0.8, w: 82, ground: 226, speed: 46, x: 0.7, dir: -1 },
  rabbit: { footY: 37.5, scale: 1.05, w: 44, ground: 270, speed: 0, x: 0.5, dir: -1 },
};

let forestW = 1100;
const states = {};
const between = (a, b) => a + Math.random() * (b - a);
function initAnimals() {
  for (const [k, a] of Object.entries(FOREST_ANIMALS)) {
    if (!states[k]) states[k] = { x: a.x * forestW, dir: a.dir, mode: k === 'rabbit' ? 'sit' : 'walk', until: performance.now() + between(2000, 5000), hop: 0, hops: 0, hopY: 0 };
    else states[k].x = Math.min(states[k].x, forestW + 100);
  }
}
function nextMode(k, st, now) {
  if (st.mode === 'away') { st.dir = -st.dir; st.mode = k === 'rabbit' ? 'sit' : 'walk'; st.until = now + between(4000, 8000); return; }
  if (k === 'deer') { st.mode = st.mode === 'walk' ? 'graze' : 'walk'; st.until = now + (st.mode === 'walk' ? between(5000, 9000) : between(2500, 4500)); }
  if (k === 'fox') { st.mode = st.mode === 'walk' ? 'sniff' : 'walk'; st.until = now + (st.mode === 'walk' ? between(4000, 7000) : between(1200, 2000)); }
  if (k === 'rabbit') { if (st.mode === 'sit') { st.mode = 'hop'; st.hops = 3 + Math.floor(Math.random() * 3); st.hop = 0; } else { st.mode = 'sit'; st.until = now + between(1500, 3200); } }
}
let lastT = 0;
function tick(now, once = false) {
  const dt = Math.min(0.05, (now - (lastT || now)) / 1000);
  lastT = now;
  for (const [k, a] of Object.entries(FOREST_ANIMALS)) {
    const st = states[k]; const g = document.getElementById(`an-${k}`);
    if (!st || !g) continue;
    if (st.mode !== 'hop' && now > st.until) nextMode(k, st, now);
    if (st.mode === 'walk') st.x += a.speed * st.dir * dt;
    if (st.mode === 'hop') {
      st.hop += dt / 0.42;                      // un bond dure 0,42 s
      st.x += 70 * st.dir * dt;                 // le lapin n'avance qu'en l'air
      st.hopY = Math.sin(Math.min(1, st.hop) * Math.PI) * 16;
      if (st.hop >= 1) { st.hop = 0; st.hopY = 0; st.hops -= 1; if (st.hops <= 0) nextMode(k, st, now); }
    }
    // Sorti de l'écran : il attend un peu, puis revient dans l'autre sens
    if (st.mode !== 'away' && (st.x > forestW + 90 || st.x < -a.w * a.scale - 90)) { st.mode = 'away'; st.until = now + between(2000, 6000); st.hopY = 0; }
    const y = a.ground - a.footY * a.scale - (st.hopY || 0);
    const flip = st.dir < 0 ? ` translate(${a.w * a.scale} 0) scale(-1 1)` : '';
    g.setAttribute('transform', `translate(${st.x.toFixed(1)} ${y.toFixed(1)})${flip} scale(${a.scale})`);
    g.classList.toggle('walking', st.mode === 'walk');
    g.classList.toggle('grazing', st.mode === 'graze');
    g.classList.toggle('sniff', st.mode === 'sniff');
  }
  if (once) return;
  // Onglet caché : on attend qu'il revienne (économise la batterie).
  if (document.hidden) { lastT = 0; document.addEventListener('visibilitychange', () => requestAnimationFrame(tick), { once: true }); return; }
  requestAnimationFrame(tick);
}

let running = false;
/** Ajoute la forêt et le traîneau dans la couche de décor (une seule fois). */
export function installForest(layer, { reduceMotion = false } = {}) {
  if (layer.querySelector('.forest-holder')) return;
  if (!document.querySelector('link[href="/static/forest.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/static/forest.css';
    document.head.append(link);
  }
  const holder = document.createElement('div');
  holder.className = 'forest-holder';
  const draw = () => {
    holder.innerHTML = forestSVG();
    const svg = holder.querySelector('svg');
    forestW = Number(svg.dataset.w) || 1100;
    svg.style.setProperty('--w', String(forestW));
    initAnimals();
    if (reduceMotion) tick(performance.now(), true);
  };
  draw();
  let rt;
  let lastWidth = window.innerWidth;
  // Ne redessine que si la largeur change (sur téléphone, la barre d'adresse change la hauteur en défilant).
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(rt);
    rt = setTimeout(draw, 250);
  });
  layer.append(holder);
  if (!reduceMotion) {
    const sleighEl = document.createElement('div');
    sleighEl.className = 'forest-sleigh';
    sleighEl.innerHTML = SLEIGH_FULL;
    layer.append(sleighEl);
    if (!running) { running = true; requestAnimationFrame(tick); }
  }
}
