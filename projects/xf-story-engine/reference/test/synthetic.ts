// A small synthetic schema and a deterministic script of mixed operations. The invariant tests run
// property checks over the worlds it builds, and the digest test hashes every result from one fixed run
// (resolved values, queries, relevance, dilemmas, belief outcomes, summary items and the saved records
// themselves): the cross-implementation check for a later native core.

import { hrec } from '../src/canon.ts';
import { H, f as hf, id as hid, i as hi, rand, s as hs } from '../src/id.ts';
import type { Kernel } from '../src/kernel.ts';
import type { ProcessDef } from '../src/evolution.ts';
import type { GamePort } from '../src/persistence.ts';
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

/**
 * A tier-1 process that, every third window, hands the kernel an event, a weight contribution and an
 * edge as plain-data operations, so outstanding batches of every shape sit in the saved process state.
 */
export function makerProcess(world: () => { agents: Id[]; sites: Id[] }): ProcessDef {
  return {
    id: 'maker', tier: 1, period: 3,
    run(ctx, k) {
      const { agents, sites } = world();
      if (agents.length === 0 || sites.length === 0) return [];
      const who = agents[Math.floor(ctx.rand(hs('who')) * agents.length)]!;
      const site = sites[Math.floor(ctx.rand(hs('site')) * sites.length)]!;
      const boosted = E8[Math.floor(ctx.rand(hs('boost')) * E8.length)]!;
      return [
        { op: 'mint-event', spec: { name: `made${k}`, time: k * 600, kind: 'arrival', place: site, participants: [{ who, role: 'actor' }] } },
        { op: 'contribute', target: { kind: 'syn:agent', slot: 'kinda' }, mode: 'weight', form: { f: 'table', weights: { [boosted]: 3 } }, valid: { from: k * 600, to: (k + 3) * 600 } },
        { op: 'edge', type: 'core:located-in', from: who, to: site, valid: { from: k * 600 } },
      ];
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

const hashOf = (x: unknown): string => H(hrec(x));

/**
 * Run `steps` mixed operations. Everything random comes from `rng`; every result worth checking goes to
 * `sink`. The script never throws on a valid kernel.
 *
 * Besides the arbitration, time and relevance operations it saves and loads (replacement loads of older
 * saves make branches, with outstanding process batches, queued operations and a game port in play),
 * sets, observes and tells beliefs with evidence, mints summaries with canon items, and has a group leader
 * decide, order and be rechecked for dilemmas. Each save's whole record, each load's persisted state and
 * every belief, item and dilemma outcome go to the sink, not only resolved values.
 */
export function runScript(w: ScriptWorld, steps: number, rng: Rng, sink: Sink): void {
  const { k } = w;
  const causes = [H(hs('cause'), hs('one')), H(hs('cause'), hs('two')), H(hs('cause'), hs('three'))];
  const pinned: Array<{ id: Id; cause: Id }> = [];
  const edges: Id[] = [];
  const frames: Id[] = [];
  const events: Id[] = [];
  const crewFrames: Id[] = [];
  const saves: string[] = [];
  // Roots to re-register after a load: a root that nothing retains is not in the loaded state.
  const roots: Array<{ name: string; kind: string }> = [{ name: 'city', kind: 'syn:site' }, { name: 'v', kind: 'syn:agent' }];
  let nextAgent = w.agents.length;
  let nextSite = w.sites.length;
  let nextPlace = 0;
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
  const WEATHER = ['clear', 'rain', 'fog'];

  const drain = (): void => {
    for (const d of k.frames.drainDilemmas()) sink('dilemma', d.actor, d.frameA, d.frameB, d.target, d.effect, d.severity);
    for (const r of k.dispatcher.drain()) sink('relevance', r.actor, r.frame, r.type, r.r);
  };
  const prune = <T>(list: T[], keep: (x: T) => boolean): void => {
    for (let n = list.length - 1; n >= 0; n--) if (!keep(list[n]!)) list.splice(n, 1);
  };
  /** After a load: put back the roots nothing retained, rewind the clock, and drop what the branch no longer has. */
  const restore = (): void => {
    for (const r of roots) k.root(r.name, r.kind);
    k.mirrored('weather/city', 'syn:weather');
    clock = k.now;
    prune(pinned, (p) => k.store.pin(p.id) !== undefined);
    prune(edges, (e) => k.store.edges.has(e));
    prune(frames, (f) => k.frames.frame(f) !== undefined);
    prune(crewFrames, (f) => k.frames.frame(f) !== undefined);
    prune(events, (e) => k.store.header(e) !== undefined);
  };

  for (let step = 0; step < steps; step++) {
    const roll = rng.int(112);
    if (roll < 10) {
      const name = `agent${nextAgent++}`;
      const a = k.root(name, 'syn:agent');
      roots.push({ name, kind: 'syn:agent' });
      w.agents.push(a);
      const e = k.addEdge({ type: 'core:located-in', from: a, to: rng.pick(w.sites), cause: rng.pick(causes), valid: { from: clock } });
      edges.push(e.id);
    } else if (roll < 15) {
      const name = `site${nextSite++}`;
      const site = k.root(name, 'syn:site');
      roots.push({ name, kind: 'syn:site' });
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
      const wxv = rng.pick(WEATHER);
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
      if (rng.int(3) === 0) {
        // An external reading stamped in the window that is about to end: applied at the next boundary.
        const queued = k.submit({ epoch: k.epoch, stamp: clock - rng.int(500), op: { op: 'reading', node: w.weather, slot: 'wx', value: rng.pick(WEATHER) } });
        sink('submit', queued.accepted ? 'accepted' : 'refused');
      }
      const r = k.tick({ to: clock });
      sink('tick', r.boundaries, r.runs, r.done ? 'done' : 'pending');
    } else if (roll < 88) {
      const who = rng.pick(w.agents);
      const place = rng.pick(w.sites);
      const e = k.events.mintEvent({
        creator: who, cause: causes[1]!, name: `ev${step}`, time: clock, kind: 'sale', place,
        participants: [{ who, role: 'actor' }], witnesses: [rng.pick(w.agents)],
      });
      events.push(e);
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
      drain();
    } else if (roll < 96) {
      if (edges.length > 0) {
        const id = rng.pick(edges);
        const e = k.store.edges.get(id);
        if (e && e.valid.to === undefined) k.endEdge(id, clock);
      }
    } else if (roll < 98) {
      const key = `s${step}`;
      const rec = k.persistence.save(key);
      saves.push(key);
      sink('save', key, rec.parent ?? '-', rec.ops.length, rec.snapshot ? 'snapshot' : 'ops', hashOf(rec));
    } else if (roll < 100) {
      k.retention.scheduleSweep();
      k.settle();
      const node = rng.pick(w.agents);
      sink('after-sweep', node, String(k.value(node, 'kinda')), String(k.value(node, 'lvl')));
    } else if (roll < 104) {
      // Beliefs: observing, setting with evidence, telling (which passes the evidence on) and knowing.
      const which = rng.int(5);
      const who = rng.pick(w.agents);
      const other = rng.pick(w.agents);
      if (which === 0) {
        if (events.length > 0) {
          const e = rng.pick(events);
          sink('observe', who, e, k.beliefs.observe(who, e).join(','));
        }
      } else if (which === 1) {
        const sl = rng.pick(['kinda', 'lvl']);
        const evidence = events.length > 0 ? [rng.pick(events)] : [];
        const outcome = k.beliefs.set({
          believer: who, subject: other, path: sl, value: randValue(sl)!, confidence: (1 + rng.int(8)) / 8, evidence,
          source: { by: 'inferred', rule: { name: 'guess', version: 1 }, from: evidence }, formed: k.now, refreshed: k.now, memorable: rng.int(2) === 0,
        });
        sink('belief', who, other, sl, outcome);
      } else if (which === 2 || which === 3) {
        // The teller is given something to tell (with the evidence of an event) if it holds nothing.
        if (k.beliefs.activeOf(who).length === 0) {
          const evidence = events.length > 0 ? [rng.pick(events)] : [];
          k.beliefs.set({
            believer: who, subject: other, path: 'kinda', value: rng.pick(E8), confidence: (1 + rng.int(8)) / 8, evidence,
            source: { by: 'inferred', rule: { name: 'guess', version: 1 }, from: evidence }, formed: k.now, refreshed: k.now, memorable: true,
          });
        }
        const b = rng.pick(k.beliefs.activeOf(who));
        const outcome = k.beliefs.tell(who, other, b.id);
        const got = k.beliefs.get(other, b.subject, b.path, b.at);
        sink('tell', who, other, outcome, got ? got.evidence.join(',') : undefined, got?.confidence);
      } else {
        const known = k.beliefs.knows(who, other, rng.pick(['kinda', 'lvl', 'member-of']), clock);
        sink('knows', who, other, known.k, known.k === 'belief' ? String(known.belief.value) : undefined);
      }
    } else if (roll < 106) {
      // A summary of events over a scope, one canon item, and what a query then finds.
      const scope = rng.pick(w.sites);
      for (let n = 0; n < 2; n++) {
        const name = `plaza${nextPlace++}`;
        const pl = k.root(name, 'core:place');
        roots.push({ name, kind: 'core:place' });
        edges.push(k.addEdge({ type: 'core:located-in', from: pl, to: scope, cause: rng.pick(causes), valid: { from: 0 } }).id);
      }
      const count = 2 + rng.int(4);
      const S = k.summaries.mintSummary({
        creator: scope, cause: causes[1]!, name: `sum${step}`, kind: rng.pick(['robbery', 'sale', 'arrival']), from: clock, length: 600 + rng.int(3000), scope, count,
      });
      if (rng.int(2) === 0) {
        const item = k.summaries.makeItemCanon(S, rng.int(count), rng.pick(['observed', 'committed'] as const), causes[1]!);
        sink('canon-item', item, String(k.value(item, 'time')), String(k.value(item, 'place')));
      }
      for (let i = 0; i < count; i++) {
        const item = k.summaries.materialise(S, i);
        sink('item', item, String(k.value(item, 'time')), String(k.value(item, 'place')), String(k.value(item, 'kind')));
      }
      const out = k.query({ find: 'core:event', scope: { under: scope }, at: clock, must: [], limit: 'all' });
      sink('summary-query', out.status, ...(out.status === 'ok' ? out.items.map((i) => i.id) : [out.reason]));
    } else if (roll < 109) {
      // A crew: its leader decides (a concern, or a goal with an order), a member's own drive inherits, and the dilemmas follow.
      const pool = w.agents.slice(1);
      if (pool.length >= 3) {
        const g = k.root('crew0', 'core:group');
        if (!roots.some((r) => r.name === 'crew0')) roots.push({ name: 'crew0', kind: 'core:group' });
        const leader = pool[0]!;
        if (!k.groups.isLeader(leader, g)) k.addEdge({ type: 'core:member-of', from: leader, to: g, attrs: { role: 'leader', strength: 1 }, cause: causes[2]! });
        const member = rng.pick(pool.slice(1));
        const until = rng.int(3) === 0 ? { to: k.now + 600 * (1 + rng.int(4)) } : {};
        k.addEdge({ type: 'core:member-of', from: member, to: g, attrs: { role: 'member', strength: (1 + rng.int(8)) / 8 }, valid: { from: k.now, ...until }, cause: causes[2]! });
        const target = rng.pick(pool);
        const which = rng.int(4);
        if (which === 0) {
          const f = k.groups.decide(leader, g, {
            op: 'open',
            spec: {
              level: 'concern', origin: H(hs('crew-concern'), hi(step)), payload: { drive: rng.pick(['honour', 'family', 'money']) }, weight: (1 + rng.int(8)) / 8,
              own: { protects: [{ slot: '*', scope: { nodes: [target] } }] },
            },
          });
          crewFrames.push(f.id);
        } else if (which === 1) {
          const gf = k.groups.decide(leader, g, { op: 'open', spec: { level: 'goal', origin: H(hs('crew-goal'), hi(step)), payload: { goal: { effects: [] } }, weight: 1 } });
          crewFrames.push(gf.id);
          // Most orders land on a member who already protects the target, so the order is a dilemma.
          if (rng.int(3) !== 0) {
            k.frames.open({
              actor: member, level: 'concern', origin: H(hs('crew-guard'), hi(step)), weight: (1 + rng.int(8)) / 8,
              own: { protects: [{ slot: '*', scope: { nodes: [target] } }] }, cause: causes[2]!,
            });
          }
          k.groups.issueOrder({
            groupFrame: gf.id, member, goal: { effects: [{ on: target, effect: rng.pick(['kill', 'harm', 'help', 'take'] as const) }] }, pressure: (1 + rng.int(8)) / 8, cause: leader,
          });
        } else if (which === 2) {
          k.frames.open({
            actor: member, level: 'drive', origin: H(hs('crew-drive'), hi(step)), payload: { drive: rng.pick(['honour', 'family', 'money']) }, weight: (1 + rng.int(8)) / 8, cause: causes[2]!,
          });
        } else {
          const mine = crewFrames.filter((f) => k.frames.frame(f)?.actor === g);
          if (mine.length > 0) {
            const f = rng.pick(mine);
            const how = rng.int(3);
            if (how === 0) k.groups.decide(leader, g, { op: 'interests', frame: f, own: { protects: [{ slot: '*', scope: { nodes: [target] } }] } });
            else if (how === 1) k.groups.decide(leader, g, { op: 'weight', frame: f, weight: (1 + rng.int(8)) / 8 });
            else k.groups.decide(leader, g, { op: 'status', frame: f, status: rng.pick(['active', 'blocked', 'satisfied'] as const) });
          }
        }
        k.settle();
        drain();
        sink('crew', String(k.groups.memberships(member).length), String(k.frames.all().length));
      }
    } else if (roll < 110) {
      // A seed (the state of S2) comes and goes; one with an actor makes that actor a demand root.
      const id = H(hs('seed'), hi(rng.int(3)));
      if (k.retention.seeds.has(id) && rng.int(2) === 0) {
        k.retention.endSeed(id);
        sink('seed-end', id);
      } else {
        const pool = w.agents.slice(1);
        const rec = { id, state: { phase: rng.int(4) }, nodes: [rng.pick(w.agents)] };
        k.retention.setSeed(pool.length > 0 && rng.int(2) === 0 ? { ...rec, actor: rng.pick(pool) } : rec);
        sink('seed', id);
      }
    } else {
      // A replacement load of an earlier save (which makes a branch when later saves follow), with a queued
      // operation that the load discards, and a game port on every other load.
      if (saves.length > 0) {
        const key = rng.pick(saves);
        const stale = k.epoch;
        k.submit({ epoch: stale, stamp: clock, op: { op: 'reading', node: w.weather, slot: 'wx', value: rng.pick(WEATHER) } });
        const rec = k.persistence.chain.get(key)!;
        const weather = rng.pick(WEATHER);
        const port: GamePort | undefined = rng.int(2) === 0
          ? { now: () => rec.meta.time + 300, readMirrored: () => [{ gameKey: 'weather/city', kind: 'syn:weather', slot: 'wx', value: weather }] }
          : undefined;
        const report = k.persistence.load(key, port);
        restore();
        sink('load', key, report.readOnly ? 'read-only' : 'writable', report.replayed, report.missingPacks.length, hashOf(k.persistence.currentView().toData()), k.evolution.cursor);
        const outstanding = k.evolution.snapshotStates();
        sink('outstanding', hashOf(outstanding), outstanding.reduce((n, st) => n + st.outstanding.length, 0));
        sink('stale', k.submit({ epoch: stale, stamp: clock, op: { op: 'reading', node: w.weather, slot: 'wx', value: 'clear' } }).accepted ? 'accepted' : 'refused');
        k.settle();
        drain();
      }
    }
  }
}

export interface DigestRun {
  digest: Id;
  entries: number;
  /** How many entries each kind of operation contributed. */
  labels: Map<string, number>;
  /** The most outstanding process batches a load brought back. */
  maxBatchesAfterLoad: number;
}

export function digestOf(w: ScriptWorld, steps: number, scriptName: string): DigestRun {
  let dig: Id = H(hs('digest'), hs(scriptName));
  let entries = 0;
  const labels = new Map<string, number>();
  let maxBatchesAfterLoad = 0;
  const sink: Sink = (label, ...parts) => {
    entries++;
    labels.set(label, (labels.get(label) ?? 0) + 1);
    if (label === 'outstanding') maxBatchesAfterLoad = Math.max(maxBatchesAfterLoad, Number(parts[1]));
    const args = [hid(dig), hs(label)];
    for (const p of parts) {
      if (typeof p === 'number') args.push(hf(p));
      else args.push(hs(p ?? '\u0000'));
    }
    dig = H(...args);
  };
  runScript(w, steps, makeRng(scriptName), sink);
  // The whole chain of saves as it ended: every record, in key order, with its parent.
  for (const rec of [...w.k.persistence.records()].sort((a, b) => (a.saveKey < b.saveKey ? -1 : 1))) sink('record', rec.saveKey, hashOf(rec));
  return { digest: dig, entries, labels, maxBatchesAfterLoad };
}

export type { SlotPath };
