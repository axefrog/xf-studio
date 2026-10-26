// Static pack checks, S2 L-144–159. This module never reads a live world.
import { canonicalEqual } from '../canon.ts';
import { bound } from './doc.ts';
import type { Finding } from './types.ts';
import type { Juncture, Pattern, PatternChange, RelReq, Vocabulary } from './pattern-types.ts';

export interface PatternLimits { maxJunctures: number; maxEdges: number; maxWithin: number }
export interface PatternReport { findings: Finding[]; abstraction: number }
export const patternLimits: PatternLimits = { maxJunctures: 8, maxEdges: 12, maxWithin: 90 * 86400 };
const kinds = new Set(['person', 'group', 'actor', 'place', 'item', 'fact', 'event']);
const links = new Set(['because', 'motive', 'enables', 'but', 'reveals', 'answers', 'forecloses']);
const variables = (value: unknown): string[] => typeof value === 'string' ? (value.startsWith('?') ? [value] : [])
  : Array.isArray(value) ? value.flatMap(variables)
  : value && typeof value === 'object' ? Object.values(value).flatMap(variables) : [];
const term = (r: RelReq): Extract<RelReq, { rel: string }> => 'not' in r ? term(r.not) : r;
export function actingArgument(j: Juncture, v: Vocabulary): string | undefined {
  return Object.entries(v.functions[j.fn]?.args ?? {}).find(([, k]) =>
    (Array.isArray(k) ? k : [k]).some((x) => ['actor', 'person', 'group'].includes(x)))?.[0];
}
export function abstractionIndex(p: Pattern): number {
  const rs = Object.values(p.roles), js = Object.values(p.junctures);
  const open = rs.filter((r) => bound(r.identity).status !== 'fixed').length
    + js.filter((j) => bound(j.fill).status !== 'fixed').length
    + js.filter((j) => !j.realise?.length || j.realise.some((r) =>
      'wait' in r || ('offer' in r && !r.offer.kit) || ('nudge' in r && !r.nudge.kit))).length;
  return open / Math.max(1, rs.length + 2 * js.length);
}

/** Function entailments used by the refinement contract; all other changes need child evidence. */
function entailed(c: PatternChange, j: Juncture): boolean {
  if (j.fn === 'transfer') {
    if ('begins' in c && c.begins === 'hold') return c.args.who === j.args.to && c.args.what === j.args.what;
    if ('ends' in c && c.ends === 'hold') return c.args.who === j.args.from && c.args.what === j.args.what;
    if ('frame' in c) return c.frame.of === j.args.to && c.frame.toward === j.args.what && c.frame.status === 'satisfied';
  }
  if (j.fn === 'repay' && 'ends' in c && c.ends === 'obligate')
    return c.args.debtor === j.args.debtor && c.args.creditor === j.args.creditor;
  return false;
}
function mapped(value: unknown, binds: Record<string, string>): unknown {
  if (typeof value === 'string') return binds[value] ?? value;
  if (Array.isArray(value)) return value.map((x) => mapped(x, binds));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, mapped(x, binds)]));
  return value;
}

