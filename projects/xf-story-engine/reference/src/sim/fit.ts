// The population fit (S1 7.4): not a process. It fits each district's joint tables from the marginals the index supplies, once,
// and publishes them as `Table` contributions. The index is immutable inside a lineage, so the fit is a function of it and of the
// pinned `S1Data`: computed at lineage creation and at every load, always the same, with its hash (`recipeHash`) in the lineage record.

import { hrec } from '../canon.ts';
import { H, s as hs } from '../id.ts';
import type { Pack } from '../persistence.ts';
import { setRegion } from '../region.ts';
import type { Form, Id, Predicate, Selector } from '../types.ts';
import type { S1Data } from './data.ts';
import type { DistrictIndex, WorldIndex } from './index-types.ts';
import { simulatedDistricts } from './index-types.ts';
import {
  ARCHETYPES, HH_TYPES, N_AFFC, N_AGE, N_HPROFILES, N_INCOME, N_PROFILES, N_ROLE, PROFILE_VALUES, ROLES, hprofilesOfType, hprofileType, profileA, profileF, profilesWhere,
  type RecipeClass,
} from './profile.ts';
import { PACK_ID } from './world-schema.ts';

/** Iterative proportional fitting (S1 7.4). `targets[d]` is the marginal of dimension `d`; each is divided by its sum first. */
export function ipf(seed: number[], dims: number[], targets: number[][], iters: number, floor: number): number[] {
  const t = ipfIterate(seed, dims, targets, iters);
  const n = t.length;
  let sum = 0;
  for (let x = 0; x < n; x++) {
    if (t[x]! < floor) t[x] = floor;
    sum = sum + t[x]!;
  }
  for (let x = 0; x < n; x++) t[x] = t[x]! / sum;
  return t;
}

/** The iterations alone: the table after `iters` passes, before the floor and the normalisation. Its marginals match the targets to rounding. */
export function ipfIterate(seed: number[], dims: number[], targets: number[][], iters: number): number[] {
  const n = seed.length;
  const t = seed.slice();
  const strides: number[] = new Array(dims.length);
  let acc = 1;
  for (let d = dims.length - 1; d >= 0; d--) {
    strides[d] = acc;
    acc *= dims[d]!;
  }
  const coord = (x: number, d: number): number => Math.floor(x / strides[d]!) % dims[d]!;
  const norm = targets.map((tg) => {
    let sum = 0;
    for (const v of tg) sum = sum + v;
    return tg.map((v) => v / sum);
  });
  for (let it = 0; it < iters; it++) {
    for (let d = 0; d < dims.length; d++) {
      const cur: number[] = new Array(dims[d]!).fill(0);
      for (let x = 0; x < n; x++) {
        const c = coord(x, d);
        cur[c] = cur[c]! + t[x]!;
      }
      for (let x = 0; x < n; x++) {
        const c = coord(x, d);
        if (cur[c]! > 0) t[x] = t[x]! * (norm[d]![c]! / cur[c]!);
      }
    }
  }
  return t;
}

/** The recipe class of each of the six affiliation classes of a district: used by the seed factors and the rosters. */
export function recipeClasses(d: DistrictIndex): RecipeClass[] {
  const cls = (aff: string): RecipeClass => d.entry.byAff.find((b) => b.aff === aff)?.cls ?? 'gang';
  return d.affOrder.map((aff, f) => (f === 0 ? 'civilian' : f === 1 ? 'ncpd' : f === 5 ? 'corp' : cls(aff)));
}

export interface Fit {
  district: Id;
  /** The normalised person table, 2,304 cells. */
  person: number[];
  /** The normalised household table, 60 cells. */
  household: number[];
  /** The weights `w = t / max(t)` the Table contributions carry. */
  personWeights: number[];
  householdWeights: number[];
  /** The expected household size and the share of each household type. */
  meanHH: number;
  hhType: number[];
  recipeHash: Id;
}

const classIndex = (c: RecipeClass): number => (c === 'civilian' ? 0 : c === 'gang' ? 1 : c === 'corp' ? 2 : 3);

/** The seed of the person table: the product of the three factor tables, each zero replaced by the floor. */
export function personSeed(d: DistrictIndex, data: S1Data): number[] {
  const f = data.people.fit;
  const floor = data.people.cellFloor;
  const cls = recipeClasses(d);
  const z = (v: number): number => (v === 0 ? floor : v);
  const seed: number[] = new Array(N_PROFILES);
  for (let x = 0; x < N_PROFILES; x++) {
    const a = profileA(x);
    const r = Math.floor(x / 24) % N_ROLE;
    const i = Math.floor(x / N_AFFC) % N_INCOME;
    const aff = profileF(x);
    seed[x] = z(f.ageRole[a]![r]!) * z(f.roleAff[r]![classIndex(cls[aff]!)]!) * z(f.roleIncome[r]![i]!);
  }
  return seed;
}

