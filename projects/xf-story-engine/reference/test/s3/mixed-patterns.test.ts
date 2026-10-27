import { expect, test } from 'bun:test';
import { graphWorld, simple } from './graph-fixture.ts';
import { library } from './library.ts';
import { complete, event, pack, pattern, world } from './helpers.ts';
import { layeredWeek } from './layered-week.ts';
import { HolotableObserver } from '../../src/holotable/observe.ts';
import { serialize } from 'node:v8';
import { H, s, id } from '../../src/id.ts';

function mixedWorld(name: string, aftermath = false) {
  const stage = pattern({ version: 7 });
  const parent = simple({ id: 'xf.test:stage-parent' });
  parent.junctures.first = { fn: 'story', args: { pattern: stage.id, outcome: 'complete' }, binds: { a: '?a', b: '?b' } };
  if (aftermath) {
    parent.junctures.tail = { fn: 'repay', args: { debtor: '?a', creditor: '?b' }, optional: true };
    parent.outcomes.done.aftermath = { junctures: ['tail'], days: 10 };
  }
  const w = graphWorld(name, [...library, parent]);
  expect(w.l3.installPatterns([...library, parent, stage]).filter((f) => f.level === 'error')).toEqual([]);
  return { ...w, stage, parent };
}

test('mixed stage/composite patterns: stage completion carries the declared story record', () => {
  const w = graphWorld('mixed-stage-composite', library);
  const p = pattern({ version: 7 });
  expect(w.l3.installPatterns([...library, p]).filter((f) => f.level === 'error')).toEqual([]);
  complete(w);
  const entry = w.l3.state.pool.find((e) => e.pattern === p.id)!;
  const story = w.l3.kv.event(entry.story!)!;
  expect(entry.version).toBe(7);
  expect(entry.complete).toBe(true);
  expect(story.data).toEqual({ pattern: p.id, instance: entry.id, outcome: 'complete', kind: 'resolved', depth: 1 });
  expect(w.k.eventKinds.dataProblem(story.kind, story.data)).toBeUndefined();
  expect(story.participants).toEqual([{ who: w.a, role: 'a' }, { who: w.b, role: 'b' }]);
  expect(story.causes).toEqual(entry.stages.map((s) => s.event));
  expect(story.time).toBe(entry.lastTime);
  expect(story.effects).toEqual([]);
  expect(story.witnesses).toEqual([]);
  // The kind declaration survives unloading graphs; later stage completions
  // still owe the schema even though no graph pattern currently consumes them.
  expect(w.l3.installPatterns([p])).toEqual([]);
  complete(w, 1400);
  const later = w.l3.state.pool.find((e) => e.firstTime === 1400)!;
  expect(w.l3.kv.event(later.story!)?.data?.instance).toBe(later.id);
});

test('graph schema adoption survives graph unloading and fresh stage-only loads before and after typed stories', () => {
  for (const snapshot of [false, true]) {
    const name = `mixed-unload-${snapshot}`, p = pattern({ version: 7 });
    const make = () => { const w = world(name, { patterns: [p] }); w.k.config.snapshotEvery = snapshot ? 1 : 10000; return w; };
    const worlds = [graphWorld(name, library), graphWorld(name, library), graphWorld(name, library)];
    for (const w of worlds) {
      w.k.config.snapshotEvery = snapshot ? 1 : 10000;
      expect(w.l3.installPatterns([p])).toEqual([]);
    }
    worlds[0].k.retention.scheduleSweep = () => 0;
    const replace = (key: string) => {
      const old = worlds[2]; old.l3.flush(); old.k.persistence.save(key);
      const fresh = make();
      for (const [id, record] of old.k.persistence.chain) fresh.k.persistence.chain.set(id, structuredClone(record));
      fresh.k.persistence.load(key);
      expect(fresh.k.eventKinds.eventKind('meta:story')).toEqual(old.k.eventKinds.eventKind('meta:story'));
      expect(fresh.l3.state).toEqual(old.l3.state);
      worlds[2] = fresh;
    };
    replace('no-stories-yet');
    for (let step = 0; step < 2; step++) {
      for (const w of worlds) { complete(w, 100 + step * 2400); w.l3.flush(); }
      for (const w of worlds.slice(1)) { w.k.retention.scheduleSweep(); w.k.settle(); }
      replace(`typed-${step}`);
      const observe = (w: typeof worlds[number]) => ({ state: w.l3.state,
        stories: w.l3.state.pool.map((e) => w.l3.kv.event(e.story!)), candidates: w.l3.sower.collect(w.l3.counts) });
      expect(observe(worlds[1])).toEqual(observe(worlds[0]));
      expect(observe(worlds[2])).toEqual(observe(worlds[0]));
      expect(worlds[2].l3.kv.event(worlds[2].l3.state.pool.at(-1)!.story!)?.data?.outcome).toBe('complete');
    }
  }
});

