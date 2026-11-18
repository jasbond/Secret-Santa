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
  return drawDetailed(ids, exclusions)?.assignments ?? null;
}

/**
 * Comme drawAssignments, mais dit aussi comment le tirage a été obtenu :
 *  - kind 'chain'  : une seule grande chaîne (le cas normal) ;
 *  - kind 'cycles' : plusieurs cercles, mais personne n'offre à son propre Père Noël ;
 *  - kind 'mutual' : des échanges à deux (A offre à B et B offre à A) étaient
 *    inévitables ; mutualPairs les liste.
 * @returns {{ assignments: Map<string, string>, kind: string, mutualPairs: Array<[string, string]> } | null}
 */
export function drawDetailed(ids, exclusions = []) {
  if (new Set(ids).size !== ids.length) throw new Error('Identifiants en double');
  if (ids.length < 2) return null;

  const forbidden = new Set();
  for (const [a, b] of exclusions) {
    forbidden.add(pairKey(a, b));
    forbidden.add(pairKey(b, a));
  }
  // Relation symétrique : si a peut offrir à b, b peut offrir à a.
  const allowed = (giver, receiver) => giver !== receiver && !forbidden.has(pairKey(giver, receiver));
  const done = (assignments, kind) => {
    const mutualPairs = mutualPairsOf(assignments);
    return { assignments, kind: mutualPairs.length ? 'mutual' : kind, mutualPairs };
  };

  if (ids.length === 2) {
    const m = drawAny(ids, allowed);
    return m && done(m, 'mutual');
  }

  // Une seule grande chaîne (A → B → C → … → A) : ton Père Noël n'est jamais la personne
  // à qui tu offres. Sinon les deux discussions anonymes se feraient avec la même
  // personne, et le secret se devinerait.
  const cycle = drawSingleCycle(ids, allowed);
  if (cycle) return done(cycle, 'chain');

  // Échanges à deux forcés : quelqu'un qui n'a qu'une seule personne possible lui offre
  // et reçoit d'elle. Ces paires-là seulement sont tolérées ; tous les autres restent
  // dans une chaîne (ou au moins dans des cercles d'au moins 3 personnes).
  const options = new Map(ids.map((id) => [id, ids.filter((r) => allowed(id, r))]));
  const forced = new Map();
  let consistent = true;
  for (const id of ids) {
    if (options.get(id).length !== 1) continue;
    const partner = options.get(id)[0];
    for (const [a, b] of [[id, partner], [partner, id]]) {
      if (forced.has(a) && forced.get(a) !== b) consistent = false;
      forced.set(a, b);
    }
  }
  if (!consistent) return null; // deux personnes n'ont que la même troisième personne possible
  const mutualOk = (g, r) => forced.get(g) === r;
  const rest = ids.filter((id) => !forced.has(id));
  if (forced.size && rest.length >= 3) {
    const restCycle = drawSingleCycle(rest, allowed);
    if (restCycle) {
      for (const [a, b] of forced) restCycle.set(a, b);
      return done(restCycle, 'cycles');
    }
  }
  if (rest.length !== 2) {
    for (let restart = 0; restart < 10; restart++) {
      const cover = drawCover(ids, allowed, mutualOk, 2_000_000);
      if (cover) return done(cover, 'cycles');
      if (cover === false) break; // impossible prouvé (recherche complète)
    }
  }
  const any = drawAny(ids, allowed);
  return any && done(any, 'cycles');
}

/**
 * Personnes dont le Père Noël se devinerait. Le tirage forme une seule chaîne : ton
 * Père Noël et la personne à qui tu offres sont deux personnes différentes parmi tes
 * partenaires possibles (les exclusions sont symétriques). Avec deux partenaires possibles ou moins, voir à qui tu offres révèle
 * ton Père Noël ; l'organisateur, qui voit les exclusions, le devine aussi. Pour les
 * petits groupes, on énumère toutes les chaînes possibles : quelqu'un est signalé si,
 * pour au moins une personne qu'il peut tirer, son Père Noël est alors forcément le même
 * (par exemple 4 personnes dont un couple exclu : seules 2 chaînes sont possibles).
 * @returns {string[]} les identifiants concernés (dans l'ordre de ids)
 */
