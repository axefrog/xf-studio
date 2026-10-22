import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { ln } from '../src/fdlibm-log.ts';
import { H, s, i } from '../src/id.ts';
import type { Kernel } from '../src/kernel.ts';
import { contains } from '../src/region.ts';
import type { Id, Predicate, Value } from '../src/types.ts';
import { digestOf, makeRng, moodProcess, runScript, startWorld, synKernel, type ScriptWorld } from './synthetic.ts';

const cause = H(s('invariants'));
const SAMPLED = ['kinda', 'lvl', 'i', 'size', 'leaves#count', 'home'] as const;

function scriptWorld(name: string, steps = 500, config?: Parameters<typeof synKernel>[1]): ScriptWorld {
  const k = synKernel(name, config);
  const w = startWorld(k);
  k.evolution.register(moodProcess(() => w.agents));
  runScript(w, steps, makeRng(name), () => {});
  k.settle();
  k.dispatcher.drain();
  return w;
}

const valuesAt = (k: Kernel, nodes: Id[], times: number[]): string[] => {
  const out: string[] = [];
  for (const n of nodes) {
    for (const t of times) {
      for (const sl of [...SAMPLED, 'band', 'mood']) {
        const r = k.resolve(n, sl, t);
        out.push(`${n}|${sl}|${t}|${r.status}|${r.value === undefined ? '' : String(r.value)}`);
      }
    }
  }
  return out;
};

describe('I-1 determinism', () => {
  test('the same seed, schema and operation sequence give identical results (and digests)', () => {
    const a = digestOf(startWorld(synKernel('I-1')), 300, 'I-1');
    const b = digestOf(startWorld(synKernel('I-1')), 300, 'I-1');
    expect(a).toEqual(b);
    expect(digestOf(startWorld(synKernel('I-1b')), 300, 'I-1').digest).not.toBe(a.digest);
  });

  test('the order in which pins and contributions arrive does not matter, only their Ids', () => {
    const rng = makeRng('shuffle');
    const mk = (order: number[]) => {
      const k = synKernel('I-1-order');
      const nodes = Array.from({ length: 8 }, (_, n) => k.root(`a${n}`, 'syn:agent'));
      const ops: Array<() => void> = [];
      for (const n of nodes) {
        ops.push(() => k.pin({ node: n, slot: 'kinda', value: 'e3', reason: 'authored', cause: H(s('c'), s('x')) }));
        ops.push(() => k.pin({ node: n, slot: 'kinda', value: 'e4', reason: 'authored', cause: H(s('c'), s('y')) }));
        ops.push(() => k.pin({ node: n, slot: 'i', region: { r: 'ivl', ivls: [[4, 11]] }, reason: 'game', cause: H(s('c'), s('z')) }));
        ops.push(() => k.contribute({ source: { layer: 'seeding', origin: 'o' }, target: { slot: 'lvl', scope: { nodes: [n] } }, mode: 'weight', form: { f: 'table', weights: { '0.5': 9 } } }));
      }
      for (const idx of order) ops[idx]!();
      return valuesAt(k, nodes, [0, 700, 1500]);
    };
    const base = Array.from({ length: 32 }, (_, n) => n);
    const shuffled = [...base].sort(() => rng.next() - 0.5);
    expect(mk(shuffled)).toEqual(mk(base));
  });

  test('no kernel decision uses Math.log or Math.exp (spec 1.3)', () => {
    const dir = new URL('../src/', import.meta.url);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue;
      const code = readFileSync(new URL(f, dir), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      expect(code.includes('Math.log'), f).toBe(false);
      expect(code.includes('Math.exp'), f).toBe(false);
      expect(code.includes('Math.random'), f).toBe(false);
    }
  });
});

