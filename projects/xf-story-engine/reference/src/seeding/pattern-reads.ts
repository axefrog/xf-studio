import type { Id } from '../types.ts';
import { eventFacts } from './eval.ts';
import type { Layer2 } from './layer2.ts';
import { isTerminal } from './layer2.ts';
import type { ExposureGrade, Stance } from './types.ts';
import { implicitPattern } from './seed-patterns.ts';
import { agentRoles } from './actors.ts';

const rank = { ambient: 0, presented: 1, confirmed: 2 };
const unexposed = new WeakMap<Layer2, Set<Id>>();
function negativeExposures(l2: Layer2): Set<Id> {
  const prior = unexposed.get(l2); if (prior) return prior;
  const cache = new Set<Id>(); unexposed.set(l2, cache);
  const invalidate = (node?: Id) => {
    if (node === undefined) { cache.clear(); return; }
    let h = l2.k.store.header(node);
    while (h && (h.origin.by === 'member' || h.origin.by === 'value')) { node = h.origin.owner; h = l2.k.store.header(node); }
    cache.delete(node);
  };
  l2.k.store.factObservers.push(invalidate);
  l2.k.events.projectionObservers.push(invalidate);
  l2.k.changeObservers.push((c) => { if (c.c === 'pin' || c.c === 'reading') invalidate(c.node); });
  return cache;
}
/** Absence of V from constant participant/witness fields proves a negative independently of a
 * summary descriptor's changing time, place or kind. Uncertain constraints keep the general read. */
