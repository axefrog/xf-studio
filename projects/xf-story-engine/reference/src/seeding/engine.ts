// Sowing, the work queue, the kernel's hooks and persistence for layer 2 (S2 sections 1.2, 1.3, 3, 4.4, 12).

import { canonicalKey } from '../canon.ts';
import type { Change, GameTime, Id, Layer } from '../types.ts';
import type { Dilemma } from '../frames.ts';
import { rootId } from '../id.ts';
import type { Relevance } from '../relevance.ts';
import { ceilingOf } from '../settings.ts';
import type { Budget } from '../work.ts';
import { atoms, bound, fragmentSites, predSites } from './doc.ts';
import { runMaintenance } from './effects.ts';
import { evalPred } from './eval.ts';
import * as ids from './ids.ts';
import { handleDilemma } from './intersect.ts';
import type { Instance, Layer2, SowOutcome, Trigger } from './layer2.ts';
import { isTerminal } from './layer2.ts';
import { Arbiter, lapsesDue } from './arbiter.ts';
import { compileSeed } from './compile.ts';
import { addPredInterests, collectInterests, computeWakeups, reevaluate } from './run.ts';
import { installRequirement, layerOfInstance, originOf } from './world.ts';
import { toPred } from './pred.ts';
import { newInstanceState } from './state.ts';
import type {
  BeatRuntime, Finding, GlobalState, InstanceState, Pred, RoleState, Seed, SeedInput,
} from './types.ts';

export interface SowOpts {
  by?: 'pack' | 'director' | 'plugin';
  decision?: Id;
  localName?: string;
  pluginId?: string;
  /** A plugin that declares itself an authoring source seeds at the authored layer. */
  authoringSource?: boolean;
  overlay?: {
    roles?: Record<string, { identity: Id }>;
    stakeScale?: Seed['stakeScale'];
  };
}

const sowKey = (packId: string, templateId: string): string => `${packId}:${templateId}`;

// ---- the overlay (S2 section 1.3) ----

function applyOverlay(l2: Layer2, input: SeedInput, overlay: NonNullable<SowOpts['overlay']>): { seed: SeedInput; findings: Finding[] } {
  const findings: Finding[] = [];
  const seed: SeedInput = { ...input, roles: { ...input.roles } };
  for (const [key, o] of Object.entries(overlay.roles ?? {})) {
    const role = seed.roles[key];
    if (!role) {
      findings.push({ code: 'overlay', level: 'error', engine: true, message: `The overlay names the role "${key}", which the template does not have.` });
      continue;
    }
    const h = l2.k.store.header(o.identity);
    if (!h || !l2.k.schema.isCompatibleKind(h.kind, role.kind)) {
      findings.push({ code: 'overlay', level: 'error', engine: true, message: `The node the overlay names for "${key}" is not a ${role.kind}.` });
      continue;
    }
    // An overlay never erases an author's promise: it may bind a role whose identity is absent, open or preferred, or name the same fixed node.
    const b = bound(role.identity);
    if (b.status === 'fixed' && b.value !== o.identity) {
      findings.push({ code: 'overlay', level: 'error', engine: true, message: `The role "${key}" has a fixed identity; the overlay may only name the same node.` });
      continue;
    }
    seed.roles[key] = { ...role, identity: o.identity };
  }
  if (overlay.stakeScale !== undefined) seed.stakeScale = overlay.stakeScale;
  return { seed, findings };
}

// ---- sowing (S2 sections 1.2, 1.3, 3.1) ----

