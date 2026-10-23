// Casting (S2 section 5): roles are cast in topological order, one role at a time, by a bounded kernel
// query, source filters, claim priority and a layer-2 draw. Casting is read-only: tentative casts live in
// layer-2 state and add nothing to the kernel (its revision does not change).

import { ln } from '../fdlibm-log.ts';
import { mirroredId, rootId } from '../id.ts';
import { evalPredicate } from '../predicate.ts';
import { newOpCtx } from '../resolve.ts';
import { LimitExceeded } from '../work.ts';
import type { GameTime, Id, Predicate, Query, QueryScope } from '../types.ts';
import { bound, playOf } from './doc.ts';
import { gameTick } from './eval.ts';
import { barredRoles } from './floors.ts';
import { recordClaim } from './intersect.ts';
import { roleDeps } from './lint.ts';
import type { Instance, Layer2 } from './layer2.ts';
import { isTerminal } from './layer2.ts';
import * as ids from './ids.ts';
import type { LadderStep, Role, RolePredicate, RoleState } from './types.ts';

export interface CastAttempt {
  node?: Id;
  candidates: number;
  /** Why it is unfilled. */
  reason?: string;
  /** `maybe` readings kept a candidate out: waiting may help. */
  maybe?: boolean;
  tooBroad?: boolean;
}

export const GAME_PREFIX = 'game:';

export function identityNode(l2: Layer2, role: Role): { status: 'fixed' | 'prefer' | 'none'; node?: Id; strength?: 1 | 2 | 3; reason?: string } {
  const b = bound(role.identity);
  if (b.status === 'open' || b.value === undefined) return { status: 'none' };
  const raw = b.value as string;
  let node: Id | undefined;
  if (raw.startsWith(GAME_PREFIX)) {
    const id = mirroredId(raw.slice(GAME_PREFIX.length));
    node = l2.k.store.header(id) ? id : undefined;
  } else if (raw.startsWith('root:')) node = l2.k.expandId(raw);
  else node = raw;
  const out: { status: 'fixed' | 'prefer' | 'none'; node?: Id; strength?: 1 | 2 | 3; reason?: string } = { status: b.status === 'fixed' ? 'fixed' : 'prefer' };
  if (b.strength !== undefined) out.strength = b.strength;
  if (node === undefined || !l2.k.store.header(node)) out.reason = `the game does not know "${raw}" yet`;
  else out.node = node;
  return out;
}

/** The effective `must` terms and the preferences the relaxed ones become (S2 section 5.2 step 1). */
export function effective(role: Role, rs: RoleState): { must: RolePredicate[]; relaxedAsPrefer: RolePredicate[] } {
  const relaxed = new Set(rs.ladder.relaxed);
  const must: RolePredicate[] = [];
  const relaxedAsPrefer: RolePredicate[] = [];
  (role.must ?? []).forEach((m, i) => (relaxed.has(i) ? relaxedAsPrefer.push(m) : must.push(m)));
  return { must, relaxedAsPrefer };
}

function substitute(l2: Layer2, inst: Instance, p: RolePredicate): { p?: Predicate; missing?: string } {
  const sub = (arg: unknown): { v: unknown; missing?: string } => {
    if (Array.isArray(arg)) {
      const out: unknown[] = [];
      for (const a of arg) {
        const r = sub(a);
        if (r.missing) return r;
        out.push(r.v);
      }
      return { v: out };
    }
    if (typeof arg === 'object' && arg !== null) {
      const o = arg as Record<string, unknown>;
      if (Object.keys(o).length === 1 && typeof o.role === 'string') {
        const c = inst.st.roles[o.role]?.cast;
        return c === undefined ? { v: arg, missing: o.role } : { v: c };
      }
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(o)) {
        const r = sub(v);
        if (r.missing) return r;
        out[key] = r.v;
      }
      return { v: out };
    }
    return { v: arg };
  };
  const r = sub(p.arg);
  if (r.missing) return { missing: r.missing };
  return { p: { ...p, arg: r.v } as Predicate };
}

/** A kernel predicate on a candidate node: yes, no, or maybe (the kernel's resolution is not ok). */
export function verdictOnNode(l2: Layer2, node: Id, p: Predicate, t: GameTime): 'yes' | 'no' | 'maybe' {
  const k = l2.k;
  const env = k.resolver.makeEnv(newOpCtx(k.config.allowance), t);
  let bad = false;
  const base = env.read;
  env.read = (n, path) => {
    const r = base(n, path);
    if (r.status !== 'ok' || r.value === undefined) bad = true;
    return r;
  };
  try {
    const yes = evalPredicate(env, p, node);
    return bad ? 'maybe' : yes ? 'yes' : 'no';
  } catch (e) {
    if (e instanceof LimitExceeded) return 'maybe';
    throw e;
  }
}

