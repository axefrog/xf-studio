import { describe, expect, test } from 'bun:test';
import { H, s } from '../src/id.ts';
import type { Kernel } from '../src/kernel.ts';
import type { Id, Predicate } from '../src/types.ts';
import { coreKernel, defsOf, dim, fxKernel, kind, slot } from './helpers.ts';

const cause = H(s('test-cause'));

const treeDefs = defsOf(
  [dim('fx:unit', { t: 'real', min: 0, max: 1, quantum: 1 / 64 }, { structure: 'metric' })],
  [
    kind('fx:district', [], { extends: ['core:place'] }),
    kind('fx:block', [], { extends: ['core:place'] }),
    kind('fx:place', [slot('influence', 'fx:unit'), slot('police', 'fx:unit')], { extends: ['core:place'] }),
  ],
);

interface Tree {
  k: Kernel;
  district: Id;
  blocks: Id[];
  places: Id[];
}

/** 1 district, 4 blocks, 16 places. Places pinned so that exactly five have influence >= 0.6 and police <= 0.2. */
function buildTree(name: string): Tree {
  const k = coreKernel(name, treeDefs);
  const district = k.root('district', 'fx:district');
  const blocks: Id[] = [];
  const places: Id[] = [];
  for (let b = 0; b < 4; b++) {
    const block = k.root(`block${b}`, 'fx:block');
    blocks.push(block);
    k.addEdge({ type: 'core:located-in', from: block, to: district, cause });
    for (let p = 0; p < 4; p++) {
      const place = k.root(`place${b}-${p}`, 'fx:place');
      places.push(place);
      k.addEdge({ type: 'core:located-in', from: place, to: block, cause });
    }
  }
  // influence (>= 0.6 passes) and police (<= 0.2 passes), by place index.
  const influence = [0.75, 0.25, 0.875, 0.5, 0.625, 0.9375, 0.125, 0.75, 0.0625, 0.8125, 0.5, 1, 0.6875, 0.375, 0.75, 0.25];
  const police = [0.125, 0.125, 0.5, 0.0625, 0.1875, 0.75, 0, 0.15625, 0.0625, 0.0625, 0.875, 0.1875, 0.25, 0.0625, 0.25, 0.125];
  places.forEach((pl, n) => {
    k.pin({ node: pl, slot: 'influence', value: influence[n]!, reason: 'game', cause });
    k.pin({ node: pl, slot: 'police', value: police[n]!, reason: 'game', cause });
  });
  return { k, district, blocks, places };
}

const must: Predicate[] = [
  { path: 'influence', op: 'field-at-least', arg: 0.6 },
  { path: 'police', op: 'field-at-most', arg: 0.2 },
];

function expectedPlaces(t: Tree): Id[] {
  return t.places.filter((pl) => (t.k.value(pl, 'influence') as number) >= 0.6 && (t.k.value(pl, 'police') as number) <= 0.2).sort();
}

