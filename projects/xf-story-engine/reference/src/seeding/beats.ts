// Beats at run time (S2 section 7): the beat graph's states, links with their conditions always evaluated,
// fragment choice, running a beat (failure, objective), and the stuck check.

import type { GameTime, Id } from '../types.ts';
import { ceilingOf } from '../settings.ts';
import { atoms, playOf } from './doc.ts';
import { applyEffects } from './effects.ts';
import { evalPred, gameTick } from './eval.ts';
import * as ids from './ids.ts';
import type { Instance, Layer2 } from './layer2.ts';
import { isTerminal } from './layer2.ts';
import type { BeatRuntime, BeatState, Fragment, Pred } from './types.ts';
import { dropEndedScenes, submitDelivery } from './arbiter.ts';

export const isFinal = (s: BeatState): boolean => s === 'done' || s === 'failed' || s === 'skipped';
const LIVE: ReadonlySet<BeatState> = new Set(['available', 'running']);
export const isLive = (s: BeatState): boolean => LIVE.has(s);

/** The seed facts some effect of the document writes: a seed fact nothing writes can never change (S2 section 7.5, SF-24). */
const writtenCache = new WeakMap<object, Set<string>>();
export function writtenFacts(inst: Instance): Set<string> {
  let out = writtenCache.get(inst.st.document);
  if (out) return out;
  out = new Set<string>();
  const add = (es: Array<{ fact?: string }> | undefined): void => { for (const e of es ?? []) if (e.fact !== undefined) out!.add(e.fact); };
  const doc = inst.st.document;
  for (const b of Object.values(doc.beats)) add(b.leaves as never);
  add(doc.unattended.outcome as never);
  for (const f of inst.st.closure.fragments) {
    add(f.leaves as never);
    for (const a of f.offer?.actions ?? []) add(a.writes as never);
    for (const d of f.offer?.decline ?? []) add(d.writes as never);
    add(f.offer?.nullPath.writes as never);
  }
  writtenCache.set(inst.st.document, out);
  return out;
}

/** Whether a predicate reads anything that can still change: a fact, a role, a time, a count (S2 section 7.5). */
export function canChange(p: Pred, written?: ReadonlySet<string>): boolean {
  if (p === 'yes' || p === 'no') return false;
  let any = false;
  for (const { atom } of atoms(p)) {
    if ('response' in atom || 'beat' in atom) continue;
    if ('seedFact' in atom && written && !written.has(atom.seedFact)) continue;
    any = true;
  }
  return any;
}

export const fragmentOf = (inst: Instance, ref: string): Fragment | undefined => {
  const id = ref.startsWith('pack:') ? ref.slice(5) : ref;
  return inst.st.closure.fragments.find((f) => f.id === id);
};

// ---- links ----

interface LinkState {
  satisfied: boolean;
  /** No link can ever be satisfied. */
  never: boolean;
}

/** Whether every beat an in-scene beat follows is still running: its scene is still on (S2 section 8.3). */
export function sceneRunning(inst: Instance, key: string): boolean {
  const links = (inst.st.document.beats[key]?.links ?? []).filter((l) => 'because' in l) as Array<{ because: string }>;
  return links.length > 0 && links.every((l) => inst.st.beats[l.because]?.state === 'running');
}

/** The failures that lead to a beat: (the failing beat, the index of its `failure` entry) (S2 section 7.3). */
export function leadersOf(inst: Instance, key: string): Array<{ src: string; index: number }> {
  const out: Array<{ src: string; index: number }> = [];
  for (const [src, b] of Object.entries(inst.st.document.beats).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    (b.failure ?? []).forEach((f, index) => { if (f.leadsTo === key) out.push({ src, index }); });
  }
  return out;
}

/**
 * Whether a beat's links are satisfied (S2 section 7.1). `join` combines the chain links (`because`, `then`) only; an `obstructedBy`
 * link is a guard that must always hold. A beat in `start` needs no chain links. A beat a failure leads to becomes available when that
 * failure happens, and its own chain links, if it has any, are checked as well. A beat with no chain links that is neither in `start`
 * nor led to is satisfied here and waits only for its fragment's `needs` (R1's lapse exit).
 */
