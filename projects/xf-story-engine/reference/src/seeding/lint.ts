// The lint (S2 section 11.1): the checks the first implementation builds (section 0.3), over a compiled
// document and the fragments and text units it references.
//
// Each finding is plain English for an author, points at a document path, and says what the check did not
// look at. Checks that would break the engine are `engine` findings and refuse a seed at any maturity; the
// others refuse only a seed marked `ready` (S2 section 11.1: below `ready`, only checks that would break the
// engine refuse a seed in the lab).

import { canonicalEqual } from '../canon.ts';
import { rootId } from '../id.ts';
import type { Schema } from '../schema.ts';
import { atoms, bound, effectSites, fragmentSites, playOf, predSites, type EffectSite } from './doc.ts';
import type { PackIndex } from './packs.ts';
import { barredRoles } from './floors.ts';
import { L2Registry, type PortReport } from './registries.ts';
import { compare, walkPred } from './pred.ts';
import type {
  CompiledSeed, EffectDecl, Finding, FactsTable, Fragment, Pack, Pred, Role, RolePredicate, TextUnit,
} from './types.ts';

export interface LintCtx {
  pack: PackIndex;
  facts: FactsTable;
  reg: L2Registry;
  schema: Schema;
  capabilities: ReadonlySet<string>;
  portReport?: PortReport;
  /** [tunable 4] */
  maxLive: number;
  /** [tunable 64] */
  watchMax: number;
  /** Names of facts that record a relationship's status elsewhere (L-16). */
  relationshipFacts?: ReadonlySet<string>;
  /** Template ids of ladder seeds, for the same check. */
  ladderTemplates?: ReadonlySet<string>;
  /** The world seed, to recognise root actors by Id (L-56). */
  worldSeed?: string;
}

const ROOT_NAMES = new Set(['director', 'city', 'v']);
const MODEL_SETTINGS = ['noticing', 'exclusions', 'softExclusions', 'modelFloor', 'reset'];
const TRIVIAL: ReadonlySet<string> = new Set(['yes', 'no']);

class Out {
  readonly list: Finding[] = [];
  add(level: 'error' | 'warning', code: string, message: string, at?: string, extra: { engine?: boolean; notChecked?: string; fix?: string } = {}): void {
    const f: Finding = { code, level, message };
    if (at !== undefined) f.at = at;
    if (extra.engine) f.engine = true;
    if (extra.notChecked) f.notChecked = extra.notChecked;
    if (extra.fix) f.fix = extra.fix;
    this.list.push(f);
  }
  error(code: string, message: string, at?: string, extra?: { engine?: boolean; notChecked?: string; fix?: string }): void {
    this.add('error', code, message, at, extra);
  }
  warn(code: string, message: string, at?: string, extra?: { engine?: boolean; notChecked?: string; fix?: string }): void {
    this.add('warning', code, message, at, extra);
  }
}

/**
 * The beats a start beat can lead to (S2 section 7.1): a beat with chain links is reached through them (`join` decides how many),
 * a beat a failure leads to is reached when the failing beat is, and a beat with no chain links that is neither in `start` nor led to
 * becomes available on its fragment's `needs` alone, so it counts as reachable. The lint's L-44 and the fit report share this.
 */
export function reachableBeats(c: CompiledSeed): Set<string> {
  const reach = new Set<string>(c.start);
  const ledBy = (key: string): string[] => Object.entries(c.beats).filter(([, b]) => (b.failure ?? []).some((f) => f.leadsTo === key)).map(([k]) => k);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [k, b] of Object.entries(c.beats)) {
      if (reach.has(k)) continue;
      const srcs = (b.links ?? []).filter((l) => 'because' in l || 'then' in l).map((l) => ('because' in l ? l.because : (l as { then: string }).then));
      const led = ledBy(k);
      let ok: boolean;
      if (srcs.length === 0) ok = led.length === 0 || led.some((s) => reach.has(s));
      else {
        ok = (b.join ?? 'all') === 'any' ? srcs.some((s) => reach.has(s)) : srcs.every((s) => reach.has(s));
        if (ok && led.length > 0) ok = led.some((s) => reach.has(s));
      }
      if (ok) {
        reach.add(k);
        changed = true;
      }
    }
  }
  return reach;
}

/** Every role a predicate argument names with `{ role }`. */
export function argRoles(arg: unknown, out: string[] = []): string[] {
  if (Array.isArray(arg)) arg.forEach((a) => argRoles(a, out));
  else if (typeof arg === 'object' && arg !== null) {
    const o = arg as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.role === 'string') out.push(o.role);
    else for (const v of Object.values(o)) argRoles(v, out);
  }
  return out;
}

/** The roles another role's requirements and scope name (S2 section 5.1). */
export function roleDeps(role: Role): string[] {
  const out: string[] = [];
  for (const m of role.must ?? []) argRoles(m.arg, out);
  for (const p of role.prefer ?? []) argRoles(p.p.arg, out);
  const sc = role.scope;
  if (sc && typeof sc === 'object') {
    if ('under' in sc && typeof sc.under === 'string' && !/^[0-9a-f]{32}$/.test(sc.under) && !sc.under.startsWith('root:')) out.push(sc.under);
    if ('nodes' in sc) for (const n of sc.nodes) if (!/^[0-9a-f]{32}$/.test(n) && !n.startsWith('root:')) out.push(n);
  }
  return out;
}

/** Placeholders `{role.attr}` (or `{role}`, which is the role's name) in a text. */
export function placeholders(text: string): Array<{ role: string; attr: string }> {
  const out: Array<{ role: string; attr: string }> = [];
  for (const m of text.matchAll(/\{([A-Za-z][A-Za-z0-9-]*)(?:\.([A-Za-z][A-Za-z0-9-]*))?\}/g)) out.push({ role: m[1]!, attr: m[2] ?? 'name' });
  return out;
}

/** Whether a role's requirements guarantee a value for a slot path: a fixed identity, or an `eq`/`in` term on it. */
export function guarantees(role: Role, path: string): boolean {
  const b = bound(role.identity);
  if (b.status === 'fixed') return true;
  return (role.must ?? []).some((m) => m.path === path && (m.op === 'eq' || m.op === 'in'));
}

export const guaranteesAdult = (role: Role): boolean =>
  (role.must ?? []).some((m) => m.path === 'age-class' && ((m.op === 'eq' && m.arg === 'adult') || (m.op === 'in' && Array.isArray(m.arg) && m.arg.length > 0 && m.arg.every((a) => a === 'adult'))));

