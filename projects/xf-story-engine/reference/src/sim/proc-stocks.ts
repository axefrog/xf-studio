// `order.stocks` (S1 7.6): per district, how much people trust that something will be done (efficacy `E`), how little they trust the
// police (cynicism `Y`) and the police's standing (legitimacy `L`), and from them the chance that an incident is reported. Each stock
// returns to its baseline, so a district with no events stays where it started; the facts that move it are consumed once, from the
// feeds of `city.events` and `order.norms`, after a cursor.

import type { Id } from '../types.ts';
import { clip01 } from './arith.ts';
import type { EventsDigest } from './proc-events.ts';
import type { NormsDigest } from './proc-norms.ts';
import { type DigestBase, type EventFact, feedAfter } from './occ.ts';
import { PROCESS_VERSIONS, type S1Process } from './s1ctx.ts';
import type { Sim } from './sim.ts';
import { simulatedDistricts } from './index-types.ts';

export interface StocksState {
  v: 1;
  districts: Record<Id, { E: number; Y: number; L: number }>;
  cursors: { events: number; norms: number };
}

export interface StocksDigest extends DigestBase {
  districts: Record<Id, { E: number; Y: number; L: number; fear: number }>;
}

/** The fear of a district: `fearBase x` its gang-class entry share, constant (S1 7.6). */
export function fearOf(sim: Sim, district: Id): number {
  const d = sim.w.district(district);
  let gang = 0;
  for (const b of d.entry.byAff) if (b.cls === 'gang') gang += b.q;
  return sim.data.stocks.fearBase * (gang / d.entry.total);
}

/** The rows of `data.stocks.effects` that a fact earns (S1 7.6): they use only fields of `EventFact`. */
export function stockRows(sim: Sim, f: EventFact): Array<{ dE: number; dY: number; dL: number }> {
  const e = sim.data.stocks.effects;
  const rows: Array<{ dE: number; dY: number; dL: number }> = [];
  if (f.creator === 'norms' && f.public) rows.push(e.publicEnforcement);
  if (f.kind === 'police-action' && f.size >= 2 && (f.parentSize ?? 0) >= 2) rows.push(e.policeAnswered);
  if ((f.kind === 'theft' || f.kind === 'assault' || f.kind === 'gang-clash') && f.public && f.size >= 2 && !f.policeChild) rows.push(e.unanswered);
  if (f.kind === 'shakedown' && f.size >= 2) rows.push(e.shakedown);
  return rows;
}

export function stocksProcess(sim: Sim): S1Process<StocksState, StocksDigest> {
  const cfg = sim.data.stocks;
  return {
    id: 'order.stocks', version: PROCESS_VERSIONS['order.stocks']!, tier: 0, coarseFine: { kind: 'exact' }, lag: 0,
    init: () => {
      const districts: StocksState['districts'] = {};
      for (const d of simulatedDistricts(sim.w.index)) districts[d.id] = { E: d.trust.E0, Y: d.trust.Y0, L: d.trust.L0 };
      return { v: 1, districts, cursors: { events: -1, norms: -1 } };
    },
    run(c, w) {
      const st = c.own<StocksState>();
      const ev = c.digest<EventsDigest>('city.events');
      const nm = c.digest<NormsDigest>('order.norms');
      const fe = feedAfter(ev?.facts, st.cursors.events);
      const fn = feedAfter(nm?.facts, st.cursors.norms);
      if (fe.gap) c.log({ w, proc: 'order.stocks', kind: 'defect', reason: 'feed-gap', key: 'city.events', refs: [] });
      if (fn.gap) c.log({ w, proc: 'order.stocks', kind: 'defect', reason: 'feed-gap', key: 'order.norms', refs: [] });
      st.cursors.events = fe.through;
      st.cursors.norms = fn.through;
      const facts = [...fe.items, ...fn.items];
      const out: StocksDigest['districts'] = {};
      for (const d of simulatedDistricts(sim.w.index)) {
        const s = st.districts[d.id] ?? (st.districts[d.id] = { E: d.trust.E0, Y: d.trust.Y0, L: d.trust.L0 });
        let dE = 0;
        let dY = 0;
        let dL = 0;
        for (const f of facts) {
          if (f.district !== d.id) continue;
          for (const r of stockRows(sim, f)) {
            dE = dE + r.dE;
            dY = dY + r.dY;
            dL = dL + r.dL;
          }
        }
        s.E = clip01(cfg.rhoE * s.E + (1 - cfg.rhoE) * d.trust.E0 + dE);
        s.Y = clip01(cfg.rhoY * s.Y + (1 - cfg.rhoY) * d.trust.Y0 + dY);
        s.L = clip01(cfg.rhoL * s.L + (1 - cfg.rhoL) * d.trust.L0 + dL);
        out[d.id] = { E: s.E, Y: s.Y, L: s.L, fear: fearOf(sim, d.id) };
      }
      return { ops: [], state: st, digest: { v: 1, through: w, districts: out } };
    },
  };
}
