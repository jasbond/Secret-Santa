import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawAssignments, drawDetailed, guessableIds } from '../src/draw.js';

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
  // Avec 4 personnes il existe 6 chaînes uniques (3!) : on doit toutes les voir, à parts égales.
  const ids = ['a', 'b', 'c', 'd'];
  const seen = new Map();
  for (let k = 0; k < 4000; k++) {
    const r = drawAssignments(ids);
    const key = ids.map((id) => r.get(id)).join('');
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  assert.equal(seen.size, 6);
  for (const count of seen.values()) assert.ok(count > 550 && count < 800, `distribution déséquilibrée : ${count}`);
});

test('identifiants en double refusés', () => {
  assert.throws(() => drawAssignments(['a', 'a', 'b']));
});

const cycleLength = (m, start) => { let c = m.get(start), k = 1; while (c !== start) { c = m.get(c); k++; } return k; };

test('une seule grande chaîne : ton Père Noël n’est jamais la personne à qui tu offres', () => {
  for (let n = 3; n <= 40; n++) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    for (let k = 0; k < 30; k++) {
      const m = drawAssignments(ids);
      assertValid(ids, [], m);
      assert.equal(cycleLength(m, ids[0]), n, 'tout le monde dans la même chaîne');
    }
  }
  const ids13 = Array.from({ length: 13 }, (_, i) => `p${i}`);
  for (let k = 0; k < 2000; k++) {
    const m = drawAssignments(ids13);
    for (const [g, r] of m) assert.notEqual(m.get(r), g, 'pas d’échange à deux');
  }
});

