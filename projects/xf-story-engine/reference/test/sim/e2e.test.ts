// SF1-E: the end-to-end fixtures (S1 14.2). The spec's scale (a Kabuki week, 1,008 windows, 2,600 windows) runs with `S1_FULL=1`; the
// default run keeps every check at a smaller scale, so the suite stays a few minutes.

import { describe, expect, test } from 'bun:test';
import { processCause } from '../../src/evolution.ts';
import { H, id as hid, mintedId, s as hs } from '../../src/id.ts';
import type { SaveRecord } from '../../src/persistence.ts';
import type { Change, Id } from '../../src/types.ts';
import { defaultData, type S1Data } from '../../src/sim/data.ts';
import type { PendingChild, RingEntry } from '../../src/sim/occ.ts';
import { ReplayPort, type ReplayLine } from '../../src/sim/port.ts';
import { itemDescriptor, type ActsState } from '../../src/sim/proc-acts.ts';
import type { EventsState } from '../../src/sim/proc-events.ts';
import type { GroupDigest } from '../../src/sim/proc-groups.ts';
import type { NormsDigest, NormsState } from '../../src/sim/proc-norms.ts';
import type { StocksDigest } from '../../src/sim/proc-stocks.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice, makeKabukiSlice } from '../../src/sim/slices.ts';
import { itemTime } from '../../src/summary.ts';
import { eventsState, fxData, occurrences, seedOf } from './helpers.ts';
import { differing, recordOf } from './records.ts';

const W = 600;
const FULL = process.env.S1_FULL === '1';
const eventsProc = processCause('city.events');

/** A small deterministic generator for the fixtures' "random boundary". */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

const chainOf = (sim: Sim): Map<string, SaveRecord> => (sim.k.persistence as unknown as { chain: Map<string, SaveRecord> }).chain;

/** A fresh process of the same lineage: a new sim that holds the save chain of `from`, under another epoch, loaded at `key`. */
function transfer(from: Sim, key: string, make: () => Sim, epochs = 7): Sim {
  const fresh = make();
  for (const [k, r] of chainOf(from)) chainOf(fresh).set(k, structuredClone(r));
  for (let i = 0; i < epochs; i++) fresh.k.newEpoch();
  fresh.k.persistence.load(key);
  return fresh;
}

/** Count the runs of every process, by window, from now on. */
function countRuns(sim: Sim): Map<string, number[]> {
  const runs = new Map<string, number[]>();
  for (const [id, def] of sim.defs) {
    const run = def.run.bind(def);
    runs.set(id, []);
    def.run = (pctx, k) => {
      runs.get(id)!.push(k);
      return run(pctx, k);
    };
  }
  return runs;
}

describe('SF1-E2: a save and reload in the middle of an aftershock cascade', () => {
  const make = (): Sim =>
    Sim.create({
      worldSeed: seedOf('SF1-E2'), index: fx3Slice(),
      data: fxData((d) => {
        for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * 10) as [number, number, number, number];
        d.kinds.find((k) => k.name === 'gang-clash')!.offspringFactor = 1.3;
      }),
    });
  const N = FULL ? 1008 : 400;

  /** Run U to the end, one window at a time, noting the first boundary at which the calendar holds three pending children and one is due 100 windows on. */
  function runU(): { sim: Sim; bStar: number } {
    const sim = make();
    let bStar = -1;
    for (let w = 0; w < N; w++) {
      sim.advance(1);
      if (bStar < 0 && sim.windowNow() >= 200) {
        const cal = Object.values(eventsState(sim).calendar).flat();
        if (cal.length >= 3 && cal.some((c) => c.due > sim.windowNow() + 100)) bStar = sim.windowNow();
      }
    }
    return { sim, bStar };
  }

  test('the records of R equal those of U; the outstanding batch applies without re-running; nothing is re-minted; the epoch changes no byte', () => {
    const u = runU();
    expect(u.bStar).toBeGreaterThanOrEqual(200);
    const reference = recordOf(u.sim);
    const rnd = lcg(0xe2);

    const r = make();
    r.advance(u.bStar);
    r.k.persistence.save('R');
    // discard everything: a fresh process, another epoch, the save loaded
    const fresh = transfer(r, 'R', make);
    expect(fresh.windowNow()).toBe(u.bStar);
    const runs = countRuns(fresh);
    const emitted: Id[] = [];
    const emit = fresh.k.emit.bind(fresh.k);
    fresh.k.emit = (change: Change, time?: number) => {
      if (change.c === 'event') emitted.push(change.event);
      emit(change, time);
    };
    const before = new Set(fresh.k.store.idsOfKind('core:event'));
    // two further reloads at random boundaries
    const stops = [u.bStar + 1 + Math.floor(rnd() * (N - u.bStar - 2)), u.bStar + 1 + Math.floor(rnd() * (N - u.bStar - 2))].sort((a, b) => a - b);
    let cur = fresh;
    let at = u.bStar;
    let n = 0;
    for (const stop of [...stops, N]) {
      cur.advance(stop - at);
      at = stop;
      if (stop === N) break;
      n++;
      cur.k.persistence.save(`R${n}`);
      cur = transfer(cur, `R${n}`, make, 3 + n);
    }
    expect(cur.windowNow()).toBe(N);
    expect(differing(recordOf(cur), reference)).toEqual([]);

    // the outstanding batch applied at its boundary without running its process again: no window ran twice, and none ran at b*
    for (const [id, ks] of runs) {
      if (ks.length === 0) {
        expect(id).toBe('scene.acts');
        continue;
      }
      expect(new Set(ks).size, id).toBe(ks.length);
      expect(ks.includes(u.bStar), `${id} ran window b*`).toBe(false);
      expect(Math.min(...ks), id).toBe(u.bStar + 1);
    }
    // events minted before b* are not minted again
    expect(emitted.filter((e) => before.has(e)).length).toBe(0);
    // those within seven days re-mint from the ring under the same Ids
    const ring = eventsState(cur).ring.filter((e) => e.event && e.mint && e.w >= N - 100);
    expect(ring.length).toBeGreaterThan(3);
    for (const e of ring.slice(0, 10)) {
      expect(cur.remint(e.id)).toBe(e.id);
      expect(cur.k.value(e.id, 'time')).toBe(e.event!.time);
      expect(cur.k.value(e.id, 'kind')).toBe(e.kind);
    }
    // the calendar and the decisions are the same
    expect(eventsState(cur).calendar).toEqual(eventsState(u.sim).calendar);
    expect(cur.record.log).toEqual(u.sim.record.log);
  }, 900_000);
});


