// Deliveries and the arbiter (S2 section 8): everything V perceives from a seed passes through one place.
// A delivery is queued, released once the gates allow it (prepared in a staged batch and then confirmed),
// displayed (reported by the game port, in three grades), and answered. Release is not exposure.
//
// The arbiter holds, delays, expires and releases. It never creates or changes content (S2 section 8.3).

import type { Contribution, Form, GameTime, Id, Region } from '../types.ts';
import { ceilingOf } from '../settings.ts';
import { bound, playOf } from './doc.ts';
import { applyEffects } from './effects.ts';
import { evalPred, roleVerdict } from './eval.ts';
import { claimWins, claimsConflict, effective, verdictOnNode } from './cast.ts';
import * as ids from './ids.ts';
import type { Instance, Layer2 } from './layer2.ts';
import { isTerminal } from './layer2.ts';
import type { DisplayReport } from './port.ts';
import { fragmentOf, isFinal } from './beats.ts';
import { transition, onRoleLost, closeSeed, applyRejection } from './run.ts';
import type {
  AttentionAspect, BeatRuntime, ChannelId, ContentRef, Delivery, ExposureGrade, Fragment, Pred, Receipt, TimingRequest,
} from './types.ts';
import type { StagedBatch } from '../batch.ts';
import { watchFixed } from './watch.ts';

export type SessionState = 'settling' | 'returning' | 'resituating' | 'normal';

const GRADE: Record<ExposureGrade, number> = { ambient: 0, presented: 1, confirmed: 2 };
const DEFAULT_FORBID: readonly AttentionAspect[] = ['combat', 'driving', 'dialogue'];
const IMPORTANCE: Record<TimingRequest['importance'], number> = { high: 3, normal: 2, low: 1 };

export interface ReleaseLogEntry {
  at: number;
  delivery: Id;
  seed: Id;
  class: number;
  channel: ChannelId;
  score: number;
  delta: number;
}

export class Arbiter {
  session: SessionState = 'normal';
  sessionSince = 0;
  play = 0;
  /** Play seconds of the non-class-0 releases still inside the cap window. */
  releases: number[] = [];
  lastRelease = Number.NEGATIVE_INFINITY;
  lastClass0 = Number.NEGATIVE_INFINITY;
  readonly category = new Map<string, number>();
  jointLatched = false;
  /** The cue of `resituating` was released. */
  cueReleased = false;
  readonly log: ReleaseLogEntry[] = [];
  /** The last play second a step ran for. */
  lastStep = -1;
  saveAge = 0;

  playNow(): number {
    return this.play;
  }
}

// ---- submitting ----

const PLAIN_KIND: Record<number, TimingRequest['kind']> = { 0: 'trace', 1: 'pin', 2: 'message', 3: 'call', 4: 'approach' };

/** Roles a beat's fragment uses, mapped to the seed's roles. */
export function rolesOfBeat(inst: Instance, beat: string, frag: Fragment): string[] {
  const b = inst.st.document.beats[beat]!;
  const out = new Set<string>();
  for (const fr of frag.roles) {
    const r = b.bind?.[fr] ?? fr;
    if (inst.st.document.roles[r]) out.add(r);
  }
  return [...out].sort();
}

export function timingFor(l2: Layer2, inst: Instance, channel: ChannelId | undefined): TimingRequest {
  const base: TimingRequest = {
    kind: 'message', class: 2, importance: 'normal', purpose: 'introduce', tolerates: {}, maxWait: { clock: 'play', s: 1800 },
    onExpire: inst.st.source.layer === 'authored' ? 'retry' : 'unattended',
  };
  const merged = { ...base, ...(inst.st.document.timing ?? {}) } as TimingRequest;
  const ch = channel ? l2.reg.channels.get(channel) : undefined;
  if (ch) {
    merged.class = ch.class;
    if (!inst.st.document.timing?.kind) merged.kind = PLAIN_KIND[ch.class]!;
  }
  return merged;
}

/** The first channel in the fragment's ladder that the port reports available and that this delivery has not tried (S2 section 3.4). */
export function pickChannel(l2: Layer2, d: Delivery, frag: Fragment | undefined): ChannelId | undefined {
  const ladder = frag?.channels ?? (d.tried.length > 0 ? d.tried : []);
  const ordered = [...ladder.filter((c) => !d.tried.includes(c)), ...ladder.filter((c) => d.tried.includes(c))];
  for (const c of ordered) if (l2.port.channelAvailable(c) && !d.tried.includes(c)) return c;
  // Every channel has been tried: the last one tried stays usable for a persistent re-release.
  for (const c of ladder) if (l2.port.channelAvailable(c)) return c;
  return undefined;
}

export interface SubmitOpts {
  what?: string;
  suffix?: string;
  gated?: { class: string; intensity: number; ceiling: number; became: string };
  content?: ContentRef;
  pull?: boolean;
  atJoint?: boolean;
  bindings?: Record<string, Id>;
  purpose?: TimingRequest['purpose'];
  closing?: boolean;
}