/** Every term yes: yes. Any no: no. Otherwise maybe. */
function allMust(l2: Layer2, inst: Instance, node: Id, terms: RolePredicate[], t: GameTime): { v: 'yes' | 'no' | 'maybe'; missing?: string } {
  let maybe = false;
  for (const m of terms) {
    const s = substitute(l2, inst, m);
    if (s.missing) return { v: 'maybe', missing: s.missing };
    const v = verdictOnNode(l2, node, s.p!, t);
    if (v === 'no') return { v: 'no' };
    if (v === 'maybe') maybe = true;
  }
  return { v: maybe ? 'maybe' : 'yes' };
}

const ROOT_ACTORS = ['v', 'director', 'city'];
const isAdultNode = (l2: Layer2, node: Id, t: GameTime): boolean => l2.k.value(node, 'age-class', t) === 'adult';

const barredCache = new WeakMap<object, Map<string, string>>();
export function barredOf(l2: Layer2, inst: Instance): Map<string, string> {
  let b = barredCache.get(inst.st.document);
  if (!b) {
    const pack = l2.packs.get(inst.st.template.pack ?? '');
    b = pack ? barredRoles(inst.st.document, pack, l2.reg) : new Map();
    barredCache.set(inst.st.document, b);
  }
  return b;
}

// ---- claims (S2 section 9) ----

interface Holder { inst: Instance; role: string; committed: boolean }

/** The live instances (other than `me`) that hold `node` in a role, tentatively or committed. */
function holdersOf(l2: Layer2, node: Id, me: Instance): Holder[] {
  const out: Holder[] = [];
  for (const other of l2.all()) {
    if (other === me || isTerminal(other.st.state)) continue;
    // A fit report's stand-in instance is not registered; the live instances of its own template do not claim against it.
    if (!l2.insts.has(me.id) && other.st.template.id === me.st.template.id) continue;
    for (const [role, rs] of Object.entries(other.st.roles)) {
      if (rs.cast === node && !rs.shrunk) out.push({ inst: other, role, committed: rs.committed });
    }
  }
  return out;
}

const claimOf = (inst: Instance, role: string): { span: 'seed' | 'beats'; share: 'none' | 'background' | 'any' } =>
  inst.st.document.roles[role]?.claim ?? { span: 'seed', share: 'none' };

/** Whether a beat of `inst` that binds `role` is available or running now, and whether it is foreground. */
function liveBinding(l2: Layer2, inst: Instance, role: string): { live: boolean; foreground: boolean } {
  let live = false;
  let foreground = false;
  for (const [bk, b] of Object.entries(inst.st.document.beats)) {
    const rt = inst.st.beats[bk];
    if (!rt || (rt.state !== 'available' && rt.state !== 'running')) continue;
    const pack = l2.packs.get(inst.st.template.pack ?? '');
    // Every form `play` can take (a reference, alternates, or a fixed part holding either) is read by the one decoder.
    for (const ref of playOf(b).refs) {
      const f = inst.st.closure.fragments.find((x) => x.id === ref.replace(/^pack:/, '')) ?? pack?.fragment(ref);
      if (f?.roles.some((r) => (b.bind?.[r] ?? r) === role)) {
        live = true;
        if (f.salience === 'foreground') foreground = true;
      }
    }
  }
  return { live, foreground };
}

/** Whether two claims on the same node conflict (S2 section 9.1: spans overlap, and they do not share). */
export function claimsConflict(l2: Layer2, a: Holder, b: Holder): boolean {
  const ca = claimOf(a.inst, a.role);
  const cb = claimOf(b.inst, b.role);
  const activeA = ca.span === 'seed' || liveBinding(l2, a.inst, a.role).live;
  const activeB = cb.span === 'seed' || liveBinding(l2, b.inst, b.role).live;
  if (!activeA || !activeB) return false;
  if (ca.share === 'any' && cb.share === 'any') return false;
  if (ca.share === 'background' && cb.share === 'background' && !liveBinding(l2, a.inst, a.role).foreground && !liveBinding(l2, b.inst, b.role).foreground) return false;
  return true;
}

