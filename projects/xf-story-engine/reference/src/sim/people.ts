// The people (S1 4): residents are drawn, not simulated. A resident is a pure function of the world seed, the district's recipe and
// the resident's identity, so a person can be dropped and drawn again unchanged (S0 I-3). This module reads them through the
// kernel's resolution (households and their six owned member slots), keeps a cache that is only a cache, and derives the rest:
// the lifetime, the spells, the routines, who is present in a cell, and the protected set.

import { edgeActive } from '../predicate.ts';
import { H, memberId, ownedId, s as hs } from '../id.ts';
import { contributionId } from '../kernel.ts';
import type { Contribution, GameTime, Id } from '../types.ts';
import { floorDiv, invCum, mod } from './arith.ts';
import type { CellIndex } from './index-types.ts';
import type { IdentityKeys } from './keys.ts';
import { type Archetype, type Role, ROLES, SOCIABILITY, profileA, profileF, profileR } from './profile.ts';
import type { World } from './world.ts';

export type ResidentView = Readonly<{
  id: Id;
  household: Id;
  /** The resident's block: the grid cell where they live. */
  cell: Id;
  hIndex: number;
  j: number;
  profile: number;
  aband: number;
  role: Role;
  affc: number;
  age: number;
  ageClass: 'adult' | 'minor';
  sociability: number;
  archetype: Archetype;
  life: number;
  deathAge: number;
  /** The time a story event killed the resident, if one did. */
  died?: GameTime;
}>;

export type WhereClass = 'home' | 'work' | 'out' | 'away' | 'post';
export interface Whereabouts {
  cls: WhereClass;
  cell?: Id;
  cause: 'none' | 'ill' | 'closed' | 'between-jobs' | 'protected-present' | 'goal';
}

export interface BlockInfo {
  cell: Id;
  households: Id[];
  sizes: number[];
  /** prefix[h] = the sum of the sizes of households before h; the last entry is the resident count. */
  prefix: number[];
}

export interface PeopleHooks {
  /** Whether a regime of the district closes the person's stall at `t` (S1 7.1). */
  closed(view: ResidentView, t: GameTime): boolean;
  /** A canon character of the main story (S1 4.4). */
  isSpine(node: Id): boolean;
  defect(kind: string, detail: string): void;
  /** Whether a cast, an observation or a quest link protected the node at a time before now (the kernel's state and the record's spans). */
  protectedBefore?(node: Id, t: GameTime): boolean;
  /** v0.6 (S1 4.5, 7.10): the post of the post history of `people.goals` that covers `t` (its window and its period), if the person has one. */
  postAt?(person: Id, t: GameTime): { cell: Id } | undefined;
}

const NO_HOOKS: PeopleHooks = { closed: () => false, isSpine: () => false, defect: () => {} };
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const DAY = 86400;

export class People {
  hooks: PeopleHooks = NO_HOOKS;
  /** Nodes a pack marks `essential`: part of the protected set. */
  readonly essential = new Set<Id>();
  /** When false the caches are bypassed, so a test can show that a resident is a pure function. */
  cacheOn = true;
  /**
   * The views of households nothing local touches are a pure function of the world seed, the pack and the household, so they are
   * shared between worlds that agree on those (a memo of a pure function, never of state). A test of regeneration turns it off.
   */
  static shared = true;
  private static memo = new Map<string, { list: Array<ResidentView | undefined> }>();
  private blocks = new Map<Id, { stamp: number; general: string; now: number; info: BlockInfo }>();
  private views = new Map<Id, { stamp: number; general: string; now: number; list: Array<ResidentView | undefined> }>();
  private spells = new Map<string, { s0: number; starts: number[] }>();
  private ranks = new Map<Id, Id>();
  private generalAt = { rev: -1, key: '', timed: false, uncertain: false };
  /** The owner chain of a node, which never changes for a node: the node, its owner, the owner's owner, up to the root. */
  private chains = new Map<Id, Id[]>();
  /** What the kernel's configuration makes of a draw (the floor of a weight, the size of an enumeration, the limits): part of what a cached value is a function of. */
  private configKeyOf = '';
  private readonly packContributions: ReadonlySet<Id>;

  constructor(private readonly w: World, private readonly keys: IdentityKeys) {
    this.packContributions = new Set(w.pack.contributions.map(({ layer, ...spec }) => contributionId({ ...spec, source: { layer, origin: `pack:${w.pack.id}` } })));
  }

