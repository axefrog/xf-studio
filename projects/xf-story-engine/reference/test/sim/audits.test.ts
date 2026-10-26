// SF1-Q: the honesty audits (S1 12, 14.1).

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeConfig } from '../../src/config.ts';
import { H, id as hid, i as hi, s as hs } from '../../src/id.ts';
import type { SchemaDefs } from '../../src/schema-types.ts';
import {
  ADMISSION_OWNER, PROCESS_WRITES, auditCursors, auditGate, auditKinds, auditReads, auditSchema, auditWriters, codeOf, deriveReads, lintSources, observeWrites, tabulate,
} from '../../src/sim/audit.ts';
import { NO_BOOSTS } from '../../src/sim/cast.ts';
import { lintKinds, type KindDef1 } from '../../src/sim/kinds.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { simDefs, worldRegistry } from '../../src/sim/world-schema.ts';
import { fxData, seedOf } from './helpers.ts';

// Bun 1.4 gives the default set in test/setup.ts to the first test file only
setDefaultTimeout(120_000);

const SRC = join(import.meta.dir, '../../src/sim');
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts')).map((f) => ({ path: f, text: readFileSync(join(SRC, f), 'utf8') }));

/** A busy run that touches every process: raw events, a V act, enforcement, incidents, groups. */
function busyRun(name: string) {
  const sim = Sim.create({
    worldSeed: seedOf(name), index: fx3Slice(),
    data: fxData((d) => {
      for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * 20) as [number, number, number, number];
      for (const n of d.norms.norms) { n.enforcePerDay = 400; n.beh0 = 0.3; n.priv0 = 0.8; n.perc0 = 0.2; }
    }),
  });
  const observed = observeWrites(sim);
  new ReplayPort(sim).submit([
    { t: 0, op: 'person', key: 'vendor', slots: { affiliation: 'civilian', alive: 'yes', 'age-class': 'adult' } },
    { t: 0, op: 'person', key: 'g', slots: { affiliation: 'GA', alive: 'yes', 'age-class': 'adult' } },
    { t: 0, op: 'reading', node: 'v', slot: 'district', value: 'fx_d1' },
    { t: 3000, op: 'event', kind: 'game.death', place: 'c1', participants: [{ who: 'vendor', role: 'victim' }, { who: 'v', role: 'actor' }], effects: [{ on: 'vendor', effect: 'kill' }], witnesses: 4 },
    { t: 3700, op: 'event', kind: 'game.heat.3', participants: [] },
    { t: 4000, op: 'event', kind: 'enf.fee.word', place: 'c1', participants: [{ who: 'g', role: 'enforcer' }, { who: 'vendor', role: 'target' }], witnesses: 8 },
  ]);
  sim.advance(process.env.S1_FULL === "1" ? 150 : 16);
  return { sim, observed };
}

describe('codeOf', () => {
  test('comments and the contents of strings are removed; the lines stay where they were', () => {
    const code = codeOf("const a = 1; // Math.exp(1)\n/* Math.pow(2, 3)\n*/ const s = 'Math.log(1)' + `x ${1}`;\nconst b = 2;");
    expect(code).not.toMatch(/Math/);
    expect(code.split('\n').length).toBe(4);
    expect(code).toContain('const b = 2;');
  });
});

