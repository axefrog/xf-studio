// The control arms of M3 (D23 5.4.1): A1 random within gates, A3 the Radiant-style baseline, A4 the authored seed.
// The definitions are in dossier 23 and were written before this file. A3 reads the world only for who lives near V, what
// they do for a living and where the venues are; it reads no event, no history, no reputation, no norm and no heat.

import { rand, s as hs, id as hid, i as hi } from '../id.ts';
import type { Layer3Data } from '../procedural/types.ts';
import type { Id } from '../types.ts';
import type { Sim } from '../sim/sim.ts';
import type { M3World } from './world.ts';

/** A1: the engine's ranked draw made uniform. Everything else (gates, patterns, kits) is the engine's. */
export function randomWithinGates(base: Layer3Data): Layer3Data {
  const d = structuredClone(base);
  d.sower.lambda = 0;
  d.sower.diversity = 0;
  d.sower.kitDiversity = 0;
  return d;
}

// ---- A3 ----

interface Template {
  id: string;
  tier: 1 | 2 | 3;
  /** Which slots it needs: a client always; `other` a second person; `place` a venue; `place2` a second one; `item`. */
  needs: Array<'other' | 'place' | 'place2' | 'item'>;
  other?: 'gang' | 'any';
  text: string;
}

export const TEMPLATES: Template[] = [
  { id: 'delivery', tier: 1, needs: ['other', 'place'], text: '{client}, a {clientRole}, has a sealed case that has to get from {place} to {other} before closing. {reward} eddies on delivery, no questions.' },
  { id: 'recovery', tier: 2, needs: ['item', 'place'], text: 'Someone took {client}\'s {item} near {place}. {client} wants it back and does not care how. {reward} eddies when it is returned.' },
  { id: 'escort', tier: 1, needs: ['place', 'place2'], text: '{client} has to cross Kabuki after dark and does not want to go alone. Walk with {client} from {place} to {place2}. {reward} eddies.' },
  { id: 'removal', tier: 3, needs: ['other'], other: 'gang', text: '{client} wants {other}, a {otherRole}, out of the neighbourhood. Convince them. {reward} eddies.' },
  { id: 'debt', tier: 2, needs: ['other', 'place'], text: '{other} owes {client} money and has stopped answering. Collect it from {other}, who drinks near {place}. You keep a cut: {reward} eddies.' },
  { id: 'missing', tier: 2, needs: ['other'], text: '{client} has not heard from {other} in three days. Find out where {other} went. {reward} eddies.' },
  { id: 'tail', tier: 2, needs: ['other', 'place'], text: '{client} thinks {other} is meeting someone at {place}. Follow {other} and report who it is. {reward} eddies.' },
  { id: 'repair', tier: 1, needs: ['place'], text: 'The terminal at {client}\'s stall near {place} has died. Get it running before the evening crowd. {reward} eddies.' },
];

const REWARD = { 1: 250, 2: 500, 3: 1000 } as const;
const ITEMS = ['credstick', 'cyberdeck', 'jacket', 'data shard'];
const ROLE_WORD: Record<string, string> = {
  vendor: 'stallholder', shopkeeper: 'shopkeeper', service: 'service worker', nightlife: 'club worker', labourer: 'labourer', technician: 'technician',
  corporate: 'corporate', gang: 'gang member', police: 'police officer', student: 'student', unemployed: 'out-of-work resident', retired: 'retired resident',
};
const PLACE_WORD: Record<string, string> = { vendor: 'the market stalls', bar: 'a bar off the market', clinic: 'the clinic', safehouse: 'a safehouse', lodging: 'a capsule hotel', ripperdoc: 'the ripperdoc', 'fast-travel': 'the metro entrance' };
const CLIENT_ROLES = new Set(['vendor', 'shopkeeper', 'service', 'nightlife', 'technician', 'labourer', 'retired']);

/** The nearest cells to V in order: its own block, the blocks next to it, then those two steps away (S1's index). */
function nearCells(sim: Sim, cell: Id): Id[][] {
  const c = sim.w.index.cells[cell]!;
  return [[cell], [...c.adj1].sort(), [...c.adj2].sort()];
}

export interface Radiant { template: string; text: string; names: string[] }

/**
 * Which slot rule fills a job.
 * - `declared`: dossier 23 5.4.1, the rule for every run from now on. Each slot takes the nearest eligible resident or place:
 *   residents of V's own block first, then the blocks next to it, then those two steps away, the first eligible by the slot's
 *   role class; ties go to the smaller identifier. Places are ordered the same way (ring, then service identifier) and the
 *   second place of an escort is the next distinct one.
 * - `rated-v1`: the rule the rated M3 packet was built with, frozen so that packet rebuilds byte for byte. It differs from the
 *   declaration: a keyed draw among the first four of the nearest ring stands in for "the first, ties by identifier", and the
 *   places pool every ring and then the whole district before the draw. It is a recorded deviation of the rated run (results.md,
 *   dossier 23 5.4.1), not a second definition of A3.
 */
export type SlotRule = 'declared' | 'rated-v1';