  private known(c: Contribution): boolean { return this.packContributions.has(c.id); }

  get k() {
    return this.w.k;
  }

  dropCaches(): void {
    this.blocks.clear();
    this.views.clear();
    this.spells.clear();
    this.ranks.clear();
    this.generalAt = { rev: -1, key: '', timed: false, uncertain: false };
    this.chains.clear();
  }

  /**
   * The node and the nodes it is owned by. A rule that applies to a node may read the slots of its owner chain (S0 2.3), so a pin or a
   * contribution on one of those slots can change what the node resolves to (R2-06); see `hasUncertainInputs`.
   */
  private ownerChain(node: Id): Id[] {
    const hit = this.chains.get(node);
    if (hit) return hit;
    const out: Id[] = [];
    let n: Id | undefined = node;
    for (let depth = 0; n !== undefined && depth < 16; depth++) {
      out.push(n);
      const h = this.k.persistence.restoreReferencedHeader(n);
      n = h && (h.origin.by === 'value' || h.origin.by === 'member') ? h.origin.owner : undefined;
    }
    this.chains.set(node, out);
    return out;
  }

  /**
   * The rules that name no node (the pack's, and any an author adds over a kind or over everything), as a key that moves when one is added,
   * removed or ended, and whether any has a window of its own. What is resolved for a resident depends on them as much as on the pins and
   * contributions that name the household (SIM-05): a cache is good only while this key holds, and, when a rule has a window, only at the
   * time it was made. Worked out once per revision.
   */
  private general(): { key: string; timed: boolean; uncertain: boolean } {
    const k = this.k;
    if (this.generalAt.rev === k.revision) return this.generalAt;
    let timed = false;
    let uncertain = false;
    const parts: string[] = [];
    for (const c of k.store.generalContributions()) {
      if (c.valid.from !== undefined || c.valid.to !== undefined) timed = true;
      parts.push(`${c.id}:${c.valid.from ?? ''}:${c.valid.to ?? ''}`);
      if (!this.known(c)) uncertain = true;
    }
    if (this.configKeyOf === '') this.configKeyOf = JSON.stringify(k.config);
    this.generalAt = { rev: k.revision, key: H(hs('general'), hs(parts.join(',')), hs(this.configKeyOf)), timed, uncertain };
    return this.generalAt;
  }

  /**
   * Only the installed pack's dependency set is known. Any additional rule on the resident or owner chain can depend transitively on
   * arbitrary values, edges or time: bypass both local and shared resolution caches for these inputs.
   */
  private hasUncertainInputs(chain: readonly Id[], named: readonly Id[], general: { uncertain: boolean }): boolean {
    const store = this.k.store;
    if (general.uncertain) return true;
    for (const n of new Set([...chain, ...named])) {
      for (const e of store.edgesFrom(n)) {
        if (e.type === 'core:located-in' && !(n === chain[chain.length - 1] && e.to === this.w.city && e.valid.from === 0 && e.valid.to === undefined)) return true;
      }
      if (store.namedContributions(n) === 0) continue;
      for (const c of store.contributionsNaming(n)) {
        if (this.known(c)) continue;
        return true;
      }
    }
    // The installed pack's resident derives read only the household and resident slots (stamped by the caller), never cell/district slots.
    return false;
  }

  // ---- cells and blocks ----

  /** The block of a cell: a grid cell is its own; a venue's is its host. */
  blockOf(cell: Id): Id {
    const c = this.w.cell(cell);
    return c.kind === 'venue' ? c.host! : cell;
  }

  /** The grid cells whose residents can be present in `cell`: its block, then the blocks next to it by Id (S1 4.5). */
  neighbourBlocks(cell: Id): Id[] {
    const b = this.blockOf(cell);
    const out: Id[] = [b];
    const adj = this.w.cell(b).adj1.filter((x) => this.w.cell(x).kind === 'grid').sort(cmp);
    for (const x of adj) if (x !== b && !out.includes(x)) out.push(x);
    return out;
  }

  // ---- households and residents ----

  householdId(cell: Id, i: number): Id {
    return memberId(cell, 'households', i);
  }
  residentId(household: Id, j: number): Id {
    return ownedId(household, `m${j}`);
  }

  private stampOf(nodes: Id[]): number {
    let s = 0;
    for (const n of nodes) s += this.k.store.localState(n);
    return s;
  }