describe('F-6 query (spec 8)', () => {
  test("F-6: 'all' returns exactly the five places, without duplicates", () => {
    const t = buildTree('F-6');
    const out = t.k.query({ find: 'fx:place', scope: { under: t.district }, at: 0, must, limit: 'all' });
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    const ids = out.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
    expect([...ids].sort()).toEqual(expectedPlaces(t));
  });

  test('scope under a block finds only that block\'s places; roots with two blocks find both', () => {
    const t = buildTree('F-6b');
    const q = (scope: Parameters<Kernel['query']>[0]['scope']) =>
      t.k.query({ find: 'fx:place', scope, at: 0, must: [], limit: 'all' });
    const one = q({ under: t.blocks[1]! });
    expect(one.status === 'ok' && one.items.map((i) => i.id).sort()).toEqual(t.places.slice(4, 8).sort());
    const two = q({ roots: [t.blocks[0]!, t.blocks[3]!] });
    expect(two.status === 'ok' && two.items).toHaveLength(8);
    // The same node reached twice is returned once.
    const dup = q({ roots: [t.district, t.blocks[0]!] });
    expect(dup.status === 'ok' && dup.items).toHaveLength(16);
  });

  test('a region scope scans the known nodes of the kind and tests their position', () => {
    const t = buildTree('F-6c');
    t.places.forEach((pl, n) => t.k.pin({ node: pl, slot: 'position', value: [n, 0, 0], reason: 'authored', cause }));
    const out = t.k.query({ find: 'fx:place', scope: { region: { min: [2, -1, -1], max: [5, 1, 1] } }, at: 0, must: [], limit: 'all' });
    expect(out.status === 'ok' && out.items.map((i) => i.id).sort()).toEqual(t.places.slice(2, 6).sort());
  });

  test('a nodes scope examines only the named nodes', () => {
    const t = buildTree('F-6d');
    const out = t.k.query({ find: 'fx:place', scope: { nodes: [t.places[0]!, t.places[2]!, t.blocks[0]!] }, at: 0, must: [], limit: 'all' });
    expect(out.status === 'ok' && out.items.map((i) => i.id).sort()).toEqual([t.places[0]!, t.places[2]!].sort());
  });

  test('limit n returns the n best by score, then by Id (I-6)', () => {
    const t = buildTree('F-6e');
    const prefer = [{ p: { path: 'influence', op: 'field-at-least', arg: 0.7 } as Predicate, weight: 2 }, { p: { path: 'police', op: 'field-at-most', arg: 0.1 } as Predicate, weight: 1 }];
    const all = t.k.query({ find: 'fx:place', scope: { under: t.district }, at: 0, must: [], prefer, limit: 'all' });
    const top3 = t.k.query({ find: 'fx:place', scope: { under: t.district }, at: 0, must: [], prefer, limit: 3 });
    expect(all.status).toBe('ok');
    expect(top3.status).toBe('ok');
    if (all.status !== 'ok' || top3.status !== 'ok') return;
    expect(top3.items).toEqual(all.items.slice(0, 3));
    for (let n = 1; n < all.items.length; n++) {
      const a = all.items[n - 1]!;
      const b = all.items[n]!;
      expect(a.score > b.score || (a.score === b.score && a.id < b.id)).toBe(true);
    }
    // Brute force: every returned item scores at least as high as every omitted one.
    const worstTop = top3.items[2]!;
    for (const it of all.items.slice(3)) expect(it.score <= worstTop.score).toBe(true);
  });

  test('the query is read against one revision: ended edges drop out at later times', () => {
    const t = buildTree('F-6f');
    const edge = t.k.store.edgesFrom(t.blocks[0]!)[0]!;
    t.k.endEdge(edge.id, 100);
    const before = t.k.query({ find: 'fx:place', scope: { under: t.district }, at: 50, must: [], limit: 'all' });
    const after = t.k.query({ find: 'fx:place', scope: { under: t.district }, at: 150, must: [], limit: 'all' });
    expect(before.status === 'ok' && before.items).toHaveLength(16);
    expect(after.status === 'ok' && after.items).toHaveLength(12);
  });

  test('predicate operators: in, not-in, range, eq, has-edge, lacks-edge, and the node itself', () => {
    const t = buildTree('F-6g');
    const run = (preds: Predicate[]) => {
      const o = t.k.query({ find: 'fx:place', scope: { under: t.district }, at: 0, must: preds, limit: 'all' });
      return o.status === 'ok' ? o.items.length : -1;
    };
    expect(run([{ path: 'influence', op: 'eq', arg: 0.75 }])).toBe(3);
    expect(run([{ path: 'influence', op: 'in', arg: [0.75, 0.25] }])).toBe(5);
    expect(run([{ path: 'influence', op: 'not-in', arg: [0.75, 0.25] }])).toBe(11);
    expect(run([{ path: 'influence', op: 'range', arg: { r: 'ivl', ivls: [[0.5, 0.625]] } }])).toBe(3);
    expect(run([{ path: '', op: 'has-edge', arg: { edge: 'core:located-in', to: t.blocks[0]! } }])).toBe(4);
    expect(run([{ path: '', op: 'lacks-edge', arg: { edge: 'core:located-in', to: t.blocks[0]! } }])).toBe(12);
    expect(run([{ path: '', op: 'has-edge', arg: { edge: 'core:located-in', to: { kind: 'fx:block', slot: '*' } } }])).toBe(16);
    expect(run([{ path: '@self', op: 'eq', arg: t.places[3]! }])).toBe(1);
    expect(run([{ path: 'police', op: 'field-at-least', arg: 0.5 }, { path: 'influence', op: 'field-at-least', arg: 0.7 }])).toBe(2);
  });

  test('a path may cross node slots but never a ref slot', () => {
    const k = coreKernel('cross');
    const p = k.root('p', 'core:person');
    const nm = k.address(p, 'name');
    k.pin({ node: nm, slot: 'origin', value: 'japanese', reason: 'authored', cause });
    const q = (path: string) =>
      k.query({ find: 'core:person', scope: { nodes: [p] }, at: 0, must: [{ path, op: 'eq', arg: 'japanese' }], limit: 'all' });
    const cross = q('name/origin');
    expect(cross.status === 'ok' && cross.items).toHaveLength(1);
    // A ref slot is never followed: `place/public` is simply false.
    const viaRef = k.query({ find: 'core:person', scope: { nodes: [p] }, at: 0, must: [{ path: 'place/public', op: 'in', arg: ['public', 'private', 'restricted'] }], limit: 'all' });
    expect(viaRef.status === 'ok' && viaRef.items).toHaveLength(0);
  });

  test('hitting a hard limit returns failed, never a partial result', () => {
    const t = buildTree('F-6h');
    const k = coreKernel('F-6h-limit', treeDefs, { maxExactChecks: 8 });
    const district = k.root('district', 'fx:district');
    for (let n = 0; n < 12; n++) {
      const pl = k.root(`p${n}`, 'fx:place');
      k.addEdge({ type: 'core:located-in', from: pl, to: district, cause });
    }
    const out = k.query({ find: 'fx:place', scope: { under: district }, at: 0, must: [], limit: 'all' });
    expect(out.status).toBe('failed');
    expect(k.defects.ofKind('limit')).toHaveLength(1);
    const steps = coreKernel('F-6h-steps', treeDefs, { maxFrontierSteps: 5 });
    const d2 = steps.root('district', 'fx:district');
    for (let n = 0; n < 12; n++) steps.addEdge({ type: 'core:located-in', from: steps.root(`p${n}`, 'fx:place'), to: d2, cause });
    expect(steps.query({ find: 'fx:place', scope: { under: d2 }, at: 0, must: [], limit: 'all' }).status).toBe('failed');
    expect(t.k.query({ find: 'fx:place', scope: { under: t.district }, at: 0, must: [], limit: 'all' }).status).toBe('ok');
  });
});

