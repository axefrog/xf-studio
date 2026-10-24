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
  patterns?: SiftPattern[];
}
export class Layer3 {
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
  private evidenceSeen = new Set<string>();
  private pullSeen = new Set<string>();
  private asked = false;
  constructor(
    readonly l2: Layer2,
    readonly opts: Layer3Options,
  ) {
    for (const key of Object.keys(opts))
      if (!['registry', 'data', 'salt', 'patterns'].includes(key)) throw new Error(`${key} is not supported yet`);
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
    if (opts.registry.isSpine) l2.worldRegistry = opts.registry;
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
      () => this.flush(),
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
            this.flush();
          }, validate);
        } catch (e) {
          this.state = before;
          throw e;
        }
      },
    );
    this.attachHooks();
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
    this.registerVocabulary(opts.patterns ?? []);
    this.findings.push(...this.sifter.install(opts.patterns ?? []));
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
  installPatterns(patterns: SiftPattern[]): Finding[] {
    this.syncTempo();
    this.registerVocabulary(patterns);
    return this.sifter.install(patterns);
  }
  private registerVocabulary(patterns: SiftPattern[]): void {
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
        beforeSecond ?? (() => {}),
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
    this.sower.resolve(this.counts);
  }
  /** Also usable by a host that advances game windows without play time (sleep/wait/catch-up). */
  boundary(): void {
    const boundary = this.k.evolution.cursor;
    const lag = Math.max(0, ...[...this.k.evolution.processes.values()].map((p) => p.lag ?? 0));
    if (this.sifter.boundary(boundary * this.k.config.wSim, lag)) this.boundarySeen = boundary;
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
    this.threadView = threads(this.lv.instances(), this.l2.playTotal(), this.data);
    this.counts = counts(this.threadView);
    const b = this.data.threads,
      c = this.counts;
    if (c.A > b.maxAttended || c.L > b.maxLive || c.C > b.maxClimactic || c.S > b.maxSimmering)
      this.writeLog('budget', 'over-budget', { ...c });
    this.state.pending = this.state.pending.filter((p) => {
      const inst = this.lv.instance(p.instance);
      if (!inst || terminal(inst.state) || inst.displays.length) return false;
      if (this.l2.playTotal() - p.sownAt <= b.pendingLifetime) return true;
      this.l2.sourceWithdraw(p.instance, 'pending', this.keys.withdraw(p.instance));
      this.writeLog(
        'withdraw',
        'pending',
        { seed: p.instance, sownAt: p.sownAt, age: this.l2.playTotal() - p.sownAt },
        [p.instance],
        3,
      );
      return false;
    });
    this.threadView = threads(this.lv.instances(), this.l2.playTotal(), this.data);
    this.counts = counts(this.threadView);
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
  flush(): void {
    if (!this.sifter) return;
    const nodes = new Set<string>();
    for (const e of this.state.pool) {
      for (const s of e.stages) nodes.add(s.event);
      if (e.story) nodes.add(e.story);
    }
    for (const b of this.state.buffer) nodes.add(b.event.id);
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
    this.k.retention.setSeed({ id: this.keys.record, state: structuredClone(this.state), nodes: [...nodes].sort(cmp) });
  }
  private onLoad(): void {
    const saved = this.k.retention.seeds.get(this.keys.record)?.state as Layer3State | undefined;
    if (saved && saved.schema !== 1) throw new Error('Layer3State schema is not supported yet');
    this.state = saved ? structuredClone(saved) : emptyState(this.l2.playTotal(), this.data.schedule.slotGap);
    this.state.buffer ??= [];
    this.state.evidence ??= [];
    this.state.consumedOutcomes ??= [];
    if (this.k.readOnly) {
      this.threadView = threads(this.lv.instances(), this.l2.playTotal(), this.data);
      this.counts = counts(this.threadView);
      return;
    }
    this.log.length = 0;
    this.sower.rivals.length = 0;
    this.evidenceSeen.clear();
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
      if (e.complete && !e.seed) {
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
    this.flush();
  }
}
