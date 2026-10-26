// Compiling (S2 section 3.1): expand the profile, draw the mode and the variant, lint, and freeze the
// document with its closure. A document that uses a later capability (section 0.3) is refused plainly:
// "not supported yet", never half-built.

import { canonicalEqual, canonicalKey } from '../canon.ts';
import { PredSyntaxError, walkPred } from './pred.ts';
import { atoms, bound, fragmentSites, playOf, predSites, resolvePreds, type PredSite } from './doc.ts';
import { lintSeed, type LintCtx } from './lint.ts';
import { PackIndex, stripWords, structureHash } from './packs.ts';
import { readCall } from './reads.ts';
import type { L2Registry } from './registries.ts';
import { LADDER_ID, expandProfile, type LadderParams } from './profile.ts';
import type { CompiledSeed, Finding, Fragment, Pred, Seed, SeedInput, TextMeta } from './types.ts';

export interface CompiledResult {
  ok: true;
  seed: CompiledSeed;
  closure: { fragments: Fragment[]; texts: TextMeta[] };
  structureHash: string;
  findings: Finding[];
  draws: Record<string, { value: string; attempt: number; raw?: number; clamped?: number }>;
  /** Generated part path to the author's field it came from (S2 section 11.1, source maps). */
  sourceMap: Record<string, string>;
}
export type CompileOutcome = CompiledResult | { ok: false; findings: Finding[] };

export interface CompileOptions {
  /** Draws a choice among weighted options (S2 section 3.4). Without one, modes and variants are not drawn. */
  draw?: (choice: string, options: Array<{ id: string; weight: number }>, document?: SeedInput) => { value: string; attempt: number; raw?: number; clamped?: number };
  /** Evaluates a predicate at sowing (a rare variant's gate). Without one, a rare variant is not eligible. */
  evalPred?: (p: Pred) => 'yes' | 'no' | 'maybe';
  /** Applied to the expanded, merged document before the lint (S2 section 1.3: how a sowing request's overlay applies). */
  afterExpand?: (seed: SeedInput) => SeedInput;
}

const later = (what: string, at: string, instead?: string): Finding => ({
  code: 'later',
  level: 'error',
  engine: true,
  at,
  message: `${what} is not supported yet.${instead ? ` ${instead}` : ''}`,
});

