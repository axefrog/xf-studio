// Layer 2 over the simulation layer (S2 2.16, 2.17, S1 9.1): the `city` and `social` atoms the core builds are read through S1's registered
// reads; the others stay refused plainly; the reads wake the seeds that depend on them.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { evalPred } from '../../src/seeding/eval.ts';
import { Layer2, type Instance } from '../../src/seeding/layer2.ts';
import { ScriptPort } from '../../src/seeding/port.ts';
import { L2Registry } from '../../src/seeding/registries.ts';
import { Layer3 } from '../../src/procedural/layer3.ts';
import type { FactsTable, Finding, Pack, Pred } from '../../src/seeding/types.ts';
import { attachLayer2 } from '../../src/sim/layer2-wire.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { child, inject, quietData, seedOf } from './helpers.ts';
import { MINI_ID, MINI_PACK, miniPack } from '../s2/mini.ts';

// Bun 1.4 gives the default set in test/setup.ts to the first test file only
setDefaultTimeout(120_000);

const W = 600;
const cause = H(hs('fx'), hs('layer2'));
const FACTS: FactsTable = { q112_done: {}, x: {}, y: {}, flag: {} };

const BUILT_CITY = ['band', 'regime', 'regimeIs', 'presence', 'priceLevel', 'refuge'];
const BUILT_SOCIAL = ['label', 'bridge', 'normGap', 'tied', 'divergence'];
const UNBUILT = ['heatRank', 'tension', 'reach', 'protected', 'contract'];

function world(name: string, attach = true): { sim: Sim; l2: Layer2; cells: Id[]; person: Id } {
  const sim = Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData((d) => { d.events.offspring = [0, 0, 0, 0]; for (const r of d.regimes) r.arrival = 0; }), only: ['city.events', 'order.norms', 'order.stocks', 'order.ledger', 'group.decide'] });
  const reg = new L2Registry();
  const l2 = attach ? attachLayer2(sim, { port: new ScriptPort(), facts: FACTS, reg }) : new Layer2(sim.k, { port: new ScriptPort(), facts: FACTS, reg });
  const person = sim.k.root('npc', 'core:person');
  sim.k.addEdge({ type: 'core:located-in', from: person, to: sim.w.city, cause });
  sim.k.pin({ node: person, slot: 'age', value: 35, reason: 'authored', cause });
  return { sim, l2, cells: sim.w.districts[0]!.cellIds, person };
}

/** The call of each read of the core, with arguments that mean something in FX-3. */
function call(sim: Sim, name: string): Pred {
  const d = sim.w.districts[0]!;
  const c1 = d.cellIds[0]!;
  const person = sim.people.residentAt(c1, 0);
  const other = sim.people.residentAt(c1, 1);
  const calls: Record<string, Pred> = {
    band: { city: { band: { cell: c1 } }, is: ['quiet'] },
    regime: { city: { regime: { scope: d.id } }, is: ['none'] },
    regimeIs: { city: { regimeIs: { scope: d.id, kind: 'festival' } }, is: ['no'] },
    presence: { city: { presence: { leaf: d.id, faction: 'GA' } }, is: ['high', 'mid'] },
    priceLevel: { city: { priceLevel: { district: d.id } }, is: ['fair'] },
    refuge: { city: { refuge: { leaf: d.id } }, is: ['yes', 'poor', 'no'] },
    label: { social: { label: { audience: 'kabuki', subject: 'v', axis: 'decent' } }, is: ['unknown'] },
    bridge: { social: { bridge: { who: person } }, is: ['low', 'mid', 'high'] },
    normGap: { social: { normGap: { norm: 'fee', scope: d.id } }, is: ['aligned'] },
    tied: { social: { tied: { a: person, b: other, type: 'xf:tie' } }, is: ['yes', 'no'] },
    divergence: { social: { divergence: { believer: person, subject: other } }, is: ['none'] },
    heatRank: { city: { heatRank: { district: d.id } }, is: ['top'] },
    tension: { city: { tension: { a: person, b: other } }, is: ['high'] },
    reach: { city: { reach: { district: d.id, item: 'x' } }, is: ['yes'] },
    protected: { city: { protected: { node: person } }, is: ['yes'] },
    contract: { social: { contract: { id: 'c' } }, is: ['due'] },
  };
  return calls[name]!;
}

const laterOf = (findings: Finding[]): Finding[] => findings.filter((f) => f.code === 'later');

/** Install a pack of the mini seed with `context` as given and compile its seed: the findings of the compile. */
function compileWith(l2: Layer2, id: string, context: Pred): Finding[] {
  const pack = miniPack({ id: `${MINI_PACK}-${id}` }, { id: `${MINI_ID}-${id}`, context: context as never });
  expect(l2.installPack(pack).filter((f) => f.level === 'error')).toEqual([]);
  const out = l2.compile(pack.id, pack.seeds[0]!);
  return out.findings;
}

