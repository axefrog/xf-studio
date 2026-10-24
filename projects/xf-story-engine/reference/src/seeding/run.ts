// Running an instance (S2 sections 4 and 6): a re-evaluation updates the window states and latches, watches
// fixed parts, updates beats, and applies lifecycle transitions up to `maxTransitions` per step. Transitions
// are recorded; terminal states are final.

import { canonicalKey } from '../canon.ts';
import type { Change, GameTime, Id, Selector } from '../types.ts';
import { castOrder, castRole, runLadder, standInRecipe, effective } from './cast.ts';
import { atoms, fragmentSites, playOf, predSites } from './doc.ts';
import { applyEffects } from './effects.ts';
import { consumeEvent } from './consume.ts';
import { evalPred, gameTick, planPlayFrom, roleVerdict, sincePlayFrom, stateSince } from './eval.ts';
import * as ids from './ids.ts';
import { readCall, resolveReadArgs } from './reads.ts';
import type { Instance, Layer2, Trigger } from './layer2.ts';
import { isTerminal } from './layer2.ts';
import type { Rejection } from './watch.ts';
import { watchFixed } from './watch.ts';
import { endRequirement, installRequirement } from './world.ts';
import { isFinal, isLive, isStuck, updateBeats } from './beats.ts';
import { queueClosing, withdrawPending } from './arbiter.ts';
import type { ContentRef, Pred, SeedStateName, Wakeup } from './types.ts';

export type WindowState = 'open' | 'pending' | 'closed';

/** The window states at `t`, after the latches (S2 section 2.7). Closing is latched. */
export function windowStates(l2: Layer2, inst: Instance, t: GameTime): WindowState[] {
  const st = inst.st;
  return st.document.windows.map((w): WindowState => {
    if (st.latches.includes(w.id)) return 'closed';
    const closes = w.closes === undefined ? 'no' : evalPred(l2, { inst, t }, w.closes);
    if (closes === 'yes') {
      st.latches.push(w.id);
      l2.record(inst, 'beat', { window: w.id, latched: true });
      return 'closed';
    }
    const opens = evalPred(l2, { inst, t }, w.opens);
    if (closes === 'no' && opens === 'yes') return 'open';
    return 'pending';
  });
}

/**
 * The states a condition passes through at one time (S2-4): the registered reads it names can change more than once at a time (a regime
 * ends and another starts at the same second), and `eval` at that time gives only the last value. The changes of all the reads the condition
 * names are put in the order they were made (the port's `ord`), and there is one state after each: every read at the value it had then, a
 * read that did not change at this time left to `eval`. So a condition on two reads is never met by values that did not stand together.
 */
function statesAt(l2: Layer2, inst: Instance, pred: Pred, at: GameTime): Array<(read: string, args: unknown[]) => string | undefined> {
  const port = l2.reg.sim;
  if (!port) return [];
  const initial = new Map<string, string>();
  const changes: Array<{ key: string; value: string; ord: number | undefined; n: number }> = [];
  for (const { atom } of atoms(pred)) {
    if (!('city' in atom || 'social' in atom)) continue;
    const call = readCall(atom);
    if ('error' in call || !port.builds(call.name)) continue;
    const args = resolveReadArgs(call, inst);
    if (args === undefined) continue;
    const key = `${call.name}|${JSON.stringify(args)}`;
    if (initial.has(key)) continue;
    const seq = port.transitions(call.name, args, at - 1, at);
    initial.set(key, seq[0]?.value ?? port.eval(call.name, args, at - 1));
    for (const x of seq.slice(1)) changes.push({ key, value: x.value, ord: x.ord, n: changes.length });
  }
  if (changes.length === 0) return [];
  changes.sort((a, b) => (a.ord ?? Number.MAX_SAFE_INTEGER) - (b.ord ?? Number.MAX_SAFE_INTEGER) || a.n - b.n);
  const standing = new Map(initial);
  const out: ReturnType<typeof statesAt> = [];
  for (let i = 0; i < changes.length;) {
    const c = changes[i++]!;
    standing.set(c.key, c.value);
    // Equal ord identifies aliases of ONE source transition: apply every alias before testing a compound predicate.
    while (c.ord !== undefined && i < changes.length && changes[i]!.ord === c.ord) {
      const alias = changes[i++]!;
      standing.set(alias.key, alias.value);
    }
    const state = new Map(standing);
    out.push((read: string, args: unknown[]) => state.get(`${read}|${JSON.stringify(args)}`));
  }
  return out;
}