/** The constructs of section 0.3's "later capabilities" table that a document or its fragments use. */
export function laterFindings(input: SeedInput, pack: PackIndex): Finding[] {
  const out: Finding[] = [];
  if (input.clocks !== undefined) out.push(later('Clocks', 'clocks', 'Count events with a "count" predicate and test the count instead.'));
  if (input.projections !== undefined) out.push(later('Projections', 'projections', 'Use world requirements.'));
  if (input.forms !== undefined) out.push(later('Short and full forms', 'forms', 'Write alternative beats with conditions.'));
  if (input.parent !== undefined) out.push(later('A parent seed (scale ancestry)', 'parent'));
  if (input.growsFrom !== undefined && !(typeof input.growsFrom === 'object' && input.growsFrom !== null && 'instance' in input.growsFrom && 'juncture' in input.growsFrom))
    out.push(later('Growing from another seed (scale ancestry)', 'growsFrom'));
  if (input.intent?.argues !== undefined) out.push(later('Premises ("argues")', 'intent.argues'));
  for (const [i, m] of (input.migrate ?? []).entries()) {
    if (m.policy === 'migrate') out.push(later('Migrating a live seed by a beat map', `migrate[${i}]`, 'Use "continue" or "withdraw".'));
  }
  for (const [k, r] of Object.entries(input.roles ?? {})) {
    for (const key of ['memberships', 'tie', 'repertoire', 'stance', 'stability', 'client'] as const) {
      if (r[key] !== undefined) out.push(later(`The role field "${key}"`, `roles.${k}.${key}`));
    }
  }
  for (const [k, b] of Object.entries(input.beats ?? {})) {
    for (const key of ['unresolved', 'breaks', 'hook'] as const) {
      if (b[key] !== undefined) out.push(later(`The beat annotation "${key}"`, `beats.${k}.${key}`));
    }
    const p = playOf(b);
    if (p.status !== 'fixed') out.push(later('An open or preferred fragment (it needs layer 3 to fit it)', `beats.${k}.play`, 'Fix the fragment, or give alternates.'));
  }
  for (const [i, p] of (input.promises ?? []).entries()) {
    if (p.weight === 'plant') out.push(later('Plants (promises that open with a trace)', `promises[${i}].weight`));
    if (p.retire !== undefined) out.push(later('A retirement trace for an unpaid promise', `promises[${i}].retire`));
  }
  // Every fragment the document can reach, through its implied forms and every reference they make (the closure), is checked: a
  // later capability in a fallback is a later capability in the seed (S2 section 0.3).
  const frags = new Set<string>();
  const queue: string[] = [];
  const visit = (ref: string | undefined): void => {
    const f = pack.fragment(ref);
    if (f && !frags.has(f.id)) {
      frags.add(f.id);
      queue.push(f.id);
    }
  };
  for (const b of Object.values(input.beats ?? {})) for (const r of playOf(b).refs) visit(r);
  for (const e of input.closing !== undefined ? [input.closing] : []) if (typeof e === 'string') visit(e);
  for (const w of input.windows ?? []) if (typeof w.closeContent === 'string') visit(w.closeContent);
  for (const b of Object.values(input.beats ?? {})) for (const r of b.aftermath?.signposts ?? []) visit(r);
  // Beats the profile will generate play their fragments too.
  if (input.profile?.id === LADDER_ID) {
    const p = input.profile.params as unknown as LadderParams;
    for (const o of Object.values(p.offers ?? {})) visit(o.offer);
    if (p.intimate) { visit(p.intimate.scene); visit(p.intimate.fade); }
    for (const e of Object.values(p.exits ?? {})) if (typeof e === 'string') visit(e);
  }
  while (queue.length > 0) {
    const f = pack.fragments.get(queue.shift()!)!;
    for (const ref of PackIndex.fragmentRefs(f)) if (typeof ref === 'string') visit(ref);
  }
  for (const id of frags) {
    const f = pack.fragments.get(id)!;
    for (const key of ['implies', 'ask', 'render', 'modelOk', 'says', 'means', 'humour', 'told'] as const) {
      if (f[key] !== undefined) out.push(later(`The fragment field "${key}"`, `fragments.${id}.${key}`, key === 'modelOk' || key === 'says' ? 'Language models are a later capability.' : undefined));
    }
    if (f.forms.short !== undefined || f.forms.full !== undefined) out.push(later('Short and full forms of a fragment', `fragments.${id}.forms`));
    for (const [i, r] of (f.responses ?? []).entries()) if (r.recalls !== undefined) out.push(later('Recall in a response (the memory machinery)', `fragments.${id}.responses[${i}].recalls`));
  }
  return out;
}

const hasLaterAtoms = (sites: PredSite[], reg: L2Registry): Finding[] => {
  const out: Finding[] = [];
  for (const s of sites) {
    for (const { atom, at } of atoms(s.pred)) {
      if ('clock' in atom) out.push(later('A "clock" predicate', `${s.at}${at}`));
      else if ('city' in atom || 'social' in atom) {
        // The simulation layer builds some of these reads. Those it builds are read through it; the others, and every one when it is not attached, wait.
        const family = 'city' in atom ? 'city' : 'social';
        const call = readCall(atom);
        if ('error' in call) out.push({ code: 'L-01', level: 'error', engine: true, at: `${s.at}${at}`, message: call.error });
        else if (!reg.sim?.builds(call.name)) out.push(later(`The ${family} read "${call.name}" (the simulation layer does not build it yet)`, `${s.at}${at}`));
      }
    }
  }
  return out;
};

/** Merge a variant's parts over the seed: each named top-level field replaces the seed's own. */
function mergeParts(base: SeedInput, parts: Partial<Seed>): SeedInput {
  return { ...base, ...(parts as Partial<SeedInput>) };
}

