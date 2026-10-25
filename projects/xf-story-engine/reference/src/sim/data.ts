// S1Data (S1 1.4): every [tunable] of the simulation layer, in one record of plain data. A pack may override a field; a
// pack that omits one takes the default given here. Nothing in the processes holds a number that belongs here.
//
// The defaults are the numbers the specification gives (S1 sections 1 to 8). Fixtures use them unchanged except where a
// fixture says otherwise.

import type { Effect } from '../types.ts';
import { ROLES } from './profile.ts';

export type KindName = string;
export type Per4 = [number, number, number, number];

// ---- time and shapes (S1 1.1, 7.1) ----

export interface Pulse {
  /** A weekday 0 (Monday) to 6, or `any`. */
  weekday: number | 'any';
  fromHour: number;
  toHour: number;
  factor: number;
}

export interface KindShape {
  /** Morning, day, evening, night. */
  hour: Per4;
  /** Monday to Sunday. */
  day: [number, number, number, number, number, number, number];
  pulses: Pulse[];
}

export interface ContentClass {
  class: string;
  shown: number;
  reported: number;
}

export interface CityKindDef {
  name: KindName;
  tags: string[];
  /** Role name and effect, in order. */
  effects: Array<{ role: string; effect: Effect }>;
  sizes: [number, number];
  classes: ContentClass[];
  severity: number;
  pulse: number;
  carrier: { channels: string[]; days: number };
  /** The flat term of the offender weight, and the weight of each affiliation class (gang, corp, ncpd). */
  base: number;
  rw: { gang: number; corp: number; ncpd: number };
  offspringFactor: number;
  /** Weights over `events.delayBins`. */
  delayWeights: number[];
  /** The kinds of its children and their relative weights. */
  matrix: Record<KindName, number>;
  /** v0.6 (S1 5.1): the fills of the kind when a pack states them; absent, the core's table (S1 5.2a). Linted at load. */
  fills?: Array<import('../event-kinds.ts').FillDecl>;
  /** v0.6: roles in which a pack lets `v` be bound; linted at load (S1 5.1). */
  allowV?: string[];
}

export interface RegimeDef {
  kind: string;
  /** Arrivals per district per day. */
  arrival: number;
  plannedLength: number;
  maxDwell: number;
  /** A multiplier on the rate of a kind while the regime lives. */
  effects: Record<KindName, number>;
  closes: string[];
  priceShift: number;
}

export interface EventsData {
  /** The base offspring mean by parent size 1 to 4. */
  offspring: [number, number, number, number];
  nMax: number;
  genMax: number;
  dispersion: number;
  maxChildren: number;
  /** Inclusive window ranges of the delay bins. */
  delayBins: Array<[number, number]>;
  /** Step of a child's size from its parent's: the values and their weights. */
  sizeSteps: number[];
  sizeStepWeights: number[];
  /** The weight of the parent cell, its graph neighbours at distance 1 and at distance 2. */
  placeKernel: [number, number, number];
  /** Heat: weight by size, by distance, and by age breakpoints (age up to `upTo` windows). */
  heatSize: [number, number, number, number];
  heatDist: [number, number, number];
  heatAge: Array<{ upTo: number; weight: number }>;
  heatPending: number;
  heatHorizon: number;
  /** Band thresholds for elevated, hot, flashpoint. */
  bandEnter: [number, number, number];
  bandLeave: [number, number, number];
  bandMinDwell: number;
  capPerWindow: number;
  m4Spacing: number;
  m4PerWeek: number;
  calendarCap: number;
  ringMax: number;
  witFraction: number;
  coverLull: number;
  flatPropensity: boolean;
  /** An override of the propensity quantile of named cells by position in the index (fixtures). */
  propensityOverride: Record<string, number>;
  /** An override for the rate table: multiplies every entry. */
  rateScale: number;
}

// ---- people (S1 4) ----

export interface RosterRow {
  /** Allowed S1 age bands for the member, as [lo, hi] inclusive. */
  bands: [number, number];
  relation: 'any' | 'gapAtMost1' | 'gapAtLeast2';
  sameAff: boolean;
  /** `crew` member 0 must have a gang-class affiliation. */
  gangClass?: boolean;
}

export type HouseholdType = 'single' | 'couple' | 'family' | 'shared' | 'crew';

export interface PeopleData {
  cellFloor: number;
  ipfIters: number;
  /** Rosters by household type; the entry for member j is `rosters[type][min(j, rosters[type].length - 1)]`, `null` meaning none. */
  rosters: Record<HouseholdType, Array<RosterRow | null>>;
  /** The weight of the extra members 0 to 3 by household type. */
  extraWeights: Record<HouseholdType, [number, number, number, number]>;
  baseSize: Record<HouseholdType, number>;
  /** The marginal share of each household type used when the index does not say (fixtures). */
  seedCrewHigh: number;
  seedCrewLow: number;
  crewGangShare: number;
  ageBands: Array<[number, number]>;
  /** The three factor tables whose product seeds the person fit (S1 4.2): age by role (8 x 12), role by class (12 x 4: civilian, gang, corp, ncpd), role by income (12 x 4). A 0 means the floor. */
  fit: { ageRole: number[][]; roleAff: number[][]; roleIncome: number[][] };
  rare: number;
  /** Spells. */
  spell: {
    baseDays: { work: [number, number]; health: [number, number] };
    ageMult: number[];
    pA: { work: number; health: number };
    quantiles: number;
    walkLimit: number;
  };
  lifeQ: number[];
  yearSeconds: number;
  sociability: { values: [number, number, number]; prior: [number, number, number] };
  absentP: number;
  presentCap: number;
  /** Home, work, out weights by period, per archetype. */
  schedules: Record<string, [number, number, number][]>;
  archetypeRules: Record<string, Array<[string, number]>>;
  /** Fraction of bind attempts. */
  bindAttempts: number;
  /**
   * The wide name registry (src/sim/names.ts). Absent, residents are named from the kernel's own small pool, as every run before M3 run 2 was;
   * present, a resident's name takes the registry's origins, weighted by affiliation class and district. The draw feeds no decision (S1-I-7).
   */
  names?: NameData;
}

