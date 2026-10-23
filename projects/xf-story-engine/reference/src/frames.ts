// Context frames and demand (spec 10): the frame store, the inheritance DAG, pull, the frame worklist,
// demand tiers and claims, and the effect conflict check.
//
// Frames form an acyclic graph (I-14). Status, weight and parent changes recompute descendants through
// the frame worklist (spec 10.4); relevance dispatch waits until that worklist is empty.

import { hrec } from './canon.ts';
import { H, id as hid, i as hi, s as hs } from './id.ts';
import type { Kernel } from './kernel.ts';
import { namesNode } from './predicate.ts';
import type { ConflictTable, InterestType } from './registry.ts';
import { INTEREST_TYPES } from './registry.ts';
import { newOpCtx } from './resolve.ts';
import type { Effect, GameTime, Id, Selector, Tier } from './types.ts';
import { Budget, Worklist } from './work.ts';

export type FrameLevel = 'drive' | 'concern' | 'goal' | 'step' | 'situation';
export type FrameStatus = 'active' | 'blocked' | 'satisfied' | 'abandoned';

export interface FrameInterests {
  wants: Selector[];
  reactsTo: Selector[];
  blockedBy: Selector[];
  threatenedBy: Selector[];
  protects: Selector[];
}

export interface Goal {
  effects: Array<{ on: Id | Selector; effect: Effect }>;
}

export interface FrameParent {
  frame: Id;
  weight: number;
  /** Set on parent links made automatically from group membership (spec 12, SPEC-NOTES 32). */
  via?: 'membership';
}

export interface ContextFrame {
  id: Id;
  actor: Id;
  level: FrameLevel;
  parents: FrameParent[];
  origin: Id;
  payload: { drive?: string; goal?: Goal; place?: Id };
  weight: number;
  own: FrameInterests;
  focus: { nodes: Id[]; tier: Tier };
  status: FrameStatus;
  opened: GameTime;
  cause: Id;
}

export interface FrameSpec {
  actor: Id;
  level: FrameLevel;
  parents?: FrameParent[];
  origin: Id;
  payload?: ContextFrame['payload'];
  weight: number;
  own?: Partial<FrameInterests>;
  focus?: { nodes?: Id[]; tier?: Tier };
  status?: FrameStatus;
  cause: Id;
  id?: Id;
}

export interface Dilemma {
  id: Id;
  actor: Id;
  frameA: Id;
  frameB: Id;
  target: Id;
  effect: Effect;
  severity: number;
  cause: Id;
}

export type FrameWork =
  | { t: 'pull'; frame: Id }
  | { t: 'dilemma'; frame: Id }
  | { t: 'inherit'; actor: Id }
  | { t: 'dilemma-actor'; actor: Id };

