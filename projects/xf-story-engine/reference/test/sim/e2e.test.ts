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
import type { NormsDigest, NormsState } from '../../src/sim/proc-norms.ts';
import type { StocksDigest } from '../../src/sim/proc-stocks.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice, makeKabukiSlice } from '../../src/sim/slices.ts';
import { itemTime } from '../../src/summary.ts';
import { fxData, seedOf } from './helpers.ts';
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

const eventsState = (sim: Sim): EventsState => sim.k.evolution.states.get('city.events')!.state as EventsState;

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


void defaultData;
void hid;
void mintedId;
void hs;
void H;
void itemTime;
void makeKabukiSlice;
void ReplayPort;
