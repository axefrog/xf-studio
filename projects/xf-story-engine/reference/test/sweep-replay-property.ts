import { expect } from 'bun:test';
import { serialize } from 'node:v8';
import { idsIn } from '../src/canon.ts';
import { readEvent } from '../src/procedural/views.ts';
import type { EventSpec } from '../src/events.ts';
import { H, s } from '../src/id.ts';
import { contributionId, type ContributionSpec, type EdgeSpec, Kernel } from '../src/kernel.ts';
import type { Id } from '../src/types.ts';
import { runCoverageEpisode } from './sweep-replay-episodes.ts';
import { coreKernel } from './helpers.ts';

function replacement(k: Kernel, name: string, key: string): Kernel {
  const fresh = coreKernel(name, undefined, k.config);
  for (const [id, record] of k.persistence.chain) fresh.persistence.chain.set(id, structuredClone(record));
  fresh.newEpoch(); fresh.persistence.load(key);
  if(k.retention.streamed.size) fresh.retention.streamIn([...k.retention.streamed]);
  return fresh;
}

const byId = <T extends { id: string }>(a: T, b: T): number => a.id.localeCompare(b.id);

/** The observed executions are never read through a lazy semantic API. Raw closure comes first;
 * resolution and spatial queries run only on a disposable projection with recovery disabled (empty
 * save base). Missing retained facts therefore cannot be repaired by the observation itself.
 */
export function observe(k: Kernel, place: Id) {
  const capture = () => ({ store: k.store, events: k.events.capture(), summaries: k.summaries.capture(),
    retention: k.retention.capture(), frames: k.frames.capture(), beliefs: k.beliefs.capture(),
    pending: k.pending, revision: k.revision, epoch: k.epoch, defects: k.defects.items });
  const snapshot = capture(), before = serialize(snapshot);
  const ownership = (k.events.capture() as { materialisations: Map<Id, {descriptor: Id; materialisation: Id}> }).materialisations;
  const isFact = (c: import('../src/types.ts').Contribution) => {
    if (c.source.layer !== 'simulation') return true;
    const scope = c.target.scope;
    if (!scope || !('nodes' in scope)) return false;
    return scope.nodes.some(id => {
      let h = k.store.header(id);
      while (h && (h.origin.by === 'member' || h.origin.by === 'value')) h = k.store.header(h.origin.owner);
      return h !== undefined && (c.source.origin === h.id || c.source.origin === ownership.get(h.id)?.materialisation);
    });
  };
  const seeds = [...k.retention.seeds.values()].sort(byId);
  const roots = k.retention.rootIds().sort(), todo = [...roots], seen = new Set<Id>();
  for (let n = 0; n < todo.length; n++) {
    const id = todo[n]; if (seen.has(id)) continue; seen.add(id);
    const header = k.store.header(id); if (!header) continue;
    todo.push(...k.store.ownedOf(id), ...idsIn(header.origin));
    const provenance = ownership.get(id); if (provenance) todo.push(provenance.descriptor);
    for (const c of k.store.contributionsNaming(id)) if (isFact(c) && c.form.f === 'const') todo.push(...idsIn(c.form.value));
  }
  const closure = [...seen].sort().map(id => ({ id, header: k.store.header(id),
    contributions: k.store.contributionsNaming(id).filter(isFact).sort(byId),
    edges: k.store.edgesFrom(id).sort(byId), pins: k.store.pinsOfNode(id).sort(byId),
    withdrawals: k.store.pinsOfNode(id).sort(byId).map(p => k.store.withdrawn.get(p.id)), provenance: ownership.get(id) }));
  const projection = new Kernel({ schema: k.schema, worldSeed: k.worldSeed, now: k.now });
  projection.store.restoreFrom({ ...snapshot.store, recordHeaders: new Map(), changeHeaders: new Map(), changedEdges: new Set(), changedContributions: new Set() }); projection.events.restoreFrom(snapshot.events);
  projection.summaries.restoreFrom(snapshot.summaries); projection.frames.restoreFrom(snapshot.frames);
  projection.beliefs.restoreFrom(snapshot.beliefs); projection.retention.restoreFrom(snapshot.retention);
  // This projection observes retained facts only. Public discovery runs as generated operations
  // on the executions themselves, without installing saved headers, edges or facts first.

  const unrecoverable = k.store.allContributions().filter(c => {
    const scope = c.target.scope;
    return c.source.layer !== 'simulation' && scope && 'nodes' in scope && scope.nodes.some(n => !k.persistence.savedHeader(n));
  });
  for (const id of projection.store.headers.keys()) if (!seen.has(id) && !k.persistence.savedHeader(id)) projection.store.removeHeader(id);
  // Exercise event views against expired overlays in their original insertion order. Expired
  // statements cannot affect resolution now, but must never impersonate materialisation ownership.
  for (const c of k.store.allContributions()) if (!isFact(c) && !(c.valid.to !== undefined && c.valid.to <= k.now)) projection.store.removeContribution(c.id);
  const eventViews = new Map(closure.filter(c => c.header && k.schema.hasFacet(c.header.kind, 'event'))
    .map(c => [c.id, readEvent(projection, c.id)]));
  // Deliberately ephemeral simulation overlays have no persistence contract. They are not facts of
  // the event and must not be compared, even if a swept or uninterrupted execution still holds one.
  for (const c of k.store.allContributions()) if (!isFact(c)) projection.store.removeContribution(c.id);
  const values = closure.filter(c => c.header).map(c => {
    const paths = new Set([...c.contributions.map(f => f.target.slot), ...c.pins.map(p => p.slot)]);
    return { id: c.id, values: [...paths].sort().map(path => ({ path,
      at: [projection.resolve(c.id, path, k.now)] })),
      event: c.header && k.schema.hasFacet(c.header.kind, 'event') ? eventViews.get(c.id) : undefined,
      cause: projection.provenance.causeOf(c.id) };
  });
  expect(serialize(capture()).equals(before), 'observation cannot change any source table, queue, worklist or revision').toBe(true);
  return structuredClone({ roots, seeds, closure, values, unrecoverable,
    pending: k.pending.map(p => ({change: p.change, time: p.time})), rules: k.store.generalContributions().sort(byId) });
}