describe('I-2 active constraints hold; I-8 the trace is complete', () => {
  test('every resolved value satisfies every active constraint, and a rejected constraint at 600 or more makes it a contradiction', () => {
    const w = scriptWorld('I-2');
    // Two observations that cannot both hold, so the contradiction rule is exercised whatever the script left behind.
    w.k.pin({ node: w.agents[1]!, slot: 'kinda', value: 'e0', reason: 'observed', cause });
    w.k.pin({ node: w.agents[1]!, slot: 'kinda', value: 'e1', reason: 'observed', cause });
    let checked = 0;
    let contradictions = 0;
    for (const n of w.agents) {
      for (const t of [0, 650, 1300, 2500]) {
        for (const sl of [...SAMPLED, 'mood']) {
          const tr = w.k.trace(n, sl, t);
          if (tr.value === undefined) continue;
          checked++;
          const res = w.k.resolve(n, sl, t);
          expect(tr.value).toEqual(res.value as Value);
          expect(tr.status).toBe(res.status);
          const vt = w.k.schema.slotInfo('syn:agent', sl)!.vt;
          for (const c of tr.constraints) {
            if (c.negate) continue;
            if (c.active && vt.t !== 'ref') expect(contains(c.region, tr.value as Value), `${sl} ${c.source}`).toBe(true);
          }
          const rejectedHigh = tr.constraints.some((c) => !c.active && c.precedence >= 600);
          expect(tr.status === 'contradiction').toBe(rejectedHigh);
          if (rejectedHigh) contradictions++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(contradictions).toBeGreaterThan(0);
  });

  test("I-8: the trace holds every feasible score, the winner is the argmax, and the winner's score is the sum of its factors", () => {
    const w = scriptWorld('I-8');
    let drawn = 0;
    for (const n of w.agents) {
      for (const sl of ['kinda', 'lvl', 'i', 'size']) {
        const tr = w.k.trace(n, sl, 100);
        if (!tr.winner || tr.scores.length < 2) continue;
        drawn++;
        expect(tr.scores).toHaveLength(tr.feasibleSize);
        const best = tr.scores.reduce((m, x) => (x.total > m.total ? x : m));
        expect(tr.winner.value).toEqual(best.value);
        expect(tr.runnerUp!.total).toBeLessThanOrEqual(tr.winner.total);
        let sum = 0;
        for (const f of tr.factors) sum += f.strength * ln(f.atWinner);
        expect(sum).toBe(tr.winner.score);
        for (const x of tr.scores) expect(x.total).toBe(x.score + x.noise);
      }
    }
    expect(drawn).toBeGreaterThan(50);
  });
});

describe('I-3 regeneration, I-4 no caches persisted, I-13 silence', () => {
  test('I-3: after forgetting, every node resolves identically', () => {
    const w = scriptWorld('I-3');
    const before = valuesAt(w.k, w.agents, [0, 900, 2100]);
    w.k.retention.scheduleSweep();
    w.k.settle();
    const kept = w.k.retention.marked();
    for (const id of w.k.store.nodes.keys()) expect(kept.has(id)).toBe(true);
    expect(valuesAt(w.k, w.agents, [0, 900, 2100])).toEqual(before);
  });

  test('I-4: saves hold no caches: resolving everything changes nothing the chain would store', () => {
    const w = scriptWorld('I-4');
    const first = w.k.persistence.save('first');
    expect(first.ops.length).toBeGreaterThan(0);
    valuesAt(w.k, w.agents, [0, 500, 1000, 3000]);
    w.k.query({ find: 'syn:agent', scope: { under: w.city }, at: 10, must: [], limit: 'all' });
    const second = w.k.persistence.save('second');
    expect(second.ops).toHaveLength(0);
    const text = JSON.stringify(w.k.persistence.currentView().toData());
    expect(text.includes('"resolved"')).toBe(false);
    expect(text.includes('"slots"')).toBe(false);
  });

  test('I-13: resolution, regeneration, queries and replay produce no changes and no relevance', () => {
    const w = scriptWorld('I-13');
    expect(w.k.pending).toHaveLength(0);
    valuesAt(w.k, w.agents, [0, 700, 1400]);
    w.k.retention.scheduleSweep();
    w.k.settle();
    valuesAt(w.k, w.agents, [0, 700, 1400]);
    w.k.query({ find: 'syn:agent', scope: { under: w.city }, at: 10, must: [{ path: 'lvl', op: 'field-at-least', arg: 0.5 }], limit: 2 });
    expect(w.k.pending).toHaveLength(0);
    const last = [...w.k.persistence.records()].pop()!;
    w.k.persistence.load(last.saveKey);
    expect(w.k.pending).toHaveLength(0);
    w.k.settle();
    expect(w.k.dispatcher.drain()).toHaveLength(0);
  });
});

describe('I-5 active views agree', () => {
  test('the band always equals floor(i / 4); a contradiction in the input is inherited', () => {
    const w = scriptWorld('I-5');
    let n = 0;
    for (const a of w.agents) {
      const iv = w.k.resolve(a, 'i', 0);
      const bd = w.k.resolve(a, 'band', 0);
      if (iv.value === undefined) continue;
      n++;
      expect(bd.value).toBe(Math.floor((iv.value as number) / 4));
      if (iv.status === 'contradiction') expect(bd.status).toBe('contradiction');
    }
    expect(n).toBeGreaterThan(30);
  });
});

describe('I-6 queries are sound and complete against one revision', () => {
  test('all and top-n agree with a brute-force evaluation', () => {
    const w = scriptWorld('I-6', 400);
    const k = w.k;
    const t = 10_000_000;
    const within = (node: Id, root: Id): boolean => {
      const seen = new Set<Id>();
      const stack = [node];
      while (stack.length) {
        const cur = stack.pop()!;
        if (cur === root) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const e of k.store.edgesFrom(cur)) {
          if (e.type === 'core:located-in' && e.valid.from <= t && (e.valid.to === undefined || t < e.valid.to)) stack.push(e.to);
        }
      }
      return false;
    };
    const rng = makeRng('queries');
    let nonEmpty = 0;
    for (let q = 0; q < 12; q++) {
      const root = rng.pick(w.sites);
      const must: Predicate[] = [{ path: 'lvl', op: 'field-at-least', arg: rng.int(17) / 16 }];
      const prefer = [
        { p: { path: 'kinda', op: 'in', arg: ['e1', 'e2', 'e3'] } as Predicate, weight: 2 },
        { p: { path: 'size', op: 'field-at-least', arg: 3 } as Predicate, weight: 1 },
      ];
      const brute = w.agents
        .filter((a) => within(a, root) && (k.value(a, 'lvl', t) as number) >= (must[0]!.arg as number))
        .map((a) => ({
          id: a,
          score: (['e1', 'e2', 'e3'].includes(k.value(a, 'kinda', t) as string) ? 2 : 0) + ((k.value(a, 'size', t) as number) >= 3 ? 1 : 0),
        }))
        .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
      const all = k.query({ find: 'syn:agent', scope: { under: root }, at: t, must, prefer, limit: 'all' });
      expect(all.status).toBe('ok');
      if (all.status !== 'ok') continue;
      expect(all.items).toEqual(brute);
      if (brute.length > 0) nonEmpty++;
      const n = 1 + rng.int(4);
      const top = k.query({ find: 'syn:agent', scope: { under: root }, at: t, must, prefer, limit: n });
      expect(top.status === 'ok' && top.items).toEqual(brute.slice(0, n));
    }
    expect(nonEmpty).toBeGreaterThan(3);
  });
});

describe('I-7 coupled draws', () => {
  test("changing one value's weight changes a result only if that value was or becomes the winner", () => {
    const k = synKernel('I-7');
    const nodes = Array.from({ length: 300 }, (_, n) => k.root(`a${n}`, 'syn:agent'));
    const before = nodes.map((n) => k.value(n, 'kinda') as string);
    const rng = makeRng('I-7');
    const boosted = rng.pick(['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
    k.contribute({ source: { layer: 'authored', origin: 'boost' }, target: { kind: 'syn:agent', slot: 'kinda' }, mode: 'weight', form: { f: 'table', weights: { [boosted]: 5 } } });
    let changed = 0;
    nodes.forEach((n, idx) => {
      const after = k.value(n, 'kinda') as string;
      if (after !== before[idx]) {
        expect(after).toBe(boosted);
        changed++;
      }
    });
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(300);
  });
});

describe('I-9 one active belief; I-11 stable identity', () => {
  test('I-9: whatever is set, at most one belief is active per question', () => {
    const k = synKernel('I-9');
    const people = Array.from({ length: 4 }, (_, n) => k.root(`p${n}`, 'syn:agent'));
    const rng = makeRng('I-9');
    for (let n = 0; n < 200; n++) {
      k.beliefs.set({
        believer: rng.pick(people), subject: rng.pick(people), path: rng.pick(['kinda', 'lvl']), value: rng.pick(['a', 'b', 'c']),
        confidence: (1 + rng.int(8)) / 8, evidence: [rng.pick([cause, H(s('e2')), H(s('e3'))])], formed: n, refreshed: n,
        source: { by: 'inferred', rule: { name: 'r', version: 1 }, from: [] }, memorable: rng.int(2) === 0,
        ...(rng.int(3) === 0 ? { at: rng.int(3) } : {}),
      });
    }
    const keys = new Set<string>();
    for (const e of k.beliefs.entries().filter((x) => x.active)) {
      const key = `${e.belief.believer}|${e.belief.subject}|${e.belief.path}|${e.belief.at ?? ''}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
    expect(keys.size).toBeGreaterThan(5);
  });

  test('I-11: moving a node changes its edges, never its Id or pins', () => {
    const w = scriptWorld('I-11', 200);
    const a = w.agents[3]!;
    const pinsBefore = w.k.store.pinsOn(a, 'kinda').map((p) => p.id);
    const e = w.k.store.edgesFrom(a)[0];
    if (e) w.k.endEdge(e.id, 5000);
    w.k.addEdge({ type: 'core:located-in', from: a, to: w.sites[1]!, cause, valid: { from: 5000 } });
    expect(w.k.store.header(a)!.id).toBe(a);
    expect(w.k.store.pinsOn(a, 'kinda').map((p) => p.id)).toEqual(pinsBefore);
  });
});

describe('I-10 bounded work; I-15 partition independence', () => {
  /** Two worlds fed the same timestamped external operations and demand history, ticked in different ways. */
  function partitioned(name: string, partition: (k: Kernel, end: number) => void) {
    const k = synKernel(name);
    const w = startWorld(k);
    for (let n = 0; n < 6; n++) w.agents.push(k.root(`agent${n}`, 'syn:agent'));
    k.evolution.register(moodProcess(() => w.agents));
    k.evolution.register({
      id: 'fine', tier: 3, period: 1,
      run: (_ctx, kk) => [{ op: 'pin', node: w.agents[1 + (kk % 6)]!, slot: `mood@w${kk}`, value: 't1' }],
    });
    const epoch = k.epoch;
    for (let n = 0; n < 10; n++) {
      k.submit({ epoch, stamp: 250 + n * 410, op: { op: 'reading', node: w.weather, slot: 'wx', value: n % 3 === 0 ? 'clear' : n % 3 === 1 ? 'rain' : 'fog' } });
    }
    // The demand history is an input: a frame opens at 1800 and closes at 5400.
    k.now = 1800;
    const f = k.frames.open({ actor: w.v, level: 'situation', origin: H(s('o')), weight: 1, focus: { nodes: [w.agents[1]!], tier: 3 }, cause });
    partition(k, 5400);
    k.now = 5400;
    k.frames.setStatus(f.id, 'satisfied', cause);
    partition(k, 7200);
    return k;
  }
  const histories = (k: Kernel) =>
    JSON.stringify([
      k.store.allPins().map((p) => [p.node, p.slot, p.value, p.valid]).sort(),
      k.evolution.snapshotStates(),
      k.frames.demandHistory(),
    ]);

  test('I-15: the same timestamped external operations and demand history give the same process history however ticks fall', () => {
    const rng = makeRng('partition');
    const whole = partitioned('I-15', (k, end) => {
      k.tick({ to: end });
    });
    const stepped = partitioned('I-15', (k, end) => {
      let t = k.evolution.cursor < 0 ? 0 : (k.evolution.cursor + 1) * 600;
      while (t < end) {
        t = Math.min(end, t + 100 + rng.int(1400));
        k.tick({ to: t });
      }
    });
    expect(histories(stepped)).toBe(histories(whole));
    expect(whole.store.allPins().length).toBeGreaterThan(10);
    const fine = whole.store.allPins().filter((p) => p.slot.startsWith('mood@w') && p.value === 't1');
    expect(fine.length).toBeGreaterThan(0);
  });

  test('I-10: tiny budgets only slow things down: the work resumes deterministically and ends in the same state', () => {
    const budgeted = partitioned('I-15', (k, end) => {
      let guard = 0;
      let r = k.tick({ to: end, budget: 2 });
      while (!r.done && guard++ < 5000) r = k.tick({ to: end, budget: 2 });
      expect(r.done).toBe(true);
    });
    const whole = partitioned('I-15', (k, end) => {
      k.tick({ to: end });
    });
    expect(histories(budgeted)).toBe(histories(whole));
  });
});

describe('I-14 acyclic frames', () => {
  test('whatever links are attempted, the frame graph stays a DAG', () => {
    const k = synKernel('I-14');
    const a = k.root('a', 'syn:agent');
    const rng = makeRng('I-14');
    const ids: Id[] = [];
    for (let n = 0; n < 24; n++) ids.push(k.frames.open({ actor: a, level: 'concern', origin: H(s('o'), i(n)), weight: 0.5, cause }).id);
    let refused = 0;
    let accepted = 0;
    for (let n = 0; n < 300; n++) {
      const child = rng.pick(ids);
      const parent = rng.pick(ids);
      try {
        k.frames.addParent(child, { frame: parent, weight: (1 + rng.int(8)) / 8 }, cause);
        accepted++;
      } catch {
        refused++;
      }
    }
    expect(accepted).toBeGreaterThan(10);
    expect(refused).toBeGreaterThan(10);
    for (const f of k.frames.all()) for (const p of f.parents) expect(k.frames.isAncestorOrSelf(f.id, p.frame)).toBe(false);
    for (const f of k.frames.all()) expect(Number.isFinite(k.frames.pull(f.id))).toBe(true);
  });
});
