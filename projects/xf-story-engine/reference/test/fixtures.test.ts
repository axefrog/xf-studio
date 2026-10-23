// The acceptance fixtures of spec 16 are split across the test files by subject, each test named by its
// ID ("F-7: ...", "C-b: ..."). This file is the index: it fails if any fixture loses its test, and it
// states where each one lives. A full `bun test` run proves them all.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('./', import.meta.url);
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.test.ts') && f !== 'fixtures.test.ts')
  .map((f) => ({ file: f, text: readFileSync(new URL(f, dir), 'utf8') }));

const where = (id: string): string[] =>
  sources.filter((s) => new RegExp(`test\\((['"\`])${id}[:\\s]`).test(s.text)).map((s) => s.file);

const FIXTURES: Array<[string, string]> = [
  ['F-1', 'arbitration'],
  ['F-2', 'contradiction'],
  ['F-3', 'timeline of readings'],
  ['F-4', 'unary view'],
  ['F-5', 'coupling'],
  ['F-6', 'query'],
  ['F-7', 'summary'],
  ['F-8', 'cross-pressure'],
  ['F-9', 'hearsay'],
  ['F-10', 'secret affiliation'],
  ['F-11', 'leadership'],
  ['F-12', 'branching'],
  ['F-13', 'partition'],
  ['F-14', 'retained member'],
  ['F-15', 'cycle guard'],
  ['F-16', 'session independence'],
  ['C-a', 'pedestrian in the rain'],
  ['C-b', 'vendor and the collector'],
  ['C-c', 'a customer arrives'],
  ['C-d', "harm to V's friend"],
];

describe('acceptance fixtures (spec 16)', () => {
  for (const [id, what] of FIXTURES) {
    test(`${id}: ${what} has a test`, () => {
      expect(where(id).length).toBeGreaterThan(0);
    });
  }

  test('every invariant I-1 to I-15 has a test', () => {
    const text = sources.map((s) => s.text).join('\n');
    for (let n = 1; n <= 15; n++) expect(new RegExp(`I-${n}\\b`).test(text), `I-${n}`).toBe(true);
  });
});
