// The acceptance fixtures of S2 section 14, indexed (as test/fixtures.test.ts indexes the kernel's). Each core fixture
// has a test named for it; each fixture that needs a later capability (S2 section 0.3) says which, and the capability's
// refusal is tested in lint.test.ts ("later capabilities are refused plainly").

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('./', import.meta.url);
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.test.ts') && f !== 'fixtures.test.ts')
  .map((f) => ({ file: f, text: readFileSync(new URL(f, dir), 'utf8') }));

const has = (id: string): boolean => sources.some((s) => s.text.includes(`${id}:`) || s.text.includes(`${id} `) || s.text.includes(`${id}'`) || s.text.includes(`${id}-`) || s.text.includes(`${id},`) || s.text.includes(`${id})`));

const CORE = [
  'SF-1', 'SF-2', 'SF-3', 'SF-4', 'SF-5', 'SF-6', 'SF-7', 'SF-8', 'SF-9', 'SF-10', 'SF-11', 'SF-12', 'SF-13', 'SF-14', 'SF-15', 'SF-16',
  'SF-18', 'SF-19', 'SF-20', 'SF-21', 'SF-23', 'SF-24', 'SF-25', 'SF-27', 'SF-28', 'SF-29', 'SF-30', 'SF-31', 'SF-32', 'SF-33', 'SF-34', 'SF-35',
  'SF-36', 'SF-37', 'SF-38', 'SF-39', 'SF-41', 'SF-42', 'SF-46', 'SF-47', 'SF-51', 'SF-53', 'SF-54', 'SF-55', 'SF-56', 'SF-60', 'SF-61', 'SF-62',
  'SF-63', 'SF-64',
];

/** Fixtures that need a later capability: the capability, and the construct the core refuses. */
const LATER: Record<string, string> = {
  'SF-17': 'scale metadata (turns, parents): L-33 waits for a director that uses them',
  'SF-18': 'the clock form (the count form is tested): clocks and projections are later',
  'SF-22': 'short and full forms',
  'SF-26': 'constructed traces: staging and traces are later',
  'SF-40': 'hedged soft callbacks at run time (the lint L-62 is tested)',
  'SF-43': 're-cueing a callback from a display cue (callbacks at run time)',
  'SF-44': 'late causes: traces',
  'SF-45': 'sign re-issue: clocks',
  'SF-48': 'the tone lint block (L-77 to L-83)',
  'SF-49': 'dread guards (L-84)',
  'SF-50': 'setting checks (L-85, L-89 with clocks, L-91, L-92)',
  'SF-52': 'lines: S1 never produces an event of a refused class (S0 V4-23, with S1\'s first process)',
  'SF-57': 'the stage lint (L-118)',
  'SF-58': 'the words lints (L-119 to L-130)',
  'SF-59': 'the model lints (L-131 to L-137): language models are later',
};

describe('S2 acceptance fixtures (section 14)', () => {
  for (const id of CORE) {
    test(`${id} has a test`, () => {
      expect(has(id), id).toBe(true);
    });
  }
  test('every fixture SF-1 to SF-64 is either tested in the core or named as needing a later capability', () => {
    const missing: string[] = [];
    for (let n = 1; n <= 64; n++) {
      const id = `SF-${n}`;
      if (!CORE.includes(id) && !(id in LATER)) missing.push(id);
    }
    expect(missing).toEqual([]);
  });
  test('the later capabilities each have a refusal test', () => {
    const text = sources.map((s) => s.text).join('\n');
    for (const what of ['clocks', 'short and full forms', 'plants', 'a language-model field', 'a city read']) expect(text.includes(`['${what}'`), what).toBe(true);
  });
});
