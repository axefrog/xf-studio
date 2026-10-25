// `scene.acts` (S1 7.9): the fine tier. Where a root's focus has reached a cell, it opens the size-1 items of the completed windows
// into events with people, and publishes each completed item once as an event Change, so the coarse count becomes something the sifter
// can hear and a person can witness. It runs only where demand reached. It never catches up and never writes outside the focus; it adds
// information, never occurrences: opening an item changes no count and feeds no coarse process.
//
// Window `k - 1` is complete and published at boundary `k`, because every process runs one window at a time. Opening uses the demand
// recorded for the window the item occurred in, and keys named by the item (its Id, which holds its original window), never by the
// opening window.

import { H, mintedId } from '../id.ts';
import { itemTime } from '../summary.ts';
import type { ProcessOp } from '../evolution.ts';
import { processCause } from '../evolution.ts';
import type { Effect, Id } from '../types.ts';
import type { CastEntry, Descriptor } from './occ.ts';
import type { DigestBase } from './occ.ts';
import { PROCESS_VERSIONS, type S1Ctx, type S1Process, type S1Result } from './s1ctx.ts';
import type { Sim } from './sim.ts';
import type { EventsState } from './proc-events.ts';

export interface ActsState {
  v: 1;
  /** The focus recorded in the previous run: demand at the occurrence time. */
  prev: { w: number; cells: Id[] } | null;
  /** Items already published as events: the last 512, and no older than the ring. */
  published: Array<{ item: Id; w: number; cell: Id; summary: Id; index: number }>;
  /** By scene cell, the windows of opened items in the last hour. */
  recent: Record<Id, number[]>;
}