const LEXICON_FEELINGS = /\byou (?:feel|felt|want(?:ed)?|are (?:afraid|scared|angry|sad|ashamed|jealous)|fear(?:ed)?|hope(?:d)?|secretly|really (?:want|wish|think|feel)|wish(?:ed)?)\b/i;
const LEXICON_REPROACH = /\b(?:you should have|you always|you never|shame on you|what is wrong with you|what's wrong with you|how could you)\b/i;
const LEXICON_NOT_CHECKED = 'wit, freshness, stereotype by meaning, and whether the line lands';

export function lintSeed(c: CompiledSeed, ctx: LintCtx): Finding[] {
  const out = new Out();
  const roles = Object.keys(c.roles);
  const beatKeys = new Set(Object.keys(c.beats));
  const fragOf = (ref: string): Fragment | undefined => ctx.pack.fragment(ref);
  const seedFragments = (): Array<{ beat: string; ref: string; frag: Fragment }> => {
    const res: Array<{ beat: string; ref: string; frag: Fragment }> = [];
    for (const [k, b] of Object.entries(c.beats)) {
      for (const ref of playOf(b).refs) {
        const f = fragOf(ref);
        if (f) res.push({ beat: k, ref, frag: f });
      }
    }
    return res;
  };
  const frags = seedFragments();
  const closure = ctx.pack.closure(c);
  const effects = effectSites(c, fragOf);
  const sites = [...predSites(c), ...closure.fragments.flatMap((f) => fragmentSites(f))];

  // ---- L-01: names ----
  const undeclaredRole = (r: string, at: string): void => {
    if (!c.roles[r]) out.error('L-01', `"${r}" is not a role of this seed.`, at, { engine: true, fix: `Declare the role "${r}", or name one of: ${roles.join(', ') || 'none'}.` });
  };
  const roleOrId = (r: unknown, at: string): void => {
    if (typeof r === 'string' && r !== 'v' && !/^[0-9a-f]{32}$/.test(r) && !r.startsWith('root:') && !r.startsWith('game:')) undeclaredRole(r, at);
  };
  for (const site of sites) {
    for (const { atom, at } of atoms(site.pred)) {
      const where = `${site.at}${at}`;
      if ('fact' in atom) {
        if (!ctx.facts[atom.fact]) out.error('L-01', `The game fact "${atom.fact}" is not in the facts table.`, where, { engine: true, fix: 'Add it to the facts table, or read a fact that is in it.' });
      } else if ('decided' in atom) {
        if (!ctx.facts[atom.decided]) out.error('L-01', `The game fact "${atom.decided}" is not in the facts table.`, where, { engine: true });
      } else if ('seedFact' in atom) {
        if (!c.facts?.[atom.seedFact]) out.error('L-01', `"${atom.seedFact}" is not a fact of this seed.`, where, { engine: true, fix: `Declare "${atom.seedFact}" under facts.` });
      } else if ('role' in atom) {
        undeclaredRole(atom.role, where);
        for (const r of argRoles(atom.p.arg)) undeclaredRole(r, where);
      } else if ('cast' in atom) undeclaredRole(atom.cast, where);
      else if ('beat' in atom) {
        if (!beatKeys.has(atom.beat)) out.error('L-01', `"${atom.beat}" is not a beat of this seed.`, where, { engine: true });
      } else if ('response' in atom) {
        if (!beatKeys.has(atom.response)) out.error('L-01', `"${atom.response}" is not a beat of this seed.`, where, { engine: true });
      } else if ('since' in atom && 'atLeast' in atom) {
        if ('beat' in atom.since && !beatKeys.has(atom.since.beat)) out.error('L-01', `"${atom.since.beat}" is not a beat of this seed.`, where, { engine: true });
      } else if ('count' in atom) {
        if (atom.since && 'beat' in atom.since && !beatKeys.has(atom.since.beat)) out.error('L-01', `"${atom.since.beat}" is not a beat of this seed.`, where, { engine: true });
        const pat = atom.count;
        roleOrId(pat.participant, where);
        roleOrId(pat.place, where);
        roleOrId(pat.witnessedBy, where);
      } else if ('believes' in atom) {
        undeclaredRole(atom.believes.who, where);
        roleOrId(atom.believes.of, where);
      } else if ('fn' in atom) {
        if (!ctx.reg.pred(atom.fn.name, atom.fn.version)) out.error('L-01', `The predicate function "${atom.fn.name}@${atom.fn.version}" is not registered.`, where, { engine: true });
      }
    }
  }
  for (const k of c.start) if (!beatKeys.has(k)) out.error('L-01', `The start beat "${k}" is not a beat of this seed.`, `start`, { engine: true });
  for (const [k, b] of Object.entries(c.beats)) {
    for (const [i, l] of (b.links ?? []).entries()) {
      const ref = 'because' in l ? l.because : 'obstructedBy' in l ? l.obstructedBy : l.then;
      if (!beatKeys.has(ref)) out.error('L-01', `The link names "${ref}", which is not a beat of this seed.`, `beats.${k}.links[${i}]`, { engine: true });
    }
    for (const [i, f] of (b.failure ?? []).entries()) {
      if (!beatKeys.has(f.leadsTo)) out.error('L-01', `The failure leads to "${f.leadsTo}", which is not a beat of this seed.`, `beats.${k}.failure[${i}]`, { engine: true });
    }
    for (const [fr, sr] of Object.entries(b.bind ?? {})) undeclaredRole(sr, `beats.${k}.bind.${fr}`);
  }
  for (const e of effects) {
    const x = e.effect;
    if ('fact' in x && !c.facts?.[x.fact]) out.error('L-01', `"${x.fact}" is not a fact of this seed.`, e.at, { engine: true, fix: `Declare "${x.fact}" under facts.` });
    if ('kernel' in x) undeclaredRole(x.kernel.on, e.at);
    if ('game' in x && !ctx.facts[x.game.fact]) out.error('L-01', `The game fact "${x.game.fact}" is not in the facts table.`, e.at, { engine: true });
  }
  for (const [i, w] of (c.world ?? []).entries()) {
    if ('role' in w.target) undeclaredRole(w.target.role, `world[${i}].target`);
  }
  for (const [k, r] of Object.entries(c.roles)) {
    if (!ctx.schema.hasKind(r.kind)) out.error('L-01', `The role "${k}" has the kind "${r.kind}", which the schema does not have.`, `roles.${k}.kind`, { engine: true });
    for (const d of roleDeps(r)) undeclaredRole(d, `roles.${k}`);
    for (const eff of r.goal?.effects ?? []) roleOrId(eff.on, `roles.${k}.goal`);
  }
  for (const [i, p] of (c.promises ?? []).entries()) if (!beatKeys.has(p.opens)) out.error('L-01', `The promise opens at "${p.opens}", which is not a beat of this seed.`, `promises[${i}]`, { engine: true });

  // ---- L-03, L-04, L-44: the graph ----
  const thens: Array<{ from: string; to: string }> = [];
  let allThen = 0;
  for (const [k, b] of Object.entries(c.beats)) {
    const ls = b.links ?? [];
    for (const [i, l] of ls.entries()) {
      if ('then' in l) {
        thens.push({ from: l.then, to: k });
        const tk = b.kind ?? 'texture';
        if (tk !== 'texture') out.error('L-03', `The beat "${k}" is a ${tk} beat reached by a plain "then" link. Plain order is allowed only into texture beats; use "because" with a condition.`, `beats.${k}.links[${i}]`);
      }
    }
    if (ls.length > 0 && ls.every((l) => 'then' in l)) allThen++;
  }
  if (allThen > 2) out.error('L-03', `${allThen} beats are reached only by plain "then" links. A seed with more than two beats ordered only by "then" is a script, not a graph: link with "because" and a condition.`, 'beats');

  // Depth levels: a static bound on the beats that can be live at once.
  const depth = new Map<string, number>();
  const depthOf = (k: string, seen: Set<string> = new Set()): number => {
    const d = depth.get(k);
    if (d !== undefined) return d;
    if (seen.has(k)) return 0;
    seen.add(k);
    const srcs = (c.beats[k]?.links ?? []).flatMap((l) => ('because' in l ? [l.because] : 'then' in l ? [l.then] : []));
    const v = srcs.length === 0 ? 0 : 1 + Math.max(...srcs.map((s) => (beatKeys.has(s) ? depthOf(s, seen) : 0)));
    depth.set(k, v);
    return v;
  };
  // Beats that obstruct each other are never live together: each obstruction group at a depth counts once.
  const levels = new Map<number, string[]>();
  for (const k of beatKeys) levels.set(depthOf(k), [...(levels.get(depthOf(k)) ?? []), k]);
  let live = 0;
  for (const members of levels.values()) {
    const parent = new Map<string, string>(members.map((m) => [m, m]));
    const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
    for (const m of members) for (const l of c.beats[m]!.links ?? []) if ('obstructedBy' in l && parent.has(l.obstructedBy)) parent.set(find(m), find(l.obstructedBy));
    live = Math.max(live, new Set(members.map(find)).size);
  }
  if (live > ctx.maxLive) out.warn('L-04', `Up to ${live} beats of this seed can be live at once; the limit is ${ctx.maxLive}. The engine will hold the extra beats back.`, 'beats');

  const reach = reachableBeats(c);
  for (const k of beatKeys) if (!reach.has(k)) out.warn('L-44', `No path from the start reaches the beat "${k}".`, `beats.${k}`);

  // ---- L-05, L-06: facts and choices ----
  const readsFact = (fact: string, preds: Array<Pred | undefined>): boolean => {
    let hit = false;
    for (const p of preds) if (p) walkPred(p, (n) => { if (typeof n !== 'string' && 'seedFact' in n && n.seedFact === fact) hit = true; });
    return hit;
  };
  const beatReads = (k: string): Array<Pred | undefined> => {
    const b = c.beats[k];
    if (!b) return [];
    const ps: Array<Pred | undefined> = [];
    for (const l of b.links ?? []) if ('because' in l) ps.push(l.on);
    if (b.objective) ps.push(b.objective.succeeds, b.objective.fails, b.objective.warns);
    for (const f of b.failure ?? []) ps.push(f.when, f.warnFirst);
    ps.push(b.reoffer?.when, b.aftermath?.cancelIf);
    for (const ref of playOf(b).refs) {
      const f = fragOf(ref);
      if (f) ps.push(f.needs as Pred | undefined, f.applies as Pred | undefined);
    }
    return ps;
  };
  // The responses the seed's links read, per offer beat: `action:<id>` names one action; `action` and `action:*` name them all ('*').
  const namedResponses = (beat: string): Set<string> => {
    const named = new Set<string>();
    for (const b of Object.values(c.beats)) {
      for (const l of b.links ?? []) {
        if (!('because' in l) || !l.on) continue;
        walkPred(l.on, (n) => {
          if (typeof n === 'string' || !('response' in n) || n.response !== beat) return;
          for (const x of n.is) {
            if (x === 'action' || x === 'action:*') named.add('*');
            else if (x.startsWith('action:')) named.add(x);
          }
        });
      }
    }
    return named;
  };
  const consumed = (fact: string): boolean => {
    const decl = c.facts?.[fact];
    const consumers = decl?.route?.consumers ?? [];
    for (const k of consumers) {
      if (k === 'end') { if (readsFact(fact, [c.end])) return true; continue; }
      if (beatKeys.has(k)) { if (readsFact(fact, beatReads(k))) return true; continue; }
      // A reward table keyed by the route reads it.
      if (effects.some((e) => 'reward' in e.effect && e.effect.reward.byRoute === fact && e.effect.reward.table === k)) return true;
    }
    return false;
  };
  for (const [k, d] of Object.entries(c.facts ?? {})) {
    if (d.route && !consumed(k)) {
      out.error('L-05', `The fact "${k}" is a route variable, but nothing that reads it is listed as its consumer.`, `facts.${k}.route`, { fix: `List a beat or the end condition that reads "${k}", or remove "route".` });
    }
  }
  for (const { beat, frag } of frags) {
    const o = frag.offer;
    if (!o || o.choice !== 'consequential') continue;
    const at = `fragments.${frag.id}.offer`;
    // S2 section 2.9 (L-06): every action has a consequence that something reads, either a write to a seed fact with a consumer or a
    // link whose `on` reads the response ({ response: beat, is: [action:<id>] }); and no two actions have the same consequence:
    // their writes, as sets of fact = value pairs, differ, or a response link tells them apart.
    const named = namedResponses(beat);
    const writesOf = (a: (typeof o.actions)[number]): string[] => (a.writes ?? []).flatMap((w) => ('fact' in w ? [w.set !== undefined ? `${w.fact}=${w.set}` : `${w.fact}+=${w.add ?? 0}`] : []));
    const readableOf = (a: (typeof o.actions)[number]): string[] => [
      ...(a.writes ?? []).flatMap((w) => ('fact' in w && consumed(w.fact) ? [w.set !== undefined ? `${w.fact}=${w.set}` : `${w.fact}+=${w.add ?? 0}`] : [])),
      ...(named.has(`action:${a.id}`) ? [`response:${a.id}`] : named.has('*') ? ['response:*'] : []),
    ];
    const withoutConsequence = o.actions.filter((a) => readableOf(a).length === 0).map((a) => a.id);
    const fullKey = (a: (typeof o.actions)[number]): string => JSON.stringify([...new Set([...writesOf(a), ...(named.has(`action:${a.id}`) ? [`response:${a.id}`] : named.has('*') ? ['response:*'] : [])])].sort());
    const keys = o.actions.map(fullKey);
    const same = o.actions.filter((a, i) => keys.indexOf(keys[i]!) !== i || keys.lastIndexOf(keys[i]!) !== i).map((a) => a.id);
    if (o.actions.length < 2) {
      out.error('L-06', `The offer in "${beat}" is a consequential choice with fewer than two actions. A choice that changes nothing is flavour.`, at, { fix: 'Give it a second action, or mark the choice "flavour".' });
    } else if (withoutConsequence.length > 0) {
      out.error('L-06', `The offer in "${beat}" is a consequential choice, but ${withoutConsequence.map((x) => `"${x}"`).join(', ')} ${withoutConsequence.length === 1 ? 'has' : 'have'} no consequence anything reads. An action needs a write to a seed fact with a consumer, or a link whose "on" reads its response.`, at, { fix: 'Give each action a "set" on a seed fact with a consumer, or a link that reads its response; or mark the choice "flavour".' });
    } else if (same.length > 0) {
      out.error('L-06', `The offer in "${beat}" is a consequential choice, but ${same.map((x) => `"${x}"`).join(', ')} ${same.length === 1 ? 'has' : 'have'} the same consequence as another action. Their writes have to differ, or a response link has to tell them apart.`, at, { fix: 'Write different values, or read each action\'s response in a link.' });
    }
  }

  // ---- L-07: failures with a warning ----
  for (const [k, b] of Object.entries(c.beats)) {
    for (const [i, f] of (b.failure ?? []).entries()) {
      let timed = false;
      walkPred(f.when, (n) => {
        if (typeof n === 'string') return;
        if ('since' in n && 'atLeast' in n) timed = true;
        else if ('hour' in n) timed = true;
        else if ('count' in n && (n.op === 'eq' || n.op === 'lt' || n.op === 'le')) timed = true;
        else if ('role' in n && (n.p.path === 'position' || n.p.path === 'place')) timed = true;
      });
      if (timed && f.warnFirst === undefined) {
        out.error('L-07', `The beat "${k}" can fail through distance, time or neglect without a warning first. Add "warnFirst".`, `beats.${k}.failure[${i}]`, { fix: 'Add a warnFirst predicate, so the player is told before they lose.' });
      }
    }
  }

  // ---- L-09: windows ----
  for (const [i, w] of c.windows.entries()) {
    if ((w.onClose === 'coda' || w.onClose === 'memory') && w.closeContent === undefined) out.error('L-09', `The window "${w.id}" ends with a ${w.onClose} but has no closeContent.`, `windows[${i}]`);
  }

  // ---- L-12: writes ----
  for (const e of effects) {
    const x = e.effect;
    if ('game' in x) {
      if (x.capability !== 'story.write-vanilla' || !ctx.capabilities.has('story.write-vanilla')) {
        out.error('L-12', 'This seed writes a game fact without the "story.write-vanilla" capability.', e.at, { engine: true, fix: 'Declare the capability, or write a seed fact instead.' });
      }
      if (x.persist === 'resettable') out.error('L-12', 'A write to a game fact is permanent: it cannot be marked resettable.', e.at, { engine: true });
    }
  }

  // ---- L-13: cycles among role references ----
  {
    const state = new Map<string, number>();
    const cycle: string[] = [];
    const visit = (r: string, stack: string[]): boolean => {
      state.set(r, 1);
      for (const d of roleDeps(c.roles[r]!)) {
        if (!c.roles[d]) continue;
        if (state.get(d) === 1) {
          cycle.push(...stack, r, d);
          return true;
        }
        if (!state.has(d) && visit(d, [...stack, r])) return true;
      }
      state.set(r, 2);
      return false;
    };
    for (const r of roles) if (!state.has(r) && visit(r, [])) break;
    if (cycle.length > 0) out.error('L-13', `Roles refer to each other in a circle (${[...new Set(cycle)].join(' -> ')}), so none can be cast first.`, 'roles', { engine: true });
  }

  // ---- L-14, L-26, L-30, L-41: beat shape (advice in the core) ----
  for (const [k, b] of Object.entries(c.beats)) {
    if (b.kind === 'decision' && (!b.decision || b.decision.stances.length < 3 || !b.decision.stances.includes('refuse'))) {
      out.warn('L-14', `The decision beat "${k}" should offer at least three stances, one of them "refuse".`, `beats.${k}.decision`);
    }
    if (b.kind === 'conclusion' && (b.conclusion?.clues.length ?? 0) < 3) out.warn('L-26', `The conclusion "${k}" has fewer than three clue routes.`, `beats.${k}.conclusion`);
    if (b.kind === 'obstacle') {
      const a = b.obstacle?.affordances ?? [];
      if (a.length < 2 || !a.some((x) => !x.combat)) {
        out.error('L-27', `The obstacle "${k}" needs at least two ways past it, and at least one that is not combat.`, `beats.${k}.obstacle`, { fix: 'Add an affordance with combat: false, or a second one.' });
      }
    }
    if ((b.kind === 'decision' || b.kind === 'aftermath' || b.kind === 'conclusion' || b.kind === 'exit') && b.role !== undefined) {
      out.error('L-41', `The ${b.kind} beat "${k}" has a "role", so a short form could drop it. These beats can never be dropped.`, `beats.${k}.role`);
    }
    if (b.inScene) {
      // An in-scene offer links `because` a beat whose fragment has the same `scene` label (S2 section 2.8, L-131a).
      const sceneOf = (beat: string): string[] => [...new Set(playOf(c.beats[beat]!).refs.map((r) => fragOf(r)?.scene ?? ''))];
      const mine = sceneOf(k);
      const offers = playOf(b).refs.some((r) => !!fragOf(r)?.offer);
      const sameScene = mine.length === 1 && mine[0] !== '' && (b.links ?? []).some((l) => {
        if (!('because' in l) || !beatKeys.has(l.because)) return false;
        const theirs = sceneOf(l.because);
        return theirs.length === 1 && theirs[0] === mine[0];
      });
      if (!offers || !sameScene) {
        out.error('L-131a', `The in-scene beat "${k}" has to be an offer that links "because" a beat whose fragment has the same scene label as its own. Give both fragments the same "scene", and link them.`, `beats.${k}.inScene`);
      }
    }
    if (b.kind !== undefined && b.kind !== 'texture') {
      const writes = (b.leaves ?? []).length + frags.filter((f) => f.beat === k).reduce((n, f) => n + (f.frag.leaves ?? []).length + (f.frag.offer ? 1 : 0), 0);
      if (writes === 0) out.warn('L-30', `The ${b.kind} beat "${k}" leaves no fact, so nothing records that it happened.`, `beats.${k}`);
    }
  }

  // ---- L-15: V's resources only through an accepted action ----
  for (const e of effects) {
    const x = e.effect;
    if ('reward' in x && e.origin !== 'action') out.error('L-15', 'A reward or a spend of V\'s resources has to follow from an action V accepts, not happen to them.', e.at, { engine: true });
  }
  for (const { frag } of frags) {
    const o = frag.offer;
    if (o && o.actions.length === 0 && o.stakes.some((s) => s.bearer === 'v')) {
      out.error('L-15', 'An offer puts a stake on V but has no action V can accept.', `fragments.${frag.id}.offer.stakes`, { engine: true });
    }
  }

  // ---- L-17, L-76: what text may name ----
  for (const [k, r] of Object.entries(c.roles)) {
    for (const a of r.textAttrs ?? []) {
      if (!guarantees(r, a)) out.error('L-17', `Text may name the "${a}" of the role "${k}", but nothing guarantees it: fix the identity or require it in "must".`, `roles.${k}.textAttrs`);
    }
  }
  for (const t of closure.texts) {
    for (const ph of placeholders(t.text)) {
      const r = c.roles[ph.role];
      if (!r) out.error('L-76', `The text "${t.id}" names the role "${ph.role}", which this seed does not have.`, `texts.${t.id}`);
      else if (!(r.textAttrs ?? []).includes(ph.attr)) {
        out.error('L-76', `The text "${t.id}" names the ${ph.attr} of "${ph.role}", which the role does not guarantee. List "${ph.attr}" in its textAttrs and make sure its requirements fix it.`, `texts.${t.id}`);
      }
    }
  }

  // ---- L-18, L-43: ladders and stand-ins ----
  for (const [k, r] of Object.entries(c.roles)) {
    const steps = r.onUnfilled ?? ['wait', 'withdraw'];
    const hasStandIn = steps.some((s) => s === 'standIn') || r.onLost === 'standIn';
    if (hasStandIn) {
      if (bound(r.identity).status === 'fixed') out.error('L-18', `The role "${k}" has a fixed identity, so it cannot be replaced by a stand-in.`, `roles.${k}`, { engine: true });
      else if (ctx.schema.hasKind(r.kind)) {
        for (const [i, m] of (r.must ?? []).entries()) {
          const info = !m.path.includes('/') ? ctx.schema.slotInfo(r.kind, m.path) : null;
          const ok = info && !info.isNode && info.vt.t !== 'ref' && !info.def.temporal && (m.op === 'eq' || m.op === 'in' || m.op === 'range');
          if (!ok) out.error('L-18', `A stand-in for "${k}" can only be built from simple requirements on its own slots, and "${m.path} ${m.op}" is not one.`, `roles.${k}.must[${i}]`, { engine: true });
        }
      }
    }
    steps.forEach((s, i) => {
      if (typeof s === 'object' && 'relax' in s) {
        const term = (r.must ?? [])[s.relax];
        if (term && (r.textAttrs ?? []).includes(term.path)) {
          out.error('L-43', `The ladder of "${k}" relaxes the requirement on "${term.path}", which the text relies on.`, `roles.${k}.onUnfilled[${i}]`);
        }
      }
    });
  }

  // ---- L-19, L-52, L-60: responses and attributions ----
  for (const f of closure.fragments) {
    for (const [i, r] of (f.responses ?? []).entries()) {
      const at = `fragments.${f.id}.responses[${i}]`;
      if (!r.because || String(r.because).trim() === '') out.error('L-19', 'A response needs a "because": the concern it answers.', at);
      if (r.attribution) {
        const needsBelief = r.needs !== undefined && (() => { let hit = false; walkPred(r.needs as Pred, (n) => { if (typeof n !== 'string' && 'believes' in n && n.believes.of === 'v') hit = true; }); return hit; })();
        const act = typeof r.to === 'string' || r.to.participant === 'v';
        if (!needsBelief || !act || !r.reply) {
          out.error('L-52', `An attribution line needs: a "believes" test on that character's belief about V, a "because" that names an act of V's, and a reply for V that can correct it${!needsBelief ? ' (missing: the believes test)' : ''}${!act ? ' (missing: an observed act of V)' : ''}${!r.reply ? ' (missing: V\'s reply)' : ''}.`, at);
        }
        if (!(r.replyWrites ?? []).some((w) => 'tells' in w)) {
          out.error('L-60', 'The correcting reply must write an observed telling, so the character\'s belief really changes.', at);
        }
      }
    }
  }

  // ---- L-20, L-21: text that states V's feelings (advice) ----
  for (const t of closure.texts) {
    const attribution = t.states === 'motive';
    if (!attribution && LEXICON_FEELINGS.test(t.text)) out.warn('L-20', `The text "${t.id}" seems to say what V feels, wants or fears. Only a character may say what they believe about V, and only as their own view.`, `texts.${t.id}`, { notChecked: LEXICON_NOT_CHECKED });
    if (!attribution && LEXICON_REPROACH.test(t.text)) out.warn('L-21', `The text "${t.id}" reproaches or judges V.`, `texts.${t.id}`, { notChecked: LEXICON_NOT_CHECKED });
  }

  // ---- L-28: what the game port cannot do (advice) ----
  if (ctx.portReport) {
    for (const f of closure.fragments) {
      if (f.channels.length > 0 && !f.channels.some((ch) => ctx.portReport!.channels.has(ch))) {
        out.warn('L-28', `The game cannot show "${f.id}" yet: none of its channels (${f.channels.join(', ')}) is available.`, `fragments.${f.id}.channels`);
      }
    }
    for (const e of effects) {
      if ('game' in e.effect && !ctx.portReport.capabilities.has('story.write-vanilla')) out.warn('L-28', 'The game cannot write game facts yet.', e.at);
    }
  }

  // ---- L-49 ... L-63: evidence and the model's firewall ----
  for (const f of closure.fragments) {
    if (f.statesCount) {
      let ok = false;
      for (const s of sites) walkPred(s.pred, (n) => { if (typeof n !== 'string' && 'count' in n && n.count.witnessedBy === f.statesCount!.witnessedBy) ok = true; });
      if (!ok) out.error('L-58', `The line in "${f.id}" states a count, but no "count" witnessed by ${f.statesCount.witnessedBy} backs it.`, `fragments.${f.id}.statesCount`);
    }
    if (f.callback) {
      const order = { ambient: 0, presented: 1, confirmed: 2 } as const;
      const declared = f.callback.atLeast;
      const cited = f.callback.cites.atLeast ?? 'confirmed';
      if (declared === 'ambient') out.error('L-62', `The callback in "${f.id}" cites something V only saw at the "ambient" grade; that grounds nothing.`, `fragments.${f.id}.callback`);
      else if (order[cited] < order[declared]) out.error('L-62', `The callback in "${f.id}" cites an event at a lower grade (${cited}) than it declares (${declared}).`, `fragments.${f.id}.callback`);
      else if (declared === 'presented' && !f.callback.hedged) out.error('L-62', `The callback in "${f.id}" rests on something V was only shown, so it must use the hedged wording ("you may have seen...").`, `fragments.${f.id}.callback`);
    }
  }
  for (const s of sites) {
    for (const { atom, at } of atoms(s.pred)) {
      if ('setting' in atom && MODEL_SETTINGS.some((m) => atom.setting === m || atom.setting.startsWith(`${m}.`))) {
        out.error('L-61', `A seed cannot read the setting "${atom.setting}": the player model's settings never shape what a seed means.`, `${s.at}${at}`, { engine: true });
      }
      if ('believes' in atom) {
        const who = atom.believes.who;
        const r = c.roles[who];
        const idn = r ? bound(r.identity).value : undefined;
        const rootNamed = (x: unknown): boolean => typeof x === 'string' && (ROOT_NAMES.has(x.replace(/^root:/, '')) || (ctx.worldSeed !== undefined && [...ROOT_NAMES].some((n) => x === rootId(ctx.worldSeed!, n))));
        if (ROOT_NAMES.has(who) || rootNamed(idn)) out.error('L-56', `The "believes" test names ${who}, a root actor. Only the belief of a character in the world can be tested; the director's model of V is out of reach.`, `${s.at}${at}`, { engine: true });
      }
      if ('fn' in atom) {
        const f = ctx.reg.pred(atom.fn.name, atom.fn.version);
        if (f?.readsDirectorBeliefs) out.error('L-57', `The predicate function "${atom.fn.name}" reads the director's belief about V, which no seed may do.`, `${s.at}${at}`, { engine: true });
        if (f?.forbidden) out.error('L-22', `The predicate function "${atom.fn.name}" is a guilt, streak or countdown mechanic.`, `${s.at}${at}`);
      }
    }
  }
  if (c.timing) {
    const t = c.timing as { category?: string; purpose?: string };
    for (const v of [t.category, t.purpose]) if (v && /return|retention|streak|quit/i.test(v)) out.error('L-59', `The timing "${v}" is keyed to return, retention, streaks or quitting, which the engine never uses.`, 'timing', { engine: true });
  }
  for (const f of closure.fragments) {
    if (f.mustReach) {
      const chans = f.channels.map((id) => ctx.reg.channels.get(id));
      const persistent = chans.some((ch) => ch && ch.kind === 'persistent' && !ch.overheard);
      if (!persistent) out.error('L-63', `"${f.id}" carries something V needs, but every channel it can use is transient or overheard. Add a persistent channel such as a message or journal.`, `fragments.${f.id}.channels`);
    }
  }
  for (const [k, b] of Object.entries(c.beats)) {
    if (b.mustReach) {
      for (const ref of playOf(b).refs) {
        const f = fragOf(ref);
        if (!f) continue;
        const persistent = f.channels.some((id) => { const ch = ctx.reg.channels.get(id); return ch && ch.kind === 'persistent' && !ch.overheard; });
        if (!persistent) out.error('L-63', `The beat "${k}" carries something V needs, but its fragment "${f.id}" reaches V only on transient or overheard channels.`, `beats.${k}`);
      }
    }
  }

  // ---- L-72: placeholders at ready ----
  if (c.maturity === 'ready') {
    const todo = (what: string, at: string): void => out.error('L-72', `${what} is still a placeholder; a seed marked ready needs its words.`, at);
    for (const r of PackRefs(c, closure.fragments)) if (typeof r.ref === 'object') todo(`The text at ${r.at}`, r.at);
  }

  // ---- L-74, L-73: references ----
  for (const r of PackRefs(c, closure.fragments)) {
    if (typeof r.ref === 'object') continue;
    const res = ctx.pack.resolve(r.ref);
    if (res.kind === 'missing') out.error('L-74', `"${r.ref}" does not exist in the pack.`, r.at, { engine: true, fix: 'Write it, or fix the name.' });
    else if (res.kind === 'tombstone' && !res.replacement) out.error('L-74', `"${r.ref}" was retired and names no replacement.`, r.at, { engine: true });
  }

  // ---- L-93, L-94, L-95, L-97 to L-101: content and seams ----
  const intensityOf = (f: Fragment): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const t of f.content ?? []) m[t.class] = Math.max(m[t.class] ?? 0, t.intensity);
    return m;
  };
  const compiled: Record<string, number> = {};
  for (const f of closure.fragments) {
    for (const [cls, n] of Object.entries(intensityOf(f))) {
      compiled[cls] = Math.max(compiled[cls] ?? 0, n);
      if (!ctx.reg.classes.has(cls)) out.error('L-93', `"${f.id}" is tagged with the content class "${cls}", which is not registered.`, `fragments.${f.id}.content`, { engine: true });
    }
  }
  if (c.maturity === 'ready') {
    for (const [cls, n] of Object.entries(compiled)) {
      const declared = c.content?.envelope?.[cls] ?? 0;
      if (declared < n) out.error('L-93', `The seed's content envelope does not cover ${cls} at intensity ${n} (it declares ${declared}).`, 'content.envelope', { engine: true, fix: `Declare ${cls}: ${n} in the envelope.` });
    }
  }
  for (const { beat, frag } of frags) {
    for (const t of frag.content ?? []) {
      if (t.intensity >= 2 && frag.implied === undefined && !c.beats[beat]!.droppable && !(c.content?.requires ?? []).some((r) => r.class === t.class)) {
        out.error('L-94', `"${frag.id}" is tagged ${t.class} at intensity ${t.intensity} but has no implied form, no droppable beat and no "requires" on the seed, so a player's ceiling could not be honoured.`, `fragments.${frag.id}.content`, { engine: true });
      }
    }
  }
  const bindsOf = (beat: string, role: string): boolean => {
    const b = c.beats[beat]!;
    const f = playOf(b).refs.map((r) => fragOf(r)).filter((x): x is Fragment => !!x);
    return f.some((fr) => fr.roles.some((fr2) => (b.bind?.[fr2] ?? fr2) === role));
  };
  const barred = barredRoles(c, ctx.pack, ctx.reg);
  for (const [role, why] of barred) {
    const r = c.roles[role];
    if (r && !guaranteesAdult(r)) out.error('L-95', `The role "${role}" could be filled by a minor, and ${why}. Require "age-class == adult" in its "must".`, `roles.${role}`, { engine: true, fix: 'Add must: age-class eq adult.' });
  }
  for (const { beat, frag } of frags) {
    const cls = (frag.content ?? []).map((t) => t.class);
    const authoredSource = cls.filter((x) => ctx.reg.isAuthoredSource(x));
    if (authoredSource.length === 0) continue;
    const std = ctx.pack.text(frag.forms.standard);
    if (!std || std.authored !== 'human' || !std.author) out.error('L-97', `"${frag.id}" is in the authored-source class ${authoredSource.join(', ')}, so its words must be written by a person (authored: human) with a named author.`, `fragments.${frag.id}.forms`, { engine: true });
    else if (std.origin === 'generated') out.error('L-116', `"${frag.id}" is marked human-written, but its text is generated.`, `fragments.${frag.id}.forms`, { engine: true });
    if (frag.authored !== 'human') out.error('L-97', `"${frag.id}" is in the authored-source class ${authoredSource.join(', ')} and is not marked authored: human.`, `fragments.${frag.id}`, { engine: true });
    // L-99: an explicit scene has a fade, binds only adults, and is reached only through an accepted action.
    const fade = frag.implied ? fragOf(frag.implied) : undefined;
    if (!fade) out.error('L-99', `The explicit scene "${frag.id}" has no fade: a non-explicit form that leaves the same facts.`, `fragments.${frag.id}.implied`, { engine: true });
    else if (!canonicalEqual(effectFacts(frag.leaves), effectFacts(fade.leaves))) out.error('L-100', `"${frag.id}" and its fade "${fade.id}" leave different facts, so the seed would run differently with or without the scene.`, `fragments.${frag.id}`, { engine: true });
    for (const role of roles) if (bindsOf(beat, role) && !guaranteesAdult(c.roles[role]!)) out.error('L-99', `The explicit scene "${frag.id}" binds "${role}", who is not guaranteed to be an adult.`, `beats.${beat}`, { engine: true });
    if (!reachedByAcceptedAction(c, beat, frags, closure.fragments)) out.error('L-99', `The explicit scene "${frag.id}" can be reached other than by an action V accepted.`, `beats.${beat}.links`, { engine: true });
  }
  for (const e of effects) {
    if (e.effect.tag?.startsWith('sex.') && e.origin !== 'action') out.error('L-98', 'An effect on V tagged sex.* has to come from an action V accepted.', e.at, { engine: true });
  }
  // L-101: no window, mustReach element or relationship-status predicate may read an intimacy fact.
  for (const [k, d] of Object.entries(c.facts ?? {})) {
    if (!(d as { intimacy?: boolean }).intimacy) continue;
    const reads = (preds: Array<Pred | undefined>): boolean => readsFact(k, preds);
    const winPreds = c.windows.flatMap((w) => [w.opens, w.closes, ...(w.urgency ?? []).map((u) => u.when)]);
    if (reads(winPreds)) out.error('L-101', `A window reads the intimacy fact "${k}".`, 'windows', { engine: true });
    for (const [bk, b] of Object.entries(c.beats)) if (b.mustReach && reads(beatReads(bk))) out.error('L-101', `The mustReach beat "${bk}" reads the intimacy fact "${k}".`, `beats.${bk}`, { engine: true });
  }

  // ---- L-114, L-115, L-116: assets and origin ----
  for (const t of closure.texts) {
    if (t.inline?.gameText) out.error('L-114', `The text "${t.id}" holds game text or audio inline. Refer to the game's own content by reference.`, `texts.${t.id}`, { engine: true });
    const v = t.voice;
    if (v && 'clone' in v && v.clone && !v.consent) out.error('L-115', `The voice of "${t.id}" imitates a real person with no recorded consent.`, `texts.${t.id}.voice`, { engine: true });
    if (t.origin === 'generated' && t.authored === 'human') out.error('L-116', `The text "${t.id}" is generated but marked human-written.`, `texts.${t.id}`, { engine: true });
  }

  // ---- L-89: a claimed deadline needs a window behind it ----
  for (const t of closure.texts) {
    if ((t as TextUnit & { claimsDeadline?: boolean }).claimsDeadline && !c.windows.some((w) => w.closes !== undefined && !(w.closes === 'no'))) {
      out.error('L-89', `The text "${t.id}" claims a deadline, but nothing in the seed (a window that closes) backs it.`, `texts.${t.id}`);
    }
  }

  // ---- L-42: a fixed requirement that names too many nodes ----
  for (const [i, w] of (c.world ?? []).entries()) {
    if ('selector' in w.target) {
      const sc = w.target.selector.scope;
      if (sc && 'nodes' in sc && sc.nodes.length > ctx.watchMax) out.error('L-42', `The requirement names ${sc.nodes.length} nodes; the engine watches at most ${ctx.watchMax} per requirement.`, `world[${i}]`);
    }
  }

  void TRIVIAL;
  return out.list;
}