function remainsUnexposed(l2: Layer2, event: Id, facts: NonNullable<ReturnType<typeof eventFacts>>): boolean {
  const k = l2.k, fields = /^(participants|witnesses|who|role)(#|\[|$)/;
  if (facts.participants.some((p) => p.who === k.vId) || facts.witnesses.includes(k.vId)
    || k.store.pinsOfNode(event).some((p) => p.reason === 'observed' && !k.store.isWithdrawn(p.id))
    || k.store.generalContributions().some((c) => c.target.slot === '*' || fields.test(c.target.slot))) return false;
  for (const field of ['participants#count', 'witnesses#count'])
    if (!k.store.contributionsNaming(event).some((c) => c.target.slot === field && c.form.f === 'const' && c.mode === 'constrain'
      && !c.target.where?.length && c.valid.from === undefined && c.valid.to === undefined)
      && !k.store.livePinsOn(event, field).some((p) => typeof p.value === 'number')) return false;
  const nodes = [event];
  for (let n = 0; n < nodes.length; n++) {
    const node = nodes[n], h = k.store.header(node); if (!h) return false;
    nodes.push(...k.store.ownedOf(node));
    if (h.origin.by === 'member' && h.origin.owner === event
      && ((h.origin.slot === 'participants' && h.origin.index >= facts.participants.length)
        || (h.origin.slot === 'witnesses' && h.origin.index >= facts.witnesses.length))) return false;
    for (const slot of k.schema.kind(h.kind).slots.filter((s) => fields.test(s.key)))
      if (slot.temporal || slot.conditioned || slot.derive || slot.mode === 'mirrored') return false;
    for (const c of k.store.contributionsNaming(node).filter((c) => c.target.slot === '*' || fields.test(c.target.slot)))
      if (c.form.f !== 'const' || c.mode !== 'constrain' || c.target.where?.length || c.valid.from !== undefined || c.valid.to !== undefined) return false;
    for (const p of k.store.pinsOfNode(node)) if (fields.test(p.slot) && p.region !== undefined) return false;
  }
  return true;
}
export function exposure(l2: Layer2, event: Id): { grade: ExposureGrade; at: number; play?: number } | undefined {
  l2.k.persistence.recoverIfSaved(event);
  const cache = negativeExposures(l2), receipts = [...l2.global.receipts, ...l2.all().flatMap((i) => i.st.receipts)];
  if (cache.has(event) && !receipts.some((r) => r.cites.includes(event))) return undefined;
  const facts = eventFacts(l2, event);
  if (!facts) return undefined;
  const entries: Array<{ grade: ExposureGrade; at: number; play?: number }> = [];
  const observedAt = l2.k.observedAt(event, l2.k.now);
  const agents = agentRoles(l2, facts.kind);
  if (facts.participants.some((p) => p.who === l2.k.vId && agents.includes(p.role))) entries.push({ grade: 'confirmed', at: facts.time });
  else if (facts.witnesses.includes(l2.k.vId)) entries.push({ grade: 'presented', at: facts.time });
  if (observedAt !== undefined) entries.push({ grade: 'presented', at: observedAt });
  for (const r of receipts)
    if (r.cites.includes(event)) entries.push({ grade: r.grade, at: r.presentedAt ?? r.at, play: r.playTotal });
  if (!entries.length) { if (remainsUnexposed(l2, event, facts)) cache.add(event); return undefined; }
  const grade = entries.reduce((best, e) => rank[e.grade] > rank[best] ? e.grade : best, entries[0].grade);
  const visible = entries.filter((e) => rank[e.grade] >= rank.presented);
  const at = Math.min(...(visible.length ? visible : entries).map((e) => e.at));
  const fromReceipt = entries.filter((e) => e.grade === grade && e.play !== undefined).sort((a, b) => a.at - b.at)[0];
  return { grade, at, ...(fromReceipt ? { play: fromReceipt.play } : {}) };
}
export function responseOf(l2: Layer2, event: Id): { seed: Id; beat: string; kind: string; stance?: Stance } | undefined {
  l2.k.persistence.recoverIfSaved(event);
  for (const inst of l2.all()) {
    const r = inst.st.record.find((r) => r.kind === 'response' && r.data.event === event);
    if (r && typeof r.data.beat === 'string' && typeof r.data.kind === 'string') return {
      seed: inst.id, beat: r.data.beat, kind: r.data.kind, ...(typeof r.data.stance === 'string' ? { stance: r.data.stance as Stance } : {}),
    };
  }
  return undefined;
}
export function realisedBy(l2: Layer2, event: Id): Array<{ fn: string; args: Record<string, Id> }> {
  l2.k.persistence.recoverIfSaved(event);
  for (const inst of l2.all()) {
    const closure = inst.st.record.find((r) => r.kind === 'closure' && r.data.event === event);
    if (!closure) continue;
    const by = closure.data.by;
    return (inst.st.document.realises ?? []).filter((r) => r.by === by).flatMap((r) => {
      const j = l2.reg.patterns.get(r.pattern)?.junctures[r.juncture];
      if (!j) return [];
      const args: Record<string, Id> = {};
      for (const [a, v] of Object.entries(j.args)) {
        const role = r.binds[v];
        const n = role === 'v' ? l2.k.vId : inst.st.roles[role]?.cast;
        if (n) args[a] = n;
      }
      return [{ fn: j.fn, args }];
    });
  }
  return [];
}
export function realising(l2: Layer2, pattern: string, juncture: string): Array<{ seed: Id; binds: Record<string, Id> }> {
  return l2.all().filter((i) => !isTerminal(i.st.state)).flatMap((i) =>
    (i.st.document.realises ?? []).filter((r) => r.pattern === pattern && r.juncture === juncture).map((r) => ({
      seed: i.id, binds: Object.fromEntries(Object.entries(r.binds).flatMap(([v, role]) => {
        const n = role === 'v' ? l2.k.vId : i.st.roles[role]?.cast; return n ? [[v, n]] : [];
      })),
    })));
}
export function beatFunction(l2: Layer2, seed: Id, beat: string): { fn: string; args: Record<string, Id> } | undefined {
  l2.k.persistence.recoverIfSaved(seed);
  const i = l2.instance(seed);
  if (!i) return undefined;
  const implicit = implicitPattern(i.st.document, (ref) => i.st.closure.fragments.find((f) => f.id === ref.replace(/^pack:/, '')),
    l2.reg.patterns, l2.reg.vocabulary, (kind) => l2.k.eventKinds.eventKind(kind));
  const j = implicit.junctures[beat];
  if (!j) return undefined;
  return { fn: j.fn, args: Object.fromEntries(Object.entries(j.args).flatMap(([a, role]) => {
    const n = role === 'v' ? l2.k.vId : i.st.roles[role]?.cast; return n ? [[a, n]] : [];
  })) };
}

export function mintedBy(l2: Layer2, event: Id): { seed: Id; by: string } | undefined {
  const header = l2.k.persistence.restoreReferencedHeader(event);
  if (header?.origin.by !== 'minted') return undefined;
  const inst = l2.instance(header.origin.creator);
  if (!inst) return undefined;
  const entry = inst.st.record.find((r) => r.kind === 'minted' && r.data.event === event);
  if (!entry) return undefined;
  const by = entry.data.by === 'beat' || entry.data.by === 'fragment' ? entry.data.beat : entry.data.by;
  return typeof by === 'string' ? { seed: inst.id, by } : undefined;
}

export function exposedNodeAt(l2: Layer2, node: Id, atLeast: ExposureGrade): number | undefined {
  l2.k.persistence.recoverIfSaved(node);
  const times: number[] = [];
  const names = (event: Id): boolean => {
    if (event === node) return true;
    const facts = eventFacts(l2, event);
    return facts?.place === node || !!facts?.participants.some((p) => p.who === node);
  };
  for (const event of l2.k.events.canonEvents()) {
    const e = exposure(l2, event);
    if (e && rank[e.grade] >= rank[atLeast] && names(event)) times.push(e.at);
  }
  for (const r of [...l2.global.receipts, ...l2.all().flatMap((i) => i.st.receipts)]) {
    if (rank[r.grade] < rank[atLeast]) continue;
    const inst = l2.instance(r.seed), d = inst?.st.deliveries.find((d) => d.id === r.delivery);
    if (Object.values(r.cue).includes(node) || r.cites.some(names) || (d && Object.values(d.bindings).includes(node)))
      times.push(atLeast === 'confirmed' ? r.at : r.presentedAt ?? r.at);
  }
  return times.length ? Math.min(...times) : undefined;
}