/**
 * Window `closes` predicates are evaluated at the time of each delivered change (S2 section 4.2), so a closing value
 * latches even if a later change has already reverted it, and at each value a registered read passed through at that time.
 */
function latchFromChanges(l2: Layer2, inst: Instance, triggers: Trigger[]): void {
  const st = inst.st;
  for (const tr of triggers) {
    if (!tr.change) continue;
    const c = tr.change as Change & { at?: GameTime };
    const at = c.c === 'reading' || c.c === 'pin' ? c.at ?? tr.time : tr.time;
    for (const w of st.document.windows) {
      const closes = w.closes;
      if (st.latches.includes(w.id) || closes === undefined) continue;
      if (evalPred(l2, { inst, t: at }, closes) === 'yes' || statesAt(l2, inst, closes, at).some((readOf) => evalPred(l2, { inst, t: at, readOf }, closes) === 'yes')) {
        st.latches.push(w.id);
        l2.record(inst, 'beat', { window: w.id, latched: true, at });
      }
    }
  }
}

const seedOpen = (ws: WindowState[]): boolean => ws.some((w) => w === 'open');
const seedClosed = (ws: WindowState[]): boolean => ws.length > 0 && ws.every((w) => w === 'closed');

// ---- transitions ----

export interface CloseOpts {
  quiet?: boolean;
}

export function transition(l2: Layer2, inst: Instance, to: SeedStateName, row: string, why: string, opts: CloseOpts = {}): void {
  const st = inst.st;
  if (isTerminal(st.state)) return; // terminal states are final (S2-I-9)
  const from = st.state;
  st.state = to;
  st.since = l2.k.now;
  st.entered[to] = l2.k.now;
  st.enteredPlay[to] = l2.playTotal();
  l2.record(inst, 'transition', { row, from, to, why });
  l2.notifyReaders('seeds', inst);
  if (row === 'T6') {
    withdrawPending(l2, inst);
    for (const [key, rt] of Object.entries(st.beats)) {
      if (rt.state === 'available' && !(inst.st.document.beats[key]!.kind === 'aftermath')) {
        rt.state = rt.releases > 0 ? 'deferred' : 'locked';
        rt.since = l2.k.now;
      }
    }
  }
  if (isTerminal(to)) closeSeed(l2, inst, to, row, opts);
}