export function sowTemplate(l2: Layer2, packId: string, templateId: string, opts: SowOpts = {}): SowOutcome {
  const k = l2.k;
  const index = l2.packs.get(packId);
  if (!index) return { ok: false, findings: [{ code: 'sow', level: 'error', message: `The pack "${packId}" is not installed.` }] };
  const template = index.pack.seeds.find((s) => s.id === templateId);
  if (!template) return { ok: false, findings: [{ code: 'sow', level: 'error', message: `The pack "${packId}" has no template "${templateId}".` }] };
  const by = opts.by ?? 'pack';
  // Only a `ready` template reaches a player's game (S2 section 1.3).
  if (template.maturity !== 'ready' && !l2.opts.lab) {
    return { ok: false, findings: [{ code: 'maturity', level: 'warning', message: `"${templateId}" is marked ${template.maturity}; only the lab sows it.` }] };
  }
  const key = sowKey(packId, templateId);
  const rec = l2.global.sowing[key] ?? { instances: 0 };
  let creator: Id;
  let cause: Id;
  let name: string;
  let layer: Layer;
  if (by === 'pack') {
    creator = ids.packRootId(l2.worldSeed, packId);
    const repeatable = template.repeat !== undefined;
    cause = ids.sowCause(packId, templateId, repeatable ? rec.instances : undefined);
    name = ids.instanceName(templateId, repeatable ? rec.instances : undefined);
    layer = index.pack.source === 'procedural' ? 'procedural' : 'authored';
  } else if (by === 'director') {
    creator = rootId(l2.worldSeed, 'director');
    if (!k.store.header(creator)) k.root('director', 'core:seed');
    cause = opts.decision ?? ids.sowCause(packId, templateId);
    name = ids.instanceName(templateId, undefined, opts.localName ?? 'sown');
    layer = 'procedural';
  } else {
    creator = rootId(l2.worldSeed, `plugin:${opts.pluginId ?? 'unknown'}`);
    if (!k.store.header(creator)) k.root(`plugin:${opts.pluginId ?? 'unknown'}`, 'core:seed');
    cause = opts.decision ?? ids.sowCause(packId, templateId);
    name = ids.instanceName(templateId, undefined, opts.localName ?? 'sown');
    layer = opts.authoringSource ? 'authored' : 'procedural';
  }
  const iid = ids.instanceId(creator, cause, name);
  if (l2.insts.has(iid)) return { ok: true, instance: iid, existing: true, findings: [] };
  if (l2.global.history.some((h) => h.seed === iid)) return { ok: true, instance: iid, existing: true, findings: [] };

  // Content: a seed that requires a class above the player's ceiling is not sown (S2 section 2.19); the sower honours the soft exclusions.
  const settings = k.settings.current();
  for (const r of template.content?.requires ?? []) {
    if (ceilingOf(settings, r.class) < r.min) return { ok: false, findings: [], gated: `requires ${r.class} at ${r.min}` } as SowOutcome;
  }
  if (by === 'director') {
    for (const ex of settings.content.softExclusions) {
      if ((template.content?.envelope?.[ex.class] ?? 0) >= ex.level) return { ok: false, findings: [], gated: `soft exclusion of ${ex.class}` } as SowOutcome;
    }
  }

  const lintCtx = l2.lintContext(index);
  let overlayFindings: Finding[] = [];
  const res = compileSeed(template as SeedInput, lintCtx, {
    draw: (choice, options, document) => {
      const d = l2.draw(iid, choice, options.map((o) => ({ id: o.id, weight: o.weight })), 0, l2.fitWeights({id: iid,template: templateId,pack: packId,sowSeq: l2.global.nextSowSeq,document: (document ?? template) as Seed,choice,options}));
      // The record keeps what the fit hook returned and what the draw used of it (S2 section 3.4).
      return { value: d.value, attempt: 0, ...(d.raw !== undefined ? { raw: d.raw } : {}), ...(d.clamped !== undefined ? { clamped: d.clamped } : {}) };
    },
    evalPred: (p) => evalPred(l2, { t: k.now }, p),
    ...(opts.overlay
      ? { afterExpand: (s: SeedInput) => { const o = applyOverlay(l2, s, opts.overlay!); overlayFindings = o.findings; return o.seed; } }
      : {}),
  });
  if (overlayFindings.length > 0 || !res.ok) {
    const findings = [...overlayFindings, ...(res.ok ? [] : res.findings)];
    rec.refused = findings.filter((f) => f.level === 'error').map((f) => `${f.code}${f.at ? ` at ${f.at}` : ''}: ${f.message}`).join('; ');
    l2.global.sowing[key] = rec;
    l2.sowRefusals.push({ pack: packId, template: templateId, findings });
    return { ok: false, findings };
  }

  // Mint the seed node, and open its frames (S2 section 3.1).
  k.mint(creator, cause, name, 'core:seed');
  const st = newInstanceState(res, {
    pack: packId, template: templateId, version: template.version, by, layer, sowSeq: l2.global.nextSowSeq++, now: k.now, playTotal: l2.playTotal(),
    ...(opts.decision !== undefined ? { decision: opts.decision } : {}),
  });
  const roles = st.roles;
  const facts = st.facts;
  const inst: Instance = { id: iid, st };
  l2.insts.set(iid, inst);
  l2.registerActor(iid);
  for (const fk of Object.keys(facts)) k.mint(iid, iid, `fact:${fk}`, 'core:seed-fact');
  k.frames.demandRoots.add(iid);
  const watch = ids.watchFrameId(iid);
  k.frames.open({ id: watch, actor: iid, level: 'goal', origin: iid, weight: 1, cause: iid, focus: { nodes: [iid], tier: 1 }, own: { reactsTo: collectInterests(l2, inst) } });
  st.frames.watch = watch;
  for (const rk of Object.keys(roles)) {
    const f = ids.roleFrameId(iid, rk);
    k.frames.open({ id: f, actor: iid, level: 'goal', origin: iid, weight: 1, cause: iid, parents: [{ frame: watch, weight: 1 }], focus: { nodes: [], tier: 3 } });
    st.frames.roles[rk] = f;
  }
  // The world requirements that start at sowing.
  (res.seed.world ?? []).forEach((w, i) => {
    if ((w.from ?? ('role' in w.target ? 'commit' : 'sown')) !== 'sown') return;
    const ins = installRequirement(l2, inst, i);
    if (ins) st.world[i] = { contribution: ins.contribution, installed: true, ended: false, from: k.now };
  });
  rec.instances++;
  l2.global.sowing[key] = rec;
  if (opts.decision !== undefined) l2.global.sownBy[opts.decision] = [...(l2.global.sownBy[opts.decision] ?? []), iid];
  l2.record(inst, 'transition', { row: 'sow', to: 'sown', why: 'the template was sown', pack: packId });
  for (const f of res.findings) if (f.level === 'warning') l2.record(inst, 'beat', { lint: f.code, message: f.message });
  st.wakeups = computeWakeups(l2, inst);
  l2.syncRecord(inst);
  l2.queueReeval(inst, 'sown');
  return { ok: true, instance: iid, existing: false, findings: res.findings };
}

