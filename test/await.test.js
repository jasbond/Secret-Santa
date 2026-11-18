import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le store est asynchrone : un appel sans await renvoie une promesse, toujours « vraie »
// (ex. if (!store.hasSession(…)) ne refuserait jamais personne). Relecture automatique
// du code : chaque appel asynchrone doit être précédé de await (ou renvoyé tel quel).

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = Object.fromEntries(readdirSync(srcDir).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(path.join(srcDir, f), 'utf8')]));

const storeSrc = files['store.js'];
const asyncNames = new Set([
  ...[...storeSrc.matchAll(/async function (\w+)/g)].map((m) => m[1]),
  ...[...storeSrc.matchAll(/const (\w+) = async\b/g)].map((m) => m[1]),
  'upsertAlbum',
]);
const storeMethods = new Set([...storeSrc.slice(storeSrc.lastIndexOf('return {')).matchAll(/^\s+(\w+),$/gm)].map((m) => m[1]));

/** Le texte qui précède l'appel (sur la même ligne) montre-t-il qu'il est attendu ? */
const isAwaited = (before) => /(?:\bawait|\breturn|=>)\s*\(*\s*$/.test(before);

function unawaited(file, source, pattern) {
  const bad = [];
  source.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    for (const m of line.matchAll(pattern)) {
      const before = line.slice(0, m.index);
      if (/\bfunction\s*$/.test(before)) continue; // définition
      if (!isAwaited(before)) bad.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  });
  return bad;
}

test('la relecture repère bien un appel sans await', () => {
  assert.equal(unawaited('x', '  if (!store.hasSession(p, s)) throw x;', /\bstore\.(\w+)\(/g).length, 1);
  assert.equal(unawaited('x', '  if (!(await store.hasSession(p, s))) throw x;', /\bstore\.(\w+)\(/g).length, 0);
});

test('les méthodes du store sont toutes asynchrones (sauf db)', () => {
  assert.ok(storeMethods.size > 40, [...storeMethods].join(', '));
  for (const name of storeMethods) {
    if (name === 'db') continue;
    assert.ok(asyncNames.has(name), `${name} devrait être asynchrone`);
  }
});

test('chaque appel au store, à la base ou à une transaction est attendu', () => {
  const bad = [];
  for (const [file, source] of Object.entries(files)) {
    // Appels au store (app.js, push.js, index.js), sauf close() suivi de .finally().
    bad.push(...unawaited(file, source.replace(/store\.close\(\)\.finally/g, ''), /\bstore\.(\w+)\(/g));
    // Requêtes : db / q / t (transaction) / t2.
    bad.push(...unawaited(file, source, /\b(?:db|q|t|t2)\.(?:get|all|run|exec|transaction)\(/g));
  }
  // Fonctions asynchrones internes du store.
  const internal = new RegExp(`(?<![\\w.])(?:${[...asyncNames].join('|')})\\(`, 'g');
  bad.push(...unawaited('store.js', storeSrc, internal));
  assert.deepEqual(bad, []);
});