/** Terminal effects (S2 section 6.1) and closing (S2 section 6.4). */
export function closeSeed(l2: Layer2, inst: Instance, to: SeedStateName, row: string, opts: CloseOpts): void {
  const k = l2.k;
  const st = inst.st;
  const doc = st.document;
  const now = k.now;
  // The instance's frames close: satisfied if it resolved, abandoned otherwise.
  const frameStatus = to === 'resolved' ? 'satisfied' : 'abandoned';
  const closeFrame = (f: Id | undefined): void => {
    const fr = f ? k.frames.frame(f) : undefined;
    if (fr && (fr.status === 'active' || fr.status === 'blocked')) k.frames.setStatus(fr.id, frameStatus, inst.id);
  };
  for (const g of Object.values(st.frames.goals)) closeFrame(g);
  for (const f of Object.values(st.frames.roles)) closeFrame(f);
  closeFrame(st.frames.watch);
  // Cast edges and contributions end; pending requests are withdrawn.
  for (const e of Object.values(st.edges)) if (k.store.edges.get(e) && k.store.edges.get(e)!.valid.to === undefined) k.endEdge(e, now);
  doc.world?.forEach((_, i) => endRequirement(l2, inst, i));
  withdrawPending(l2, inst, true);
  for (const d of st.deliveries) if (d.state === 'released' || d.state === 'displayed') { d.state = 'withdrawn'; l2.record(inst, 'expired', { delivery: d.id, why: 'the seed ended' }); }
  // Closing: one seed-outcome event, committed; the details go in a `closure` record entry.
  const closes = to === 'resolved' || to === 'withered' || (to === 'withdrawn' && st.released);
  if (closes) {
    // `resolved` only after T12: the seed reached its end while V was in it. A seed the world settled without V (every T13) is
    // `abandoned`, even if its plan makes `end` yes (S2 section 6.4).
    const resolved = to === 'resolved' && row === 'T12';
    const status: 'resolved' | 'abandoned' = resolved ? 'resolved' : 'abandoned';
    const witnessed = endingExposed(inst, row);
    const ev = k.events.mintEvent({
      creator: inst.id, cause: inst.id, name: 'outcome', time: now, kind: 'seed-outcome',
      participants: [{ who: inst.id, role: 'participant' }], outcome: status === 'resolved' ? 'done' : 'failed',
    });
    k.events.makeCanon(ev, 'committed', inst.id);
    // Forced closures retire open promises (S2 section 6.4).
    const retired: string[] = [];
    for (const p of doc.promises ?? []) {
      if (st.promises[p.id] === 'open') {
        if (!resolved) { st.promises[p.id] = 'retired'; retired.push(p.id); }
      }
    }
    const looseEnds = {
      facts: Object.entries(doc.facts ?? {}).filter(([key, f]) => f.route && (f.route.consumers ?? []).every((c) => c === 'end' ? false : st.beats[c]?.state === 'locked')).map(([key]) => key).sort(),
      casts: Object.entries(st.frames.goals).map(([role]) => role).sort(),
      promises: retired,
    };
    l2.record(inst, 'closure', { event: ev, status, witnessed, looseEnds });
    st.closed = { event: ev, status, witnessed };
    if (!opts.quiet) {
      // Closing deliveries outlive the seed (S2 section 8.6): the closing trace, the window's close content, and news.
      if (doc.closing !== undefined && st.released) queueClosing(l2, inst, 'closing', doc.closing, 'close');
      const w = closeWindow(inst);
      if (w && (w.onClose === 'coda' || w.onClose === 'memory') && w.closeContent !== undefined) queueClosing(l2, inst, 'coda', w.closeContent as ContentRef, 'close');
      if (st.released && !witnessed) queueClosing(l2, inst, 'news', undefined, 'news');
    }
  } else {
    l2.record(inst, 'closure', { status: 'withdrawn', witnessed: false, released: false });
    if (!opts.quiet && (to as string) === 'withered') {
      const w = closeWindow(inst);
      if (w && (w.onClose === 'coda' || w.onClose === 'memory') && w.closeContent !== undefined) queueClosing(l2, inst, 'coda', w.closeContent as ContentRef, 'close');
    }
  }
  const key = `${st.template.pack ?? ''}:${st.template.id}`;
  const s = l2.global.sowing[key] ?? { instances: 0 };
  s.lastEnded = now;
  l2.global.sowing[key] = s;
  l2.unregisterActor(inst.id);
  l2.queue.delete(inst.id);
  l2.syncRecord(inst);
}

/**
 * Whether V was exposed to the beat or plan that ended the seed (S2 section 6.4, L2-17). A seed that reached its end (T12) was ended by
 * the beats that completed last: V was exposed if a delivery of one of them reached at least `presented`. A seed the world settled
 * (T13) was ended by the plan, which V is not shown; a forced closure was ended by nothing V was shown.
 */
function endingExposed(inst: Instance, row: string): boolean {
  if (row !== 'T12') return false;
  const st = inst.st;
  // The beat that completed last, by the order of the record (the stamps of two completions in one pass can coincide).
  const done = Object.entries(st.beats).filter(([, rt]) => rt.state === 'done' && rt.doneAt !== undefined);
  if (done.length === 0) return false;
  const ending = done.reduce((a, b) => (b[1].doneAt! > a[1].doneAt! ? b : a))[0];
  return st.receipts.some((r) => r.beat === ending && r.grade !== 'ambient');
}

/** The window whose close policy applies: the release window after a release, else the lowest-index window (S2 section 2.7). */
function closeWindow(inst: Instance): Instance['st']['document']['windows'][number] | undefined {
  const ws = inst.st.document.windows;
  if (inst.st.releaseWindow !== undefined) return ws.find((w) => w.id === inst.st.releaseWindow) ?? ws[0];
  return ws.find((w) => inst.st.latches.includes(w.id)) ?? ws[0];
}

// ---- lost roles and rejections ----