export function linkState(l2: Layer2, inst: Instance, key: string, t: GameTime): LinkState {
  const b = inst.st.document.beats[key]!;
  const links = b.links ?? [];
  const ctx = { inst, t };
  let obstructed = false;
  const flow: Array<{ sat: boolean; never: boolean }> = [];
  for (const l of links) {
    if ('obstructedBy' in l) {
      const s = inst.st.beats[l.obstructedBy]?.state;
      if (s !== undefined && isLive(s)) obstructed = true;
    } else if ('then' in l) {
      const src = inst.st.beats[l.then];
      flow.push({ sat: !!src && isFinal(src.state), never: false });
    } else {
      const src = inst.st.beats[l.because];
      // An in-scene offer follows a beat whose scene is still running (S2 section 8.3): its source need not be final.
      // It follows a *running* beat of the scene and no other: a final predecessor means the scene is over (L-131a).
      if (b.inScene === true) {
        if (!src || src.state === 'locked' || src.state === 'available') flow.push({ sat: false, never: false });
        else if (src.state !== 'running') flow.push({ sat: false, never: true });
        else {
          const v = evalPred(l2, ctx, l.on ?? 'yes');
          flow.push({ sat: v === 'yes', never: false });
        }
        continue;
      }
      if (!src || !isFinal(src.state)) flow.push({ sat: false, never: false });
      else if (src.state === 'skipped' && src.skip === 'rejected') flow.push({ sat: false, never: true });
      else {
        // The condition is always evaluated, whether the source was done or omitted (S2 section 7.1, SF-60).
        const on: Pred = l.on ?? 'yes';
        const v = evalPred(l2, ctx, on);
        flow.push({ sat: v === 'yes', never: v === 'no' && !canChange(on, writtenFacts(inst)) });
      }
    }
  }
  const isStart = inst.st.document.start.includes(key);
  const led = leadersOf(inst, key);
  const join = b.join ?? 'all';
  let flowSat: boolean;
  let never: boolean;
  if (flow.length === 0 || isStart) {
    flowSat = true;
    never = false;
  } else if (join === 'any') {
    flowSat = flow.some((f) => f.sat);
    never = flow.every((f) => f.never);
  } else {
    flowSat = flow.every((f) => f.sat);
    never = flow.some((f) => f.never);
  }
  if (led.length > 0 && !isStart) {
    const happened = led.some(({ src, index }) => inst.st.beats[src]?.state === 'failed' && inst.st.beats[src]!.failedBy === index);
    if (!happened) {
      flowSat = false;
      // Every beat that could fail into this one has ended some other way: the failure can never happen.
      if (led.every(({ src }) => { const s = inst.st.beats[src]?.state; return s === undefined || isFinal(s); })) never = true;
    }
  }
  return { satisfied: flowSat && !obstructed, never };
}

// ---- fragments ----

export interface Chosen {
  fragment: Fragment;
  /** The fragment before the content ceiling was applied. */
  base: Fragment;
  gated?: { class: string; intensity: number; ceiling: number; became: string };
}

function eligible(l2: Layer2, inst: Instance, f: Fragment, t: GameTime): boolean {
  const ctx = { inst, t };
  if (f.applies !== undefined && evalPred(l2, ctx, f.applies as Pred) !== 'yes') return false;
  if (f.needs !== undefined && evalPred(l2, ctx, f.needs as Pred) !== 'yes') return false;
  const uses = l2.global.fragmentUses[f.id];
  const rep = f.repeat ?? 'free';
  if (rep === 'never' && uses && uses.count > 0) return false;
  if (typeof rep === 'object' && uses && uses.count >= rep.times) return false;
  if (f.minGap && uses) {
    if (f.minGap.game !== undefined && t - uses.lastAt < f.minGap.game) return false;
    if (f.minGap.offers !== undefined && l2.global.offerCount - uses.lastOffer < f.minGap.offers) return false;
  }
  return true;
}

/**
 * Choose the fragment a beat plays (S2 section 7.2): every fragment passes the same eligibility; among
 * alternates the most specific applicable ones are kept and the layer-2 draw chooses. Then the content ceiling
 * is checked (S2 section 2.19): above it a fragment plays its `implied` form, a droppable beat is dropped.
 * Returns undefined when the beat must wait, or 'drop'.
 */
