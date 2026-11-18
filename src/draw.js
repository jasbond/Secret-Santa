import { randomInt } from 'node:crypto';

function shuffle(items) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pairKey = (a, b) => `${a}\u0000${b}`;

/**
 * Tire au sort qui offre à qui.
 *
 * @param {string[]} ids        identifiants des participants (uniques)
 * @param {Array<[string, string]>} exclusions  paires qui ne peuvent pas se tirer
 *                              mutuellement (dans un sens comme dans l'autre)
 * @returns {Map<string, string> | null}  donneur -> receveur, ou null si impossible
 *
 * Garanties : personne ne se tire soi-même, chaque personne donne exactement
 * une fois et reçoit exactement une fois, aucune exclusion n'est violée.
 */
export function drawAssignments(ids, exclusions = []) {
  if (new Set(ids).size !== ids.length) throw new Error('Identifiants en double');
  if (ids.length < 2) return null;

  const forbidden = new Set();
  for (const [a, b] of exclusions) {
    forbidden.add(pairKey(a, b));
    forbidden.add(pairKey(b, a));
  }
  const allowed = (giver, receiver) => giver !== receiver && !forbidden.has(pairKey(giver, receiver));

  // 1) Échantillonnage par rejet : tirage uniforme parmi toutes les solutions
  //    valides. Sans exclusion, ~37 % des permutations conviennent, donc
  //    quelques essais suffisent en pratique.
  for (let attempt = 0; attempt < 5000; attempt++) {
    const receivers = shuffle(ids);
    if (ids.every((giver, i) => allowed(giver, receivers[i]))) {
      return new Map(ids.map((giver, i) => [giver, receivers[i]]));
    }
  }

  // 2) Repli (beaucoup d'exclusions) : couplage biparti aléatoire (algorithme
  //    de Kuhn). Trouve toujours une solution si elle existe.
  const order = shuffle(ids);
  const candidates = new Map(order.map((g) => [g, shuffle(ids.filter((r) => allowed(g, r)))]));
  const giverOf = new Map(); // receveur -> donneur

  const tryAssign = (giver, seen) => {
    for (const receiver of candidates.get(giver)) {
      if (seen.has(receiver)) continue;
      seen.add(receiver);
      if (!giverOf.has(receiver) || tryAssign(giverOf.get(receiver), seen)) {
        giverOf.set(receiver, giver);
        return true;
      }
    }
    return false;
  };

  for (const giver of order) {
    if (!tryAssign(giver, new Set())) return null;
  }
  const result = new Map();
  for (const [receiver, giver] of giverOf) result.set(giver, receiver);
  return result;
}
