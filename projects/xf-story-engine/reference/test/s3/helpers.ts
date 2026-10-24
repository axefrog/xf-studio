import { coreDefs, mergeDefs } from '../../src/core-schema.ts';
import { H, s } from '../../src/id.ts';
import { Kernel } from '../../src/kernel.ts';
import { Layer2 } from '../../src/seeding/layer2.ts';
import { ScriptPort } from '../../src/seeding/port.ts';
import type { Pack, Seed } from '../../src/seeding/types.ts';
import { Layer3, type Layer3Options } from '../../src/procedural/layer3.ts';
import type { EventView, Layer3Data, SiftPattern } from '../../src/procedural/types.ts';
import { s2Defs, FACTS } from '../s2/world.ts';

export const eventKinds = ['insult', 'apology', 'assault', 'order-given', 'act', 'order-withdrawn', 'meta:story'];
export const registry = {
  eventKind: (name: string) =>
    eventKinds.includes(name) ? { tags: name === 'act' ? ['act'] : [], producers: ['port'] } : undefined,
  names: () => eventKinds.slice(),
};
export function kit(over: Partial<Seed> = {}): Seed {
  return {
    id: 'xf.fixture:rumour-kit',
    version: 1,
    level: 'glance',
    turns: [],
    maturity: 'ready',
    purpose: { tags: ['report'], sentence: 'An account of a completed incident.' },
    context: 'yes',
    intent: { prohibitions: [], tone: ['grounded'] },
    roles: {
      subject: { kind: 'core:person', onUnfilled: ['wait'] },
      other: { kind: 'core:person', onUnfilled: ['wait'] },
    },
    windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }],
    start: ['tell'],
    beats: { tell: { kind: 'texture', play: 'pack:rumour' } },
    end: 'beat(tell) in {done}',
    unattended: { after: { clock: 'game', s: 600 }, outcome: [] },
    sow: 'no',
    sowable: { serves: ['rumour', 'recap', 'sighting'], firstClass: 0 },
    ...over,
  };
}
export function pack(seeds: Seed[] = [kit()]): Pack {
  return {
    id: 'xf.fixture',
    version: 1,
    seeds,
    fragments: [
      {
        id: 'rumour',
        level: 'phrase',
        roles: ['subject', 'other'],
        salience: 'background',
        forms: { standard: 'pack:words' },
        channels: ['trace'],
      },
    ],
    texts: [
      { id: 'words', text: 'The incident left a mark.', origin: 'authored' },
      { id: 'closing', text: 'The matter ended.', origin: 'authored' },
    ],
  };
}
export function pattern(over: Partial<SiftPattern> = {}): SiftPattern {
  return {
    id: 'xf.fixture:grudge',
    version: 1,
    roles: { '?a': { kind: 'core:person' }, '?b': { kind: 'core:person' } },
    stages: [
      {
        kind: 'insult',
        who: [
          { role: 'actor', as: '?a' },
          { role: 'target', as: '?b' },
        ],
      },
      {
        kind: 'assault',
        who: [
          { role: 'actor', as: '?a' },
          { role: 'target', as: '?b' },
        ],
        effects: [{ on: '?b', effect: 'harm' }],
      },
    ],
    unless: [{ between: [0, 1], clause: { kind: 'apology', who: [{ role: 'actor', as: '?a' }] } }],
    within: 600,
    once: ['?a', '?b'],
    tags: ['grudge'],
    telling: { form: 'recap', binds: { subject: '?a', other: '?b' } },
    ...over,
  };
}
export function world(
  name: string,
  opts: { data?: Layer3Data; patterns?: SiftPattern[]; seeds?: Seed[]; s3?: Partial<Layer3Options> } = {},
) {
  const k = Kernel.create({
    worldSeed: H(s('fixture'), s(name)),
    defs: mergeDefs(coreDefs(600, { extraEventKinds: eventKinds, extraParticipantRoles: ['a', 'b'] }), s2Defs()),
  });
  const port = new ScriptPort(),
    l2 = new Layer2(k, { port, facts: FACTS }),
    cause = H(s('people'));
  const city = k.root('city', 'core:place'),
    v = k.root('v', 'core:person'),
    a = k.root('mara', 'core:person'),
    b = k.root('dex', 'core:person');
  for (const n of [a, b]) {
    k.addEdge({ type: 'core:located-in', from: n, to: city, cause });
    k.pin({ node: n, slot: 'age-class', value: 'adult', reason: 'authored', cause });
  }
  const findings = l2.installPack(pack(opts.seeds));
  if (findings.some((f) => f.level === 'error')) throw new Error(JSON.stringify(findings));
  const l3 = new Layer3(l2, { registry, data: opts.data, patterns: opts.patterns ?? [pattern()], ...opts.s3 });
  if (l3.findings.length) throw new Error(JSON.stringify(l3.findings));
  k.settle();
  return { k, l2, l3, port, a, b, v, city };
}
export type World = ReturnType<typeof world>;
export function event(w: World, name: string, kind: string, time: number, extra: Partial<EventView> = {}): EventView {
  const spec = {
    creator: w.k.expandId('root:port'),
    cause: H(s('incident'), s(name)),
    name,
    time,
    kind,
    participants: [
      { who: w.a, role: 'actor' },
      { who: w.b, role: 'target' },
    ],
    effects: [],
    causes: [],
    witnesses: [],
    ...extra,
  };
  const id = w.k.events.mintEvent(spec);
  return { ...spec, id } as EventView;
}
export function complete(w: World, at = 100): void {
  const p = w.l3.sifter.patterns.get('xf.fixture:grudge')!;
  const first = event(w, 'insult' + at, 'insult', at),
    last = event(w, 'assault' + at, 'assault', at + 1, { effects: [{ on: w.b, effect: 'harm' }], causes: [first.id] });
  w.l3.sifter.onEvent(p, first);
  w.l3.sifter.onEvent(p, last);
  w.l3.flush();
}
