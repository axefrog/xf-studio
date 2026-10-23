// Watching fixed parts (S2 section 3.5). A fixed world requirement can lose to a higher layer without the
// kernel reporting a contradiction (only a rejected constraint of 600 or more sets `contradiction`), so
// layer 2 watches its own. For a target that arbitrates, `trace` says whether the requirement's constraint
// was rejected. For a mirrored slot of a mirrored node, which resolves straight from game readings, the value
// is tested against the requirement's form directly.

import type { StagedBatch } from '../batch.ts';
import type { Id } from '../types.ts';
import { bound } from './doc.ts';
import type { Instance, Layer2 } from './layer2.ts';
import { type Installed, formHolds, requirementNodes } from './world.ts';

export interface Rejection {
  index: number;
  why: string;
  policy: 'withdraw' | 'degrade' | 'refit';
}

function checkNode(l2: Layer2, inst: Instance, batch: StagedBatch | undefined, ins: { contribution: Id; slot: string; form: Installed['form'] }, node: Id): string | undefined {
  const k = l2.k;
  const h = k.store.header(node);
  if (!h) return undefined;
  const slot = ins.slot;
  const info = slot === '*' ? null : k.schema.slotInfo(h.kind, slot);
  if (info && info.def.mode === 'mirrored' && h.origin.by === 'mirrored') {
    const r = batch ? batch.resolve(node, slot) : k.resolve(node, slot);
    if (r.status !== 'ok' || r.value === undefined) return undefined;
    return formHolds(ins.form, r.value) ? undefined : `the game reads ${slot} of ${node} as ${JSON.stringify(r.value)}`;
  }
  if (slot === '*') return undefined;
  const tr = batch ? batch.trace(node, slot) : k.trace(node, slot);
  const c = tr.constraints.find((x) => x.id === ins.contribution);
  if (c && !c.active) return `the requirement on ${slot} of ${node} was rejected by a higher layer`;
  return undefined;
}

/**
 * Check every fixed requirement that is installed (and those the batch is installing), and return the ones that
 * fail. Runs right after install, while preparing a release, and on every relevance event for the target.
 */
export function watchFixed(l2: Layer2, inst: Instance, batch: StagedBatch | undefined, extra: Installed[] = []): Rejection[] {
  const doc = inst.st.document;
  const out: Rejection[] = [];
  const seen = new Set<number>();
  const items: Installed[] = [...extra];
  (doc.world ?? []).forEach((w, i) => {
    const e = inst.st.world[i];
    if (!e || !e.installed || e.ended || !e.contribution || extra.some((x) => x.index === i)) return;
    const n = requirementNodes(l2, inst, w);
    const b = bound(w.form);
    if (!n || b.value === undefined) return;
    items.push({ index: i, contribution: e.contribution, nodes: n.nodes, slot: n.slot, form: b.value });
  });
  for (const ins of items) {
    if (seen.has(ins.index)) continue;
    const w = doc.world![ins.index]!;
    const b = bound(w.form);
    if (b.status !== 'fixed') continue;
    const policy = b.ifRejected ?? 'withdraw';
    for (const node of ins.nodes) {
      const why = checkNode(l2, inst, batch, ins, node);
      if (why !== undefined) {
        out.push({ index: ins.index, why, policy });
        seen.add(ins.index);
        break;
      }
    }
  }
  return out;
}
