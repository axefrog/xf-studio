// Layer 2: the seeding layer (S2). It compiles seed documents, casts roles, runs each seed's lifecycle and
// beats, makes offers through the arbiter, and keeps the seed record, the exposure ledger and the maintenance
// queue. It is the only way content enters the simulation (D-02).
//
// This file holds the layer's state and its public surface. The work is in the modules beside it:
// `eval.ts` (predicates and the ledger), `cast.ts` (casting and claims), `run.ts` (re-evaluation, the
// lifecycle), `beats.ts` (the beat graph), `arbiter.ts` (deliveries, gates, release, display and responses),
// `effects.ts`, `engine.ts` (sowing and the work queue) and `persist.ts`.

import { ln } from '../fdlibm-log.ts';
import { H, id as hid, i as hi, rand, s as hs } from '../id.ts';
import type { Dilemma } from '../frames.ts';
import type { Layer2Hook } from '../kernel.ts';
import type { Kernel } from '../kernel.ts';
import type { Relevance } from '../relevance.ts';
import type { Budget } from '../work.ts';
import type { GameTime, Id, Layer } from '../types.ts';
import { PredSyntaxError, parsePred } from './pred.ts';
import { PackIndex } from './packs.ts';
import { lintPack, type LintCtx } from './lint.ts';
import { compileSeed } from './compile.ts';
import { L2Registry } from './registries.ts';
import * as ids from './ids.ts';
import type { DisplayReport, Layer2Port } from './port.ts';
import { Arbiter, arbiterStep, displayReport, findDelivery, respondTo, startDirect, type Response } from './arbiter.ts';
import { completeBeat } from './beats.ts';
import { marksAt } from './effects.ts';
import { evalPred, explainPred, ledger, type Explain, type LedgerEntry } from './eval.ts';
import { onBoundary, onRelevance, openWatcher, runWork, sowTemplate, type SowOpts } from './engine.ts';
import { detectIntersections } from './intersect.ts';
import { flush, onLoad, syncGlobal, syncRecord } from './persist.ts';
import { transition } from './run.ts';
import { claimConflictRead } from './cast.ts';
import { emptyGlobal } from './state.ts';
import { fitReport, recap, type FitReport, type RecapItem } from './fit.ts';
import { placeholders } from './lint.ts';
import type {
  FactsTable, Finding, GlobalState, InstanceState, Pack, Pred, RecordEntry, Seed, SeedInput, Delivery, TimingRequest,
} from './types.ts';

export interface Instance {
  id: Id;
  st: InstanceState;
}

export interface Tunables {
  maxLive: number;
  watchMax: number;
  maxTransitions: number;
  recastEvery: number;
  /** [tunable 7 game days], scaled by the player's `resetScale`. */
  reset: number;
  settle: number;
  resituateCap: number;
  returningCap: number;
  spacing: number;
  cap: number;
  capWindow: number;
  class0Gap: number;
  categoryDefault: number;
  displayTimeoutPersistent: number;
  maxAttempts: number;
  retractWindow: number;
  prepareTries: number;
  closeExpiry: number;
  recordMax: number;
  fitCap: number;
  K: number;
  /** The save age (seconds) from which a load enters `returning`. */
  returnAge: number;
  /** Work units one re-evaluation costs. */
  stepCost: number;
}

export const DEFAULT_TUNABLES: Tunables = {
  maxLive: 4,
  watchMax: 64,
  maxTransitions: 8,
  recastEvery: 600,
  reset: 7 * 86_400,
  settle: 90,
  resituateCap: 120,
  returningCap: 120,
  spacing: 60,
  cap: 2,
  capWindow: 600,
  class0Gap: 20,
  categoryDefault: 300,
  displayTimeoutPersistent: 600,
  maxAttempts: 3,
  retractWindow: 10,
  prepareTries: 3,
  closeExpiry: 3 * 86_400,
  recordMax: 512,
  fitCap: ln(1.5),
  K: 8,
  returnAge: 1_800,
  stepCost: 4,
};