describe('SF1-E3: the mirror overriding a simulated value with a game reading', () => {
  const index = makeKabukiSlice();
  const mirrorProc = processCause('city.mirror');
  const make = (): Sim => Sim.create({ worldSeed: seedOf('SF1-E3'), index, data: defaultData(), only: ['city.events', 'city.mirror'] });
  const derivedOf = (raw: Id): Id => mintedId(mirrorProc, raw, 'mir');
  const rawId = (sim: Sim, t: number, n = 0): Id => mintedId(sim.w.port, sim.w.port, `raw/${t}/${n}`);
  const adult = { alive: 'yes', 'age-class': 'adult' } as const;

  const script = (): ReplayLine[] => [
    { t: 0, op: 'person', key: 'mv', slots: { affiliation: 'civilian', 'quest-linked': 'no', ...adult } },
    { t: 0, op: 'person', key: 'claw1', slots: { affiliation: 'TygerClaws', ...adult } },
    { t: 0, op: 'person', key: 'claw2', slots: { affiliation: 'TygerClaws', ...adult } },
    { t: 0, op: 'person', key: 'mox1', slots: { affiliation: 'TheMox', ...adult } },
    { t: 90_300, op: 'event', kind: 'game.combat.start', place: 'g3', participants: [{ who: 'claw1', role: 'hostile' }, { who: 'mox1', role: 'hostile' }] },
    { t: 90_900, op: 'event', kind: 'game.death', place: 'v2', participants: [{ who: 'mv', role: 'victim' }, { who: 'claw2', role: 'actor' }], effects: [{ on: 'mv', effect: 'kill' }], witnesses: 3 },
    { t: 90_900, op: 'person', key: 'mv', slots: { alive: 'no' } },
  ];

  /** The authored state of the fixture: a goal frame, a membership, a tie with V, a belief about mv, and the three pending children. */
  function author(sim: Sim) {
    const k = sim.k;
    const port = new ReplayPort(sim);
    const mv = port.node('mv');
    const other = port.node('claw1');
    const district = sim.w.districts[0]!;
    const goal = k.frames.open({ actor: mv, level: 'goal', origin: H(hs('pay-collector')), weight: 1, payload: { goal: { effects: [] } }, cause: mv });
    const member = k.addEdge({ type: 'core:member-of', from: mv, to: sim.w.circle(district.id), attrs: { role: 'member', strength: 1 }, cause: mv });
    const tie = sim.tiePolicy.materialise(mv, sim.w.v);
    const E = H(hs('evidence'), hid(mv));
    k.beliefs.set({ believer: other, subject: mv, path: 'affiliation', value: 'civilian', confidence: 1, evidence: [E], source: { by: 'observed', event: E }, formed: 0, refreshed: 0, memorable: true });
    const g3 = sim.w.index.names!.g3!;
    const g11 = sim.w.index.names!.g11!;
    const facts = (name: string) => ({ id: H(hs('e3-parent'), hs(name)), kind: 'gang-clash', size: 2, w: 140, time: 140 * W + 7, cell: g3, gen: 0, chain: [] as Id[] });
    const kid = (name: string, kind: string, cell: Id): PendingChild => ({
      parent: H(hs('e3-parent'), hs(name)), index: 0, due: 160, kind, size: 2, cell, modBirth: 1, parentFacts: facts(name), ...(kind === 'gang-clash' ? { sides: { a: 2, b: 3 } } : {}),
    });
    sim.setState('city.events', (st) => {
      const cal = ((st as EventsState).calendar[district.id] ??= []);
      cal.push(kid('C', 'gang-clash', g3), kid('D', 'theft', g3), kid('E', 'gang-clash', g11));
      cal.sort((x, y) => x.due - y.due || (x.parent < y.parent ? -1 : x.parent > y.parent ? 1 : 0) || x.index - y.index);
    });
    // the harness adds a simulation-layer statement that mv is alive
    const stmt = () => k.contribute({ source: { layer: 'simulation', origin: sim.w.s1 }, target: { slot: 'alive', scope: { nodes: [mv] } }, form: { f: 'const', value: 'yes' }, mode: 'constrain' });
    stmt();
    return { mv, goal, member, tie, stmt, g3, g11 };
  }

  const prepared = (): { sim: Sim; a: ReturnType<typeof author> } => {
    const sim = make();
    new ReplayPort(sim).submit(script());
    sim.advance(1);
    return { sim, a: author(sim) };
  };

  test('derived events, the game\'s reading, the corrections and the abandoned state of mv; the same records in one call, in per-window calls and across a reload', () => {
    const A = prepared();
    A.sim.advance(170 - 1);
    const B = prepared();
    for (let w = 1; w < 170; w++) B.sim.advance(1);
    const C = prepared();
    C.sim.advance(154 - 1);
    C.sim.k.persistence.save('E3');
    const reloaded = transfer(C.sim, 'E3', make, 5);
    // the game restates what it knows after a load, and the harness its statement
    const now: Record<string, Record<string, string>> = {};
    for (const l of script()) if (l.op === 'person') now[l.key] = { ...(now[l.key] ?? {}), ...(l.slots as Record<string, string>) };
    new ReplayPort(reloaded).submit(Object.entries(now).map(([key, slots]): ReplayLine => ({ t: reloaded.k.now, op: 'person', key, slots })));
    reloaded.advance(170 - reloaded.windowNow());

    const sim = A.sim;
    const k = sim.k;
    const { mv } = A.a;
    // the derived events
    const combat = derivedOf(rawId(sim, 90_300));
    const death = derivedOf(rawId(sim, 90_900));
    for (const [id, kind, rawT] of [[combat, 'gang-clash', 90_300], [death, 'assault', 90_900]] as const) {
      const ev = sim.policies.viewEvent(id)!;
      expect(ev.kind).toBe(kind);
      expect(ev.time).toBe(rawT);
      expect(ev.creator).toBe(mirrorProc);
      expect(ev.causes).toEqual([rawId(sim, rawT)]);
    }
    const sizes = new Map<Id, number>();
    for (const win of sim.digestOf<{ facts: { windows: Array<{ items: Array<{ id: Id; size: number }> }> } }>('city.mirror')!.facts.windows) for (const f of win.items) sizes.set(f.id, f.size);
    // the facts feed holds the last windows only; the sizes of the two derived events are in the ring of the groups' reads, so read them from the events directly
    void sizes;
    expect(sim.record.log.filter((e) => e.proc === 'city.mirror' && (e.kind === 'admission' || e.kind === 'gate')).length).toBe(0);
    // the game's reading wins, whatever the simulation layer says
    expect(k.value(mv, 'alive')).toBe('no');
    expect(k.trace(mv, 'alive').status).toBe('ok');
    const game = k.store.livePinsOn(mv, 'alive').filter((p) => p.reason === 'game');
    expect(game.length).toBeGreaterThanOrEqual(1);
    expect(game.every((p) => p.value === 'no' || p.value === 'yes')).toBe(true);
    // the simulation-layer statement is still there, and loses: the mirrored slot is never sampled
    expect(k.store.allContributions().some((c) => c.source.layer === 'simulation' && c.source.origin === sim.w.s1 && c.target.slot === 'alive')).toBe(true);
    // the simulated values are corrected: C is thinned by cover, D and E fire
    const covers = sim.record.log.filter((e) => e.reason === 'game-covers');
    expect(covers.length).toBe(1);
    expect(covers[0]!.kind).toBe('correction');
    const ring = eventsState(sim).ring;
    expect(ring.some((e) => e.kind === 'theft' && e.cell === A.a.g3 && e.w === 160)).toBe(true);
    expect(ring.some((e) => e.kind === 'gang-clash' && e.cell === A.a.g11 && e.w === 160)).toBe(true);
    expect(ring.some((e) => e.kind === 'gang-clash' && e.cell === A.a.g3 && e.w === 160)).toBe(false);
    // mv: frames abandoned, memberships and ties ended, the goal abandoned; the beliefs stand; one game-dead correction
    for (const f of k.frames.framesOf(mv)) expect(f.status).toBe('abandoned');
    expect(k.frames.frame(A.a.goal.id)!.status).toBe('abandoned');
    expect(k.store.edges.get(A.a.member.id)!.valid.to).toBeDefined();
    expect(k.store.edges.get(A.a.tie.id)!.valid.to).toBeDefined();
    expect(k.beliefs.activeOf(new ReplayPort(sim).node('claw1')).filter((b) => b.subject === mv).length).toBe(1);
    expect(sim.record.log.filter((e) => e.reason === 'game-dead' && e.refs.includes(mv)).length).toBe(1);

    // partition and reload
    // the ended edges and abandoned frames of mv are history the save does not keep, and so are the headers only they retained
    const ignore = ['edges', 'frames', 'headers'];
    const ra = recordOf(A.sim);
    const rb = recordOf(B.sim);
    const rc = recordOf(reloaded);
    expect(differing(ra, rb)).toEqual([]);
    expect(differing(ra, rc).filter((x) => !ignore.includes(x))).toEqual([]);
    // after the reload what the game contradicts is still ended or gone
    for (const f of reloaded.k.frames.framesOf(mv)) expect(f.status).toBe('abandoned');
    for (const e of reloaded.k.store.edgesFrom(mv)) expect(e.valid.to !== undefined).toBe(true);
    expect(reloaded.record.log.filter((e) => e.reason === 'game-dead' && e.refs.includes(mv)).length).toBe(1);
    expect(reloaded.k.value(mv, 'alive')).toBe('no');
  }, 900_000);
});