describe('the city and social atoms over the simulation layer', () => {
  test('without the simulation layer every city and social read is a later capability, refused plainly', () => {
    const { sim, l2 } = world('L2-a', false);
    for (const name of [...BUILT_CITY, ...BUILT_SOCIAL, ...UNBUILT]) {
      const found = laterOf(compileWith(l2, name, call(sim, name)));
      expect(found.length, name).toBeGreaterThan(0);
      expect(found[0]!.message).toContain('not supported yet');
    }
  });

  test('with it attached the reads the core builds compile, and the others are refused plainly', () => {
    const { sim, l2 } = world('L2-b');
    for (const name of [...BUILT_CITY, ...BUILT_SOCIAL]) expect(laterOf(compileWith(l2, name, call(sim, name))), name).toEqual([]);
    for (const name of UNBUILT) {
      const found = laterOf(compileWith(l2, name, call(sim, name)));
      expect(found.length, name).toBe(1);
      expect(found[0]!.message).toContain('not supported yet');
      expect(found[0]!.message).toContain(name);
    }
    // a malformed read says what is wrong
    const bad = compileWith(l2, 'bad', { city: { band: { place: 'x' } }, is: ['hot'] } as never);
    expect(bad.some((f) => f.message.includes('takes cell'))).toBe(true);
    const two = compileWith(l2, 'two', { city: { band: { cell: 'x' }, regime: { scope: 'y' } }, is: ['hot'] } as never);
    expect(two.some((f) => f.message.includes('exactly one read'))).toBe(true);
    const wrong = compileWith(l2, 'wrong', { city: { label: { audience: 'a', subject: 'b', axis: 'c' } }, is: ['hot'] } as never);
    expect(wrong.some((f) => f.message.includes('is not a city read'))).toBe(true);
  });

  test('a read answers maybe until the simulation layer has a reading, then the answer, and compares to the set', () => {
    const { sim, l2 } = world('L2-c');
    const band = call(sim, 'band');
    const price = call(sim, 'priceLevel');
    expect(evalPred(l2, { t: sim.k.now }, band)).toBe('maybe');
    expect(evalPred(l2, { t: sim.k.now }, price)).toBe('maybe');
    sim.advance(3);
    expect(evalPred(l2, { t: sim.k.now }, band)).toBe('yes');
    expect(evalPred(l2, { t: sim.k.now }, { city: (band as unknown as { city: never }).city, is: ['hot'] })).toBe('no');
    expect(evalPred(l2, { t: sim.k.now }, price)).toBe('yes');
    // the reads S1 does not build answer maybe
    for (const name of UNBUILT) expect(evalPred(l2, { t: sim.k.now }, call(sim, name)), name).toBe('maybe');
    // Kleene logic over them
    expect(evalPred(l2, { t: sim.k.now }, { all: [band, call(sim, 'heatRank')] } as never)).toBe('maybe');
    expect(evalPred(l2, { t: sim.k.now }, { any: [band, call(sim, 'heatRank')] } as never)).toBe('yes');
  });

  test('a seed whose window opens on a band is waked by the band pin', () => {
    const { sim, l2, cells } = world('L2-d');
    const c1 = cells[0]!;
    const opens: Pred = { city: { band: { cell: c1 } }, is: ['elevated', 'hot', 'flashpoint'] };
    const closes: Pred = { city: { regimeIs: { scope: sim.w.districts[0]!.id, kind: 'lockdown' } }, is: ['yes'] };
    const pack: Pack = miniPack({}, { windows: [{ id: 'w', opens: opens as never, closes: closes as never, onClose: 'withdraw' }] });
    expect(l2.installPack(pack)).toEqual([]);
    sim.advance(3);
    const r = l2.sow(pack.id, MINI_ID);
    expect(r.ok, JSON.stringify(r.findings)).toBe(true);
    const inst = l2.instance(r.instance!)! as Instance;
    sim.k.settle();
    sim.k.dispatcher.drain();
    const before = inst.st.state;
    expect(sim.reads.eval('band', [c1])).toBe('quiet');
    // the watch frame holds the dependency the read declared
    const watch = sim.k.frames.frame(inst.st.frames.watch!)!;
    expect(JSON.stringify(watch.own.reactsTo)).toContain('band');
    // an event of size 2 in c1 makes the cell elevated from the next window
    const w = sim.windowNow() + 1;
    inject(sim, child(sim, 'band-up', 0, w, 'accident', 2, c1));
    sim.advance(3);
    sim.k.dispatcher.drain();
    expect(sim.reads.eval('band', [c1])).not.toBe('quiet');
    expect(inst.st.state, `before: ${before}`).not.toBe(before);
  });

  test('the lint: the believer of a divergence is a character of the seed, never a root actor', () => {
    const { sim, l2 } = world('L2-e');
    const person = sim.people.residentAt(sim.w.districts[0]!.cellIds[0]!, 0);
    const mk = (believer: string, id: string): Finding[] => compileWith(l2, id, { social: { divergence: { believer, subject: person } }, is: ['none'] } as never);
    expect(mk('npc', 'ok').filter((f) => f.level === 'error')).toEqual([]);
    expect(mk('ghost', 'ghost').some((f) => f.code === 'L-01' && f.message.includes('ghost'))).toBe(true);
    expect(mk('director', 'director').some((f) => f.code === 'L-01' || f.code === 'L-56')).toBe(true);
  });

  test('the spine of S1 is the set of characters the director never casts', () => {
    const { sim, l2 } = world('L2-f');
    const node = sim.k.root('spine-test', 'core:person');
    expect(l2.isSpine(node)).toBe(false);
    sim.spine.add(node);
    expect(l2.isSpine(node)).toBe(true);
    expect(l2.worldRegistry).toBe(sim.reads);
    const l3 = new Layer3(l2, { registry: sim.w.kinds });
    expect(l2.isSpine(node), 'S3-04-registry semantic: event-kind-only attachment preserves S1 spine authority').toBe(true);
    expect(l3.kv.isSpine(node)).toBe(true);
    expect(l2.worldRegistry).toBe(sim.reads);
  });
});

void ReplayPort;