/** What a hook receives about one delivery: a closed list (S2 section 8.8, S2-I-14). Nothing about quitting, menus, saving, idle time, session length, time of day or returns. */
export interface HookInputs {
  delivery: { id: Id; class: number; purpose: string; authored: boolean; pull: boolean; features: Record<string, string>; intensity?: number; maxWait: number; submitted: number };
  aspects: string[];
  session: string;
  tempo: string;
  playTotal: number;
  settings: { tempo: string; ceilings: Record<string, number> };
  window?: { lead?: string; urgency: number };
  jointLatched: boolean;
}

/** Layer 3's hooks (S3 section 1.4): the ones the core uses. A missing hook means layer 3 is absent. */
export interface Layer3Hooks {
  /** World fitting only: a weight for an option of a draw; clamped to +/- fitCap (S2 section 3.4). */
  fit?(choice: string, option: string, inst: { id: Id; template: string }): number;
  /** The phase hook: may only remove a delivery (returns true to hold it back). Ignored for pull, class-0 and closing deliveries. */
  hold?(inputs: HookInputs): boolean;
  /** Reports each joint occurrence (arriving, resting, finishing, asking); layer 2 owns the latch. */
  joint?(inputs: { aspects: string[]; session: string }): boolean | undefined;
  /** A notification of each release; returns nothing. */
  onRelease?(inputs: HookInputs): void;
}

export interface Layer2Options {
  port: Layer2Port;
  reg?: L2Registry;
  facts?: FactsTable;
  /** Capabilities the seeds may declare (L-12). Default: the port's. */
  capabilities?: ReadonlySet<string>;
  hooks?: Layer3Hooks;
  /** The lab and authoring tools may sow a seed below `ready`; a player's game never does (S2 section 1.3). */
  lab?: boolean;
  tunables?: Partial<Tunables>;
  /** Main-story (spine) characters: the director never casts them (S2 section 5.2). */
  spine?: ReadonlySet<Id>;
  /** Names of facts that record a relationship's status elsewhere (L-16). */
  relationshipFacts?: ReadonlySet<string>;
}

export type Trigger = { time: GameTime; change?: import('../types.ts').Change; reason: string };

export interface SowOutcome {
  ok: boolean;
  instance?: Id;
  existing?: boolean;
  findings: Finding[];
  /** A content gate kept the template from being sown (not a refusal). */
  gated?: string;
}

export interface SowRequest {
  template: string;
  pack?: string;
  overlay?: SowOpts['overlay'];
  localName: string;
  decision: Id;
}

export const isTerminal = (s: string): boolean => s === 'resolved' || s === 'withered' || s === 'withdrawn';

export class Layer2 implements Layer2Hook {
  readonly reg: L2Registry;
  readonly tun: Tunables;
  readonly hooks: Layer3Hooks;
  readonly packs = new Map<string, PackIndex>();
  readonly insts = new Map<Id, Instance>();
  global: GlobalState;
  facts: FactsTable;
  arbiter = new Arbiter();
  /** Cumulative play seconds in this branch as of the last load or the start (the base `playTotal()` adds this session's play to). */
  baseTotal = 0;
  /** The port's play clock at the start of the session: every stamp layer 2 keeps is relative to it (S2-I-11, SF-27). */
  playBase = 0;
  /** Queued re-evaluations: instance Id to the triggers since it last ran. */
  readonly queue = new Map<Id, Trigger[]>();
  /** Packs whose sowing watcher heard something. */
  readonly sowQueue = new Set<string>();
  readonly dilemmaQueue: Dilemma[] = [];
  readonly sowRefusals: Array<{ pack: string; template: string; findings: Finding[] }> = [];
  readonly packRoots = new Map<Id, string>();
  /** The boundary time of a simulation window just processed, awaiting the maintenance queue. */
  boundaryDue: GameTime | undefined;
  private actorSet = new Set<Id>();
  private parsed = new Map<string, Pred>();

  constructor(readonly k: Kernel, readonly opts: Layer2Options) {
    this.reg = opts.reg ?? new L2Registry();
    this.tun = { ...DEFAULT_TUNABLES, ...(opts.tunables ?? {}) };
    this.hooks = opts.hooks ?? {};
    this.facts = opts.facts ?? {};
    this.global = emptyGlobal();
    k.layer2 = this;
  }

  get port(): Layer2Port {
    return this.opts.port;
  }

  get worldSeed(): Id {
    return this.k.worldSeed;
  }