export function chooseFragment(l2: Layer2, inst: Instance, key: string, n: number): Chosen | 'drop' | undefined {
  const b = inst.st.document.beats[key]!;
  const play = playOf(b);
  const t = l2.k.now;
  const all = play.refs.map((r) => fragmentOf(inst, r)).filter((f): f is Fragment => f !== undefined);
  let pick: Fragment | undefined;
  if (!play.alternates) {
    pick = all[0] && eligible(l2, inst, all[0], t) ? all[0] : undefined;
  } else {
    const ok = all.filter((f) => eligible(l2, inst, f, t));
    if (ok.length === 0) return undefined;
    const spec = (f: Fragment): number => (f.applies === undefined ? 0 : atoms(f.applies as Pred).length);
    const top = Math.max(...ok.map(spec));
    const best = ok.filter((f) => spec(f) === top);
    if (best.length === 1) pick = best[0];
    else {
      const choice = `alt:${key}:${n}`;
      const prior = inst.st.draws[choice];
      if (prior && best.some((f) => f.id === prior.value)) pick = best.find((f) => f.id === prior.value);
      else {
        const options = best.map(f => ({id: f.id,fragment: f.id}));
        const d = l2.draw(inst.id, choice, options, inst.st.beats[key]!.attempt, l2.fitWeights({id: inst.id,template: inst.st.template.id,pack: inst.st.template.pack,sowSeq: inst.st.sowSeq,document: inst.st.document,choice,options,report: inst.fitSample}));
        inst.st.draws[choice] = { value: d.value, attempt: inst.st.beats[key]!.attempt, ...(d.raw !== undefined ? { raw: d.raw } : {}), ...(d.clamped !== undefined ? { clamped: d.clamped } : {}) };
        pick = best.find((f) => f.id === d.value);
      }
    }
  }
  if (!pick) return undefined;
  return gateFragment(l2, inst, key, pick);
}

/**
 * The content ceiling (S2 section 2.19): above it a fragment plays its `implied` form and a droppable beat is dropped. Checked at
 * fragment choice, and again at release with the settings in force then.
 */
export function gateFragment(l2: Layer2, inst: Instance, key: string, base: Fragment): Chosen | 'drop' | undefined {
  const b = inst.st.document.beats[key]!;
  const settings = l2.k.settings.at(l2.k.now);
  for (const tag of base.content ?? []) {
    const ceiling = ceilingOf(settings, tag.class);
    if (tag.intensity > ceiling) {
      const implied = base.implied ? fragmentOf(inst, base.implied) : undefined;
      if (implied) return { fragment: implied, base, gated: { class: tag.class, intensity: tag.intensity, ceiling, became: 'implied' } };
      if (b.droppable) return 'drop';
      return undefined;
    }
  }
  return { fragment: base, base };
}

// ---- the beat engine ----

function liveCount(inst: Instance): number {
  return Object.values(inst.st.beats).filter((r) => isLive(r.state)).length;
}

function setBeat(l2: Layer2, inst: Instance, key: string, state: BeatState, extra: Partial<BeatRuntime> = {}): void {
  const rt = inst.st.beats[key]!;
  const was = rt.state;
  rt.state = state;
  rt.since = l2.k.now;
  Object.assign(rt, extra);
  if (state === 'done' || state === 'failed' || state === 'skipped' || state === 'deferred') {
    rt.finalAt = l2.k.now;
    rt.finalAtPlay = l2.playTotal();
  }
  const entry = l2.record(inst, 'beat', { beat: key, from: was, to: state });
  if (state === 'done') rt.doneAt = entry.n;
}

export function skipBeat(l2: Layer2, inst: Instance, key: string, kind: 'omitted' | 'rejected', why: string): void {
  setBeat(l2, inst, key, 'skipped', { skip: kind });
  l2.record(inst, 'beat', { beat: key, skipped: kind, why });
}

/** A beat completes: its `leaves` are written, and what it opens is opened (S2 section 7.3). */
export function completeBeat(l2: Layer2, inst: Instance, key: string): void {
  const rt = inst.st.beats[key]!;
  if (rt.state === 'done') return;
  setBeat(l2, inst, key, 'done');
  const b = inst.st.document.beats[key]!;
  const frag = rt.fragment ? fragmentOf(inst, rt.fragment) : undefined;
  applyEffects(l2, inst, [...(frag?.leaves ?? []), ...(b.leaves ?? [])], { origin: 'beat', tag: `${key}:${rt.releases}` });
  for (const p of inst.st.document.promises ?? []) {
    if (p.opens === key && inst.st.promises[p.id] === 'unopened') inst.st.promises[p.id] = 'open';
  }
}

export function failBeat(l2: Layer2, inst: Instance, key: string, why: string, index?: number): void {
  setBeat(l2, inst, key, 'failed', index === undefined ? {} : { failedBy: index });
  l2.record(inst, 'beat', { beat: key, failed: why });
}