/** One A3 job for the draw `n` of the run `key`, around V at `cellName`. Returns undefined if no template can be filled. */
export function radiantJob(world: M3World, nameOf: (id: Id) => string, key: string, n: number, cellName = 'g1', rule: SlotRule = 'declared'): Radiant | undefined {
  const sim = world.sim;
  const cell = sim.w.index.names?.[cellName] ?? cellName;
  const rings = nearCells(sim, cell);
  const draw = (tag: string, ...rest: number[]): number => rand(hs('m3-a3'), hs(key), hi(n), hs(tag), ...rest.map(hi));
  type Person = { id: Id; role: string };
  // residents by distance, each ring in identifier order: the nearest ring with an eligible resident, minus anyone in `not`
  const people = (pred: (role: string, ageBand: number) => boolean, not: Id[] = []): Person[] => {
    for (const ring of rings) {
      const found: Person[] = [];
      for (const c of ring) for (const r of sim.people.residentsOfBlock(c)) {
        const v = sim.people.view(r);
        if (v && v.aband >= 1 && pred(v.role, v.aband) && nameOf(r) && !not.includes(r)) found.push({ id: r, role: v.role });
      }
      if (found.length) return found.sort((a, b) => (a.id < b.id ? -1 : 1));
    }
    return [];
  };
  const otherPred = (x: Template) => (role: string): boolean => (x.other === 'gang' ? role === 'gang' : true);
  const clients = people((role) => CLIENT_ROLES.has(role));
  let t: Template;
  let client: Person;
  let other: Person | undefined;
  let place: string | undefined, place2: string | undefined;
  if (rule === 'declared') {
    // venues by distance (ring, then service identifier), each kind of place once, at its nearest
    const places: string[] = [];
    for (const ring of rings) {
      const svcs = ring.flatMap((c) => sim.w.index.cells[c]!.services).sort((a, b) => (a.id < b.id ? -1 : 1));
      for (const sv of svcs) {
        const word = PLACE_WORD[sv.type];
        if (word !== undefined && !places.includes(word)) places.push(word);
      }
    }
    if (clients.length === 0) return undefined;
    client = clients[0]!;
    const eligible = TEMPLATES.filter((x) => (!x.other || people(otherPred(x), [client.id]).length > 0) && (!x.needs.includes('place') || places.length > 0) && (!x.needs.includes('place2') || places.length > 1));
    if (eligible.length === 0) return undefined;
    t = eligible[Math.floor(draw('template') * eligible.length)]!;
    if (t.needs.includes('other')) other = people(otherPred(t), [client.id])[0]!;
    place = places[0];
    place2 = places[1];
  } else {
    const venues = (): string[] => {
      const out: string[] = [];
      for (const ring of rings) for (const c of ring) for (const sv of sim.w.index.cells[c]!.services) out.push(sv.type);
      for (const c of sim.w.districts[0]!.cellIds) for (const sv of sim.w.index.cells[c]!.services) out.push(sv.type);
      return out;
    };
    const places = [...new Set(venues())].map((x) => PLACE_WORD[x]).filter((x): x is string => x !== undefined);
    const eligible = TEMPLATES.filter((x) => clients.length > 0 && (!x.other || people(otherPred(x)).length > 0) && (!x.needs.includes('place') || places.length > 0) && (!x.needs.includes('place2') || places.length > 1));
    if (eligible.length === 0) return undefined;
    t = eligible[Math.floor(draw('template') * eligible.length)]!;
    const pick = <T,>(list: T[], tag: string): T => list[Math.floor(draw(tag) * Math.min(4, list.length))]!;
    client = pick(clients, 'client');
    if (t.needs.includes('other')) {
      const others = people(otherPred(t)).filter((p) => p.id !== client.id);
      other = pick(others.length ? others : clients.filter((p) => p.id !== client.id), 'other');
    }
    if (t.needs.includes('place')) place = pick(places, 'place');
    if (t.needs.includes('place2')) place2 = pick(places.filter((p) => p !== place), 'place2');
  }
  const slots: Record<string, string> = { client: nameOf(client.id), clientRole: ROLE_WORD[client.role] ?? client.role };
  const names = [slots.client!];
  if (other) {
    slots.other = nameOf(other.id);
    slots.otherRole = ROLE_WORD[other.role] ?? other.role;
    names.push(slots.other);
  }
  if (t.needs.includes('place')) slots.place = place!;
  if (t.needs.includes('place2')) slots.place2 = place2!;
  if (t.needs.includes('item')) slots.item = ITEMS[Math.floor(draw('item') * ITEMS.length)]!;
  const price = sim.reads.eval('priceLevel', [sim.w.index.districts[sim.w.index.cells[cell]!.district]!.key]);
  slots.reward = String(Math.round(REWARD[t.tier] * (price === 'dear' ? 1.2 : price === 'cheap' ? 0.8 : 1)));
  const text = t.text.replace(/\{([A-Za-z0-9]+)\}/g, (_m, k: string) => slots[k] ?? `[${k}]`);
  return { template: t.id, text, names };
}

export { hid };