export function compileSeed(input: SeedInput, ctx: LintCtx, opts: CompileOptions = {}): CompileOutcome {
  const pack = ctx.pack;
  const findings: Finding[] = [];
  const refuse = (): CompileOutcome => ({ ok: false, findings });

  // 0. Later capabilities are refused before anything else is read.
  findings.push(...laterFindings(input, pack));
  if (findings.length > 0) return refuse();

  // 1. Expand the profile.
  const exp = expandProfile(input);
  findings.push(...exp.findings);
  if (exp.findings.some((f) => f.level === 'error')) return refuse();
  let seed = exp.seed;

  // 2. Draw the mode, then the variant, and merge the variant's parts (S2 section 3.4).
  const draws: Record<string, { value: string; attempt: number; raw?: number; clamped?: number }> = {};
  const v = seed.variation;
  if (v && opts.draw) {
    let mode: string | undefined;
    if (v.modes && v.modes.length > 0) {
      const d = opts.draw('mode', v.modes.map((m) => ({ id: m.id, weight: m.weight })), seed);
      draws.mode = d;
      mode = d.value;
    }
    const eligible = (v.variants ?? []).filter((x) => {
      if (x.mode !== undefined && mode !== undefined && x.mode !== mode) return false;
      if (x.rare === undefined) return true;
      return opts.evalPred ? opts.evalPred(typeof x.rare === 'string' && x.rare !== 'yes' && x.rare !== 'no' ? (resolvePreds({ ...seed, context: x.rare, windows: [], beats: {} } as SeedInput).context) : (x.rare as Pred)) === 'yes' : false;
    });
    if (eligible.length > 0) {
      const d = opts.draw('variant', eligible.map((x) => ({ id: x.id, weight: x.weight })), seed);
      draws.variant = d;
      const chosen = eligible.find((x) => x.id === d.value);
      if (chosen) seed = mergeParts(seed, chosen.parts);
    }
  }

  if (opts.afterExpand) seed = opts.afterExpand(seed);

  // Later capabilities are refused in the document that will run, and in every variant that could be drawn: a variant's
  // parts are merged over the seed, so a clock in one is a clock in the seed (S2 section 0.3).
  {
    const seen = new Set<string>();
    const fresh: Finding[] = [];
    const candidates: SeedInput[] = [seed, ...(v?.variants ?? []).map((x) => mergeParts(exp.seed, x.parts))];
    for (const cand of candidates) {
      const add = (x: Finding): void => {
        const key = `${x.at}|${x.message}`;
        if (!seen.has(key)) { seen.add(key); fresh.push(x); }
      };
      for (const x of laterFindings(cand, pack)) add(x);
      // The predicates a variant would run, and those of the fragments it plays, are checked as the chosen document's are.
      try {
        const compiledCand = resolvePreds(cand);
        for (const x of hasLaterAtoms(predSites(compiledCand), ctx.reg)) add(x);
        for (const x of hasLaterAtoms(pack.closure(compiledCand).fragments.flatMap((fr) => fragmentSites(fr)), ctx.reg)) add(x);
      } catch (e) {
        if (!(e instanceof PredSyntaxError)) throw e;
      }
    }
    if (fresh.length > 0) { findings.push(...fresh); return refuse(); }
  }

  // 3. Parse the text form of every predicate.
  let compiled: CompiledSeed;
  try {
    compiled = resolvePreds(seed);
  } catch (e) {
    if (e instanceof PredSyntaxError) {
      findings.push({ code: 'syntax', level: 'error', engine: true, message: `A predicate could not be read: ${e.message}` });
      return refuse();
    }
    throw e;
  }
  findings.push(...hasLaterAtoms(predSites(compiled), ctx.reg));
  // The fragments the document plays are part of it: their predicates are checked too.
  const closed = pack.closure(compiled);
  findings.push(...hasLaterAtoms(closed.fragments.flatMap((fr) => fragmentSites(fr)), ctx.reg));
  if (findings.some((f) => f.level === 'error')) return refuse();

  // 4. Lint, at the template's maturity (S2 section 11.1).
  findings.push(...lintSeed(compiled, ctx));
  if (compiled.profile?.id === LADDER_ID) findings.push(...lintLadder(compiled, compiled.profile.params as unknown as LadderParams, ctx));
  const blocking = findings.filter((f) => f.level === 'error' && (f.engine === true || compiled.maturity === 'ready'));
  if (blocking.length > 0) return refuse();

  // 5. The closure, frozen with the document.
  const full = closed;
  const closure = { fragments: full.fragments, texts: stripWords(full.texts) };
  return { ok: true, seed: compiled, closure, structureHash: structureHash(compiled, closure), findings, draws, sourceMap: exp.sourceMap };
}

// ---- the ladder's own checks (S2 Appendix A.2 step 10) ----