describe('SF1-Q-1: the audits as shipped', () => {
  test('the source of the decision code: zero findings', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(lintSources(files)).toEqual([]);
  });

  test('the kinds, the read sets and the schema: zero findings; the derive reads are listed and read no later slot', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-Q-1'), index: fx3Slice(), data: fxData(), only: ['city.events'] });
    expect(lintKinds(sim.data)).toEqual([]);
    expect(auditKinds(sim.w.kinds.kinds.values())).toEqual([]);
    expect(auditReads(sim.reads.defs.values())).toEqual([]);
    const defs = simDefs(sim.data, sim.w.kinds.names(), sim.data.time.W);
    expect(auditSchema(defs, worldRegistry(), makeConfig({ wSim: sim.data.time.W, allowance: 5_000_000 }))).toEqual([]);
    const reads = deriveReads(defs);
    expect(reads.length).toBeGreaterThan(5);
    expect(reads.filter((r) => /heritage|gender|origin/i.test(r)).every((r) => r.startsWith('core:name.'))).toBe(true);
  });

  test('the writers of a busy run lie inside their declarations, no two share a write, and only the admission owner holds admission state', () => {
    const { sim, observed } = busyRun('SF1-Q-1b');
    expect(Object.keys(PROCESS_WRITES).sort()).toEqual([...sim.defs.keys()].sort());
    expect(auditWriters(PROCESS_WRITES, observed)).toEqual([]);
    expect(auditGate(sim.gate)).toEqual([]);
    // the run touched what it should have
    expect(observed['city.events']!.has('mint:ev')).toBe(true);
    expect(observed['city.mirror']!.has('mint:mir')).toBe(true);
    expect(observed['order.norms']!.has('mint:enf')).toBe(true);
    expect([...sim.defs.keys()].filter((id) => PROCESS_WRITES[id]!.some((w) => w.startsWith('state:admit') || w.startsWith('state:calendar')))).toEqual([ADMISSION_OWNER]);
    // every feed is read from a cursor in the reader's state
    expect(auditCursors(sim)).toEqual([]);
  });

  test('meta: is inert: an event of the director\'s kind with V as an actor and focal witnesses forms no belief and no ledger item', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-Q-1c'), index: fx3Slice(), data: fxData(), only: ['city.events'] });
    const d = sim.w.districts[0]!;
    const witness = sim.people.residentAt(d.cellIds[0]!, 0);
    sim.k.frames.open({ actor: witness, level: 'concern', origin: H(hs('meta-frame')), weight: 1, cause: sim.w.city, own: { protects: [{ slot: '*', scope: { nodes: [sim.w.v] }, where: [{ path: '@effect', op: 'eq', arg: 'harm' }] }] } });
    sim.k.settle();
    const victim = sim.people.residentAt(d.cellIds[1]!, 0);
    const mint = (kind: string, name: string) => sim.k.events.mintEvent({
      creator: sim.w.port, cause: sim.w.port, name, time: 1000, kind, place: d.cellIds[0]!,
      participants: [{ who: sim.w.v, role: 'aggressor' }, { who: victim, role: 'victim' }], effects: [{ on: victim, effect: 'harm' }], witnesses: [witness],
    });
    mint('meta:nudge', 'meta1');
    sim.k.settle();
    expect(sim.k.beliefs.activeOf(witness)).toEqual([]);
    expect(Object.keys(sim.record.absorbed)).toEqual([]);
    expect(sim.record.dirty).toEqual([]);
    // an ordinary event of the same shape is heard, so the test is not vacuous
    mint('assault', 'plain1');
    sim.k.settle();
    expect(sim.k.beliefs.activeOf(witness).length + Object.keys(sim.record.absorbed).length).toBeGreaterThan(0);
  });

  test('the representation audit tabulates who is cast in the roles of harm, by tag', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-Q-1d'), index: fx3Slice(), data: fxData(), only: ['city.events'] });
    const d0 = sim.w.districts[0]!;
    const casts = [];
    for (let n = 0; n < 300; n++) {
      const cell = d0.cellIds[n % 3]!;
      const kind = (['theft', 'assault', 'shakedown'] as const)[n % 3]!;
      const id = H(hs('rep'), hi(n));
      const cast = sim.casting.cast({ id, kind, size: 1, w: 0, time: ((n * 7) % 168) * 3600 + 900, cell, gen: 0, chain: [], public: false, witnesses: 0, sides: sim.casting.drawSides(id, cell, kind, NO_BOOSTS) });
      if (cast !== 'no-cast') casts.push(cast);
    }
    const table = tabulate(sim, casts);
    expect(table.roles.victim!.total).toBeGreaterThan(100);
    expect(table.roles.aggressor!.total).toBeGreaterThan(50);
    for (const role of Object.values(table.roles)) {
      for (const tag of Object.values(role.byTag)) expect(Object.values(tag).reduce((a, b) => a + b, 0)).toBe(role.total);
    }
    void hid;
  });
});

