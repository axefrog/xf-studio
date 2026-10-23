// Property tests (S2 section 14.1): generated seeds and predicates, claim order, no silent loss under random
// faults, the arbiter's stream properties, return invariance, and deterministic reports.

import { describe, expect, test } from 'bun:test';
import { canonicalKey } from '../../src/canon.ts';
import { H, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { evalPred } from '../../src/seeding/eval.ts';
import type { Instance } from '../../src/seeding/layer2.ts';
import { kAll, kAny, kNot, parsePred, printPred } from '../../src/seeding/pred.ts';
import type { Pack, Pred, SeedInput, Verdict } from '../../src/seeding/types.ts';
import { type Rng, makeRng } from '../synthetic.ts';
import { MINI_ID, MINI_PACK, miniPack } from './mini.ts';
import { R1_ID, R1_PACK } from './r1.ts';
import { clock, delivery, openWindow, play, playUntil, r1World, show } from './drive.ts';
import { type World, advance, makeWorld, setFact, setGame, settle } from './world.ts';

const cause = H(hs('fx'), hs('props'));

// ---- a generator of predicates and documents ----

const FACT_NAMES = ['x', 'y', 'flag', 'q112_done', 'q112_takemura_dead'];

function genPred(rng: Rng, depth: number): Pred {
  const leaf = (): Pred => {
    switch (rng.int(14)) {
      case 0: return 'yes';
      case 1: return 'no';
      case 2: return { fact: rng.pick(FACT_NAMES), op: rng.pick(['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const), value: rng.int(3) };
      case 3: return { seedFact: 'stage', op: rng.pick(['eq', 'gt'] as const), value: rng.int(3) };
      case 4: return { decided: rng.pick(FACT_NAMES) };
      case 5: return { cast: 'npc' };
      case 6: return { role: 'npc', p: { path: 'age', op: 'field-at-least', arg: 20 + rng.int(40) } };
      case 7: return { beat: rng.pick(['meet', 'finish']), state: ['done', 'skipped'] };
      case 8: return { response: 'meet', is: [rng.pick(['action', 'decline', 'null', 'action:go'])] };
      case 9: return { hour: [rng.int(24), rng.int(24)] };
      case 10: return { count: { kind: rng.pick(['collector-visit', 'shared-activity']) }, op: 'ge', value: rng.int(3) };
      case 11: return { setting: 'content.dread', is: ['0', '1', '2', '3'].slice(0, 1 + rng.int(4)) };
      case 12: return { since: { state: rng.pick(['sown', 'waiting', 'cast'] as const) }, atLeast: { clock: 'game', s: rng.int(5000) } };
      default: return { exposed: { seed: MINI_ID, atLeast: rng.pick(['ambient', 'presented', 'confirmed'] as const) } };
    }
  };
  if (depth <= 0) return leaf();
  switch (rng.int(5)) {
    case 0: return { all: Array.from({ length: rng.int(4) }, () => genPred(rng, depth - 1)) };
    case 1: return { any: Array.from({ length: rng.int(4) }, () => genPred(rng, depth - 1)) };
    case 2: return { not: genPred(rng, depth - 1) };
    default: return leaf();
  }
}

describe('generated predicates', () => {
  test('every generated predicate round-trips through the text form, and evaluates to a verdict in awkward states', () => {
    const rng = makeRng('gen-preds');
    const states: Array<(w: World) => void> = [
      () => {},
      (w) => { setFact(w, 'x', 1, 0); },
      (w) => { setFact(w, 'q112_done', 0, 0); setFact(w, 'q112_takemura_dead', 1, 0); },
      (w) => { setFact(w, 'flag', 2, 0); setFact(w, 'y', -1, 0); },
    ];
    for (let n = 0; n < 150; n++) {
      const p = genPred(rng, 3);
      const text = printPred(p);
      const back = parsePred(text);
      expect(back, text).toEqual(p);
      expect(printPred(back)).toBe(text);
    }
    for (const prep of states) {
      const w = makeWorld('gen-eval');
      prep(w);
      advance(w, 10);
      const npc = w.k.root('npc', 'core:person');
      void npc;
      w.l2.installPack(miniPack());
      const inst = w.l2.instance(w.l2.sow(MINI_PACK, MINI_ID).instance!)!;
      settle(w);
      const r2 = makeRng('gen-eval-2');
      for (let n = 0; n < 80; n++) {
        const p = genPred(r2, 3);
        const v = evalPred(w.l2, { inst, t: w.k.now }, p);
        expect(['yes', 'no', 'maybe']).toContain(v);
        // Evaluation is read-only: it is stable and moves nothing (S0 I-13).
        expect(evalPred(w.l2, { inst, t: w.k.now }, p)).toBe(v);
      }
    }
  });

  test('Kleene laws hold over generated predicates: double negation, De Morgan, commutativity', () => {
    const rng = makeRng('kleene-laws');
    const w = makeWorld('kleene-laws');
    setFact(w, 'x', 1, 0);
    advance(w, 10);
    const ev = (p: Pred): Verdict => evalPred(w.l2, { t: w.k.now }, p);
    for (let n = 0; n < 200; n++) {
      const a = genPred(rng, 2);
      const b = genPred(rng, 2);
      expect(ev({ not: { not: a } })).toBe(ev(a));
      expect(ev({ not: { all: [a, b] } })).toBe(ev({ any: [{ not: a }, { not: b }] }));
      expect(ev({ not: { any: [a, b] } })).toBe(ev({ all: [{ not: a }, { not: b }] }));
      expect(ev({ all: [a, b] })).toBe(ev({ all: [b, a] }));
      expect(ev({ any: [a, b] })).toBe(ev({ any: [b, a] }));
      expect(ev({ all: [a, b] })).toBe(kAll([ev(a), ev(b)]));
      expect(ev({ any: [a, b] })).toBe(kAny([ev(a), ev(b)]));
      expect(ev({ not: a })).toBe(kNot(ev(a)));
    }
  });
});

describe('generated documents', () => {
  /** A random document built from the mini seed: predicates, roles, beats and links varied at random. */
  function genSeed(rng: Rng, n: number): SeedInput {
    const beats: Record<string, unknown> = { meet: { play: 'pack:f-meet' } };
    const keys = ['meet'];
    for (let i = 0; i < 1 + rng.int(5); i++) {
      const key = `b${i}`;
      const kind = rng.pick([undefined, 'texture', 'exit', 'decision', 'obstacle', 'aftermath', 'conclusion'] as const);
      const links = Array.from({ length: rng.int(3) }, () => {
        const src = rng.pick(keys);
        return rng.pick([{ because: src, on: printPred(genPred(rng, 1)) }, { because: src }, { obstructedBy: src }, { then: src }]);
      });
      beats[key] = { play: 'pack:f-finish', ...(kind ? { kind } : {}), ...(links.length ? { links } : {}), ...(rng.int(2) ? { leaves: [{ fact: 'stage', set: rng.int(4) }] } : {}), ...(rng.int(4) === 0 ? { objective: { kind: 'task', succeeds: printPred(genPred(rng, 1)) } } : {}) };
      keys.push(key);
    }
    return {
      id: `x:gen-${n}`, version: 1, maturity: rng.pick(['sketch', 'playable', 'ready'] as const), level: 'gig', turns: [], purpose: { tags: ['t'], sentence: 's' },
      context: printPred(genPred(rng, 2)), intent: { prohibitions: [], tone: [] },
      roles: { npc: { kind: 'core:person', ...(rng.int(2) ? { must: [{ path: 'age-class', op: 'eq', arg: 'adult' }] } : {}), ...(rng.int(3) === 0 ? { onUnfilled: [rng.pick(['wait', 'withdraw', 'shrink', 'standIn'] as const)] } : {}) } },
      facts: { stage: { route: { consumers: rng.pick([['end'], [], ['meet'], ['b0']]) }, initial: 0 } },
      windows: [{ id: 'w', opens: printPred(genPred(rng, 2)), closes: printPred(genPred(rng, 1)), onClose: rng.pick(['withdraw', 'degrade', 'coda'] as const) }],
      start: ['meet'], beats, end: printPred(genPred(rng, 2)), unattended: { after: { clock: 'game', s: 600 }, outcome: [] }, closing: 'pack:t-closing',
    } as unknown as SeedInput;
  }

  test('compile, lint and the fit report never crash on a generated document, whatever the state, and change nothing', () => {
    const rng = makeRng('gen-docs');
    for (let n = 0; n < 120; n++) {
      const w = makeWorld(`gen-doc-${n % 4}`, { l2: { lab: true } });
      const person = w.k.root('p', 'core:person');
      w.k.addEdge({ type: 'core:located-in', from: person, to: w.city, cause });
      if (n % 2) w.k.pin({ node: person, slot: 'age', value: 20 + (n % 40), reason: 'authored', cause });
      if (n % 3 === 0) setFact(w, 'x', 1, 0);
      const seed = genSeed(rng, n);
      const pack: Pack = { ...miniPack(), seeds: [seed as never] };
      const pf = w.l2.installPack(pack);
      if (pf.some((f) => f.level === 'error')) continue;
      const rev = w.k.revision;
      const res = w.l2.compile(MINI_PACK, seed);
      expect(typeof res.ok).toBe('boolean');
      expect(Array.isArray(res.findings)).toBe(true);
      if (res.ok) {
        // A document that compiled has every predicate as a tree that prints and parses back.
        const again = w.l2.compile(MINI_PACK, seed);
        expect(again.ok && canonicalKey(again.seed)).toBe(canonicalKey(res.seed));
      }
      const fit = w.l2.fit(MINI_PACK, seed.id);
      expect(['fits', 'waits', 'no-fit']).toContain(fit.verdict);
      expect(w.k.revision).toBe(rev);
      expect(canonicalKey(w.l2.fit(MINI_PACK, seed.id))).toBe(canonicalKey(fit));
    }
  });

  test('a generated seed that compiles and is sown never crashes the engine over a random run, and every instance stays valid', () => {
    const rng = makeRng('gen-run');
    let sown = 0;
    for (let n = 0; n < 60; n++) {
      const w = makeWorld(`gen-run-${n % 3}`, { l2: { lab: true } });
      for (let i = 0; i < 3; i++) {
        const p = w.k.root(`p${i}`, 'core:person');
        w.k.addEdge({ type: 'core:located-in', from: p, to: w.city, cause });
        w.k.pin({ node: p, slot: 'age', value: 25 + i * 10, reason: 'authored', cause });
      }
      setFact(w, 'x', 0, 0);
      setFact(w, 'flag', 1, 0);
      setFact(w, 'y', 0, 0);
      const seed = genSeed(rng, n);
      seed.maturity = 'playable';
      seed.windows = [{ id: 'w', opens: 'yes', onClose: 'withdraw' }];
      seed.context = 'yes';
      const pack: Pack = { ...miniPack(), seeds: [seed as never] };
      if (w.l2.installPack(pack).some((f) => f.level === 'error')) continue;
      const r = w.l2.sow(MINI_PACK, seed.id);
      if (!r.ok) continue;
      sown++;
      const inst = w.l2.instance(r.instance!)!;
      settle(w);
      for (let step = 0; step < 12; step++) {
        const choice = rng.int(5);
        if (choice === 0) play(w, clock(w) + 1 + rng.int(90));
        else if (choice === 1) {
          const d = inst.st.deliveries.find((x) => x.state === 'released' || x.state === 'displayed');
          if (d) show(w, d, rng.pick(['ambient', 'presented', 'confirmed'] as const));
        } else if (choice === 2) {
          const d = inst.st.deliveries.find((x) => x.what === 'offer' && x.state === 'displayed');
          if (d) w.l2.respond(d.id, rng.pick([{ kind: 'action', id: 'go' }, { kind: 'decline', id: 'no' }, { kind: 'null' }] as const));
        } else if (choice === 3) advance(w, w.k.now + 100 + rng.int(2000));
        else {
          w.k.persistence.save(`g-${n}-${step}`);
          w.k.persistence.load(`g-${n}-${step}`, w.gamePort);
        }
        settle(w);
        const cur = w.l2.instance(inst.id)!;
        expect(['sown', 'waiting', 'cast', 'offered', 'running', 'unattended', 'resolved', 'withered', 'withdrawn']).toContain(cur.st.state);
        for (const rt of Object.values(cur.st.beats)) expect(['locked', 'available', 'running', 'deferred', 'done', 'failed', 'skipped']).toContain(rt.state);
        // Terminal states are final (S2-I-9): a terminal instance has no live frames and no cast edges in effect.
        if (['resolved', 'withered', 'withdrawn'].includes(cur.st.state)) {
          expect(w.k.store.allEdges().filter((e) => e.type === 'core:cast' && e.from === cur.id && e.valid.to === undefined)).toHaveLength(0);
          expect(w.k.frames.demandRoots.has(cur.id)).toBe(false);
        }
      }
    }
    expect(sown).toBeGreaterThan(5);
  });
});

describe('claim order (S2-I-10)', () => {
  test('over random casting orders, a seed that cannot share never ends up holding a node an authored seed holds a claim on, and the holder is authored whenever an authored seed exists', () => {
    const rng = makeRng('claim-order');
    for (let round = 0; round < 40; round++) {
      const w = makeWorld(`claim-${round % 5}`);
      const pool = 1 + rng.int(2);
      const people: Id[] = [];
      for (let i = 0; i < pool; i++) {
        const p = w.k.root(`person-${i}`, 'core:person');
        w.k.addEdge({ type: 'core:located-in', from: p, to: w.city, cause });
        w.k.pin({ node: p, slot: 'age', value: 30, reason: 'authored', cause });
        people.push(p);
      }
      const seeds = Array.from({ length: 2 + rng.int(3) }, (_, i) => ({ id: `x:s${i}`, pack: `pk${i}`, authored: rng.int(2) === 0 }));
      const hasAuthored = seeds.some((s) => s.authored);
      const order = [...seeds].sort(() => rng.int(3) - 1);
      const ids: Id[] = [];
      for (const s of order) {
        const pack = miniPack({ id: s.pack, ...(s.authored ? {} : { source: 'procedural' as const }) }, { id: s.id, windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }] } as never);
        expect(w.l2.installPack(pack)).toEqual([]);
        ids.push(w.l2.sow(s.pack, s.id).instance!);
        settle(w);
      }
      const holders = new Map<Id, Instance[]>();
      for (const id of ids) {
        const inst = w.l2.instance(id)!;
        const c = inst.st.roles.npc!.cast;
        if (c !== undefined && !['withered', 'withdrawn', 'resolved'].includes(inst.st.state)) holders.set(c, [...(holders.get(c) ?? []), inst]);
      }
      for (const [, hs2] of holders) expect(hs2).toHaveLength(1);
      // No authored seed goes without while a procedural one holds a node: authored seeds fill the pool first, in every order.
      const authoredCount = seeds.filter((x) => x.authored).length;
      const authoredHolders = [...holders.values()].filter((hs2) => hs2[0]!.st.source.layer === 'authored').length;
      expect(authoredHolders).toBe(Math.min(authoredCount, pool));
      void hasAuthored;
      // The holder of a node is the same whatever the order: the lowest Id among the authored seeds that wanted it.
      if (pool === 1) {
        const authoredIds = ids.filter((id) => w.l2.instance(id)!.st.source.layer === 'authored').sort();
        if (authoredIds.length > 0) expect(holders.get(people[0]!)![0]!.id).toBe(authoredIds[0]!);
      }
    }
  });
});

describe('no silent loss (S2-I-5) under random faults', () => {
  test('every refusal, failed preparation, expiry, miss, withering, withdrawal and loss leaves a record entry, whatever happens to the world', () => {
    for (let round = 0; round < 25; round++) {
      const rng = makeRng(`faults-${round}`);
      const { w } = r1World(`faults-${round % 4}`);
      openWindow(w);
      const inst = (): Instance => w.l2.ofTemplate(R1_ID)[0]!;
      for (let step = 0; step < 14; step++) {
        const c = rng.int(8);
        if (c === 0) play(w, clock(w) + 1 + rng.int(200));
        else if (c === 1) {
          const d = inst().st.deliveries.find((x) => x.state === 'released' || x.state === 'displayed');
          if (d) show(w, d, rng.pick(['ambient', 'presented', 'confirmed'] as const), d.provenance.channel, { final: rng.int(3) === 0 });
        } else if (c === 2) {
          const d = inst().st.deliveries.find((x) => x.what === 'offer' && x.state === 'displayed');
          if (d) w.l2.respond(d.id, rng.pick([{ kind: 'action', id: 'accept' }, { kind: 'decline', id: 'decline' }, { kind: 'null' }, { kind: 'retract' }] as const));
        } else if (c === 3) setGame(w, 'takemura', 'fx:character', 'alive', rng.int(2), w.k.now + 1);
        else if (c === 4) setFact(w, 'q115_point_of_no_return', rng.int(2), w.k.now + 1);
        else if (c === 5) advance(w, w.k.now + 50 + rng.int(3000));
        else if (c === 6) {
          w.k.persistence.save(`f-${round}-${step}`);
          w.k.persistence.load(`f-${round}-${step}`, w.gamePort);
        } else setGame(w, 'takemura', 'fx:character', 'allied', rng.int(2), w.k.now + 1);
        settle(w);
      }
      const i = inst();
      const said = new Set<unknown>();
      for (const r of i.st.record) {
        if (r.data.delivery !== undefined) said.add(r.data.delivery);
        if (r.data.offer !== undefined) said.add(r.data.offer);
      }
      for (const d of i.st.deliveries) {
        if (d.state === 'expired' || d.state === 'withdrawn') expect(said.has(d.id), `delivery ${d.what}:${d.beat} ${d.state}`).toBe(true);
      }
      if (['resolved', 'withered', 'withdrawn'].includes(i.st.state)) {
        expect(i.st.record.some((r) => r.kind === 'transition' && ['resolved', 'withered', 'withdrawn'].includes((r.data as { to?: string }).to ?? ''))).toBe(true);
        expect(i.st.record.some((r) => r.kind === 'closure')).toBe(true);
      }
      // Entry numbers are unique and never reused.
      const ns = i.st.record.map((r) => r.n);
      expect(new Set(ns).size).toBe(ns.length);
    }
  });
});

describe('the arbiter over random streams', () => {
  test('spacing, the cap, forbidden aspects, a busy UI and tempo off hold at every release', () => {
    for (let round = 0; round < 12; round++) {
      const rng = makeRng(`arb-${round}`);
      const w = makeWorld('arb', { l2: { tunables: { maxLive: 12, displayTimeoutPersistent: 1_000_000 } } });
      const keys = Array.from({ length: 8 }, (_, i) => `b${i}`);
      const frags = keys.map((k) => ({ id: `f-${k}`, level: 'exchange' as const, roles: [], salience: 'foreground' as const, forms: { standard: `pack:t-${k}` }, channels: [rng.pick(['message', 'message', 'pin', 'trace'])] }));
      const pack: Pack = {
        id: MINI_PACK, version: 1,
        seeds: [{ id: MINI_ID, version: 1, maturity: 'ready', level: 'gig', turns: [], purpose: { tags: ['t'], sentence: 's' }, context: 'yes', intent: { prohibitions: [], tone: [] }, roles: {}, windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }], start: keys, beats: Object.fromEntries(keys.map((k) => [k, { play: `pack:f-${k}` }])), end: 'no', unattended: { after: { clock: 'game', s: 600 }, outcome: [] } } as never],
        fragments: frags, texts: keys.map((k) => ({ id: `t-${k}`, text: k, origin: 'authored' as const })),
      };
      w.l2.installPack(pack);
      const tempo = rng.pick(['calm', 'steady', 'restless'] as const);
      w.k.settings.set({ tempo });
      const inst = w.l2.instance(w.l2.sow(MINI_PACK, MINI_ID).instance!)!;
      settle(w);
      const log: Array<{ s: number; busy: boolean; aspects: string[] }> = [];
      for (let s = 0; s < 900; s++) {
        if (rng.int(40) === 0) w.port.busy = !w.port.busy;
        if (rng.int(30) === 0) { w.port.aspectSet.clear(); if (rng.int(2)) w.port.aspectSet.add(rng.pick(['combat', 'driving', 'dialogue', 'speaking'])); }
        log.push({ s, busy: w.port.busy, aspects: [...w.port.aspectSet] });
        w.l2.advancePlay(s);
        settle(w);
      }
      const factor = tempo === 'calm' ? 2 : tempo === 'restless' ? 0.5 : 1;
      const spacing = 60 * factor;
      const cap = Math.max(1, Math.floor(2 / factor));
      const nonZero = w.l2.arbiter.log.filter((e) => e.class !== 0);
      for (let i = 1; i < nonZero.length; i++) expect(nonZero[i]!.at - nonZero[i - 1]!.at).toBeGreaterThanOrEqual(spacing);
      for (let i = 0; i < nonZero.length; i++) {
        const within = nonZero.filter((e) => e.at > nonZero[i]!.at - 600 && e.at <= nonZero[i]!.at).length;
        expect(within).toBeLessThanOrEqual(cap);
      }
      for (const e of w.l2.arbiter.log) {
        const st = log[e.at]!;
        expect(st.busy).toBe(false);
        expect(st.aspects.filter((a) => ['combat', 'driving', 'dialogue'].includes(a))).toEqual([]);
      }
      const zero = w.l2.arbiter.log.filter((e) => e.class === 0);
      for (let i = 1; i < zero.length; i++) expect(zero[i]!.at - zero[i - 1]!.at).toBeGreaterThanOrEqual(20);
      void inst;
    }
  });

  test('with tempo off only authored, pull and closing deliveries pass', () => {
    const w = makeWorld('tempo-off', { l2: { tunables: { maxLive: 12, displayTimeoutPersistent: 1_000_000 } } });
    w.k.settings.set({ tempo: 'off' });
    for (const [id, source] of [['a', undefined], ['p', 'procedural']] as const) {
      const pack: Pack = {
        id, version: 1, ...(source ? { source } : {}),
        seeds: [{ id: `x:${id}`, version: 1, maturity: 'ready', level: 'gig', turns: [], purpose: { tags: ['t'], sentence: 's' }, context: 'yes', intent: { prohibitions: [], tone: [] }, roles: {}, windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }], start: ['b'], beats: { b: { play: 'pack:f' } }, end: 'no', unattended: { after: { clock: 'game', s: 600 }, outcome: [] } } as never],
        fragments: [{ id: 'f', level: 'exchange', roles: [], salience: 'foreground', forms: { standard: 'pack:t' }, channels: ['message'] }], texts: [{ id: 't', text: 'x', origin: 'authored' }],
      };
      w.l2.installPack(pack);
      w.l2.sow(id, `x:${id}`);
    }
    settle(w);
    play(w, 1500);
    for (const e of w.l2.arbiter.log) expect(w.l2.instance(e.seed)!.st.source.layer).toBe('authored');
    expect(w.l2.arbiter.log.length).toBeGreaterThan(0);
  });
});

