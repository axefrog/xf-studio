// The world-index slices the reference model runs on (S1 3.2): the fixture slice `FX-3` for unit fixtures, and the generated
// stand-in for Kabuki (`make-kabuki-slice`) until W1 builds the real `xf.kabuki.index@1`. The stand-in makes no claim about the
// game: it reproduces the figures S1 3.2 gives (entry quantity 2,964, the gang counts, 3,000 residents) and is deterministic from
// `H("fixture", "kabuki-slice")`.
//
// The keys of the generator are its own (S1 1.5): `rand("kslice", <slice seed>, tag, ...)`, with cell and affiliation names as
// strings.

import { hrec } from '../canon.ts';
import { H, id as hid, memberId, mirroredId, rand, s as hs } from '../id.ts';
import type { Id } from '../types.ts';
import { type KindName, type Per4, defaultKinds } from './data.ts';
import type { Aff, AffClass, CellIndex, DistrictIndex, WorldIndex } from './index-types.ts';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const KINDS = defaultKinds();
const KIND_NAMES: KindName[] = KINDS.map((k) => k.name);

export const districtIdOf = (key: string): Id => mirroredId(`place:${key}`);

const per4 = (f: (p: number) => number): Per4 => [f(0), f(1), f(2), f(3)];

function withHash(ix: Omit<WorldIndex, 'hash'>): WorldIndex {
  return { ...ix, hash: H(hs('world-index'), hrec(ix as unknown as Record<string, unknown>)) };
}

/** Marginals that a plausible district fits: every cell the roster and role rules allow stays reachable. */
function baseMarginals(aff: number[]): DistrictIndex['marginals'] {
  return {
    age: [0.04, 0.16, 0.22, 0.2, 0.17, 0.11, 0.07, 0.03],
    // vendor, shopkeeper, service, nightlife, labourer, technician, corporate, gang, police, student, unemployed, retired
    role: [0.05, 0.04, 0.14, 0.08, 0.17, 0.07, 0.04, 0.06, aff[1]!, 0.09, 1 - (0.05 + 0.04 + 0.14 + 0.08 + 0.17 + 0.07 + 0.04 + 0.06 + aff[1]! + 0.09 + 0.065), 0.065],
    income: [0.15, 0.4, 0.35, 0.1],
    aff,
    household: { type: [0.25, 0.2, 0.3, 0.15, 0.1], tenure: [0.6, 0.3, 0.1], wealth: [0.2, 0.4, 0.3, 0.1] },
  };
}

// ---- FX-3 ----

/** The fixture slice `FX-3` (S1 3.2): one district, 90 residents, three cells in a line. */
export function fx3Slice(): WorldIndex {
  const dId = districtIdOf('fx_d1');
  const cellIds = [0, 1, 2].map((i) => memberId(dId, 'cells', i));
  const [c1, c2, c3] = cellIds as [Id, Id, Id];
  const shares: Record<Aff, number> = { GA: 0.1, GB: 0.06, civilian: 0.82, ncpd: 0.02 };
  const aValue = [1.0, 2.0, 0.5];
  const A = (i: number): Record<KindName, Per4> => Object.fromEntries(KIND_NAMES.map((k) => [k, per4(() => aValue[i]!)]));
  const F: Record<KindName, number> = Object.fromEntries(KIND_NAMES.map((k) => [k, 1]));
  const cell = (id: Id, i: number, adj1: Id[], adj2: Id[], pub: CellIndex['public'], share: number): CellIndex => ({
    id, district: dId, kind: 'grid', adj1, adj2, public: pub, pop: [100, 100, 100, 100], headShare: share,
    presence: { ...shares }, A: A(i), F: { ...F },
    pairs: [{ a: 'GA', b: 'GB', w: 0.006 }, { a: 'GB', b: 'GA', w: 0.006 }],
    gameCoverage: Object.fromEntries(KIND_NAMES.map((k) => [k, k === 'gang-clash' && i === 1 ? 0.5 : 0])),
    services: [], marketCell: i === 0,
  });
  const flat = (v: number): Record<KindName, Per4> => Object.fromEntries(KIND_NAMES.map((k) => [k, per4(() => v)]));
  const district: DistrictIndex = {
    id: dId, key: 'fx_d1', simulated: true, neighbours: [], rho: 1,
    entry: { total: 90, byAff: [{ aff: 'civilian', cls: 'civilian', q: 73.8 }, { aff: 'GA', cls: 'gang', q: 9 }, { aff: 'GB', cls: 'gang', q: 5.4 }, { aff: 'ncpd', cls: 'ncpd', q: 1.8 }] },
    marginals: baseMarginals([0.82, 0.02, 0.1, 0.06, 0, 0]),
    affOrder: ['civilian', 'ncpd', 'GA', 'GB', '_none', 'other'],
    trust: { E0: 0.5, Y0: 0.5, L0: 0.5 }, priceAnchor: 1, staticTotalA: flat(3.5), cellIds,
  };
  return withHash({
    version: 'xf.fx3.index@1',
    districts: { [dId]: district },
    cells: {
      [c1]: cell(c1, 0, [c2], [c3], 'public', 0.5),
      [c2]: cell(c2, 1, [c1, c3].sort(cmp), [], 'public', 0.3),
      [c3]: cell(c3, 2, [c2], [c1], 'private', 0.2),
    },
    rest: { totalA: flat(31.5) },
  });
}