export function submitDelivery(l2: Layer2, inst: Instance, beat: string | undefined, frag: Fragment | undefined, opts: SubmitOpts = {}): Delivery {
  const st = inst.st;
  const rt = beat ? st.beats[beat] : undefined;
  const n = rt?.releases ?? 0;
  const what = opts.what ?? (frag?.offer ? 'offer' : 'beat');
  let id: Id;
  if (what === 'offer' && beat) id = ids.offerId(inst.id, beat, n);
  else if (beat) id = ids.beatDeliveryId(inst.id, `${beat}${opts.suffix ? `#${opts.suffix}` : ''}`, n);
  else id = ids.beatDeliveryId(inst.id, opts.suffix ?? what, n);
  const existing = st.deliveries.find((d) => d.id === id && d.state !== 'expired' && d.state !== 'withdrawn' && d.state !== 'answered');
  if (existing) return existing;
  const channel = frag?.channels[0];
  const bindings: Record<string, Id> = { ...(opts.bindings ?? {}) };
  if (beat && frag) for (const r of rolesOfBeat(inst, beat, frag)) {
    const c = st.roles[r]?.cast;
    if (c !== undefined) bindings[r] = c;
  }
  const d: Delivery = {
    id, seed: inst.id, what, timing: timingFor(l2, inst, channel), authored: st.source.layer === 'authored', pull: opts.pull ?? false,
    atJoint: opts.atJoint ?? false, bindings, state: 'queued', submitted: l2.arbiter.play, submittedGame: l2.k.now, attempts: 0, tried: [], n,
    provenance: { alternates: beat && rt?.fragment ? { [beat]: rt.fragment } : {}, channel: '', form: opts.gated ? 'implied' : 'standard', why: [] },
  };
  if (beat) d.beat = beat;
  if (frag) d.fragment = frag.id;
  if (opts.content !== undefined) d.content = opts.content;
  else if (frag) d.content = frag.forms.standard;
  if (st.draws.mode) d.provenance.mode = st.draws.mode.value;
  if (st.draws.variant) d.provenance.variant = st.draws.variant.value;
  if (opts.gated) d.provenance.gated = [opts.gated];
  if (opts.purpose) d.timing.purpose = opts.purpose;
  const bd = beat ? st.document.beats[beat] : undefined;
  if (bd?.kind === 'aftermath') d.timing.purpose = 'escalate';
  if (opts.what === 'warning') d.timing.importance = 'high';
  st.deliveries.push(d);
  l2.record(inst, 'beat', { delivery: id, queued: what, beat });
  return d;
}

/** Withdraw every pending (queued, never released) delivery of an instance; a cancellation, sending nothing to V. */
export function withdrawPending(l2: Layer2, inst: Instance, keepClosing = true): void {
  for (const d of inst.st.deliveries) {
    if (d.state === 'queued' && !(keepClosing && (d.what === 'closing' || d.what === 'coda' || d.what === 'news' || d.what === 'notice'))) {
      d.state = 'withdrawn';
      l2.record(inst, 'expired', { delivery: d.id, why: 'withdrawn' });
    }
  }
}

// ---- the step ----

const forbidden = (d: Delivery): Set<AttentionAspect> => {
  const f = new Set<AttentionAspect>(DEFAULT_FORBID);
  for (const [a, m] of Object.entries(d.timing.tolerates)) {
    if (m === 'allow') f.delete(a);
    else if (m === 'forbid') f.add(a);
  }
  return f;
};

function allDeliveries(l2: Layer2): Array<{ inst: Instance; d: Delivery }> {
  const out: Array<{ inst: Instance; d: Delivery }> = [];
  for (const inst of l2.all()) for (const d of inst.st.deliveries) out.push({ inst, d });
  return out;
}

export function hookInputs(l2: Layer2, inst: Instance, d: Delivery, channelClass: number): import('./layer2.ts').HookInputs {
  const s = l2.k.settings.current();
  const ceilings: Record<string, number> = {};
  for (const c of l2.reg.classes.keys()) ceilings[c] = ceilingOf(s, c);
  const doc = inst.st.document;
  const out: import('./layer2.ts').HookInputs = {
    delivery: {
      id: d.id, class: channelClass, purpose: d.timing.purpose, authored: d.authored, pull: d.pull,
      features: { channel: d.provenance.channel, form: d.provenance.form, kind: d.timing.kind },
      maxWait: d.timing.maxWait.s, submitted: d.submitted,
    },
    aspects: [...l2.port.aspects()].sort(), session: l2.arbiter.session, tempo: s.tempo, playTotal: l2.playTotal(),
    settings: { tempo: s.tempo, ceilings }, jointLatched: l2.arbiter.jointLatched,
  };
  if (d.timing.intensity !== undefined) out.delivery.intensity = d.timing.intensity;
  if (!inst.st.committed && inst.st.releaseWindow === undefined) {
    const w = doc.windows.find((x) => !inst.st.latches.includes(x.id) && evalPred(l2, { inst, t: l2.k.now }, x.opens) === 'yes');
    if (w) {
      let level = 0;
      for (const u of w.urgency ?? []) if (evalPred(l2, { inst, t: l2.k.now }, u.when) === 'yes') level = Math.max(level, u.level);
      out.window = { urgency: level, ...(w.lead !== undefined ? { lead: w.lead } : {}) };
    }
  }
  return out;
}

/** The arbiter's step, once a second of play (S2 section 8.3). */
export function arbiterStep(l2: Layer2, s: number): void {
  const A = l2.arbiter;
  A.play = s;
  A.lastStep = s;
  updateSession(l2, s);
  expirations(l2, s);

  // Candidate deliveries.
  type Cand = { inst: Instance; d: Delivery; frag: Fragment | undefined; channel: ChannelId; cls: number; score: number; tie: Id };
  const cands: Cand[] = [];
  const settings = l2.k.settings.current();
  const tempoFactor = settings.tempo === 'calm' ? 2 : settings.tempo === 'restless' ? 0.5 : 1;
  const spacing = l2.tun.spacing * tempoFactor;
  const cap = Math.max(1, Math.floor(l2.tun.cap / tempoFactor));
  A.releases = A.releases.filter((r) => r > s - l2.tun.capWindow);
  for (const { inst, d } of allDeliveries(l2)) {
    if (d.state !== 'queued' || d.stopped) continue;
    const frag = d.fragment ? fragmentOf(inst, d.fragment) : undefined;
    const channel = d.what === 'closing' || d.what === 'coda' || d.what === 'news' || d.what === 'notice' || d.what === 'reply'
      ? (pickContentChannel(l2, inst, d) ?? undefined)
      : pickChannel(l2, d, frag);
    if (channel === undefined) continue;
    const ch = l2.reg.channels.get(channel);
    const cls = ch?.class ?? d.timing.class;
    const closing = d.what === 'closing' || d.what === 'coda' || d.what === 'news';
    // Tempo off: only pull deliveries, deliveries from authored seeds, and closing deliveries pass.
    if (settings.tempo === 'off' && !d.pull && !d.authored && !closing) continue;
    // Gate 1: no vanilla UI state is busy.
    if (l2.port.uiBusy()) continue;
    // Gate 2: none of its forbidden attention aspects is active.
    const asp = l2.port.aspects();
    let blocked = false;
    for (const a of forbidden(d)) if (asp.has(a)) blocked = true;
    if (blocked) continue;
    // Gate 3: the session state and the away overlay.
    if (!sessionAllows(l2, d, cls)) continue;
    if (cls !== 0 && !d.pull) {
      // Gates 4 to 6 apply to the rest.
      if (s - A.lastRelease < spacing) continue;
      if (A.releases.length >= cap) continue;
      const cat = d.timing.category;
      if (cat !== undefined && s - (A.category.get(cat) ?? Number.NEGATIVE_INFINITY) < l2.tun.categoryDefault) continue;
    }
    if (cls === 0 && s - A.lastClass0 < l2.tun.class0Gap) continue;
    // Gate 7: a joint is latched (for an atJoint delivery).
    if (d.atJoint && !A.jointLatched) continue;
    // The phase hook may only remove (S2 section 8.3 step 4); it cannot touch a pull, class-0 or closing delivery.
    if (l2.hooks.hold && !d.pull && cls !== 0 && !closing) {
      d.provenance.channel = channel;
      if (l2.hooks.hold(hookInputs(l2, inst, d, cls))) continue;
    }
    const maxWait = d.timing.maxWait.s || 1;
    const waited = Math.min(1, (s - d.submitted) / maxWait);
    const score = IMPORTANCE[d.timing.importance] + waited + (d.authored ? 1 : 0);
    cands.push({ inst, d, frag, channel, cls, score, tie: ids.arbTie(l2.worldSeed, d.id) });
  }
  cands.sort((a, b) => b.score - a.score || (a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0));
  let releasedMain = false;
  let releasedZero = false;
  let tries = 0;
  for (const c of cands) {
    if (c.cls === 0 ? releasedZero : releasedMain) continue;
    if (tries >= l2.tun.prepareTries) break;
    tries++;
    const ok = prepareAndRelease(l2, c.inst, c.d, c.channel, c.cls, c.score);
    if (ok) {
      if (c.cls === 0) { releasedZero = true; A.lastClass0 = s; } else { releasedMain = true; A.lastRelease = s; A.releases.push(s); if (c.d.timing.category !== undefined) A.category.set(c.d.timing.category, s); }
      if (c.d.atJoint) A.jointLatched = false;
    }
  }
}

function pickContentChannel(l2: Layer2, inst: Instance, d: Delivery): ChannelId | undefined {
  const unit = inst.st.template.pack ? l2.packs.get(inst.st.template.pack)?.text(d.content) : undefined;
  const ladder = unit?.channels ?? ['message'];
  for (const c of ladder) if (l2.port.channelAvailable(c)) return c;
  return undefined;
}

// ---- the session (S2 section 8.2) ----

function sessionAllows(l2: Layer2, d: Delivery, cls: number): boolean {
  const A = l2.arbiter;
  if (l2.port.away() && cls > 1) return false;
  switch (A.session) {
    case 'settling': return d.pull;
    case 'returning': return cls <= 1;
    case 'resituating': return cls === 0 || (cls <= 2 && !A.cueReleased);
    default: return true;
  }
}

function updateSession(l2: Layer2, s: number): void {
  const A = l2.arbiter;
  // The joint latch (S2 section 8.3): the hook reports occurrences; without one, a joint is latched when combat and vehicle states are clear.
  const asp = l2.port.aspects();
  const aspects = [...asp].sort();
  const reported = l2.hooks.joint?.({ aspects, session: A.session });
  if (reported === true) A.jointLatched = true;
  else if (reported === undefined && !asp.has('combat') && !asp.has('driving')) A.jointLatched = true;
  if (asp.has('combat') || asp.has('driving') || asp.has('dialogue')) A.jointLatched = false;
  if (A.session === 'settling' && s - A.sessionSince >= l2.tun.settle) {
    A.session = A.saveAge >= l2.tun.returnAge ? 'returning' : 'resituating';
    A.sessionSince = s;
    A.cueReleased = false;
  } else if (A.session === 'returning' && s - A.sessionSince >= l2.tun.returningCap) {
    A.session = 'resituating';
    A.sessionSince = s;
    A.cueReleased = false;
  } else if (A.session === 'resituating' && (A.cueReleased || s - A.sessionSince >= l2.tun.resituateCap)) {
    A.session = 'normal';
    A.sessionSince = s;
  }
}

// ---- expiry, lapse and timeouts ----

function expirations(l2: Layer2, s: number): void {
  for (const { inst, d } of allDeliveries(l2)) {
    if (isTerminal(inst.st.state) && d.what !== 'closing' && d.what !== 'coda' && d.what !== 'news' && d.what !== 'notice') continue;
    if (d.state === 'queued' && !d.stopped) {
      const closing = d.what === 'closing' || d.what === 'coda' || d.what === 'news';
      const waited = d.timing.maxWait.clock === 'play' ? s - d.submitted : l2.k.now - d.submittedGame;
      const win = d.windowClose && inst.st.releaseWindow !== undefined && inst.st.latches.includes(inst.st.releaseWindow);
      if (!closing && !d.pull && (waited >= d.timing.maxWait.s || win)) expireQueued(l2, inst, d);
    } else if (d.state === 'released' && d.releasedAt !== undefined) {
      const persistent = d.provenance.channel !== '' && l2.reg.channels.get(d.provenance.channel)?.kind === 'persistent';
      if (persistent && s - d.releasedAt >= l2.tun.displayTimeoutPersistent) missed(l2, inst, d, 'timed out unseen');
    } else if (d.state === 'displayed' && d.what === 'offer' && d.lapseAt !== undefined && s >= d.lapseAt) {
      lapse(l2, inst, d);
    }
  }
}

function expireQueued(l2: Layer2, inst: Instance, d: Delivery): void {
  d.state = 'expired';
  l2.record(inst, 'expired', { delivery: d.id, why: 'waited its maxWait unreleased' });
  const rt = d.beat ? inst.st.beats[d.beat] : undefined;
  const how = d.timing.onExpire ?? 'retry';
  if (how === 'retry') {
    if (rt && rt.state === 'available') {
      rt.attempt++;
      resubmit(l2, inst, d);
    }
  } else if (how === 'unattended') {
    if (inst.st.state === 'cast' && inst.st.committed === false) transition(l2, inst, 'unattended', 'T14', 'the first request expired unreleased');
  } else if (how === 'withdraw') {
    l2.withdraw(inst, 'expiry with onExpire: withdraw');
  }
}

function resubmit(l2: Layer2, inst: Instance, old: Delivery): Delivery | undefined {
  if (!old.beat) return undefined;
  const frag = old.fragment ? fragmentOf(inst, old.fragment) : undefined;
  const d = submitDelivery(l2, inst, old.beat, frag, { what: old.what, content: old.content as ContentRef, pull: old.pull });
  d.attempts = old.attempts;
  d.tried = [...old.tried];
  if (d.attempts >= l2.tun.maxAttempts) {
    d.stopped = true;
    l2.record(inst, 'expired', { delivery: d.id, why: 'the total attempt bound was reached: the offer waits for pull' });
  }
  return d;
}

/** A released delivery was never displayed (S2 section 8.5): missed, not declined. */
function missed(l2: Layer2, inst: Instance, d: Delivery, why: string): void {
  d.state = 'expired';
  l2.record(inst, 'missed', { delivery: d.id, why, attempts: d.attempts });
  const rt = d.beat ? inst.st.beats[d.beat] : undefined;
  if (!rt || !d.beat || (d.what !== 'offer' && d.what !== 'beat')) return;
  if (rt.state === 'running') {
    rt.state = 'available';
    rt.since = l2.k.now;
    rt.attempt++;
    const nd = resubmit(l2, inst, d);
    // T11: the first offer, never seen, within the total attempt bound: the seed goes back to cast.
    if (d.what === 'offer' && inst.st.state === 'offered') transition(l2, inst, 'cast', 'T11', 'the first offer was missed');
    void nd;
  }
}

function lapse(l2: Layer2, inst: Instance, d: Delivery): void {
  // An exposed lapse (S2 section 7.4): no event; a `lapse` entry; the lapse content is delivered.
  d.state = 'expired';
  const frag = d.fragment ? fragmentOf(inst, d.fragment) : undefined;
  const o = frag?.offer;
  const beat = d.beat!;
  const rt = inst.st.beats[beat]!;
  const doc = inst.st.document.beats[beat]!;
  l2.record(inst, 'lapse', { delivery: d.id });
  if (o?.lapse.content !== undefined) submitDelivery(l2, inst, beat, undefined, { what: 'reply', suffix: `lapse${d.n}`, content: o.lapse.content, pull: true, purpose: 'callback' });
  const then = o?.lapse.then ?? 'reoffer';
  const first = inst.st.state === 'offered';
  if (then === 'withdraw') {
    l2.withdraw(inst, 'a lapse with then: withdraw');
    return;
  }
  const canReoffer = doc.reoffer !== undefined && rt.offers < doc.reoffer.max;
  if (then === 'reoffer' && canReoffer) {
    setBeatState(l2, inst, beat, 'deferred');
    if (first) transition(l2, inst, 'cast', 'T11', 'the first offer lapsed with reoffers left');
  } else {
    setBeatState(l2, inst, beat, 'done');
    if (first && then === 'unattended') transition(l2, inst, 'unattended', 'T10', 'the first offer lapsed');
    else if (first && then === 'reoffer') transition(l2, inst, 'unattended', 'T10', 'the first offer lapsed with no reoffers left');
  }
}

function setBeatState(l2: Layer2, inst: Instance, beat: string, state: BeatRuntime['state']): void {
  const rt = inst.st.beats[beat]!;
  rt.state = state;
  rt.since = l2.k.now;
  if (isFinal(state) || state === 'deferred') rt.finalAt = l2.k.now;
  l2.record(inst, 'beat', { beat, to: state });
}

// ---- prepare, then confirm (S2 section 8.4) ----

interface Prepared {
  batch?: StagedBatch;
  commits: Array<(inst: Instance) => void>;
}

function prepareAndRelease(l2: Layer2, inst: Instance, d: Delivery, channel: ChannelId, cls: number, score: number): boolean {
  const st = inst.st;
  const k = l2.k;
  const closing = d.what === 'closing' || d.what === 'coda' || d.what === 'news' || d.what === 'notice' || d.what === 'reply' || d.what === 'signpost';
  let prepared: Prepared = { commits: [] };
  if (!closing && d.beat) {
    const r = prepare(l2, inst, d);
    if (!r.ok) {
      if (r.hard) l2.record(inst, 'prepare-failed', { delivery: d.id, why: r.reason });
      return false;
    }
    prepared = r.prepared;
  }
  // Confirm: the batch commits, and the delivery is released and handed to the game port.
  if (prepared.batch) prepared.batch.commit();
  for (const f of prepared.commits) f(inst);
  d.state = 'released';
  d.releasedAt = l2.arbiter.play;
  d.attempts++;
  d.tried = d.tried.includes(channel) ? d.tried : [...d.tried, channel];
  d.provenance.channel = channel;
  d.timing = { ...d.timing, class: cls as TimingRequest['class'] };
  if (d.timing.kind === 'message' && cls !== 2) d.timing.kind = PLAIN_KIND[cls]!;
  d.words = l2.renderWords(inst, d);
  const rt = d.beat ? st.beats[d.beat] : undefined;
  if (rt && (d.what === 'offer' || d.what === 'beat')) {
    if (rt.state === 'available') { rt.state = 'running'; rt.since = k.now; }
    rt.releases++;
  }
  if (d.fragment) {
    const u = l2.global.fragmentUses[d.fragment] ?? { count: 0, lastAt: 0, lastOffer: 0 };
    l2.global.fragmentUses[d.fragment] = { count: u.count + 1, lastAt: k.now, lastOffer: l2.global.offerCount };
  }
  if (cls >= 2) d.retractUntil = l2.arbiter.play + l2.tun.retractWindow;
  if (cls <= 2 && cls !== 0 && l2.arbiter.session === 'resituating') l2.arbiter.cueReleased = true;
  l2.arbiter.log.push({ at: l2.arbiter.play, delivery: d.id, seed: inst.id, class: cls, channel, score, delta: 0 });
  l2.record(inst, 'release', { delivery: d.id, channel, class: cls, what: d.what });
  l2.hooks.onRelease?.(hookInputs(l2, inst, d, cls));
  // T7 / T8: the first release commits the seed.
  if (st.state === 'cast' && !closing) {
    if (d.what === 'offer') transition(l2, inst, 'offered', 'T7', 'the first offer was released');
    else transition(l2, inst, 'running', 'T8', 'the first beat was released');
  }
  l2.queueReeval(inst, 'release');
  return true;
}

/** Start a beat with no channel at once. Before the first release it is a release: prepared, then confirmed. */
export function startDirect(l2: Layer2, inst: Instance, beat: string): void {
  const st = inst.st;
  const rt = st.beats[beat]!;
  const frag = rt.fragment ? fragmentOf(inst, rt.fragment) : undefined;
  const d = submitDelivery(l2, inst, beat, frag, { what: 'beat' });
  d.state = 'queued';
  const r = prepare(l2, inst, d);
  if (!r.ok) {
    d.state = 'withdrawn';
    return;
  }
  if (r.prepared.batch) r.prepared.batch.commit();
  for (const f of r.prepared.commits) f(inst);
  d.state = 'answered';
  l2.arbiter.log.push({ at: l2.arbiter.play, delivery: d.id, seed: inst.id, class: 0, channel: '', score: 0, delta: 0 });
  rt.state = 'running';
  rt.since = l2.k.now;
  rt.releases++;
  l2.record(inst, 'release', { delivery: d.id, direct: true });
  if (st.state === 'cast') transition(l2, inst, 'running', 'T8', 'the first beat started without a channel');
  l2.completeNow(inst, beat);
}

type PrepareResult = { ok: true; prepared: Prepared } | { ok: false; reason: string; hard: boolean };

function prepare(l2: Layer2, inst: Instance, d: Delivery): PrepareResult {
  const st = inst.st;
  const k = l2.k;
  const t = k.now;
  const first = !st.committed;
  const doc = st.document;
  // 1. Re-evaluate the windows: a delivery with `windowClose` needs the release window (for a first release, some window) open.
  const opens = (w: (typeof doc.windows)[number]): boolean => !st.latches.includes(w.id) && evalPred(l2, { inst, t }, w.opens) === 'yes' && (w.closes === undefined || evalPred(l2, { inst, t }, w.closes) === 'no');
  if (d.windowClose || first) {
    const ok = first ? doc.windows.some(opens) : st.releaseWindow !== undefined && opens(doc.windows.find((w) => w.id === st.releaseWindow)!);
    if (!ok && (d.windowClose || first)) return { ok: false, reason: 'no window is open', hard: true };
  }
  // 2. Re-check the casts the delivery binds.
  const bindRoles = Object.keys(d.bindings);
  for (const r of bindRoles) {
    const rs = st.roles[r];
    if (!rs || rs.shrunk) continue;
    if (rs.cast === undefined && rs.standIn === undefined) return { ok: false, reason: `the role "${r}" is not cast`, hard: true };
    if (rs.cast === undefined) continue;
    const role = doc.roles[r]!;
    const { must } = effective(role, rs);
    let verdict: 'yes' | 'no' | 'maybe' = 'yes';
    for (const m of must) {
      const v = roleVerdict(l2, { inst, t }, r, m);
      if (v.v === 'no') { verdict = 'no'; break; }
      if (v.v === 'maybe') verdict = 'maybe';
    }
    if (verdict === 'maybe') return { ok: false, reason: `the role "${r}" cannot be read yet`, hard: false };
    if (verdict === 'no') {
      // The role is lost (S2 section 5.5), committed or not.
      l2.record(inst, 'lost', { role: r, committed: rs.committed });
      onRoleLost(l2, inst, r);
      return { ok: false, reason: `the role "${r}" no longer meets its requirements`, hard: true };
    }
    // 3. Claims: this seed must still win every claim on the cast.
    for (const other of l2.live()) {
      if (other === inst) continue;
      for (const [orole, ors] of Object.entries(other.st.roles)) {
        if (ors.cast !== rs.cast || ors.shrunk) continue;
        const me = { inst, role: r, committed: rs.committed };
        const them = { inst: other, role: orole, committed: ors.committed };
        if (claimsConflict(l2, me, them) && !claimWins(me, them)) {
          l2.record(inst, 'lost', { role: r, claim: other.id });
          onRoleLost(l2, inst, r);
          return { ok: false, reason: `another seed holds "${r}"`, hard: true };
        }
      }
    }
  }
  const need = first ? Object.keys(doc.roles).filter((r) => { const rs = st.roles[r]!; return (rs.cast !== undefined || rs.standIn !== undefined) && !rs.committed && !rs.shrunk; }) : bindRoles.filter((r) => { const rs = st.roles[r]; return rs && !rs.committed && !rs.shrunk && (rs.cast !== undefined || rs.standIn !== undefined); });
  if (!first && need.length === 0) return { ok: true, prepared: { commits: [] } };
  // 4. For a first release or an uncommitted role: open a staged batch, and commit the roles inside it.
  const batch = k.stage();
  const commits: Array<(i: Instance) => void> = [];
  try {
    const window = first ? doc.windows.find(opens) : undefined;
    const installed = batch.write(() => commitRoles(l2, inst, need, d.id, commits));
    // 5. The fixed-part watch on everything in the batch.
    const rejected = watchFixed(l2, inst, batch, installed);
    if (rejected.length > 0) {
      batch.discard();
      l2.record(inst, 'prepare-failed', { delivery: d.id, why: 'a fixed part was rejected', parts: rejected.map((r) => r.index) });
      for (const rj of rejected) applyRejection(l2, inst, rj);
      return { ok: false, reason: 'a fixed part was rejected', hard: false };
    }
    if (first) {
      commits.push((i) => {
        i.st.committed = true;
        i.st.released = true;
        if (window) i.st.releaseWindow = window.id;
        i.st.form = 'standard';
        l2.record(i, 'commit', { delivery: d.id, window: window?.id });
      });
    }
  } catch (e) {
    if (k.batch) batch.discard();
    throw e;
  }
  return { ok: true, prepared: { batch, commits } };
}

import { commitRoles } from './commit.ts';

// ---- display and exposure (S2 section 8.5) ----

export function findDelivery(l2: Layer2, id: Id): { inst: Instance; d: Delivery } | undefined {
  for (const inst of l2.all()) {
    const d = inst.st.deliveries.find((x) => x.id === id);
    if (d) return { inst, d };
  }
  return undefined;
}

/** A display report from the game port (S2 section 8.5). */
export function displayReport(l2: Layer2, r: DisplayReport): void {
  const hit = findDelivery(l2, r.delivery);
  if (!hit) return;
  const { inst, d } = hit;
  if (d.state === 'queued' || d.state === 'withdrawn' || d.state === 'answered') return;
  const st = inst.st;
  const best = d.grade === undefined || GRADE[r.grade] > GRADE[d.grade] ? r.grade : d.grade;
  d.grade = best;
  inst.st.attendedAt = r.atPlay;
  const isOffer = d.what === 'offer';
  const displayed = isOffer ? best === 'confirmed' : GRADE[best] >= GRADE.presented;
  if (GRADE[best] >= GRADE.presented) upsertReceipt(l2, inst, d, r);
  if (displayed && d.state === 'released') {
    d.state = 'displayed';
    d.displayedAt = r.atPlay;
    l2.record(inst, 'display', { delivery: d.id, grade: best, channel: r.channel, ...(r.cue ? { cue: r.cue } : {}) });
    if (isOffer) {
      offerDisplayed(l2, inst, d, r);
    }
  }
  if (r.final && !displayed && d.state === 'released') {
    // A transient delivery's life is over without being seen properly: released again once on a different channel, then missed.
    const frag = d.fragment ? fragmentOf(inst, d.fragment) : undefined;
    const other = frag ? frag.channels.find((c) => !d.tried.includes(c) && l2.port.channelAvailable(c)) : undefined;
    if (other !== undefined && best === 'ambient' && d.attempts < l2.tun.maxAttempts) {
      d.state = 'queued';
      d.submitted = l2.arbiter.play;
      l2.record(inst, 'beat', { delivery: d.id, again: other });
    } else missed(l2, inst, d, 'transient and not seen properly');
  }
  l2.queueReeval(inst, 'display');
  void st;
}

function upsertReceipt(l2: Layer2, inst: Instance, d: Delivery, r: DisplayReport): void {
  const st = inst.st;
  const cur = st.receipts.find((x) => x.delivery === d.id);
  const rec: Receipt = cur ?? { delivery: d.id, seed: inst.id, template: st.template.id, grade: r.grade, channels: [], cites: [], cue: {}, at: l2.k.now, playTotal: l2.playTotal() };
  if (d.beat) rec.beat = d.beat;
  rec.what = d.what;
  if (d.fragment) rec.fragment = d.fragment;
  if (GRADE[r.grade] >= GRADE[rec.grade]) rec.grade = r.grade;
  if (!rec.channels.includes(r.channel)) rec.channels = [...rec.channels, r.channel].sort();
  if (r.cue) rec.cue = { ...rec.cue, ...Object.fromEntries(Object.entries(r.cue).filter(([, v]) => v !== undefined)) };
  if (!cur) st.receipts.push(rec);
}

function offerDisplayed(l2: Layer2, inst: Instance, d: Delivery, r: DisplayReport): void {
  const k = l2.k;
  const st = inst.st;
  const beat = d.beat!;
  const rt = st.beats[beat]!;
  rt.offers++;
  l2.global.offerCount++;
  // The offer event: minted only once the offer is displayed, with V as witness (S2 section 8.5).
  const ev = k.events.mintEvent({
    creator: inst.id, cause: inst.id, name: `offer:${beat}:${d.n}`, time: k.now, kind: 'offer',
    participants: [{ who: k.vId, role: 'participant' }, ...(d.bindings[Object.keys(d.bindings)[0] ?? ''] ? [{ who: d.bindings[Object.keys(d.bindings).sort()[0]!]!, role: 'actor' }] : [])],
    witnesses: [k.vId],
  });
  k.events.makeCanon(ev, 'observed', inst.id);
  d.offerEvent = ev;
  const frag = d.fragment ? fragmentOf(inst, d.fragment) : undefined;
  if (frag?.offer) d.lapseAt = l2.arbiter.play + frag.offer.lapse.after.s;
  l2.record(inst, 'display', { offer: ev, class: d.timing.class, purpose: d.timing.purpose, pull: d.pull, authored: d.authored, features: { channel: d.provenance.channel }, atPlay: r.atPlay });
}

// ---- V's responses (S2 section 7.4) ----

export type Response = { kind: 'action'; id: string } | { kind: 'decline'; id: string } | { kind: 'null' } | { kind: 'retract' };

export function respondTo(l2: Layer2, id: Id, resp: Response): boolean {
  const hit = findDelivery(l2, id);
  if (!hit) return false;
  const { inst, d } = hit;
  const st = inst.st;
  if (d.what !== 'offer' || (d.state !== 'displayed' && d.state !== 'released')) return false;
  const k = l2.k;
  const beat = d.beat!;
  const rt = st.beats[beat]!;
  const frag = fragmentOf(inst, d.fragment!)!;
  const o = frag.offer!;
  const doc = st.document.beats[beat]!;
  const first = st.state === 'offered';

  if (resp.kind === 'retract') {
    // One input, within the retract window, for a push of class 2 or above (S2 section 8.3): quiet.
    if (d.timing.class < 2 || (d.retractUntil !== undefined && l2.arbiter.play > d.retractUntil)) return false;
    d.state = 'answered';
    l2.record(inst, 'beat', { retracted: d.id });
    l2.record(inst, 'transition', { retracted: true, delivery: d.id });
    for (const tag of frag.content ?? []) {
      const s = k.settings.current();
      k.settings.set({ content: { softExclusions: [...s.content.softExclusions, { class: tag.class, level: tag.intensity }] } });
    }
    if (o.retractQuietly !== undefined) submitDelivery(l2, inst, beat, undefined, { what: 'reply', suffix: 'retract', content: o.retractQuietly, pull: true });
    withdrawPending(l2, inst);
    transition(l2, inst, 'withdrawn', 'T10a', 'V retracted the offer', { quiet: true });
    return true;
  }
  // A response is recorded once; a second answer to the same offer is ignored (S2 section 7.4).
  if (rt.response !== undefined && rt.responseDelivery === d.id) return false;
  const action = resp.kind === 'action' ? o.actions.find((a) => a.id === resp.id) : undefined;
  const decline = resp.kind === 'decline' ? o.decline.find((a) => a.id === resp.id) : undefined;
  if (resp.kind === 'action' && !action) return false;
  if (resp.kind === 'decline' && !decline) return false;
  const kindStr = resp.kind === 'null' ? 'null' : `${resp.kind}:${resp.id}`;
  d.state = 'answered';
  rt.response = kindStr;
  rt.responseDelivery = d.id;
  // The response event, with V as witness (S2 section 3.2).
  const ev = k.events.mintEvent({
    creator: inst.id, cause: inst.id, name: `response:${beat}:${d.n}`, time: k.now, kind: 'response',
    participants: [{ who: k.vId, role: 'actor' }], witnesses: [k.vId], causes: d.offerEvent ? [d.offerEvent] : [],
  });
  k.events.makeCanon(ev, 'observed', inst.id);
  l2.record(inst, 'response', { event: ev, kind: kindStr, offer: d.offerEvent, sincePlay: l2.arbiter.play - (d.displayedAt ?? l2.arbiter.play), beat });

  if (action) {
    applyEffects(l2, inst, action.writes, { origin: 'action', tag: `${beat}:${d.n}:a` });
    setBeat(l2, inst, beat, 'done');
    if (first) transition(l2, inst, 'running', 'T9', `V accepted "${action.id}"`);
  } else if (decline) {
    applyEffects(l2, inst, decline.writes, { origin: 'decline', tag: `${beat}:${d.n}:d` });
    // Its response content is delivered, unless a beat of the seed plays that same content (S2 section 7.4).
    const playedByBeat = Object.values(st.document.beats).some((b) => playOf(b).refs.includes(typeof decline.response === 'string' ? decline.response : ''));
    if (!playedByBeat) submitDelivery(l2, inst, beat, undefined, { what: 'reply', suffix: `decline${d.n}`, content: decline.response, pull: true });
    setBeat(l2, inst, beat, 'done');
    if (first) transition(l2, inst, 'unattended', 'T10', `V declined with "${decline.id}"`);
  } else {
    applyEffects(l2, inst, o.nullPath.writes, { origin: 'null', tag: `${beat}:${d.n}:n` });
    if (o.nullPath.content !== undefined) submitDelivery(l2, inst, beat, undefined, { what: 'reply', suffix: `null${d.n}`, content: o.nullPath.content, pull: true });
    const canReoffer = doc.reoffer !== undefined && rt.offers < doc.reoffer.max;
    if (canReoffer) {
      setBeat(l2, inst, beat, 'deferred');
      if (first) transition(l2, inst, 'cast', 'T11', 'V answered "not now" with reoffers left');
    } else {
      setBeat(l2, inst, beat, 'done');
      if (first) transition(l2, inst, 'unattended', 'T10', 'V answered "not now" and no reoffers are left');
    }
  }
  l2.queueReeval(inst, 'response');
  return true;
}

function setBeat(l2: Layer2, inst: Instance, beat: string, state: BeatRuntime['state']): void {
  if (state === 'done') {
    l2.completeNow(inst, beat);
    return;
  }
  setBeatState(l2, inst, beat, state);
}

// ---- closing deliveries (S2 section 6.4, 8.6) ----

export function queueClosing(l2: Layer2, inst: Instance, kind: 'closing' | 'coda' | 'news', content: ContentRef | undefined, purpose: TimingRequest['purpose']): void {
  const id = kind === 'news' ? ids.newsDeliveryId(inst.id) : ids.closeDeliveryId(inst.id, kind);
  if (inst.st.deliveries.some((d) => d.id === id)) return;
  const d: Delivery = {
    id, seed: inst.id, what: kind, timing: { ...timingFor(l2, inst, undefined), purpose, class: kind === 'closing' ? 0 : 2 },
    authored: inst.st.source.layer === 'authored', pull: false, atJoint: kind === 'news', bindings: {}, state: 'queued',
    submitted: l2.arbiter.play, submittedGame: l2.k.now, attempts: 0, tried: [], n: 0,
    provenance: { alternates: {}, channel: '', form: 'standard', why: [] },
  };
  if (content !== undefined) d.content = content;
  for (const [r, rs] of Object.entries(inst.st.roles)) if (rs.cast !== undefined) d.bindings[r] = rs.cast;
  inst.st.deliveries.push(d);
  l2.global.maintenance.push({ kind: 'closing', seed: inst.id, delivery: id, until: l2.k.now + l2.tun.closeExpiry });
  l2.record(inst, 'beat', { delivery: id, queued: kind });
}

void bound; void verdictOnNode;
export type { Contribution, Form, GameTime, Region, Pred };