const effectFacts = (es: EffectDecl[] | undefined): unknown =>
  (es ?? []).map((e) => ({ ...e })).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

/**
 * Whether a beat can be reached only through an action V accepted (L-99). Every way into the beat is looked at: it is not in `start`,
 * no failure leads to it, it is not offered again by a `reoffer`, and its chain links are such that satisfying them implies the
 * acceptance. A link's condition is proved by its structure: an `all` is proved by any one part, an `any` by every part, and a
 * `not`, a bare test, or any form that cannot be shown to imply the acceptance is not a proof.
 */
function reachedByAcceptedAction(c: CompiledSeed, beat: string, frags: Array<{ beat: string; frag: Fragment }>, all: Fragment[]): boolean {
  const b = c.beats[beat]!;
  if (c.start.includes(beat) || b.reoffer !== undefined) return false;
  if (Object.values(c.beats).some((x) => (x.failure ?? []).some((f) => f.leadsTo === beat))) return false;
  const chain = (b.links ?? []).filter((l) => 'because' in l || 'then' in l);
  const becauseLinks = chain.filter((l): l is { because: string; on?: Pred } => 'because' in l);
  if (becauseLinks.length === 0) return false;
  const proves = (l: { because: string; on?: Pred }): boolean => {
    const src = frags.find((f) => f.beat === l.because);
    if (!src?.frag.offer || !l.on) return false;
    return impliesAccepted(c, l.because, src.frag, l.on, all);
  };
  // `all` needs every chain link, so one proving link is enough; `any` needs only one of them, so every chain link must prove it.
  if ((b.join ?? 'all') === 'any') return chain.every((l) => 'because' in l && proves(l));
  return becauseLinks.some(proves);
}