/** A role is lost (S2 section 5.5): its `onLost` applies; a tentative cast simply goes and is cast again. */
export function onRoleLost(l2: Layer2, inst: Instance, key: string): void {
  const st = inst.st;
  const role = st.document.roles[key]!;
  const rs = st.roles[key]!;
  const wasCommitted = rs.committed;
  if (!wasCommitted) {
    rs.cast = undefined;
    rs.attempt++;
    return;
  }
  const steps = role.onUnfilled ?? ['wait', 'withdraw'];
  let how = role.onLost;
  if (how === undefined) how = role.anchor ? 'withdraw' : (steps[steps.length - 1] === 'standIn' ? 'standIn' : steps[steps.length - 1] === 'shrink' ? 'shrink' : steps[steps.length - 1] === 'withdraw' ? 'withdraw' : 'withdraw');
  if (how === 'shrink' && role.optional) {
    rs.shrunk = true;
    rs.cast = undefined;
    l2.record(inst, 'lost', { role: key, shrunk: true });
  } else if (how === 'standIn') {
    const recipe = standInRecipe(l2, role, rs);
    if (recipe) {
      rs.standIn = recipe;
      rs.cast = undefined;
      rs.committed = false;
      l2.record(inst, 'lost', { role: key, standIn: true });
    } else l2.withdraw(inst, `the role "${key}" was lost`);
  } else l2.withdraw(inst, `the role "${key}" was lost`);
}

export function applyRejection(l2: Layer2, inst: Instance, rj: Rejection): void {
  l2.record(inst, 'fixed-rejected', { index: rj.index, why: rj.why, policy: rj.policy });
  if (rj.policy === 'withdraw') {
    l2.withdraw(inst, `a fixed part was rejected: ${rj.why}`);
    return;
  }
  // `degrade`, and `refit` with the director off: the requirement ends and the seed continues without it.
  endRequirement(l2, inst, rj.index);
  const e = inst.st.world[rj.index];
  if (e) e.rejected = true;
}

// ---- the re-evaluation step (S2 section 4.4) ----

export function reevaluate(l2: Layer2, inst: Instance, triggers: Trigger[]): void {
  const st = inst.st;
  if (isTerminal(st.state)) return;
  for (const tr of triggers) if (tr.change?.c === 'event') consumeEvent(l2, inst, tr.change.event);
  latchFromChanges(l2, inst, triggers);
  let again = false;
  for (let n = 0; n < l2.tun.maxTransitions; n++) {
    if (isTerminal(st.state)) break;
    const moved = step(l2, inst);
    if (!moved) break;
    if (n === l2.tun.maxTransitions - 1) again = true;
  }
  if (!isTerminal(st.state)) {
    st.wakeups = computeWakeups(l2, inst);
    refreshInterests(l2, inst);
  }
  l2.syncRecord(inst);
  if (again) l2.queueReeval(inst, 'more transitions');
}