test('chaîne unique aussi avec des exclusions, quand c’est possible', () => {
  const ids = Array.from({ length: 13 }, (_, i) => `p${i}`);
  const exclusions = [['p0', 'p1'], ['p2', 'p3'], ['p4', 'p5'], ['p0', 'p6'], ['p7', 'p8']];
  for (let k = 0; k < 300; k++) {
    const m = drawAssignments(ids, exclusions);
    assertValid(ids, exclusions, m);
    assert.equal(cycleLength(m, 'p0'), 13);
  }
  // Recherche systématique : x ne peut offrir qu'à y, y qu'à z, et ainsi de suite
  const few = ['a', 'b', 'c', 'd', 'e'];
  const ex = [['a', 'c'], ['a', 'd'], ['b', 'd'], ['b', 'e'], ['c', 'e']];
  for (let k = 0; k < 100; k++) {
    const m = drawAssignments(few, ex);
    assertValid(few, ex, m);
    assert.equal(cycleLength(m, 'a'), 5);
  }
});

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i}`);
const hasMutual = (m) => [...m].some(([g, r]) => m.get(r) === g);
/** Groupes séparés : chacun ne peut tirer que dans son groupe. */
function blocks(sizes) {
  const all = ids(sizes.reduce((a, b) => a + b));
  const group = sizes.flatMap((s, i) => Array(s).fill(i));
  const exclusions = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) if (group[i] !== group[j]) exclusions.push([all[i], all[j]]);
  }
  return [all, exclusions];
}

test('chaîne unique impossible : jamais d’échange à deux évitable (groupes séparés)', () => {
  for (const sizes of [[6, 7], [4, 4, 5], [3, 3, 7], [3, 10]]) {
    const [all, exclusions] = blocks(sizes);
    for (let k = 0; k < 100; k++) {
      const r = drawDetailed(all, exclusions);
      assertValid(all, exclusions, r.assignments);
      assert.ok(!hasMutual(r.assignments), `échange à deux évitable (${sizes})`);
      assert.equal(r.kind, 'cycles');
    }
  }
  // 7 personnes : aucune chaîne unique, mais 4 tirages sans échange à deux sur 8
  const L = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const ex7 = 'A-C A-E A-F B-C B-D B-F B-G C-D C-E D-F D-G E-F E-G'.split(' ').map((p) => p.split('-'));
  const ex7b = [[0, 1], [0, 4], [1, 2], [1, 4], [1, 6], [2, 4], [4, 6]].map(([a, b]) => [`p${a}`, `p${b}`]);
  for (let k = 0; k < 1000; k++) {
    const m = drawAssignments(L, ex7);
    assertValid(L, ex7, m);
    assert.ok(!hasMutual(m));
    const m2 = drawAssignments(ids(7), ex7b);
    assertValid(ids(7), ex7b, m2);
    assert.ok(!hasMutual(m2));
  }
});

test('chaîne unique trouvée même dans les grands groupes très contraints', () => {
  // Deux groupes reliés seulement par deux « ponts » : une seule chaîne existe quand même.
  for (const [a, b] of [[8, 8], [10, 10], [20, 20], [50, 50]]) {
    const all = ids(a + b);
    const exclusions = [];
    for (let i = 0; i < a; i++) {
      for (let j = a; j < a + b; j++) if (!((i === 0 && j === a) || (i === 1 && j === a + 1))) exclusions.push([all[i], all[j]]);
    }
    for (let k = 0; k < (a >= 50 ? 3 : 10); k++) {
      const start = Date.now();
      const r = drawDetailed(all, exclusions);
      assert.ok(Date.now() - start < 1000, 'tirage rapide');
      assertValid(all, exclusions, r.assignments);
      assert.equal(r.kind, 'chain');
      assert.equal(cycleLength(r.assignments, all[0]), a + b, `${a}+${b}`);
    }
  }
});

test('échange à deux forcé : seulement la paire inévitable, une chaîne pour les autres', () => {
  // Chloe (p0) ne peut tirer que Welma (p1) : Chloe ↔ Welma est forcé, pas les autres.
  const all = ids(13);
  const exclusions = all.slice(2).map((x) => ['p0', x]);
  for (let k = 0; k < 100; k++) {
    const r = drawDetailed(all, exclusions);
    assertValid(all, exclusions, r.assignments);
    assert.deepEqual(r.mutualPairs, [['p0', 'p1']]);
    assert.equal(cycleLength(r.assignments, 'p2'), 11);
  }
});

test('échange à deux inévitable : signalé dans mutualPairs', () => {
  // B et C ne peuvent offrir qu'à A ou entre eux, D et E aussi : une paire est forcée.
  const five = ['A', 'B', 'C', 'D', 'E'];
  const ex = [['B', 'D'], ['B', 'E'], ['C', 'D'], ['C', 'E']];
  for (let k = 0; k < 50; k++) {
    const r = drawDetailed(five, ex);
    assertValid(five, ex, r.assignments);
    assert.equal(r.kind, 'mutual');
    assert.equal(r.mutualPairs.length, 1);
  }
  const r = drawDetailed(['a', 'b', 'c', 'd'], [['a', 'c'], ['a', 'd']]);
  assert.deepEqual(r.mutualPairs, [['a', 'b'], ['c', 'd']]);
});

test('Père Noël devinable : signalé quand le tirage le révèle', () => {
  assert.deepEqual(guessableIds(ids(4)), []);
  assert.deepEqual(guessableIds(ids(3)), []); // à 3, inévitable : signalé à part
  // 4 personnes, un couple exclu : seulement 2 chaînes, tout le monde devine
  assert.deepEqual(guessableIds(ids(4), [['p0', 'p1']]), ids(4));
  // 5 personnes, un couple exclu : 12 chaînes, rien de devinable
  assert.deepEqual(guessableIds(ids(5), [['p0', 'p1']]), []);
  for (let n = 6; n <= 13; n++) assert.deepEqual(guessableIds(ids(n), [['p0', 'p1'], ['p2', 'p3'], ['p4', 'p5']]), []);
  // 13 personnes : p0 n'a plus que p1 et p2 possibles → reçoit de l'un, offre à l'autre
  const all = ids(13);
  assert.deepEqual(guessableIds(all, all.slice(3).map((x) => ['p0', x])), ['p0']);
  // p0 ne peut tirer que p1 : p1 est forcée aussi
  assert.deepEqual(guessableIds(all, all.slice(2).map((x) => ['p0', x])), ['p0', 'p1']);
  // 5 personnes en anneau (2 possibles chacune)
  assert.deepEqual(guessableIds(['a', 'b', 'c', 'd', 'e'], [['a', 'c'], ['a', 'd'], ['b', 'd'], ['b', 'e'], ['c', 'e']]), ['a', 'b', 'c', 'd', 'e']);
});