test('a stage story precedes later occurrences in the same batch, independent of settle grouping and work budget', () => {
  const run = (split: boolean, budgeted = false) => {
    const w = mixedWorld('mixed-grouping', true);
    w.k.now = 100;
    const first = event(w, 'insult', 'insult', 100);
    w.k.now = 101;
    event(w, 'assault', 'assault', 101, { causes: [first.id], effects: [{ on: w.b, effect: 'harm' }] });
    if (split) { w.k.settle({ to: 105 }); w.l3.sifter.boundary(105, 0); }
    // Use the mandated story identity to cite the child before its grouped completion.
    const bindings = { '?a': w.a, '?b': w.b };
    const match = w.l3.keys.match(w.stage.id, w.l3.keys.bindings('bind', w.stage.id, bindings), first.id);
    const story = H(s('mint'), id(w.l3.keys.director), id(match), s('meta:story'));
    w.k.now = 110;
    event(w, 'help', 'helped', 110, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [story] });
    w.k.settle({ to: 600, budget: budgeted ? 1 : 100000 }); w.l3.refresh();
    const parent = w.l3.state.pool.find((e) => e.pattern === w.parent.id)!;
    expect(parent.complete).toBe(true);
    expect(parent.graph!.junctures.first.filler?.id).toBe(story);
    expect(parent.graph!.junctures.second.filler?.at).toBe(110);
    return { state: w.l3.state, threads: w.l3.threadView, story: w.l3.kv.event(parent.story!), candidates: w.l3.sower.collect(w.l3.counts) };
  };
  const split = run(true);
  expect(run(false)).toEqual(split);
  expect(run(false, true)).toEqual(split);
});

