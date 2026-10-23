// Persistence (S2 section 12). Layer 2 persists through the kernel's `SeedRecord`: one record per instance,
// and one layer-2 global record. A live instance's record names its seed node, fact nodes and cast nodes as
// retention roots, and its seed node as a demand root; a terminal one keeps its history with no roots.
// Loading rebuilds every instance from its record, reinstalls the sowing contributions from the stored
// document, resets delivery states, fires the wake-ups already past, and re-evaluates every live instance.

import { canonicalKey } from '../canon.ts';
import type { Id } from '../types.ts';
import { Arbiter } from './arbiter.ts';
import { emptyGlobal } from './state.ts';
import { runMaintenance } from './effects.ts';
import * as ids from './ids.ts';
import type { Instance, Layer2 } from './layer2.ts';
import { isTerminal } from './layer2.ts';
import { installRequirement, layerOfInstance, originOf } from './world.ts';
import type { GlobalState, InstanceState } from './types.ts';

/** The nodes a live instance holds: its seed, its facts, and its cast. */
export function instanceNodes(l2: Layer2, inst: Instance): Id[] {
  const st = inst.st;
  const out = new Set<Id>([inst.id]);
  for (const k of Object.keys(st.facts)) out.add(ids.seedFactNode(inst.id, k));
  for (const rs of Object.values(st.roles)) if (rs.cast !== undefined) out.add(rs.cast);
  void l2;
  return [...out].sort();
}

/** Keep the kernel's seed table in step with an instance (S2 section 12.1). */
export function syncRecord(l2: Layer2, inst: Instance): void {
  const k = l2.k;
  const live = !isTerminal(inst.st.state);
  const nodes = live ? instanceNodes(l2, inst) : [];
  const cur = k.retention.seeds.get(inst.id);
  const sameNodes = cur && canonicalKey(cur.nodes) === canonicalKey(nodes) && (live ? cur.actor === inst.id : cur.actor === undefined) && cur.state === inst.st;
  if (sameNodes) return;
  const actor = live ? inst.id : undefined;
  if (cur?.actor !== undefined && actor === undefined) k.frames.demandRoots.delete(cur.actor);
  k.retention.setSeed({ id: inst.id, state: inst.st, nodes, ...(actor !== undefined ? { actor } : {}) });
}

/** The global record: the maintenance queue's references are retention roots (S2 section 8.6). */
export function syncGlobal(l2: Layer2): void {
  const nodes = new Set<Id>();
  for (const j of l2.global.maintenance) {
    if (j.kind === 'reset') nodes.add(j.node);
    else if (j.kind === 'closing') {
      const inst = l2.insts.get(j.seed);
      const d = inst?.st.deliveries.find((x) => x.id === j.delivery);
      for (const n of Object.values(d?.bindings ?? {})) nodes.add(n);
    }
  }
  for (const m of l2.global.marks) nodes.add(m.carrier.at);
  const sorted = [...nodes].sort();
  const id = ids.globalId(l2.worldSeed);
  const cur = l2.k.retention.seeds.get(id);
  if (cur && cur.state === l2.global && canonicalKey(cur.nodes) === canonicalKey(sorted)) return;
  l2.k.retention.setSeed({ id, state: l2.global, nodes: sorted });
}

export function flush(l2: Layer2): void {
  l2.global.playTotal = l2.baseTotal + l2.arbiter.play;
  for (const inst of l2.all()) syncRecord(l2, inst);
  syncGlobal(l2);
}

// ---- loading (S2 section 12.2) ----