export const emptyInterests = (): FrameInterests => ({ wants: [], reactsTo: [], blockedBy: [], threatenedBy: [], protects: [] });

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class Frames {
  private frames = new Map<Id, ContextFrame>();
  private kids = new Map<Id, Set<Id>>();
  private versions = new Map<Id, number>();
  readonly cachedPull = new Map<Id, number>();
  readonly worklist = new Worklist<FrameWork>();
  /** Actors whose frames are demand roots (V, the director and live seeds' actors). */
  readonly demandRoots = new Set<Id>();
  private dilemmaSeen = new Map<string, string>();
  readonly dilemmas: Dilemma[] = [];
  /** Group frames may change only through a decision (spec 10.3). Set while `decide` runs. */
  viaDecision = false;
  private demandLog: Array<{ tier: Tier; from: GameTime; to?: GameTime }> = [];
  private demandOpen = new Map<Tier, number>();

  constructor(private readonly k: Kernel) {}

  // ---- reads ----

  frame(id: Id): ContextFrame | undefined {
    return this.frames.get(id);
  }

  all(): ContextFrame[] {
    return [...this.frames.values()].sort((a, b) => cmpId(a.id, b.id));
  }

  framesOf(actor: Id): ContextFrame[] {
    return this.all().filter((f) => f.actor === actor);
  }

  childrenOf(id: Id): Id[] {
    return [...(this.kids.get(id) ?? [])].sort(cmpId);
  }

  version(id: Id): number {
    return this.versions.get(id) ?? 0;
  }

  eligible(f: ContextFrame): boolean {
    return f.status === 'active' || f.status === 'blocked';
  }

  isGroupActor(actor: Id): boolean {
    const h = this.k.store.header(actor);
    return !!h && this.k.schema.hasFacet(h.kind, 'group');
  }

  // ---- pull (spec 10.3) ----

  /** pull(f) = weight, or weight times the strongest eligible parent path. Authoritative; the cache only mirrors it. */
  pull(id: Id, memo: Map<Id, number> = new Map()): number {
    const m = memo.get(id);
    if (m !== undefined) return m;
    const f = this.frames.get(id);
    if (!f) return 0;
    let best = -1;
    for (const p of f.parents) {
      const pf = this.frames.get(p.frame);
      if (!pf || !this.eligible(pf)) continue;
      const v = p.weight * this.pull(p.frame, memo);
      if (v > best) best = v;
    }
    const out = best < 0 ? f.weight : f.weight * best;
    memo.set(id, out);
    return out;
  }

  /** d's pull computed only through paths that run through f (0 if none). */
  pullVia(d: Id, f: Id, memo: Map<Id, number> = new Map(), full: Map<Id, number> = new Map()): number {
    if (d === f) return this.pull(f, full);
    const m = memo.get(d);
    if (m !== undefined) return m;
    const fr = this.frames.get(d);
    if (!fr) return 0;
    let best = -1;
    for (const p of fr.parents) {
      const pf = this.frames.get(p.frame);
      if (!pf || !this.eligible(pf)) continue;
      const v = this.pullVia(p.frame, f, memo, full);
      if (v > 0 || p.frame === f) {
        const via = p.weight * v;
        if (via > best) best = via;
      }
    }
    const out = best < 0 ? 0 : fr.weight * best;
    memo.set(d, out);
    return out;
  }

  /** f itself (if eligible) and every eligible descendant reached through eligible frames. Sorted by Id. */
  deliveryTargets(f: Id): Id[] {
    const root = this.frames.get(f);
    if (!root || !this.eligible(root)) return [];
    const seen = new Set<Id>([f]);
    const queue = [f];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const c of this.childrenOf(cur)) {
        const cf = this.frames.get(c);
        if (!cf || !this.eligible(cf) || seen.has(c)) continue;
        seen.add(c);
        queue.push(c);
      }
    }
    return [...seen].sort(cmpId);
  }

  /** Whether `anc` is `id` or one of its ancestors (any status). */
  isAncestorOrSelf(anc: Id, id: Id): boolean {
    if (anc === id) return true;
    const seen = new Set<Id>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const f = this.frames.get(cur);
      if (!f) continue;
      for (const p of f.parents) {
        if (p.frame === anc) return true;
        stack.push(p.frame);
      }
    }
    return false;
  }

  /** The frame and every ancestor, any status. */
  ancestorsOrSelf(id: Id): Id[] {
    const seen = new Set<Id>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const p of this.frames.get(cur)?.parents ?? []) stack.push(p.frame);
    }
    return [...seen].sort(cmpId);
  }

  // ---- writes ----

  private checkWritable(actor: Id, level: FrameLevel): void {
    if (this.isGroupActor(actor) && (level === 'concern' || level === 'goal') && !this.viaDecision) {
      throw new Error('a group changes its concerns and goals only through a decision (spec 10.3)');
    }
  }

  private checkParents(child: Id, actor: Id, parents: FrameParent[]): void {
    for (const p of parents) {
      const pf = this.frames.get(p.frame);
      if (!pf) throw new Error(`unknown parent frame: ${p.frame}`);
      if (!(p.weight > 0)) throw new Error('a parent weight is positive');
      if (this.isAncestorOrSelf(child, p.frame)) throw new Error('a parent link that would close a cycle is refused (I-14)');
      // A group's concern or goal frame is never the child of another actor's frame (SPEC-NOTES 25).
      if (this.isGroupActor(actor) && pf.actor !== actor) {
        const cf = this.frames.get(child);
        if (cf && (cf.level === 'concern' || cf.level === 'goal')) throw new Error("a group's frames take no parents from other actors");
      }
    }
  }

  /** Open a frame. Refuses cycles and unauthorised group frames. */
  open(spec: FrameSpec): ContextFrame {
    this.k.assertWritable();
    this.checkWritable(spec.actor, spec.level);
    const opened = this.k.now;
    const payload = spec.payload ?? {};
    const fid = spec.id ?? H(
      hs('frame'), hid(spec.actor), hs(spec.level), hid(spec.origin), hi(opened), hid(spec.cause), hrec(payload),
      hrec((spec.parents ?? []).map((p) => [p.frame, p.weight])),
    );
    const existing = this.frames.get(fid);
    if (existing) return existing;
    const parents = (spec.parents ?? []).map((p) => ({ ...p }));
    for (const p of parents) {
      if (!this.frames.get(p.frame)) throw new Error(`unknown parent frame: ${p.frame}`);
      if (this.isGroupActor(spec.actor) && (spec.level === 'concern' || spec.level === 'goal') && this.frames.get(p.frame)!.actor !== spec.actor) {
        throw new Error("a group's frames take no parents from other actors");
      }
    }
    const f: ContextFrame = {
      id: fid, actor: spec.actor, level: spec.level, parents, origin: spec.origin, payload,
      weight: spec.weight, own: { ...emptyInterests(), ...spec.own },
      focus: { nodes: spec.focus?.nodes ?? [], tier: spec.focus?.tier ?? 3 },
      status: spec.status ?? 'active', opened, cause: spec.cause,
    };
    this.insert(f);
    this.touch(f.id, { dilemma: true });
    return f;
  }

  /** Insert a frame record without checks (a load, or `open` after its checks). */
  insert(f: ContextFrame): void {
    this.frames.set(f.id, f);
    for (const p of f.parents) {
      let set = this.kids.get(p.frame);
      if (!set) this.kids.set(p.frame, (set = new Set()));
      set.add(f.id);
    }
  }

  /** Drop a frame, as a save drops an ended one. The caller says it is gone: nothing is emitted. */
  remove(id: Id): void {
    this.k.assertWritable();
    const f = this.frames.get(id);
    if (!f) return;
    for (const p of f.parents) this.kids.get(p.frame)?.delete(id);
    this.frames.delete(id);
    this.cachedPull.delete(id);
  }

  /** A deep copy of the frame state, for a staged batch's discard (spec 14.2a). */
  capture(): unknown {
    return structuredClone({
      frames: this.frames, kids: this.kids, versions: this.versions, cachedPull: this.cachedPull, worklist: this.worklist.snapshot(),
      demandRoots: this.demandRoots, dilemmaSeen: this.dilemmaSeen, dilemmas: this.dilemmas, demandLog: this.demandLog,
      demandOpen: this.demandOpen, viaDecision: this.viaDecision,
    });
  }

  restoreFrom(cap: unknown): void {
    const c = structuredClone(cap) as Record<string, any>;
    this.frames = c.frames;
    this.kids = c.kids;
    this.versions = c.versions;
    this.cachedPull.clear();
    for (const [k, v] of c.cachedPull as Map<Id, number>) this.cachedPull.set(k, v);
    this.worklist.restore(c.worklist);
    this.demandRoots.clear();
    for (const a of c.demandRoots as Set<Id>) this.demandRoots.add(a);
    this.dilemmaSeen = c.dilemmaSeen;
    this.dilemmas.length = 0;
    this.dilemmas.push(...(c.dilemmas as Dilemma[]));
    this.demandLog = c.demandLog;
    this.demandOpen = c.demandOpen;
    this.viaDecision = c.viaDecision;
  }

  clear(): void {
    this.frames.clear();
    this.kids.clear();
    this.versions.clear();
    this.cachedPull.clear();
    this.worklist.clear();
    this.dilemmaSeen.clear();
    this.dilemmas.length = 0;
    this.demandLog = [];
    this.demandOpen.clear();
  }

  private mutate(id: Id, change: (f: ContextFrame) => void, opts: { dilemma?: boolean } = {}): ContextFrame {
    this.k.assertWritable();
    const f = this.frames.get(id);
    if (!f) throw new Error(`unknown frame: ${id}`);
    this.checkWritable(f.actor, f.level);
    change(f);
    this.touch(id, opts);
    return f;
  }

  setStatus(id: Id, status: FrameStatus, cause: Id): ContextFrame {
    const before = this.frames.get(id)?.status;
    const f = this.mutate(id, (fr) => {
      fr.status = status;
      fr.cause = cause;
    }, { dilemma: true });
    // A status change is a semantic change (spec 10.5, v4); weight and parent changes are not.
    if (this.k.config.frameChanges && before !== undefined && before !== status) {
      this.k.emit({ c: 'frame', frame: id, actor: f.actor, level: f.level, focus: [...f.focus.nodes], old: before, new: status });
    }
    return f;
  }

  setWeight(id: Id, weight: number, cause: Id): ContextFrame {
    if (!(weight >= 0 && weight <= 1)) throw new Error('a frame weight is in 0..1');
    return this.mutate(id, (f) => {
      f.weight = weight;
      f.cause = cause;
    });
  }

  setInterests(id: Id, own: Partial<FrameInterests>, cause: Id): ContextFrame {
    return this.mutate(id, (f) => {
      f.own = { ...f.own, ...own };
      f.cause = cause;
    }, { dilemma: true });
  }

  setFocus(id: Id, focus: { nodes?: Id[]; tier?: Tier }, cause: Id): ContextFrame {
    return this.mutate(id, (f) => {
      f.focus = { nodes: focus.nodes ?? f.focus.nodes, tier: focus.tier ?? f.focus.tier };
      f.cause = cause;
    });
  }

  /** Replace a frame's parent links. Refuses a link that would close a cycle. */
  setParents(id: Id, parents: FrameParent[], cause: Id): ContextFrame {
    this.k.assertWritable();
    const f = this.frames.get(id);
    if (!f) throw new Error(`unknown frame: ${id}`);
    this.checkParents(id, f.actor, parents);
    return this.mutate(id, (fr) => {
      for (const p of fr.parents) this.kids.get(p.frame)?.delete(id);
      fr.parents = parents.map((p) => ({ ...p }));
      for (const p of fr.parents) {
        let set = this.kids.get(p.frame);
        if (!set) this.kids.set(p.frame, (set = new Set()));
        set.add(id);
      }
      fr.cause = cause;
    }, { dilemma: true });
  }

  addParent(child: Id, parent: FrameParent, cause: Id): ContextFrame {
    const f = this.frames.get(child);
    if (!f) throw new Error(`unknown frame: ${child}`);
    const rest = f.parents.filter((p) => p.frame !== parent.frame);
    return this.setParents(child, [...rest, parent], cause);
  }

  /**
   * Bookkeeping common to every frame change: version, revision, worklist, demand log (spec 10.4).
   * `dilemma` marks a change to the set of interests the frame's actor and its descendants' actors are
   * bound by (a frame opens, enters or leaves the interest set, changes its interests or its parents), so
   * each of those actors' goals is checked again (spec 10.8, SPEC-NOTES 42).
   */
  private touch(id: Id, opts: { dilemma?: boolean } = {}): void {
    this.versions.set(id, this.version(id) + 1);
    this.k.bump();
    // The frame and its descendants recompute, parents first.
    const order: Id[] = [];
    const seen = new Set<Id>();
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      order.push(cur);
      for (const c of this.childrenOf(cur)) queue.push(c);
    }
    for (const f of order) this.worklist.push({ t: 'pull', frame: f });
    if (opts.dilemma) {
      const actors = new Set<Id>();
      for (const d of order) {
        const df = this.frames.get(d);
        if (df) actors.add(df.actor);
      }
      for (const actor of actors) this.worklist.push({ t: 'dilemma-actor', actor });
    }
    const fr = this.frames.get(id);
    if (fr) this.k.groups.onFrameChange(fr);
    this.updateDemandLog();
  }

  // ---- demand (spec 10.6) ----

  /** The highest focus tier among eligible frames (what processes see as the reach of demand). */
  maxDemandTier(): number {
    let m = -1;
    for (const f of this.frames.values()) if (this.eligible(f) && f.focus.tier > m) m = f.focus.tier;
    return m;
  }

  private updateDemandLog(): void {
    const reach = this.maxDemandTier();
    const now = this.k.now;
    for (const tier of [0, 1, 2, 3, 4, 5] as Tier[]) {
      const open = this.demandOpen.get(tier);
      if (reach >= tier && open === undefined) {
        this.demandOpen.set(tier, now);
        this.demandLog.push({ tier, from: now });
      } else if (reach < tier && open !== undefined) {
        this.demandOpen.delete(tier);
        for (let n = this.demandLog.length - 1; n >= 0; n--) {
          const e = this.demandLog[n]!;
          if (e.tier === tier && e.to === undefined) {
            e.to = now;
            break;
          }
        }
      }
    }
  }

  /** Whether demand reached `tier` at game time `t`, from the recorded demand history (I-15). */
  demandReachesAt(tier: Tier, t: GameTime): boolean {
    return this.demandLog.some((e) => e.tier === tier && e.from <= t && (e.to === undefined || t < e.to));
  }

  /** Whether demand reached `tier` at any time in `[from, to)`, from the recorded demand history (I-15). */
  demandOverlaps(tier: Tier, from: GameTime, to: GameTime): boolean {
    return this.demandLog.some((e) => e.tier === tier && e.from < to && (e.to === undefined || from < e.to));
  }

  demandHistory(): Array<{ tier: Tier; from: GameTime; to?: GameTime }> {
    return this.demandLog.map((e) => ({ ...e }));
  }

  setDemandHistory(h: Array<{ tier: Tier; from: GameTime; to?: GameTime }>): void {
    this.demandLog = h.map((e) => ({ ...e }));
    this.demandOpen.clear();
    for (const e of this.demandLog) if (e.to === undefined) this.demandOpen.set(e.tier, e.from);
  }

  private ownerChainOf(node: Id): Id[] {
    const out: Id[] = [node];
    let cur = this.k.resolver.ownerOf(node);
    while (cur !== undefined && !out.includes(cur)) {
      out.push(cur);
      cur = this.k.resolver.ownerOf(cur);
    }
    return out;
  }

  /** A node's demand tier: the highest focus tier among eligible frames focusing on it or its owner chain. */
  demandTier(node: Id): number {
    const chain = new Set(this.ownerChainOf(node));
    let m = -1;
    for (const f of this.frames.values()) {
      if (!this.eligible(f)) continue;
      if (f.focus.nodes.some((n) => chain.has(n)) && f.focus.tier > m) m = f.focus.tier;
    }
    return m;
  }

  /** A node's claim: the sum over eligible focusing frames of pull * w_actor (4.0 for demand roots, else 1). */
  claim(node: Id): number {
    const chain = new Set(this.ownerChainOf(node));
    let total = 0;
    const memo = new Map<Id, number>();
    for (const f of this.frames.values()) {
      if (!this.eligible(f) || !f.focus.nodes.some((n) => chain.has(n))) continue;
      total += this.pull(f.id, memo) * (this.demandRoots.has(f.actor) ? this.k.config.wActorRoot : 1);
    }
    return total;
  }

  /**
   * The nodes demand reaches at `tier` or finer (V4-37): each node an eligible frame focuses on at that tier or finer, with its
   * demand tier and its claim (spec 10.6), in Id order.
   */
  demanded(tier: Tier): Array<{ node: Id; tier: Tier; claim: number }> {
    const nodes = new Set<Id>();
    for (const f of this.frames.values()) if (this.eligible(f) && f.focus.tier >= tier) for (const n of f.focus.nodes) nodes.add(n);
    return [...nodes].sort(cmpId).map((node) => ({ node, tier: this.demandTier(node) as Tier, claim: this.claim(node) }));
  }

  /** Whether a slot normally opens now: the node's demand tier reaches the slot's tier (spec 10.6). */
  shouldOpen(node: Id, slotTier: Tier): boolean {
    return this.demandTier(node) >= slotTier;
  }

  // ---- interests (spec 10.5) ----

  /** Every registered interest of every eligible frame, in scan order: demand roots first, then actor Id, then frame Id. */
  scanList(): Array<{ frame: Id; actor: Id; type: InterestType; index: number; selector: Selector }> {
    const frames = [...this.frames.values()].filter((f) => this.eligible(f));
    frames.sort((a, b) => {
      const ra = this.demandRoots.has(a.actor) ? 0 : 1;
      const rb = this.demandRoots.has(b.actor) ? 0 : 1;
      return ra - rb || cmpId(a.actor, b.actor) || cmpId(a.id, b.id);
    });
    const out: Array<{ frame: Id; actor: Id; type: InterestType; index: number; selector: Selector }> = [];
    for (const f of frames) {
      for (const type of INTEREST_TYPES) {
        f.own[type].forEach((selector, index) => out.push({ frame: f.id, actor: f.actor, type, index, selector }));
      }
    }
    return out;
  }

  // ---- the frame worklist (spec 10.4, 10.7) ----

  /** Run the frame worklist within a budget. Returns the steps taken. */
  runWorklist(budget: Budget): number {
    return this.worklist.run(budget, (item) => {
      switch (item.t) {
        case 'pull': {
          const f = this.frames.get(item.frame);
          if (f) this.cachedPull.set(item.frame, this.pull(item.frame));
          else this.cachedPull.delete(item.frame);
          return { cost: 1, done: true };
        }
        case 'inherit':
          return { cost: this.k.groups.syncMember(item.actor), done: true };
        case 'dilemma':
          return { cost: this.checkDilemmas(item.frame), done: true };
        case 'dilemma-actor': {
          let cost = 1;
          for (const f of this.framesOf(item.actor)) if (f.payload.goal) cost += this.checkDilemmas(f.id);
          return { cost, done: true };
        }
      }
    });
  }

  /** Run the frame worklist to its end, with no budget. A load does this at the saved time, before the clock moves on (SPEC-NOTES 56). */
  settle(): number {
    return this.runWorklist(new Budget(Number.POSITIVE_INFINITY));
  }

  // ---- cross-pressure (spec 10.8) ----

  private targetsOf(on: Id | Selector): Id[] {
    if (typeof on === 'string') return [this.k.expandId(on)];
    if (on.scope && 'nodes' in on.scope) return on.scope.nodes.map((n) => this.k.expandId(n));
    return [];
  }

  /**
   * Check frame A's goal effects against the actor's other eligible frames of a different origin whose
   * interests (own or inherited) mention the effect's target. Emits at most one Dilemma per
   * (frameA, frameB, target, effect) until either frame changes. Returns the work units used.
   */
  checkDilemmas(frameA: Id): number {
    const A = this.frames.get(frameA);
    if (!A || !this.eligible(A) || !A.payload.goal) return 1;
    const table = this.k.registry.get('conflict', this.k.conflictTable) as ConflictTable;
    const ctx = newOpCtx(this.k.config.allowance);
    const env = this.k.resolver.makeEnv(ctx, this.k.now);
    let cost = 1;
    const pullMemo = new Map<Id, number>();
    for (const eff of A.payload.goal.effects) {
      for (const target of this.targetsOf(eff.on)) {
        for (const B of this.framesOf(A.actor)) {
          if (B.id === A.id || !this.eligible(B) || B.origin === A.origin) continue;
          cost++;
          for (const anc of this.ancestorsOrSelf(B.id)) {
            const holder = this.frames.get(anc);
            if (!holder || !this.eligible(holder)) continue;
            for (const type of INTEREST_TYPES) {
              for (const sel of holder.own[type]) {
                if (!namesNode(env, sel, target)) continue;
                if (table(type, eff.effect, {}) !== 'violates') continue;
                const key = `${A.id}|${B.id}|${target}|${eff.effect}`;
                const stamp = `${this.version(A.id)}|${this.version(B.id)}`;
                if (this.dilemmaSeen.get(key) === stamp) continue;
                this.dilemmaSeen.set(key, stamp);
                const severity = this.pull(A.id, pullMemo) * this.pull(B.id, pullMemo);
                const d: Dilemma = {
                  id: H(hs('dilemma'), hid(A.actor), hid(A.id), hid(B.id), hid(target), hs(eff.effect), hs(stamp)),
                  actor: A.actor, frameA: A.id, frameB: B.id, target, effect: eff.effect, severity, cause: A.id,
                };
                this.dilemmas.push(d);
                this.routeDilemma(d);
              }
            }
          }
        }
      }
    }
    return cost;
  }

  /**
   * Dilemmas whose frames belong to an actor layer 2 has registered go to layer 2 as well (S0 v4, V4-27). A frame
   * belongs to an actor when its own actor or the actor of one of its ancestor frames is registered: a role's
   * goal frame sits on the cast node, below the seed's role frame.
   */
  private routeDilemma(d: Dilemma): void {
    const l2 = this.k.layer2;
    if (!l2) return;
    const actors = l2.actors();
    const owned = [d.frameA, d.frameB].some((f) => this.ancestorsOrSelf(f).some((a) => actors.has(this.frames.get(a)?.actor ?? '')));
    if (owned) l2.onDilemma(d);
  }

  drainDilemmas(): Dilemma[] {
    return this.dilemmas.splice(0, this.dilemmas.length);
  }
}
