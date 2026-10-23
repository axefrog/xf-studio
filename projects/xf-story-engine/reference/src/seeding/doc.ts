// The seed document: binding status (S2 section 2.2), predicate parsing across the whole document, and the
// traversals the compiler, the lint and layer 2's runtime share.

import { PredSyntaxError, toPred, walkPred } from './pred.ts';
import type {
  Beat, CompiledSeed, EffectDecl, Fragment, Part, Pred, PredInput, Seed, SeedInput,
} from './types.ts';

// ---- binding status ----

export interface Bound<T> {
  status: 'fixed' | 'prefer' | 'open';
  value?: T;
  strength?: 1 | 2 | 3;
  ifRejected?: 'withdraw' | 'degrade' | 'refit';
  note?: string;
}

export function bound<T>(part: Part<T> | undefined): Bound<T> {
  if (part === undefined) return { status: 'open' };
  if (typeof part === 'object' && part !== null && !Array.isArray(part)) {
    const o = part as Record<string, unknown>;
    if ('open' in o && o.open === true && Object.keys(o).every((k) => k === 'open' || k === 'note')) {
      const out: Bound<T> = { status: 'open' };
      if (typeof o.note === 'string') out.note = o.note;
      return out;
    }
    if ('prefer' in o && 'strength' in o && Object.keys(o).every((k) => k === 'prefer' || k === 'strength' || k === 'note')) {
      const out: Bound<T> = { status: 'prefer', value: o.prefer as T, strength: o.strength as 1 | 2 | 3 };
      if (typeof o.note === 'string') out.note = o.note;
      return out;
    }
    if ('fixed' in o && Object.keys(o).every((k) => k === 'fixed' || k === 'note' || k === 'ifRejected')) {
      const out: Bound<T> = { status: 'fixed', value: o.fixed as T };
      if (typeof o.note === 'string') out.note = o.note;
      if (o.ifRejected !== undefined) out.ifRejected = o.ifRejected as Bound<T>['ifRejected'] & string;
      return out;
    }
  }
  return { status: 'fixed', value: part as T };
}

/** The fragments a beat can play: one fixed reference, or alternates. Open and preferred parts need layer 3. */
export function playOf(beat: { play: Beat['play'] }): { refs: string[]; alternates: boolean; status: Bound<unknown>['status'] } {
  const b = bound(beat.play as Part<string | { alternates: string[] }>);
  const v = b.value;
  if (v === undefined) return { refs: [], alternates: false, status: b.status };
  if (typeof v === 'string') return { refs: [v], alternates: false, status: b.status };
  return { refs: [...v.alternates], alternates: true, status: b.status };
}

// ---- predicates across the document ----