export function runSweepReplayProperty() {
  const count = Number(process.env.SWEEP_SEEDS ?? (process.env.S1_FULL === "1" ? 2048 : 8)), first = Number(process.env.SWEEP_FIRST_SEED ?? 1),
    steps = Number(process.env.SWEEP_STEPS ?? (process.env.S1_FULL === "1" ? 48 : 16));
  if (![count, first, steps].every((v) => Number.isSafeInteger(v) && v > 0)) throw new Error('positive integer sweep bounds required');
  const coverage = { operations: new Set<number>(), seeds: 0, steps: 0, saves: 0, loads: 0 };
  for (const snapshot of [false, true]) for (let seed = first; seed < first + count; seed++) {
    const episode = runCoverageEpisode(seed, snapshot, observe);
    coverage.steps += episode.operations; coverage.saves += episode.saves; coverage.loads += episode.loads;
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
        ownTimes = events.map(event=>k.store.contributionsNaming(event).find(c=>c.source.layer==='simulation' && c.target.slot==='time')!.id),
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
      // Each seed samples a different retention-root category, independent of the releaseable
      // seed consumers above. All categories are represented by the default eight seeds.
      const rootEvent = k.events.mintEvent({creator,cause:creator,name:'root-event',time:0,kind:'arrival',
        participants:[{who:creator,role:'actor'}]});
      switch((seed-1)%8) {
        case 0: k.pin({node:creator,slot:'age',value:20,reason:'observed',cause:creator,evidence:rootEvent}); break;
        case 1: k.addEdge({type:'core:located-in',from:creator,to:place,cause:rootEvent}); break;
        case 2: k.beliefs.set({believer:creator,subject:creator,path:'age',value:20,confidence:1,evidence:[rootEvent],
          source:{by:'observed',event:rootEvent},formed:0,refreshed:0,memorable:true}); break;
        case 3: k.frames.demandRoots.add(creator); k.frames.open({actor:creator,origin:creator,cause:creator,
          level:'goal',weight:1,focus:{nodes:[rootEvent],tier:1}}); break;
        case 4: {
          const canon=k.events.mintEvent({creator,cause:creator,name:'canon-root',time:0,kind:'arrival',
            causes:[rootEvent],participants:[{who:rootEvent,role:'actor'}],served:rootEvent});
          k.events.makeCanon(canon,'committed',creator); break;
        }
        case 5: k.retention.streamIn([rootEvent]); break;
        case 6: k.summaries.makeItemCanon(descriptor,0,'committed',rootEvent); break;
        case 7: k.evolution.states.set('root-batch',{id:'root-batch',state:{},outstanding:[{k:0,spanEnd:100000,
          ops:[{op:'mint-event',spec:{name:'future',time:100000,kind:'arrival',causes:[rootEvent]}}]}]}); break;
      }
      k.settle(); k.persistence.save('initial');
      return { k, creator, place, specs, events, consumers, original, times, ownTimes, edges, locations, rule, descriptor, item };
    };
    const fixture = setup(), control = fixture.k, swept = setup().k;
    let replay = replacement(setup().k, name, 'initial');
    const { creator, place, specs, events, consumers, original, times, ownTimes, edges, locations, rule, descriptor, item } = fixture;
    const compare = (context: string) => {
      const expected = observe(control, place);
      expect(observe(swept, place), `${context}: unswept versus swept`).toEqual(expected);
      expect(observe(replay, place), `${context}: unswept versus replay`).toEqual(expected);
    };
    compare(`seed ${seed}, snapshot ${snapshot}, initial`);
    for (let step = 0; step < steps; step++) {
      const op = draw(20), i = draw(events.length), j = i, at = control.now + draw(6),
        save = draw(4) === 0, reload = draw(2) === 0, sameStart = draw(2) === 0,
        discoveryTime = [0, 1, 2, 42][step % 4],
        context = `seed ${seed}, snapshot ${snapshot}, step ${step}, op ${op}, event ${i}, at ${at}`;
      coverage.operations.add(op); coverage.steps++;
      const results = [control, swept, replay].map((k, run) => {
        const sweep = () => { if (run !== 0) k.retention.scheduleSweep(); k.settle(); };
        // No preparatory recovery: it belongs to these public APIs.
        try {
          // An intentionally unpersisted event needs its producer's recipe after replacement.
          // Saved targets never receive preparatory recovery.
          if (i === 3 && ![0, 2, 6, 10, 11, 16, 17, 18, 19].includes(op)) k.events.restoreEvent(specs[i]);
          const savedEvents = events.slice(0, 3);
          switch (op) {
            // Ignore intentionally never-saved regenerable identities, whose recipes belong to the
            // producer. No candidate is restored before any of these public discovery calls.
            case 17: {
              const q = k.query({find:'core:event',scope:{under:place},at:discoveryTime, must:[],limit:'all'});
              return q.status === 'ok' ? q.items.filter(x=>savedEvents.includes(x.id)) : q;
            }
            case 18: return k.events.eventsAtTime(discoveryTime).filter(id=>savedEvents.includes(id));
            case 19: return k.beliefs.witnessed(creator, events[i % 3], discoveryTime);
            case 0: return k.retention.endSeed(consumers[i]);
            case 1:
              // This author supplies the original payload when the event may never have been saved.
              if (i === 3) k.events.restoreEvent(specs[i]);
              return k.retention.setSeed({ id: consumers[i], state: {}, nodes: [events[i]] });
            case 2: sweep(); return;
            case 3: return k.endContribution(sameStart ? times[i] : ownTimes[i], at);
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
        for (const k of [control, swept, replay]) k.settle();
        coverage.saves++;
        const key = `save-${step}`, record = control.persistence.save(key);
        expect(swept.persistence.save(key), `${context}: swept record`).toEqual(record);
        expect(replay.persistence.save(key), `${context}: replay record`).toEqual(record);
        if (reload) { replay = replacement(replay, name, key); coverage.loads++; }
        compare(`${context}, saved`);
      }
    }
    for (const k of [control, swept, replay]) k.settle();
    const record = control.persistence.save('final');
    expect(swept.persistence.save('final')).toEqual(record);
    expect(replay.persistence.save('final')).toEqual(record);
    replay = replacement(replay, name, 'final');
    compare(`seed ${seed}, snapshot ${snapshot}, final`);
    coverage.seeds++;
    if(process.env.SWEEP_PROGRESS && (seed-first+1)%128===0)
      console.log('sweep/replay progress:', {snapshot, completed:seed-first+1, total:count});
  }
  expect(coverage.operations.size).toBe(20);
  expect(coverage.saves).toBeGreaterThan(0);
  expect(coverage.loads).toBeGreaterThan(0);
  return { ...coverage, operations: coverage.operations.size };
}
