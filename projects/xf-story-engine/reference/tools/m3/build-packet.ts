// Build the blind packet from the hook runs and the control arms.
// Usage: bun tools/m3/build-packet.ts <rundir> <outdir> [n] [raters]
//   <rundir> holds the records of the arm E and arm A1 runs (`E-*.json` and `A1-*.json`, written by run-hooks.ts).
// A3 hooks are generated here over fresh worlds; A4 hooks are R2's offer played over fresh worlds and story states.
// Every arm is sampled to the same number of hooks `n` (the smallest arm's count when `n` is not given). The packet's cards carry
// text only; `key.json` says which card is which arm and is never given to a rater.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { type Arm, type Hook, ARM_NAMES, CRITERIA, buildPacket, cardsMarkdown, instructions, pairsMarkdown, shuffle } from '../../src/m3/blind.ts';
import { radiantJob } from '../../src/m3/arms.ts';
import { Run, policies } from '../../src/m3/driver.ts';
import { R2_ID, r2Pack } from '../../src/m3/r2.ts';
import { stateById } from '../../src/m3/states.ts';
import type { RunRecord } from '../../src/m3/transcript.ts';

const [dir, out, nArg, ratersArg] = process.argv.slice(2);
if (!dir || !out) throw new Error('usage: build-packet <rundir> <outdir> [n] [raters]');
const raters = Number(ratersArg ?? 4);

const records = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, r: JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as RunRecord }));
/** S1's names come from a small pool, so two residents can share a name; a card that names two people by one name is dropped from every arm. */
const distinct = (names: string[]): boolean => new Set(names).size === names.length;
const sown = (prefix: string): Hook[] =>
  records.filter((x) => x.f.startsWith(prefix)).flatMap((x) => x.r.deliveries.filter((d) => d.layer !== 'authored' && distinct(Object.values(d.names))).map((d): Hook => ({ arm: prefix === 'E-' ? 'E' : 'A1', text: d.words, meta: { run: x.r.name, template: d.template, clock: d.clock, tempo: x.r.tempo } })));
const E = sown('E-'), A1 = sown('A1-');

// A4: R2's offer over fresh worlds and the states that make it
const askStates = ['S-early-quiet', 'S-mid-squeezed', 'S-mid-crackdown', 'S-late-wary'];
const A4: Hook[] = [];
for (let i = 0; A4.length < Math.max(E.length, A1.length, 24) + 8 && i < 120; i++) {
  const st = askStates[i % askStates.length]!;
  const run = new Run({ name: `a4-${i}`, layer3: false, packs: [r2Pack()] }, stateById(st), policies.decline!);
  run.runWindows(3);
  const ask = run.deliveries.find((d) => d.template === R2_ID && d.what === 'offer');
  if (ask && distinct(Object.values(ask.names))) A4.push({ arm: 'A4', text: ask.words, meta: { world: `a4-${i}`, state: st } });
}

// A3: the Radiant-style generator over fresh worlds (V stands in a market block)
const A3: Hook[] = [];
for (let i = 0; A3.length < Math.max(E.length, A1.length, 24) + 8 && i < 400; i++) {
  const run = new Run({ name: `a3-${Math.floor(i / 3)}`, layer3: false, packs: [] }, stateById('S-early-quiet'), policies.decline!);
  const job = radiantJob(run.w, (id) => run.nameOf(id), `a3-${Math.floor(i / 3)}`, i % 3);
  if (job && distinct(job.names)) A3.push({ arm: 'A3', text: job.text, meta: { world: `a3-${Math.floor(i / 3)}`, template: job.template } });
}

const n = Number(nArg ?? Math.min(E.length, A1.length, A3.length, A4.length));
if (n < 1) throw new Error(`not enough hooks: E ${E.length}, A1 ${A1.length}, A3 ${A3.length}, A4 ${A4.length}`);
const take = (hs: Hook[], tag: string): Hook[] => shuffle(hs, 'sample', tag).slice(0, n);
const hooks = [...take(E, 'E'), ...take(A1, 'A1'), ...take(A3, 'A3'), ...take(A4, 'A4')];

const packet = buildPacket(hooks, 'm3-blind-1', raters, [['E', 'A3'], ['E', 'A1'], ['A1', 'A3'], ['A4', 'A3']]);
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/packet.json`, JSON.stringify({ cards: packet.cards, orders: packet.orders, pairs: packet.pairs }, null, 1));
writeFileSync(`${out}/key.json`, JSON.stringify({ arms: ARM_NAMES, key: packet.key, pairKey: packet.pairKey, available: { E: E.length, A1: A1.length, A3: A3.length, A4: A4.length }, n }, null, 1));
writeFileSync(`${out}/instructions.md`, instructions());
packet.orders.forEach((order, r) => {
  writeFileSync(`${out}/rater-${r + 1}.md`, `${instructions()}\n---\n\n## Cards\n\n${cardsMarkdown(packet, order)}\n---\n\n## Pairs\n\n${pairsMarkdown(packet)}`);
});
writeFileSync(`${out}/scoring-sheet.md`, [
  '# Scoring sheet',
  '',
  'Built from the quality bar of dossier 23 (5.2) and the criteria sheet (5.5). One item per quality, rated separately and never added.',
  '',
  '| Item | Asked as | Bar |',
  '|---|---|---|',
  ...CRITERIA.map((c) => `| ${c.id} | ${c.ask} | ${c.bar} |`),
  '| made_by | person or program, and the cue | Feels generated (C8; bar 5 and 6) |',
  '| pairs | which of two would you rather follow up; which reads as more caused | the decision rule of P-D |',
  '',
  `Cards: ${hooks.length} (${n} per arm over ${Object.keys(ARM_NAMES).length} arms). Pairs: ${packet.pairs.length}. Raters: ${raters}, each with a different balanced order (the second is the first reversed).`,
  '',
  'Decision rule: the engine beats the baseline when, over raters, its share of forced choices against A3 is above one half beyond the sign test (two-sided p < 0.05) on both questions, and its mean on "caused" and "pull" is above A3\'s. Selection (E against A1) is credited only if E beats A1 by the same rule; otherwise the simpler design stands (PNL-11). Detection (made_by) is reported by arm.',
].join('\n') + '\n');
console.log(JSON.stringify({ n, available: { E: E.length, A1: A1.length, A3: A3.length, A4: A4.length }, cards: packet.cards.length, pairs: packet.pairs.length }));