/** Parse every predicate in a document written in text form; the result has trees only. Throws PredSyntaxError with the path. */
export function resolvePreds(seed: SeedInput): CompiledSeed {
  const at = (path: string, x: PredInput | undefined): Pred | undefined => {
    if (x === undefined) return undefined;
    try {
      return toPred(x);
    } catch (e) {
      if (e instanceof PredSyntaxError) throw new PredSyntaxError(`${path}: ${e.message}`, e.pos);
      throw e;
    }
  };
  const req = (path: string, x: PredInput | undefined, dflt: Pred): Pred => at(path, x) ?? dflt;
  const beats: CompiledSeed['beats'] = {};
  for (const [key, b] of Object.entries(seed.beats ?? {})) {
    const nb = { ...b } as CompiledSeed['beats'][string];
    if (b.objective) {
      const o: { kind: 'task' | 'condition'; succeeds: Pred; fails?: Pred; warns?: Pred } = {
        kind: b.objective.kind, succeeds: req(`beats.${key}.objective.succeeds`, b.objective.succeeds, 'no'),
      };
      const f = at(`beats.${key}.objective.fails`, b.objective.fails);
      const w = at(`beats.${key}.objective.warns`, b.objective.warns);
      if (f) o.fails = f;
      if (w) o.warns = w;
      nb.objective = o;
    }
    if (b.failure) {
      nb.failure = b.failure.map((f, i) => {
        const out: { when: Pred; warnFirst?: Pred; leadsTo: string } = { when: req(`beats.${key}.failure[${i}].when`, f.when, 'no'), leadsTo: f.leadsTo };
        const wf = at(`beats.${key}.failure[${i}].warnFirst`, f.warnFirst);
        if (wf) out.warnFirst = wf;
        return out;
      });
    }
    if (b.links) {
      nb.links = b.links.map((l, i) => {
        if ('because' in l) {
          const out: { because: string; on?: Pred } = { because: l.because };
          const on = at(`beats.${key}.links[${i}].on`, l.on);
          if (on) out.on = on;
          return out;
        }
        return l;
      });
    }
    if (b.aftermath) {
      nb.aftermath = { delay: b.aftermath.delay, signposts: b.aftermath.signposts };
      const c = at(`beats.${key}.aftermath.cancelIf`, b.aftermath.cancelIf);
      if (c) nb.aftermath.cancelIf = c;
    }
    if (b.reoffer) nb.reoffer = { when: req(`beats.${key}.reoffer.when`, b.reoffer.when, 'no'), max: b.reoffer.max };
    beats[key] = nb;
  }
  const out: CompiledSeed = {
    ...(seed as Omit<Seed, 'beats' | 'start' | 'end' | 'unattended' | 'turns'>),
    context: req('context', seed.context, 'yes'),
    end: req('end', seed.end, 'no'),
    turns: (seed.turns ?? []).map((t, i) => ({ ...t, what: req(`turns[${i}].what`, t.what, 'no') })),
    intent: { ...seed.intent, prohibitions: (seed.intent?.prohibitions ?? []).map((p, i) => req(`intent.prohibitions[${i}]`, p, 'no')) },
    windows: seed.windows.map((w, i) => {
      const { closes: _c, urgency: _u, opens: _o, ...rest } = w;
      const o: CompiledSeed['windows'][number] = { ...rest, opens: req(`windows[${i}].opens`, w.opens, 'no') };
      const c = at(`windows[${i}].closes`, w.closes);
      if (c) o.closes = c;
      if (w.urgency) o.urgency = w.urgency.map((u, j) => ({ when: req(`windows[${i}].urgency[${j}].when`, u.when, 'no'), level: u.level }));
      return o;
    }),
    beats,
    start: seed.start ?? [],
    unattended: seed.unattended ?? { after: { clock: 'game', s: 0 }, outcome: [] },
  } as CompiledSeed;
  const sow = at('sow', seed.sow);
  if (sow) out.sow = sow;
  else delete out.sow;
  if (seed.promises) out.promises = seed.promises.map((p, i) => ({ ...p, paidBy: req(`promises[${i}].paidBy`, p.paidBy, 'no') }));
  return out;
}

/** Parse a fragment's predicates. */
export function resolveFragment(f: Fragment): Fragment {
  const out = { ...f };
  if (f.needs !== undefined) out.needs = toPred(f.needs);
  if (f.applies !== undefined) out.applies = toPred(f.applies);
  if (f.responses) {
    out.responses = f.responses.map((r) => (r.needs === undefined ? r : { ...r, needs: toPred(r.needs) }));
  }
  return out;
}

export interface PredSite {
  pred: Pred;
  /** The document path of the predicate. */
  at: string;
  /** Which beat reads it, if any. */
  beat?: string;
  /** What reads it: a window, a link, an objective and so on. */
  role: string;
}

/** Every predicate in a compiled seed, with where it sits. */
export function predSites(c: CompiledSeed): PredSite[] {
  const out: PredSite[] = [];
  const add = (pred: Pred | undefined, at: string, role: string, beat?: string): void => {
    if (pred === undefined) return;
    const s: PredSite = { pred, at, role };
    if (beat !== undefined) s.beat = beat;
    out.push(s);
  };
  add(c.context, 'context', 'context');
  add(c.sow, 'sow', 'sow');
  add(c.end, 'end', 'end');
  c.intent.prohibitions.forEach((p, i) => add(p, `intent.prohibitions[${i}]`, 'prohibition'));
  c.turns.forEach((t, i) => add(t.what, `turns[${i}].what`, 'turn'));
  c.windows.forEach((w, i) => {
    add(w.opens, `windows[${i}].opens`, 'window');
    add(w.closes, `windows[${i}].closes`, 'window');
    (w.urgency ?? []).forEach((u, j) => add(u.when, `windows[${i}].urgency[${j}].when`, 'window'));
  });
  for (const [k, b] of Object.entries(c.beats)) {
    (b.links ?? []).forEach((l, i) => {
      if ('because' in l) add(l.on, `beats.${k}.links[${i}].on`, 'link', k);
    });
    if (b.objective) {
      add(b.objective.succeeds, `beats.${k}.objective.succeeds`, 'objective', k);
      add(b.objective.fails, `beats.${k}.objective.fails`, 'objective', k);
      add(b.objective.warns, `beats.${k}.objective.warns`, 'objective', k);
    }
    (b.failure ?? []).forEach((f, i) => {
      add(f.when, `beats.${k}.failure[${i}].when`, 'failure', k);
      add(f.warnFirst, `beats.${k}.failure[${i}].warnFirst`, 'failure', k);
    });
    add(b.aftermath?.cancelIf, `beats.${k}.aftermath.cancelIf`, 'aftermath', k);
    add(b.reoffer?.when, `beats.${k}.reoffer.when`, 'reoffer', k);
  }
  (c.promises ?? []).forEach((p, i) => add(p.paidBy, `promises[${i}].paidBy`, 'promise'));
  return out;
}