  /** The households of a block with their sizes and prefix sums (S1 4.5). */
  blockInfo(cell: Id): BlockInfo {
    const k = this.k;
    const count = k.value(cell, 'households#count');
    const n = typeof count === 'number' ? count : 0;
    const ids: Id[] = [];
    for (let i = 0; i < n; i++) ids.push(k.address(cell, `households[${i}]`));
    const general = this.general();
    const cacheable = this.cacheOn && !this.hasUncertainInputs(this.ownerChain(cell), ids, general);
    const stamp = this.stampOf(ids);
    const hit = cacheable ? this.blocks.get(cell) : undefined;
    // good while nothing local and no rule over a kind has changed; with a pin or a rule that has a window, only at the time it was made
    if (this.cacheOn && hit && hit.stamp === stamp && hit.general === general.key && (stamp === 0 && !general.timed ? true : hit.now === k.now) && hit.info.households.length === n) return hit.info;
    const sizes = ids.map((h) => {
      const s = k.value(h, 'size');
      return typeof s === 'number' ? s : 0;
    });
    const prefix = [0];
    for (const s of sizes) prefix.push(prefix[prefix.length - 1]! + s);
    const info: BlockInfo = { cell, households: ids, sizes, prefix };
    if (cacheable) this.blocks.set(cell, { stamp, general: general.key, now: k.now, info });
    return info;
  }

  residentCount(cell: Id): number {
    const p = this.blockInfo(cell).prefix;
    return p[p.length - 1]!;
  }

  /** Expected residents, without addressing households or resolving any slot.
   * The population recipe rounds up to whole households, each of meanHH size.
   * This is an estimate, not a census of the materialised headers. */
  populationSnapshot(): ReadonlyMap<Id, number> {
    return new Map(Object.values(this.w.index.cells).map((c) => {
      const d = this.w.index.districts[c.district], mean = this.w.fits.get(c.district)?.meanHH;
      const heads = Math.round(d.rho * d.entry.total * c.headShare);
      return [c.id, mean ? Math.round(Math.ceil(heads / mean) * mean) : heads];
    }));
  }

