import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { auditData, auditSources, auditState } from '../../src/procedural/audit.ts';
import { defaultData } from '../../src/procedural/data.ts';
import { world, complete, pattern } from './helpers.ts';
import { coreDefs, mergeDefs } from '../../src/core-schema.ts';
import { Schema } from '../../src/schema.ts';
import { coreRegistry } from '../../src/registry.ts';

test('S3 static audits pass the shipped source, data and a retained completed match', () => {
  const root = new URL('../../src/procedural/', import.meta.url),
    files = readdirSync(root)
      .filter((f) => f.endsWith('.ts') && f !== 'audit.ts')
      .map((f) => ({ path: f, text: readFileSync(new URL(f, root), 'utf8') }));
  expect(auditSources(files)).toEqual([]);
  expect(auditData(defaultData())).toEqual([]);
  const w = world('audit');
  complete(w);
  expect(auditState(w.l3)).toEqual([]);
});
test('source audits find forbidden reads and writes in executable nested templates and computed members', () => {
  const examples = [
    ['keys.ts', 'const x = `${Date.now()}`', 'closed-inputs'],
    ['sower.ts', "const x = state['phase'];", 'session-independence'],
    ['fit.ts', 'const x = req.layer2.playTotal();', 'world-fit-only'],
    ['director.ts', 'const x = this.log[0];', 'evidence-firewall'],
    ['sower.ts', "k['pin']({});", 'two-doors'],
    ['fit.ts', "const x=Math['random']();", 'arithmetic'],
  ];
  for (const [path, text, audit] of examples)
    expect(auditSources([{ path, text }]).some((f) => f.audit === audit)).toBe(true);
  expect(
    auditSources([{ path: 'keys.ts', text: "// Date.now(); this.log[0]\nconst description='Math.random()';" }]),
  ).toEqual([]);
});
test('structural audits find broken caps, duplicate occurrences and missing retained evidence', () => {
  const w = world('broken-audit');
  complete(w);
  w.l3.state.pool.push(structuredClone(w.l3.state.pool[0]));
  expect(auditState(w.l3).some((f) => f.detail === 'Duplicate match')).toBe(true);
  const data = defaultData();
  data.schedule.theta.calm = 0.9;
  data.schedule.theta.steady = 0.2;
  expect(auditData(data).some((f) => f.detail.includes('nest'))).toBe(true);
});
test('S3-L-7 later capabilities and invalid kind references are refused without crashing other patterns', () => {
  const w = world('later-patterns');
  for (const extra of [
    { keep: 1 },
    { belief: {} },
    { edge: {} },
    { frame: {} },
    { tellings: [] },
    { source: 'looseEnd' },
    { playerModel: {} },
  ]) {
    const findings = w.l3.installPatterns([{ ...pattern(), ...extra } as never, pattern({ id: 'good' })]);
    expect(findings.some((f) => f.message.includes('not supported yet'))).toBe(true);
    expect(w.l3.sifter.patterns.has('good')).toBe(true);
  }
  expect(
    w.l3
      .installPatterns([pattern({ roles: { '?a': { kind: 'unknown' }, '?b': { kind: 'core:person' } } })])
      .some((f) => f.code === 'S3-L-2'),
  ).toBe(true);
});
test('classification gives residents person compatibility while preserving profile-first slot order', () => {
  const defs = mergeDefs(coreDefs(), {
    dims: [],
    edgeTypes: [],
    kinds: [{ id: 'fx:independent-person', extends: ['core:thing'], classifiesAs: ['core:person'], slots: [] }],
  });
  const schema = Schema.load(defs, coreRegistry());
  expect(schema.isKind('fx:independent-person', 'core:person')).toBe(true);
  expect(schema.kind('fx:independent-person').slots).toEqual([]);
  const cyclic = structuredClone(defs);
  cyclic.kinds.push({ id: 'fx:cycle', classifiesAs: ['fx:cycle'], slots: [] });
  expect(() => Schema.load(cyclic, coreRegistry())).toThrow('inheritance cycle');
});
test('invalid schedule data and deferred director features are refused at attachment', () => {
  const data = defaultData();
  data.sower.maxLevel = 'arc';
  expect(() => world('deferred-level', { data })).toThrow('not supported yet');
  expect(() => world('deferred-player-model', { s3: { playerModel: {} } as never })).toThrow('not supported yet');
});