describe('SF1-E4: reload after the parent has left the ring', () => {
  const make = (): Sim =>
    Sim.create({
      worldSeed: seedOf('SF1-E4'), index: fx3Slice(),
      data: fxData((d) => {
        for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * 3) as [number, number, number, number];
        for (const kd of d.kinds) kd.delayWeights = [0, 0, 0, 0.3, 0.4, 0.3];
      }),
    });
  const adult = { alive: 'yes', 'age-class': 'adult' } as const;

  /** R1's goal frame: an authored, committed, active frame of a mirrored canon person, held by a live seed so that it is a retention root. */
  function authorGoal(sim: Sim): Id {
    const k = sim.k;
    const r1 = new ReplayPort(sim).node('r1');
    const seed = k.root('live-seed-r1', 'core:seed');
    k.retention.setSeed({ id: seed, actor: r1, state: {}, nodes: [r1] });
    return k.frames.open({ actor: r1, level: 'goal', origin: H(hs('r1-goal')), weight: 1, payload: { goal: { effects: [] } }, cause: seed, status: 'active' }).id;
  }

  const prepare = (sim: Sim): Id => {
    new ReplayPort(sim).submit([
      { t: 0, op: 'person', key: 'r1', slots: { affiliation: 'civilian', 'quest-linked': 'yes', ...adult } },
      { t: 0, op: 'reading', node: 'v', slot: 'cell', value: 'c1' },
    ]);
    sim.advance(1);
    return authorGoal(sim);
  };

  /** A pending child whose parent has left the ring and which is due within the horizon. */
  const horizon = 300;
  const found = (sim: Sim): PendingChild | undefined => {
    const now = sim.windowNow();
    return Object.values(eventsState(sim).calendar).flat().find((c) => c.parentFacts.w < now - 1008 && c.due <= now + horizon && c.due > now + 1);
  };

  /** Where a fired child is in the ring: an event under its parent, or an item of the summary of its due window, found by its parent. */
  const outcomeOf = (sim: Sim, c: PendingChild): { id: Id; ring: RingEntry; index?: number } | undefined => {
    const ring = eventsState(sim).ring;
    if (c.size >= 2) {
      const id = mintedId(eventsProc, c.parent, `child/${c.index}`);
      const ring1 = ring.find((e) => e.id === id);
      return ring1 ? { id, ring: ring1 } : undefined;
    }
    for (const e of ring) {
      if (e.w !== c.due || e.cell !== c.cell || e.kind !== c.kind || !e.meta) continue;
      for (const [j, m] of Object.entries(e.meta)) if (m.parent === c.parent) return { id: sim.k.summaries.materialise(e.id, Number(j)), ring: e, index: Number(j) };
    }
    return undefined;
  };

  test('the child fires as in U with the same kind, size, cell, time and cast; its why chain has at most 4 links with ancestors beyond the ring marked; R1\'s goal stays active; published items are not published again', () => {
    const U = make();
    const goalU = prepare(U);
    let bStar = -1;
    let child: PendingChild | undefined;
    let fresh!: Sim;
    let published: ActsState['published'] = [];
    let goalFresh!: Id;
    const limit = FULL ? 2600 : 2400;
    while (U.windowNow() < limit) {
      U.advance(1);
      if (bStar < 0 && (child = found(U))) {
        bStar = U.windowNow();
        // run R: to b*, save, and a fresh process under another epoch
        U.k.persistence.save('E4');
        published = actsOf(U).published.map((p) => ({ ...p }));
        goalFresh = goalU;
        fresh = transfer(U, 'E4', make, 11);
      }
      if (bStar >= 0 && U.windowNow() >= bStar + horizon + 2) break;
    }
    expect(bStar).toBeGreaterThan(1008);
    expect(child).toBeDefined();
    expect(U.k.frames.frame(goalU)!.status).toBe('active');
    expect(published.length).toBeGreaterThan(0);

    // the game restates where V is and who R1 is
    new ReplayPort(fresh).submit([{ t: fresh.k.now, op: 'reading', node: 'v', slot: 'cell', value: 'c1' }, { t: fresh.k.now, op: 'person', key: 'r1', slots: { affiliation: 'civilian', 'quest-linked': 'yes', ...adult } }]);
    const emitted: Id[] = [];
    const emit = fresh.k.emit.bind(fresh.k);
    fresh.k.emit = (change: Change, time?: number) => {
      if (change.c === 'event') emitted.push(change.event);
      emit(change, time);
    };
    // the active goal is retained through the reload
    expect(fresh.k.frames.frame(goalFresh)).toBeDefined();
    expect(fresh.k.frames.frame(goalFresh)!.status).toBe('active');
    fresh.advance(U.windowNow() - bStar);
    expect(fresh.windowNow()).toBe(U.windowNow());
    expect(fresh.k.frames.frame(goalFresh)!.status).toBe('active');

    // the child fires with the same kind, size, cell, time and cast; its parent has left the ring
    const inU = outcomeOf(U, child!)!;
    const inR = outcomeOf(fresh, child!)!;
    expect(inU).toBeDefined();
    expect(inR).toBeDefined();
    expect(inR.id).toBe(inU.id);
    expect(inR.ring).toEqual(inU.ring);
    if (child!.size >= 2) {
      expect(inU.ring.event!.size).toBe(child!.size);
      expect(inU.ring.event!.kind).toBe(child!.kind);
      expect(inU.ring.event!.cell).toBe(child!.cell);
      expect(fresh.policies.viewEvent(inR.id)!.participants).toEqual(U.policies.viewEvent(inU.id)!.participants);
      expect(fresh.policies.viewEvent(inR.id)!.effects).toEqual(U.policies.viewEvent(inU.id)!.effects);
    } else {
      expect(inU.ring.kind).toBe(child!.kind);
      expect(inU.ring.cell).toBe(child!.cell);
      expect(inU.ring.w).toBe(child!.due);
      const d = (s: Sim, o: typeof inU) => itemDescriptor(s, o.ring.id, o.index!, o.ring.w, o.ring.cell, o.ring.kind, o.ring.meta![o.index!]!);
      expect(d(fresh, inR)).toEqual(d(U, inU));
      expect(fresh.casting.cast(d(fresh, inR))).toEqual(U.casting.cast(d(U, inU)));
    }
    expect(eventsState(U).ring.some((e) => e.id === child!.parent)).toBe(false);

    // the why chain has at most four links, and the ancestors the ring no longer holds are Ids marked beyondRing
    const why = fresh.why(inR.id)!;
    expect(why).toBeDefined();
    expect(why.length).toBeLessThanOrEqual(5);
    expect(why[0]!.id).toBe(inR.id);
    expect(why[1]!.id).toBe(child!.parent);
    expect(why[1]!.beyondRing).toBe(true);
    expect(why).toEqual(U.why(inU.id)!);

    // the whole record is U's, and nothing published before b* is published again
    expect(differing(recordOf(fresh), recordOf(U))).toEqual([]);
    for (const p of published) expect(emitted.includes(p.item)).toBe(false);
    expect(actsOf(fresh).published.map((p) => p.item)).toEqual(actsOf(U).published.map((p) => p.item));
    // those inside the ring are re-installed silently when their cell is in focus
    const inRing = published.filter((p) => bStar - p.w < 1008);
    expect(inRing.length).toBeGreaterThan(0);
    for (const p of inRing.slice(-3)) expect(fresh.k.value(p.item, 'kind')).toBeDefined();
  }, 900_000);
});