/** Claim priority (S2 section 9.2): authored over procedural, committed over tentative, the earlier commit, then the lower seed Id. True when `a` wins. */
export function claimWins(a: Holder, b: Holder): boolean {
  const authored = (h: Holder): boolean => h.inst.st.source.layer === 'authored';
  if (authored(a) !== authored(b)) return authored(a);
  if (a.committed !== b.committed) return a.committed;
  if (a.committed && b.committed) {
    const ta = a.inst.st.roles[a.role]!.committedAt ?? 0;
    const tb = b.inst.st.roles[b.role]!.committedAt ?? 0;
    if (ta !== tb) return ta < tb;
  }
  return a.inst.id < b.inst.id;
}

/** The claim conflict `claimConflict(node, span, share)` read for layer 3 (S2 section 10.1a). */
export function claimConflictRead(l2: Layer2, node: Id, span: 'seed' | 'beats', share: 'none' | 'background' | 'any'): boolean {
  for (const other of l2.live()) {
    for (const [role, rs] of Object.entries(other.st.roles)) {
      if (rs.cast !== node || rs.shrunk) continue;
      const c = claimOf(other, role);
      const live = c.span === 'seed' || liveBinding(l2, other, role).live;
      if (!live) continue;
      if (c.share === 'any' && share === 'any') continue;
      if (c.share === 'background' && share === 'background' && !liveBinding(l2, other, role).foreground) continue;
      if (span === 'seed' || c.span === 'seed' || liveBinding(l2, other, role).live) return true;
    }
  }
  return false;
}

// ---- casting one role ----

function scopeOf(l2: Layer2, inst: Instance, role: Role): QueryScope | { missing: string } {
  const sc = role.scope;
  const city = rootId(l2.worldSeed, 'city');
  const res = (r: string): Id | undefined => {
    if (/^[0-9a-f]{32}$/.test(r)) return r;
    if (r.startsWith('root:')) return l2.k.expandId(r);
    return inst.st.roles[r]?.cast;
  };
  if (sc === undefined || sc === 'city') {
    // The default: the district of the seed's place role, else the city (S2 section 2.4).
    if (sc === undefined) {
      for (const [k2, r2] of Object.entries(inst.st.document.roles)) {
        if (l2.k.schema.hasKind(r2.kind) && l2.k.schema.hasFacet(r2.kind, 'place') && inst.st.roles[k2]?.cast !== undefined && r2 !== role) {
          const district = l2.k.store.edgesFrom(inst.st.roles[k2]!.cast!).find((e) => e.type === 'core:located-in' && e.valid.to === undefined);
          if (district) return { under: district.to };
        }
      }
    }
    return { under: city };
  }
  if ('under' in sc) {
    const id = res(sc.under);
    return id === undefined ? { missing: sc.under } : { under: id };
  }
  if ('nodes' in sc) {
    const out: Id[] = [];
    for (const n of sc.nodes) {
      const id = res(n);
      if (id === undefined) return { missing: n };
      out.push(id);
    }
    return { nodes: out };
  }
  return { region: sc.region };
}

/**
 * Cast one role (S2 section 5.2). On success the tentative cast is written to the role's state. Read-only on
 * the kernel. Returns what happened, for the ladder.
 */