export function fragmentSites(f: Fragment, base = `fragments.${f.id}`): PredSite[] {
  const out: PredSite[] = [];
  if (f.needs !== undefined) out.push({ pred: f.needs as Pred, at: `${base}.needs`, role: 'needs' });
  if (f.applies !== undefined) out.push({ pred: f.applies as Pred, at: `${base}.applies`, role: 'applies' });
  (f.responses ?? []).forEach((r, i) => {
    if (r.needs !== undefined) out.push({ pred: r.needs as Pred, at: `${base}.responses[${i}].needs`, role: 'response' });
  });
  return out;
}

/** Every atom of a predicate, with its path. */
export function atoms(p: Pred): Array<{ atom: Exclude<Pred, string | { all: Pred[] } | { any: Pred[] } | { not: Pred }>; at: string }> {
  const out: Array<{ atom: never; at: string }> = [];
  walkPred(p, (n, path) => {
    if (typeof n === 'string') return;
    if ('all' in n || 'any' in n || 'not' in n) return;
    out.push({ atom: n as never, at: path });
  });
  return out as never;
}

// ---- effects ----

export interface EffectSite {
  effect: EffectDecl;
  at: string;
  /** Where it is written: the beat or fragment, and whether an action V accepted wrote it. */
  origin: 'action' | 'decline' | 'null' | 'beat' | 'fragment' | 'unattended' | 'closing';
  beat?: string;
  fragment?: string;
  offerBeat?: string;
}

export function effectSites(c: CompiledSeed, fragmentOf: (ref: string) => Fragment | undefined): EffectSite[] {
  const out: EffectSite[] = [];
  const fragEffects = (frag: Fragment, beat?: string): void => {
    (frag.leaves ?? []).forEach((e, i) => {
      const s: EffectSite = { effect: e, at: `fragments.${frag.id}.leaves[${i}]`, origin: 'fragment', fragment: frag.id };
      if (beat) s.beat = beat;
      out.push(s);
    });
    const o = frag.offer;
    if (!o) return;
    const mk = (e: EffectDecl, at: string, origin: EffectSite['origin']): void => {
      const s: EffectSite = { effect: e, at, origin, fragment: frag.id };
      if (beat) { s.beat = beat; s.offerBeat = beat; }
      out.push(s);
    };
    o.actions.forEach((a, i) => (a.writes ?? []).forEach((e, j) => mk(e, `fragments.${frag.id}.offer.actions[${i}].writes[${j}]`, 'action')));
    (o.nullPath.writes ?? []).forEach((e, j) => mk(e, `fragments.${frag.id}.offer.nullPath.writes[${j}]`, 'null'));
    o.decline.forEach((d, i) => (d.writes ?? []).forEach((e, j) => mk(e, `fragments.${frag.id}.offer.decline[${i}].writes[${j}]`, 'decline')));
  };
  for (const [k, b] of Object.entries(c.beats)) {
    (b.leaves ?? []).forEach((e, i) => out.push({ effect: e, at: `beats.${k}.leaves[${i}]`, origin: 'beat', beat: k }));
    for (const ref of playOf(b).refs) {
      const f = fragmentOf(ref);
      if (f) fragEffects(f, k);
    }
  }
  c.unattended.outcome.forEach((e, i) => out.push({ effect: e, at: `unattended.outcome[${i}]`, origin: 'unattended' }));
  return out;
}