/** One pass: casting, the fixed-part watch, beats, then the first applicable transition. Returns whether a transition fired. */
function step(l2: Layer2, inst: Instance): boolean {
  const st = inst.st;
  const doc = st.document;
  const t = l2.k.now;
  // Fixed parts: watched right after install, at release, and on every relevance event.
  for (const rj of watchFixed(l2, inst, undefined)) {
    applyRejection(l2, inst, rj);
    if (isTerminal(st.state)) return true;
  }
  const ws = windowStates(l2, inst, t);
  const open = seedOpen(ws);
  const closed = seedClosed(ws);
  const ctxYes = evalPred(l2, { inst, t }, doc.context) === 'yes';
  const waitingish = st.state === 'sown' || st.state === 'waiting';
  // Casting: a window and the context may read a cast role (R1's does), so a seed that is not closed is cast whenever it is
  // evaluated; a waiting seed re-casts on its wake-up deadline and on any relevance event (S2 section 4.1).
  let castOk = false;
  if (!closed && (waitingish || st.state === 'cast')) {
    const r = castAll(l2, inst);
    castOk = r.ok;
    if (r.withdraw) {
      l2.withdraw(inst, r.withdraw);
      return true;
    }
  }
  if (st.state === 'cast' || st.state === 'offered' || st.state === 'running' || st.state === 'unattended') {
    // Re-check tentative casts (a lost one sends a cast seed back to waiting).
    syncWorld(l2, inst);
    updateBeats(l2, inst);
    updatePromises(l2, inst);
  }

  // The transition table, in order (S2 section 6.2). T7 to T11 and T14 happen with the events that cause them.
  const state = st.state;
  if ((state === 'sown' || state === 'waiting' || state === 'cast') && closed) {
    transition(l2, inst, 'withered', 'T2', 'every window is closed');
    return true;
  }
  if ((state === 'offered' || state === 'running') && st.releaseWindow !== undefined) {
    const idx = doc.windows.findIndex((w) => w.id === st.releaseWindow);
    const w = doc.windows[idx];
    if (w && ws[idx] === 'closed' && !w.holdsWhileRunning) {
      if (w.onClose === 'degrade') transition(l2, inst, 'unattended', 'T3', 'the release window closed and degrades');
      else transition(l2, inst, 'withered', 'T3', 'the release window closed');
      return true;
    }
  }
  if ((state === 'sown' || state === 'waiting') && open && ctxYes && castOk) {
    transition(l2, inst, 'cast', 'T4', 'the seed is open, its context is yes and every role is cast');
    st.lastRecast = undefined;
    return true;
  }
  if (state === 'sown') {
    transition(l2, inst, 'waiting', 'T5', 'the seed is not ready');
    return true;
  }
  if (state === 'cast') {
    const lost = Object.entries(st.roles).some(([k, rs]) => !rs.committed && !rs.shrunk && rs.cast === undefined && rs.standIn === undefined && !doc.roles[k]!.optional);
    if (!open || !ctxYes || lost) {
      transition(l2, inst, 'waiting', 'T6', 'the seed is no longer ready');
      return true;
    }
  }
  // T12 reads `running`; a seed V declined is `unattended` while its exit beat plays, and reaching `end` there is the same success
  // (S2 section 6.2 and fixture SF-7: the decline exit plays, then T12).
  if ((state === 'running' || state === 'unattended') && evalPred(l2, { inst, t }, doc.end) === 'yes' && !Object.entries(st.promises).some(([id, s]) => s === 'open' && !(doc.promises ?? []).find((p) => p.id === id)?.mayStayOpen)) {
    transition(l2, inst, 'resolved', 'T12', 'the end state was reached');
    return true;
  }
  if (state === 'unattended' && durationElapsed(l2, st.entered.unattended, planPlayFrom(inst), doc.unattended.after)) {
    applyEffects(l2, inst, doc.unattended.outcome, { origin: 'unattended', tag: 'unattended' });
    mintUnattendedEvents(l2, inst);
    transition(l2, inst, 'resolved', 'T13', 'the world settled it without V');
    return true;
  }
  if (state === 'running' && isStuck(l2, inst)) {
    l2.record(inst, 'stuck', {});
    transition(l2, inst, 'withered', 'T15', 'the seed is stuck');
    return true;
  }
  return false;
}

function mintUnattendedEvents(l2: Layer2, inst: Instance): void {
  const k = l2.k;
  (inst.st.document.unattended.events ?? []).forEach((e, i) => {
    const place = e.place ? inst.st.roles[e.place]?.cast : undefined;
    const spec: Parameters<typeof k.events.mintEvent>[0] = {
      creator: inst.id, cause: inst.id, name: `unattended:${i}`, time: k.now, kind: e.kind,
      participants: (e.participants ?? []).flatMap((p) => { const w = inst.st.roles[p.who]?.cast; return w ? [{ who: w, role: p.role }] : []; }),
    };
    if (place !== undefined) spec.place = place;
    const ev = k.events.mintEvent(spec);
    k.events.makeCanon(ev, 'committed', inst.id);
  });
}

// ---- casting every role (S2 section 5) ----