/**
 * Update every beat of an instance: locked beats become available (or are skipped), deferred offers become
 * available again, aftermaths wait their delay, and running beats are checked (S2 sections 7.1 and 7.3).
 * Returns whether anything changed.
 */
export function updateBeats(l2: Layer2, inst: Instance): boolean {
  const st = inst.st;
  if (!(st.state === 'cast' || st.state === 'offered' || st.state === 'running' || st.state === 'unattended')) return false;
  const doc = st.document;
  // An in-scene offer whose scene has ended is dropped, and its beat skipped as rejected (S2 section 8.3).
  let any = dropEndedScenes(l2, inst);
  for (let pass = 0; pass < 32; pass++) {
    let changed = false;
    const t = l2.k.now;
    for (const key of Object.keys(doc.beats).sort()) {
      const rt = st.beats[key]!;
      const b = doc.beats[key]!;
      if (rt.state === 'locked') {
        // A shrunk role omits the beats that bind it (S2 section 7.1).
        const bound = playOf(b).refs.some((r) => {
          const f = fragmentOf(inst, r);
          return f?.roles.some((fr) => inst.st.roles[b.bind?.[fr] ?? fr]?.shrunk);
        });
        if (bound) { skipBeat(l2, inst, key, 'omitted', 'a shrunk role'); changed = true; continue; }
        const ls = linkState(l2, inst, key, t);
        if (ls.never) { skipBeat(l2, inst, key, 'rejected', 'no link can ever be satisfied'); changed = true; continue; }
        if (!ls.satisfied) continue;
        if (liveCount(inst) >= l2.tun.maxLive) continue;
        if (makeAvailable(l2, inst, key)) changed = true;
      } else if (rt.state === 'deferred') {
        const re = b.reoffer;
        if (re && rt.offers < re.max && evalPred(l2, { inst, t }, re.when) === 'yes' && liveCount(inst) < l2.tun.maxLive) {
          rt.attempt++;
          if (makeAvailable(l2, inst, key)) changed = true;
        }
      } else if (rt.state === 'available' && b.kind === 'aftermath' && b.aftermath && !rt.delayed) {
        const due = (rt.availableAt ?? t) + b.aftermath.delay.s;
        const ripe = b.aftermath.delay.clock === 'play' ? l2.playTotal() >= (rt.availableAtPlay ?? l2.playTotal()) + b.aftermath.delay.s : gameTick(l2, t) >= due;
        if (ripe) {
          rt.delayed = true;
          const cancel = b.aftermath.cancelIf;
          if (cancel && evalPred(l2, { inst, t }, cancel) === 'yes') { skipBeat(l2, inst, key, 'rejected', 'cancelled'); changed = true; continue; }
          b.aftermath.signposts.forEach((ref, i) => {
            const f = fragmentOf(inst, ref);
            if (f) submitDelivery(l2, inst, key, f, { suffix: `sign${i}`, what: 'signpost' });
          });
          deliverBeat(l2, inst, key);
          changed = true;
        }
      } else if (rt.state === 'running') {
        if (runBeat(l2, inst, key)) changed = true;
      }
    }
    if (!changed) break;
    any = true;
  }
  return any;
}

/** A locked or deferred beat becomes available: its fragment is chosen and its delivery submitted. */
function makeAvailable(l2: Layer2, inst: Instance, key: string): boolean {
  const st = inst.st;
  const rt = st.beats[key]!;
  const n = rt.availableCount;
  const chosen = chooseFragment(l2, inst, key, n);
  if (chosen === 'drop') {
    skipBeat(l2, inst, key, 'omitted', 'above the content ceiling');
    return true;
  }
  if (!chosen) return false;
  const b = st.document.beats[key]!;
  rt.availableCount++;
  rt.state = 'available';
  rt.since = l2.k.now;
  rt.availableAt = l2.k.now;
  rt.availableAtPlay = l2.playTotal();
  rt.fragment = chosen.base.id;
  rt.delayed = false;
  l2.record(inst, 'beat', { beat: key, to: 'available', fragment: chosen.fragment.id, ...(chosen.gated ? { gated: chosen.gated } : {}) });
  if (b.kind === 'aftermath' && b.aftermath) return true; // waits its delay
  deliverBeat(l2, inst, key, chosen.gated);
  return true;
}