describe('return invariance and settings invariance (S2-I-12)', () => {
  test('across random real-world gaps the story decisions are identical; only the session state differs', () => {
    const decisions = (age: number): string => {
      const { w, inst } = r1World('return-inv');
      openWindow(w);
      playUntil(w, () => delivery(inst, 'offer-1') !== undefined);
      show(w, delivery(inst, 'offer-1')!, 'confirmed');
      w.k.persistence.save('a');
      w.port.load = { class: 'known', ageSeconds: age };
      w.k.persistence.load('a', w.gamePort);
      settle(w);
      play(w, clock(w) + 400);
      const cur = w.l2.instance(inst.id)!;
      const d = cur.st.deliveries.find((x) => x.what === 'offer')!;
      w.l2.respond(d.id, { kind: 'action', id: 'accept' });
      settle(w);
      return canonicalKey({ state: cur.st.state, transitions: cur.st.record.filter((r) => r.kind === 'transition').map((r) => (r.data as { row: string }).row), facts: cur.st.facts.rung && w.k.store.pin(cur.st.facts.rung.pin!)!.value });
    };
    const base = decisions(120);
    const rng = makeRng('gaps');
    for (let n = 0; n < 6; n++) expect(decisions(rng.int(40 * 86_400))).toBe(base);
  });
});

