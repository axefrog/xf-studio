import type {
  Counts,
  DeliveryView,
  HookCtx,
  HoldReason,
  InstanceView,
  Layer3Data,
  Log,
  SenseFrame,
  Thread,
} from './types.ts';
import { aimHolds } from './fit.ts';
import { cmp } from './keys.ts';
import { copySense } from './data.ts';

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export const terminal = (s: string): boolean => ['resolved', 'withered', 'withdrawn'].includes(s);
export class Director {
  A = 0;
  N = 0;
  T = 0;
  engaged = false;
  phase: 'settling' | 'build' | 'peak' | 'fade' | 'rest' = 'settling';
  episodeStart = 0;
  lastEpisode = 0;
  lowHealthPaid = false;
  settleStart = 0;
  peakSince = 0;
  restStart = 0;
  restDistrict: string | null = null;
  R = 0;
  noPushUntil = 0;
  noHighUntil = 0;
  private prev?: SenseFrame;
  private stims: number[] = [];
  private episodeForRest = false;
  private jointEligible = false;
  private distance = 0;
  private stationary = 0;
  private reportedAt = -1;
  private finished = false;
  private holds = new Map<string, HoldReason>();
  private seenHolds = new Set<string>();
  constructor(
    readonly data: Layer3Data,
    private readonly log: Log,
  ) {}
  get playClock(): number {
    return this.prev?.at ?? 0;
  }
  tick(f: SenseFrame, outcomes: Array<{ level: string }> = []): boolean {
    f = copySense(f);
    if (!Number.isInteger(f.at) || (this.prev && f.at !== this.prev.at + 1))
      throw new Error('SenseFrame must arrive once per consecutive play second');
    const p = this.data.pacing,
      w = p.senseWeights,
      prev = f.jump === 'load' ? undefined : this.prev;
    if (f.jump === 'load') {
      this.A = this.N = this.T = 0;
      this.engaged = false;
      this.noPushUntil = this.noHighUntil = 0;
      this.stims = [];
      this.distance = this.stationary = 0;
      this.lastEpisode = 0;
    }
    const engaged = f.hostileAwareNear || f.pursuit;
    this.jointEligible = prev !== undefined && f.jump !== 'load';
    if (engaged && !this.engaged) {
      this.episodeStart = f.at;
      this.lowHealthPaid = false;
      this.episodeForRest = true;
    }
    if (!engaged && this.engaged) this.lastEpisode = f.at - this.episodeStart;
    this.engaged = engaged;
    if (!engaged) this.A *= p.decayA;
    this.N *= p.decayN;
    let s = 0;
    s += w.healthLost * Math.max(0, (prev?.health ?? f.health) - f.health);
    if (engaged && f.health < 0.25 && !this.lowHealthPaid) {
      s += w.lowHealth;
      this.lowHealthPaid = true;
    }
    if (f.downed && !prev?.downed) s += w.downed;
    if (f.hostileAware && !prev?.hostileAware) s += w.combatEntered;
    for (const d of f.hostileDeaths) if (d <= 10) s += w.hostileDeath * (1 - d / 10);
    for (const d of f.civilianDeaths) if (d <= 15) s += w.civilianDeath * (1 - d / 15);
    s += w.heatRise * Math.max(0, f.heatStage - (prev?.heatStage ?? 0));
    if (f.collision) s += w.collision;
    let paid = 0;
    for (const x of this.stims) paid += x;
    const x = Math.max(0, Math.min(w.stim * f.stims, 0.15 - paid));
    s += x;
    this.stims.push(x);
    if (this.stims.length > 9) this.stims.shift();
    if (f.specialEncounter) s += w.special;
    this.A = clamp(this.A + s);
    this.T = Math.max(this.A, this.N);
    const from = this.phase;
    if (!prev || f.jump) {
      this.phase = 'settling';
      this.settleStart = f.at;
    } else
      switch (this.phase) {
        case 'settling':
          if (f.at - this.settleStart >= p.settle) this.phase = 'build';
          break;
        case 'build':
          if (this.T >= p.thetaPeak) {
            this.phase = 'peak';
            this.peakSince = f.at;
          }
          break;
        case 'peak':
          if (f.at - this.peakSince >= p.peakHold && this.T < p.thetaPeak) this.phase = 'fade';
          break;
        case 'fade':
          if (this.T >= p.thetaPeak) {
            this.phase = 'peak';
            this.peakSince = f.at;
          } else if (!engaged && this.T < p.thetaFade) {
            this.phase = 'rest';
            this.restStart = f.at;
            this.restDistrict = f.district;
            this.R = clamp(p.restFactor * (this.episodeForRest ? this.lastEpisode : 0), p.restMin, p.restMax);
            this.episodeForRest = false;
          }
          break;
        case 'rest':
          if (this.T >= p.thetaPeak) {
            this.phase = 'peak';
            this.peakSince = f.at;
          } else if (
            f.at - this.restStart >= this.R ||
            (f.district !== this.restDistrict && f.at - this.restStart >= p.restMin)
          )
            this.phase = 'build';
          break;
      }
    if (from !== this.phase)
      this.log(
        'phase',
        'phase-transition',
        { from, to: this.phase, A: this.A, N: this.N, T: this.T, engaged, R: this.R },
        [],
        3,
        { frame: f },
      );
    let arc = false;
    for (const o of outcomes) {
      if (['gig', 'arc', 'season'].includes(o.level)) {
        this.noPushUntil = Math.max(this.noPushUntil, f.at + p.climaxNoPush);
        this.noHighUntil = Math.max(this.noHighUntil, f.at + p.climaxNoHigh);
      }
      if (['arc', 'season'].includes(o.level)) arc = true;
    }
    this.finished = outcomes.length > 0 || !!f.questCompleted;
    this.distance += f.metresMoved;
    if (f.moving) this.stationary = 0;
    else this.stationary++;
    this.prev = structuredClone(f);
    return arc;
  }
  onRelease(d: Pick<DeliveryView, 'timing'>): void {
    this.N = clamp(this.N + (d.timing.intensity ?? 0), -1, 1);
    this.T = Math.max(this.A, this.N);
  }
  reconcileHolds(queued: ReadonlySet<string>): void {
    for (const [delivery, reason] of this.holds)
      if (!queued.has(delivery)) {
        this.log('hold', 'hold-cleared', { delivery, reason, T: this.T, phase: this.phase }, [delivery], 3);
        this.holds.delete(delivery);
      }
  }
  hold(ctx: HookCtx, d: DeliveryView): HoldReason | undefined {
    const waited = ctx.playClock - d.submitted,
      intensity = d.timing.intensity ?? 0;
    let reason: HoldReason | undefined;
    if (
      !d.pull &&
      d.timing.class !== 0 &&
      d.timing.purpose !== 'close' &&
      !(d.authored && waited >= this.data.aim.relaxAt * d.maxWaitPlay)
    ) {
      if (this.phase === 'settling' || this.phase === 'rest') reason = `phase-${this.phase}`;
      else if ((this.phase === 'peak' || this.phase === 'fade') && intensity > 0) reason = `phase-${this.phase}`;
      else if (this.phase === 'build' && intensity > 1 - this.T) reason = 'headroom';
      else if (
        ctx.playClock < this.noPushUntil ||
        (ctx.playClock < this.noHighUntil && intensity >= this.data.pacing.highIntensity)
      )
        reason = 'climax-rest';
      else if (
        d.timing.purpose === 'introduce' &&
        d.window &&
        aimHolds(d.window, waited, d.maxWaitPlay, ctx.jointLatched, this.data)
      )
        reason = 'lead-aim';
    }
    const before = this.holds.get(d.id);
    if (before && before !== reason)
      this.log('hold', 'hold-cleared', { delivery: d.id, reason: before, T: this.T, phase: this.phase }, [d.id], 3);
    if (reason) {
      const key = d.id + ':' + reason;
      if (!this.seenHolds.has(key)) {
        this.log('hold', reason, { delivery: d.id, reason, T: this.T, phase: this.phase }, [d.id], 3);
        this.seenHolds.add(key);
      }
      this.holds.set(d.id, reason);
    } else this.holds.delete(d.id);
    return reason;
  }
  joint(ctx: HookCtx, asked = false): 'arrived' | 'woke' | 'finished' | 'asked' | null {
    const f = this.prev;
    if (
      !f ||
      !this.jointEligible ||
      this.reportedAt === f.at ||
      f.jump === 'load' ||
      this.engaged ||
      ctx.attention.some((a) => ['driving', 'speaking', 'dialogue'].includes(a))
    )
      return null;
    let result: 'arrived' | 'woke' | 'finished' | 'asked' | null = null;
    if (
      !this.engaged &&
      !ctx.attention.some((a) => ['driving', 'speaking', 'dialogue'].includes(a)) &&
      (f.jump === 'travel' ||
        (this.stationary >= this.data.joint.stationarySeconds && this.distance >= this.data.joint.arrivedMetres))
    ) {
      result = 'arrived';
      this.distance = 0;
    } else if (f.jump === 'sleep' || f.jump === 'wait') result = 'woke';
    else if (this.finished) result = 'finished';
    else if (asked) result = 'asked';
    if (result) this.reportedAt = f.at;
    return result;
  }
}