export function householdSeed(d: DistrictIndex, data: S1Data): number[] {
  let gang = 0;
  for (const b of d.entry.byAff) if (b.cls === 'gang') gang += b.q;
  const crewWeight = gang / d.entry.total > data.people.crewGangShare ? data.people.seedCrewHigh : data.people.seedCrewLow;
  const seed: number[] = new Array(N_HPROFILES).fill(1);
  for (let x = 0; x < N_HPROFILES; x++) if (hprofileType(x) === 4) seed[x] = crewWeight;
  return seed;
}

export function fitDistrict(d: DistrictIndex, data: S1Data): Fit {
  const m = d.marginals;
  const person = ipf(personSeed(d, data), [N_AGE, N_ROLE, N_INCOME, N_AFFC], [m.age, m.role, m.income, m.aff], data.people.ipfIters, data.people.cellFloor);
  const household = ipf(householdSeed(d, data), [5, 3, 4], [m.household.type, m.household.tenure, m.household.wealth], data.people.ipfIters, data.people.cellFloor);
  const maxOf = (t: number[]): number => t.reduce((a, b) => (b > a ? b : a), 0);
  const pm = maxOf(person);
  const hm = maxOf(household);
  const hhType: number[] = new Array(5).fill(0);
  for (let x = 0; x < N_HPROFILES; x++) hhType[hprofileType(x)] = hhType[hprofileType(x)]! + household[x]!;
  let meanHH = 0;
  HH_TYPES.forEach((ty, i) => {
    const w = data.people.extraWeights[ty];
    let wsum = 0;
    let mean = 0;
    for (let x = 0; x < 4; x++) {
      wsum = wsum + w[x]!;
      mean = mean + x * w[x]!;
    }
    meanHH = meanHH + hhType[i]! * (data.people.baseSize[ty] + mean / wsum);
  });
  const recipeHash = H(hs('recipe'), hrec({ district: d.id, person, household }));
  return { district: d.id, person, household, personWeights: person.map((v) => v / pm), householdWeights: household.map((v) => v / hm), meanHH, hhType, recipeHash };
}

export function fitIndex(ix: WorldIndex, data: S1Data): Map<Id, Fit> {
  const out = new Map<Id, Fit>();
  for (const d of simulatedDistricts(ix)) out.set(d.id, fitDistrict(d, data));
  return out;
}

// ---- the pack's contributions (S1 4.2) ----

type PackContribution = Pack['contributions'][number];
const sim = (c: Omit<PackContribution, 'layer'>): PackContribution => ({ ...c, layer: 'simulation' });
const rule = (when: Predicate[], then: Form): Form => ({ f: 'rule', when, then });
const inP = (path: string, values: Array<string | number>): Predicate => ({ path, op: 'in', arg: values });
const setForm = (values: string[], allow = true): Form => ({ f: 'set', region: setRegion(values), allow });

/** The sizes, extra members and rosters of a district's households. */
export function rulesPack(d: DistrictIndex, data: S1Data): PackContribution[] {
  const out: PackContribution[] = [];
  const cls = recipeClasses(d);
  const gangClass = (f: number): boolean => cls[f] === 'gang';
  const household = (slot: string): Selector => ({ kind: 'xf:household', slot, scope: { under: d.id } });
  // extra members: impossible values for a type are excluded (a zero weight is not a weight)
  HH_TYPES.forEach((ty, ti) => {
    const w = data.people.extraWeights[ty];
    const allowed = w.map((v, x) => (v > 0 ? x : -1)).filter((x) => x >= 0);
    if (allowed.length < 4) {
      out.push(sim({ target: household('extra'), mode: 'constrain', form: rule([inP('hprofile', hprofilesOfType(ti))], { f: 'set', region: { r: 'ivl', ivls: allowed.map((x): [number, number] => [x, x]) }, allow: true }) }));
    }
  });
  // p_j is none when j is at or beyond the size, and never none below it
  for (let j = 0; j < 6; j++) {
    if (j > 0) out.push(sim({ target: household(`p${j}`), mode: 'constrain', form: rule([{ path: 'size', op: 'field-at-most', arg: j }], { f: 'const', value: 'none' }) }));
    out.push(sim({ target: household(`p${j}`), mode: 'constrain', form: rule([{ path: 'size', op: 'field-at-least', arg: j + 1 }], setForm(['none'], false)) }));
  }
  // rosters
  const band = (x: number): number => profileA(x);
  HH_TYPES.forEach((ty, ti) => {
    const rows = data.people.rosters[ty];
    for (let j = 0; j < 6; j++) {
      const row = rows[Math.min(j, rows.length - 1)];
      if (!row) continue;
      const base: Predicate[] = [inP('hprofile', hprofilesOfType(ti)), { path: 'size', op: 'field-at-least', arg: j + 1 }];
      const ok = (x: number): boolean => band(x) >= row.bands[0] && band(x) <= row.bands[1] && (!row.gangClass || gangClass(profileF(x)));
      const target = household(`p${j}`);
      if (j === 0 || (row.relation === 'any' && !row.sameAff)) {
        out.push(sim({ target, mode: 'constrain', form: rule(base, setForm(profilesWhere(ok))) }));
      } else if (row.relation !== 'any') {
        for (let b0 = 0; b0 < N_AGE; b0++) {
          const gapOk = (x: number): boolean => (row.relation === 'gapAtMost1' ? Math.abs(band(x) - b0) <= 1 : Math.abs(band(x) - b0) >= 2);
          out.push(sim({ target, mode: 'constrain', form: rule([...base, inP('p0', profilesWhere((x) => band(x) === b0))], setForm(profilesWhere((x) => ok(x) && gapOk(x)))) }));
        }
      } else {
        for (let f0 = 0; f0 < N_AFFC; f0++) {
          out.push(sim({ target, mode: 'constrain', form: rule([...base, inP('p0', profilesWhere((x) => profileF(x) === f0))], setForm(profilesWhere((x) => ok(x) && profileF(x) === f0))) }));
        }
      }
    }
  });
  return out;
}

