// Composition and host boundary for S3. Reads use copied views; writes use S2's two doors,
// inert meta events, pattern frames, and one SeedRecord. The evidence sink has no reader here.
import type { Kernel } from '../kernel.ts';
import { hrec } from '../canon.ts';
import { H, s } from '../id.ts';
import type { Layer2, HookInputs, WorldFitInput } from '../seeding/layer2.ts';
import type { CompiledSeed, Finding, TimingRequest } from '../seeding/types.ts';
import { bound } from '../seeding/doc.ts';
import type { Budget } from '../work.ts';
import { defaultData, emptyState, quietFrame, dataProblems } from './data.ts';
import { Director, counts, terminal, threads } from './director.ts';
import { fitTerms, aimHolds, leadAim } from './fit.ts';
import { Keys, cmp } from './keys.ts';
import { Sifter } from './sifter.ts';
import { Sower } from './sower.ts';
import { GraphLedger } from './graph-ledger.ts';
import { GraphSower } from './graph-sower.ts';
import { patternDocument } from './graph-types.ts';
import type { Pattern, Vocabulary } from '../seeding/pattern-types.ts';
import { instanceView, kernelView, layer2View, type WorldRegistry } from './views.ts';
import type {
  Counts,
  DeliveryView,
  FitRequest,
  HookCtx,
  KernelView,
  Layer2View,
  Layer3Data,
  Layer3State,
  Log,
  LogEntry,
  SenseFrame,
  SiftPattern,
  Thread,
} from './types.ts';

