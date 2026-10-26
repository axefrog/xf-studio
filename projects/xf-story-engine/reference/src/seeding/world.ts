// World requirements (S2 sections 2.5, 3.2, 3.5): a fixed requirement compiles to a `constrain`
// contribution, a preferred one to a `weight` contribution. Layer 2 watches its own fixed requirements,
// because a fixed requirement can lose to a higher layer without the kernel reporting a contradiction.

import type { StagedBatch } from '../batch.ts';
import type { ContributionSpec } from '../kernel.ts';
import { contains } from '../region.ts';
import type { Contribution, Form, Id, Layer, Query, QueryScope, Selector, Value } from '../types.ts';
import { valuesEqual } from '../value.ts';
import { bound } from './doc.ts';
import { encounterAllowed } from './encounter.ts';
import { nudgeLegal } from './nudge.ts';
import type { Instance, Layer2 } from './layer2.ts';
import type { WorldRequirement } from './types.ts';

/** The layer a seed's contributions take (S2 section 3.2). */
export const layerOfInstance = (inst: Instance): Layer => (inst.st.source.layer === 'authored' ? 'authored' : 'procedural');

/** The origin tag of a seed's compiled contributions: `pack:`-prefixed, so a load reinstalls them from the stored document (S2 section 12.1). */
export const originOf = (inst: Instance): string => `pack:seed/${inst.id}`;

export interface Installed {
  index: number;
  contribution: Id;
  nodes: Id[];
  slot: string;
  form: Form;
}

/** The target nodes a requirement names right now: the cast node of its role, or the expansion of a selector. */
export function requirementNodes(l2: Layer2, inst: Instance, w: WorldRequirement, staged: Record<string, Id> = {}): { nodes: Id[]; slot: string; tooBroad?: boolean } | undefined {
  // A role being committed in an open batch has its node in `staged` before the layer-2 state records it (a stand-in is minted there).
  const castOf = (role: string): Id | undefined => staged[role] ?? inst.st.roles[role]?.cast;
  if ('role' in w.target) {
    const n = castOf(w.target.role);
    return n === undefined ? undefined : { nodes: [n], slot: w.target.slot };
  }
  const sel = w.target.selector;
  const slot = sel.slot === '*' ? '*' : sel.slot;
  const resolve = (x: string): Id => (castOf(x) ?? l2.k.expandId(x));
  if (sel.scope && 'nodes' in sel.scope) return { nodes: sel.scope.nodes.map(resolve), slot };
  const scope: QueryScope = sel.scope ? ('under' in sel.scope ? { under: resolve(sel.scope.under) } : { region: sel.scope.region }) : { under: l2.k.expandId('root:city') };
  const q: Query = { find: sel.kind ?? 'core:thing', scope, at: l2.k.now, must: sel.where ?? [], limit: l2.tun.watchMax + 1 };
  const out = l2.k.query(q);
  if (out.status === 'failed') return { nodes: [], slot, tooBroad: true };
  const nodes = out.items.map((i) => i.id);
  if (nodes.length > l2.tun.watchMax) return { nodes: nodes.slice(0, l2.tun.watchMax), slot, tooBroad: true };
  return { nodes, slot };
}

function contributionSpec(l2: Layer2, inst: Instance, index: number, w: WorldRequirement, nodes: Id[], slot: string, selector?: Selector): ContributionSpec | undefined {
  const b = bound(w.form);
  if (b.status === 'open' || b.value === undefined) return undefined;
  const target: Selector = selector ?? { slot, scope: { nodes } };
  const spec: ContributionSpec = {
    source: { layer: layerOfInstance(inst), origin: originOf(inst) },
    target, form: b.value, mode: b.status === 'fixed' ? 'constrain' : 'weight', strength: b.status === 'prefer' ? b.strength ?? 1 : 1,
    valid: { from: l2.k.now },
  };
  void index;
  return spec;
}

/**
 * Install a requirement's contribution (inside a staged batch if one is given). Returns what was installed, for the
 * watch, or undefined when it names a role that is not cast, or is open.
 */
export function installRequirement(l2: Layer2, inst: Instance, index: number, batch?: StagedBatch, fromTime?: number, silent = false, staged: Record<string, Id> = {}): Installed | undefined {
  if (!silent && (!encounterAllowed(l2, inst) || !nudgeLegal(l2, inst))) return undefined;
  const w = inst.st.document.world![index]!;
  const nodes = requirementNodes(l2, inst, w, staged);
  if (!nodes || (nodes.nodes.length === 0 && !('selector' in w.target))) return undefined;
  const selector = 'selector' in w.target ? w.target.selector : undefined;
  const spec = contributionSpec(l2, inst, index, w, nodes.nodes, nodes.slot, selector);
  if (!spec) return undefined;
  if (fromTime !== undefined) spec.valid = { from: fromTime };
  if (silent) spec.silent = true;
  const make = (): Contribution => l2.k.contribute(spec);
  const c = batch ? batch.write(make) : make();
  return { index, contribution: c.id, nodes: nodes.nodes, slot: nodes.slot, form: spec.form };
}

export function endRequirement(l2: Layer2, inst: Instance, index: number): void {
  const e = inst.st.world[index];
  if (!e || !e.contribution || e.ended) return;
  l2.k.endContribution(e.contribution, l2.k.now);
  e.ended = true;
  e.to = l2.k.now;
}

/** Whether a value satisfies a fixed form (the direct check of a mirrored target, S2 section 3.5). */
export function formHolds(form: Form, value: Value): boolean {
  if (form.f === 'const') return valuesEqual(value, form.value);
  if (form.f === 'set') {
    const inside = contains(form.region, value);
    return form.allow ? inside : !inside;
  }
  return true;
}