// ---- the sowing watcher (S2 section 1.3) ----

export function openWatcher(l2: Layer2, packId: string): void {
  const index = l2.packs.get(packId);
  if (!index) return;
  const root = ids.packRootId(l2.worldSeed, packId);
  const reacts = new Map<string, import('../types.ts').Selector>();
  for (const s of index.pack.seeds) {
    if (s.sow === undefined) continue;
    addPredInterests(l2, toPred(s.sow), undefined, (sel) => { reacts.set(canonicalKey(sel), sel); });
  }
  const list = [...reacts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[1]);
  const fid = ids.watchFrameId(root);
  const f = l2.k.frames.frame(fid);
  if (!f) l2.k.frames.open({ id: fid, actor: root, level: 'goal', origin: root, weight: 1, cause: root, focus: { nodes: [root], tier: 0 }, own: { reactsTo: list } });
  else if (canonicalKey(f.own.reactsTo) !== canonicalKey(list)) l2.k.frames.setInterests(fid, { reactsTo: list }, root);
}

function handleSowing(l2: Layer2, packId: string): number {
  const index = l2.packs.get(packId);
  if (!index) return 0;
  let cost = 1;
  for (const t of [...index.pack.seeds].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    cost++;
    const key = sowKey(packId, t.id);
    const rec = l2.global.sowing[key] ?? { instances: 0 };
    if (rec.refused) continue;
    if (t.maturity !== 'ready' && !l2.opts.lab) continue;
    if (t.repeat === undefined) {
      if (rec.instances > 0) continue;
    } else {
      if (t.repeat.max !== 'unbounded' && rec.instances >= t.repeat.max) continue;
      const last = l2.ofTemplate(t.id).filter((i) => i.st.template.pack === packId).pop();
      if (last && !isTerminal(last.st.state)) continue;
      if (rec.instances > 0 && (rec.lastEnded === undefined || l2.k.now - rec.lastEnded < t.repeat.gap.s)) continue;
    }
    const sow = t.sow === undefined ? 'yes' : toPred(t.sow);
    if (evalPred(l2, { t: l2.k.now }, sow) !== 'yes') continue;
    sowTemplate(l2, packId, t.id);
  }
  return cost;
}

