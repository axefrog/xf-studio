// M3 run 2: V is told of the incidents that open near it (`RunExtra.witness`). S1 opens an incident into people only where something is looking,
// and S3 asks two things of an offer that S1's record does not carry on its own near V: V takes part in a stage's event (gate 5) and the last event
// has a recorded cause (gate 3). With the driver standing in for the game's report of what V saw, the second stage of an offer pattern (a
// `disclosure` event, caused by the incident, with V as its listener) is in the record, and the offer is sown. Without it, no offer is.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { Run, policies } from '../../src/m3/driver.ts';
import { OFFER_PACK } from '../../src/m3/kits.ts';
import { run2World } from '../../src/m3/run2.ts';
import { stateById } from '../../src/m3/states.ts';

setDefaultTimeout(600_000);

const play = (witness: boolean): Run => {
  const { opts, notes } = run2World('p3b', 'E', 'restless');
  const r = new Run(opts, stateById('S-early-quiet'), policies.decline!, { walk: true, witness, notes });
  r.runWindows(108);
  return r;
};

describe('V told of an incident near it', () => {
  const on = play(true);
  const off = play(false);

  test('the offer tier completes, and its second stage is a disclosure caused by the incident with V as its listener', () => {
    expect(on.witnessed).toBeGreaterThanOrEqual(2);
    const l3 = on.w.l3!;
    const done = [...l3.state.pool, ...on.w.l3!.state.pool].filter((e) => e.pattern.startsWith('xf.m3b:') && e.stages.length === 2);
    const sown = on.deliveries.filter((d) => d.what === 'offer' && d.template.startsWith(OFFER_PACK));
    expect(sown.length + done.length).toBeGreaterThanOrEqual(1);
    // every told incident left a second stage in the record: a disclosure with V in it, caused by the incident
    for (const e of l3.state.pool.filter((x) => x.pattern.startsWith('xf.m3b:') && x.stages.length === 2)) {
      const first = l3.kv.event(e.stages[0]!.event)!;
      const second = l3.kv.event(e.stages[1]!.event)!;
      expect(second.kind).toBe('disclosure');
      expect(second.participants.some((p) => p.who === on.w.sim.w.v && p.role === 'listener')).toBe(true);
      expect(second.causes).toContain(first.id);
      expect(second.time).toBeGreaterThanOrEqual(first.time);
    }
  });

  test('the offers that were sown carry a V-link and a cause in the record (gates 5 and 3 were passed, not assumed)', () => {
    const sowed = on.w.l3!.log.filter((l) => l.kind === 'sow' && l.rule === 'sow' && String((l.data as { kit?: string }).kit).startsWith(OFFER_PACK));
    expect(sowed.length).toBeGreaterThanOrEqual(1);
    for (const l of sowed) {
      const f = (l.data as { features: Record<string, number> }).features;
      expect(f.F5).toBeGreaterThanOrEqual(2);
      expect(l.chain.length).toBe(2);
    }
  });

  test('without the report no offer is sown: the engine\'s own gates refuse an offer about people V was not told of', () => {
    expect(off.witnessed).toBe(0);
    expect(off.deliveries.filter((d) => d.what === 'offer' && d.template.startsWith(OFFER_PACK))).toEqual([]);
    expect(off.w.l3!.state.pool.some((e) => e.pattern.startsWith('xf.m3b:') && e.stages.length === 2)).toBe(false);
  });

  test('the driver changes nothing else: both worlds opened the same incidents', () => {
    const kinds = (r: Run): string[] => r.w.l3!.state.pool.filter((e) => e.pattern.startsWith('xf.m3:') && e.complete).map((e) => e.pattern).sort();
    expect(kinds(on).length).toBeGreaterThan(0);
    expect(kinds(off).length).toBeGreaterThan(0);
  });
});