export function onLoad(l2: Layer2): void {
  const k = l2.k;
  l2.syncSettingsSeen();
  l2.insts.clear();
  l2.queue.clear();
  l2.sowQueue.clear();
  l2.dilemmaQueue.length = 0;
  l2.clearActors();
  const gid = ids.globalId(l2.worldSeed);
  l2.global = emptyGlobal();
  let loaded = false;
  for (const rec of [...k.retention.seeds.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (rec.id === gid) {
      l2.global = { ...emptyGlobal(), ...(rec.state as GlobalState) };
      // The record's state becomes the live state, so a later save sees every change.
      Object.assign(rec.state as object, l2.global);
      l2.global = rec.state as GlobalState;
      loaded = true;
    } else if (rec.state && typeof rec.state === 'object' && 'document' in (rec.state as object)) {
      const inst: Instance = { id: rec.id, st: rec.state as InstanceState };
      l2.insts.set(inst.id, inst);
    }
  }
  void loaded;
  // The arbiter starts a new session: the play clock restarts, and the load settles (S2 section 8.2).
  const info = l2.port.loadInfo();
  l2.arbiter = new Arbiter();
  l2.playBase = info?.playClock ?? l2.playBase;
  l2.baseTotal = l2.global.playTotal;
  l2.arbiter.session = 'settling';
  l2.arbiter.saveAge = info?.ageSeconds ?? 0;
  // A save that loaded read-only (spec 14.4) is reconstructed for reading only: no root, watcher, contribution, withdrawal,
  // maintenance or lifecycle write is made, because the kernel refuses every write and the world does not move.
  if (k.readOnly) {
    for (const inst of l2.all()) if (!isTerminal(inst.st.state)) l2.registerActor(inst.id);
    return;
  }
  // Packs come back from the host: the pack roots, their watchers.
  for (const [pid] of l2.packs) {
    k.root(`pack:${pid}`, 'core:seed');
    l2.registerPackRoot(pid);
    l2.openWatcher(pid);
    l2.sowQueue.add(pid);
  }
  // A load of a damaged or foreign save, or a pack that is gone, gets one plain notice per branch (S2 section 12.2).
  if (info && (info.class === 'foreign' || info.class === 'damaged')) l2.notice(`load-${info.class}`);
  // Rebuild each live instance, in Id order.
  for (const inst of l2.all()) {
    const st = inst.st;
    if (isTerminal(st.state)) {
      for (const d of st.deliveries) resetDelivery(l2, inst, d);
      continue;
    }
    if (st.template.pack !== undefined && !l2.packs.has(st.template.pack)) {
      // A removed pack withdraws its live instances (S2 section 12.3): their content references can no longer resolve.
      l2.registerActor(inst.id);
      k.frames.demandRoots.add(inst.id);
      l2.withdraw(inst, `the pack "${st.template.pack}" is not installed`);
      l2.notice('pack-missing');
      continue;
    }
    l2.registerActor(inst.id);
    // The sowing contributions are rebuilt from the stored document (S2 section 12.1).
    reinstall(l2, inst);
    for (const d of st.deliveries) resetDelivery(l2, inst, d);
    // A pack installed before this load may withdraw the saved version (S2 section 12.3).
    if (l2.applyMigration(inst)) continue;
    // Fire the wake-ups already past, in time order, and re-evaluate in Id order.
    l2.queueReeval(inst, 'load', { time: k.now, reason: 'load' });
  }
  // Maintenance jobs already due run at once.
  l2.boundaryDue = k.now;
  runMaintenance(l2, k.now);
  l2.boundaryDue = undefined;
}

function reinstall(l2: Layer2, inst: Instance): void {
  const st = inst.st;
  const k = l2.k;
  for (const [rk, rs] of Object.entries(st.roles)) {
    if (rs.minted && rs.cast !== undefined) {
      for (const c of rs.minted.constraints) {
        const arg = c.arg as never;
        const form = c.op === 'eq' ? { f: 'const' as const, value: arg } : c.op === 'in'
          ? (Array.isArray(arg) && (arg as unknown[]).every((x) => typeof x === 'number')
            ? { f: 'set' as const, region: { r: 'ivl' as const, ivls: (arg as number[]).map((n): [number, number] => [n, n]) }, allow: true }
            : { f: 'set' as const, region: { r: 'set' as const, values: (Array.isArray(arg) ? arg : [arg]) as string[] }, allow: true })
          : { f: 'set' as const, region: { r: 'ivl' as const, ivls: [[(arg as number[])[0]!, (arg as number[])[1]!] as [number, number]] }, allow: true };
        // The stand-in's own header is a minted node nothing else regenerates; it is a root through the cast edge.
        if (!k.store.header(rs.cast)) k.store.addHeader({ id: rs.cast, kind: rs.minted.kind, origin: { by: 'minted', creator: inst.id, cause: inst.id, name: `role:${rk}` } });
        k.contribute({ source: { layer: layerOfInstance(inst), origin: originOf(inst) }, target: { slot: c.path, scope: { nodes: [rs.cast] } }, form, mode: 'constrain', valid: { from: rs.committedAt ?? k.now }, silent: true });
      }
    }
  }
  (st.document.world ?? []).forEach((_, i) => {
    const e = st.world[i];
    if (!e || !e.installed || e.ended) return;
    const ins = installRequirement(l2, inst, i, undefined, e.from, true);
    if (ins) e.contribution = ins.contribution;
  });
}

/** Delivery states after a load (S2 section 8.5): displayed unanswered offers stay answerable; released, undisplayed ones go back to queued. */
function resetDelivery(l2: Layer2, inst: Instance, d: InstanceState['deliveries'][number]): void {
  const rt = d.beat ? inst.st.beats[d.beat] : undefined;
  d.submitted = 0;
  // A game-clock duration does not restart at a load (S2 section 2.12); a save made later than the world now cannot wait negatively.
  d.submittedGame = Math.min(d.submittedGame, l2.k.now);
  delete d.retractUntil;
  if (d.state === 'released') {
    d.state = 'queued';
    delete d.releasedAt;
    if (rt && rt.state === 'running' && d.what !== 'warning') {
      rt.state = 'available';
      if (rt.releases > 0) rt.releases--;
    }
  } else if (d.state === 'displayed') {
    // The play-clock lapse restarts from the load (S2 section 2.12).
    const frag = d.fragment ? inst.st.closure.fragments.find((f) => f.id === d.fragment) : undefined;
    if (frag?.offer) d.lapseAt = frag.offer.lapse.after.s;
    d.displayedAt = 0;
  }
}