/** Whether `p` being yes implies V accepted an action of the offer in `srcBeat`. */
function impliesAccepted(c: CompiledSeed, srcBeat: string, srcFrag: Fragment, p: Pred, all: Fragment[]): boolean {
  if (typeof p === 'string') return false;
  if ('all' in p) return p.all.some((x) => impliesAccepted(c, srcBeat, srcFrag, x, all));
  if ('any' in p) return p.any.length > 0 && p.any.every((x) => impliesAccepted(c, srcBeat, srcFrag, x, all));
  if ('response' in p) return p.response === srcBeat && p.is.length > 0 && p.is.every((x) => x === 'action' || x.startsWith('action:'));
  if ('seedFact' in p) {
    // The test can be made true only by the offer's actions, never by a decline, the null path, another fragment, a beat or the
    // unattended plan, and it is false before any write: a comparison that the fact's initial value already satisfies proves nothing.
    // A write counts if it can make the test true: an `add`, or a `set` to a value the test accepts.
    const wrote = (es: EffectDecl[] | undefined): boolean => (es ?? []).some((e) => 'fact' in e && e.fact === p.seedFact && (e.set === undefined || compare(e.set, p.op, p.value)));
    const o = srcFrag.offer!;
    const actionWrites = o.actions.some((a) => wrote(a.writes));
    const otherWrites = o.decline.some((d) => wrote(d.writes)) || wrote(o.nullPath.writes) ||
      all.some((f) => wrote(f.leaves) || (f !== srcFrag && !!f.offer && (f.offer.actions.some((a) => wrote(a.writes)) || f.offer.decline.some((d) => wrote(d.writes)) || wrote(f.offer.nullPath.writes)))) ||
      Object.values(c.beats).some((x) => wrote(x.leaves)) || wrote(c.unattended.outcome);
    const initial = c.facts?.[p.seedFact]?.initial ?? 0;
    return actionWrites && !otherWrites && !compare(initial, p.op, p.value);
  }
  return false;
}