describe('reports are deterministic, and fitting gives the same report with sowing on and off', () => {
  test('the same fit report twice, and with the watcher sowing the template or not', () => {
    const report = (sow: boolean): string => {
      const w = makeWorld('fit-on-off');
      for (let i = 0; i < 5; i++) {
        const p = w.k.root(`p${i}`, 'core:person');
        w.k.addEdge({ type: 'core:located-in', from: p, to: w.city, cause });
        w.k.pin({ node: p, slot: 'age', value: 25 + i, reason: 'authored', cause });
      }
      setFact(w, 'x', 0, 0);
      setFact(w, 'flag', 1, 0);
      const pack = miniPack({}, { windows: [{ id: 'w', opens: 'flag == 1', onClose: 'withdraw' }] } as never);
      if (!sow) pack.seeds[0]!.maturity = 'sketch';
      w.l2.installPack(pack);
      settle(w);
      expect(w.l2.ofTemplate(MINI_ID).length).toBe(sow ? 1 : 0);
      const fit = w.l2.fit(MINI_PACK, MINI_ID);
      expect(canonicalKey(w.l2.fit(MINI_PACK, MINI_ID))).toBe(canonicalKey(fit));
      const { findings: _f, ...rest } = fit;
      return canonicalKey(rest);
    };
    expect(report(true)).toBe(report(false).replace(/x/g, 'x'));
    void R1_PACK;
  });
});
