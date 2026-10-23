// The fit report (S2 section 11.2): a seed run against the current state without changing it, with fixed world
// seeds. It evaluates the windows and the context, casts every role (read-only), makes the content draws
// the seed would make, and says in plain words why a seed fits, waits, or does not fit. Also the pull recap
// (S2 section 8.7), grounded in what V was shown.

import { H, s as hs } from '../id.ts';
import type { Id, Query } from '../types.ts';
import { castOrder, castRole, effective, runLadder } from './cast.ts';
import { chooseFragment } from './beats.ts';
import { playOf } from './doc.ts';
import { evalPred, ledger } from './eval.ts';
import type { Instance, Layer2 } from './layer2.ts';
import { isTerminal } from './layer2.ts';
import { pickChannel, timingFor } from './arbiter.ts';
import { reachableBeats } from './lint.ts';
import { windowStates } from './run.ts';
import { newInstanceState } from './state.ts';
import type { CompiledResult } from './compile.ts';
import type { ChannelId, ContentRef, EffectDecl, Finding, SeedInput, TimingRequest } from './types.ts';

export interface FitReport {
  verdict: 'fits' | 'waits' | 'no-fit';
  why: string[];
  windows: Record<string, 'open' | 'pending' | 'closed'>;
  cast: Record<string, { node?: Id; standIn?: boolean; candidates: number; reasons: string[]; unfilled?: string }>;
  draws: Record<string, string>;
  fixedRejected: string[];
  timing: { firstDelivery?: TimingRequest; channel?: ChannelId };
  exits: Array<{ beat: string; reachable: boolean; leadsTo: string }>;
  declinePreview: { response?: ContentRef; unattendedOutcome: EffectDecl[] };
  connectingMaterial: string[];
  argues: never[];
  plants: never[];
  turns: Array<{ who: string; kind: string; pressure: string }>;
  /** For each unfilled or thin role: how many candidates there would be if each `must` term were dropped. */
  nearMiss: Record<string, Array<{ drop: string; candidates: number }>>;
  /** Text units written, missing and placeholders. */
  cost: { written: number; missing: number; placeholders: number };
  /** The settings the report ran under. */
  settings: { tempo: string; content: Record<string, number> };
  findings: Finding[];
}

/** Run a template against the current state without changing it. A sample is the live kernel (a loaded save, or a fixture). */
export function fitReport(l2: Layer2, packId: string, templateId: string): FitReport {
  const k = l2.k;
  const index = l2.packs.get(packId);
  const template = index?.pack.seeds.find((s) => s.id === templateId);
  const settings = k.settings.current();
  const base: FitReport = {
    verdict: 'no-fit', why: [], windows: {}, cast: {}, draws: {}, fixedRejected: [], timing: {}, exits: [], declinePreview: { unattendedOutcome: [] },
    connectingMaterial: [], argues: [], plants: [], turns: [], nearMiss: {}, cost: { written: 0, missing: 0, placeholders: 0 },
    settings: { tempo: settings.tempo, content: Object.fromEntries(Object.entries(settings.content.ceiling)) }, findings: [],
  };
  if (!index || !template) {
    base.why.push(`The pack "${packId}" has no template "${templateId}".`);
    return base;
  }
  const fitId = H(hs('fit'), hs(packId), hs(templateId));
  const res = l2.compile(packId, template as SeedInput, {
    draw: (choice, options) => ({ value: l2.draw(fitId, choice, options.map((o) => ({ id: o.id, weight: o.weight })), 0).value, attempt: 0 }),
    evalPred: (p) => evalPred(l2, { t: k.now }, p),
  });
  if (!res.ok) {
    base.findings = res.findings;
    base.why.push(...res.findings.filter((f) => f.level === 'error').map((f) => f.message));
    return base;
  }
  base.findings = res.findings;
  return evaluate(l2, base, res, fitId, packId, templateId);
}