function castAll(l2: Layer2, inst: Instance): { ok: boolean; withdraw?: string } {
  const st = inst.st;
  const doc = st.document;
  let ok = true;
  for (const key of castOrder(inst)) {
    const role = doc.roles[key]!;
    const rs = st.roles[key]!;
    if (rs.shrunk) continue;
    if (rs.committed) continue;
    // A tentative cast is re-checked against its effective requirements; a lost one is cast again.
    if (rs.cast !== undefined) {
      const { must } = effective(role, rs);
      let bad = st.source.by === 'director' && l2.directorExcludes(rs.cast);
      for (const m of must) if (roleVerdict(l2, { inst, t: l2.k.now }, key, m).v === 'no') bad = true;
      if (!bad) continue;
      l2.record(inst, 'lost', { role: key, tentative: true });
      rs.cast = undefined;
      rs.attempt++;
    }
    if (rs.standIn !== undefined) continue;
    const attempt = castRole(l2, inst, key);
    if (attempt.node) continue;
    const res = runLadder(l2, inst, key, attempt);
    if (res.r === 'withdraw') {
      l2.record(inst, 'unfilled', { role: key, why: res.reason });
      return { ok: false, withdraw: `the role "${key}" could not be filled: ${res.reason}` };
    }
    if (res.r === 'waiting') {
      rs.unfilled = attempt.reason;
      l2.record(inst, 'unfilled', { role: key, why: attempt.reason ?? '', waiting: true });
      if (!role.optional) ok = false;
    } else if (res.r === 'shrunk') {
      l2.record(inst, 'unfilled', { role: key, shrunk: true });
    }
  }
  // Intersections: claims between this seed and others (S2 section 9).
  l2.detectIntersections(inst);
  for (const [key, rs] of Object.entries(st.roles)) {
    if (!doc.roles[key]!.optional && !rs.shrunk && rs.cast === undefined && rs.standIn === undefined) ok = false;
  }
  st.lastRecast = l2.k.now;
  return { ok };
}

// ---- world requirements on the beats' clock ----

function syncWorld(l2: Layer2, inst: Instance): void {
  const st = inst.st;
  (st.document.world ?? []).forEach((w, i) => {
    const e = st.world[i];
    if (!e) return;
    const from = w.from ?? ('role' in w.target ? 'commit' : 'sown');
    if (!e.installed && from !== 'sown' && from !== 'commit' && st.beats[from] && ['running', 'done', 'failed'].includes(st.beats[from]!.state)) {
      const ins = installRequirement(l2, inst, i);
      if (ins) st.world[i] = { contribution: ins.contribution, installed: true, ended: false, from: l2.k.now };
    }
    if (e.installed && !e.ended && w.to && w.to !== 'end' && st.beats[w.to] && isFinal(st.beats[w.to]!.state)) endRequirement(l2, inst, i);
  });
}

function updatePromises(l2: Layer2, inst: Instance): void {
  const st = inst.st;
  for (const p of st.document.promises ?? []) {
    if (st.promises[p.id] === 'open' && evalPred(l2, { inst, t: l2.k.now }, p.paidBy) === 'yes') {
      st.promises[p.id] = 'paid';
      l2.record(inst, 'beat', { promise: p.id, paid: true });
    }
  }
}

// ---- wake-ups (S2 section 4.3) and interests (S2 section 4.1) ----

const ceilTo = (t: GameTime, w: number): GameTime => Math.ceil(t / w) * w;

/**
 * Whether a duration has passed since a point (S2 section 4.3). A game-clock duration is read at the last window boundary, so it
 * becomes true only at the boundary that ends the window it fell due in; a play-clock one runs on the cumulative play time.
 */
export function durationElapsed(l2: Layer2, gameFrom: GameTime | undefined, playFrom: number | undefined, d: { clock: 'game' | 'play'; s: number }): boolean {
  if (d.clock === 'play') return playFrom !== undefined && l2.playTotal() - playFrom >= d.s;
  return gameFrom !== undefined && gameTick(l2) - gameFrom >= d.s;
}

