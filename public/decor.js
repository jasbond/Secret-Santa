// Décor de Noël en arrière-plan : ciel d'hiver, guirlande lumineuse, neige qui tombe,
// forêt vivante (sapins, animaux, Père Noël dans le ciel, voir forest.js). Purement décoratif (aria-hidden), derrière tout le contenu, sans
// jamais intercepter les clics. Les tailles et positions sont posées via le CSSOM
// (autorisé par la politique de sécurité, contrairement aux attributs style="").

import { installForest } from './forest.js';

const BULB_COLORS = ['#ff4d5e', '#ffd166', '#4fd18b', '#6cb6ff', '#ff9ff3'];

function rand(min, max) {
  return min + Math.random() * (max - min);
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

  // Guirlande : un fil et des ampoules qui scintillent
  const garland = document.createElement('div');
  garland.className = 'xmas-garland';
  const bulbs = Math.max(10, Math.min(28, Math.round(window.innerWidth / 48)));
  for (let i = 0; i < bulbs; i++) {
    const bulb = document.createElement('span');
    bulb.className = 'bulb';
    bulb.style.setProperty('--x', `${((i + 0.5) / bulbs) * 100}%`);
    // Le fil pend : les ampoules du milieu de chaque arc sont plus basses.
    bulb.style.setProperty('--y', `${8 + Math.sin(((i % 4) / 4) * Math.PI) * 10}px`);
    bulb.style.setProperty('--c', BULB_COLORS[i % BULB_COLORS.length]);
    bulb.style.setProperty('--d', `${(i % 5) * 0.35}s`);
    garland.append(bulb);
  }
  layer.append(garland);

  // Flocons de neige
  const snow = document.createElement('div');
  snow.className = 'xmas-snow';
  const flakes = reduceMotion ? 30 : 45;
  for (let i = 0; i < flakes; i++) {
    const flake = document.createElement('span');
    flake.className = 'flake';
    const size = rand(3, 8);
    flake.style.setProperty('--size', `${size}px`);
    flake.style.setProperty('--x', `${rand(0, 100)}vw`);
    flake.style.setProperty('--drift', `${rand(-40, 40)}px`);
    flake.style.setProperty('--dur', `${rand(9, 20)}s`);
    flake.style.setProperty('--delay', `${-rand(0, 20)}s`);
    flake.style.setProperty('--y', `${rand(0, 100)}vh`); // position fixe si animations réduites
    flake.style.setProperty('--o', rand(0.45, 0.95).toFixed(2));
    snow.append(flake);
  }
  layer.append(snow);

  document.body.prepend(layer);
  // La forêt vivante remplace l'ancienne rangée de sapins.
  try {
    installForest(layer, { reduceMotion });
  } catch {
    const trees = document.createElement('div');
    trees.className = 'xmas-trees';
    layer.append(trees);
  }
}

if (document.body) installDecor();
else document.addEventListener('DOMContentLoaded', installDecor);