export function guessableIds(ids, exclusions = []) {
  if (ids.length <= 3) return []; // à 3, c'est inévitable (signalé à part dans l'interface)
  const forbidden = new Set(exclusions.flatMap(([a, b]) => [pairKey(a, b), pairKey(b, a)]));
  const partners = new Map(ids.map((id) => [id, ids.filter((o) => o !== id && !forbidden.has(pairKey(id, o)))]));
  const flagged = new Set();
  for (const id of ids) {
    const list = partners.get(id);
    if (list.length <= 2) flagged.add(id);
    // Une seule personne possible : elle est aussi forcée (elle offre à id et reçoit de id).
    if (list.length === 1) flagged.add(list[0]);
  }
  if (ids.length <= 9) {
    // santas.get(p).get(r) = Pères Noël possibles de p quand p offre à r
    const santas = new Map(ids.map((id) => [id, new Map()]));
    const path = [ids[0]];
    const used = new Set(path);
    const record = () => {
      const n = path.length;
      for (let i = 0; i < n; i++) {
        const byRecipient = santas.get(path[i]);
        const r = path[(i + 1) % n];
        if (!byRecipient.has(r)) byRecipient.set(r, new Set());
        byRecipient.get(r).add(path[(i + n - 1) % n]);
      }
    };
    const extend = () => {
      const last = path[path.length - 1];
      if (path.length === ids.length) {
        if (partners.get(last).includes(ids[0])) record();
        return;
      }
      for (const next of partners.get(last)) {
        if (used.has(next)) continue;
        path.push(next); used.add(next);
        extend();
        path.pop(); used.delete(next);
      }
    };
    extend();
    for (const [id, byRecipient] of santas) {
      if ([...byRecipient.values()].some((s) => s.size === 1)) flagged.add(id);
    }
  }
  return ids.filter((id) => flagged.has(id));
}


/** Les paires [a, b] (a < b) où a offre à b et b offre à a. */
export function mutualPairsOf(assignments) {
  const pairs = [];
  for (const [g, r] of assignments) if (g < r && assignments.get(r) === g) pairs.push([g, r]);
  return pairs;
}

/**
 * Une seule chaîne qui passe par tout le monde. Sans exclusion : un ordre mélangé au
 * hasard (toutes les chaînes sont équiprobables). Avec exclusions : quelques essais au
 * hasard, puis une recherche systématique avec élagage, relancée plusieurs fois depuis
 * des points de départ différents.
 */
function drawSingleCycle(ids, allowed) {
  const n = ids.length;
  const toMap = (order) => new Map(order.map((g, i) => [g, order[(i + 1) % n]]));
  for (let attempt = 0; attempt < 2000; attempt++) {
    const order = shuffle(ids);
    if (order.every((g, i) => allowed(g, order[(i + 1) % n]))) return toMap(order);
  }
  const nb = new Map(ids.map((x) => [x, ids.filter((y) => allowed(x, y))]));
  if (ids.some((x) => nb.get(x).length < 2)) return null;
  for (let restart = 0; restart < 20; restart++) {
    const path = searchCycle(ids, nb, allowed, 1_000_000);
    if (path) return toMap(path);
    if (path === false) return null; // impossible prouvé
  }
  return null;
}

/**
 * Recherche en profondeur d'une chaîne (cycle hamiltonien). Renvoie le chemin, false si
 * la recherche a été complète sans succès, ou null si le budget a été épuisé.
 */