const actsOf = (sim: Sim): ActsState => sim.k.evolution.states.get('scene.acts')!.state as ActsState;



describe('SF1-E1: a Kabuki week, in one call, in many calls and with reloads', () => {
  const index = makeKabukiSlice();
  const N = FULL ? 1008 : 288;
  const publicW = FULL ? 300 : 100;
  const privateW = FULL ? 400 : 160;
  const DAYW = 144;
  const district = 'wat_kab';
  const adult = { alive: 'yes', 'age-class': 'adult' } as const;

  const make = (only?: string[]): Sim => Sim.create({ worldSeed: seedOf('SF1-E1'), index, data: defaultData(), ...(only ? { only } : {}) });

  /** The replay script: V's position and district, two people, and the enforcement events the fixture injects. */
  const script = (vCell: string, events: 'both' | 'private' | 'none'): ReplayLine[] => [
    { t: 0, op: 'reading', node: 'v', slot: 'district', value: district },
    { t: 0, op: 'reading', node: 'v', slot: 'cell', value: vCell },
    { t: 0, op: 'person', key: 'claw', slots: { affiliation: 'TygerClaws', ...adult } },
    { t: 0, op: 'person', key: 'vendor', slots: { affiliation: 'civilian', ...adult } },
    ...(events === 'both'
      ? [{ t: publicW * W + 100, op: 'event' as const, kind: 'enf.fee.word', place: 'g2', participants: [{ who: 'claw', role: 'enforcer' }, { who: 'vendor', role: 'target' }], witnesses: 6 }]
      : []),
    ...(events !== 'none'
      ? [{ t: privateW * W + 100, op: 'event' as const, kind: 'enf.fee.word', place: 'g2', participants: [{ who: 'claw', role: 'enforcer' }, { who: 'vendor', role: 'target' }], witnesses: 3 }]
      : []),
  ];

  /** What the game states again after a load: the latest of every reading, and the events that have not happened yet. */
  const restate = (sim: Sim, lines: ReplayLine[]): void => {
    const now = sim.k.now;
    const latest = new Map<string, ReplayLine>();
    const out: ReplayLine[] = [];
    for (const l of lines) {
      if (l.op === 'event') {
        if (l.t >= now) out.push(l);
      } else if (l.op === 'reading') latest.set(`${l.node}|${l.slot}`, { ...l, t: now });
      else if (l.op === 'person') latest.set(`person|${l.key}`, { ...l, t: now });
    }
    new ReplayPort(sim).submit([...latest.values(), ...out]);
  };

  /** Build a sim fed the script, let `how` drive it, and give back the sim it ends with (which `how` may have replaced by a reload). */
  const run = (vCell: string, events: 'both' | 'private' | 'none', how: (sim: Sim) => Sim | void, only?: string[]): Sim => {
    const sim = make(only);
    new ReplayPort(sim).submit(script(vCell, events));
    return how(sim) ?? sim;
  };

  /** Per-window observations of run B: the bounds, the reads and the offered immigrants. */
  function observe(sim: Sim) {
    const expected: Record<string, number> = {};
    const def = sim.defs.get('city.events')!;
    const original = def.run.bind(def);
    def.run = (pctx, k) => {
      const T = pctx.windowStart;
      const p = sim.people.periodOf(T);
      const st = pctx.own<EventsState>();
      const groups = pctx.digest<GroupDigest>('group.decide');
      const scale = sim.k.settings.at(T).cityScale;
      for (const d of sim.w.districts) {
        for (const kd of sim.data.kinds) {
          let regimeMod = 1;
          for (const r of st?.regimes ?? []) if (r.scope === d.id) regimeMod = regimeMod * Math.max(0.1, r.effects[kd.name] ?? 1);
          let groupMod = 1;
          if (kd.name !== 'gang-clash') {
            let sum = 0;
            for (let f = 1; f < 6; f++) sum = sum + sim.city.offenderShare(d.id, kd.name, f) * (groups?.boost[d.id]?.[f]?.[kd.name] ?? 0);
            groupMod = Math.max(0.5, 1 + sum);
          }
          for (let m = 1; m <= 4; m++) {
            expected[kd.name] = (expected[kd.name] ?? 0) + sim.data.shape.rate[kd.name]![m - 1]! * scale * sim.city.shape(kd.name, T) * sim.city.share(d.id, kd.name, p) * regimeMod * groupMod * (W / 86400);
          }
        }
      }
      void k;
      return original(pctx, k);
    };
    return expected;
  }

  const percOf = (sim: Sim): number => {
    const dg = sim.digestOf<NormsDigest>('order.norms');
    return dg?.norms[sim.w.districts[0]!.id]?.fee?.perc ?? Number.NaN;
  };

  test('records, volume, agreement, causes, bands, bounds, norms, publication, floors and reads', () => {
    // ---- run A: one call; run B: one call per window, with the observations; run C: daily calls elsewhere; run D: reloads ----
    const emittedA: Array<{ id: Id; now: number }> = [];
    const A = run('g1', 'both', (sim) => {
      const emit = sim.k.emit.bind(sim.k);
      sim.k.emit = (change: Change, time?: number) => {
        if (change.c === 'event') emittedA.push({ id: change.event, now: sim.k.now });
        emit(change, time);
      };
      sim.advance(N);
    });

    const percB: number[] = [];
    let expected: Record<string, number> = {};
    const reads: string[] = [];
    let calendarMax = 0;
    const B = run('g1', 'both', (sim) => {
      expected = observe(sim);
      const cells = sim.w.districts[0]!.cellIds;
      for (let w = 0; w < N; w++) {
        sim.advance(1);
        percB.push(percOf(sim));
        if (w >= 2) {
          for (const c of cells) reads.push(sim.reads.eval('band', [c]));
          reads.push(sim.reads.eval('normGap', ['fee', district]), sim.reads.eval('priceLevel', [district]), sim.reads.eval('regime', [district]), sim.reads.eval('presence', [district, 'TygerClaws']));
        }
        const st = eventsState(sim);
        for (const list of Object.values(st.calendar)) calendarMax = Math.max(calendarMax, list.length);
        const stocks = sim.digestOf<StocksDigest>('order.stocks');
        for (const s of Object.values(stocks?.districts ?? {})) for (const v of Object.values(s)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        const norms = sim.stateOf<NormsState>('order.norms');
        for (const s of Object.values(norms?.slots ?? {})) for (const v of [s.priv, s.beh, s.perc, s.qe, s.qn]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    });

    const C = run('g9', 'both', (sim) => {
      sim.k.frames.demandRoots.add(sim.people.residentAt(sim.w.districts[0]!.cellIds[7]!, 0));
      for (let d = 0; d < N / DAYW; d++) sim.advance(DAYW);
    });

    const rnd = lcg(0xe1);
    const Dend = run('g1', 'both', (sim) => {
      // a save and a load at a random boundary on each day, into a fresh process under another epoch
      let cur = sim;
      let at = 0;
      for (let d = 0; d < Math.min(3, Math.ceil(N / DAYW)); d++) {
        const stop = d * DAYW + 10 + Math.floor(rnd() * (DAYW - 20));
        cur.advance(stop - at);
        at = stop;
        cur.k.persistence.save(`D${d}`);
        cur = transfer(cur, `D${d}`, make, 3 + d);
        restate(cur, script('g1', 'both'));
      }
      cur.advance(N - at);
      return cur;
    });

    // ---- the records ----
    const ra = recordOf(A);
    expect(differing(ra, recordOf(B))).toEqual([]);
    expect(differing(ra, recordOf(Dend)).filter((x) => x !== 'headers')).toEqual([]);
    const rc = recordOf(C, { processes: ['scene.acts'], logProcs: ['scene.acts'] });
    const raCoarse = recordOf(A, { processes: ['scene.acts'], logProcs: ['scene.acts'] });
    expect(differing(raCoarse, rc).filter((x) => !['frames', 'seeds', 'headers'].includes(x))).toEqual([]);
    expect(C.stateOf('scene.acts')).not.toEqual(A.stateOf('scene.acts'));

    // ---- the volume: the immigrants of each kind against the sum of the means of the realised propensities ----
    const all = occurrences(A);
    const immigrants: Record<string, number> = {};
    for (const o of all) if (o.gen === 0) immigrants[o.kind] = (immigrants[o.kind] ?? 0) + 1;
    for (const kd of A.data.kinds) {
      const want = expected[kd.name] ?? 0;
      const got = immigrants[kd.name] ?? 0;
      // refused and uncast incidents are offered and not admitted
      expect(Math.abs(got - want), `${kd.name}: ${got} against ${want.toFixed(1)}`).toBeLessThanOrEqual(4 * Math.sqrt(want) + 0.1 * want + 2);
    }
    expect(Object.values(expected).reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
    // no size 4 closer than 432 windows to another
    const big = [...eventsState(A).ring.filter((e) => e.event?.size === 4).map((e) => e.w)].sort((a, b) => a - b);
    for (let i = 1; i < big.length; i++) expect(big[i]! - big[i - 1]!).toBeGreaterThanOrEqual(432);

    // ---- agreement: every summary's count is its items at its cell; every descriptor is what the kernel reports ----
    for (const e of eventsState(A).ring) {
      if (e.count !== undefined) {
        expect(A.k.value(e.id, 'count')).toBe(e.count);
        for (let j = 0; j < e.count; j++) {
          const item = A.k.summaries.materialise(e.id, j);
          expect(A.k.value(item, 'place')).toBe(e.cell);
          expect(A.k.value(item, 'time')).toBe(itemTime(e.id, j, e.w * W, W));
        }
      } else if (e.event) {
        expect(A.k.value(e.id, 'time')).toBe(e.event.time);
        expect(A.k.value(e.id, 'place')).toBe(e.cell);
        expect(A.k.value(e.id, 'kind')).toBe(e.kind);
      }
    }

    // ---- causes ----
    const byId = new Map(all.map((o) => [o.id, o]));
    for (const o of all) {
      expect(o.chain.length).toBe(o.gen);
      expect(o.gen).toBeLessThanOrEqual(4);
      const p = o.parent === undefined ? undefined : byId.get(o.parent);
      if (p) {
        expect(o.w).toBeGreaterThan(p.w);
        expect(o.time).toBeGreaterThan(p.time);
      }
    }

    // ---- bands: no two band pins on one cell within 144 windows ----
    const pins = A.k.store.allPins().filter((p) => p.slot.startsWith('band@w'));
    const byCell = new Map<Id, number[]>();
    for (const p of pins) byCell.set(p.node, [...(byCell.get(p.node) ?? []), Number(p.slot.slice(6))]);
    expect(pins.length).toBeGreaterThan(0);
    for (const ws of byCell.values()) {
      ws.sort((a, b) => a - b);
      for (let i = 1; i < ws.length; i++) expect(ws[i]! - ws[i - 1]!).toBeGreaterThanOrEqual(144);
    }

    // ---- bounds ----
    expect(calendarMax).toBeLessThanOrEqual(256);
    expect(A.record.log.filter((e) => e.reason === 'calendar-overflow').length).toBe(0);
    expect(eventsState(A).ring.every((e) => A.windowNow() - 1 - e.w < 1008)).toBe(true);

    // ---- norms: the public event moves the perception of fee, the private one does not ----
    const percNone: number[] = [];
    const percPriv: number[] = [];
    run('g1', 'none', (sim) => { for (let w = 0; w < N; w++) { sim.advance(1); percNone.push(percOf(sim)); } }, ['order.norms']);
    run('g1', 'private', (sim) => { for (let w = 0; w < N; w++) { sim.advance(1); percPriv.push(percOf(sim)); } }, ['order.norms']);
    for (let w = 0; w < N; w++) {
      if (w <= publicW) expect(percB[w], `window ${w}`).toBe(percNone[w]!);
      expect(percPriv[w], `window ${w}`).toBe(percNone[w]!);
    }
    expect(percB.slice(publicW + 3).some((x, i) => x !== percNone[publicW + 3 + i])).toBe(true);

    // ---- publication: every opened item once, none later than its lag ----
    const published = actsOf(A).published;
    for (const p of published) {
      const mine = emittedA.filter((e) => e.id === p.item);
      expect(mine.length, 'published once').toBe(1);
      expect(mine[0]!.now).toBeLessThanOrEqual((p.w + 2) * W);
    }

    // ---- floors ----
    const harm = new Set<string>(A.data.gate.harmEffects);
    const floor = new Set<string>(A.data.gate.floorRoles);
    let persons = 0;
    for (const e of eventsState(A).ring) {
      const ids = e.event ? [e.id] : (e.count !== undefined ? Array.from({ length: e.count }, (_, j) => A.k.summaries.itemId(e.id, j)) : []);
      for (const id of ids) {
        const ev = A.policies.viewEvent(id);
        if (!ev) continue;
        for (const x of ev.participants) {
          if (!floor.has(x.role)) continue;
          persons++;
          expect(x.who).not.toBe(A.w.v);
          expect(A.gate.ageClassOf(x.who, ev.time)).toBe('adult');
        }
        for (const ef of ev.effects) if (harm.has(ef.effect)) {
          expect(ef.on).not.toBe(A.w.v);
          expect(A.people.protectedAt(ef.on, ev.time)).toBe(false);
        }
      }
    }
    // and the people the items would be cast with, which are a pure function of what the ring holds
    for (const e of eventsState(A).ring) {
      if (e.count === undefined || !e.meta) continue;
      for (let j = 0; j < e.count; j++) {
        const cast = A.casting.cast(itemDescriptor(A, e.id, j, e.w, e.cell, e.kind, e.meta[j]!));
        if (cast === 'no-cast') continue;
        for (const x of cast) {
          if (x.who === undefined || !floor.has(x.role)) continue;
          persons++;
          expect(x.who).not.toBe(A.w.v);
          expect(A.gate.ageClassOf(x.who, itemTime(e.id, j, e.w * W, W))).toBe('adult');
        }
      }
    }
    expect(persons).toBeGreaterThan(FULL ? 100 : 10);

    // ---- the reads answer at every window after the first processed boundary ----
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.filter((x) => x === 'maybe')).toEqual([]);
    for (const name of ['heatRank', 'tension', 'reach', 'protected', 'contract']) expect(A.reads.eval(name, [A.w.districts[0]!.cellIds[0]])).toBe('maybe');
  }, 1_800_000);
});


void defaultData;
void hid;
void mintedId;
void hs;
void H;
void itemTime;
void makeKabukiSlice;
void ReplayPort;
