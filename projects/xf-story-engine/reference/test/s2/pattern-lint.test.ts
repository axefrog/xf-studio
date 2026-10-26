import { describe, expect, test } from 'bun:test';
import { lintPattern } from '../../src/seeding/pattern-lint.ts';
import { library, vocabulary } from '../s3/library.ts';
import type { Pattern } from '../../src/seeding/pattern-types.ts';

const base = (): Pattern => ({
  id: 'test:debt', version: 1, use: 'authored', family: 'tension', scale: 'goal',
  roles: { '?a': { kind: 'person' }, '?b': { kind: 'person' } },
  junctures: {
    asked: { fn: 'ask', args: { by: '?a', of: '?b' }, requires: [{ rel: 'distinct', args: ['?a', '?b'] }] },
    paid: { fn: 'repay', args: { debtor: '?b', creditor: '?a' } },
    refused: { fn: 'refuse', args: { who: '?b', to: '?a' } },
  },
  edges: [{ from: 'asked', to: 'paid', link: 'answers' }, { from: 'asked', to: 'refused', link: 'answers' }],
  entry: ['asked'], outcomes: { paid: { reached: ['paid'], kind: 'resolved' }, refused: { reached: ['refused'], kind: 'resolved' } },
  show: { junctures: ['asked'], edges: 1 },
});
const codes = (p: Pattern, others: Pattern[] = []) => lintPattern(p, vocabulary, [p, ...others]).findings.map((f) => f.code);
const trips: Array<[number, (p: Pattern) => void]> = [
  [144, (p) => p.edges.push({ from: 'paid', to: 'asked', link: 'because' })],
  [145, (p) => { p.entry = []; }],
  [146, (p) => { p.junctures.asked.fn = 'unknown'; }],
  [147, (p) => { p.roles['?unbound'] = { kind: 'person' }; }],
  [148, (p) => { p.junctures.paid.v = 'offer'; delete p.outcomes.refused; }],
  [149, (p) => { p.roles['?b'].v = 'may'; p.junctures.paid.changes = [{ belief: { who: '?b', about: '?a' }, move: 'forms' }]; }],
  [150, (p) => { p.junctures.paid.realise = [{ refine: { pattern: 'missing', outcome: 'paid', binds: {} } }]; }],
  [151, (p) => { p.family = 'shape'; p.junctures.paid.realise = [{ wait: true }]; }],
  [152, (p) => { p.junctures.paid.join = { all: ['refused'], any: [] }; }],
  [153, (p) => {
    p.junctures.after = { fn: 'help', args: { by: '?a', to: '?b' } };
    p.edges.push({ from: 'paid', to: 'after', link: 'because' });
  }],
  [154, (p) => { p.use = 'library'; p.roles['?a'].identity = 'fixed-person'; }],
  [155, (p) => { p.outcomes.paid.reached = ['missing']; }],
  [156, (p) => { p.escalation = ['missing']; }],
  [157, (p) => { p.show.edges = 3; }],
  [158, (p) => { p.within = { clock: 'game', days: 91 }; }],
  [159, (p) => { p.roles['?b'].v = 'may'; p.junctures.paid.realise = [{ nudge: {} }]; }],
];
describe('SF-77: every pattern lint has a trip and a passing twin', () => {
  for (const [n, mutate] of trips) test(`L-${n}`, () => {
    const p = base();
    expect(codes(p)).not.toContain(`L-${n}`);
    mutate(p);
    expect(codes(p)).toContain(`L-${n}`);
  });
  test('L-144 ignores foreclosure cycles but catches unknown endpoints and bounds', () => {
    const p = base();
    p.edges.push({ from: 'paid', to: 'refused', link: 'forecloses' }, { from: 'refused', to: 'paid', link: 'forecloses' });
    expect(codes(p)).not.toContain('L-144');
    p.edges.push({ from: 'missing', to: 'paid', link: 'forecloses' });
    expect(codes(p)).toContain('L-144');
    const large = base();
    for (let n = 0; n < 6; n++) large.junctures[`j${n}`] = { fn: 'help', args: { by: '?a', to: '?b' } };
    expect(codes(large)).toContain('L-144');
    const crowded = base();
    crowded.edges = Array.from({ length: 13 }, () => ({ from: 'asked', to: 'paid', link: 'answers' }));
    expect(codes(crowded)).toContain('L-144');
  });
  test('L-145 generic-entry warning clears on a narrowing requirement', () => {
    const p = base();
    expect(codes(p)).not.toContain('L-145');
    delete p.junctures.asked.requires;
    expect(lintPattern(p, vocabulary).findings).toContainEqual(expect.objectContaining({ code: 'L-145', level: 'warning' }));
    p.entry = ['paid']; p.junctures.paid.args = { debtor: 'any', creditor: 'any' };
    expect(lintPattern(p, vocabulary).findings).toContainEqual(expect.objectContaining({ code: 'L-145', level: 'error' }));
  });
  test('L-148 allows independent refusal and timed unanswered continuations', () => {
    const p = base(); p.junctures.paid.v = 'offer';
    expect(codes(p)).not.toContain('L-148');
    p.outcomes.refused = { reached: ['asked'], after: { clock: 'game', days: 1 }, kind: 'parked' };
    expect(codes(p)).not.toContain('L-148');
  });
  test('L-149 npc guard identifies the believer', () => {
    const p = base(); trips.find(([n]) => n === 149)![1](p);
    p.junctures.paid.changes![0].when = { npc: '?b' };
    expect(codes(p)).not.toContain('L-149');
    p.junctures.paid.changes![0].when = { npc: '?a' };
    expect(codes(p)).toContain('L-149');
  });
  test('L-150 refinement checks mapped produces, coverage and changes', () => {
    const p = base(), child = base(); child.id = 'test:child';
    child.outcomes.paid.produces = [{ fn: 'repay', args: { debtor: '?b', creditor: '?a' } }];
    p.junctures.paid.realise = [{ refine: { pattern: child.id, outcome: 'paid', binds: { '?a': '?a', '?b': '?b' } } }];
    p.junctures.paid.changes = [{ ends: 'obligate', args: { debtor: '?b', creditor: '?a' } }];
    expect(codes(p, [child])).not.toContain('L-150');
    p.junctures.paid.changes.push({ tie: { a: '?a', b: '?b' }, move: 'up' });
    expect(codes(p, [child])).toContain('L-150');
    child.junctures.paid.changes = [{ tie: { a: '?a', b: '?b' }, move: 'up' }];
    expect(codes(p, [child])).not.toContain('L-150');
    child.outcomes.paid.produces[0].args.creditor = '?b';
    expect(codes(p, [child])).toContain('L-150');
  });
  test('L-151 story binds and L-153 aftermath', () => {
    const p = base(); p.junctures.paid = { fn: 'story', args: { pattern: 'test:child', outcome: 'any' } };
    expect(codes(p)).toContain('L-151'); p.junctures.paid.binds = { '?c': '?a' };
    expect(codes(p)).not.toContain('L-151');
    const q = base(); trips.find(([n]) => n === 153)![1](q);
    q.outcomes.paid.aftermath = { junctures: ['after'] };
    expect(codes(q)).not.toContain('L-153');
  });
  test('L-154 counts open fillers and permits authored specificity', () => {
    const p = base(); p.use = 'library';
    p.junctures.asked.fill = [{ kinds: ['offer'] }];
    expect(codes(p)).not.toContain('L-154');
    p.junctures.paid.fill = [{ kinds: ['repair'] }];
    expect(codes(p)).toContain('L-154');
    p.use = 'authored'; expect(codes(p)).not.toContain('L-154');
  });
  test('L-155 unknown produces and next', () => {
    const p = base(); p.outcomes.paid.produces = [{ fn: 'repay', args: { debtor: '?undeclared' } }];
    expect(codes(p)).toContain('L-155'); delete p.outcomes.paid.produces;
    p.outcomes.paid.next = ['missing'];
    expect(lintPattern(p, vocabulary).findings).toContainEqual(expect.objectContaining({ code: 'L-155', level: 'warning' }));
  });
  test('L-158 once binds through a searchable relation, never through negation', () => {
    const p = base(); p.roles['?g'] = { kind: 'group' }; p.once = ['?g'];
    p.junctures.asked.requires = [{ rel: 'member', args: ['?a', '?g'] }];
    expect(codes(p)).not.toContain('L-158');
    p.junctures.asked.requires = [{ not: { rel: 'member', args: ['?a', '?g'] } }];
    expect(codes(p)).toContain('L-158');
  });
  test('L-159 both offer forms, and NPC-only nudge', () => {
    const p = base(); p.junctures.asked.realise = [{ offer: {} }];
    expect(codes(p)).not.toContain('L-159');
    p.roles['?a'].v = 'may'; expect(codes(p)).toContain('L-159');
    p.roles['?b'].v = 'may'; expect(codes(p)).not.toContain('L-159');
    p.junctures.paid.realise = [{ offer: {} }]; p.junctures.paid.v = 'offer';
    expect(codes(p)).not.toContain('L-159');
  });
  test('lint is pure and deterministic over generated perturbations', () => {
    for (let i = 0; i < 128; i++) {
      const p = base(); trips[i % trips.length][1](p);
      if (i % 3 === 0) p.once = ['?a', '?b'];
      const before = structuredClone(p), first = lintPattern(p, vocabulary);
      expect(lintPattern(structuredClone(p), vocabulary)).toEqual(first);
      expect(p).toEqual(before);
    }
  });
});

describe('SF-77 / SF3-70: composite library', () => {
  test('all 29 patterns pass L-144–159; report abstraction and generic entries', () => {
    const reports = library.map((p) => ({ id: p.id, ...lintPattern(p, vocabulary, library) }));
    expect(reports).toHaveLength(29);
    expect(reports.flatMap((r) => r.findings.filter((f) => f.level === 'error').map((f) => ({ id: r.id, ...f })))).toEqual([]);
    // The rule wins over SF-77's count: there are 22 unnarrowed entries in this data.
    expect(reports.flatMap((r) => r.findings.filter((f) => f.code === 'L-145'))).toHaveLength(22);
    for (const r of reports) expect(r.abstraction).toBeGreaterThanOrEqual(0.5);
  });
});
