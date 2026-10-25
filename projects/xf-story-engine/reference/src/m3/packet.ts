// The blind packet built from a manifest: the one place that says which runs and which settings make a packet, so the packet
// can be rebuilt byte for byte. The manifest lists the hook runs by file name and record hash in canonical (sorted) order; A3 and
// A4 hooks are regenerated over fresh worlds from the settings the manifest names. Nothing here reads the file system: the tools
// pass in the records, and a test passes the committed ones.

import { type Arm, type Hook, ARM_NAMES, CRITERIA, buildPacket, cardsMarkdown, instructions, pairsMarkdown, shuffle } from './blind.ts';
import { type SlotRule, radiantJob } from './arms.ts';
import { OFFER_PACK } from './kits.ts';
import { WIDE_NAMES } from '../sim/names.ts';
import { Run, policies } from './driver.ts';
import { R2_ID, r2Pack } from './r2.ts';
import { stateById } from './states.ts';
import { type RunRecord, recordHash } from './transcript.ts';

export interface PacketManifest {
  version: 1;
  /** The seed of the packet's shuffles and its id labels. */
  seed: string;
  /** Hooks per arm, and the number of raters (each with a different balanced order). */
  n: number;
  raters: number;
  /** The slot rule A3's hooks are generated with (`rated-v1` for the packet that was rated). */
  a3Rule: SlotRule;
  /** The story states the A4 offers are played over, in turn. */
  a4States: string[];
  /**
   * Run 2 (M3 iteration 2): `names: 'wide'` builds the A3 and A4 worlds with the wide name registry of S1's pack, as the hook runs were, and
   * `tier: 'offers'` takes only the offers (the hooks with an ask) of the engine arms. Absent, the packet is run 1's.
   */
  names?: 'wide';
  tier?: 'offers';
  /** The hook runs, sorted by file name; each with the name and the hash its record carries. */
  runs: Array<{ file: string; name: string; hash: string }>;
}

export interface PacketFiles { files: Record<string, string>; available: Record<Arm, number>; n: number }

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The manifest of a set of run records, in canonical order. */
export function manifestOf(records: Array<{ file: string; record: RunRecord }>, settings: Omit<PacketManifest, 'version' | 'runs'>): PacketManifest {
  const runs = records.map((x) => ({ file: x.file, name: x.record.name, hash: x.record.hash })).sort((a, b) => byText(a.file, b.file));
  return { version: 1, ...settings, runs };
}

/** S1's names come from a small pool, so two residents can share a name; a card that names two people by one name is dropped from every arm. */
const distinct = (names: string[]): boolean => new Set(names).size === names.length;

/** Check the records against the manifest: every listed run present and unchanged. Only the listed runs are used. */
function checked(m: PacketManifest, records: Array<{ file: string; record: RunRecord }>): Array<{ file: string; record: RunRecord }> {
  if (m.runs.some((x, i) => i > 0 && byText(m.runs[i - 1]!.file, x.file) >= 0)) throw new Error('the manifest runs must be sorted by file name, once each');
  const by = new Map(records.map((x) => [x.file, x.record]));
  return m.runs.map((x) => {
    const r = by.get(x.file);
    if (!r) throw new Error(`manifest run ${x.file} was not supplied`);
    if (r.name !== x.name) throw new Error(`manifest run ${x.file} is named ${r.name}, not ${x.name}`);
    if (r.hash !== x.hash || recordHash(r) !== x.hash) throw new Error(`manifest run ${x.file} does not match its recorded hash`);
    return { file: x.file, record: r };
  });
}