/** The ages, archetypes and names: contributions every resident of every district takes. */
export function globalRules(data: S1Data): PackContribution[] {
  const out: PackContribution[] = [];
  // ages are uniform within the band of the profile
  data.people.ageBands.forEach(([lo, hi], b) => {
    out.push(sim({ target: { kind: 'xf:resident', slot: 'age' }, mode: 'constrain', form: rule([{ path: 'aband', op: 'eq', arg: b }], { f: 'set', region: { r: 'ivl', ivls: [[lo, hi]] }, allow: true }) }));
  });
  // archetypes by role
  const archetype: Selector = { kind: 'xf:resident', slot: 'archetype' };
  const listed = Object.keys(data.people.archetypeRules);
  for (const role of listed) {
    const rows = data.people.archetypeRules[role]!;
    out.push(sim({ target: archetype, mode: 'constrain', form: rule([{ path: 'role', op: 'eq', arg: role }], setForm(rows.map((r) => r[0]))) }));
    if (rows.length > 1) {
      out.push(sim({ target: archetype, mode: 'weight', form: rule([{ path: 'role', op: 'eq', arg: role }], { f: 'table', weights: Object.fromEntries(rows) }) }));
    }
  }
  out.push(sim({ target: archetype, mode: 'constrain', form: rule([{ path: 'role', op: 'in', arg: ROLES.filter((r) => !listed.includes(r)) }], { f: 'const', value: 'resident' }) }));
  // name origin by affiliation class (it feeds no policy)
  const origin: Array<[number, number]> = [[1, 1], [2, 1], [1, 3], [3, 1], [1, 1], [1, 1]];
  origin.forEach(([w, j], f) => {
    out.push(sim({ target: { kind: 'xf:name', slot: 'origin' }, mode: 'weight', form: rule([{ path: '^/affc', op: 'eq', arg: f }], { f: 'table', weights: { western: w, japanese: j } }) }));
  });
  void ARCHETYPES;
  void PROFILE_VALUES;
  return out;
}

/** The headcounts and counts of a district's cells, households and services: assigned values the index and the fit give. */
export function structurePack(ix: WorldIndex, data: S1Data, fits: Map<Id, Fit>): PackContribution[] {
  const out: PackContribution[] = [];
  const constOn = (node: Id, slot: string, value: number | string): PackContribution =>
    sim({ target: { slot, scope: { nodes: [node] } }, mode: 'constrain', form: { f: 'const', value } });
  for (const d of simulatedDistricts(ix)) {
    const fit = fits.get(d.id)!;
    out.push(constOn(d.id, 'cells#count', d.cellIds.length));
    d.cellIds.forEach((cid) => {
      const c = ix.cells[cid]!;
      const headcount = Math.round(d.rho * d.entry.total * c.headShare);
      out.push(constOn(cid, 'headcount', headcount));
      out.push(constOn(cid, 'households#count', Math.ceil(headcount / fit.meanHH)));
      out.push(constOn(cid, 'services#count', c.services.length));
      out.push(constOn(cid, 'public', c.public));
    });
    out.push(sim({ target: { kind: 'xf:household', slot: 'hprofile', scope: { under: d.id } }, mode: 'weight', form: { f: 'table', weights: Object.fromEntries(fit.householdWeights.map((w, x) => [String(x), w])) } }));
    for (let j = 0; j < 6; j++) {
      out.push(sim({ target: { kind: 'xf:household', slot: `p${j}`, scope: { under: d.id } }, mode: 'weight', form: { f: 'table', weights: Object.fromEntries(fit.personWeights.map((w, x) => [String(x), w])) } }));
    }
  }
  return out;
}

/** The whole pack: its version is the hash of what it holds, so a changed index or fit is a different pack (S1 1.4). */
export function worldPack(ix: WorldIndex, data: S1Data, fits: Map<Id, Fit>): Pack {
  const contributions = [...globalRules(data), ...simulatedDistricts(ix).flatMap((d) => rulesPack(d, data)), ...structurePack(ix, data, fits)];
  const version = H(hs('pack'), hrec({ data, ix: ix.hash, fits: [...fits.values()].map((f) => f.recipeHash) }));
  return { id: PACK_ID, version, contributions };
}
