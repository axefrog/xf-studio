// The story states of M3: small hand-authored bundles of main-story facts from the curated table, and the street around V.
// A state names real facts only (checked when a run starts), and varies
// the street rather than the story: the gang's money, a crackdown, V's standing with the stalls.
//
// V's history is replayed as the game would report it. The ledger is calibrated for long histories, so a state with a
// history also lowers the ledger's minimum mass (`ledger.m0`) to stand for the weeks that a short run does not play. Every
// such change is a named entry of the state and is printed in the transcript header.

import type { ReplayLine } from '../sim/port.ts';
import type { StoryState } from './driver.ts';

const none = (): ReplayLine[] => [];

/** The stalls' view of V formed by acts: rescues in a public place make friends, harm to bystanders makes wary stalls. */
function acts(kind: 'rescue' | 'harm', count: number): (v: string) => ReplayLine[] {
  return (v) => {
    const out: ReplayLine[] = [{ t: 1, op: 'person', key: 'bystander', slots: { affiliation: 'civilian', alive: 'yes' } }];
    for (let i = 0; i < count; i++) {
      out.push(kind === 'rescue'
        ? { t: 700 + i * 600, op: 'event', kind: 'accident', place: 'g1', participants: [{ who: v, role: 'actor' }, { who: 'bystander', role: 'victim' }], effects: [{ on: 'bystander', effect: 'rescue' }], witnesses: 8 }
        : { t: 700 + i * 600, op: 'event', kind: 'assault', place: 'g1', participants: [{ who: v, role: 'aggressor' }, { who: 'bystander', role: 'victim' }], effects: [{ on: 'bystander', effect: 'harm' }], witnesses: 8 });
    }
    return out;
  };
}

const compressed = { name: 'ledger.m0 = 0.25 (short runs stand for weeks of history)', apply: (d: import('../sim/data.ts').S1Data) => { d.ledger.m0 = 0.25; } };
const calm = { name: 'regimes: none arrive', apply: (d: import('../sim/data.ts').S1Data) => { for (const r of d.regimes) r.arrival = 0; } };
const clawsFlush = { name: 'Tyger Claws books: cash 30000', apply: (d: import('../sim/data.ts').S1Data) => { d.groups.groups[0]!.books.cash = 30_000; } };
const clawsSqueezed = { name: 'Tyger Claws books: cash 200, burn 300', apply: (d: import('../sim/data.ts').S1Data) => { d.groups.groups[0]!.books.cash = 200; } };
const crackdown = { name: 'regimes: a crackdown arrives daily', apply: (d: import('../sim/data.ts').S1Data) => { for (const r of d.regimes) r.arrival = r.kind === 'crackdown' ? 2 : 0; } };

export const STATES: StoryState[] = [
  {
    id: 'S-prologue', note: 'the prologue is done and nothing after it: the seed must wait', history: none, street: [calm],
    facts: { q000_done: 1, q000_street_kid_background: 1 },
  },
  {
    id: 'S-early-quiet', note: 'early in the story, a quiet street, a gang with money', history: none, street: [calm, clawsFlush],
    facts: { q000_done: 1, q001_done: 1, q003_done: 1, q000_nomad_background: 1 },
  },
  {
    id: 'S-mid-squeezed', note: 'mid story, the gang is short of money, V has a name for helping people in public', history: acts('rescue', 24), street: [compressed, calm, clawsSqueezed],
    facts: { q000_done: 1, q001_done: 1, q003_done: 1, q004_done: 1, q005_done: 1, q101_done: 1, q103_done: 1, q000_corpo_background: 1 },
  },
  {
    id: 'S-mid-crackdown', note: 'mid story, police pressing the district, V unknown to the stalls', history: none, street: [crackdown, clawsFlush],
    facts: { q000_done: 1, q001_done: 1, q003_done: 1, q004_done: 1, q005_done: 1, q101_done: 1, q104_done: 1, q105_done: 1, q000_street_kid_background: 1 },
  },
  {
    id: 'S-late-wary', note: 'late in the story, the gang is squeezed and the stalls are wary of V', history: acts('harm', 24), street: [compressed, calm, clawsSqueezed],
    facts: { q000_done: 1, q001_done: 1, q003_done: 1, q004_done: 1, q005_done: 1, q101_done: 1, q103_done: 1, q104_done: 1, q105_done: 1, q108_done: 1, q110_done: 1, q000_nomad_background: 1 },
  },
  {
    id: 'S-past-ponr', note: 'the point of no return has passed: the window is closed', history: none, street: [calm],
    facts: { q000_done: 1, q001_done: 1, q005_done: 1, q115_point_of_no_return: 1, q000_corpo_background: 1 },
  },
];

export const stateById = (id: string): StoryState => {
  const s = STATES.find((x) => x.id === id);
  if (!s) throw new Error(`no story state ${id}`);
  return s;
};
