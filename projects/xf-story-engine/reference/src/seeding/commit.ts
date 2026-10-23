// Committing roles (S2 section 5.3): the cast edges, the world requirements that start at commit, the role's
// goal frame, and its authored beliefs and edges. Everything here is written inside a staged batch (S2
// section 8.4), so a failed preparation leaves nothing in effect. The layer-2 state that records the commit is
// applied only after the batch commits: each write adds a closure to `commits`.

import type { Id, Predicate } from '../types.ts';
import { castOrder } from './cast.ts';
import type { Instance, Layer2 } from './layer2.ts';
import { type Installed, installRequirement, layerOfInstance, originOf } from './world.ts';
import type { BeliefDecl, EdgeDecl, Role, WorldRequirement } from './types.ts';
import * as ids from './ids.ts';

const fromOf = (w: WorldRequirement): string => w.from ?? ('role' in w.target ? 'commit' : 'sown');

/** A stand-in's constraints as fixed requirements at the seed's layer (S2 section 5.4). */
function installStandIn(l2: Layer2, inst: Instance, node: Id, constraints: Predicate[]): void {
  for (const c of constraints) {
    const form =
      c.op === 'eq'
        ? { f: 'const' as const, value: c.arg as never }
        : c.op === 'in'
          ? Array.isArray(c.arg) && c.arg.every((x) => typeof x === 'number')
            ? { f: 'set' as const, region: { r: 'ivl' as const, ivls: (c.arg as number[]).map((n): [number, number] => [n, n]) }, allow: true }
            : { f: 'set' as const, region: { r: 'set' as const, values: (Array.isArray(c.arg) ? c.arg : [c.arg]) as string[] }, allow: true }
          : { f: 'set' as const, region: { r: 'ivl' as const, ivls: [[(c.arg as number[])[0]!, (c.arg as number[])[1]!] as [number, number]] }, allow: true };
    l2.k.contribute({
      source: { layer: layerOfInstance(inst), origin: originOf(inst) }, target: { slot: c.path, scope: { nodes: [node] } }, form, mode: 'constrain',
      valid: { from: l2.k.now },
    });
  }
}

function castOf(inst: Instance, ref: string, v: Id): Id | undefined {
  if (ref === 'v') return v;
  if (/^[0-9a-f]{32}$/.test(ref)) return ref;
  return inst.st.roles[ref]?.cast;
}

/**
 * Commit roles inside the open batch. Returns the requirements installed, for the fixed-part watch. Layer-2
 * state changes are queued on `commits`, to run once the batch commits.
 */
export function commitRoles(l2: Layer2, inst: Instance, roles: string[], cause: Id, commits: Array<(i: Instance) => void>): Installed[] {
  const k = l2.k;
  const st = inst.st;
  const doc = st.document;
  const installed: Installed[] = [];
  const first = !st.committed;
  const order = castOrder(inst).filter((r) => roles.includes(r));
  const nodes: Record<string, Id> = {};
  const now = k.now;
  for (const r of order) {
    const rs = st.roles[r]!;
    const role: Role = doc.roles[r]!;
    let node = rs.cast;
    let standIn = false;
    if (node === undefined && rs.standIn) {
      node = k.mint(inst.id, inst.id, `role:${r}`, rs.standIn.kind);
      installStandIn(l2, inst, node, rs.standIn.constraints);
      standIn = true;
    }
    if (node === undefined) continue;
    nodes[r] = node;
    const edge = k.addEdge({ type: 'core:cast', from: inst.id, to: node, data: { role: r }, cause });
    const roleFrame = st.frames.roles[r];
    if (roleFrame) k.frames.setFocus(roleFrame, { nodes: [node] }, inst.id);
    let goalFrame: Id | undefined;
    if (role.goal) {
      const effects = role.goal.effects.flatMap((e) => {
        const on = castOf(inst, e.on, k.vId) ?? (nodes[e.on] as Id | undefined);
        return on === undefined ? [] : [{ on, effect: e.effect }];
      });
      goalFrame = ids.goalFrameId(inst.id, r);
      k.frames.open({
        id: goalFrame, actor: node, level: 'goal', origin: roleFrame ?? inst.id, weight: 1, cause: inst.id,
        parents: roleFrame ? [{ frame: roleFrame, weight: 1 }] : [], payload: { goal: { effects } }, focus: { nodes: [node], tier: 3 },
      });
    }
    for (const a of role.authored ?? []) {
      if ('belief' in a) {
        const b = (a as BeliefDecl).belief;
        const about = castOf(inst, b.about, k.vId);
        if (about === undefined) continue;
        const belief: Parameters<typeof k.beliefs.set>[0] = {
          believer: node, subject: about, path: b.path, confidence: b.confidence ?? 1, evidence: [inst.id],
          source: { by: 'inferred', rule: { name: 'seed', version: 1 }, from: [inst.id] }, formed: now, refreshed: now, memorable: true,
        } as never;
        if (b.value !== undefined) belief.value = b.value;
        if (b.region !== undefined) belief.region = b.region;
        k.beliefs.set(belief);
      } else {
        const e = (a as EdgeDecl).edge;
        const to = castOf(inst, e.to, k.vId);
        if (to === undefined) continue;
        k.addEdge({ type: e.type, from: node, to, attrs: (e.attrs ?? {}) as never, cause: inst.id });
      }
    }
    // The world requirements that name this role and start at commit.
    (doc.world ?? []).forEach((w, i) => {
      if (st.world[i]?.installed || fromOf(w) !== 'commit' || !('role' in w.target) || w.target.role !== r) return;
      const ins = installRequirement(l2, inst, i, k.batch ?? undefined);
      if (ins) {
        installed.push(ins);
        commits.push((x) => { x.st.world[i] = { contribution: ins.contribution, installed: true, ended: false, from: now }; });
      }
    });
    const edgeId = edge.id;
    commits.push((x) => {
      const s = x.st.roles[r]!;
      s.committed = true;
      s.committedAt = now;
      s.cast = node;
      if (s.standIn) s.minted = s.standIn;
      s.standIn = undefined;
      s.unfilled = undefined;
      x.st.edges[r] = edgeId;
      if (goalFrame) x.st.frames.goals[r] = goalFrame;
      l2.record(x, 'commit', { role: r, node, standIn });
    });
  }
  if (first) {
    (doc.world ?? []).forEach((w, i) => {
      if (st.world[i]?.installed || fromOf(w) !== 'commit' || 'role' in w.target) return;
      const ins = installRequirement(l2, inst, i, k.batch ?? undefined);
      if (ins) {
        installed.push(ins);
        commits.push((x) => { x.st.world[i] = { contribution: ins.contribution, installed: true, ended: false, from: now }; });
      }
    });
  }
  return installed;
}