test('mixed stories survive unswept, swept and replacement-load executions in both save modes', () => {
  for (const snapshot of [false, true]) for (let seed = 0; seed < 4; seed++) {
    const make = (unswept = false) => {
      const w = mixedWorld(`mixed-replay-${snapshot}-${seed}`, true);
      w.k.config.snapshotEvery = snapshot ? 1 : 10000;
      if (unswept) { w.k.retention.scheduleSweep = () => 0; w.l3.sifter.sweep = () => {}; }
      return w;
    };
    const worlds = [make(true), make(), make()];
    const replace = (key: string) => {
      const old = worlds[2]; old.l3.flush(); old.k.persistence.save(key);
      const saved = structuredClone(old.l3.state), fresh = make();
      for (const [id, record] of old.k.persistence.chain) fresh.k.persistence.chain.set(id, structuredClone(record));
      fresh.k.persistence.load(key);
      expect(fresh.l3.state).toEqual(saved);
      const roots = fresh.k.retention.seeds.get(fresh.l3.keys.record)!.nodes;
      for (const e of fresh.l3.state.pool) if (e.story) {
        expect(roots).toContain(e.story);
        expect(fresh.l3.kv.event(e.story)).toEqual(old.l3.kv.event(e.story));
      }
      worlds[2] = fresh;
    };
    // Unswept storage may still contain retired graph descriptors and their evidence.
    // Compare the semantic pool, plus full saved-state equality on every fresh load above.
    const observe = (w: typeof worlds[number]) => ({ pool: w.l3.state.pool.filter((e) => !e.graph?.retired), threads: w.l3.threadView,
      skeletons: w.l3.state.skeletons, tombstones: w.l3.state.tombstones, buffer: w.l3.state.buffer,
      candidates: w.l3.sower.collect(w.l3.counts), stories: w.l3.state.pool.filter((e) => e.story && !e.graph?.retired).map((e) => w.l3.kv.event(e.story!)) });
    for (let step = 0; step < 2; step++) {
      const at = 100 + step * 2400 + seed * 7;
      for (const w of worlds) {
        complete(w, at);
        const child = w.l3.state.pool.find((e) => e.pattern === w.stage.id && e.firstTime === at)!;
        w.k.events.makeCanon(child.stages.at(-1)!.event, 'observed', w.v);
        expect(w.l3.state.buffer.some((b) => b.event.id === child.story && b.pattern === w.parent.id)).toBe(true);
        w.l3.flush();
      }
      replace(`buffer-${step}`);
      for (const w of worlds) {
        const boundary = Math.ceil(at / 600) * 600;
        w.k.settle({ to: boundary }); w.l3.refresh();
        const child = w.l3.state.pool.find((e) => e.pattern === w.stage.id && e.firstTime === at)!;
        w.k.settings.set({ tempo: 'restless' });
        w.l3.data.schedule.theta.restless = 1;
        const slot = 1 + step;
        w.l2.baseTotal = w.l3.keys.slot(slot, w.l3.data.schedule.slotGap).time;
        w.l3.state.slots.open.next = slot;
        w.l3.sower.resolve(w.l3.counts);
        expect(child.seed).toBeDefined();
        w.l3.refresh();
        const connected = structuredClone({ threads: w.l3.threadView, counts: w.l3.counts });
        expect(connected.threads.some((t) => t.patterns?.includes(child.id) && t.instances.includes(child.seed!))).toBe(true);
        w.l3.sifter.sweep(w.k.now); w.l3.refresh();
        expect({ threads: w.l3.threadView, counts: w.l3.counts }).toEqual(connected);
        event(w, `help-${step}`, 'helped', boundary + 10, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [child.story!], witnesses: [w.v] });
        w.k.settle({ to: boundary + 600 }); w.l3.refresh(); w.l3.flush();
        const parent = w.l3.state.pool.find((e) => e.pattern === w.parent.id && e.firstTime === at + 1)!;
        expect(parent.complete).toBe(true);
        expect(parent.graph!.junctures.first.perceived).toBeDefined();
        expect(w.l3.state.skeletons.ring.length).toBeGreaterThan(0);
      }
      for (const w of worlds.slice(1)) { w.k.retention.scheduleSweep(); w.k.settle(); }
      replace(`complete-${step}`);
      for (const w of worlds) w.l3.refresh();
      expect(observe(worlds[1])).toEqual(observe(worlds[0]));
      expect(observe(worlds[2])).toEqual(observe(worlds[0]));
    }
    // Storage is held only while something needs the stage/graph/seed connection.
    const swept = worlds[1], held = swept.l3.state.pool.filter((e) => !e.graph && e.seed).map((e) => e.id);
    expect(held).toHaveLength(2);
    swept.l3.sifter.sweep(swept.k.now + swept.l3.data.sifter.candidateTtl + 1);
    expect(held.every((id) => swept.l3.state.pool.some((e) => e.id === id))).toBe(true);
    expect(swept.l3.installPatterns([swept.stage])).toEqual([]);
    swept.l3.sifter.sweep(swept.k.now);
    expect(held.some((id) => swept.l3.state.pool.some((e) => e.id === id))).toBe(false);
  }
}, 30_000);