  // ---- the kernel's view of layer 2 (S0 v4) ----

  actors(): ReadonlySet<Id> {
    return this.actorSet;
  }
  registerActor(id: Id): void {
    this.actorSet.add(id);
  }
  unregisterActor(id: Id): void {
    this.actorSet.delete(id);
  }
  registerPackRoot(packId: string): void {
    const root = ids.packRootId(this.worldSeed, packId);
    this.packRoots.set(root, packId);
    this.actorSet.add(root);
  }
  clearActors(): void {
    this.actorSet.clear();
    this.packRoots.clear();
  }

  onRelevance(r: Relevance): void {
    onRelevance(this, r);
  }
  onDilemma(d: Dilemma): void {
    this.dilemmaQueue.push(d);
  }
  onBoundary(boundary: number, at: GameTime): void {
    onBoundary(this, boundary, at);
  }
  run(budget: Budget): number {
    return runWork(this, budget);
  }
  flush(): void {
    flush(this);
  }
  onLoad(): void {
    onLoad(this);
  }
  get pending(): number {
    return this.queue.size + this.sowQueue.size + this.dilemmaQueue.length + (this.boundaryDue !== undefined ? 1 : 0);
  }

  openWatcher(packId: string): void {
    openWatcher(this, packId);
  }

  // ---- draws ----

  /**
   * A layer-2 draw among options (S2 section 3.4): the kernel's Gumbel-max over `score(o) + g(o)`, with
   * `g(o) = -ln(-ln(rand("seed-draw", worldSeed, seedId, choice, attempt, o)))` and exact ties to the lower
   * `H("tie", worldSeed, seedId, choice, o)`. `bonus` is the sum of the preference terms, in the order the caller
   * adds them. The fit hook's weight is clamped to +/- fitCap and recorded raw and clamped.
   */
  draw(
    seedId: Id,
    choice: string,
    options: Array<{ id: string; weight?: number; bonus?: number; isId?: boolean }>,
    attempt: number,
    fit?: (option: string) => number,
  ): { value: string; raw?: number; clamped?: number } {
    let best: { id: string; total: number; tie: Id; raw?: number; clamped?: number } | undefined;
    for (const o of options) {
      let score = ln(o.weight ?? 1);
      if (o.bonus !== undefined) score += o.bonus;
      let raw: number | undefined;
      let clamped: number | undefined;
      if (fit) {
        raw = fit(o.id);
        clamped = Math.max(-this.tun.fitCap, Math.min(this.tun.fitCap, raw));
        score += clamped;
      }
      const key = o.isId ? hid(o.id) : hs(o.id);
      const u = rand(hs('seed-draw'), hid(this.worldSeed), hid(seedId), hs(choice), hi(attempt), key);
      const total = score + -ln(-ln(u));
      const tie = H(hs('tie'), hid(this.worldSeed), hid(seedId), hs(choice), key);
      if (!best || total > best.total || (total === best.total && tie < best.tie)) {
        best = { id: o.id, total, tie };
        if (raw !== undefined) best.raw = raw;
        if (clamped !== undefined) best.clamped = clamped;
      }
    }
    if (!best) throw new Error(`a draw needs at least one option (${choice})`);
    const out: { value: string; raw?: number; clamped?: number } = { value: best.id };
    if (best.raw !== undefined) out.raw = best.raw;
    if (best.clamped !== undefined) out.clamped = best.clamped;
    return out;
  }

  // ---- packs ----

  /** Install (or replace) a pack. Its pack-level findings come back; a broken pack never takes down the others. */
  installPack(pack: Pack): Finding[] {
    const index = new PackIndex(pack);
    const findings = lintPack(pack, index);
    if (findings.some((f) => f.level === 'error')) return findings;
    this.packs.set(pack.id, index);
    this.k.root(`pack:${pack.id}`, 'core:seed');
    this.registerPackRoot(pack.id);
    this.sowQueue.add(pack.id);
    this.openWatcher(pack.id);
    return findings;
  }

  /** A removed pack withdraws its live instances, because their content can no longer resolve (S2 section 12.3). */
  removePack(packId: string): void {
    for (const inst of this.live()) if (inst.st.template.pack === packId) this.withdraw(inst, `the pack "${packId}" was removed`);
    this.packs.delete(packId);
    const root = ids.packRootId(this.worldSeed, packId);
    this.unregisterActor(root);
    this.packRoots.delete(root);
  }