describe('SF1-Q-2: the audits catch', () => {
  const only = (found: ReturnType<typeof lintSources>, audit: string) => {
    expect(found.map((f) => f.audit)).toEqual([audit]);
  };
  const defs = (): SchemaDefs => {
    const data = fxData();
    return structuredClone(simDefs(data, undefined, data.time.W));
  };
  const cfg = makeConfig({ wSim: 600, allowance: 5_000_000 });

  test('a function using Math.exp', () => {
    only(lintSources([{ path: 'cast.ts', text: 'export const f = (x: number): number => Math.exp(x);' }]), 'arithmetic');
    only(lintSources([{ path: 'cast.ts', text: 'export const f = (x: number): number => Math.pow(x, 2);' }]), 'arithmetic');
    only(lintSources([{ path: 'cast.ts', text: 'export const f = (x: number): number => x * y ** 2;' }]), 'arithmetic');
  });

  test('a key naming the epoch', () => {
    only(lintSources([{ path: 'keys.ts', text: "export const bad = (pr: PR, w: number, k: Kernel) => pr(w, hs('x'), hi(k.epoch));" }]), 'no-load-reads');
    only(lintSources([{ path: 'cast.ts', text: 'const t = Date.now();' }]), 'no-load-reads');
  });

  test('a rand call outside the key registry', () => {
    only(lintSources([{ path: 'cast.ts', text: "const u = rand(hs('x'), hid(seed));" }]), 'keys');
  });

  test('a tier-1 process reading gameOwnedNow', () => {
    only(lintSources([{ path: 'proc-stocks.ts', text: 'const owned = c.sim.gameOwnedNow(cell);' }]), 'coarse-independence');
    // the fine tier may
    expect(lintSources([{ path: 'proc-acts.ts', text: 'const owned = c.sim.gameOwnedNow(cell);' }])).toEqual([]);
  });

  test('a tier-1 process reading V\u2019s cell or position, however it writes it (the string is kept for the rule that needs it)', () => {
    const kinds = (found: ReturnType<typeof lintSources>) => [...new Set(found.map((f) => f.audit))];
    for (const text of [
      "const c = sim.k.value(sim.w.vState, 'cell');",
      'const c = val(sim.w.vState, "position", t);',
      "const slot = 'cell'; const c = val(sim.w.vState, slot, t);",
      'const c = k.value(sim.w.vState, `cell`);',
      "const p = k.value(sim.w.v, 'position');",
    ]) expect(kinds(lintSources([{ path: 'proc-stocks.ts', text }])), text).toEqual(['coarse-independence']);
    // the line the review named, put into the real file
    const real = files.find((f) => f.path === 'proc-stocks.ts')!;
    const found = lintSources([{ path: 'proc-stocks.ts', text: `${real.text}\nconst c = sim.k.value(sim.w.vState, 'cell');\n` }]);
    expect(kinds(found)).toEqual(['coarse-independence']);
    expect(found.every((f) => f.where === `proc-stocks.ts:${real.text.split('\n').length + 1}`)).toBe(true);
    // V's district and wanted level may be read by the tier that needs them, and the fine tier may read its cell
    expect(lintSources([{ path: 'proc-mirror.ts', text: "const d = val(sim.w.vState, 'district', t);" }])).toEqual([]);
    expect(lintSources([{ path: 'proc-norms.ts', text: "const w = val(sim.w.vState, 'wanted', t);" }])).toEqual([]);
    expect(lintSources([{ path: 'proc-acts.ts', text: "const c = sim.k.value(sim.w.vState, 'cell');" }])).toEqual([]);
    // a word in a string is not a read
    expect(lintSources([{ path: 'proc-stocks.ts', text: "throw new Error('the cell of V is not read here');" }])).toEqual([]);
  });

  test('a read of a believer\u2019s beliefs that does not test memorable close by, whatever else the file says', () => {
    const far = 'const a = k.beliefs.activeOf(x);\n\n\n\n\n\nconst keep = b.memorable;';
    const found = lintSources([{ path: 'tie-policy.ts', text: far }]);
    expect(found.map((f) => f.audit)).toEqual(['forbidden-policy']);
    expect(found[0]!.where).toBe('tie-policy.ts:1');
    expect(lintSources([{ path: 'tie-policy.ts', text: 'for (const b of k.beliefs.activeOf(x)) {\n  if (!b.memorable) continue;\n}' }])).toEqual([]);
    expect(lintSources([{ path: 'tie-policy.ts', text: 'const m = k.beliefs.activeOf(x).filter((b) => b.memorable);' }])).toEqual([]);
  });

  test('the policies that hear events ignore the director\u2019s kinds in both places', () => {
    const real = files.find((f) => f.path === 'policies.ts')!;
    expect(lintSources([real])).toEqual([]);
    const once = real.text.replace(/ev\.kind\.startsWith\('meta:'\)/g, 'false');
    expect(lintSources([{ path: 'policies.ts', text: once }]).map((f) => f.audit)).toContain('meta-inert');
  });

  test('the guards of the policies are code: a message that contains the call does not stand in for one (R2-11)', () => {
    const real = files.find((f) => f.path === 'policies.ts')!;
    // both real guards replaced by messages that quote them: the file reads as guarding nothing
    const quoted = real.text.replace(/ev\.kind\.startsWith\('meta:'\)/g, `"ev.kind.startsWith('meta:')".length < 0`);
    expect(quoted).not.toBe(real.text);
    expect(lintSources([{ path: 'policies.ts', text: quoted }]).map((f) => f.audit)).toContain('meta-inert');
    // and a guard inside a template literal's expression is code
    const inTemplate = real.text.replace(/ev\.kind\.startsWith\('meta:'\)/g, "`${ev.kind.startsWith('meta:')}` === 'true'");
    expect(lintSources([{ path: 'policies.ts', text: inTemplate }]).map((f) => f.audit)).not.toContain('meta-inert');
  });

  test('the expressions inside a template literal are code, and its text is not (R2-10)', () => {
    const audits = (text: string): string[] => lintSources([{ path: 'proc-stocks.ts', text }]).map((f) => f.audit);
    expect(audits('const x = `${Math.random()}`;')).toContain('no-load-reads');
    expect(audits('const x = Number(`${Math.exp(1)}`);')).toContain('arithmetic');
    expect(audits('const x = `a ${b ** 2} c`;')).toContain('arithmetic');
    // nested: an expression inside an expression, and a string inside one
    expect(audits('const x = `${f(`${Math.random()}`)}`;')).toContain('no-load-reads');
    expect(audits('const x = `${f("Math.random()")} ${g({ a: 1 })}`;')).toEqual([]);
    // the text of a template is a message, as any string
    expect(audits('const x = `Math.random() and Math.exp(1) and 2 ** 3`;')).toEqual([]);
    // the lines stay where they were
    expect(codeOf('const a = `one\n${x}\ntwo`;\nconst b = 2;').split('\n').length).toBe(4);
  });

  test('R3-08: regex braces, slashes and nested templates cannot hide executable interpolation code', () => {
    for (const text of [
      'const x = `${/[}]/.test(value) ? Math.random() : 0}`;',
      'const x = `${/[}]/.test(value) ? Math.exp(1) : 0}`;',
      'const x = `${/[{}]/.test(value) ? `${Math.random()}` : ""}`;',
      'const x = `${/\\/\\//.test(value) ? Math.random() : 0}`;',
    ]) expect(lintSources([{ path: 'proc-stocks.ts', text }]).some((f) => ['arithmetic', 'no-load-reads'].includes(f.audit)), 'R3-08 semantic: executable interpolation must be audited').toBe(true);
    expect(lintSources([{ path: 'proc-stocks.ts', text: 'const x = /Math.random\\(\\)/.test(value);' }])).toEqual([]);
  });

  test('R3-09: unrelated calls, dead conjuncts, non-rejecting branches and displaced guards cannot replace either policy guard', () => {
    const real = files.find((f) => f.path === 'policies.ts')!;
    const disabled = real.text.replace(/ev\.kind\.startsWith\('meta:'\)/g, 'false') + "\nconst unrelated = ''.startsWith('meta:') && ''.startsWith('meta:');";
    expect(lintSources([{ ...real, text: disabled }]).filter((f) => f.audit === 'meta-inert').map((f) => f.where), 'R3-09 semantic: both methods need rejecting guards').toEqual(['policies.ts:heardEvent', 'policies.ts:absorb']);
    for (const text of [
      real.text.replaceAll("ev.kind.startsWith('meta:')", "false && ev.kind.startsWith('meta:')"),
      real.text.replace("if (ev.kind.startsWith('meta:')) return;", "if (ev.kind.startsWith('meta:')) { const ignored = true; }"),
      real.text.replace("if (ev.kind.startsWith('meta:')) return;", "this.witness(ev); if (ev.kind.startsWith('meta:')) return;"),
    ]) expect(lintSources([{ ...real, text }]).some((f) => f.audit === 'meta-inert')).toBe(true);
    const oneDisabled = real.text.replace("if (ev.kind.startsWith('meta:')) return;", 'if (false) return;');
    expect(lintSources([{ ...real, text: oneDisabled }]).filter((f) => f.audit === 'meta-inert').map((f) => f.where)).toEqual(['policies.ts:heardEvent']);
  });

  test('two writers of one slot', () => {
    const found = auditWriters({ ...PROCESS_WRITES, 'order.stocks': [...PROCESS_WRITES['order.stocks']!, 'pin:xf:cell.band'] });
    expect(found.map((f) => f.audit)).toEqual(['one-writer']);
    expect(found[0]!.detail).toContain('city.events and order.stocks');
  });

  test('a second writer of an admission budget', () => {
    const found = auditWriters({ ...PROCESS_WRITES, 'order.norms': [...PROCESS_WRITES['order.norms']!, 'state:admit.m4Times'] });
    expect(found.map((f) => f.audit)).toEqual(['one-writer']);
    expect(found[0]!.detail).toContain('admission state');
  });

  test('a write a process does not declare, and a gate that holds a counter', () => {
    expect(auditWriters(PROCESS_WRITES, { 'order.stocks': ['pin:xf:cell.band'] }).map((f) => f.audit)).toEqual(['one-writer']);
    expect(auditGate({ w: {}, people: {}, real: new Set(), budget: 3 }).map((f) => f.where)).toEqual(['gate']);
  });

  test('a feed read with no cursor', () => {
    only(lintSources([{ path: 'proc-groups.ts', text: 'const f = feedAfter(ev?.facts, 0);' }]), 'feeds');
    expect(lintSources([{ path: 'proc-groups.ts', text: 'const f = feedAfter(ev?.facts, st.cursors.events);' }])).toEqual([]);
  });

  test('a derive reading a later slot', () => {
    const d = defs();
    const kind = d.kinds.find((k) => k.slots.some((s) => s.derive && s.derive.inputs.some((i) => !i.startsWith('^/')) && s.key !== k.slots[k.slots.length - 1]!.key))!;
    const slot = kind.slots.find((s) => s.derive && s.derive.inputs.some((i) => !i.startsWith('^/')))!;
    const later = kind.slots[kind.slots.length - 1]!.key;
    slot.derive!.inputs = [later];
    delete slot.derive!.preimage;
    const found = auditSchema(d, worldRegistry(), cfg);
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(new Set(found.map((f) => f.audit))).toEqual(new Set(['schema-order']));
    expect(found.every((f) => f.detail.includes('not an earlier slot'))).toBe(true);
  });

  test('a kind with V as a victim', () => {
    const sim = Sim.create({ worldSeed: seedOf('SF1-Q-2'), index: fx3Slice(), data: fxData(), only: ['city.events'] });
    const theft = sim.w.kinds.get('theft')! as KindDef1;
    const bad: KindDef1 = { ...theft, roles: [{ role: 'victim', source: { from: 'v' } as never, count: [1, 1], adult: true }] };
    const found = auditKinds([bad]);
    expect(found.map((f) => f.audit)).toEqual(['v-exclusion']);
  });

  test('a derive reading a heritage tag', () => {
    const d = defs();
    const kind = d.kinds.find((k) => k.id.startsWith('xf:') && k.slots.some((s) => s.derive && s.derive.inputs.length > 0 && !s.derive.preimage))!;
    const slot = kind.slots.find((s) => s.derive && s.derive.inputs.length > 0 && !s.derive.preimage)!;
    const at = kind.slots.indexOf(slot);
    kind.slots.splice(at, 0, { key: 'heritage', dim: 'xf:yesno', card: 'one', mode: 'sampled', tier: 3 });
    slot.derive!.inputs = ['heritage'];
    const found = auditSchema(d, worldRegistry(), cfg);
    expect(found.map((f) => f.audit)).toEqual(['source-lint']);
    expect(found[0]!.detail).toContain('heritage');
  });

  test('a policy that reads a belief and never asks whether it is memorable, and one that writes on V', () => {
    only(lintSources([{ path: 'tie-policy.ts', text: 'for (const b of k.beliefs.activeOf(x)) { use(b); }' }]), 'forbidden-policy');
    only(lintSources([{ path: 'ledger.ts', text: 'k.pin({ node: sim.w.v, slot: "drives", value: 1, reason: "authored", cause });' }]), 'v-exclusion');
  });
});