test('Holotable observes stage-sourced stories without reading their schema or changing engine state', () => {
  let installed = false, sawStage = false;
  layeredWeek('pay', false, { sample(sim, l2, l3) {
    if (!installed) {
      expect(l2.installPack(pack())).toEqual([]);
      const p = pattern({ stages: [{ kind: 'shakedown', who: [{ role: 'aggressor', as: '?a' }, { role: 'victim', as: '?b' }] }], unless: [] });
      expect(l3.installPatterns([...l3.sifter.patterns.values(), p]).filter((f) => f.level === 'error')).toEqual([]);
      installed = true;
    }
    const stage = l3.state.pool.find((e) => !e.graph && e.complete);
    if (!stage) return;
    expect(l3.kv.event(stage.story!)?.data?.outcome).toBe('complete');
    const image = () => serialize({ store: sim.k.store.capture(), references: sim.k.store.referencesVersion, revision: sim.k.revision,
      epoch: sim.k.epoch, now: sim.k.now, pending: sim.k.pending, frames: sim.k.frames.capture(), beliefs: sim.k.beliefs.capture(),
      processes: sim.k.evolution.states, queued: sim.k.evolution.queued, record: sim.record, seeds: sim.k.retention.seeds,
      log: l3.log, state: l3.state, threads: l3.threadView, instances: l2.all().map((i) => i.st) });
    const before = image(), sample = new HolotableObserver(sim, l2, l3).sample();
    expect(image().equals(before)).toBe(true);
    const item = sample.layers.get('stories')!.find((i) => i.id === stage.id)!;
    expect(item.facets?.pattern).toBe(`${stage.pattern}@${stage.version}`);
    expect(item.facets?.outcome).toBe('done'); // Existing observer presentation of stage completion.
    sawStage = true;
  } });
  expect(sawStage).toBe(true);
}, 30_000);

test('stage story chains in the same boundary; legibility follows the last stage, not the first', () => {
  const w = mixedWorld('mixed-chain');
  const first = event(w, 'insult', 'insult', 100, { witnesses: [w.v] });
  const last = event(w, 'assault', 'assault', 101, { causes: [first.id], effects: [{ on: w.b, effect: 'harm' }] });
  w.k.settle({ to: 600 }); w.l3.refresh();
  const child = w.l3.state.pool.find((e) => e.pattern === w.stage.id)!;
  const parent = w.l3.state.pool.find((e) => e.pattern === w.parent.id)!;
  expect(child.complete).toBe(true);
  expect(parent.graph!.junctures.first.filler?.id).toBe(child.story);
  expect(parent.bindings).toEqual(child.bindings);
  expect(parent.graph!.depth).toBe(2);
  expect(parent.graph!.junctures.first.perceived).toBeUndefined();
  expect(w.l3.state.skeletons.ring).toEqual([]);
  w.k.events.makeCanon(last.id, 'observed', w.v); w.l3.refresh();
  expect(w.l3.ledger.aware(child)).toBe(true);
  expect(parent.graph!.junctures.first.perceived).toEqual({ at: w.l2.exposure(last.id)!.at, play: w.l2.playTotal() });
  expect(w.l3.ledger.aware(parent)).toBe(true);
  const thread = w.l3.threadView.find((t) => t.patterns?.includes(parent.id))!;
  expect(thread.patterns).toContain(child.id);
  expect(thread.tokens).toEqual([]); // The stage form's internal @stage has no token.
  const helped = event(w, 'help', 'helped', 610, { participants: [{ who: w.b, role: 'actor' }, { who: w.a, role: 'target' }], causes: [child.story!], witnesses: [w.v] });
  w.k.settle({ to: 1200 }); w.l3.refresh();
  expect(parent.graph!.junctures.second.filler?.id).toBe(helped.id);
  const story = w.l3.kv.event(parent.story!)!;
  expect(story.data?.depth).toBe(2);
  expect(story.causes).toContain(child.story!);
  expect(w.l3.state.skeletons.ring.length).toBeGreaterThan(0);
  expect(w.l3.threadView.flatMap((t) => t.tokens ?? []).some((t) => t.startsWith('help('))).toBe(true);
  expect(w.l3.threadView.flatMap((t) => t.tokens ?? []).some((t) => /story|@stage/.test(t))).toBe(false);
});