export function buildPacketFiles(m: PacketManifest, supplied: Array<{ file: string; record: RunRecord }>): PacketFiles {
  const records = checked(m, supplied);
  const sown = (prefix: string): Hook[] =>
    records.filter((x) => x.file.startsWith(prefix)).flatMap((x) => x.record.deliveries.filter((d) => d.layer !== 'authored' && (m.tier !== 'offers' || (d.what === 'offer' && d.template.startsWith(OFFER_PACK))) && distinct(Object.values(d.names))).map((d): Hook => ({ arm: prefix === 'E-' ? 'E' : 'A1', text: d.words, meta: { run: x.record.name, template: d.template, clock: d.clock, tempo: x.record.tempo } })));
  const E = sown('E-'), A1 = sown('A1-');
  const wide = (d: import('../sim/data.ts').S1Data): void => { d.people.names = WIDE_NAMES; };

  // A4: R2's offer over fresh worlds and the states that make it
  const A4: Hook[] = [];
  for (let i = 0; A4.length < Math.max(E.length, A1.length, 24) + 8 && i < 120; i++) {
    const st = m.a4States[i % m.a4States.length]!;
    const run = new Run({ name: `a4-${i}`, layer3: false, packs: [r2Pack()], ...(m.names === 'wide' ? { s1: wide } : {}) }, stateById(st), policies.decline!);
    run.runWindows(3);
    const ask = run.deliveries.find((d) => d.template === R2_ID && d.what === 'offer');
    if (ask && distinct(Object.values(ask.names))) A4.push({ arm: 'A4', text: ask.words, meta: { world: `a4-${i}`, state: st } });
  }

  // A3: the Radiant-style generator over fresh worlds (V stands in a market block)
  const A3: Hook[] = [];
  for (let i = 0; A3.length < Math.max(E.length, A1.length, 24) + 8 && i < 400; i++) {
    const run = new Run({ name: `a3-${Math.floor(i / 3)}`, layer3: false, packs: [], ...(m.names === 'wide' ? { s1: wide } : {}) }, stateById('S-early-quiet'), policies.decline!);
    const job = radiantJob(run.w, (id) => run.nameOf(id), `a3-${Math.floor(i / 3)}`, i % 3, 'g1', m.a3Rule);
    if (job && distinct(job.names)) A3.push({ arm: 'A3', text: job.text, meta: { world: `a3-${Math.floor(i / 3)}`, template: job.template } });
  }

  const available = { E: E.length, A1: A1.length, A3: A3.length, A4: A4.length };
  const n = m.n;
  if (n < 1 || Object.values(available).some((c) => c < n)) throw new Error(`not enough hooks for ${n} per arm: ${JSON.stringify(available)}`);
  const take = (hs: Hook[], tag: string): Hook[] => shuffle(hs, 'sample', tag).slice(0, n);
  const hooks = [...take(E, 'E'), ...take(A1, 'A1'), ...take(A3, 'A3'), ...take(A4, 'A4')];

  const packet = buildPacket(hooks, m.seed, m.raters, [['E', 'A3'], ['E', 'A1'], ['A1', 'A3'], ['A4', 'A3']]);
  const files: Record<string, string> = {
    'packet.json': JSON.stringify({ cards: packet.cards, orders: packet.orders, pairs: packet.pairs }, null, 1),
    'key.json': JSON.stringify({ arms: ARM_NAMES, key: packet.key, pairKey: packet.pairKey, available, n }, null, 1),
    'instructions.md': instructions(),
  };
  packet.orders.forEach((order, r) => {
    files[`rater-${r + 1}.md`] = `${instructions()}\n---\n\n## Cards\n\n${cardsMarkdown(packet, order)}\n---\n\n## Pairs\n\n${pairsMarkdown(packet)}`;
  });
  files['scoring-sheet.md'] = [
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
    `Cards: ${hooks.length} (${n} per arm over ${Object.keys(ARM_NAMES).length} arms). Pairs: ${packet.pairs.length}. Raters: ${m.raters}, each with a different balanced order (the second is the first reversed).`,
    '',
    "Decision rule: the engine beats the baseline when its share of forced choices against A3 is above one half on both questions in every rater taken alone, and its mean on \"caused\" and \"pull\" is above A3's. The pooled counts are reported as counts: the raters judge the same items, so the pooled n is not a sample of independent choices and no significance test is run on it. Selection (E against A1) is credited only if E beats A1 by the same rule; otherwise the simpler design stands (PNL-11). Detection (made_by) is reported by arm.",
  ].join('\n') + '\n';
  return { files, available, n };
}