export function computeWakeups(l2: Layer2, inst: Instance): Wakeup[] {
  const st = inst.st;
  const doc = st.document;
  const k = l2.k;
  const now = k.now;
  const W = k.config.wSim;
  const nextBoundary = (Math.floor(now / W) + 1) * W;
  const out: Wakeup[] = [];
  // A game-time wake-up fires at the window boundary that ends the window it falls due in (S2 section 4.3).
  const add = (at: GameTime, reason: string): void => { out.push({ clock: 'game', at: Math.max(ceilTo(at, W), nextBoundary), reason }); };
  // A play-time wake-up is checked by the arbiter's step, on the cumulative play time.
  const addPlay = (at: number, reason: string): void => { out.push({ clock: 'play', at, reason }); };
  if (st.state === 'waiting') add(ceilTo((st.lastRecast ?? st.since) + l2.tun.recastEvery, W), 'recast');
  const sites = [...predSites(doc), ...inst.st.closure.fragments.flatMap((f) => fragmentSites(f))];
  let believes = false;
  const hours = new Set<number>();
  for (const s of sites) {
    for (const { atom } of atoms(s.pred)) {
      if ('believes' in atom) believes = true;
      else if ('city' in atom || 'social' in atom) {
        // a read that depends on beliefs, which emit no Changes, is looked at again at every boundary (S2 4.1)
        const call = readCall(atom);
        if (!('error' in call) && l2.reg.sim?.builds(call.name) && l2.reg.sim.deps(call.name).boundary) believes = true;
      }
      else if ('hour' in atom) { hours.add(atom.hour[0]); hours.add(atom.hour[1]); }
      else if ('since' in atom && 'atLeast' in atom) {
        if (atom.atLeast.clock === 'play') {
          const from = sincePlayFrom(inst, atom.since, atom.atLeast.s);
          if (from !== undefined && from + atom.atLeast.s > l2.playTotal()) addPlay(from + atom.atLeast.s, 'since');
        } else {
          const from = 'beat' in atom.since ? inst.st.beats[atom.since.beat]?.finalAt : stateSince(inst, atom.since.state);
          if (from !== undefined && from + atom.atLeast.s > gameTick(l2)) add(from + atom.atLeast.s, 'since');
        }
      }
    }
  }
  if (believes && !isTerminal(st.state)) add(nextBoundary, 'believes');
  for (const h of hours) {
    const day = 86_400;
    const base = Math.floor(now / day) * day;
    for (const d of [0, 1]) {
      const at = base + d * day + h * 3600;
      if (at > now) { add(at, 'hour'); break; }
    }
  }
  for (const [key, rs] of Object.entries(st.roles)) {
    if (rs.ladder.waitUntil !== undefined && rs.ladder.waitUntil > gameTick(l2)) add(rs.ladder.waitUntil, `wait:${key}`);
    if (rs.ladder.waitUntilPlay !== undefined && rs.ladder.waitUntilPlay > l2.playTotal()) addPlay(rs.ladder.waitUntilPlay, `wait:${key}`);
  }
  if (st.state === 'unattended') {
    const after = doc.unattended.after;
    if (after.clock === 'play') addPlay((planPlayFrom(inst) ?? l2.playTotal()) + after.s, 'unattended');
    else add((st.entered.unattended ?? now) + after.s, 'unattended');
  }
  for (const d of st.deliveries) if (d.state === 'displayed' && d.what === 'offer' && d.lapseGameAt !== undefined) add(d.lapseGameAt, 'lapse');
  for (const [key, rt] of Object.entries(st.beats)) {
    const b = doc.beats[key]!;
    if (rt.state === 'available' && b.kind === 'aftermath' && b.aftermath && !rt.delayed) {
      if (b.aftermath.delay.clock === 'play') addPlay((rt.availableAtPlay ?? l2.playTotal()) + b.aftermath.delay.s, `aftermath:${key}`);
      else add((rt.availableAt ?? now) + b.aftermath.delay.s, `aftermath:${key}`);
    }
  }
  const uniq = new Map<string, Wakeup>();
  for (const w of out) uniq.set(`${w.clock}|${w.at}|${w.reason}`, w);
  return [...uniq.values()].sort((a, b) => (a.clock < b.clock ? -1 : a.clock > b.clock ? 1 : 0) || a.at - b.at || (a.reason < b.reason ? -1 : 1));
}

/**
 * The kernel values a predicate can read, as interests (S2 section 4.1): a game fact and, through its `decidedBy` guard, every fact the
 * guard reads (and the guards of those); a `decided` test reads the guard; a role's cast node; an event kind a `count` reads; a registered
 * read's declared dependencies. One collection serves an instance's watch frame and a pack's sowing watcher, so a sowing predicate
 * waits on exactly what an instance's would (L2-09).
 */
