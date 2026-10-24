import { expect } from 'bun:test';
import { idsIn } from '../src/canon.ts';
import type { EventSpec } from '../src/events.ts';
import { H, s } from '../src/id.ts';
import { contributionId, type ContributionSpec, type EdgeSpec, type Kernel } from '../src/kernel.ts';
import type { Id } from '../src/types.ts';
import { coreKernel } from './helpers.ts';

function replacement(k: Kernel, name: string, key: string): Kernel {
  const fresh = coreKernel(name, undefined, k.config);
  for (const [id, record] of k.persistence.chain) fresh.persistence.chain.set(id, structuredClone(record));
  fresh.newEpoch(); fresh.persistence.load(key);
  return fresh;
}

const byId = <T extends { id: string }>(a: T, b: T): number => a.id.localeCompare(b.id);

/** Read tables only. No marked(), address(), resolution or recovery before inspection. */
function observe(k: Kernel, place: Id) {
  const seeds = [...k.retention.seeds.values()].sort(byId);
  const todo = seeds.flatMap((seed) => seed.nodes), seen = new Set<Id>();
  for (let n = 0; n < todo.length; n++) {
    const id = todo[n];
    if (seen.has(id)) continue;
    seen.add(id);
    const header = k.store.header(id);
    if (!header) continue;
    todo.push(...k.store.ownedOf(id), ...idsIn(header.origin));
    const provenance = k.events.materialisationOf(id);
    if (provenance) todo.push(provenance.descriptor);
    for (const c of k.store.contributionsNaming(id)) if (c.form.f === 'const') todo.push(...idsIn(c.form.value));
  }
  const closure = [...seen].sort().map((id) => ({ id, header: k.store.header(id),
    contributions: k.store.contributionsNaming(id).sort(byId),
    edges: k.store.edgesFrom(id).sort(byId), pins: k.store.pinsOfNode(id).sort(byId),
    provenance: k.events.materialisationOf(id), cause: k.provenance.causeOf(id) }));
  // Unreferenced history can be absent physically. Compare every spatial result in the independently
  // walked consumer closure, so losing a retained event's location remains observable.
  const tables = () => [k.store.headers.size, k.store.allContributions().length, k.store.edges.size, k.store.allPins().length];
  const before = tables(), revision = k.revision, provenance = k.events.materialisationRecords();
  const spatial = [0, 10, k.now, k.now + 5].map((at) => {
    const q = k.query({ find: 'core:event', scope: { under: place }, at, must: [], limit: 'all' });
    return q.status === 'ok' ? q.items.filter((item) => seen.has(item.id)) : q;
  });
  expect(tables(), 'observation cannot repair or populate tables').toEqual(before);
  expect(k.revision, 'observation cannot change revision').toBe(revision);
  expect(k.events.materialisationRecords()).toEqual(provenance);
  return structuredClone({ seeds, closure, spatial, rules: k.store.generalContributions().sort(byId) });
}

