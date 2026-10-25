// The text of a run (S1 week text, the deliveries' words, layer 3's decision log) and its machine-readable record.
// The writers here only read; nothing in a transcript is read back by the engine.

import { hrec } from '../canon.ts';
import { H, s } from '../id.ts';
import type { LogEntry } from '../procedural/types.ts';
import { clockOf, weekLines } from '../sim/week.ts';
import type { DeliveryRecord, Run } from './driver.ts';
import { R2_ID } from './r2.ts';

interface Line { t: number; rank: number; text: string }

const num = (x: unknown): string => (typeof x === 'number' ? (Math.round(x * 100) / 100).toString() : String(x));

/** One decision-log entry of layer 3 as a line, or undefined for the entries a reader does not need. */
export function logLine(run: Run, l: LogEntry): string | undefined {
  if (l.kind === 'sow' && l.rule === 'sow') {
    const d = l.data as { pattern: string; kit: string; features: Record<string, number>; composite: number; rivals: unknown[]; bindings: Record<string, string> };
    const who = Object.entries(d.bindings).map(([k, v]) => `${k.slice(1)}=${run.nameOf(v) || '?'}`).join(', ');
    const f = Object.entries(d.features).map(([k, v]) => `${k}=${num(v)}`).join(' ');
    return `layer 3 sowed "${d.kit.split(':')[1]}" from ${d.pattern.split(':')[1]} (${who}); features ${f}; composite ${num(d.composite)} among ${d.rivals.length} candidate${d.rivals.length === 1 ? '' : 's'}; cause: ${l.chain.length} recorded event${l.chain.length === 1 ? '' : 's'}.`;
  }
  if (l.kind === 'sow' && l.rule === 'sow-refused') return `layer 3's sowing was refused for a candidate and it tried the next.`;
  if (l.kind === 'slot') {
    if (l.rule === 'slot-passed' || l.rule === 'slot-lapsed') return undefined;
    return `slot ${num((l.data as { k?: number }).k)}: ${l.rule}.`;
  }
  if (l.kind === 'withdraw') return `layer 3 withdrew an unshown hook (${l.rule}).`;
  if (l.kind === 'hold') return `a delivery was held (${l.rule}).`;
  return undefined;
}

export function transcript(run: Run, opts: { week?: boolean; log?: boolean } = {}): string {
  const sim = run.w.sim;
  const out: string[] = [];
  const o = run.opts;
  out.push(`# M3 run: ${o.name}`);
  out.push(`world: Kabuki (stand-in slice ${sim.w.index.version}, hash ${sim.w.index.hash.slice(0, 12)}); seed name "${o.name}"`);
  out.push(`story state: ${run.state.id} (${run.state.note})`);
  out.push(`facts set (the rest read 0): ${Object.keys(run.state.facts).sort().join(', ') || 'none'}`);
  out.push(`street: ${run.state.street.map((x) => x.name).join('; ') || 'defaults'}`);
  for (const n of run.extra.notes ?? []) out.push(`setting: ${n}`);
  if (run.extra.walk) out.push('V walks the district: a new block every game hour');
  out.push(`layer 3: ${run.w.l3 ? `attached, tempo ${sim.k.settings.current().tempo}` : 'absent (sowing off)'}; V's policy: ${run.policy.id}`);
  out.push(`span: ${run.windowNo} windows of ten minutes (${(run.windowNo / 144).toFixed(1)} game days), ${run.play} play seconds`);
  out.push('');
  const lines: Line[] = [];
  if (opts.week !== false) for (let w = 0; w <= run.windowNo; w++) for (const l of weekLines(sim, w)) lines.push({ t: l.t, rank: 1, text: l.text });
  for (const d of run.deliveries) {
    const answer = d.answer ? `  -> V: ${d.answer}` : '';
    lines.push({ t: d.game, rank: 0, text: `${d.clock}  [${d.layer} ${d.what}${d.beat !== d.what ? ` ${d.beat}` : ''}] ${d.words}${answer}` });
  }
  if (opts.log !== false && run.w.l3) {
    for (const l of run.w.l3.log) {
      const text = logLine(run, l);
      if (text) lines.push({ t: l.at.game, rank: 2, text: `${clockOf(sim, l.at.game)}  (${text})` });
    }
  }
  lines.sort((a, b) => a.t - b.t || a.rank - b.rank);
  out.push(...lines.map((l) => l.text));
  return out.join('\n') + '\n';
}

export interface RunRecord {
  version: 1;
  name: string;
  state: string;
  windows: number;
  play: number;
  layer3: boolean;
  tempo: string;
  policy: string;
  deliveries: DeliveryRecord[];
  instances: Array<{ template: string; layer: string; state: string; roles: Record<string, string>; draws: Record<string, string>; sowSeq: number }>;
  decisions: Array<{ at: number; kind: string; rule: string; data: Record<string, unknown> }>;
  hash: string;
}

/** The hash a record carries: over everything but the hash itself, so a stored record can be checked after a round trip through JSON. */
const bodyHash = (body: Omit<RunRecord, 'hash'>): string => H(s('m3-record'), hrec(body as unknown as Record<string, unknown>));
export const recordHash = (r: RunRecord): string => {
  const { hash: _hash, ...body } = r;
  return bodyHash(body);
};

/** The machine-readable record of a run: what was shown, what was sown and why, and a hash of all of it. */
export function recordOf(run: Run): RunRecord {
  const l2 = run.w.l2;
  const instances = l2.all().map((i) => ({
    template: i.st.template.id, layer: i.st.source.layer, state: i.st.state, sowSeq: i.st.sowSeq,
    roles: Object.fromEntries(Object.entries(i.st.roles).map(([k, r]) => [k, run.nameOf(r.cast)])),
    draws: Object.fromEntries(Object.entries(i.st.draws).map(([k, d]) => [k, d.value])),
  }));
  const decisions = (run.w.l3?.log ?? [])
    .filter((l) => l.kind === 'sow')
    .map((l) => {
      const d = l.data as { pattern?: string; kit?: string; features?: Record<string, number>; composite?: number };
      return { at: l.at.game, kind: l.kind, rule: l.rule, data: { pattern: d.pattern, kit: d.kit, features: d.features, composite: d.composite } };
    });
  const body = {
    version: 1 as const, name: run.opts.name, state: run.state.id, windows: run.windowNo, play: run.play, layer3: !!run.w.l3,
    tempo: run.w.sim.k.settings.current().tempo, policy: run.policy.id, deliveries: run.deliveries, instances, decisions,
  };
  return { ...body, hash: bodyHash(body) };
}

/** The deliveries layer 3 sowed (not the authored seed's own): the hooks of a run. */
export const sownHooks = (run: Run): DeliveryRecord[] => run.deliveries.filter((d) => d.layer !== 'authored');

export { R2_ID };