  lintContext(index: PackIndex): LintCtx {
    const c: LintCtx = {
      pack: index, facts: this.facts, reg: this.reg, schema: this.k.schema,
      capabilities: this.opts.capabilities ?? this.port.capabilities(), maxLive: this.tun.maxLive, watchMax: this.tun.watchMax,
      worldSeed: this.worldSeed,
    };
    c.portReport = { channels: { has: (ch: string) => this.port.channelAvailable(ch) } as unknown as ReadonlySet<string>, capabilities: this.port.capabilities() };
    if (this.opts.relationshipFacts) c.relationshipFacts = this.opts.relationshipFacts;
    const ladders = new Set<string>();
    for (const p of this.packs.values()) for (const s of p.pack.seeds) if (s.profile?.id === 'relationship-ladder') ladders.add(s.id);
    c.ladderTemplates = ladders;
    return c;
  }

  /** Compile a template without sowing it (the lab, the fit report and the lint use this). */
  compile(packId: string, template: Seed | SeedInput, drawOpts?: Parameters<typeof compileSeed>[2]): ReturnType<typeof compileSeed> {
    const index = this.packs.get(packId);
    if (!index) throw new Error(`unknown pack: ${packId}`);
    return compileSeed(template as SeedInput, this.lintContext(index), drawOpts);
  }

  // ---- sowing ----

  sow(packId: string, templateId: string, opts: SowOpts = {}): SowOutcome {
    return sowTemplate(this, packId, templateId, opts);
  }

  /** A sowing request from layer 3 (`story.seed@1`, S2 section 1.3). */
  sowRequest(req: SowRequest): { ok: true; instance: Id; existing: boolean } | { ok: false; findings: Finding[] } {
    let packId = req.pack;
    if (!packId) packId = [...this.packs.keys()].sort().find((p) => this.packs.get(p)!.pack.seeds.some((s) => s.id === req.template));
    if (!packId) return { ok: false, findings: [{ code: 'sow', level: 'error', message: `No pack holds the template "${req.template}".` }] };
    const o: SowOpts = { by: 'director', decision: req.decision, localName: req.localName };
    if (req.overlay) o.overlay = req.overlay;
    const r = this.sow(packId, req.template, o);
    if (r.ok) return { ok: true, instance: r.instance!, existing: r.existing ?? false };
    return { ok: false, findings: r.findings };
  }

  /** The fit report: a template run against the current state without changing it (S2 section 11.2). */
  fit(packId: string, templateId: string): FitReport {
    return fitReport(this, packId, templateId);
  }

  /** "Story so far": the pull recap, grounded in what V was shown (S2 section 8.7). */
  recap(): RecapItem[] {
    return recap(this);
  }

  // ---- instances ----