describe('ref slots draw among the complete candidate set (spec 2.4)', () => {
  test('candidates are the query result cut to the max lowest Ids; the draw runs over them', () => {
    const k = coreKernel('refs');
    const city = k.root('city', 'core:place');
    const places: Id[] = [];
    for (let n = 0; n < 10; n++) {
      const pl = k.root(`pl${n}`, 'core:place');
      places.push(pl);
      k.addEdge({ type: 'core:located-in', from: pl, to: city, cause });
    }
    const person = k.root('p', 'core:person');
    const tr = k.trace(person, 'place');
    const lowest = [...places, city].sort().slice(0, 256);
    expect(tr.feasibleSize).toBe(lowest.length);
    const got = k.value(person, 'place') as Id;
    expect([...places, city]).toContain(got);
    // A pin on a ref wins even if the node is not among the candidates.
    const stranger = k.root('stranger', 'core:place');
    k.pin({ node: person, slot: 'place', value: stranger, reason: 'observed', cause });
    expect(k.value(person, 'place')).toBe(stranger);
  });

  test('an empty candidate set is unavailable; a candidate set over N_enum is failed', () => {
    const k = coreKernel('refs2');
    const person = k.root('p', 'core:person');
    expect(k.resolve(person, 'place')).toEqual({ status: 'unavailable' });
    const slim = defsOf(
      [dim('fx:target-ref', { t: 'ref', kind: 'fx:target', candidates: { find: 'fx:target', scope: { under: 'root:city' }, must: [], max: 10 } })],
      [kind('fx:thing', []), kind('fx:target', [], { extends: ['fx:thing'] }), kind('fx:chooser', [slot('pick', 'fx:target-ref')], { extends: ['fx:thing'] })],
      [{ id: 'core:located-in', from: ['fx:thing'], to: ['fx:thing'], attrs: {} }],
    );
    const build = (nEnum: number) => {
      const kk = fxKernel('refs3', slim, { nEnum });
      const city = kk.root('city', 'fx:thing');
      for (let n = 0; n < 6; n++) kk.addEdge({ type: 'core:located-in', from: kk.root('t' + n, 'fx:target'), to: city, cause });
      return kk;
    };
    const small = build(4);
    expect(small.resolve(small.root('c', 'fx:chooser'), 'pick')).toEqual({ status: 'failed' });
    expect(small.defects.ofKind('domain-too-large')).toHaveLength(1);
    const roomy = build(8);
    expect(roomy.resolve(roomy.root('c', 'fx:chooser'), 'pick').status).toBe('ok');
  });
});