/** Make the delivery of an available beat, or start it at once if it has no channel. */
function deliverBeat(l2: Layer2, inst: Instance, key: string, gated?: { class: string; intensity: number; ceiling: number; became: string }): void {
  const rt = inst.st.beats[key]!;
  const frag = gated ? fragmentOf(inst, fragmentOf(inst, rt.fragment!)!.implied!)! : fragmentOf(inst, rt.fragment!)!;
  if (frag.channels.length === 0 && !frag.offer) {
    l2.startDirect(inst, key);
    return;
  }
  const opts: { what?: string; gated?: typeof gated; inScene?: boolean } = {};
  if (gated) opts.gated = gated;
  if (inst.st.document.beats[key]!.inScene) opts.inScene = true;
  submitDelivery(l2, inst, key, frag, opts);
}

/**
 * Running a beat (S2 section 7.3): failures in order, then the objective's `fails`, `warns` and `succeeds`;
 * failure wins over success in the same step. Returns whether anything changed.
 */
function runBeat(l2: Layer2, inst: Instance, key: string): boolean {
  const st = inst.st;
  const b = st.document.beats[key]!;
  const rt = st.beats[key]!;
  const ctx = { inst, t: l2.k.now };
  let changed = false;
  for (const [i, f] of (b.failure ?? []).entries()) {
    if (f.warnFirst !== undefined && !rt.warned && evalPred(l2, ctx, f.warnFirst) === 'yes') {
      rt.warned = true;
      queueWarning(l2, inst, key, `failure[${i}]`);
      changed = true;
    }
    if (evalPred(l2, ctx, f.when) === 'yes') {
      if (f.warnFirst !== undefined && !warningSeen(inst, key)) continue;
      failBeat(l2, inst, key, `failure[${i}]`, i);
      return true;
    }
  }
  const o = b.objective;
  if (o) {
    if (o.fails !== undefined && evalPred(l2, ctx, o.fails) === 'yes') {
      failBeat(l2, inst, key, 'objective.fails');
      return true;
    }
    if (o.warns !== undefined && !rt.objWarned && evalPred(l2, ctx, o.warns) === 'yes') {
      rt.objWarned = true;
      queueWarning(l2, inst, key, 'objective.warns');
      changed = true;
    }
    if (evalPred(l2, ctx, o.succeeds) === 'yes') {
      completeBeat(l2, inst, key);
      return true;
    }
  }
  return changed;
}

function queueWarning(l2: Layer2, inst: Instance, key: string, why: string): void {
  const frag = fragmentOf(inst, inst.st.beats[key]!.fragment ?? '');
  if (frag) submitDelivery(l2, inst, key, frag, { what: 'warning', suffix: `warn:${why}` });
}

/** A warned failure fires only after its warning was confirmed, or presented twice on different channels (S2 section 7.3). */
function warningSeen(inst: Instance, key: string): boolean {
  const rs = inst.st.receipts.filter((r) => r.beat === key && r.what === 'warning');
  if (rs.some((r) => r.grade === 'confirmed')) return true;
  const pres = rs.filter((r) => r.grade === 'presented' || r.grade === 'confirmed');
  return new Set(pres.flatMap((r) => r.channels)).size >= 2 || pres.length >= 2 && new Set(pres.flatMap((r) => r.channels)).size >= 2;
}

// ---- stuck seeds (S2 section 7.5) ----

/** Whether a running seed can never finish: conservative, anything that could still change counts as able to. */
export function isStuck(l2: Layer2, inst: Instance): boolean {
  const st = inst.st;
  if (st.state !== 'running') return false;
  const doc = st.document;
  if (evalPred(l2, { inst, t: l2.k.now }, doc.end) === 'yes') return false;
  const beats = Object.keys(doc.beats);
  if (beats.some((k) => ['available', 'running', 'deferred'].includes(st.beats[k]!.state))) return false;
  for (const k of beats) {
    if (st.beats[k]!.state !== 'locked') continue;
    for (const l of doc.beats[k]!.links ?? []) {
      if ('obstructedBy' in l) return false;
      const srcKey = 'because' in l ? l.because : l.then;
      const src = st.beats[srcKey];
      if (!src) continue;
      if (!isFinal(src.state)) return false;
      if ('because' in l && l.on !== undefined && canChange(l.on, writtenFacts(inst))) return false;
      if ('because' in l && l.on === undefined && src.state !== 'skipped') return false;
    }
    if (!(doc.beats[k]!.links ?? []).length && !doc.start.includes(k)) continue;
  }
  if (st.wakeups.length > 0) return false;
  return true;
}

export function terminalBeatsSettled(inst: Instance): boolean {
  return Object.values(inst.st.beats).every((r) => isFinal(r.state) || r.state === 'locked');
}

void isTerminal;
void ids;
export type { Id };