/** Rebuild connected components each refresh; terminal closing-only members never make a thread live. */
export function threads(instances: InstanceView[], now: number, data: Layer3Data): Thread[] {
  const all = instances.filter((i) => !terminal(i.state) || i.closingPending).sort((a, b) => cmp(a.id, b.id));
  const parents = new Map(all.map((i) => [i.id, i.id]));
  const root = (id: string): string => {
    let p = id;
    while (parents.get(p) !== p) p = parents.get(p)!;
    return p;
  };
  const union = (a: string, b: string) => {
    if (!parents.has(a) || !parents.has(b)) return;
    const x = root(a),
      y = root(b);
    parents.set(cmp(x, y) < 0 ? y : x, cmp(x, y) < 0 ? x : y);
  };
  const anchors = new Map<string, string>();
  for (const i of all) {
    const p = i.growsFrom?.parent ?? i.growsFrom?.looseEnd?.seed;
    if (p) union(i.id, p);
    for (const r of Object.values(i.roles))
      if (r.committed && r.anchor && r.cast) {
        const prior = anchors.get(r.cast);
        if (prior) union(i.id, prior);
        else anchors.set(r.cast, i.id);
      }
  }
  const groups = new Map<string, InstanceView[]>();
  for (const i of all) {
    const r = root(i.id);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  }
  return [...groups.entries()]
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([id, members]) => {
      const displays = members.flatMap((i) => i.displays).filter((d) => d.grade !== 'ambient');
      const aware = displays.length > 0,
        lastPresented = Math.max(-Infinity, ...displays.map((d) => d.playTotal));
      const active = members.filter((i) => !terminal(i.state));
      return {
        id,
        instances: members.map((i) => i.id),
        aware,
        lastPresented,
        engineSown: members.every((i) => i.source.by === 'director'),
        active: active.length > 0,
        live: active.some((i) => i.beats.some((b) => b.state === 'running')),
        climactic: active.some((i) =>
          i.beats.some((b) => b.kind === 'conclusion' && ['available', 'running'].includes(b.state)),
        ),
        status: !aware
          ? 'unseen'
          : now - lastPresented <= data.threads.attendedWindow
            ? 'attended'
            : now - lastPresented <= data.threads.simmerWindow
              ? 'simmering'
              : 'dormant',
      };
    });
}
export function counts(ts: Thread[]): Counts {
  return {
    A: ts.filter((t) => t.status === 'attended' || (!t.aware && t.engineSown && t.active)).length,
    L: ts.filter((t) => (t.aware && t.live) || (!t.aware && t.engineSown && t.active)).length,
    C: ts.filter((t) => t.climactic).length,
    S: ts.filter((t) => t.status === 'simmering').length,
  };
}