export interface ActsDigest extends DigestBase {
  opened: number;
  scenes: Id[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The descriptor of an item from its summary and the ring's meta (S1 7.9): a pure function of what the ring holds. */
export function itemDescriptor(sim: Sim, summary: Id, index: number, w: number, cell: Id, kind: string, meta: NonNullable<NonNullable<EventsState['ring'][number]['meta']>[number]>): Descriptor {
  const W = sim.data.time.W;
  const id = sim.k.summaries.itemId(summary, index);
  const d: Descriptor = {
    id, kind, size: 1, w, time: itemTime(summary, index, w * W, W), cell, gen: meta.gen, chain: meta.chain, public: false, witnesses: 0,
  };
  if (meta.parent !== undefined) d.parent = meta.parent;
  if (meta.sides) d.sides = meta.sides;
  if (meta.inherit) d.inherit = meta.inherit;
  sim.completeDescriptor(d);
  return d;
}

/** The operations that give an opened item its fields: its people, effects, witnesses and cause, as contributions (S1 7.9). */
export function itemFieldOps(sim: Sim, d: Descriptor, cast: CastEntry[], witnesses: Id[], silent: boolean): ProcessOp[] {
  const k = sim.k;
  const occ = sim.occurrenceOf(d, cast, processCause('scene.acts'), 'sim');
  const ops: ProcessOp[] = [{ op: 'materialise-item', item: d.id }];
  const put = (node: Id, slot: string, value: string | number): void => {
    ops.push({ op: 'contribute', target: { slot, scope: { nodes: [node] } }, form: { f: 'const', value }, mode: 'constrain', silent });
  };
  put(d.id, 'participants#count', occ.participants.length);
  occ.participants.forEach((p, i) => {
    const m = k.address(d.id, `participants[${i}]`);
    put(m, 'who', p.who);
    put(m, 'role', p.role);
  });
  put(d.id, 'effects#count', occ.effects.length);
  occ.effects.forEach((e, i) => {
    const m = k.address(d.id, `effects[${i}]`);
    put(m, 'on', e.on);
    put(m, 'effect', e.effect);
  });
  put(d.id, 'witnesses#count', witnesses.length);
  witnesses.forEach((wi, i) => put(d.id, `witnesses[${i}]`, wi));
  put(d.id, 'causes#count', d.parent !== undefined ? 1 : 0);
  if (d.parent !== undefined) put(d.id, 'causes[0]', d.parent);
  put(d.id, 'outcome', d.outcome ?? 'done');
  return ops;
}

export function actsProcess(sim: Sim): S1Process<ActsState, ActsDigest> {
  const procId = 'scene.acts';
  const cfg = sim.data.acts;
  const eventsProc = processCause('city.events');

  /** The residents of a node's block and the witnesses of an item: the first 12 present by the keyed priority, not the participants. */
  const witnessesOf = (d: Descriptor, participants: Id[]): Id[] => {
    const present = sim.people.presentAt(d.cell, d.time, sim.data.people.presentCap).filter((r) => !participants.includes(r));
    const keyed = present.map((r) => ({ r, u: sim.ids.present(d.cell, r) }));
    keyed.sort((a, b) => a.u - b.u || cmp(a.r, b.r));
    return keyed.slice(0, cfg.witnessCap).map((x) => x.r);
  };

  return {
    id: procId, version: PROCESS_VERSIONS[procId]!, tier: 3, coarseFine: { kind: 'count' }, lag: 1, demandLookback: 1,
    init: () => ({ v: 1, prev: null, published: [], recent: {} }),

    run(c: S1Ctx, k: number): S1Result<ActsState, ActsDigest> {
      const st = c.own<ActsState>();
      const ops: ProcessOp[] = [];
      const T = c.T;
      // (1) the focus now: the scene cells and the cells of the persons demand reaches
      const cells = new Set<Id>();
      for (const n of c.demanded(3)) if (sim.w.index.cells[n.node]) cells.add(n.node);
      for (const n of c.demanded(4)) {
        if (sim.people.view(n.node)) {
          const wh = sim.people.where(n.node, T);
          if (wh.cell !== undefined) cells.add(wh.cell);
        }
      }
      const focus = [...cells].sort(cmp);
      const view = sim.outcomeView(c.digest);
      let opened = 0;
      // (2) open the items of window k - 1 in the cells of the focus recorded in the previous run
      if (st.prev !== null && st.prev.w === k - 1) {
        for (const cell of st.prev.cells) {
          const items: Array<{ summary: Id; index: number; time: number; id: Id; kind: string; meta: NonNullable<NonNullable<EventsState['ring'][number]['meta']>[number]> }> = [];
          for (const kd of sim.data.kinds) {
            const S = mintedId(eventsProc, eventsProc, `sum/${k - 1}/${cell}/${kd.name}`);
            const entry = sim.ringEntry(S);
            if (!entry || !entry.meta || entry.count === undefined) continue;
            for (let j = 0; j < entry.count; j++) {
              const meta = entry.meta[j];
              if (!meta) continue;
              const time = itemTime(S, j, (k - 1) * sim.data.time.W, sim.data.time.W);
              items.push({ summary: S, index: j, time, id: sim.k.summaries.itemId(S, j), kind: kd.name, meta });
            }
          }
          items.sort((a, b) => a.time - b.time || cmp(a.id, b.id));
          for (const it of items) {
            if (st.published.some((p) => p.item === it.id)) continue;
            const recent = (st.recent[cell] ??= []).filter((x) => k - x < cfg.hourWindows);
            st.recent[cell] = recent;
            if (recent.length >= cfg.perHour) continue;
            const d = itemDescriptor(sim, it.summary, it.index, k - 1, cell, it.kind, it.meta);
            const cast = sim.casting.cast(d);
            if (cast === 'no-cast') {
              c.log({ w: k, proc: procId, kind: 'admission', reason: 'no-cast', refs: [it.id] });
              continue;
            }
            // v0.6 (S1 5.2a, 7.9): the item's outcome is drawn when it is opened, keyed by its Id, from the history as of its own time
            sim.drawOutcome(d, cast, view);
            if (!c.produce(sim.occurrenceOf(d, cast, c.proc, 'sim')).ok) continue;
            const persons = cast.filter((e) => e.who !== undefined).map((e) => e.who!);
            const witnesses = witnessesOf(d, persons);
            sim.k.summaries.materialise(it.summary, it.index);
            ops.push(...itemFieldOps(sim, d, cast, witnesses, false));
            ops.push({ op: 'publish-item', item: it.id });
            st.published.push({ item: it.id, w: k - 1, cell, summary: it.summary, index: it.index });
            recent.push(k);
            opened++;
          }
        }
      }
      // (3) regeneration is silent: the contributions of published items in the cells now in focus, when the kernel holds none. A pin on the
      // item (a canon descriptor) says nothing of its people: the test is for the scene's own contributions.
      for (const cell of focus) {
        for (const p of st.published) {
          if (p.cell !== cell || k - p.w >= sim.data.events.heatHorizon) continue;
          if (sim.k.store.namedContributions(p.item) > 0) continue;
          const entry = sim.ringEntry(p.summary);
          if (!entry?.meta?.[p.index]) continue;
          const d = itemDescriptor(sim, p.summary, p.index, p.w, cell, entry.kind, entry.meta[p.index]!);
          const cast = sim.casting.cast(d);
          if (cast === 'no-cast') continue;
          sim.drawOutcome(d, cast, view);
          const persons = cast.filter((e) => e.who !== undefined).map((e) => e.who!);
          sim.k.summaries.materialise(p.summary, p.index);
          ops.push(...itemFieldOps(sim, d, cast, witnessesOf(d, persons), true));
        }
      }
      // (4) record the focus of this window
      st.prev = { w: k, cells: focus };
      st.published = st.published.filter((p) => k - p.w < sim.data.events.heatHorizon).slice(-512);
      for (const cell of Object.keys(st.recent)) {
        st.recent[cell] = st.recent[cell]!.filter((x) => k - x < cfg.hourWindows);
        if (st.recent[cell]!.length === 0) delete st.recent[cell];
      }
      return { ops, state: st, digest: { v: 1, through: k, opened, scenes: focus } };
    },
  };
}

export type { Effect };
void H;