export function castRole(l2: Layer2, inst: Instance, key: string): CastAttempt {
  const role = inst.st.document.roles[key]!;
  const rs = inst.st.roles[key]!;
  const t = l2.k.now;
  const { must, relaxedAsPrefer } = effective(role, rs);
  const ident = identityNode(l2, role);
  let candidates: Id[] = [];
  let maybeSeen = false;
  const fail = (reason: string, extra: Partial<CastAttempt> = {}): CastAttempt => {
    rs.cast = undefined;
    rs.unfilled = reason;
    rs.candidates = candidates.length;
    return { candidates: candidates.length, reason, ...extra };
  };

  if (ident.status === 'fixed') {
    if (!ident.node) return fail(ident.reason ?? 'its identity is not known');
    const hdr = l2.k.store.header(ident.node)!;
    if (!l2.k.schema.isKind(hdr.kind, role.kind)) return fail(`${ident.node} is not a ${role.kind}`);
    const v = allMust(l2, inst, ident.node, must, t);
    if (v.v === 'maybe') return fail(v.missing ? `waiting for the role "${v.missing}"` : 'a requirement of the role cannot be read yet', { maybe: true });
    if (v.v === 'no') return fail('the fixed person does not meet the role\'s requirements');
    candidates = [ident.node];
  } else {
    const scope = scopeOf(l2, inst, role);
    if ('missing' in scope) return fail(`waiting for the role "${scope.missing}"`, { maybe: true });
    const subs: Predicate[] = [];
    for (const m of must) {
      const s = substitute(l2, inst, m);
      if (s.missing) return fail(`waiting for the role "${s.missing}"`, { maybe: true });
      subs.push(s.p!);
    }
    const q: Query = { find: role.kind, scope, at: t, must: subs, limit: 'all' };
    const out = l2.k.query(q);
    if (out.status === 'failed') return fail(`the search was too broad (${out.reason})`, { tooBroad: true });
    candidates = out.items.map((x) => x.id);
    if (ident.status === 'prefer' && ident.node && !candidates.includes(ident.node)) {
      const hdr = l2.k.store.header(ident.node);
      if (hdr && l2.k.schema.isKind(hdr.kind, role.kind) && allMust(l2, inst, ident.node, must, t).v === 'yes') candidates.push(ident.node);
    }
  }
  candidates = [...new Set(candidates)].sort();

  // Root actors are never cast: V is observed, never owned (D-09).
  candidates = candidates.filter((c) => !ROOT_ACTORS.some((r) => rootId(l2.worldSeed, r) === c));
  // Source filters: a seed the director sowed excludes main-story characters and the player's excluded NPCs (S2 section 5.2).
  if (inst.st.source.by === 'director') {
    const excl = new Set<Id>([...(l2.opts.spine ?? []), ...l2.k.settings.at(t).exclusions]);
    candidates = candidates.filter((c) => !excl.has(c));
  }
  // The minors floor: casting removes non-adults from barred roles (S2 section 2.19).
  if (barredOf(l2, inst).has(key)) candidates = candidates.filter((c) => isAdultNode(l2, c, t));
  // Claims: a candidate stays if this seed would win the claim.
  const me: Holder = { inst, role: key, committed: rs.committed };
  const lost: Array<{ node: Id; by: Holder }> = [];
  candidates = candidates.filter((c) => {
    for (const h of holdersOf(l2, c, inst)) {
      if (claimsConflict(l2, me, h) && !claimWins(me, h)) {
        lost.push({ node: c, by: h });
        return false;
      }
    }
    return true;
  });
  // A report's stand-in instance is not registered: it records nothing on the seeds it would meet.
  if (l2.insts.has(inst.id)) for (const x of lost) recordClaim(l2, inst, key, x.by.inst, x.by.role, x.node, x.by.inst.id);
  if (candidates.length === 0) return fail(maybeSeen ? 'a requirement cannot be read yet' : 'no candidate meets the role\'s requirements');

  // Choose: the layer-2 draw, with the preference terms added in a fixed order (S2 section 5.2 step 6).
  const lnK = ln(l2.tun.K);
  const holds = (c: Id, p: RolePredicate): boolean => {
    const s = substitute(l2, inst, p);
    return !s.missing && verdictOnNode(l2, c, s.p!, t) === 'yes';
  };
  const options = candidates.map((c) => {
    let bonus = 0;
    if (ident.status === 'prefer' && ident.node === c) bonus += (ident.strength ?? 1) * lnK;
    for (const pr of role.prefer ?? []) if (holds(c, pr.p)) bonus += pr.strength * lnK;
    for (const pr of relaxedAsPrefer) if (holds(c, pr)) bonus += 1 * lnK;
    return { id: c, bonus, isId: true };
  });
  const choice = `cast:${key}`;
  const prior = inst.st.draws[choice];
  let node: Id;
  if (prior && prior.attempt === rs.attempt && candidates.includes(prior.value)) node = prior.value;
  else {
    const fit = l2.hooks.fit ? (o: string): number => l2.hooks.fit!(choice, o, { id: inst.id, template: inst.st.template.id }) : undefined;
    const d = l2.draw(inst.id, choice, options, rs.attempt, fit);
    node = d.value;
    const rec: { value: string; attempt: number; raw?: number; clamped?: number } = { value: d.value, attempt: rs.attempt };
    if (d.raw !== undefined) rec.raw = d.raw;
    if (d.clamped !== undefined) rec.clamped = d.clamped;
    inst.st.draws[choice] = rec;
  }
  rs.cast = node;
  rs.unfilled = undefined;
  rs.candidates = candidates.length;
  rs.standIn = undefined;
  return { node, candidates: candidates.length };
}

/** The recipe of a stand-in: only the constructible subset (S2 section 5.4). */
export function standInRecipe(l2: Layer2, role: Role, rs: RoleState): { kind: string; constraints: Predicate[] } | undefined {
  const { must } = effective(role, rs);
  const constraints: Predicate[] = [];
  for (const m of must) {
    const info = !m.path.includes('/') ? l2.k.schema.slotInfo(role.kind, m.path) : null;
    const ok = info && !info.isNode && info.vt.t !== 'ref' && !info.def.temporal && (m.op === 'eq' || m.op === 'in' || m.op === 'range');
    if (!ok) return undefined;
    constraints.push(m as Predicate);
  }
  return { kind: role.kind, constraints };
}

