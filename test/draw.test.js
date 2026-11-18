import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawAssignments } from '../src/draw.js';

function assertValid(ids, exclusions, result) {
  assert.ok(result, 'un tirage devait être trouvé');
  assert.equal(result.size, ids.length);
  const receivers = new Set(result.values());
  assert.equal(receivers.size, ids.length, 'chacun reçoit exactement une fois');
  const forbidden = new Set(exclusions.flatMap(([a, b]) => [`${a}>${b}`, `${b}>${a}`]));
  for (const id of ids) {
    const r = result.get(id);
    assert.ok(ids.includes(r));
    assert.notEqual(r, id, 'personne ne se tire soi-même');
    assert.ok(!forbidden.has(`${id}>${r}`), 'exclusion respectée');
  }
}

test('tirage valide sans exclusion, pour toutes les tailles de 2 à 60', () => {
  for (let n = 2; n <= 60; n++) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    for (let k = 0; k < 20; k++) assertValid(ids, [], drawAssignments(ids));
  }
});

test('exclusions respectées', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const exclusions = [['a', 'b'], ['c', 'd'], ['e', 'f']];
  for (let k = 0; k < 500; k++) assertValid(ids, exclusions, drawAssignments(ids, exclusions));
});

test('beaucoup d’exclusions : le repli par couplage trouve une solution', () => {
  // 'x' ne peut offrir qu'à 'y' (et inversement le seul donneur de 'x' est 'z')
  const ids = ['x', 'y', 'z', 'w', 'v'];
  const exclusions = [['x', 'z'], ['x', 'w'], ['x', 'v'], ['y', 'w'], ['y', 'v']];
  for (let k = 0; k < 200; k++) assertValid(ids, exclusions, drawAssignments(ids, exclusions));
});

test('tirage impossible détecté', () => {
  assert.equal(drawAssignments(['a', 'b', 'c'], [['a', 'b'], ['a', 'c']]), null);
  assert.equal(drawAssignments(['a', 'b'], [['a', 'b']]), null);
  assert.equal(drawAssignments(['a']), null);
  assert.equal(drawAssignments([]), null);
});

test('le tirage est aléatoire et couvre les solutions possibles', () => {
  // Avec 4 personnes il existe 9 dérangements : on doit tous les voir.
  const ids = ['a', 'b', 'c', 'd'];
  const seen = new Map();
  for (let k = 0; k < 4000; k++) {
    const r = drawAssignments(ids);
    const key = ids.map((id) => r.get(id)).join('');
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  assert.equal(seen.size, 9);
  for (const count of seen.values()) assert.ok(count > 300 && count < 600, `distribution déséquilibrée : ${count}`);
});

test('identifiants en double refusés', () => {
  assert.throws(() => drawAssignments(['a', 'a', 'b']));
});