export function runSweepReplayProperty() {
  const count = Number(process.env.SWEEP_SEEDS ?? 8), first = Number(process.env.SWEEP_FIRST_SEED ?? 1),
    steps = Number(process.env.SWEEP_STEPS ?? 48);
  if (![count, first, steps].every((v) => Number.isSafeInteger(v) && v > 0)) throw new Error('positive integer sweep bounds required');
  const coverage = { operations: new Set<number>(), seeds: 0, steps: 0, saves: 0, loads: 0 };
  for (const snapshot of [false, true]) for (let seed = first; seed < first + count; seed++) {
    let random = seed;
    const draw = (n: number): number => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return Math.floor(random / 0x100000000 * n); };
    const name = `sweep-property-${seed}`, config = { snapshotEvery: snapshot ? 1 : 10000 };
    const setup = () => {
      const k = coreKernel(name, undefined, config), creator = k.root('producer', 'core:person'), place = k.root('place', 'core:place'),
        specs: EventSpec[] = Array.from({ length: 4 }, (_, i) => ({ creator, cause: creator, name: `event-${i}`,
          time: i, kind: 'arrival', place, participants: [{ who: creator, role: 'actor' }],
          effects: [{ on: creator, effect: 'harm' }], witnesses: [creator], causes: [creator] })),
        events = specs.map((spec) => k.events.mintEvent(spec)), consumers = events.map((_, i) => H(s(`consumer-${i}`))),
        original: ContributionSpec[] = events.map((event) => ({ source: { layer: 'authored', origin: event },
          target: { slot: 'time', scope: { nodes: [event] } }, form: { f: 'const', value: 42 }, mode: 'constrain' })),
        times = original.map((spec) => k.contribute(spec).id),
        edges: EdgeSpec[] = specs.map((spec, i) => ({ type: 'core:located-in', from: events[i], to: place,
          cause: events[i], valid: { from: spec.time } })),
        locations = events.map((event) => k.store.edgesFrom(event)[0].id),
        rule: ContributionSpec = { source: { layer: 'authored', origin: events[0] }, target: { kind: 'core:event', slot: 'outcome' },
          form: { f: 'const', value: 'done' }, mode: 'constrain' };
      k.contribute(rule);
      // Nonempty explicit provenance and an owned participant/effect tree are part of every comparison.
      const descriptor = k.summaries.mintSummary({ creator, cause: creator, name: 'summary', kind: 'arrival',
        from: 0, length: 10, scope: place, count: 1 }), item = k.summaries.materialise(descriptor, 0);
      k.events.restoreEvent({ creator: descriptor, cause: descriptor, name: 'item:0', kind: 'arrival',
        time: 0, participants: [{ who: creator, role: 'witness' }], effects: [{ on: creator, effect: 'harm' }] },
        { descriptor, materialisation: 'scene.acts' });
      k.retention.setSeed({ id: H(s('summary-consumer')), state: {}, nodes: [item] });
      for (let i = 0; i < 3; i++) k.retention.setSeed({ id: consumers[i], state: {}, nodes: [events[i]] });
      k.persistence.save('initial');
      return { k, creator, place, specs, events, consumers, original, times, edges, locations, rule, descriptor, item };
    };
    const fixture = setup(), control = fixture.k, swept = setup().k;
    let replay = replacement(setup().k, name, 'initial');
    const { creator, place, specs, events, consumers, original, times, edges, locations, rule, descriptor, item } = fixture;
    const compare = (context: string) => {
      const expected = observe(control, place);
      expect(observe(swept, place), `${context}: unswept versus swept`).toEqual(expected);
      expect(observe(replay, place), `${context}: unswept versus replay`).toEqual(expected);
    };
    compare(`seed ${seed}, snapshot ${snapshot}, initial`);
    for (let step = 0; step < steps; step++) {
      const op = draw(17), i = draw(events.length), j = i % 3, at = control.now + draw(6),
        save = draw(4) === 0, reload = draw(2) === 0, sameStart = draw(2) === 0,
        context = `seed ${seed}, snapshot ${snapshot}, step ${step}, op ${op}, event ${i}, at ${at}`;
      coverage.operations.add(op); coverage.steps++;
      const results = [control, swept, replay].map((k, run) => {
        const sweep = () => { if (run !== 0) k.retention.scheduleSweep(); k.settle(); };
        // No preparatory recovery: it belongs to these public APIs.
        try {
          switch (op) {
            case 0: return k.retention.endSeed(consumers[i]);
            case 1:
              // This author supplies the original payload when the event may never have been saved.
              if (i === 3) k.events.restoreEvent(specs[i]);
              return k.retention.setSeed({ id: consumers[i], state: {}, nodes: [events[i]] });
            case 2: sweep(); return;
            case 3: return k.endContribution(times[i], at);
            case 4: return k.events.mintEvent(specs[i]);
            case 5: return k.events.restoreEvent(specs[i]);
            case 6: k.now = at + 1; return k.endContribution(contributionId(rule), at + 4);
            case 7: return k.endEdge(locations[j], at);
            case 8: return structuredClone(k.contribute(original[i]));
            case 9:
              k.endEdge(locations[j], at);
              return structuredClone(k.reopenEdge(locations[j], sameStart ? at : at + 1));
            case 10:
            case 11:
              k.mintSilent(creator, creator, specs[i].name, 'core:event');
              return op === 10 ? k.events.restoreEvent(specs[i]) : k.events.mintEvent(specs[i]);
            case 12: k.retention.endSeed(consumers[i]); sweep(); return k.endContribution(times[i], at);
            case 13: k.retention.endSeed(consumers[j]); sweep(); return k.endEdge(locations[j], at);
            case 14: return structuredClone(k.addEdge(edges[j]));
            case 15: return structuredClone(k.updateEdge(locations[j], { data: { step } }));
            case 16:
              k.retention.endSeed(H(s('summary-consumer'))); sweep();
              k.mintSilent(descriptor, descriptor, 'item:0', 'core:event');
              k.events.restoreEvent({ creator: descriptor, cause: descriptor, name: 'item:0', kind: 'arrival',
                time: 0, participants: [{ who: creator, role: 'witness' }], effects: [{ on: creator, effect: 'harm' }] },
                { descriptor, materialisation: 'scene.acts' });
              return k.retention.setSeed({ id: H(s('summary-consumer')), state: {}, nodes: [item] });
          }
        } catch (cause) { throw new Error(`${context}, run ${run}`, { cause }); }
      });
      expect(results[1], `${context}: swept return`).toEqual(results[0]);
      expect(results[2], `${context}: replay return`).toEqual(results[0]);
      compare(context); // Inspect before a save can perform retention traversal.
      if (save) {
        coverage.saves++;
        const key = `save-${step}`, record = control.persistence.save(key);
        expect(swept.persistence.save(key), `${context}: swept record`).toEqual(record);
        expect(replay.persistence.save(key), `${context}: replay record`).toEqual(record);
        if (reload) { replay = replacement(replay, name, key); coverage.loads++; }
        compare(`${context}, saved`);
      }
    }
    const record = control.persistence.save('final');
    expect(swept.persistence.save('final')).toEqual(record);
    expect(replay.persistence.save('final')).toEqual(record);
    replay = replacement(replay, name, 'final');
    compare(`seed ${seed}, snapshot ${snapshot}, final`);
    coverage.seeds++;
  }
  expect(coverage.operations.size).toBe(17);
  expect(coverage.saves).toBeGreaterThan(0);
  expect(coverage.loads).toBeGreaterThan(0);
  return { ...coverage, operations: coverage.operations.size };
}