export type LadderResult =
  | { r: 'cast' }
  | { r: 'standIn' }
  | { r: 'waiting' }
  | { r: 'shrunk' }
  | { r: 'withdraw'; reason: string };

/**
 * Run a role's ladder from its saved cursor (S2 section 5.4). A `wait` step re-casts at every re-evaluation;
 * the rest advance as their rows say. Everything it decides is in the role's state, so a reload resumes it.
 */
export function runLadder(l2: Layer2, inst: Instance, key: string, first: CastAttempt): LadderResult {
  const role = inst.st.document.roles[key]!;
  const rs = inst.st.roles[key]!;
  const steps: LadderStep[] = role.onUnfilled ?? ['wait', 'withdraw'];
  let attempt = first;
  for (let guard = 0; guard < 64; guard++) {
    const step = steps[rs.ladder.cursor];
    if (step === undefined || step === 'withdraw') return { r: 'withdraw', reason: attempt.reason ?? 'the role could not be filled' };
    if (step === 'wait' || (typeof step === 'object' && 'wait' in step)) {
      const d = step === 'wait' ? 'window' : step.wait;
      if (d === 'window') return { r: 'waiting' };
      // A timed wait runs on its own clock: game time is read at window boundaries, play time on the cumulative play clock.
      if (d.clock === 'play') {
        if (rs.ladder.waitUntilPlay === undefined) rs.ladder.waitUntilPlay = l2.playTotal() + d.s;
        if (l2.playTotal() < rs.ladder.waitUntilPlay) return { r: 'waiting' };
        rs.ladder.waitUntilPlay = undefined;
      } else {
        if (rs.ladder.waitUntil === undefined) rs.ladder.waitUntil = l2.k.now + d.s;
        if (gameTick(l2) < rs.ladder.waitUntil) return { r: 'waiting' };
        rs.ladder.waitUntil = undefined;
      }
      rs.ladder.cursor++;
      continue;
    }
    if (typeof step === 'object' && 'relax' in step) {
      rs.ladder.cursor++;
      const term = (role.must ?? [])[step.relax];
      if (term === undefined || rs.ladder.relaxed.includes(step.relax)) continue;
      rs.ladder.relaxed.push(step.relax);
      rs.attempt++;
      attempt = castRole(l2, inst, key);
      if (attempt.node) return { r: 'cast' };
      continue;
    }
    if (step === 'standIn') {
      const recipe = standInRecipe(l2, role, rs);
      if (!recipe) {
        rs.ladder.cursor++;
        continue;
      }
      rs.standIn = recipe;
      rs.cast = undefined;
      rs.unfilled = undefined;
      return { r: 'standIn' };
    }
    if (step === 'shrink') {
      if (role.optional) {
        rs.shrunk = true;
        rs.cast = undefined;
        rs.unfilled = undefined;
        return { r: 'shrunk' };
      }
      rs.ladder.cursor++;
      continue;
    }
  }
  return { r: 'withdraw', reason: 'the ladder did not end' };
}

/** The topological order of role casting (S2 section 5.1): anchors first, then fail-first, then `order`, then key. */
export function castOrder(inst: Instance): string[] {
  const roles = inst.st.document.roles;
  const done = new Set<string>();
  const order: string[] = [];
  const keys = Object.keys(roles).sort();
  while (order.length < keys.length) {
    const ready = keys.filter((k) => !done.has(k) && roleDeps(roles[k]!).filter((d) => roles[d]).every((d) => done.has(d)));
    if (ready.length === 0) break; // a cycle is a lint error (L-13)
    ready.sort((a, b) => {
      const ra = roles[a]!;
      const rb = roles[b]!;
      if (!!ra.anchor !== !!rb.anchor) return ra.anchor ? -1 : 1;
      const ca = inst.st.roles[a]!.candidates ?? Infinity;
      const cb = inst.st.roles[b]!.candidates ?? Infinity;
      if (ca !== cb) return ca - cb;
      const oa = ra.order ?? 0;
      const ob = rb.order ?? 0;
      if (oa !== ob) return oa - ob;
      return a < b ? -1 : 1;
    });
    const next = ready[0]!;
    done.add(next);
    order.push(next);
  }
  return order;
}

void ids;