interface RefSite { ref: string | { todo: true; note?: string }; at: string }

function PackRefs(c: CompiledSeed, fragments: Fragment[]): RefSite[] {
  const out: RefSite[] = [];
  if (c.closing !== undefined) out.push({ ref: c.closing, at: 'closing' });
  c.windows.forEach((w, i) => { if (w.closeContent !== undefined) out.push({ ref: w.closeContent, at: `windows[${i}].closeContent` }); });
  for (const [k, b] of Object.entries(c.beats)) {
    playOf(b).refs.forEach((r, i) => out.push({ ref: r, at: `beats.${k}.play${i ? `[${i}]` : ''}` }));
    (b.aftermath?.signposts ?? []).forEach((r, i) => out.push({ ref: r, at: `beats.${k}.aftermath.signposts[${i}]` }));
  }
  for (const f of fragments) {
    const base = `fragments.${f.id}`;
    out.push({ ref: f.forms.standard, at: `${base}.forms.standard` });
    if (f.implied) out.push({ ref: f.implied, at: `${base}.implied` });
    const o = f.offer;
    if (o) {
      o.actions.forEach((a, i) => out.push({ ref: a.foresight, at: `${base}.offer.actions[${i}].foresight` }));
      if (o.nullPath.content) out.push({ ref: o.nullPath.content, at: `${base}.offer.nullPath.content` });
      if (o.lapse.content) out.push({ ref: o.lapse.content, at: `${base}.offer.lapse.content` });
      o.decline.forEach((d, i) => { if (d.response !== undefined) out.push({ ref: d.response, at: `${base}.offer.decline[${i}].response` }); });
      if (o.retractQuietly) out.push({ ref: o.retractQuietly, at: `${base}.offer.retractQuietly` });
    }
    (f.responses ?? []).forEach((r, i) => {
      out.push({ ref: r.content, at: `${base}.responses[${i}].content` });
      if (r.reply) out.push({ ref: r.reply, at: `${base}.responses[${i}].reply` });
    });
  }
  return out;
}

/** Pack-level checks: duplicate ids, people (L-73, L-109, L-111). */
export function lintPack(pack: Pack, index: PackIndex): Finding[] {
  const out = new Out();
  for (const d of index.duplicates) out.error('L-73', `The id "${d.id}" is used by two ${d.what}s in the pack.`, d.id, { engine: true });
  for (const p of pack.people ?? []) {
    if (!p.fictional) out.error('L-109', `The pack person "${p.id}" is not marked fictional.`, `people.${p.id}`, { engine: true });
    if (p.ageClass === undefined) out.error('L-111', `The pack person "${p.id}" has no age class. A person with none counts as a minor.`, `people.${p.id}`, { engine: true });
  }
  return out.list;
}

export type { EffectSite };