function lintLadder(c: CompiledSeed, p: LadderParams, ctx: LintCtx): Finding[] {
  const out: Finding[] = [];
  const e = (code: string, message: string, at: string, engine = false): void => {
    const f: Finding = { code, level: 'error', message, at };
    if (engine) f.engine = true;
    out.push(f);
  };
  // L-10: three exits, each with content.
  const exits = ['decline', 'stay', 'lapse'] as const;
  for (const k of exits) {
    const x = p.exits?.[k];
    if (x === undefined || (typeof x === 'string' && x === '') || (typeof x === 'object' && 'todo' in x && c.maturity === 'ready')) {
      e('L-10', `The ladder needs three exits (decline, stay and lapse), each with content, and "${k}" has none.`, `profile.params.exits.${k}`);
    }
  }
  if (Object.keys(p.exits ?? {}).filter((k) => (exits as readonly string[]).includes(k)).length < 3) {
    // reported per exit above; nothing more to add
  }
  // The lapse exit's fragment carries the lapse gate (A.4): the profile cannot put a condition on a fragment, so the contract is checked
  // here. It measures from `offer-1` (the first offer), the one simplification of A.4, and has no qualifying act in the span.
  const lapse = p.exits?.lapse;
  if (typeof lapse === 'string' && lapse !== '') {
    const frag = ctx.pack.fragment(lapse);
    const needs = frag?.needs as Pred | undefined;
    const lapseAfter = p.lapseAfter;
    // Every way the fragment's `needs` can be yes has to imply the timing and the absence of each pacing act: an `all` is proved by any
    // one part, an `any` by every part, and a `not` or a bare `yes` proves nothing.
    const implies = (x: Pred | undefined, test: (atom: Pred) => boolean): boolean => {
      if (x === undefined || typeof x === 'string') return false;
      if ('all' in x) return x.all.some((y) => implies(y, test));
      if ('any' in x) return x.any.length > 0 && x.any.every((y) => implies(y, test));
      if ('not' in x) return false;
      return test(x);
    };
    const isSince = (n: Pred): boolean => typeof n !== 'string' && 'since' in n && 'atLeast' in n && 'beat' in n.since && n.since.beat === 'offer-1' && canonicalEqual(n.atLeast, lapseAfter);
    const hasSince = implies(needs, isSince);
    const missingActs = (p.pacing?.acts ?? []).filter((a) => !implies(needs, (n) => typeof n !== 'string' && 'count' in n && !!n.since && 'beat' in n.since && n.since.beat === 'offer-1' &&
      ((n.op === 'eq' && n.value === 0) || (n.op === 'le' && n.value === 0) || (n.op === 'lt' && n.value === 1)) &&
      (canonicalKey(n.count) === canonicalKey({ participant: p.with, ...a }) || canonicalKey(n.count) === canonicalKey(a))));
    if (!frag || !hasSince || missingActs.length > 0) {
      e('L-10', `The lapse exit "${lapse}" has to be a fragment whose "needs" says when it is due: since the first offer (offer-1) at least ${lapseAfter.s} ${lapseAfter.clock === 'game' ? 'game ' : 'play '}seconds, and none of the pacing acts since then. The profile cannot put that condition on the fragment, so it checks it.`, 'profile.params.exits.lapse');
    }
  }
  // L-11: the intimate scene is a human-authored pack scene with a fade, and holds no choice.
  if (p.intimate) {
    const scene = ctx.pack.fragment(p.intimate.scene);
    const fade = ctx.pack.fragment(p.intimate.fade);
    if (!scene || scene.authored !== 'human') e('L-11', 'The intimate scene has to be a scene a person wrote in a pack (authored: human).', 'profile.params.intimate.scene');
    if (!fade) e('L-11', 'The intimate scene has no fade alternative.', 'profile.params.intimate.fade');
    if (scene?.offer) e('L-11', 'The intimate scene holds a choice inside it; it must hold none.', 'profile.params.intimate.scene');
    const top = `offer-${p.rungs.length - 1}`;
    if (!c.beats.intimate || !(c.beats.intimate.links ?? []).some((l) => 'because' in l && l.because === top)) e('L-11', 'The intimate scene must be reached from the top rung.', 'beats.intimate');
  }
  // L-16: no gate on a partner fact.
  const gate = (pred: Pred | undefined, at: string): void => {
    if (!pred) return;
    walkPred(pred, (n) => {
      if (typeof n === 'string') return;
      if ('fact' in n && ctx.relationshipFacts?.has(n.fact)) e('L-16', `The ladder is gated on "${n.fact}", a fact about another relationship. A ladder never tests V's romance state elsewhere.`, at);
      if ('seed' in n && ctx.ladderTemplates?.has(n.seed)) e('L-16', `The ladder is gated on the state of another ladder, "${n.seed}".`, at);
    });
  };
  for (const [k, b] of Object.entries(c.beats)) {
    for (const [i, l] of (b.links ?? []).entries()) if ('because' in l) gate(l.on, `beats.${k}.links[${i}].on`);
    gate(b.reoffer?.when, `beats.${k}.reoffer.when`);
    for (const ref of playOf(b).refs) {
      const f = ctx.pack.fragment(ref);
      if (f) { gate(f.needs as Pred | undefined, `fragments.${f.id}.needs`); gate(f.applies as Pred | undefined, `fragments.${f.id}.applies`); }
    }
  }
  return out;
}

void bound;