// ---- the kernel's hooks ----

export function onRelevance(l2: Layer2, r: Relevance): void {
  const inst = l2.insts.get(r.actor);
  if (inst && !isTerminal(inst.st.state)) {
    l2.queueReeval(inst, 'relevance', { time: r.time, change: r.change as Change, reason: 'relevance' });
    return;
  }
  const pack = l2.packRoots.get(r.actor);
  if (pack) l2.sowQueue.add(pack);
}

export function onBoundary(l2: Layer2, _boundary: number, at: GameTime): void {
  l2.boundaryDue = at;
  for (const inst of l2.live()) {
    if (inst.st.wakeups.some((w) => w.clock === 'game' && w.at <= at)) l2.queueReeval(inst, 'wake', { time: at, reason: 'wake' });
  }
  // A repeatable template's gap runs out on the clock, and a sowing predicate on the hour changes with it (S2 section 4.3).
  for (const [pid, p] of l2.packs) if (p.pack.seeds.some((s) => s.repeat !== undefined) || sowReads(p).hour) l2.sowQueue.add(pid);
}

const sowReadsCache = new WeakMap<object, { settings: boolean; seeds: boolean; exposure: boolean; hour: boolean }>();

/** What layer-2 state the sowing predicates of a pack's templates read besides the kernel's (the reverse index for sowing, S2 section 4.1). */
export function sowReads(index: import('./packs.ts').PackIndex): { settings: boolean; seeds: boolean; exposure: boolean; hour: boolean } {
  let r = sowReadsCache.get(index);
  if (!r) {
    r = { settings: false, seeds: false, exposure: false, hour: false };
    for (const s of index.pack.seeds) {
      if (s.sow === undefined) continue;
      for (const { atom } of atoms(toPred(s.sow))) {
        if ('setting' in atom) r.settings = true;
        else if ('seed' in atom) r.seeds = true;
        else if ('exposed' in atom) r.exposure = true;
        else if ('hour' in atom) r.hour = true;
      }
    }
    sowReadsCache.set(index, r);
  }
  return r;
}

/** Run queued work within the tick budget (S0 section 10.7, S2 section 4.4). Instances run in Id order. */
export function runWork(l2: Layer2, budget: Budget): number {
  let cost = 0;
  const spend = (n: number): void => { cost += n; };
  let guard = 0;
  if (l2.boundaryDue !== undefined) {
    spend(runMaintenance(l2, l2.boundaryDue));
    spend(lapsesDue(l2));
    l2.boundaryDue = undefined;
  }
  for (const pid of [...l2.sowQueue].sort()) {
    l2.sowQueue.delete(pid);
    spend(handleSowing(l2, pid));
    if (budget.remaining - cost <= 0 && guard++ > 0) return cost;
  }
  while (l2.dilemmaQueue.length > 0) {
    handleDilemma(l2, l2.dilemmaQueue.shift()!);
    spend(1);
  }
  let first = true;
  while (l2.queue.size > 0 && guard < 10_000) {
    if (!first && budget.remaining - cost <= 0) break;
    first = false;
    guard++;
    const id = [...l2.queue.keys()].sort()[0]!;
    const triggers = l2.queue.get(id)!;
    l2.queue.delete(id);
    const inst = l2.insts.get(id);
    if (inst && !isTerminal(inst.st.state)) {
      reevaluate(l2, inst, triggers);
      spend(l2.tun.stepCost);
    }
  }
  return cost;
}

void predSites; void fragmentSites; void layerOfInstance; void originOf; void Arbiter;
export type { GlobalState, Pred, Trigger };