function evaluate(l2: Layer2, out: FitReport, res: CompiledResult, fitId: Id, packId: string, templateId: string): FitReport {
  const k = l2.k;
  const st = newInstanceState(res, { pack: packId, template: templateId, version: res.seed.version, by: 'pack', layer: 'authored', sowSeq: 0, now: k.now, playTotal: l2.playTotal() });
  const inst: Instance = { id: fitId, st };
  const doc = st.document;
  let withdraw: string | undefined;
  let waiting = false;
  for (const key of castOrder(inst)) {
    const rs = st.roles[key]!;
    let attempt = castRole(l2, inst, key);
    const reasons: string[] = [];
    if (!attempt.node) {
      reasons.push(attempt.reason ?? 'unfilled');
      const lad = runLadder(l2, inst, key, attempt);
      if (lad.r === 'withdraw') {
        withdraw ??= `The role "${key}" cannot be filled: ${lad.reason}.`;
      } else if (lad.r === 'waiting') {
        waiting = true;
        reasons.push('the ladder waits');
      } else if (lad.r === 'cast') attempt = { node: rs.cast!, candidates: rs.candidates ?? 0 };
    }
    const row: FitReport['cast'][string] = { candidates: attempt.candidates, reasons };
    const node = rs.cast;
    if (node !== undefined) row.node = node;
    if (rs.standIn) row.standIn = true;
    if (rs.unfilled) row.unfilled = rs.unfilled;
    out.cast[key] = row;
    if (!node && !rs.standIn) {
      // Near misses: the candidates there would be if each `must` term were dropped.
      const role = doc.roles[key]!;
      const { must } = effective(role, rs);
      const nm: Array<{ drop: string; candidates: number }> = [];
      must.forEach((m, i) => {
        if (m.path.includes('/') || /^\{/.test(JSON.stringify(m.arg))) return;
        const q: Query = { find: role.kind, scope: { under: k.expandId('root:city') }, at: k.now, must: must.filter((_, j) => j !== i) as never, limit: 'all' };
        const r = k.query(q);
        nm.push({ drop: `${m.path} ${m.op}`, candidates: r.status === 'ok' ? r.items.length : -1 });
      });
      out.nearMiss[key] = nm;
    }
  }
  for (const [c, d] of Object.entries(st.draws)) out.draws[c] = d.value;
  // A window and the context may read a cast role, so they are read after casting.
  const ws = windowStates(l2, inst, k.now);
  doc.windows.forEach((w, i) => { out.windows[w.id] = ws[i]!; });
  const ctx = evalPred(l2, { inst, t: k.now }, doc.context);
  const open = ws.includes('open');
  const closed = ws.length > 0 && ws.every((w) => w === 'closed');
  if (closed) {
    out.verdict = 'no-fit';
    out.why.push('Every window of the seed is closed.');
  } else if (withdraw) {
    out.verdict = 'no-fit';
    out.why.push(withdraw);
  } else if (open && ctx === 'yes' && !waiting && Object.values(out.cast).every((c) => c.node !== undefined || c.standIn)) {
    out.verdict = 'fits';
  } else {
    out.verdict = 'waits';
    if (!open) out.why.push('No window is open yet.');
    if (ctx !== 'yes') out.why.push(ctx === 'no' ? "The seed's context does not hold." : "The seed's context cannot be read yet.");
    if (waiting) out.why.push('A role is unfilled and its ladder waits.');
  }
  // The first delivery: the first start beat's fragment and its channel.
  const first = doc.start[0];
  if (first) {
    const chosen = chooseFragment(l2, inst, first, 0);
    if (chosen && chosen !== 'drop') {
      out.draws[`alt:${first}:0`] = chosen.fragment.id;
      const tmp = { tried: [] as ChannelId[] } as never;
      const channel = pickChannel(l2, tmp, chosen.fragment);
      out.timing.firstDelivery = timingFor(l2, inst, channel);
      if (channel) out.timing.channel = channel;
    }
  }
  // The exits and the decline preview.
  const reach = reachableBeats(doc);
  for (const [bk, b] of Object.entries(doc.beats)) {
    if (b.kind === 'exit') out.exits.push({ beat: bk, reachable: reach.has(bk), leadsTo: playOf(b).refs[0] ?? '' });
  }
  const firstOffer = doc.start.map((bk) => playOf(doc.beats[bk]!).refs).flat().map((r) => res.closure.fragments.find((f) => f.id === r.replace(/^pack:/, ''))).find((f) => f?.offer);
  // A decline with no content of its own is answered by the exit beat that reads it (S2 section 2.9): that beat's content is the preview.
  const declineExit = Object.values(doc.beats).find((b) => b.kind === 'exit' && (b.links ?? []).some((l) => 'because' in l && l.on !== undefined && JSON.stringify(l.on).includes('"decline')));
  const resp = firstOffer?.offer?.decline[0]?.response ?? (declineExit ? playOf(declineExit).refs[0] : undefined);
  if (resp !== undefined) out.declinePreview.response = resp;
  out.declinePreview.unattendedOutcome = doc.unattended.outcome;
  out.turns = doc.turns.filter((t) => t.who).map((t) => ({ who: t.who!, kind: t.kind ?? t.level, pressure: 'not measured' }));
  // Cost: the words written, missing, and placeholders.
  const index = l2.packs.get(packId)!;
  for (const ref of PackRefsOf(res)) {
    if (typeof ref === 'object') out.cost.placeholders++;
    else if (index.text(ref)) out.cost.written++;
    else out.cost.missing++;
  }
  return out;
}

function PackRefsOf(res: CompiledResult): ContentRef[] {
  const out: ContentRef[] = [];
  for (const f of res.closure.fragments) out.push(f.forms.standard);
  return out;
}

// ---- the pull recap (S2 section 8.7) ----

export interface RecapItem {
  kind: 'resume' | 'waiting' | 'closure';
  seed: Id;
  template: string;
  /** The record entry it cites. */
  entry?: number;
  status?: string;
  delivery?: Id;
}

/**
 * "Story so far": a pull entry, always available. Only exposed material appears: the view never tells V something V was
 * not shown (apart from settled news already queued). Each item cites a record entry and names an act, never a feeling.
 */
export function recap(l2: Layer2): RecapItem[] {
  const out: RecapItem[] = [];
  const exposed = new Set<Id>();
  for (const e of ledger(l2)) if (e.kind === 'delivery' && e.grade !== 'ambient') exposed.add(e.seed);
  for (const inst of l2.all()) {
    const st = inst.st;
    if (isTerminal(st.state)) {
      if (st.closed && exposed.has(inst.id)) {
        const entry = st.record.find((r) => r.kind === 'closure');
        out.push({ kind: 'closure', seed: inst.id, template: st.template.id, status: st.closed.status, ...(entry ? { entry: entry.n } : {}) });
      }
      continue;
    }
    for (const d of st.deliveries) {
      if (d.what === 'offer' && d.state === 'displayed') out.push({ kind: 'waiting', seed: inst.id, template: st.template.id, delivery: d.id });
    }
  }
  return out;
}