  all(): Instance[] {
    return [...this.insts.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  live(): Instance[] {
    return this.all().filter((i) => !isTerminal(i.st.state));
  }
  instance(id: Id): Instance | undefined {
    return this.insts.get(id);
  }
  /** The instances of a template, in sowing order. */
  ofTemplate(templateId: string): Instance[] {
    return this.all().filter((i) => i.st.template.id === templateId).sort((a, b) => a.st.sowSeq - b.st.sowSeq);
  }

  queueReeval(inst: Instance, reason: string, trig?: Trigger): void {
    if (isTerminal(inst.st.state)) return;
    const list = this.queue.get(inst.id) ?? [];
    list.push(trig ?? { time: this.k.now, reason });
    this.queue.set(inst.id, list);
  }

  /** Withdraw an instance (T1): a source withdrawal, a ladder, a rejection, a lost role, an expiry, a removed pack. */
  withdraw(inst: Instance, why: string): void {
    transition(this, inst, 'withdrawn', 'T1', why);
  }

  /** A source's withdrawal (T1): accepted only for instances layer 3 sowed; others are ignored with an entry (S2 section 1.3). */
  sourceWithdraw(seed: Id, reason: string, decision: Id): boolean {
    const inst = this.insts.get(seed);
    if (!inst || isTerminal(inst.st.state) || inst.st.source.by !== 'director') {
      const holder = inst ?? this.all()[0];
      if (holder) this.record(holder, 'expired', { ignored: 'source-withdraw-ignored', seed, decision });
      return false;
    }
    this.withdraw(inst, `withdrawn by its source: ${reason}`);
    return true;
  }

  completeNow(inst: Instance, beat: string): void {
    completeBeat(this, inst, beat);
    this.queueReeval(inst, 'beat done');
  }

  startDirect(inst: Instance, beat: string): void {
    startDirect(this, inst, beat);
  }

  syncRecord(inst: Instance): void {
    syncRecord(this, inst);
  }
  syncGlobal(): void {
    syncGlobal(this);
  }

  detectIntersections(inst: Instance): void {
    detectIntersections(this, inst);
  }

  // ---- facts and predicates ----

  /** The mirrored node of a game fact (S0 section 2.6), created silently on first use. */
  factNode(name: string): Id {
    return this.k.mirrored(ids.gameFactKey(name), 'core:game-fact');
  }

  parseCached(text: string): Pred {
    let p = this.parsed.get(text);
    if (!p) {
      try {
        p = parsePred(text);
      } catch (e) {
        if (e instanceof PredSyntaxError) p = 'no';
        else throw e;
      }
      this.parsed.set(text, p);
    }
    return p;
  }

  /** Evaluate a predicate for an instance (read-only). */
  evaluate(inst: Instance | undefined, p: Pred, t: GameTime = this.k.now): 'yes' | 'no' | 'maybe' {
    return evalPred(this, inst ? { inst, t } : { t }, p);
  }

  /** A read-only explanation of every node of a predicate: its value, and what is missing behind a `maybe` (S2 section 2.6). */
  explain(inst: Instance | undefined, p: Pred, t: GameTime = this.k.now): Explain {
    return explainPred(this, inst ? { inst, t } : { t }, p);
  }

  // ---- records ----

  /** Append a record entry to an instance (S2 section 10.1). Diagnostic entries are bounded; semantic ones are kept. */
  record(inst: Instance, kind: string, data: Record<string, unknown> = {}, cause?: Id): RecordEntry {
    const st = inst.st;
    const e: RecordEntry = { n: st.nextEntry++, at: this.k.now, playTotal: this.playTotal(), kind, data };
    if (cause !== undefined) e.cause = cause;
    st.record.push(e);
    const SEMANTIC = new Set(['response', 'closure', 'transition']);
    const diag = st.record.filter((x) => !SEMANTIC.has(x.kind));
    if (diag.length > this.tun.recordMax) {
      const drop = diag.length - this.tun.recordMax;
      let dropped = 0;
      st.record = st.record.filter((x) => {
        if (SEMANTIC.has(x.kind) || dropped >= drop) return true;
        dropped++;
        return false;
      });
    }
    return e;
  }

  /** The current cumulative play time in this branch (S2 section 10.1a): not the value last saved. */
  playTotal(): number {
    return this.baseTotal + this.arbiter.play;
  }

  // ---- the play clock and the game port's reports ----

  /** A session starts with the port's play clock at `base`; nothing layer 2 keeps depends on the offset. */
  beginSession(base: number): void {
    this.playBase = base;
    this.arbiter.play = 0;
    this.arbiter.lastStep = -1;
  }

  /** Advance the play clock to `to` (the port's seconds), one second at a time: the arbiter runs once a second of play (S2 section 8.3). */
  advancePlay(to: number, onSecond?: (s: number) => void): void {
    const rel = to - this.playBase;
    for (let s = this.arbiter.lastStep + 1; s <= rel; s++) {
      this.arbiter.play = s;
      onSecond?.(s + this.playBase);
      arbiterStep(this, s);
    }
    this.arbiter.play = Math.max(this.arbiter.play, rel);
  }

  /** The game port reports how a released delivery was shown (S2 section 8.5). */
  display(report: DisplayReport): void {
    displayReport(this, { ...report, atPlay: report.atPlay - this.playBase });
  }

  /** V answers an offer (S2 section 7.4). Returns whether the answer was accepted. */
  respond(delivery: Id, resp: Response): boolean {
    return respondTo(this, delivery, resp);
  }

  /** S7 reports a beat's content completed. */
  contentCompleted(delivery: Id): void {
    const hit = findDelivery(this, delivery);
    if (!hit) return;
    const { inst, d } = hit;
    if (d.state !== 'displayed' && d.state !== 'released') return;
    d.state = 'answered';
    if (d.beat && d.what === 'beat' && inst.st.beats[d.beat]?.state === 'running' && !inst.st.document.beats[d.beat]!.objective) this.completeNow(inst, d.beat);
    this.queueReeval(inst, 'content completed');
  }

  /** V asked for a delivery (a pull): it skips the timers, and an exhausted attempt bound is lifted (S2 section 8.5). */
  pull(delivery: Id): boolean {
    const hit = findDelivery(this, delivery);
    if (!hit || hit.d.state !== 'queued') return false;
    hit.d.pull = true;
    hit.d.stopped = false;
    return true;
  }

  /** The words of a delivery, written once at release (S2-I-16). */
  renderWords(inst: Instance, d: Delivery): string | undefined {
    if (d.words !== undefined) return d.words;
    const pack = inst.st.template.pack ? this.packs.get(inst.st.template.pack) : undefined;
    const unit = pack?.text(d.content);
    if (!unit) return undefined;
    return unit.text.replace(/\{([A-Za-z][A-Za-z0-9-]*)(?:\.([A-Za-z][A-Za-z0-9-]*))?\}/g, (_m, role: string, attr?: string) => {
      const node = d.bindings[role] ?? inst.st.roles[role]?.cast;
      const a = attr ?? 'name';
      if (node === undefined) return `[${role}.${a}]`;
      const kind = this.k.store.header(node)?.kind ?? '';
      if (a === 'name' && kind && this.k.schema.slotInfo(kind, 'name')?.isNode) {
        const nm = this.k.value(this.k.address(node, 'name'), 'display');
        if (typeof nm === 'string') return nm;
      }
      const info = kind ? this.k.schema.slotInfo(kind, a) : null;
      if (info && !info.isNode) {
        const direct = this.k.value(node, a);
        if (typeof direct === 'string' || typeof direct === 'number') return String(direct);
      }
      return `[${role}.${a}]`;
    });
  }

  // ---- reads (the Layer2View of S2 section 10.1a) ----

  ledger(): LedgerEntry[] {
    return ledger(this);
  }

  exposedNode(node: Id, atLeast: 'ambient' | 'presented' | 'confirmed' = 'confirmed'): boolean {
    const rank = { ambient: 0, presented: 1, confirmed: 2 } as const;
    for (const inst of this.all()) {
      for (const d of inst.st.deliveries) {
        if (Object.values(d.bindings).includes(node) && d.grade !== undefined && rank[d.grade] >= rank[atLeast]) return true;
      }
      for (const r of inst.st.receipts) {
        const d = inst.st.deliveries.find((x) => x.id === r.delivery);
        if (d && Object.values(d.bindings).includes(node) && rank[r.grade] >= rank[atLeast]) return true;
      }
    }
    return false;
  }

  sownBy(decision: Id): Id[] {
    return [...(this.global.sownBy[decision] ?? [])];
  }

  claimConflict(node: Id, span: 'seed' | 'beats', share: 'none' | 'background' | 'any'): boolean {
    return claimConflictRead(this, node, span, share);
  }

  marksAt(carrier: Id): import('./types.ts').CosmeticMark[] {
    return marksAt(this, carrier, this.k.now);
  }

  /** One-time notices (S2 section 12.2): recorded once per branch. */
  readonly notices: string[] = [];
  notice(kind: string): void {
    const id = ids.noticeId(kind, 'branch');
    if (this.global.notices.includes(id)) return;
    this.global.notices.push(id);
    this.notices.push(kind);
  }

  layerOf(inst: Instance): Layer {
    return inst.st.source.layer;
  }

  /** The timing request a seed's first delivery would carry (for reports). */
  timingOf(inst: Instance): TimingRequest {
    return inst.st.deliveries[0]?.timing ?? ({ kind: 'message', class: 2, importance: 'normal', purpose: 'introduce', tolerates: {}, maxWait: { clock: 'play', s: 1800 } } as TimingRequest);
  }
}

void placeholders;