describe('a query tests what a node resolves to, not what it was minted with (Sol 3)', () => {
  const eventIn = (k: Kernel, name: string) => {
    const place = k.root('place', 'core:place');
    const alice = k.root('alice', 'core:person');
    const spec = { creator: alice, cause, name, time: 77, kind: 'assault', place, participants: [{ who: alice, role: 'victim' }] };
    const e = k.events.mintEvent(spec);
    const find = (kindName: string, lo = 0, hi = 1000) =>
      k.query({ find: 'core:event', scope: { under: place }, at: 1000, must: [{ path: 'kind', op: 'eq', arg: kindName }, { path: 'time', op: 'range', arg: [lo, hi] }], limit: 'all' });
    const ids = (kindName: string, lo?: number, hi?: number): Id[] => {
      const out = find(kindName, lo, hi);
      return out.status === 'ok' ? out.items.map((x) => x.id) : [];
    };
    return { place, alice, e, ids, spec };
  };

  test('a pin that restates the kind of a minted event is seen, with and without the cache, and after a save and load', () => {
    const k = coreKernel('Sol-3a');
    const { e, ids, spec } = eventIn(k, 'e');
    expect(ids('assault')).toEqual([e]);
    expect(ids('sale')).toEqual([]);
    k.pin({ node: e, slot: 'kind', value: 'sale', reason: 'observed', cause });
    expect(k.value(e, 'kind')).toBe('sale');
    expect(ids('sale')).toEqual([e]);
    expect(ids('assault')).toEqual([]);
    k.persistence.save('A');
    k.persistence.load('A');
    // The minted facts and location survive with the pin; the pin still decides the resolved kind.
    expect(k.value(e, 'kind')).toBe('sale');
    expect(ids('sale'), 'referenced event remains spatially discoverable immediately after replacement').toEqual([e]);
    k.root('place', 'core:place');
    k.root('alice', 'core:person');
    expect(k.events.mintEvent(spec)).toBe(e);
    expect(k.value(e, 'kind')).toBe('sale');
    expect(ids('sale')).toEqual([e]);
    expect(ids('assault')).toEqual([]);
  });

  test('a contribution that moves the time of a minted event is seen', () => {
    const k = coreKernel('Sol-3b');
    const { e, ids } = eventIn(k, 'e2');
    expect(ids('assault', 0, 100)).toEqual([e]);
    k.pin({ node: e, slot: 'time', value: 500, reason: 'observed', cause });
    expect(k.value(e, 'time')).toBe(500);
    expect(ids('assault', 0, 100)).toEqual([]);
    expect(ids('assault', 400, 600)).toEqual([e]);
  });

  test('a rule over a kind that touches kind switches the shortcut off, and the answer is the resolved one', () => {
    const k = coreKernel('Sol-3c');
    const { e, ids } = eventIn(k, 'e3');
    expect(ids('assault')).toEqual([e]);
    k.contribute({ source: { layer: 'authored', origin: cause }, target: { kind: 'core:event', slot: 'kind' }, form: { f: 'const', value: 'sale' }, mode: 'constrain' });
    expect(k.value(e, 'kind')).toBe('sale');
    expect(ids('sale')).toEqual([e]);
    expect(ids('assault')).toEqual([]);
  });
});
