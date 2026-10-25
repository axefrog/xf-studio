// Phase 2 of M3: the authored seed R2 fitted on story states with sowing off and with sowing on gives the same fit report, and
// plays to the same end (D23 S23-S2-10). The default suite runs two states over a short span; `S1_FULL=1` runs all of them.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { defaultData as l3Default } from '../../src/procedural/data.ts';
import { Run, policies } from '../../src/m3/driver.ts';
import { fitKey, fitOfR2, semanticOfR2 } from '../../src/m3/fit.ts';
import { hookPack, hookPatterns } from '../../src/m3/hooks.ts';
import { R2_ID, r2Pack } from '../../src/m3/r2.ts';
import { STATES, stateById } from '../../src/m3/states.ts';
import { recordOf, transcript } from '../../src/m3/transcript.ts';
import { randomWithinGates } from '../../src/m3/arms.ts';

setDefaultTimeout(300_000);

type Arm = 'absent' | 'attached-off' | 'on';
const FULL = process.env.S1_FULL === '1';
const ids = FULL ? STATES.map((s) => s.id) : ['S-early-quiet', 'S-mid-squeezed'];

function arm(which: Arm, state: string, policy = 'decline'): Run {
  const opts = which === 'absent' ? { layer3: false } : { layer3: true, tempo: which === 'on' ? ('restless' as const) : ('off' as const), patterns: hookPatterns() };
  return new Run({ name: `fit-${state}`, packs: [r2Pack(), hookPack()], ...opts } as never, stateById(state), policies[policy]!);
}

describe('R2 fitted with sowing off and on', () => {
  for (const id of ids) {
    test(`${id}: the same fit report, and the same play, with layer 3 absent, attached with tempo off, and sowing on`, () => {
      const runs = (['absent', 'attached-off', 'on'] as Arm[]).map((a) => arm(a, id));
      for (const r of runs) r.runWindows(2);
      const fits = runs.map((r) => fitOfR2(r));
      const keys = fits.map((f) => fitKey(f));
      expect(keys[1]).toEqual(keys[0]);
      expect(keys[2]).toEqual(keys[0]);
      // the verdict is not trivially the same everywhere: it follows the state
      expect(['fits', 'waits', 'no-fit']).toContain(keys[0]!.verdict);
      // the layer 3 world terms are the one thing that differs by construction, and only when layer 3 is attached
      expect(fits[0]!.fit).toBeUndefined();
      expect(fits[2]!.fit?.policy).toBe('world');
      // layer 3 holds the first delivery for its pacing (SF3-36), so the play is read after the hold has passed
      for (const r of runs) r.runWindows(18);
      const sem = runs.map((r) => semanticOfR2(r));
      expect(sem[1]).toEqual(sem[0]);
      expect(sem[2]).toEqual(sem[0]);
    });
  }

  test('the fit report follows the story state (it is not the same report for every state)', () => {
    const early = fitKey(fitOfR2(arm('absent', 'S-early-quiet')));
    const prologue = arm('absent', 'S-prologue');
    prologue.runWindows(2);
    const waiting = fitKey(fitOfR2(prologue));
    const past = arm('absent', 'S-past-ponr');
    past.runWindows(2);
    const closed = fitKey(fitOfR2(past));
    expect(waiting.verdict).not.toBe('fits');
    expect(closed.verdict).toBe('no-fit');
    expect(closed.windows).not.toEqual(early.windows);
  });

  test('the random-within-gates setting changes nothing about the authored seed either', () => {
    const base = arm('on', 'S-early-quiet');
    const rnd = new Run({ name: 'fit-S-early-quiet', layer3: true, tempo: 'restless', packs: [r2Pack(), hookPack()], patterns: hookPatterns(), l3Data: randomWithinGates(l3Default()) }, stateById('S-early-quiet'), policies.decline!);
    base.runWindows(20);
    rnd.runWindows(20);
    expect(semanticOfR2(rnd)).toEqual(semanticOfR2(base));
  });
});

describe('the run driver is deterministic and its outputs are clean', () => {
  test('the same run twice gives the same record and the same transcript', () => {
    const a = arm('on', 'S-mid-squeezed');
    const b = arm('on', 'S-mid-squeezed');
    a.runWindows(16);
    b.runWindows(16);
    expect(recordOf(a).hash).toBe(recordOf(b).hash);
    expect(transcript(a)).toBe(transcript(b));
    expect(recordOf(a).deliveries.length).toBeGreaterThan(0);
  });

  test('the transcript header names the state and the street', () => {
    const r = arm('absent', 'S-mid-squeezed', 'accept-first');
    r.runWindows(10);
    const t = transcript(r);
    expect(t).toContain('story state: S-mid-squeezed');
    expect(t).toContain('ledger.m0');
    expect(t).toContain('[authored offer ask]');
    expect(r.instancesOf(R2_ID)).toHaveLength(1);
  });
});
