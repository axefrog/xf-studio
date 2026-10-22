// A small synthetic schema and a deterministic script of mixed operations. The invariant tests run
// property checks over the worlds it builds, and the digest test hashes every resolved value from one
// fixed run: the cross-implementation check for a later native core.

import { H, f as hf, id as hid, i as hi, rand, s as hs } from '../src/id.ts';
import type { Kernel } from '../src/kernel.ts';
import type { ProcessDef } from '../src/evolution.ts';
import type { Id, Layer, PinReason, Predicate, SlotPath, Value } from '../src/types.ts';
import { coreKernel, defsOf, dim, kind, slot } from './helpers.ts';
import type { SchemaDefs } from '../src/schema-types.ts';
import type { Config } from '../src/config.ts';

const E8 = ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'];
const E3 = ['t0', 't1', 't2'];

export function synDefs(): SchemaDefs {
  const base = defsOf(
    [
      dim('syn:e8', { t: 'enum', values: E8 }),
      dim('syn:e3', { t: 'enum', values: E3 }),
      dim('syn:lvl', { t: 'real', min: 0, max: 1, quantum: 1 / 16 }, { structure: 'metric' }),
      dim('syn:i20', { t: 'int', min: 0, max: 19 }, { structure: 'order' }),
      dim('syn:band', { t: 'int', min: 0, max: 4 }),
      dim('syn:pos', { t: 'vec', n: 2, quantum: 1 / 4 }, { structure: 'metric' }),
      dim('syn:cnt', { t: 'int', min: 0, max: 5 }),
      dim('syn:leaf-node', { t: 'node', kind: 'syn:leaf' }),
      dim('syn:site-ref', { t: 'ref', kind: 'syn:site', candidates: { find: 'syn:site', scope: { under: 'root:city' }, must: [], max: 6 } }),
      dim('syn:wx', { t: 'enum', values: ['clear', 'rain', 'fog'] }, { buckets: { name: 'bucket-map', version: 1, params: { map: { rain: 'wet', fog: 'wet', clear: 'dry' } } } }),
    ],
    [
      kind('syn:thing', [], { extends: ['core:thing'] }),
      kind('syn:leaf', [slot('tag', 'syn:e3'), slot('power', 'syn:lvl')], { extends: ['syn:thing'] }),
      kind('syn:site', [slot('pos', 'syn:pos', { mode: 'assigned' }), slot('heat', 'syn:lvl'), slot('crime', 'syn:e3')], { extends: ['syn:thing'], facets: ['place'] }),
      kind('syn:agent', [
        slot('pos', 'syn:pos', { mode: 'assigned' }),
        slot('kinda', 'syn:e8'),
        slot('lvl', 'syn:lvl', { conditioned: { fn: { name: 'table', version: 1, params: { table: { e0: { '0.5': 8 }, e1: { '0.25': 8 } }, default: 1 } }, inputs: ['kinda'] } }),
        slot('i', 'syn:i20'),
        slot('band', 'syn:band', {
          mode: 'derived',
          derive: { fn: { name: 'floor-div', version: 1, params: { divisor: 4 } }, inputs: ['i'], preimage: { name: 'floor-div', version: 1, params: { divisor: 4 } } },
        }),
        slot('mood', 'syn:e3', { temporal: { window: 600 } }),
        slot('leaves', 'syn:leaf-node', { card: { many: { count: 'syn:cnt' } } }),
        slot('home', 'syn:site-ref'),
        slot('size', 'syn:cnt'),
      ], { extends: ['syn:thing'], facets: ['actor'] }),
      kind('syn:weather', [slot('wx', 'syn:wx', { mode: 'mirrored' })], { extends: ['syn:thing'] }),
    ],
  );
  return base;
}

export function synKernel(name: string, config?: Partial<Config>): Kernel {
  return coreKernel(name, synDefs(), config);
}

export interface Rng {
  next(): number;
  int(n: number): number;
  pick<T>(xs: readonly T[]): T;
}

export function makeRng(name: string): Rng {
  let n = 0;
  const next = () => rand(hs('script'), hs(name), hi(n++));
  return {
    next,
    int: (m) => Math.min(m - 1, Math.floor(next() * m)),
    pick: (xs) => xs[Math.min(xs.length - 1, Math.floor(next() * xs.length))]!,
  };
}

/** A tiny tier-0 process that pins a mood for window k + 1 on some agent. */
export function moodProcess(agents: () => Id[]): ProcessDef {
  return {
    id: 'moods', tier: 0, period: 2,
    run(ctx, k) {
      const list = agents();
      if (list.length === 0) return [];
      const a = list[Math.floor(ctx.rand(hs('who')) * list.length)]!;
      const mood = E3[Math.floor(ctx.rand(hs('mood')) * 3)]!;
      return [{ op: 'pin', node: a, slot: `mood@w${k + 1}`, value: mood }];
    },
  };
}

export type Sink = (label: string, ...parts: Array<string | number | undefined>) => void;