export function lintPattern(p: Pattern, vocabulary: Vocabulary, library: readonly Pattern[] = [p], limits = patternLimits): PatternReport {
  const findings: Finding[] = [];
  const fail = (n: number, at: string, message: string, level: Finding['level'] = 'error') => {
    if (!findings.some((f) => f.code === `L-${n}` && f.at === at && f.level === level))
      findings.push({ code: `L-${n}`, at, message, level });
  };
  const js = p.junctures, names = Object.keys(js), edges = p.edges.filter((e) => e.link !== 'forecloses');
  const descendants = (starts: string[], blocked = new Set<string>()): Set<string> => {
    const seen = new Set<string>(), todo = starts.slice();
    while (todo.length) {
      const k = todo.shift()!;
      if (seen.has(k) || blocked.has(k)) continue;
      seen.add(k);
      for (const e of edges) if (e.from === k) todo.push(e.to);
    }
    return seen;
  };
  const cyclic = names.some((k) => edges.some((e) => e.from === k && descendants([e.to]).has(k)));
  if (cyclic || names.length > limits.maxJunctures || p.edges.length > limits.maxEdges
    || p.edges.some((e) => !js[e.from] || !js[e.to]))
    fail(144, 'edges', 'Expected a bounded acyclic graph with known endpoints (foreclosures excluded from cycles).');
  if (!p.entry.length) fail(145, 'entry', 'A pattern needs an entry.');
  const canBeActor = (v: string): boolean => {
    const r = p.roles[v];
    return !!r && (Array.isArray(r.kind) ? r.kind : [r.kind]).some((k) => ['person', 'group', 'actor'].includes(k));
  };
  const mayBeV = (v: string | undefined): boolean => !!v && p.roles[v]?.v === 'may';
  const bindsAt = (j: Juncture): Set<string> => {
    const boundVars = new Set([...variables(j.args), ...Object.values(j.binds ?? {})]);
    // Relation search can add bindings only from a searchable bound argument.
    // Negated terms test truth and never supply records.
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of j.requires ?? []) {
        if ('not' in r) continue;
        const rel = vocabulary.relations[r.rel];
        if (!rel) continue;
        const searchable = (rel.searchFrom ?? []).some((arg) => {
          const value = r.args[rel.args.indexOf(arg)];
          return value && (!value.startsWith('?') || boundVars.has(value)
            || bound(p.roles[value]?.identity).status === 'fixed');
        });
        if (searchable) for (const v of variables(r.args)) if (!boundVars.has(v)) { boundVars.add(v); changed = true; }
      }
    }
    return boundVars;
  };
  for (const key of p.entry) {
    const j = js[key];
    if (!j || ![...bindsAt(j)].some(canBeActor)) fail(145, `entry.${key}`, 'An entry must bind a person or group.');
    else if (!j.requires?.length && bound(j.fill).status !== 'fixed')
      fail(145, `entry.${key}`, 'Generic entry: no requirement or fixed filler narrows this function.', 'warning');
  }
  const checkVars = (value: unknown, at: string): void => {
    for (const v of variables(value)) if (!p.roles[v]) fail(146, at, `Undeclared variable ${v}.`);
  };
  const checkReq = (r: RelReq, at: string): void => {
    const t = term(r);
    if (!vocabulary.relations[t.rel]) fail(146, at, `Unknown relation ${t.rel}.`);
    checkVars(t.args, at);
  };
  for (const [v, role] of Object.entries(p.roles)) {
    if ((Array.isArray(role.kind) ? role.kind : [role.kind]).some((k) => !kinds.has(k))) fail(146, `roles.${v}`, 'Unknown role kind.');
    for (const r of [...(role.must ?? []), ...(role.prefer ?? []).map((x) => x.r)]) checkReq(r, `roles.${v}`);
    if (!Object.values(js).some((j) => bindsAt(j).has(v))) fail(147, `roles.${v}`, 'No juncture binds this variable.');
  }
  for (const e of p.edges) if (!links.has(e.link)) fail(146, 'edges', `Unknown link ${e.link}.`);
  for (const [key, j] of [...Object.entries(js), ...(p.unless ?? []).map((u, i) => [`unless.${i}`, u.juncture] as const)]) {
    const fn = vocabulary.functions[j.fn];
    if (!fn || Object.keys(j.args).some((a) => !(a in fn.args))) fail(146, `junctures.${key}`, 'Unknown function or argument.');
    checkVars(j.args, `junctures.${key}.args`);
    checkVars(j.changes, `junctures.${key}.changes`);
    checkVars(Object.values(j.binds ?? {}), `junctures.${key}.binds`);
    for (const r of j.requires ?? []) checkReq(r, `junctures.${key}.requires`);
    if (j.v === 'offer') {
      // Compliance fills this juncture. Refusal/unanswered leave it open: another
      // branch or a timed outcome must still be reachable without filling it.
      const roots = names.filter((k) => !edges.some((e) => e.to === k));
      const alternatives = descendants([...p.entry, ...roots].filter((x) => x !== key), new Set([key]));
      const compliant = descendants([key]);
      if (!Object.values(p.outcomes).some((o) => o.reached.some((k) => compliant.has(k)))
        || !Object.values(p.outcomes).some((o) => !!o.after || o.reached.every((k) => alternatives.has(k))))
        fail(148, `junctures.${key}`, 'A protagonist juncture needs an outcome after compliance, refusal and no answer.');
    }
    for (const c of j.changes ?? [])
      if ('belief' in c && mayBeV(c.belief.who) && (!c.when || !('npc' in c.when) || c.when.npc !== c.belief.who))
        fail(149, `junctures.${key}.changes`, 'A possible protagonist belief needs its npc guard.');
    for (const r of j.realise ?? []) {
      if ('refine' in r) {
        const child = library.find((c) => c.id === r.refine.pattern), outcome = child?.outcomes[r.refine.outcome];
        const produces = outcome?.produces?.some((f) => f.fn === j.fn &&
          Object.entries(j.args).every(([a, v]) => mapped(f.args[a], r.refine.binds) === v));
        const childChanges = outcome?.reached.flatMap((k) => child?.junctures[k]?.changes ?? []).map((c) => mapped(c, r.refine.binds)) ?? [];
        if (!produces || variables(j.args).some((v) => !Object.values(r.refine.binds).includes(v))
          || (j.changes ?? []).some((c) => !entailed(c, j) && !childChanges.some((cc) => canonicalEqual(cc, c))))
          fail(150, `junctures.${key}.realise`, 'Refinement does not produce the function, cover its arguments and establish its changes.');
      }
      const actor = j.args[actingArgument(j, vocabulary) ?? ''];
      if (('nudge' in r && (!actor || mayBeV(actor)))
        || ('offer' in r && !(j.v === 'offer' || (j.fn === 'ask' && mayBeV(j.args.of)) || (actor && !mayBeV(actor)))))
        fail(159, `junctures.${key}.realise`, 'Realisation would assign the protagonist an unchosen act.');
    }
    if ((p.family === 'shape' && j.realise !== undefined) || (j.fn === 'story' && !j.binds))
      fail(151, `junctures.${key}`, 'Shapes only recognise; story junctures need binds.');
    if (j.join && typeof j.join === 'object' && [...j.join.all, ...j.join.any].some((k) => !edges.some((e) => e.from === k && e.to === key)))
      fail(152, `junctures.${key}.join`, 'A join names a juncture with no incoming edge.');
  }
  for (const [name, o] of Object.entries(p.outcomes)) {
    const refs = [...o.reached, ...(o.foreclosed ?? []), ...(o.aftermath?.junctures ?? [])];
    if (refs.some((k) => !js[k])) fail(155, `outcomes.${name}`, 'Outcome names an unknown juncture.');
    for (const f of o.produces ?? [])
      if (!vocabulary.functions[f.fn] || variables(f.args).some((v) => !p.roles[v]))
        fail(155, `outcomes.${name}.produces`, 'Unknown function or variable in produces.');
    if (o.next?.some((id) => !library.some((p) => p.id === id))) fail(155, `outcomes.${name}.next`, 'Unknown next pattern.', 'warning');
    // A timed outcome is armed, rather than fixed, while downstream fillers can
    // still choose another outcome. A multi-reached outcome requires all of its
    // junctures; being downstream of just one does not put a node after it.
    const after = o.after ? new Set<string>() : new Set(names.filter((k) =>
      o.reached.length > 0 && o.reached.every((r) => descendants([r]).has(k))));
    const without = descendants(p.entry, new Set(o.reached));
    for (const k of after) if (!o.reached.includes(k) && !without.has(k) && !(o.aftermath?.junctures ?? []).includes(k))
      fail(153, `outcomes.${name}.${k}`, 'A juncture only reachable after this outcome must be in its aftermath.');
  }
  if ((p.use ?? 'library') === 'library' && (Object.values(p.roles).some((r) => bound(r.identity).status === 'fixed')
    || Object.values(js).filter((j) => bound(j.fill).status !== 'fixed').length < names.length / 2))
    fail(154, 'roles', 'Library patterns need open identities and at least half their fillers open.');
  for (const k of p.escalation ?? []) if (!js[k] || !actingArgument(js[k], vocabulary)) fail(156, 'escalation', 'Escalation needs a known juncture with an acting argument.');
  if (p.show.junctures.some((k) => !js[k]) || p.show.edges > p.edges.length) fail(157, 'show', 'Show exceeds the graph.');
  if ((p.within && (!(p.within.days > 0) || !Number.isFinite(p.within.days) || p.within.days * 86400 > limits.maxWithin))
    || (p.once ?? []).some((v) => p.entry.some((k) => !js[k] || !bindsAt(js[k]).has(v))))
    fail(158, 'once', 'Every entry must bind once variables; within must fit the time bound.');
  return { findings, abstraction: abstractionIndex(p) };
}
