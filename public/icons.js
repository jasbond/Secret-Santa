// Icônes SVG (tracé de Lucide, licence ISC : voir fonts-license.txt) et petites illustrations
// maison. Construites avec createElementNS : ni innerHTML, ni attribut style="" (CSP).
const NS = 'http://www.w3.org/2000/svg';

/* Tracés Lucide (https://lucide.dev), viewBox 0 0 24 24, trait 1.75. */
const PATHS = {
  "gift": [["path",{"d":"M12 7v14"}],["path",{"d":"M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"}],["path",{"d":"M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5"}],["rect",{"x":"3","y":"7","width":"18","height":"4","rx":"1"}]],
  "mail": [["path",{"d":"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"}],["rect",{"x":"2","y":"4","width":"20","height":"16","rx":"2"}]],
  "scroll-text": [["path",{"d":"M15 12h-5"}],["path",{"d":"M15 8h-5"}],["path",{"d":"M19 17V5a2 2 0 0 0-2-2H4"}],["path",{"d":"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"}]],
  "message-circle": [["path",{"d":"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}]],
  "images": [["path",{"d":"m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16"}],["path",{"d":"M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"}],["circle",{"cx":"13","cy":"7","r":"1","fill":"currentColor"}],["rect",{"x":"8","y":"2","width":"14","height":"14","rx":"2"}]],
  "camera": [["path",{"d":"M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"}],["circle",{"cx":"12","cy":"13","r":"3"}]],
  "lock": [["rect",{"width":"18","height":"11","x":"3","y":"11","rx":"2","ry":"2"}],["path",{"d":"M7 11V7a5 5 0 0 1 10 0v4"}]],
  "circle-help": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M9 9.5a3 2.5 0 016 0c0 2-2 2-3 3.5"}],["path",{"d":"M12 17h.01"}]],
  "calendar": [["path",{"d":"M8 2v3"}],["path",{"d":"M16 2v3"}],["rect",{"x":"3","y":"3","width":"18","height":"18","rx":"2"}],["path",{"d":"M3 9h18"}]],
  "info": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],
  "megaphone": [["path",{"d":"M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"}],["path",{"d":"M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"}],["path",{"d":"M8 6v8"}]],
  "key-round": [["path",{"d":"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"}],["circle",{"cx":"16.5","cy":"7.5","r":".5","fill":"currentColor"}]],
  "dices": [["rect",{"width":"12","height":"12","x":"2","y":"10","rx":"2","ry":"2"}],["path",{"d":"m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"}],["path",{"d":"M6 18h.01"}],["path",{"d":"M10 14h.01"}],["path",{"d":"M15 6h.01"}],["path",{"d":"M18 9h.01"}]],
  "users": [["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["path",{"d":"M16 3.128a4 4 0 0 1 0 7.744"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["circle",{"cx":"9","cy":"7","r":"4"}]],
  "settings": [["path",{"d":"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"}],["circle",{"cx":"12","cy":"12","r":"3"}]],
  "trash-2": [["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],
  "ban": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M4.929 4.929 19.07 19.071"}]],
  "save": [["path",{"d":"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{"d":"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{"d":"M7 3v4a1 1 0 0 0 1 1h7"}]],
  "copy": [["rect",{"width":"14","height":"14","x":"8","y":"8","rx":"2","ry":"2"}],["path",{"d":"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"}]],
  "download": [["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],
  "eye": [["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{"cx":"12","cy":"12","r":"3"}]],
  "eye-off": [["path",{"d":"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"}],["path",{"d":"M14.084 14.158a3 3 0 0 1-4.242-4.242"}],["path",{"d":"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"}],["path",{"d":"m2 2 20 20"}]],
  "check": [["path",{"d":"M20 6 9 17l-5-5"}]],
  "check-circle": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m16 9-5.5 5.5L8 12"}]],
  "circle-alert": [["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16"}]],
  "chevron-left": [["path",{"d":"m15 18-6-6 6-6"}]],
  "chevron-right": [["path",{"d":"m9 18 6-6-6-6"}]],
  "chevron-down": [["path",{"d":"m6 9 6 6 6-6"}]],
  "x": [["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],
  "ellipsis": [["circle",{"cx":"12","cy":"12","r":"1"}],["circle",{"cx":"19","cy":"12","r":"1"}],["circle",{"cx":"5","cy":"12","r":"1"}]],
  "bell": [["path",{"d":"M10.268 21a2 2 0 0 0 3.464 0"}],["path",{"d":"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]],
  "send": [["path",{"d":"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"}],["path",{"d":"m21.854 2.147-10.94 10.939"}]],
  "venetian-mask": [["path",{"d":"M18 11c-1.5 0-2.5.5-3 2"}],["path",{"d":"M4 6a2 2 0 0 0-2 2v4a5 5 0 0 0 5 5 8 8 0 0 1 5 2 8 8 0 0 1 5-2 5 5 0 0 0 5-5V8a2 2 0 0 0-2-2h-3a8 8 0 0 0-5 2 8 8 0 0 0-5-2z"}],["path",{"d":"M6 11c1.5 0 2.5.5 3 2"}]],
  "search": [["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],
  "lightbulb": [["path",{"d":"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"}],["path",{"d":"M9 18h6"}],["path",{"d":"M10 22h4"}]],
  "shopping-bag": [["path",{"d":"M16 10a4 4 0 0 1-8 0"}],["path",{"d":"M3.103 6.034h17.794"}],["path",{"d":"M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"}]],
  "hourglass": [["path",{"d":"M5 22h14"}],["path",{"d":"M5 2h14"}],["path",{"d":"M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"}],["path",{"d":"M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"}]],
  "pen-line": [["path",{"d":"M13 21h8"}],["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}]],
  "sun": [["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],
  "arrow-right": [["path",{"d":"M5 12h14"}],["path",{"d":"m12 5 7 7-7 7"}]],
  "link": [["path",{"d":"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"}],["path",{"d":"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"}]],
  "share-2": [["circle",{"cx":"18","cy":"5","r":"3"}],["circle",{"cx":"6","cy":"12","r":"3"}],["circle",{"cx":"18","cy":"19","r":"3"}],["line",{"x1":"8.59","x2":"15.42","y1":"13.51","y2":"17.49"}],["line",{"x1":"15.41","x2":"8.59","y1":"6.51","y2":"10.49"}]],
  "log-out": [["path",{"d":"m16 17 5-5-5-5"}],["path",{"d":"M21 12H9"}],["path",{"d":"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}]],
  "sparkles": [["path",{"d":"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"}],["path",{"d":"M20 2v4"}],["path",{"d":"M22 4h-4"}],["circle",{"cx":"4","cy":"20","r":"2"}]],
  "user-round": [["circle",{"cx":"12","cy":"8","r":"5"}],["path",{"d":"M20 21a8 8 0 0 0-16 0"}]],
  "plus": [["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],
  "image-plus": [["path",{"d":"M16 5h6"}],["path",{"d":"M19 2v6"}],["path",{"d":"M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"}],["path",{"d":"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"}],["circle",{"cx":"9","cy":"9","r":"2"}]],
  "clock": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6l4 2"}]],
  "heart": [["path",{"d":"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"}]],
};

const GOLD = ['#B08A45', '#E6C987', '#B08A45'];
let uid = 0;

function node(tag, attrs = {}, children = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  for (const c of children) n.append(c);
  return n;
}

function goldGradient(id, vertical = false) {
  return node('linearGradient', { id, x1: '0', y1: '0', x2: vertical ? '0' : '1', y2: vertical ? '1' : '0' },
    GOLD.map((c, i) => node('stop', { offset: String(i / (GOLD.length - 1)), 'stop-color': c })));
}

/** Le nœud doré : deux boucles, deux pans et le nœud central. */
function bowParts(fill, edge = '#8E6A2E') {
  const loop = { fill, stroke: edge, 'stroke-width': '0.9', 'stroke-linejoin': 'round' };
  return [
    node('path', { ...loop, d: 'M22.5 18.5 15.5 30.5l4.2-1.6 1.6 3.6 3.9-13.6Z' }),
    node('path', { ...loop, d: 'M25.5 18.5 32.5 30.5l-4.2-1.6-1.6 3.6-3.9-13.6Z' }),
    node('path', { ...loop, d: 'M24 17C19 7.5 7.5 2.5 4.6 8.2 2.2 13 10.5 19.2 24 17Z' }),
    node('path', { ...loop, d: 'M24 17c5-9.5 16.5-14.5 19.4-8.8C45.8 13 37.5 19.2 24 17Z' }),
    node('path', { fill: 'none', stroke: edge, 'stroke-width': '0.8', 'stroke-linecap': 'round', opacity: '0.55', d: 'M22 16.4C16.5 11 10 8.6 8 10.4M26 16.4c5.5-5.4 12-7.8 14-6' }),
    node('ellipse', { ...loop, cx: '24', cy: '17', rx: '4.2', ry: '3.6' }),
  ];
}

const ART = {
  /* Nœud doré (étiquette, cadeau 3D, étape « Emballé ») */
  bow(id) {
    return { viewBox: '0 0 48 34', children: [node('defs', {}, [goldGradient(id)]), ...bowParts(`url(#${id})`)] };
  },
  /* Cadeau emballé, ruban et nœud (accueil, « Qui es-tu ? », attente du tirage) */
  'gift-art'(id) {
    return {
      viewBox: '0 0 96 96',
      children: [
        node('defs', {}, [
          goldGradient(`${id}g`),
          node('linearGradient', { id: `${id}b`, x1: '0', y1: '0', x2: '0', y2: '1' }, [
            node('stop', { offset: '0', 'stop-color': '#B82A3A' }), node('stop', { offset: '1', 'stop-color': '#7E1724' })]),
          node('linearGradient', { id: `${id}l`, x1: '0', y1: '0', x2: '0', y2: '1' }, [
            node('stop', { offset: '0', 'stop-color': '#C9384A' }), node('stop', { offset: '1', 'stop-color': '#A3202F' })]),
        ]),
        node('ellipse', { cx: '48', cy: '88', rx: '34', ry: '4', fill: '#000', opacity: '0.22' }),
        node('rect', { x: '18', y: '44', width: '60', height: '42', rx: '3', fill: `url(#${id}b)` }),
        node('rect', { x: '12', y: '33', width: '72', height: '13', rx: '3', fill: `url(#${id}l)` }),
        node('rect', { x: '12', y: '45', width: '72', height: '2', fill: '#5E0F1A', opacity: '0.35' }),
        node('rect', { x: '43', y: '33', width: '10', height: '53', fill: `url(#${id}g)` }),
        node('g', { transform: 'translate(24 8)' }, bowParts(`url(#${id}g)`)),
        node('path', { d: 'M18 44h60v42H18zM12 33h72v13H12z', fill: 'none', stroke: '#E6C987', 'stroke-opacity': '0.35', 'stroke-width': '1' }),
      ],
    };
  },
  /* Enveloppe timbrée (lettre vide, en-tête de la lettre plein écran) */
  'envelope-art'() {
    return {
      viewBox: '0 0 96 72',
      children: [
        node('rect', { x: '6', y: '10', width: '84', height: '56', rx: '4', fill: '#FBF7EF', stroke: '#C9A45C', 'stroke-width': '1.5' }),
        node('path', { d: 'M8 13l40 28 40-28', fill: 'none', stroke: '#C9A45C', 'stroke-width': '1.5', 'stroke-linejoin': 'round' }),
        node('path', { d: 'M8 64l28-22M88 64 60 42', fill: 'none', stroke: '#E6DCC8', 'stroke-width': '1.5' }),
        node('rect', { x: '66', y: '16', width: '16', height: '19', rx: '1.5', fill: '#A3202F' }),
        node('rect', { x: '68.5', y: '18.5', width: '11', height: '14', rx: '1', fill: 'none', stroke: '#F0D9A6', 'stroke-width': '1' }),
        node('circle', { cx: '48', cy: '41', r: '6.5', fill: '#A3202F' }),
        node('circle', { cx: '48', cy: '41', r: '4', fill: 'none', stroke: '#7E1724', 'stroke-width': '1' }),
      ],
    };
  },
  /* Brin de sapin horizontal (séparateurs, cachet de cire) */
  'fir-sprig'() {
    const needles = [];
    for (let x = 8; x <= 38; x += 5) {
      needles.push(`M${x} 8l-3.6-4.2M${x} 8l-3.6 4.2`);
    }
    return {
      viewBox: '0 0 48 16',
      children: [node('path', { d: `M4 8h38${needles.join('')}M42 8l3-2.6M42 8l3 2.6`, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round' })],
    };
  },
  /* Bonnet de Père Noël (avatar de la discussion avec son Père Noël secret) */
  'santa-hat'() {
    return {
      viewBox: '0 0 24 24',
      children: [
        node('path', { d: 'M4.6 16.4C6.2 9.6 9.6 5.3 14.4 5c3.6-.2 5.4 2.2 5.2 5.4l-1.9.2c-.1-1.6-.9-2.4-2.1-2.2-.6 2.6.2 5.4 1.6 8Z', fill: 'currentColor' }),
        node('circle', { cx: '18.7', cy: '12.2', r: '2.3', fill: 'currentColor' }),
        node('rect', { x: '3', y: '17.6', width: '15.6', height: '3.6', rx: '1.8', fill: 'currentColor' }),
      ],
    };
  },
};

/**
 * icon('gift') → <svg> 20 px, couleur du texte. Avec `label`, l'icône est lue (role="img") ;
 * sinon elle est purement décorative (aria-hidden).
 */
export function icon(name, { size = 20, label, className } = {}) {
  let viewBox = '0 0 24 24';
  let children;
  const art = ART[name];
  if (art) {
    uid += 1;
    ({ viewBox, children } = art(`ic${uid}`));
  } else {
    const parts = PATHS[name];
    if (!parts) throw new Error(`Icône inconnue : ${name}`);
    children = parts.map(([tag, attrs]) => node(tag, attrs));
  }
  const [, , vw, vh] = viewBox.split(' ').map(Number);
  const width = art ? Math.round((size * vw) / Math.max(vw, vh)) : size;
  const height = art ? Math.round((size * vh) / Math.max(vw, vh)) : size;
  const svg = node('svg', {
    viewBox, width, height, focusable: 'false',
    class: `icon icon-${name}${className ? ` ${className}` : ''}`,
    ...(art ? {} : { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  }, children);
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else svg.setAttribute('aria-hidden', 'true');
  return svg;
}