const REASONS: PinReason[] = ['observed', 'game', 'authored', 'committed'];
const LAYERS: Layer[] = ['authored', 'seeding', 'simulation', 'procedural'];

export interface ScriptWorld {
  k: Kernel;
  agents: Id[];
  sites: Id[];
  city: Id;
  weather: Id;
  v: Id;
}

/** Build the starting world of the script. */
export function startWorld(k: Kernel): ScriptWorld {
  const city = k.root('city', 'syn:site');
  const weather = k.mirrored('weather/city', 'syn:weather');
  const v = k.root('v', 'syn:agent');
  k.frames.demandRoots.add(v);
  return { k, agents: [v], sites: [city], city, weather, v };
}

/**
 * Run `steps` mixed operations. Everything random comes from `rng`; every result worth checking goes to
 * `sink`. The script never throws on a valid kernel.
 */
export function runScript(w: ScriptWorld, steps: number, rng: Rng, sink: Sink): void {
  const { k } = w;
  const causes = [H(hs('cause'), hs('one')), H(hs('cause'), hs('two')), H(hs('cause'), hs('three'))];
  const pinned: Array<{ id: Id; cause: Id }> = [];
  const edges: Id[] = [];
  const frames: Id[] = [];
  let nextAgent = w.agents.length;
  let nextSite = w.sites.length;
  let clock = k.now;

  const randValue = (slotPath: string): Value | undefined => {
    switch (slotPath) {
      case 'kinda':
        return rng.pick(E8);
      case 'lvl':
        return rng.int(17) / 16;
      case 'i':
        return rng.int(20);
      case 'band':
        return rng.int(5);
      case 'leaves#count':
      case 'size':
        return rng.int(6);
      default:
        return undefined;
    }
  };
  const SLOTS = ['kinda', 'lvl', 'i', 'band', 'leaves#count', 'size'];

  for (let step = 0; step < steps; step++) {
    const roll = rng.int(100);
    if (roll < 10) {
      const a = k.root(`agent${nextAgent++}`, 'syn:agent');
      w.agents.push(a);
      const e = k.addEdge({ type: 'core:located-in', from: a, to: rng.pick(w.sites), cause: rng.pick(causes), valid: { from: clock } });
      edges.push(e.id);
    } else if (roll < 15) {
      const site = k.root(`site${nextSite++}`, 'syn:site');
      w.sites.push(site);
      const e = k.addEdge({ type: 'core:located-in', from: site, to: rng.pick(w.sites.slice(0, -1)), cause: rng.pick(causes), valid: { from: clock } });
      edges.push(e.id);
    } else if (roll < 35) {
      const node = rng.pick(w.agents);
      const sl = rng.pick(SLOTS);
      const value = randValue(sl)!;
      const reason = rng.pick(REASONS);
      const cause = rng.pick(causes);
      const p = k.pin({ node, slot: sl, value, reason, cause });
      if (reason === 'authored' || reason === 'committed') pinned.push({ id: p.id, cause });
      sink('pin', node, sl, String(value), reason);
    } else if (roll < 40) {
      const node = rng.pick(w.agents);
      const w4 = rng.int(6);
      const mood = rng.pick(E3);
      const p = k.pin({ node, slot: `mood@w${w4}`, value: mood, reason: 'committed', cause: causes[0]! });
      pinned.push({ id: p.id, cause: causes[0]! });
    } else if (roll < 47) {
      const which = rng.int(4);
      const layer = rng.pick(LAYERS);
      const origin = `script${step}`;
      if (which === 0) {
        k.contribute({ source: { layer, origin }, target: { kind: 'syn:agent', slot: 'kinda' }, mode: 'weight', form: { f: 'table', weights: { [rng.pick(E8)]: 2 + rng.int(6), [rng.pick(E8)]: 3 } }, strength: 1 + rng.int(2) });
      } else if (which === 1) {
        const vals = [rng.pick(E8), rng.pick(E8), rng.pick(E8)];
        k.contribute({ source: { layer, origin }, target: { slot: 'kinda', scope: { nodes: [rng.pick(w.agents)] } }, mode: 'constrain', form: { f: 'set', region: { r: 'set', values: [...new Set(vals)].sort() }, allow: rng.int(4) !== 0 } });
      } else if (which === 2) {
        k.contribute({
          source: { layer, origin }, target: { kind: 'syn:agent', slot: 'size' }, mode: 'weight',
          form: { f: 'rule', when: [{ path: 'lvl', op: 'field-at-least', arg: 0.5 }], then: { f: 'table', weights: { '3': 4, '4': 6 } } },
        });
      } else {
        k.contribute({
          source: { layer, origin }, target: { kind: 'syn:agent', slot: 'kinda' }, mode: 'weight', strength: 1,
          form: { f: 'field', base: 'pos', combine: rng.int(2) === 0 ? 'sum' : 'max', map: { name: 'boost-value', version: 1, params: { value: rng.pick(E8), gain: 3 } }, points: [{ at: [0, 0], value: 1, radius: 4, falloff: rng.pick(['linear', 'smoothstep', 'bump'] as const) }] },
        });
      }
    } else if (roll < 52) {
      if (pinned.length > 0) {
        const at = rng.int(pinned.length);
        const p = pinned[at]!;
        try {
          k.withdrawPin(p.id, p.cause);
        } catch {
          // Already gone.
        }
        pinned.splice(at, 1);
      }
    } else if (roll < 56) {
      clock += 100 + rng.int(900);
      k.now = Math.max(k.now, clock);
      const wxv = rng.pick(['clear', 'rain', 'fog']);
      k.reading(w.weather, 'wx', wxv, clock);
      if (rng.int(2) === 0) k.observeReading(w.weather, 'wx', clock, w.v);
    } else if (roll < 72) {
      const node = rng.pick(w.agents);
      const t = rng.int(6000);
      const sl = rng.pick(['kinda', 'lvl', 'i', 'band', 'mood', 'size', 'home', 'leaves#count', 'name']);
      if (sl === 'name') {
        // (agents have no name slot: an unknown slot is simply unavailable)
        sink('resolve', node, sl, k.resolve(node, sl, t).status);
        continue;
      }
      const r = k.resolve(node, sl, t);
      sink('resolve', node, `${sl}@${t}`, r.status, r.value === undefined ? undefined : String(r.value));
      if (rng.int(3) === 0 && r.value !== undefined) {
        const tr = k.trace(node, sl, t);
        if (tr.winner) sink('trace', node, sl, tr.winner.total, tr.winner.noise, tr.feasibleSize);
      }
    } else if (roll < 78) {
      const lvl = rng.int(17) / 16;
      const must: Predicate[] = [{ path: 'lvl', op: 'field-at-least', arg: lvl }];
      if (rng.int(2) === 0) must.push({ path: 'kinda', op: 'not-in', arg: [rng.pick(E8)] });
      const scope = rng.int(2) === 0 ? { under: w.city } : { under: rng.pick(w.sites) };
      const out = k.query({ find: 'syn:agent', scope, at: clock, must, limit: rng.int(3) === 0 ? 3 : 'all' });
      sink('query', out.status, ...(out.status === 'ok' ? out.items.map((i) => i.id) : [out.reason]));
    } else if (roll < 83) {
      clock += 300 + rng.int(1500);
      const r = k.tick({ to: clock });
      sink('tick', r.boundaries, r.runs, r.done ? 'done' : 'pending');
    } else if (roll < 88) {
      const who = rng.pick(w.agents);
      const place = rng.pick(w.sites);
      const e = k.events.mintEvent({
        creator: who, cause: causes[1]!, name: `ev${step}`, time: clock, kind: 'sale', place,
        participants: [{ who, role: 'actor' }], witnesses: [rng.pick(w.agents)],
      });
      if (rng.int(2) === 0) k.events.makeCanon(e, rng.pick(['observed', 'committed'] as const), causes[1]!, ['time', 'place']);
      sink('event', e, String(k.value(e, 'time')));
    } else if (roll < 93) {
      const who = rng.pick(w.agents);
      if (frames.length > 0 && rng.int(3) === 0) {
        const f = rng.pick(frames);
        k.frames.setStatus(f, rng.pick(['active', 'blocked', 'satisfied', 'abandoned'] as const), causes[2]!);
      } else {
        const f = k.frames.open({
          actor: who, level: rng.pick(['concern', 'goal', 'situation'] as const), origin: H(hs('origin'), hi(step)), weight: (1 + rng.int(8)) / 8,
          own: { wants: [{ slot: '*', kind: 'syn:site', where: [{ path: 'heat', op: 'field-at-least', arg: 0.5 }] }] },
          focus: { nodes: [rng.pick(w.sites)], tier: rng.pick([2, 3, 4] as const) }, cause: causes[2]!,
        });
        frames.push(f.id);
      }
      k.settle();
      for (const r of k.dispatcher.drain()) sink('relevance', r.actor, r.frame, r.type, r.r);
    } else if (roll < 96) {
      if (edges.length > 0) {
        const id = rng.pick(edges);
        const e = k.store.edges.get(id);
        if (e && e.valid.to === undefined) k.endEdge(id, clock);
      }
    } else if (roll < 98) {
      k.persistence.save(`s${step}`);
    } else {
      k.retention.scheduleSweep();
      k.settle();
      const node = rng.pick(w.agents);
      sink('after-sweep', node, String(k.value(node, 'kinda')), String(k.value(node, 'lvl')));
    }
  }
}

export function digestOf(w: ScriptWorld, steps: number, scriptName: string): { digest: Id; entries: number } {
  let dig: Id = H(hs('digest'), hs(scriptName));
  let entries = 0;
  const sink: Sink = (label, ...parts) => {
    entries++;
    const args = [hid(dig), hs(label)];
    for (const p of parts) {
      if (typeof p === 'number') args.push(hf(p));
      else args.push(hs(p ?? '\u0000'));
    }
    dig = H(...args);
  };
  runScript(w, steps, makeRng(scriptName), sink);
  return { digest: dig, entries };
}

export type { SlotPath };