// ---- Kabuki ----

const GANGS: Array<{ aff: Aff; cls: AffClass; q: number }> = [
  { aff: 'TygerClaws', cls: 'gang', q: 205 }, { aff: 'TheMox', cls: 'gang', q: 112 }, { aff: 'Scavengers', cls: 'gang', q: 48 },
  { aff: 'Militech', cls: 'corp', q: 41 }, { aff: 'Animals', cls: 'gang', q: 18 },
];

/** Whether two gang-class affiliations are hostile, neutral or friendly: the stand-in's own table (a judgement, not the game's). */
function hostility(a: Aff, b: Aff): number {
  const key = [a, b].sort(cmp).join('|');
  const table: Record<string, number> = {
    'TheMox|TygerClaws': 1, 'Scavengers|TygerClaws': 1, 'Scavengers|TheMox': 0.3, 'Animals|TygerClaws': 0.3, 'Animals|TheMox': 0.3, 'Animals|Scavengers': 0,
  };
  return table[key] ?? 0.3;
}

/** The stand-in slice for Kabuki: 12 grid cells g0 ... g11 in a 4 x 3 grid and 10 venue cells v0 ... v9, plus two stubs. */
export function makeKabukiSlice(): WorldIndex {
  const sliceSeed = H(hs('fixture'), hs('kabuki-slice'));
  const r = (...key: Array<ReturnType<typeof hs>>): number => rand(hs('kslice'), hid(sliceSeed), ...key);
  const rs = (tag: string, ...rest: Array<string | number>): number =>
    r(hs(tag), ...rest.map((x) => (typeof x === 'number' ? ({ t: 'i', v: x } as const) : hs(x))));
  const dId = districtIdOf('wat_kab');
  const nId = districtIdOf('wat_nor');
  const lId = districtIdOf('wat_lch');
  const cellIds = Array.from({ length: 22 }, (_, i) => memberId(dId, 'cells', i));
  const gridName = (i: number): string => `g${i}`;
  const venueName = (i: number): string => `v${i}`;
  const nameOf = (idx: number): string => (idx < 12 ? gridName(idx) : venueName(idx - 12));

  const total = 2964;
  const ncpdQ = 59;
  const otherQ = 140;
  const civQ = 2341;
  const entries: DistrictIndex['entry']['byAff'] = [
    { aff: 'civilian', cls: 'civilian', q: civQ }, ...GANGS, { aff: 'Others', cls: 'corp', q: otherQ }, { aff: 'ncpd', cls: 'ncpd', q: ncpdQ },
  ];
  const byAff = entries.sort((x, y) => y.q - x.q || cmp(x.aff, y.aff));
  const listed = byAff.map((b) => b.aff);
  const share = (aff: Aff): number => byAff.find((b) => b.aff === aff)!.q / total;
  const clsOf = (aff: Aff): AffClass => byAff.find((b) => b.aff === aff)!.cls;

  // Headcount shares of the grid cells.
  const rawPop = Array.from({ length: 12 }, (_, i) => 1 + 3 * rs('pop', i));
  const sumPop = rawPop.reduce((a, b) => a + b, 0);
  const headShare = rawPop.map((x) => x / sumPop);

  // Presence: the district shares times 0.4 + 1.2 u, rescaled so the headcount-weighted mean equals the district share.
  const nonCiv = listed.filter((a) => a !== 'civilian');
  const rawPres: Record<string, number[]> = {};
  const scale: Record<string, number> = {};
  for (const aff of nonCiv) {
    rawPres[aff] = Array.from({ length: 22 }, (_, c) => share(aff) * (0.4 + 1.2 * rs('pres', nameOf(c), aff)));
    let mean = 0;
    for (let c = 0; c < 12; c++) mean += headShare[c]! * rawPres[aff]![c]!;
    scale[aff] = share(aff) / mean;
  }
  const presenceOf = (c: number): Record<Aff, number> => {
    const out: Record<Aff, number> = {};
    let sum = 0;
    for (const aff of nonCiv) {
      out[aff] = rawPres[aff]![c]! * scale[aff]!;
      sum += out[aff]!;
    }
    out.civilian = 1 - sum;
    return out;
  };

  // The graph: grid neighbours and hosted venues at distance 1; distance 2 by one more step.
  const col = (i: number): number => i % 4;
  const row = (i: number): number => Math.floor(i / 4);
  const host = (v: number): number => v % 12;
  const adj1Idx: number[][] = Array.from({ length: 22 }, () => []);
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) if (Math.abs(col(i) - col(j)) + Math.abs(row(i) - row(j)) === 1) adj1Idx[i]!.push(j);
  }
  for (let v = 0; v < 10; v++) {
    adj1Idx[host(v)]!.push(12 + v);
    adj1Idx[12 + v]!.push(host(v));
  }
  const adj2Idx = adj1Idx.map((a, i) => {
    const seen = new Set<number>([i, ...a]);
    const out = new Set<number>();
    for (const j of a) for (const k of adj1Idx[j]!) if (!seen.has(k)) out.add(k);
    return [...out];
  });
  const sortedIds = (list: number[]): Id[] => list.map((i) => cellIds[i]!).sort(cmp);

  const border = (i: number): number => (i < 12 && (col(i) === 0 || col(i) === 3) ? 1 : 0);
  const popOf = (c: number): Per4 => (c < 12 ? [0.9, 1.0, 1.1, 0.7].map((x) => x * headShare[c]! * 3000) as Per4 : ([0.2, 0.4, 1.0, 0.8].map((x) => x * 60) as Per4));
  const serviceTypes = ['vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'bar', 'clinic', 'bar', 'safehouse', 'lodging'];
  const servicesOf = (c: number): CellIndex['services'] => {
    const out: CellIndex['services'] = [];
    if (c >= 12) out.push({ id: H(hs('service'), hid(cellIds[c]!), hs(serviceTypes[c - 12]!)), type: serviceTypes[c - 12]! });
    if (c === 6) out.push({ id: H(hs('service'), hid(cellIds[c]!), hs('ripperdoc')), type: 'ripperdoc' });
    if (c === 1) out.push({ id: H(hs('service'), hid(cellIds[c]!), hs('fast-travel')), type: 'fast-travel', poi: 'fast-travel' });
    return out;
  };
  const gangs = nonCiv.filter((a) => clsOf(a) === 'gang');

  const cells: Record<Id, CellIndex> = {};
  const staticTotal: Record<KindName, Per4> = Object.fromEntries(KIND_NAMES.map((k) => [k, [0, 0, 0, 0] as Per4]));
  for (let c = 0; c < 22; c++) {
    const presence = presenceOf(c);
    const pairs: CellIndex['pairs'] = [];
    for (const a of gangs) {
      for (const b of gangs) {
        if (a === b) continue;
        const w = presence[a]! * presence[b]! * (1 + 2 * border(c)) * hostility(a, b);
        if (w > 0) pairs.push({ a, b, w });
      }
    }
    pairs.sort((x, y) => cmp(x.a, y.a) || cmp(x.b, y.b));
    const pairSum = pairs.reduce((acc, p) => acc + p.w, 0);
    const services = servicesOf(c);
    const pop = popOf(c);
    const ncpd = presence.ncpd ?? 0;
    const corp = nonCiv.filter((a) => clsOf(a) === 'corp').reduce((acc, a) => acc + presence[a]!, 0);
    const G = Math.min(0.9, 4 * ncpd + 2 * corp);
    const A: Record<KindName, Per4> = {};
    const F: Record<KindName, number> = {};
    for (const k of KINDS) {
      F[k.name] = 0.5 + 1.5 * rs('F', nameOf(c), k.name);
      let O = 0;
      if (k.name === 'gang-clash') O = pairSum;
      else for (const aff of nonCiv) O += presence[aff]! * k.rw[clsOf(aff) === 'gang' ? 'gang' : clsOf(aff) === 'corp' ? 'corp' : 'ncpd'];
      A[k.name] = per4((p) => pop[p]! * (1 + 0.5 * services.length) * ((k.name === 'gang-clash' ? 0 : k.base) + O) * (1 - G));
      const st = staticTotal[k.name]!;
      for (let p = 0; p < 4; p++) st[p] = st[p]! + A[k.name]![p]!;
    }
    const covered = c === 3 || c === 8;
    const coverage: Record<KindName, number> = Object.fromEntries(KIND_NAMES.map((k) => [k, covered && (k === 'theft' || k === 'assault' || k === 'gang-clash') ? 0.25 : 0]));
    cells[cellIds[c]!] = {
      id: cellIds[c]!, district: dId, kind: c < 12 ? 'grid' : 'venue', ...(c >= 12 ? { host: cellIds[host(c - 12)]! } : {}),
      adj1: sortedIds(adj1Idx[c]!), adj2: sortedIds(adj2Idx[c]!), public: c >= 12 ? 'semi' : [0, 5, 10].includes(c) ? 'private' : 'public',
      pop, headShare: c < 12 ? headShare[c]! : 0, presence, A, F, pairs, gameCoverage: coverage,
      services, marketCell: c >= 12 && c - 12 < 5,
    };
  }

  const aff6 = ['civilian', 'ncpd', 'TygerClaws', 'TheMox', 'Scavengers', 'other'];
  const affMarg = [civQ / total, ncpdQ / total, 205 / total, 112 / total, 48 / total, 0];
  affMarg[5] = 1 - affMarg.slice(0, 5).reduce((a, b) => a + b, 0);
  const district: DistrictIndex = {
    id: dId, key: 'wat_kab', simulated: true, neighbours: [nId, lId].sort(cmp), rho: 1, entry: { total, byAff }, marginals: baseMarginals(affMarg),
    affOrder: aff6, trust: { E0: 0.5, Y0: 0.5, L0: 0.5 }, priceAnchor: 1, staticTotalA: staticTotal, cellIds,
  };
  // The stubs: each takes 2.625 of Kabuki's static total, so Kabuki's share of each kind is 4 % with `rest` three times the listed sum.
  const stubTotal = (f: number): Record<KindName, Per4> => Object.fromEntries(KIND_NAMES.map((k) => [k, per4((p) => staticTotal[k]![p]! * f)]));
  const stub = (id: Id, key: string, tot: number, q: Array<[Aff, AffClass, number]>): DistrictIndex => ({
    id, key, simulated: false, neighbours: [dId], rho: 1,
    entry: { total: tot, byAff: q.map(([aff, cls, v]) => ({ aff, cls, q: v })).sort((x, y) => y.q - x.q || cmp(x.aff, y.aff)) },
    marginals: baseMarginals([0.8, 0.02, 0.06, 0.03, 0.02, 0.07]), affOrder: aff6, trust: { E0: 0.5, Y0: 0.5, L0: 0.5 }, priceAnchor: 1,
    staticTotalA: stubTotal(2.625), cellIds: [],
  });
  return withHash({
    version: 'xf.kabuki.index@1',
    districts: {
      [dId]: district,
      [nId]: stub(nId, 'wat_nor', 3100, [['civilian', 'civilian', 2500], ['ncpd', 'ncpd', 62], ['TygerClaws', 'gang', 190], ['Maelstrom', 'gang', 220], ['Militech', 'corp', 128]]),
      [lId]: stub(lId, 'wat_lch', 2400, [['civilian', 'civilian', 1950], ['ncpd', 'ncpd', 48], ['TheMox', 'gang', 140], ['Scavengers', 'gang', 160], ['Militech', 'corp', 102]]),
    },
    cells,
    rest: { totalA: stubTotal(18.75) },
  });
}