/** Names by origin, and the weights that choose an origin: by the resident's affiliation class (an index), then by district key (multipliers). */
export interface NameData {
  origins: Record<string, { given: string[]; family: string[] }>;
  byClass: Array<Record<string, number>>;
  byDistrict: Record<string, Record<string, number>>;
}

export interface FocusDef {
  type: 'household' | 'crew' | 'work' | 'market';
  share?: number;
  k?: number;
  /** The expected size of a cell of the focus. */
  cell?: number;
}

export interface TiesData {
  cGeo: number;
  foci: FocusDef[];
  layerCaps: Record<1 | 2 | 3 | 4, number>;
  unitsPerTie: number;
  unitsPerMember: number;
  unitsPerCall: number;
  maxMaterialised: number;
  historyMax: number;
  historyDecayDays: number;
  /** Salience-0 entries older than this many game days are dropped. */
  strength: { sharedHoursFull: number; disclosureStep: number; favoursFull: number; recency: Array<{ upToDays: number; weight: number }> };
  deltas: Record<string, { warmth: number; respect: number; trustA: number; trustB: number; trustI: number }>;
  repairFraction: { apology: number; restitution: number };
  accBase: { friendly: number; close: number };
  replyWindow: number;
  fall: { warmth: number; trust: number; recoverWarmth: number; recoverTrust: number };
  bridgeFixer: { min: number; foci: number };
}

// ---- norms, stocks, ledger, groups, minds ----

export interface LadderRung {
  name: string;
  effect: Effect;
  class?: string;
  shown?: number;
  reported?: number;
}

export interface NormDef {
  id: string;
  label: string;
  sector: string[] | null;
  enforcer: { aff: 'A1' | 'A2' | 'A3'; roles: string[] };
  share: number[];
  taue: number[];
  taun: number[];
  priv0: number;
  beh0: number;
  perc0: number;
  visBase: number;
  nu: number;
  phiBase: number;
  phiPublic: number;
  eta: number;
  signalMemory: number;
  signalValue: number;
  enforcePerDay: number;
  ladder: Array<{ rung: string; weight: number }>;
  gapBands: { gap: [number, number]; wide: [number, number] };
  /** v0.6 (S1 7.5): the kinds and outcomes that refuse the norm's demand, with the refuser's and the demander's roles. */
  refusals?: Array<{ kind: string; outcomes: Array<'failed' | 'prevented'>; refuser: string; demander: string }>;
}

export interface NormsData {
  publicMinWitnesses: number;
  rungs: LadderRung[];
  norms: NormDef[];
  /** Enforcement per norm: the cap on uses in one window. */
  enforceCap: number;
  relaxIters: number;
  /** v0.6 (S1 7.5): windows a public refusal may wait for an answer, the signal an unanswered one sets, the answer rate per pending refusal per day, the cap on pending ones, and `discipline` in an interregnum. */
  sanctionWindow: number;
  refusalValue: number;
  answerRate: number;
  pendingCap: number;
  discipline: number;
}

export interface StocksData {
  rhoE: number;
  rhoY: number;
  rhoL: number;
  fearBase: number;
  r0: number;
  effects: {
    publicEnforcement: { dE: number; dY: number; dL: number };
    policeAnswered: { dE: number; dY: number; dL: number };
    unanswered: { dE: number; dY: number; dL: number };
    shakedown: { dE: number; dY: number; dL: number };
  };
}

export interface CarrierDef {
  id: string;
  /** `circle`, `group` (A1 ... A3) or `district`. */
  type: 'circle' | 'group' | 'district';
  /** For a group carrier, which affiliation slot. */
  aff?: 'A1' | 'A2' | 'A3';
  /** Residents who belong to it, by profile role (circle) or all. */
  roles: string[] | null;
}

export interface LedgerData {
  carriers: CarrierDef[];
  axes: string[];
  lambda: number;
  salW: [number, number, number, number];
  m0: number;
  highAt: number;
  midAt: number;
  cap: number;
  absorbedCap: number;
  judge: Record<string, Record<string, [number, number, number]>>;
  view: Record<string, Record<string, 'good' | 'neutral' | 'bad'>>;
  diag: Record<string, number>;
  diagMin: number;
  diagMax: number;
  reach: { circle: [number, number, number, number]; group: [number, number, number, number]; groupMember: number; district: [number, number, number, number] };
  reachMin: number;
  confidence: { witnessed: number; institutional: number };
  tellerDiscount: number;
}