export interface Layer3Options {
  registry: WorldRegistry;
  data?: Layer3Data;
  salt?: string;
  patterns?: Array<SiftPattern | Pattern>;
  vocabulary?: Vocabulary;
}
export class Layer3 {
  readonly ledger = new GraphLedger(this);
  readonly k: Kernel;
  readonly keys: Keys;
  readonly data: Layer3Data;
  readonly kv: KernelView;
  readonly lv: Layer2View;
  readonly sifter: Sifter;
  readonly sower: Sower;
  director: Director;
  state: Layer3State;
  readonly log: LogEntry[] = [];
  readonly findings: Finding[] = [];
  threadView: Thread[] = [];
  counts: Counts = { A: 0, L: 0, C: 0, S: 0 };
  private boundarySeen = -1;
  private inTick = false;
  private poolDirty = true;
  private snapshot?: { at: number; revision: number; holds: string; nodes: string[]; pool: Layer3State['pool']; evidence: Layer3State['evidence'] };
  /** Pool writes outside the ledger come through the sifter or an atomic sow. */
  invalidatePool(): void { this.poolDirty = true; this.ledger.invalidate(); }
  private evidenceSeen = new Set<string>();
  private pullSeen = new Set<string>();
  private asked = false;
  constructor(
    readonly l2: Layer2,
    readonly opts: Layer3Options,
  ) {
    for (const key of Object.keys(opts))
      if (!['registry', 'data', 'salt', 'patterns', 'vocabulary'].includes(key)) throw new Error(`${key} is not supported yet`);
    this.k = l2.k;
    this.keys = new Keys(this.k.worldSeed, opts.salt);
    this.data = structuredClone(opts.data ?? defaultData());
    const problems = dataProblems(this.data);
    if (problems.length) throw new Error(problems.join('; '));
    this.kv = kernelView(this.k, l2, opts.registry);
    this.lv = layer2View(l2);
    this.state = emptyState(l2.playTotal(), this.data.schedule.slotGap);
    this.director = new Director(this.data, this.writeLog);
    if (this.k.layer3 || l2.hooks.fit || l2.hooks.weigh || l2.hooks.hold || l2.hooks.joint || l2.hooks.onRelease)
      throw new Error('Layer 3 hooks already have an owner');
    // An event-kind-only registry does not replace an attached world's spine authority.
    if (opts.registry.isSpine) l2.worldRegistry = { ...l2.worldRegistry, ...opts.registry };
    this.k.root('director', 'core:seed');
    this.k.frames.demandRoots.add(this.keys.director);
    this.sifter = new Sifter(
      this.k,
      l2,
      this.kv,
      this.keys,
      this.data,
      () => this.state,
      this.writeLog,
      () => { this.invalidatePool(); this.flush(); },
    );
    this.sower = new Sower(
      l2,
      this.kv,
      this.lv,
      this.keys,
      this.data,
      () => this.state,
      this.sifter,
      this.writeLog,
      (req, apply, validate) => {
        const before = structuredClone(this.state);
        try {
          return this.l2.atomicSow(req, (id) => {
            apply(id);
            this.invalidatePool();
            this.flush();
          }, validate);
        } catch (e) {
          this.state = before;
          this.invalidatePool();
          throw e;
        }
      },
    );
    this.attachHooks();
    this.sifter.countsAsThread = (e) => this.ledger.aware(e);
    this.sifter.beforeRetire = () => { this.threadView = this.ledger.refresh(); this.counts = counts(this.threadView); };
    this.sower.graph = new GraphSower(this.sower, this);
    this.k.layer3 = this;
    this.k.persistence.installPack({ id: 'xf.s3.core@1', version: H(s('s3'), hrec(this.data)), contributions: [] });
    this.k.dispatcher.onRelevance((r) => {
      this.syncTempo();
      this.sifter.hear(r);
    });
    this.k.saveHooks.push(() => {
      if (this.inTick) throw new Error('Save must wait for the complete S3 tick boundary');
      this.flush();
    });
    this.k.loadHooks.push(() => this.onLoad());
    this.sifter.active = this.k.settings.current().tempo !== 'off';
    if (opts.vocabulary) l2.reg.vocabulary = structuredClone(opts.vocabulary);
    this.findings.push(...this.installPatterns(opts.patterns ?? []));
    this.state.consumedOutcomes = this.l2.all().flatMap((inst) => inst.st.closed ? [inst.st.closed.event] : []);
    this.flush();
  }
  private writeLog: Log = (kind, rule, data, chain = [], cls = 0, inputs = {}) => {
    const purpose: LogEntry['purpose'] =
      kind === 'slot'
        ? 'schedule'
        : kind === 'evidence'
          ? 'evidence'
          : kind === 'fit'
            ? 'fit'
            : kind === 'match' || kind === 'sow'
              ? 'match'
              : kind === 'withdraw'
                ? 'pending'
                : rule === 'lead-aim'
                  ? 'lead-aim'
                  : rule === 'headroom'
                    ? 'headroom'
                    : rule.includes('peak')
                      ? 'protect-peak'
                      : 'rest';
    this.log.push({
      seq: this.log.length,
      kind,
      at: { game: this.k.now, playTotal: this.l2.playTotal(), playClock: this.l2.arbiter.play },
      purpose,
      class: cls,
      rule,
      inputs: structuredClone(inputs),
      chain: chain.slice(),
      data: structuredClone(data),
    });
  };
  installPatterns(input: Array<SiftPattern | Pattern>): Finding[] {
    this.invalidatePool();
    const patterns = input.map((p) => 'junctures' in p ? patternDocument(p) : p);
    for (const p of patterns) if (p.graph) this.l2.reg.patterns.set(p.id, structuredClone(p.graph));
    this.syncTempo();
    this.registerVocabulary(patterns);
    return this.sifter.install(patterns);
  }
  private registerVocabulary(patterns: SiftPattern[]): void {
    // Installing graphs is an explicit adoption, saved immediately. Loading a
    // record instead reconciles its marker without adopting from current options.
    if (patterns.some((p) => p.graph)) this.state.storyData = true;
    this.reconcileStorySchema();
    for (const [name, values] of [
      ['core:event-kind', ['meta:story']],
      ['core:participant-role', patterns.flatMap((p) => Object.keys(p.roles ?? {}).map((v) => v.slice(1)))],
    ] as Array<[string, string[]]>) {
      const dim = this.k.schema.dims.get(name);
      if (!dim || dim.value.t !== 'enum') continue;
      this.k.schema.dims.set(name, {
        ...dim,
        value: { ...dim.value, values: [...new Set([...dim.value.values, ...values])].sort(cmp) },
      });
    }
  }
  private reconcileStorySchema(): void {
    const declared = this.k.eventKinds.eventKind('meta:story');
    if (!this.state.storyData) {
      if (declared?.dataFields) this.k.eventKinds.unregister('meta:story');
    } else if (!declared?.dataFields) {
      if (declared) this.k.eventKinds.unregister('meta:story');
      this.k.eventKinds.register({ name: 'meta:story', producers: ['s3'],
        dataFields: { pattern: { t: 'text' }, instance: { t: 'ref' }, outcome: { t: 'text' }, kind: { t: 'enum', values: ['resolved', 'failed', 'parked'] }, depth: { t: 'int' } } });
    }
  }
  private syncTempo(): void {
    this.sifter.setActive(this.k.settings.current().tempo !== 'off');
  }
  private ctx(): HookCtx {
    return {
      playClock: this.l2.arbiter.play,
      playTotal: this.l2.playTotal(),
      jointLatched: this.l2.arbiter.jointLatched,
      attention: [...this.l2.port.aspects()].sort(cmp),
    };
  }
  private delivery(input: HookInputs): DeliveryView {
    const d = input.delivery;
    return {
      id: d.id,
      seed: '',
      authored: d.authored,
      pull: d.pull,
      maxWaitPlay: d.maxWait,
      submitted: d.submitted,
      timing: {
        kind: 'message',
        class: d.class as TimingRequest['class'],
        purpose: d.purpose as TimingRequest['purpose'],
        importance: 'normal',
        tolerates: {},
        maxWait: { clock: 'play', s: d.maxWait },
        intensity: d.intensity,
      },
      window: input.window as DeliveryView['window'],
    };
  }
  private attachHooks(): void {
    this.l2.hooks.weigh = (req) => this.weigh(req);
    this.l2.hooks.hold = (inputs) =>
      !!this.director.hold(
        {
          playClock: this.director.playClock,
          playTotal: inputs.playTotal,
          jointLatched: inputs.jointLatched,
          attention: inputs.aspects,
        },
        this.delivery(inputs),
      );
    this.l2.hooks.joint = (inputs) =>
      this.director.joint({ ...this.ctx(), attention: inputs.aspects }, this.asked) !== null;
    this.l2.hooks.onRelease = (inputs) => {
      this.director.hold(
        { ...this.ctx(), playClock: this.director.playClock },
        { ...this.delivery(inputs), pull: true },
      );
      this.director.onRelease(this.delivery(inputs));
    };
    this.l2.hooks.fitReport = (report, doc, terms, window) => {
      report.fit = {
        policy: 'world',
        terms: structuredClone(terms),
        ...(window
          ? {
              aim: {
                ...leadAim(window),
                wouldHold: aimHolds(window, 0, report.timing.firstDelivery?.maxWait.s ?? 0, false, this.data),
              },
            }
          : {}),
        notFitted: this.notFitted(doc),
      };
    };
  }
  private notFitted(doc: CompiledSeed): Array<{ part: string; reason: 'later-capability' }> {
    const requested = new Set<string>();
    for (const [key, value] of Object.entries({ ...(doc.latitude as object), ...(doc.adapt as object) }))
      if (value) requested.add(key);
    return [...requested].sort(cmp).map((part) => ({ part, reason: 'later-capability' }));
  }
  private weigh(input: WorldFitInput): number[] {
    const existing = this.lv.instance(input.id),
      doc = input.document as CompiledSeed;
    const seed = existing ?? {
      id: input.id,
      template: { id: input.template, pack: input.pack, version: doc.version },
      level: doc.level,
      source: { by: 'pack' as const, layer: 'authored' },
      sowSeq: input.sowSeq,
      state: 'sown',
      roles: {},
      beats: [],
      displays: [],
      responses: [],
      draws: {},
      closingPending: false,
    };
    const req: FitRequest = {
      seed: { ...seed, document: doc },
      choice: {
        key: input.choice,
        kind: input.choice.startsWith('cast:')
          ? 'cast'
          : input.choice.startsWith('alt:')
            ? 'alternate'
            : (input.choice as 'mode' | 'variant'),
        ...(input.choice.startsWith('cast:') ? { role: input.choice.slice(5) } : {}),
      },
      options: input.options,
      kernel: this.kv,
      layer2: { ...this.lv, claimConflict: (n, span, share) => this.l2.claimConflict(n, span, share, input.id) },
      at: this.k.now,
      fitCap: this.l2.tun.fitCap,
    };
    const terms = fitTerms(req, this.data);
    if (input.report) input.report[input.choice] = structuredClone(terms);
    else if (terms.some((t) => t.raw !== 0))
      this.writeLog('fit', 'world-fit', { choice: input.choice, terms }, [input.id]);
    return terms.map((t) => t.raw);
  }
  /** Tick boundary host: run prior kernel work, then S3, then S2's release step. */
  advancePlay(to: number, frame: (at: number) => SenseFrame = quietFrame, beforeSecond?: (at: number) => void): void {
    if (this.inTick) throw new Error('S3 tick is not reentrant');
    this.inTick = true;
    try {
      this.l2.advancePlay(
        to,
        (at) => {
          this.k.settle();
          this.syncTempo();
          const f = frame(at);
          this.tick(f);
          this.k.settle();
        },
        beforeSecond ? (at) => { this.invalidatePool(); beforeSecond(at); } : (() => {}),
      );
      this.refresh();
      this.flush();
    } finally {
      this.inTick = false;
    }
  }
  tick(f: SenseFrame): void {
    this.syncTempo();
    const outcomes: Array<{ level: string }> = [];
    for (const inst of this.l2.all())
      if (inst.st.closed?.witnessed && !this.state.consumedOutcomes.includes(inst.st.closed.event)) {
        this.state.consumedOutcomes.push(inst.st.closed.event);
        this.state.consumedOutcomes.sort(cmp);
        outcomes.push({ level: inst.st.document.level });
      }
    if (this.director.tick({ ...f, at: this.l2.arbiter.play }, outcomes))
      this.state.openLockUntil = Math.max(
        this.state.openLockUntil,
        this.l2.playTotal() + this.data.pacing.arcNoNewThread,
      );
    this.refresh();
    const slot = this.state.slots.open.next;
    this.sower.resolve(this.counts);
    if (slot !== this.state.slots.open.next) this.invalidatePool();
  }
  /** Also usable by a host that advances game windows without play time (sleep/wait/catch-up). */
  boundary(): void {
    const boundary = this.k.evolution.cursor;
    const lag = Math.max(0, ...[...this.k.evolution.processes.values()].map((p) => p.lag ?? 0));
    if (this.sifter.boundary(boundary * this.k.config.wSim, lag)) this.boundarySeen = boundary;
  }
  onDilemma(d: import('../frames.ts').Dilemma): void {
    this.syncTempo();
    if (!this.sifter.active) return;
    this.invalidatePool();
    for (const p of this.sifter.patterns.values()) if (p.graph && Object.values(p.graph.junctures).some((j) => j.fn === 'demand'))
      this.state.buffer.push({ pattern: p.id, version: p.version, dilemma: structuredClone(d),
        event: { id: d.id, creator: this.keys.director, cause: d.cause, name: '@dilemma', kind: '@dilemma', time: this.k.now, participants: [], effects: [], causes: [], witnesses: [] } });
  }
  get pending(): number {
    if (!this.sifter) return 0;
    const lag = Math.max(0, ...[...this.k.evolution.processes.values()].map((p) => p.lag ?? 0));
    const horizon = (this.k.evolution.cursor - lag) * this.k.config.wSim;
    return (
      (this.boundarySeen !== this.k.evolution.cursor ? 1 : 0) +
      this.state.buffer.filter((b) => b.event.time <= horizon).length
    );
  }
  run(budget: Budget): number {
    const before = this.sifter.work,
      lag = Math.max(0, ...[...this.k.evolution.processes.values()].map((p) => p.lag ?? 0));
    this.syncTempo();
    if (this.sifter.boundary(this.k.evolution.cursor * this.k.config.wSim, lag, budget))
      this.boundarySeen = this.k.evolution.cursor;
    return Math.max(1, this.sifter.work - before);
  }
  refresh(): void {
    this.director.reconcileHolds(
      new Set(this.l2.all().flatMap((i) => i.st.deliveries.filter((d) => d.state === 'queued').map((d) => d.id))),
    );
    this.threadView = [...this.sifter.patterns.values()].some((p) => p.graph) ? this.ledger.refresh(this.inTick) : threads(this.lv.instances(), this.l2.playTotal(), this.data);
    this.counts = counts(this.threadView);
    const b = this.data.threads,
      c = this.counts;
    if (c.A > b.maxAttended || c.L > b.maxLive || c.C > b.maxClimactic || c.S > b.maxSimmering)
      this.writeLog('budget', 'over-budget', { ...c });
    let withdrew = false;
    this.state.pending = this.state.pending.filter((p) => {
      const inst = this.lv.instance(p.instance);
      if (!inst || terminal(inst.state) || inst.displays.length) return false;
      if (this.l2.playTotal() - p.sownAt <= b.pendingLifetime) return true;
      this.l2.sourceWithdraw(p.instance, 'pending', this.keys.withdraw(p.instance));
      withdrew = true;
      this.writeLog(
        'withdraw',
        'pending',
        { seed: p.instance, sownAt: p.sownAt, age: this.l2.playTotal() - p.sownAt },
        [p.instance],
        3,
      );
      return false;
    });
    if (withdrew) {
      this.threadView = [...this.sifter.patterns.values()].some((p) => p.graph) ? this.ledger.refresh(this.inTick) : threads(this.lv.instances(), this.l2.playTotal(), this.data);
      this.counts = counts(this.threadView);
    }
    const closings = this.state.pool.map((e) => e.graph?.closing);
    this.sower.graph?.refresh();
    if (this.state.pool.some((e, i) => e.graph?.closing !== closings[i])) this.invalidatePool();
    this.asked = false;
    for (const inst of this.l2.all())
      for (const d of inst.st.deliveries)
        if (d.state === 'queued' && d.pull && !this.pullSeen.has(d.id)) {
          this.pullSeen.add(d.id);
          this.asked = true;
        }
    this.logEvidence();
  }
  private logEvidence(): void {
    const settings = this.k.settings.current();
    if (settings.noticing === 'off') return;
    for (const inst of this.l2.all()) {
      const view = instanceView(inst);
      for (const d of inst.st.deliveries) {
        if (!d.offerEvent) continue;
        const frag = inst.st.closure.fragments.find((f) => f.id === d.fragment);
        const features = this.l2.reg.skeleton(inst.st.document, frag, d.provenance.channel),
          exclusions = settings.storyExclusions ?? [];
        if (
          (frag?.content ?? []).some(
            (c) =>
              this.l2.reg.classes.get(c.class)?.sensitive ||
              settings.classExclusions.includes(c.class) ||
              exclusions.some((e) => e.kind === 'class' && e.value === c.class),
          ) ||
          Object.values(d.bindings).some(
            (n) => exclusions.some((e) => e.kind === 'npc' && e.value === n),
          )
        )
          continue;
        const visibleFeatures = Object.fromEntries(
          Object.entries(features).filter(
            ([key, value]) => !exclusions.some((e) => (e.kind === key || e.kind === 'tag') && e.value === value),
          ),
        );
        for (const display of view.displays.filter((v) => v.delivery === d.id)) {
          const record = inst.st.record.find(
            (r) => r.kind === 'display' && r.data.delivery === d.id && r.data.grade === display.grade,
          );
          if (
            !record ||
            record.at < (settings.modelFloor ?? -Infinity) ||
            this.k.settings.at(record.at).noticing === 'off'
          )
            continue;
          const key = `display:${d.id}:${display.grade}`;
          if (this.evidenceSeen.has(key)) continue;
          this.evidenceSeen.add(key);
          this.writeLog(
            'evidence',
            'offer-displayed',
            {
              delivery: d.id,
              features: visibleFeatures,
              channel: d.provenance.channel,
              class: d.timing.class,
              purpose: d.timing.purpose,
              grade: display.grade,
              playTotal: display.playTotal,
            },
            [d.offerEvent],
          );
        }
        for (const response of view.responses.filter((r) => r.delivery === d.id)) {
          if (
            response.game < (settings.modelFloor ?? -Infinity) ||
            this.k.settings.at(response.game).noticing === 'off'
          )
            continue;
          const key = `response:${d.id}:${response.kind}:${response.playTotal}`;
          if (this.evidenceSeen.has(key)) continue;
          this.evidenceSeen.add(key);
          this.writeLog(
            'evidence',
            'response',
            { delivery: d.id, kind: response.kind, playTotal: response.playTotal },
            [d.offerEvent],
          );
        }
      }
    }
  }
  /** Persist only copied descriptors, with roots for both held matches and buffered emissions. */
  writeSkeleton(thread: Thread): void { this.writeLog('match', 'skeleton', { thread: thread.id, tokens: thread.tokens }); }
  logGraphGate(gate: number, entry: string, condition?: string): void { this.writeLog('sow', `gate-${gate}`, { entry, condition }); }
  logGraphRepair(entry: string, seed: string): void { this.writeLog('match', 'sow-repaired', { entry, seed }, [seed]); }
  flush(): void {
    if (!this.sifter) return;
    const holds = JSON.stringify(this.l2.all().map((i) => [i.id, i.st.state,
      i.st.deliveries.some((d) => ['closing', 'coda'].includes(d.what) && ['queued', 'released'].includes(d.state)),
      Object.entries(i.st.roles).map(([key, role]) => [key, role.cast, bound(i.st.document.roles[key].identity).value])]));
    const cached = this.snapshot, record = this.k.retention.seeds.get(this.keys.record);
    if (this.inTick && !this.poolDirty && cached && cached.at === this.k.now && cached.revision === this.k.revision
      && cached.holds === holds && record && record.actor === undefined && record.nodes.length === cached.nodes.length
      && record.nodes.every((n, i) => n === cached.nodes[i])) {
      this.k.assertWritable();
      // These detached subtrees cannot be edited by subsequent live-state writes. Save and
      // public flush boundaries always rebuild them; controlled ticks copy only the small state.
      record.state = { ...structuredClone({ ...this.state, pool: [], evidence: [] }), pool: cached.pool, evidence: cached.evidence };
      return;
    }
    const nodes = new Set<string>();
    for (const e of this.state.pool) {
      for (const s of e.stages) nodes.add(s.event);
      if (e.story) nodes.add(e.story);
      if (e.graph) for (const j of Object.values(e.graph.junctures)) if (j.filler) {
        if ('event' in j.filler.ref) nodes.add(j.filler.id);
        else for (const cause of j.filler.causes ?? []) if (this.kv.event(cause)) nodes.add(cause);
      }
    }
    for (const b of this.state.buffer) if (!b.change && !b.dilemma) nodes.add(b.event.id);
    const evidence = new Map(this.state.evidence.map((e) => [e.id, e]));
    // S2 owns the handed-over roots. S3 keeps their entire event closure reconstructible until
    // the last live/closing consumer releases it, even after the pool entry has been reclaimed.
    const held = new Set(nodes);
    for (const inst of this.l2.all().filter((i) => !terminal(i.st.state) || instanceView(i).closingPending))
      for (const [key, r] of Object.entries(inst.st.roles)) {
        const fixed = bound(inst.st.document.roles[key].identity).value;
        const n = r.cast ?? (fixed ? this.k.expandId(fixed) : undefined);
        if (n && this.kv.kind(n) && this.k.schema.isKind(this.kv.kind(n)!, 'core:event')) held.add(n);
      }
    for (const n of held) {
      const e = this.kv.event(n) ?? evidence.get(n);
      if (e) {
        const own = this.k.events.mintedSpec(n, e.provenance ? { descriptor: e, provenance: e.provenance } : undefined);
        const facts = own
          ? {
              ...e,
              ...own,
              participants: own.participants ?? [],
              effects: own.effects ?? [],
              causes: own.causes ?? [],
              witnesses: own.witnesses ?? [],
            }
          : e;
        evidence.set(n, facts);
        for (const ref of [facts.creator, facts.cause, facts.place, facts.served, ...facts.causes,
          ...facts.witnesses, ...facts.participants.map((p) => p.who), ...facts.effects.map((ef) => ef.on)]) {
          if (ref && this.kv.kind(ref) && this.k.schema.isKind(this.kv.kind(ref)!, 'core:event')) held.add(ref);
        }
      }
    }
    this.state.evidence = [...evidence.values()].filter((e) => held.has(e.id)).sort((a, b) => cmp(a.id, b.id));
    const sorted = [...nodes].sort(cmp), prior = this.k.retention.seeds.get(this.keys.record);
    // The record's state is persisted data; only its explicit nodes participate in retention.
    // Keep the snapshot fresh without invalidating the whole kernel when its roots did not change.
    const snapshot = structuredClone(this.state);
    this.k.assertWritable();
    if (prior && prior.actor === undefined && prior.nodes.length === sorted.length && prior.nodes.every((n, i) => n === sorted[i])) prior.state = snapshot;
    else this.k.retention.setSeed({ id: this.keys.record, state: snapshot, nodes: sorted });
    this.snapshot = { at: this.k.now, revision: this.k.revision, holds, nodes: sorted, pool: snapshot.pool, evidence: snapshot.evidence };
    this.poolDirty = false;
  }
  private onLoad(): void {
    this.invalidatePool(); this.snapshot = undefined;
    const saved = this.k.retention.seeds.get(this.keys.record)?.state as Layer3State | undefined;
    if (saved && saved.schema !== 1 && saved.schema !== 2) throw new Error('Layer3State schema is not supported yet');
    this.state = saved ? structuredClone(saved) : emptyState(this.l2.playTotal(), this.data.schedule.slotGap);
    if (saved?.schema === 1) { this.state.pool = []; this.state.buffer = []; this.state.nudges = []; this.state.skeletons = { seq: 0, ring: [] }; }
    this.state.schema = 2;
    this.state.nudges ??= []; this.state.skeletons ??= { seq: 0, ring: [] };
    this.state.buffer ??= [];
    this.state.evidence ??= [];
    this.state.consumedOutcomes ??= [];
    this.reconcileStorySchema();
    if (this.k.readOnly) {
      this.threadView = threads(this.lv.instances(), this.l2.playTotal(), this.data);
      this.counts = counts(this.threadView);
      return;
    }
    this.log.length = 0;
    this.sower.rivals.length = 0;
    this.evidenceSeen.clear();
    this.ledger.reset();
    this.pullSeen.clear();
    this.director = new Director(this.data, this.writeLog);
    this.boundarySeen = this.k.evolution.cursor;
    this.k.root('director', 'core:seed');
    this.k.frames.demandRoots.add(this.keys.director);
    for (const e of this.state.evidence)
      if (!this.kv.event(e.id) && this.k.persistence.restoreReferencedHeader(e.id)) this.k.events.restoreEvent(e, e.provenance);
    this.sifter.reconcile();
    this.sifter.active = this.k.settings.current().tempo !== 'off';
    this.sifter.syncFrames();
    const lag = Math.max(0, ...[...this.k.evolution.processes.values()].map((p) => p.lag ?? 0));
    this.sifter.sweep(this.k.now, this.k.evolution.cursor * this.k.config.wSim - lag * this.k.config.wSim, false);
    for (const e of this.state.pool.slice()) {
      if (e.stages.some((s) => !this.kv.event(s.event))) {
        this.sifter.drop(e, 'match-lost');
        continue;
      }
      if (!e.graph && e.complete && !e.seed) {
        const sown = this.lv.sownBy(this.keys.decision(this.keys.candidate(e.id, e.stages.length - 1)));
        if (sown.length) {
          e.seed = sown.sort(cmp)[0];
          if (!this.state.pending.some((p) => p.instance === e.seed))
            this.state.pending.push({ instance: e.seed, sownAt: this.l2.playTotal() });
          this.writeLog('match', 'sow-repaired', { entry: e.id, seed: e.seed }, [e.seed]);
        }
      }
    }
    this.refresh();
    this.sower.graph?.repair();
    this.flush();
  }
}