export function addPredInterests(l2: Layer2, p: Pred, inst: Instance | undefined, add: (s: Selector) => void): void {
  const guardOf = (name: string): Pred | undefined => {
    const g = l2.facts[name]?.decidedBy;
    if (g === undefined) return undefined;
    const gp = typeof g === 'string' && g !== 'yes' && g !== 'no' ? l2.parseCached(g) : g;
    return typeof gp === 'string' ? undefined : gp;
  };
  const seen = new Set<string>();
  const guardInterests = (name: string): void => {
    if (seen.has(`g:${name}`)) return;
    seen.add(`g:${name}`);
    const gp = guardOf(name);
    if (gp) for (const { atom } of atoms(gp)) { if ('fact' in atom) factInterest(atom.fact); else if ('decided' in atom) guardInterests(atom.decided); }
  };
  const factInterest = (name: string): void => {
    add({ kind: 'core:game-fact', slot: 'value', scope: { nodes: [l2.factNode(name)] } });
    guardInterests(name);
  };
  const roleInterest = (role: string): void => {
    const c = inst?.st.roles[role]?.cast;
    if (c !== undefined) add({ slot: '*', scope: { nodes: [c] } });
  };
  for (const { atom } of atoms(p)) {
    if ('fact' in atom) factInterest(atom.fact);
    else if ('decided' in atom) guardInterests(atom.decided);
    else if ('role' in atom) roleInterest(atom.role);
    else if ('believes' in atom) roleInterest(atom.believes.who);
    else if ('count' in atom) {
      const w: Selector['where'] = atom.count.kind === undefined ? [] : [{ path: 'kind', op: 'eq', arg: atom.count.kind }];
      add({ kind: 'core:event', slot: '*', where: w });
    } else if ('exposed' in atom) {
      // Exposure to a canon event changes when such an event is minted or made canon (R2-03).
      const ek = atom.exposed.event?.kind;
      add({ kind: 'core:event', slot: '*', where: ek === undefined ? [] : [{ path: 'kind', op: 'eq', arg: ek }] });
    } else if ('fn' in atom) {
      for (const r of atom.reads) {
        if (r.fact) factInterest(r.fact);
        else if (r.node) add({ slot: '*', scope: { nodes: [r.node] } });
        else if (r.role) roleInterest(r.role);
      }
    } else if ('city' in atom || 'social' in atom) {
      // A read declares what it depends on (S1 9.1); a dependency that names no kind watches the nodes the read is made of.
      const call = readCall(atom);
      const port = l2.reg.sim;
      if ('error' in call || !port?.builds(call.name)) continue;
      const args = resolveReadArgs(call, inst);
      const nodes = (args ?? []).filter((a): a is Id => typeof a === 'string' && /^[0-9a-f]{32}$/.test(a));
      for (const dep of port.deps(call.name).interests) {
        if (dep.kind === undefined && dep.slot === '*') {
          if (nodes.length > 0) add({ slot: '*', scope: { nodes } });
        } else add({ ...(dep.kind !== undefined ? { kind: dep.kind } : {}), slot: dep.slot });
      }
    }
  }
}

/** The interests the watch frame holds: every kernel value the instance's predicates can read (S2 section 4.1). */
export function collectInterests(l2: Layer2, inst: Instance): Selector[] {
  const st = inst.st;
  const doc = st.document;
  const out = new Map<string, Selector>();
  const add = (s: Selector): void => { out.set(canonicalKey(s), s); };
  const roleInterest = (role: string): void => {
    const c = st.roles[role]?.cast;
    if (c !== undefined) add({ slot: '*', scope: { nodes: [c] } });
  };
  const sites = [...predSites(doc), ...st.closure.fragments.flatMap((f) => fragmentSites(f))];
  for (const s of sites) addPredInterests(l2, s.pred, inst, add);
  (doc.world ?? []).forEach((w) => { if ('role' in w.target) roleInterest(w.target.role); });
  for (const key of Object.keys(doc.roles)) if (st.roles[key]?.committed) roleInterest(key);
  return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[1]);
}

export function refreshInterests(l2: Layer2, inst: Instance): void {
  const watch = inst.st.frames.watch;
  const f = watch ? l2.k.frames.frame(watch) : undefined;
  if (!f || (f.status !== 'active' && f.status !== 'blocked')) return;
  const next = collectInterests(l2, inst);
  if (canonicalKey(f.own.reactsTo) !== canonicalKey(next)) l2.k.frames.setInterests(f.id, { reactsTo: next }, inst.id);
}

void ids;
void isLive;
void playOf;