export interface IntentDef {
  id: string;
  serves: string;
  groups: Array<'A1' | 'A2'>;
  duration: number;
  cooling: number;
  /** The boost this intention adds to the offender term of a kind while active; `retaliate` has a pair boost instead. */
  boost: Record<KindName, number>;
  pairMult?: number;
}

export interface GroupDef {
  aff: 'A1' | 'A2';
  books: { cash: number; burn: number; income: number };
  perShakedown: number;
  ethos: Record<string, number>;
  intents: string[];
}

export interface GroupsData {
  /** v0.6: pairs of hostile groups (S1 5.2a, `pRefuse`'s backing, S1 7.8); hostility is symmetric. */
  hostile: Array<['A1' | 'A2' | 'A3', 'A1' | 'A2' | 'A3']>;
  groups: GroupDef[];
  intents: IntentDef[];
  thetaStart: number;
  thetaStop: number;
  h0: number;
  hazardPublic: number;
  divergenceMin: number;
  gapBands: { low: number; mid: number; leaveLow: number; leaveMid: number };
  phi: Record<string, number>;
  boostMin: number;
  boostMax: number;
  groupModMin: number;
  latchExhaustDays: number;
  pulses: { sev: [number, number, number, number]; careU0: number; careTauDays: number; repU0: number; repTauDays: number; retU0: number; retTauDays: number; retHold: number };
  treasuryDays: number;
  constants: { cohesion: number; legitimacy: number; careMin: number; repMin: number };
}

export interface MindsData {
  thetaS1: number;
  holdDays: number;
  tellBase: number;
  operatorWeights: [number, number, number, number];
  hopLimit: number;
  wD: number;
  wDTilt: number;
  wDConstraint: number;
  tellsPerHour: number;
  memorableCap: number;
  replaceMargin: number;
  levelFactor: number;
  toldCap: number;
  toldFactor: number;
  reasons: Record<string, { dispositional: string[]; situational: string[] }>;
  ladder: string[];
  pulseMemorable: number;
  salienceStakes: number;
  salienceTie: number;
  /** Event salience pulse threshold. */
  salienceMemorable: number;
  protectsMemorable: number;
}

/** What decides an occurrence's outcome (S1 5.2a, v0.6): the refusal chances of a demand, and the backing of a hostile group. */
export interface OutcomesData {
  /** `pRefuse` of a complying resident, and of a non-complying one. */
  refuseC: number;
  refuseNC: number;
  /** Added when the refuser belongs to a group hostile to the demander's. */
  backing: number;
}

export interface GateData {
  /** The roles that bind adults only. */
  floorRoles: string[];
  harmEffects: Effect[];
}

export interface RealisationRow {
  kind: KindName;
  placeType: 'public' | 'semi' | 'private' | 'any';
  periods: number[] | null;
  minSize: number;
  route: string;
  cost: number;
  safeRadius: number;
  viewTest: boolean;
  perHour: number;
}

export interface S1Data {
  version: string;
  time: { W: number; periodStartHour: [number, number, number, number] };
  shape: { kinds: Record<KindName, KindShape>; rate: Record<KindName, [number, number, number, number]> };
  kinds: CityKindDef[];
  regimes: RegimeDef[];
  events: EventsData;
  people: PeopleData;
  ties: TiesData;
  norms: NormsData;
  stocks: StocksData;
  ledger: LedgerData;
  groups: GroupsData;
  minds: MindsData;
  feed: { keep: number };
  /** v0.6 (S1 5.2a). */
  outcomes: OutcomesData;
  /** The functions of the loaded vocabulary (the composite's `vocabulary.json`), against which a kind's fills are linted (S1 5.1). */
  vocabulary: string[];
  gate: GateData;
  realisation: RealisationRow[];
  acts: { perHour: number; hourWindows: number; witnessCap: number };
  log: { max: number };
  mirror: { cap: number; seenMax: number; publicMinWitnesses: number; deathGroupWitnesses: number; raw: string[] };
}

const flat7: KindShape['day'] = [1, 1, 1, 1, 1, 1, 1];
const weekend: KindShape['day'] = [0.8, 0.8, 0.9, 1.0, 1.3, 1.4, 1.0];

const kind = (
  name: string, tags: string[], effects: CityKindDef['effects'], sizes: [number, number], classes: ContentClass[],
  severity: number, pulse: number, carrier: CityKindDef['carrier'], base: number, rw: [number, number, number],
  offspringFactor: number, delayWeights: number[], matrix: Record<string, number>,
): CityKindDef => ({
  name, tags, effects, sizes, classes, severity, pulse, carrier, base, rw: { gang: rw[0], corp: rw[1], ncpd: rw[2] }, offspringFactor, delayWeights, matrix,
});