function searchCycle(ids, nb, allowed, workBudget) {
  const n = ids.length;
  const start = ids[randomInt(n)];
  const path = [start];
  const used = new Set(path);
  let budget = workBudget;
  let exhausted = false;

  // Conditions nécessaires pour pouvoir encore fermer la chaîne depuis `last`.
  const feasible = (last) => {
    const rem = ids.filter((x) => !used.has(x));
    budget -= n;
    let fromLast = false, toStart = false;
    for (const r of rem) {
      const list = nb.get(r);
      budget -= list.length;
      let deg = 0, hasLast = false, hasStart = false;
      for (const y of list) {
        if (y === last) hasLast = true;
        if (y === start) hasStart = true;
        if (!used.has(y)) deg++;
      }
      if (hasLast) fromLast = true;
      if (hasStart) toStart = true;
      if (rem.length === 1) return hasLast && hasStart;
      // Chaque personne restante a besoin d'un prédécesseur et d'un successeur.
      const ends = (hasLast ? 1 : 0) + (hasStart && start !== last ? 1 : 0);
      if (deg + ends < 2) return false;
      // Ses deux seuls voisins possibles sont les deux bouts : elle devrait être la dernière.
      if (deg === 0) return false;
    }
    if (!fromLast || !toStart) return false;
    // Les personnes restantes doivent rester reliées entre elles.
    const seen = new Set([rem[0]]);
    const stack = [rem[0]];
    while (stack.length) {
      const x = stack.pop();
      for (const y of nb.get(x)) {
        if (!used.has(y) && !seen.has(y)) { seen.add(y); stack.push(y); }
      }
    }
    return seen.size === rem.length;
  };

  const extend = () => {
    if (--budget < 0) { exhausted = true; return false; }
    const last = path[path.length - 1];
    if (path.length === n) return allowed(last, start);
    if (!feasible(last)) return false;
    const free = (x) => nb.get(x).reduce((k, y) => k + (used.has(y) ? 0 : 1), 0);
    // Heuristique de Warnsdorff : d'abord les personnes qui ont le moins d'options
    // restantes (à égalité, ordre aléatoire).
    const candidates = shuffle(nb.get(last).filter((r) => !used.has(r)))
      .map((r) => [r, free(r)])
      .sort((a, b) => a[1] - b[1]);
    for (const [next] of candidates) {
      path.push(next); used.add(next);
      if (extend()) return true;
      path.pop(); used.delete(next);
      if (exhausted) return false;
    }
    return false;
  };
  if (extend()) return path;
  return exhausted ? null : false;
}

/**
 * Plusieurs cercles sans échange à deux (sauf ceux que mutualOk autorise). Recherche
 * en profondeur qui choisit d'abord le donneur qui a le moins d'options. Renvoie le
 * tirage, false si impossible (recherche complète), null si le budget est épuisé.
 */
function drawCover(ids, allowed, mutualOk, workBudget) {
  const order = shuffle(ids);
  const recv = new Map(); // donneur -> receveur
  const giverOf = new Map(); // receveur -> donneur
  let budget = workBudget;
  let exhausted = false;
  const canGive = (g, r) => !giverOf.has(r) && allowed(g, r) && (recv.get(r) !== g || mutualOk(g, r));

  const go = () => {
    if (recv.size === ids.length) return true;
    if (--budget < 0) { exhausted = true; return false; }
    let best = null, bestCands = null;
    for (const g of order) {
      if (recv.has(g)) continue;
      const cands = order.filter((r) => canGive(g, r));
      budget -= ids.length;
      if (!best || cands.length < bestCands.length) { best = g; bestCands = cands; }
      if (cands.length === 0) return false;
    }
    // Chaque personne qui ne reçoit encore rien doit avoir un donneur possible.
    for (const r of order) {
      if (giverOf.has(r)) continue;
      if (!order.some((g) => !recv.has(g) && canGive(g, r))) return false;
    }
    for (const r of bestCands) {
      recv.set(best, r); giverOf.set(r, best);
      if (go()) return true;
      recv.delete(best); giverOf.delete(r);
      if (exhausted) return false;
    }
    return false;
  };
  if (go()) return recv;
  return exhausted ? null : false;
}

/** Tirage quelconque valide (plusieurs cercles possibles). */
function drawAny(ids, allowed) {
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
