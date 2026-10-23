// Intersections (S2 section 9): two live seeds intersect by claim (the same node, overlapping claims that do
// not share), by effect (one writes what the other reads) or by pressure (the kernel reports a dilemma).
// Claims are settled by priority; effects by the reader's `depends`; pressure is never settled away. Each
// intersection is recorded on both seeds the first time it is found, and again only if its outcome changes.

import type { Dilemma } from '../frames.ts';
import type { Id } from '../types.ts';
import { atoms, effectSites, predSites } from './doc.ts';
import { claimWins, claimsConflict } from './cast.ts';
import type { Instance, Layer2 } from './layer2.ts';
import { isTerminal } from './layer2.ts';
import { fragmentOf } from './beats.ts';
import { onRoleLost } from './run.ts';

/** Record an intersection on an instance once, and again only when its outcome changes. */
function recordOnce(l2: Layer2, inst: Instance, key: string, outcome: string, data: Record<string, unknown>): void {
  if (inst.st.intersections[key] === outcome) return;
  inst.st.intersections[key] = outcome;
  l2.record(inst, 'intersection', { ...data, outcome });
}

export function recordClaim(l2: Layer2, a: Instance, aRole: string, b: Instance, bRole: string, node: Id, winner: Id): void {
  const outcome = `winner:${winner}`;
  const key = (x: Instance, xr: string, y: Instance, yr: string): string => `claim|${node}|${xr}|${y.id}|${yr}`;
  recordOnce(l2, a, key(a, aRole, b, bRole), outcome, { kind: 'claim', node, role: aRole, with: b.id, withRole: bRole });
  recordOnce(l2, b, key(b, bRole, a, aRole), outcome, { kind: 'claim', node, role: bRole, with: a.id, withRole: aRole });
}

/** A role lost to a claim: a tentative cast goes and is cast again; a committed one is lost (S2 section 9.2). */
function lose(l2: Layer2, inst: Instance, role: string): void {
  const rs = inst.st.roles[role];
  if (!rs) return;
  if (rs.committed) {
    l2.record(inst, 'lost', { role, claim: true });
    onRoleLost(l2, inst, role);
  } else {
    rs.cast = undefined;
    rs.attempt++;
  }
  l2.queueReeval(inst, 'claim lost');
}

/** Detect and settle the intersections of an instance with the other live ones. */
export function detectIntersections(l2: Layer2, inst: Instance): void {
  const st = inst.st;
  for (const [role, rs] of Object.entries(st.roles)) {
    if (rs.cast === undefined || rs.shrunk) continue;
    for (const other of l2.all()) {
      if (other === inst || isTerminal(other.st.state)) continue;
      for (const [orole, ors] of Object.entries(other.st.roles)) {
        if (ors.cast !== rs.cast || ors.shrunk) continue;
        const me = { inst, role, committed: rs.committed };
        const them = { inst: other, role: orole, committed: ors.committed };
        if (!claimsConflict(l2, me, them)) continue;
        const mine = claimWins(me, them);
        recordClaim(l2, inst, role, other, orole, rs.cast, mine ? inst.id : other.id);
        if (mine) lose(l2, other, orole);
        else lose(l2, inst, role);
      }
    }
  }
  detectEffects(l2, inst);
}

/** An effect one seed declares writes a fact, or targets a node, that another reads (S2 section 9.1). */
function detectEffects(l2: Layer2, a: Instance): void {
  const writes = new Set<string>();
  const targets = new Set<Id>();
  for (const e of effectSites(a.st.document, (r) => fragmentOf(a, r))) {
    if ('game' in e.effect) writes.add(e.effect.game.fact);
    if ('kernel' in e.effect) {
      const n = a.st.roles[e.effect.kernel.on]?.cast;
      if (n) targets.add(n);
    }
  }
  if (writes.size === 0 && targets.size === 0) return;
  for (const b of l2.live()) {
    if (b === a) continue;
    const reads = new Set<string>();
    const nodes = new Set<Id>();
    for (const s of predSites(b.st.document)) {
      for (const { atom } of atoms(s.pred)) {
        if ('fact' in atom) reads.add(atom.fact);
        if ('role' in atom) { const n = b.st.roles[atom.role]?.cast; if (n) nodes.add(n); }
      }
    }
    const hit = [...writes].filter((w) => reads.has(w)).concat([...targets].filter((n) => nodes.has(n)));
    if (hit.length === 0) continue;
    const dep = (b.st.document.depends ?? []).find((d) => ('fact' in (d.on as object) ? writes.has((d.on as { fact: string }).fact) : false) || (typeof d.on === 'string' && targets.has(b.st.roles[d.on]?.cast as Id)));
    const hold = dep?.hold ?? 'notice';
    // Nothing is blocked; B's `depends` decides. `substitute` asks B to cast its role again.
    recordOnce(l2, a, `effect|${b.id}|${hit.sort().join(',')}`, `hold:${hold}`, { kind: 'effect', reader: b.id, on: hit.sort() });
    recordOnce(l2, b, `effect|${a.id}|${hit.sort().join(',')}`, `hold:${hold}`, { kind: 'effect', writer: a.id, on: hit.sort() });
    if (hold === 'substitute' && typeof dep?.on === 'string') {
      const rs = b.st.roles[dep.on];
      if (rs && !rs.committed) { rs.cast = undefined; rs.attempt++; l2.queueReeval(b, 'substitute'); }
    }
  }
}

/** A dilemma the kernel reported: recorded as a `pressure` intersection on the seed whose role goal is in it (never settled away). */
export function handleDilemma(l2: Layer2, d: Dilemma): void {
  for (const inst of l2.live()) {
    const goals = Object.values(inst.st.frames.goals);
    const roles = Object.values(inst.st.frames.roles);
    const involved = [d.frameA, d.frameB].some((f) => goals.includes(f) || roles.includes(f) || l2.k.frames.ancestorsOrSelf(f).some((a) => goals.includes(a) || roles.includes(a)));
    if (!involved) continue;
    recordOnce(l2, inst, `pressure|${d.target}|${d.effect}|${d.frameB}`, 'handed-to-s3', { kind: 'pressure', target: d.target, effect: d.effect, frameA: d.frameA, frameB: d.frameB, severity: d.severity });
  }
}