/** The default factor tables of the recipe fit (S1 4.2). The numbers are pack judgement, not the game's. */
export function defaultFitTables(rare: number): PeopleData['fit'] {
  const idx = (r: string): number => ROLES.indexOf(r as (typeof ROLES)[number]);
  const ageRole = Array.from({ length: 8 }, () => new Array(12).fill(1) as number[]);
  const set = (band: number, role: string, v: number): void => { ageRole[band]![idx(role)] = v; };
  for (const band of [5, 6, 7]) set(band, 'student', 0);
  for (const band of [0, 1, 2, 3, 4]) set(band, 'retired', 0);
  for (const role of ['police', 'corporate']) { set(0, role, 0); set(6, role, 0); set(7, role, 0); set(1, role, rare); }
  for (const band of [5, 6, 7]) set(band, 'gang', 0);
  for (const role of ['vendor', 'shopkeeper', 'service', 'nightlife', 'labourer', 'technician', 'gang', 'unemployed']) set(0, role, rare);
  for (const role of ['labourer', 'technician', 'service', 'nightlife']) set(7, role, rare);
  set(4, 'student', rare);
  set(5, 'retired', rare);
  const roleAff = ROLES.map((role) => {
    if (role === 'police') return [0, 0, 0, 1];
    if (role === 'gang') return [0, 1, 0, 0];
    if (role === 'corporate') return [1, 1, 3, 0];
    return [1, 1, 1, 0];
  });
  const income: Record<string, number[]> = {
    vendor: [1, 3, 1, 0.2], shopkeeper: [0.5, 2, 2, 0.5], service: [1, 3, 1, 0.2], nightlife: [1, 3, 1, 0.3], labourer: [1, 3, 1, 0.1],
    technician: [0.2, 1, 3, 1], corporate: [0.1, 0.5, 2, 3], gang: [1, 2, 2, 0.8], police: [0.1, 1, 3, 0.5], student: [2, 3, 1, 0.2],
    unemployed: [3, 3, 1, 0.2], retired: [1, 2, 2, 0.5],
  };
  return { ageRole, roleAff, roleIncome: ROLES.map((r) => income[r]!) };
}

const DEFAULT_DELAY = [0.15, 0.25, 0.3, 0.2, 0.08, 0.02];

export function defaultKinds(): CityKindDef[] {
  return [
    kind('theft', ['property'], [{ role: 'victim', effect: 'take' }], [1, 2], [{ class: 'property', shown: 1, reported: 1 }], 0.4, 0.3, { channels: ['people'], days: 7 }, 0.02, [1.0, 0.1, 0], 1, DEFAULT_DELAY, { theft: 0.5, 'police-action': 0.5 }),
    kind('assault', ['personal-violence'], [{ role: 'victim', effect: 'harm' }], [1, 2], [{ class: 'harm.residents', shown: 2, reported: 1 }], 0.7, 0.6, { channels: ['people'], days: 14 }, 0.01, [1.0, 0.1, 0], 1, DEFAULT_DELAY, { assault: 0.4, 'police-action': 0.6 }),
    kind('gang-clash', ['group-violence'], [{ role: 'victim', effect: 'harm' }], [1, 4], [{ class: 'harm.residents', shown: 3, reported: 2 }, { class: 'harm.groups', shown: 2, reported: 1 }], 0.9, 0.8, { channels: ['people', 'place'], days: 30 }, 0, [0, 0, 0], 1, [0.05, 0.15, 0.3, 0.3, 0.15, 0.05], { 'gang-clash': 0.5, 'police-action': 0.4, disorder: 0.1 }),
    kind('shakedown', ['protection'], [{ role: 'victim', effect: 'take' }], [1, 2], [{ class: 'property', shown: 2, reported: 1 }, { class: 'harm.residents', shown: 1, reported: 1 }], 0.5, 0.4, { channels: ['people'], days: 14 }, 0, [1.0, 0, 0], 1, DEFAULT_DELAY, { assault: 0.5, 'police-action': 0.3, shakedown: 0.2 }),
    kind('police-action', ['response'], [{ role: 'victim', effect: 'protect' }, { role: 'target', effect: 'take' }], [1, 3], [{ class: 'harm.residents', shown: 2, reported: 1 }], 0.5, 0.4, { channels: ['people'], days: 7 }, 0, [0, 0, 1.0], 0.5, [0.5, 0.35, 0.12, 0.03, 0, 0], { 'police-action': 0.75, disorder: 0.25 }),
    kind('psycho-break', ['cyberpsychosis'], [{ role: 'victim', effect: 'harm' }], [2, 4], [{ class: 'harm.residents', shown: 3, reported: 2 }, { class: 'dread', shown: 2, reported: 1 }], 1.0, 0.9, { channels: ['media'], days: 60 }, 0.01, [0, 0, 0], 0.5, DEFAULT_DELAY, { 'police-action': 1 }),
    kind('disorder', ['assembly'], [{ role: 'participant', effect: 'meet' }, { role: 'victim', effect: 'harm' }], [1, 4], [{ class: 'harm.residents', shown: 2, reported: 1 }], 0.6, 0.6, { channels: ['media', 'place'], days: 30 }, 0.01, [0.3, 0, 0], 1, DEFAULT_DELAY, { 'police-action': 0.6, theft: 0.4 }),
    kind('accident', ['hazard'], [{ role: 'victim', effect: 'harm' }], [1, 3], [{ class: 'harm.residents', shown: 2, reported: 1 }], 0.5, 0.5, { channels: ['place'], days: 7 }, 0.03, [0, 0, 0], 1, DEFAULT_DELAY, { 'police-action': 0.8, outage: 0.2 }),
    kind('outage', ['system'], [{ role: 'place', effect: 'move' }], [3, 4], [], 0.3, 0.4, { channels: ['place'], days: 3 }, 0.01, [0, 0, 0], 0.8, DEFAULT_DELAY, { accident: 0.4, theft: 0.4, disorder: 0.2 }),
    kind('commerce', ['market'], [{ role: 'giver', effect: 'give' }, { role: 'taker', effect: 'take' }], [1, 2], [], 0.1, 0.1, { channels: ['people'], days: 2 }, 0.02, [0, 0, 0], 0.6, DEFAULT_DELAY, { theft: 1 }),
  ];
}