  /** The household index by binary search over the prefix sums, and the member position inside it. */
  locate(cell: Id, n: number): { h: number; j: number } {
    const p = this.blockInfo(cell).prefix;
    let lo = 0;
    let hi = p.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (p[mid]! <= n) lo = mid;
      else hi = mid - 1;
    }
    return { h: lo, j: n - p[lo]! };
  }

  residentAt(cell: Id, n: number): Id {
    const { h, j } = this.locate(cell, n);
    const hh = this.blockInfo(cell).households[h]!;
    this.k.address(hh, `m${j}`);
    return this.residentId(hh, j);
  }

  /** Every resident of a block, in `(household index, member)` order. */
  residentsOfBlock(cell: Id): Id[] {
    const info = this.blockInfo(cell);
    const out: Id[] = [];
    info.households.forEach((hh, h) => {
      for (let j = 0; j < info.sizes[h]!; j++) {
        this.k.address(hh, `m${j}`);
        out.push(this.residentId(hh, j));
      }
    });
    return out;
  }

  /** Where a resident lives, from the headers the kernel keeps: `undefined` for a node that is not a resident. */
  refOf(res: Id): { household: Id; cell: Id; hIndex: number; j: number } | undefined {
    const h = this.k.persistence.restoreReferencedHeader(res);
    if (!h || h.origin.by !== 'value') return undefined;
    const m = /^m(\d)$/.exec(h.origin.slot);
    if (!m) return undefined;
    const hh = this.k.persistence.restoreReferencedHeader(h.origin.owner);
    if (!hh || hh.origin.by !== 'member' || hh.origin.slot !== 'households') return undefined;
    return { household: hh.id, cell: hh.origin.owner, hIndex: hh.origin.index, j: Number(m[1]) };
  }

  isResident(node: Id): boolean {
    return this.refOf(node) !== undefined;
  }

  /** A resident, resolved: the cached view is used only while nothing local (a pin, a named contribution) touches the household or its members. */
  view(res: Id): ResidentView | undefined {
    const ref = this.refOf(res);
    if (!ref) return undefined;
    const k = this.k;
    const members = [0, 1, 2, 3, 4, 5].map((j) => this.residentId(ref.household, j));
    const nodes = [ref.household, ...members.filter((m) => k.persistence.restoreReferencedHeader(m) !== undefined)];
    const general = this.general();
    const cacheable = this.cacheOn && !this.hasUncertainInputs(this.ownerChain(ref.household), nodes, general);
    const stamp = this.stampOf(nodes);
    const hit = cacheable ? this.views.get(ref.household) : undefined;
    // a household nothing local touches, under rules that have no window, is the same at any time; one that is touched, or under a rule
    // with a window, is good only at the time it was resolved (a pin's or a rule's validity is a window). Any change of the rules that
    // name no node, an authored kind-wide constraint among them, starts the cache again (SIM-05).
    const timeless = stamp === 0 && !general.timed;
    const fresh = hit !== undefined && hit.stamp === stamp && hit.general === general.key && (timeless || hit.now === k.now);
    if (this.cacheOn && hit && fresh && hit.list[ref.j] !== undefined) return hit.list[ref.j];
    // the shared memo is a pure function of the seed, the pack, the household and the rules that name no node
    const memoKey = `${k.worldSeed}|${this.w.pack.version}|${general.key}|${ref.household}`;
    const shared = cacheable && People.shared && timeless ? People.memo.get(memoKey) : undefined;
    if (shared && shared.list[ref.j] !== undefined) {
      const out = shared.list[ref.j];
      this.views.set(ref.household, { stamp, general: general.key, now: k.now, list: [...shared.list] });
      return out;
    }
    const view = this.resolveView(res, ref);
    // The cache keeps the views of a household together; a stamp that moved starts it again.
    const list = hit && fresh ? hit.list : [];
    list[ref.j] = view;
    if (cacheable) this.views.set(ref.household, { stamp, general: general.key, now: k.now, list });
    if (cacheable && People.shared && timeless) {
      let m = People.memo.get(memoKey);
      if (!m) People.memo.set(memoKey, (m = { list: [] }));
      m.list[ref.j] = view;
    }
    return view;
  }

  private resolveView(res: Id, ref: { household: Id; cell: Id; hIndex: number; j: number }): ResidentView | undefined {
    const k = this.k;
    const profile = k.value(res, 'profile');
    if (typeof profile !== 'string' || profile === 'none') return undefined;
    const x = Number(profile);
    const age = k.value(res, 'age');
    const life = k.value(res, 'life');
    const soc = k.value(res, 'sociability');
    const arch = k.value(res, 'archetype');
    if (typeof age !== 'number' || typeof life !== 'string' || typeof soc !== 'string' || typeof arch !== 'string') return undefined;
    const died = k.value(res, 'died');
    // the class the kernel resolves, which is what the gate must receive: the slot is derived from the age, and may also be narrowed on its own;
    // a class that is missing or unavailable counts as a minor (S1 6)
    const ageClass = k.value(res, 'age-class') === 'adult' ? 'adult' : 'minor';
    const lifeQ = this.w.data.people.lifeQ;
    const view: ResidentView = {
      id: res, household: ref.household, cell: ref.cell, hIndex: ref.hIndex, j: ref.j, profile: x, aband: profileA(x), role: ROLES[profileR(x)]!, affc: profileF(x),
      age, ageClass, sociability: this.w.data.people.sociability.values[SOCIABILITY.indexOf(soc as (typeof SOCIABILITY)[number])]!,
      archetype: arch as Archetype, life: Number(life), deathAge: Math.max(age + 1, lifeQ[Number(life)]!),
      ...(typeof died === 'number' ? { died } : {}),
    };
    return Object.freeze(view);
  }

  // ---- lifetime and spells ----

  /** Whether a resident is alive at `t`: unless the age death has passed, or a story event killed them at or before `t` (S1 4.2). */
  alive(res: Id, t: GameTime): boolean {
    const v = this.view(res);
    if (!v) return false;
    if (v.died !== undefined && v.died <= t) return false;
    return t < (v.deathAge - v.age) * this.w.data.people.yearSeconds;
  }

  private spellBase(v: ResidentView, track: 'work' | 'health') {
    const sp = this.w.data.people.spell;
    const p = this.keys.spellv(v.id, track) < sp.pA[track] ? 0 : 1;
    return p;
  }

  /** `lenQ[track][state][band][q] = base[track][state] x m[band] x (0.2 + 1.8 q / 15)` days, in seconds (S1 4.2). */
  lenQ(track: 'work' | 'health', state: number, band: number, q: number): number {
    const sp = this.w.data.people.spell;
    return sp.baseDays[track][state]! * sp.ageMult[band]! * (0.2 + (1.8 * q) / (sp.quantiles - 1)) * DAY;
  }

  /** The length of spell `k` in whole seconds: the keyed quantile of the table (S1 4.2). */
  spellLen(v: ResidentView, track: 'work' | 'health', k: number, state: number): number {
    const q = Math.floor(this.keys.spell(v.id, track, k) * this.w.data.people.spell.quantiles);
    return Math.floor(this.lenQ(track, state, v.aband, q));
  }

  /** The state of a track at `t`: `{ k, state, start, end }`, from a cached walk of at most 64 spells (S1 4.2). */
  stateAt(v: ResidentView, track: 'work' | 'health', t: GameTime): { k: number; state: number; start: number; end: number } {
    const sp = this.w.data.people.spell;
    // the spells depend on the age band as well as the person, and the band can move with a pin on the profile
    const key = `${v.id}|${track}|${v.aband}`;
    let rec = this.spells.get(key);
    if (!rec || !this.cacheOn) {
      const s0 = this.spellBase(v, track);
      const anchor = -Math.floor(this.keys.anchor(v.id, track) * this.lenQ(track, s0, v.aband, sp.quantiles - 1));
      rec = { s0, starts: [anchor] };
      this.spells.set(key, rec);
    }
    const state = (kk: number): number => mod(kk + rec!.s0, 2);
    const len = (kk: number): number => this.spellLen(v, track, kk, state(kk));
    let k = 0;
    // starts[k] is the start of spell k; extend until spell k covers t
    for (;;) {
      if (rec.starts.length <= k + 1) rec.starts.push(rec.starts[k]! + len(k));
      if (t < rec.starts[k + 1]!) break;
      k++;
      if (k >= sp.walkLimit) {
        this.hooks.defect('walk-limit', `${v.id} ${track}`);
        k = sp.walkLimit - 1;
        return { k, state: state(k), start: rec.starts[k]!, end: Number.MAX_SAFE_INTEGER };
      }
    }
    return { k, state: state(k), start: rec.starts[k]!, end: rec.starts[k + 1]! };
  }

  // ---- protection ----

  /**
   * Whether a node is protected at `t`: cast by a live seed, observed by V, a mirrored canon person, the spine or essential (S1 4.4). For
   * a time before now the answer is the protected set as of that time, from the spans the kernel still holds and those a save recorded
   * (`Protection`): what was protected then does not change when its cause ends, or when the game is saved and loaded.
   */
  protectedAt(n: Id, t: GameTime): boolean {
    const k = this.k;
    k.persistence.recoverIfSaved(n);
    if (t < k.now) {
      if (this.hooks.protectedBefore?.(n, t)) return true;
    } else {
      for (const e of k.store.edgesTo(n)) {
        if (e.type === 'core:cast' && edgeActive(e, t) && k.retention.seeds.has(e.from)) return true;
      }
      for (const p of k.store.pinsOfNode(n)) {
        if (p.reason === 'observed' && p.at <= t && !k.store.isWithdrawn(p.id)) return true;
      }
    }
    const h = k.persistence.restoreReferencedHeader(n);
    if (h?.origin.by === 'mirrored') {
      const q = k.value(n, 'quest-linked', t);
      if (q === 'yes') return true;
    }
    return this.hooks.isSpine(n) || this.essential.has(n);
  }

  /** The protected set now (S1 4.4). */
  protectedSet(n: Id): boolean {
    return this.protectedAt(n, this.k.now);
  }

  // ---- routines ----

  /** The cells a person may work in: the block and its neighbours, the market cells among them for market roles. */
  private workCandidates(v: ResidentView): Id[] {
    const block = this.w.cell(v.cell);
    const all = [v.cell, ...block.adj1].filter((x, i, a) => a.indexOf(x) === i);
    if (v.role === 'vendor' || v.role === 'shopkeeper') {
      const market = all.filter((c) => this.w.cell(c).marketCell);
      if (market.length > 0) return market;
    }
    return all;
  }

  placeOf(v: ResidentView, cls: WhereClass, day: number, p: number): Id | undefined {
    if (cls === 'away') return undefined;
    if (cls === 'home') return v.cell;
    if (cls === 'work') {
      const c = this.workCandidates(v);
      return c[Math.floor(this.keys.workPlace(v.id) * c.length)]!;
    }
    const block = this.w.cell(v.cell);
    const pub = [v.cell, ...block.adj1].filter((x, i, a) => a.indexOf(x) === i && this.w.cell(x).public === 'public');
    const c = pub.length > 0 ? pub : [v.cell];
    return c[Math.floor(this.keys.outPlace(v.id, day, p) * c.length)]!;
  }

  /** The calendar of the lineage root record (S1 1.1): the weekday at time 0 and the second of the day. */
  get clock(): { dow0: number; sod0: number } {
    return this.w.index.clock ?? { dow0: 0, sod0: 0 };
  }
  secondOfDay(t: GameTime): number {
    return mod(t + this.clock.sod0, DAY);
  }
  dayIndex(t: GameTime): number {
    return floorDiv(t + this.clock.sod0, DAY);
  }
  weekday(t: GameTime): number {
    return mod(this.clock.dow0 + this.dayIndex(t), 7);
  }
  /** The period of a time: morning, day, evening, night as 0 to 3 (S1 1.1). */
  periodOf(t: GameTime): number {
    return periodOfSecond(this.secondOfDay(t), this.w.data.time.periodStartHour);
  }

  /** Where a person is (S1 4.5): a pure function of the person and `t`, never ticked. */
  where(res: Id, t: GameTime): Whereabouts {
    const v = this.view(res);
    if (!v) return { cls: 'away', cause: 'none' };
    const day = this.dayIndex(t);
    const p = this.periodOf(t);
    const rows = this.w.data.people.schedules[v.archetype] ?? this.w.data.people.schedules.resident!;
    const weights = rows[p]!;
    let cls = (['home', 'work', 'out'] as const)[invCum(weights, this.keys.sched(res, day, p))] as WhereClass;
    let cause: Whereabouts['cause'] = 'none';
    // v0.6 (S1 4.5): a goal's post covering `t`; the `sched` draw above is made as before and only its answer is replaced
    const post = this.hooks.postAt?.(res, t);
    // protected as of `t`, not as of now: a person observed later was not retroactively present (S1 5.4 casts from recorded history as of the occurrence's own time)
    if (this.protectedAt(res, t)) return post ? { cls: 'post', cell: post.cell, cause: 'goal' } : { cls, cell: this.placeOf(v, cls, day, p), cause: 'protected-present' };
    if (this.stateAt(v, 'health', t).state === 1) {
      cls = 'away';
      cause = 'ill';
    } else if (post) {
      return { cls: 'post', cell: post.cell, cause: 'goal' };
    } else if (cls === 'work' && this.stateAt(v, 'work', t).state === 1) {
      cls = 'home';
      cause = 'between-jobs';
    } else if (this.keys.absent(res, day) < this.w.data.people.absentP) {
      cls = 'away';
      cause = this.hooks.closed(v, t) ? 'closed' : 'none';
    }
    const cell = this.placeOf(v, cls, day, p);
    return cell === undefined ? { cls, cause } : { cls, cell, cause };
  }

  /**
   * Who is present in a scene (S1 4.5): residents of the cell's block and its neighbouring blocks who are alive, not away and in the cell
   * at `t`, in block order (own block first, then neighbours by Id) and ordinal, cut to `cap` by `rand("present", cell, person)` ascending.
   */
  presentAt(cell: Id, t: GameTime, cap = this.w.data.people.presentCap): Id[] {
    const found: Id[] = [];
    for (const b of this.neighbourBlocks(cell)) {
      for (const r of this.residentsOfBlock(b)) {
        if (!this.alive(r, t)) continue;
        const wh = this.where(r, t);
        if (wh.cls !== 'away' && wh.cell === cell) found.push(r);
      }
    }
    if (found.length <= cap) return found;
    const keyed = found.map((r, i) => ({ r, i, u: this.keys.present(cell, r) }));
    keyed.sort((a, b) => a.u - b.u || cmp(a.r, b.r));
    return keyed.slice(0, cap).map((x) => x.r);
  }

  /** The residents of a cell's block (a venue has none of its own). */
  cellOf(res: Id): CellIndex | undefined {
    const v = this.view(res);
    return v ? this.w.cell(v.cell) : undefined;
  }
}

export function periodOfSecond(sod: number, startHour: readonly number[]): number {
  // periods: 0 M(orning) 06-12, 1 D(ay) 12-18, 2 E(vening) 18-24, 3 N(ight) 00-06
  const hour = Math.floor(sod / 3600);
  let best = 3;
  const order = [0, 1, 2, 3];
  for (const p of order) {
    const from = startHour[p]!;
    const next = startHour[(p + 1) % 4]!;
    const inP = from < next ? hour >= from && hour < next : hour >= from || hour < next;
    if (inP) best = p;
  }
  return best;
}