export function defaultData(): S1Data {
  const shapes: Record<KindName, KindShape> = {
    theft: { hour: [0.8, 1.0, 1.2, 0.9], day: flat7, pulses: [] },
    assault: { hour: [0.4, 0.7, 1.3, 1.6], day: weekend, pulses: [] },
    'gang-clash': { hour: [0.2, 0.5, 1.2, 2.1], day: weekend, pulses: [] },
    shakedown: { hour: [0.5, 1.5, 1.0, 0.2], day: flat7, pulses: [{ weekday: 4, fromHour: 10, toHour: 16, factor: 3 }] },
    'police-action': { hour: [1, 1, 1, 1], day: flat7, pulses: [] },
    'psycho-break': { hour: [0.9, 0.9, 1.0, 1.2], day: flat7, pulses: [] },
    disorder: { hour: [0.3, 0.8, 1.4, 1.0], day: [0.8, 0.8, 0.8, 1.0, 1.3, 1.5, 1.1], pulses: [] },
    accident: { hour: [1.3, 0.9, 1.3, 0.6], day: flat7, pulses: [] },
    outage: { hour: [1, 1, 1, 1], day: flat7, pulses: [] },
    commerce: { hour: [1.6, 1.2, 0.6, 0.1], day: flat7, pulses: [{ weekday: 0, fromHour: 6, toHour: 10, factor: 1.5 }, { weekday: 3, fromHour: 6, toHour: 10, factor: 1.5 }] },
  };
  const rate: Record<KindName, [number, number, number, number]> = {
    theft: [90, 8, 0, 0],
    assault: [66, 8, 0, 0],
    'gang-clash': [24, 6, 2.4, 0.3],
    shakedown: [18, 2, 0, 0],
    'police-action': [24, 6, 1.0, 0],
    'psycho-break': [0, 1.0, 0.4, 0.1],
    disorder: [12, 4, 1.2, 0.3],
    accident: [45, 7, 0.8, 0],
    outage: [0, 0, 0.2, 0.1],
    commerce: [21, 3, 0, 0],
  };
  const ladder: LadderRung[] = [
    { name: 'word', effect: 'meet' },
    { name: 'shun', effect: 'take', class: 'harm.sanction', shown: 1, reported: 1 },
    { name: 'fine', effect: 'take', class: 'property', shown: 2, reported: 1 },
    { name: 'beating', effect: 'harm', class: 'harm.sanction', shown: 3, reported: 2 },
  ];
  const thresholdE = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75];
  const thresholdN = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const norm = (id: string, label: string, sector: string[] | null, priv0: number, beh0: number, perc0: number, visBase: number, enforcePerDay: number, weights: Array<[string, number]>): NormDef => ({
    id, label, sector, enforcer: { aff: 'A1', roles: ['gang'] }, share: new Array(8).fill(1 / 8), taue: thresholdE, taun: thresholdN,
    priv0, beh0, perc0, visBase, nu: 0.4, phiBase: 0.1, phiPublic: 0.6, eta: 0.058, signalMemory: 144, signalValue: 0.95, enforcePerDay,
    ladder: weights.map(([rung, weight]) => ({ rung, weight })), gapBands: { gap: [0.1, 0.08], wide: [0.3, 0.25] },
  });
  const heatAge = [{ upTo: 6, weight: 1.0 }, { upTo: 36, weight: 0.7 }, { upTo: 144, weight: 0.4 }, { upTo: 1008, weight: 0.15 }];
  return {
    version: 'xf.s1data@1',
    time: { W: 600, periodStartHour: [6, 12, 18, 0] },
    shape: { kinds: shapes, rate },
    kinds: defaultKinds(),
    regimes: [
      { kind: 'crackdown', arrival: 0.03, plannedLength: 216, maxDwell: 1008, effects: { theft: 0.6, assault: 0.6, 'gang-clash': 0.5, shakedown: 0.4, 'police-action': 2.0, disorder: 1.3 }, closes: [], priceShift: 0 },
      { kind: 'lockdown', arrival: 0.01, plannedLength: 144, maxDwell: 432, effects: { theft: 0.8, assault: 0.8, 'gang-clash': 0.7, commerce: 0.4, 'police-action': 1.5 }, closes: ['vendor', 'clinic'], priceShift: 1 },
      { kind: 'festival', arrival: 0.02, plannedLength: 72, maxDwell: 288, effects: { disorder: 2.0, theft: 1.3, commerce: 2.0, assault: 1.2, accident: 1.2 }, closes: [], priceShift: 0 },
    ],
    events: {
      offspring: [0.2, 0.3, 0.45, 0.6], nMax: 0.85, genMax: 4, dispersion: 0.3, maxChildren: 8,
      delayBins: [[1, 1], [2, 6], [7, 36], [37, 144], [145, 1008], [1009, 4320]],
      sizeSteps: [-1, -2, 0], sizeStepWeights: [0.6, 0.25, 0.12],
      placeKernel: [1, 0.4, 0.15],
      heatSize: [1, 3, 9, 27], heatDist: [1.0, 0.4, 0.15], heatAge, heatPending: 0.5, heatHorizon: 1008,
      bandEnter: [2.0, 5.0, 12.0], bandLeave: [1.2, 3.2, 8.0], bandMinDwell: 144,
      capPerWindow: 8, m4Spacing: 432, m4PerWeek: 2, calendarCap: 256, ringMax: 20000, witFraction: 0.05, coverLull: 144,
      flatPropensity: false, propensityOverride: {}, rateScale: 1,
    },
    people: {
      cellFloor: 2 ** -30, ipfIters: 20, seedCrewHigh: 1, seedCrewLow: 0.1, crewGangShare: 0.05, rare: 0.05, fit: defaultFitTables(0.05),
      ageBands: [[16, 17], [18, 24], [25, 34], [35, 44], [45, 54], [55, 64], [65, 74], [75, 90]],
      baseSize: { single: 1, couple: 2, family: 3, shared: 2, crew: 3 },
      extraWeights: { single: [1, 0, 0, 0], couple: [1, 0, 0, 0], family: [0.5, 0.3, 0.15, 0.05], shared: [0.5, 0.3, 0.2, 0], crew: [0.4, 0.3, 0.2, 0.1] },
      rosters: {
        single: [{ bands: [1, 7], relation: 'any', sameAff: false }, null],
        couple: [{ bands: [1, 7], relation: 'any', sameAff: false }, { bands: [1, 7], relation: 'gapAtMost1', sameAff: false }, null],
        family: [{ bands: [2, 4], relation: 'any', sameAff: false }, { bands: [1, 7], relation: 'gapAtMost1', sameAff: false }, { bands: [0, 1], relation: 'gapAtLeast2', sameAff: false }],
        shared: [{ bands: [1, 4], relation: 'any', sameAff: false }, { bands: [1, 4], relation: 'any', sameAff: false }, { bands: [1, 4], relation: 'any', sameAff: false }],
        crew: [{ bands: [1, 3], relation: 'any', sameAff: false, gangClass: true }, { bands: [1, 3], relation: 'any', sameAff: true }, { bands: [1, 3], relation: 'any', sameAff: true }],
      },
      spell: {
        baseDays: { work: [700, 90], health: [120, 4] }, ageMult: [0.6, 0.8, 1.0, 1.0, 1.0, 1.1, 1.2, 1.2],
        pA: { work: 0.8, health: 0.95 }, quantiles: 16, walkLimit: 64,
      },
      lifeQ: [45, 55, 60, 65, 68, 71, 74, 77, 80, 82, 84, 86, 88, 90, 92, 95],
      yearSeconds: 31_557_600,
      sociability: { values: [0.2, 0.5, 0.8], prior: [0.25, 0.5, 0.25] },
      absentP: 0.08, presentCap: 60, bindAttempts: 24,
      schedules: {
        'street-vendor': [[0.1, 0.8, 0.1], [0.1, 0.8, 0.1], [0.3, 0.5, 0.2], [0.9, 0, 0.1]],
        'service-worker': [[0.3, 0.5, 0.2], [0.2, 0.5, 0.3], [0.1, 0.6, 0.3], [0.2, 0.6, 0.2]],
        'gang-member': [[0.3, 0.1, 0.6], [0.2, 0.2, 0.6], [0.2, 0.2, 0.6], [0.3, 0.1, 0.6]],
        police: [[0.1, 0.8, 0.1], [0.1, 0.8, 0.1], [0.2, 0.7, 0.1], [0.4, 0.5, 0.1]],
        'young-street': [[0.4, 0.2, 0.4], [0.2, 0.2, 0.6], [0.1, 0.1, 0.8], [0.4, 0, 0.6]],
        elder: [[0.5, 0.1, 0.4], [0.5, 0.1, 0.4], [0.7, 0, 0.3], [0.95, 0, 0.05]],
        resident: [[0.4, 0.4, 0.2], [0.3, 0.4, 0.3], [0.5, 0.2, 0.3], [0.9, 0, 0.1]],
      },
      archetypeRules: {
        vendor: [['street-vendor', 1]], shopkeeper: [['street-vendor', 1]],
        service: [['service-worker', 1]], nightlife: [['service-worker', 1]],
        gang: [['gang-member', 1]], police: [['police', 1]],
        student: [['young-street', 0.6], ['resident', 0.4]], retired: [['elder', 0.7], ['resident', 0.3]],
      },
    },
    ties: {
      cGeo: 8,
      foci: [
        { type: 'household', share: 1 },
        { type: 'crew', share: 0.3, cell: 12 },
        { type: 'work', k: 3, cell: 10 },
        { type: 'market', k: 3, cell: 8 },
      ],
      layerCaps: { 1: 5, 2: 15, 3: 50, 4: 150 }, unitsPerTie: 50, unitsPerMember: 1, unitsPerCall: 5000,
      maxMaterialised: 20, historyMax: 32, historyDecayDays: 14,
      strength: {
        sharedHoursFull: 200, disclosureStep: 0.25, favoursFull: 6,
        recency: [{ upToDays: 7, weight: 1 }, { upToDays: 30, weight: 0.7 }, { upToDays: 90, weight: 0.4 }, { upToDays: 1e9, weight: 0.15 }],
      },
      deltas: {
        'reply-accept': { warmth: 0.08, respect: 0.02, trustA: 0, trustB: 0, trustI: 0 },
        'reply-decline': { warmth: -0.01, respect: 0, trustA: 0, trustB: 0, trustI: 0 },
        disclosure: { warmth: 0.05, respect: 0, trustA: 0, trustB: 0.02, trustI: 0 },
        favour: { warmth: 0.1, respect: 0, trustA: 0.02, trustB: 0.08, trustI: 0 },
        conflict: { warmth: -0.15, respect: -0.05, trustA: 0, trustB: -0.03, trustI: -0.05 },
        'joint-activity': { warmth: 0.03, respect: 0, trustA: 0, trustB: 0, trustI: 0 },
        crisis: { warmth: 0.1, respect: 0.05, trustA: 0, trustB: 0, trustI: 0 },
      },
      repairFraction: { apology: 0.5, restitution: 0.8 },
      accBase: { friendly: 0.5, close: 0.3 }, replyWindow: 60,
      fall: { warmth: -0.4, trust: 0.3, recoverWarmth: -0.1, recoverTrust: 0.4 },
      bridgeFixer: { min: 0.6, foci: 3 },
    },
    norms: {
      publicMinWitnesses: 5, rungs: ladder, enforceCap: 4, relaxIters: 4, sanctionWindow: 144, refusalValue: 0.2, answerRate: 2, pendingCap: 16, discipline: 0.5,
      norms: [
        { ...norm('fee', 'pay the Friday fee', ['vendor', 'shopkeeper'], 0.35, 0.875, 0.85, 0.5, 3, [['word', 0.6], ['shun', 0.25], ['fine', 0.1], ['beating', 0.05]]),
          refusals: [{ kind: 'shakedown', outcomes: ['failed', 'prevented'], refuser: 'victim', demander: 'aggressor|aggressor-group' }] },
        norm('uniforms', 'do not talk to the uniforms', null, 0.5, 0.75, 0.8, 0.3, 1, [['word', 0.7], ['shun', 0.25], ['beating', 0.05]]),
      ],
    },
    stocks: {
      rhoE: 0.9966, rhoY: 0.9983, rhoL: 0.9966, fearBase: 0.5, r0: 0.7,
      effects: {
        publicEnforcement: { dE: 0.01, dY: -0.01, dL: 0 },
        policeAnswered: { dE: 0.01, dY: -0.015, dL: 0.01 },
        unanswered: { dE: 0, dY: 0.02, dL: -0.02 },
        shakedown: { dE: -0.01, dY: 0, dL: 0 },
      },
    },
    ledger: {
      carriers: [
        { id: 'stalls', type: 'circle', roles: ['vendor', 'shopkeeper'] },
        { id: 'claws', type: 'group', aff: 'A1', roles: null },
        { id: 'kabuki', type: 'district', roles: null },
      ],
      axes: ['reliable', 'decent'],
      lambda: 0.9, salW: [0.25, 0.5, 0.75, 1], m0: 2, highAt: 0.7, midAt: 0.4, cap: 32, absorbedCap: 64,
      judge: {
        help: { reliable: [0.3, 0.3, 0.2], decent: [1.0, 1.0, 0.3] },
        protect: { reliable: [0.3, 0.3, 0.2], decent: [1.0, 1.0, 0.3] },
        rescue: { reliable: [0.3, 0.3, 0.2], decent: [1.0, 1.0, 0.3] },
        give: { reliable: [0.2, 0.2, 0.1], decent: [0.6, 0.6, 0.2] },
        harm: { reliable: [0, 0, 0], decent: [-1.0, -0.7, -0.2] },
        kill: { reliable: [0, 0, 0], decent: [-1.5, -1.2, -0.6] },
        take: { reliable: [-0.2, -0.2, 0], decent: [-0.8, -0.5, -0.1] },
        expose: { reliable: [-0.5, -0.5, -0.2], decent: [-0.6, -0.4, 0] },
        conceal: { reliable: [-0.3, -0.3, -0.1], decent: [0, 0, 0] },
        'promise:done': { reliable: [0.5, 0.5, 0.5], decent: [0, 0, 0] },
        'promise:failed': { reliable: [-1.2, -1.2, -1.2], decent: [0, 0, 0] },
      },
      view: {
        stalls: { civilian: 'good', A1: 'bad', A3: 'bad' },
        claws: { A1: 'good', A2: 'bad', A3: 'bad', ncpd: 'bad' },
        kabuki: { A1: 'bad', A3: 'bad' },
      },
      diag: { promise: 1.5 }, diagMin: 0.5, diagMax: 3,
      reach: {
        circle: [0.1, 0.25, 0.5, 0.8], group: [0.1, 0.25, 0.5, 0.8], groupMember: 1.0, district: [0.03, 0.15, 0.4, 0.7],
      },
      reachMin: 0.02, confidence: { witnessed: 1.0, institutional: 0.9 }, tellerDiscount: 1,
    },
    groups: {
      hostile: [['A1', 'A2']],
      groups: [
        { aff: 'A1', books: { cash: 9000, burn: 300, income: 330 }, perShakedown: 25, ethos: { treasury: 2, retribution: 1, reputation: 1.5, cohesion: 1 }, intents: ['collect-fee', 'retaliate'] },
        { aff: 'A2', books: { cash: 4000, burn: 150, income: 140 }, perShakedown: 0, ethos: { care_of_members: 2, retribution: 1, reputation: 1, legitimacy: 1.5 }, intents: ['protect-members', 'retaliate'] },
      ],
      intents: [
        { id: 'collect-fee', serves: 'treasury', groups: ['A1'], duration: 144, cooling: 72, boost: { shakedown: 1.0 } },
        { id: 'protect-members', serves: 'care_of_members', groups: ['A2'], duration: 144, cooling: 72, boost: { assault: -0.2 } },
        { id: 'retaliate', serves: 'retribution', groups: ['A1', 'A2'], duration: 36, cooling: 72, boost: {}, pairMult: 3 },
      ],
      thetaStart: 0.35, thetaStop: 0.2, h0: 0.02, hazardPublic: 0.5, divergenceMin: 0.25,
      gapBands: { low: 0.15, mid: 0.25, leaveLow: 0.13, leaveMid: 0.23 },
      phi: { treasury: 0.1, retribution: 0 }, boostMin: -0.5, boostMax: 3, groupModMin: 0.5, latchExhaustDays: 90,
      pulses: { sev: [0.3, 0.6, 0.9, 1.0], careU0: 0.7, careTauDays: 7, repU0: 0.7, repTauDays: 30, retU0: 0.8, retTauDays: 14, retHold: 0.5 },
      treasuryDays: 30, constants: { cohesion: 0.1, legitimacy: 0.2, careMin: 0.1, repMin: 0.2 },
      // phi for the other drives is 0.3 (a mixed pressure).
    },
    minds: {
      thetaS1: 0.2, holdDays: 14, tellBase: 0.3, operatorWeights: [0.15, 0.1, 0.1, 0.65], hopLimit: 4,
      wD: 0.65, wDTilt: 0.1, wDConstraint: 0.2, tellsPerHour: 10, memorableCap: 40, replaceMargin: 0.1, levelFactor: 0.8,
      toldCap: 0.9, toldFactor: 0.8,
      reasons: {
        harm: { dispositional: ['hostile', 'cruel'], situational: ['pressured', 'defending', 'accidental'] },
        kill: { dispositional: ['hostile', 'cruel'], situational: ['pressured', 'defending', 'accidental'] },
        take: { dispositional: ['greedy'], situational: ['desperate', 'ordered'] },
        help: { dispositional: ['kind', 'loyal'], situational: ['duty', 'paid'] },
        protect: { dispositional: ['kind', 'loyal'], situational: ['duty', 'paid'] },
        rescue: { dispositional: ['kind', 'loyal'], situational: ['duty', 'paid'] },
        give: { dispositional: ['kind', 'loyal'], situational: ['duty', 'paid'] },
        expose: { dispositional: ['spiteful'], situational: ['ordered'] },
        conceal: { dispositional: ['secretive'], situational: ['afraid'] },
        move: { dispositional: ['social'], situational: ['errand'] },
        meet: { dispositional: ['social'], situational: ['errand'] },
      },
      ladder: ['meet', 'take', 'harm', 'kill'],
      pulseMemorable: 0.6, salienceStakes: 0.5, salienceTie: 2, salienceMemorable: 3, protectsMemorable: 0.5,
    },
    feed: { keep: 8 },
    outcomes: { refuseC: 0.03, refuseNC: 0.35, backing: 0.3 },
    vocabulary: ['hold', 'want', 'transfer', 'wrong', 'befall', 'help', 'sacrifice', 'obligate', 'repay', 'ask', 'demand', 'comply', 'refuse', 'learn', 'conceal', 'expose', 'blame', 'protect', 'threaten', 'pursue', 'decide', 'bind', 'sever', 'compete', 'turn', 'choose', 'story'],
    gate: { floorRoles: ['aggressor', 'victim', 'target', 'hostile'], harmEffects: ['harm', 'kill', 'take', 'expose'] },
    realisation: [
      { kind: 'gang-clash', placeType: 'public', periods: [2, 3], minSize: 1, route: 'dynamic-event', cost: 1, safeRadius: 30, viewTest: true, perHour: 2 },
      { kind: 'assault', placeType: 'public', periods: [2, 3], minSize: 1, route: 'scanner-hustle', cost: 1, safeRadius: 30, viewTest: true, perHour: 2 },
      { kind: 'psycho-break', placeType: 'public', periods: null, minSize: 1, route: 'scanner-hustle', cost: 1, safeRadius: 30, viewTest: true, perHour: 2 },
      { kind: 'police-action', placeType: 'public', periods: null, minSize: 2, route: 'chase', cost: 1, safeRadius: 30, viewTest: true, perHour: 2 },
      { kind: 'theft', placeType: 'public', periods: null, minSize: 1, route: 'city-scene', cost: 1, safeRadius: 30, viewTest: true, perHour: 2 },
    ],
    acts: { perHour: 20, hourWindows: 6, witnessCap: 12 },
    log: { max: 2048 },
    mirror: {
      cap: 12, seenMax: 1024, publicMinWitnesses: 5, deathGroupWitnesses: 3,
      raw: ['game.death', 'game.combat.start', 'game.combat.end', 'game.heat.0', 'game.heat.1', 'game.heat.2', 'game.heat.3', 'game.heat.4', 'game.heat.5', 'game.district', 'game.journal.finished', 'game.journal.failed'],
    },
  };
}

/** A deep copy of the defaults with the changes a pack or fixture makes. */
export function makeData(over: (d: S1Data) => void = () => {}): S1Data {
  const d = defaultData();
  over(d);
  return d;
}
