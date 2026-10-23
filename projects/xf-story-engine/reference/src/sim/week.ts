// The template-written week (S1 14.3, 0.2): a week of the district's record written out by a fixed template, for readers who know the game
// (the panel P-C): a line for each event, each summary's count, each band, regime, price, norm-gap, group-gap and label change, in time
// order, with the cause chain of each event. The words are the template's; nothing here decides anything and nothing here is read back.
//
// `weekLines(sim, w)` writes window `w`, once its outputs have applied (that is, after the advance that took the world past boundary
// `w + 1`). It reads only the ring, the digests' feeds and the published list, so a recorder that is replaced by a reload writes the
// same lines as one that never was.

import type { GameTime, Id } from '../types.ts';
import type { ActsState } from './proc-acts.ts';
import type { EventsDigest, EventsState } from './proc-events.ts';
import type { GroupDigest } from './proc-groups.ts';
import type { LedgerDigest } from './ledger.ts';
import type { MirrorDigest } from './proc-mirror.ts';
import type { NormsDigest } from './proc-norms.ts';
import type { Transition } from './occ.ts';
import type { Sim } from './sim.ts';

export interface WeekLine {
  t: GameTime;
  /** The order inside one instant: events, then counts, then changes. */
  rank: number;
  text: string;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** `Fri 12:40` for a game time. */
export function clockOf(sim: Sim, t: GameTime): string {
  const sod = sim.people.secondOfDay(t);
  const hh = String(Math.floor(sod / 3600)).padStart(2, '0');
  const mm = String(Math.floor((sod % 3600) / 60)).padStart(2, '0');
  return `${DAYS[sim.people.weekday(t)]} ${hh}:${mm}`;
}

function namer(sim: Sim): (id: Id | undefined) => string {
  const names = new Map<Id, string>();
  for (const [name, id] of Object.entries(sim.w.index.names ?? {})) {
    const have = names.get(id);
    if (have === undefined || name < have) names.set(id, name);
  }
  // the carriers are named by their own names and the groups by the affiliation they stand for (a group is also a carrier: its own name wins)
  for (const d of sim.w.districts) {
    for (const c of sim.data.ledger.carriers) names.set(sim.ledger.carrierNode(c.id, d.id), c.id === 'kabuki' ? 'the district' : c.id === 'stalls' ? 'the stallholders' : `the ${c.id}`);
    (['A1', 'A2', 'A3'] as const).forEach((slot, i) => {
      const aff = d.affOrder[2 + i];
      if (aff !== undefined && aff !== '_none') names.set(sim.w.group(d.id, slot), aff);
    });
  }
  return (id) => {
    if (id === undefined) return 'the city';
    if (id === sim.w.v) return 'V';
    const named = names.get(id) ?? sim.w.index.districts[id]?.key;
    if (named !== undefined) return named;
    // a resident is called by the name the world gives them
    if (sim.people.view(id)) {
      const display = sim.k.value(sim.k.address(id, 'name'), 'display');
      if (typeof display === 'string') return display;
    }
    return `#${id.slice(0, 6)}`;
  };
}

const ROLE_WORDS: Record<string, string> = { aggressor: 'by', victim: 'against', target: 'against', hostile: 'between', responder: 'answered by', enforcer: 'by', actor: 'by', giver: 'from', taker: 'to', participant: 'among' };

/** The lines of window `w`, in time order. */
export function weekLines(sim: Sim, w: number): WeekLine[] {
  const name = namer(sim);
  const out: WeekLine[] = [];
  const st = sim.k.evolution.states.get('city.events')?.state as EventsState | null | undefined;
  const kindOf = (id: Id): string => sim.ringEntry(id)?.kind ?? String(sim.k.value(id, 'kind') ?? 'an incident');
  const chainOf = (id: Id): string => {
    const why = sim.why(id);
    if (!why || why.length <= 1) return 'with no cause in the record';
    return `because of ${why.slice(1).map((l) => (l.beyondRing ? 'an earlier incident' : `a ${l.kind ?? 'incident'}`)).join(', before that ')}`;
  };

  // the events and the summaries of the window, from the ring
  for (const e of st?.ring ?? []) {
    if (e.w !== w) continue;
    if (e.event) {
      const ev = sim.policies.viewEvent(e.id);
      const who = (ev?.participants ?? []).map((p) => `${ROLE_WORDS[p.role] ?? p.role} ${name(p.who)}`);
      out.push({ t: e.event.time, rank: 0, text: `${clockOf(sim, e.event.time)}  ${e.kind} (size ${e.event.size}) at ${name(e.cell)}${who.length > 0 ? ` ${who.join(' ')}` : ''}, ${chainOf(e.id)}.` });
    } else if (e.count !== undefined) {
      out.push({ t: e.w * sim.data.time.W, rank: 1, text: `${clockOf(sim, e.w * sim.data.time.W)}  ${e.count} ${e.kind} incident${e.count === 1 ? '' : 's'} at ${name(e.cell)} in this ten minutes.` });
    }
  }

  // what the game did, as the mirror re-described it
  const mirror = sim.k.evolution.digestPeek<MirrorDigest>('city.mirror');
  for (const win of mirror?.facts.windows ?? []) {
    if (win.w !== w) continue;
    for (const f of win.items) {
      const cause = sim.policies.viewEvent(f.id)?.causes[0];
      const raw = cause === undefined ? 'the game' : String(sim.k.value(cause, 'kind') ?? 'the game');
      out.push({ t: f.time, rank: 0, text: `${clockOf(sim, f.time)}  ${f.kind} (size ${f.size}) at ${name(f.cell)}, from the game's ${raw}.` });
    }
  }
  const norms = sim.k.evolution.digestPeek<NormsDigest>('order.norms');
  for (const win of norms?.facts.windows ?? []) {
    if (win.w !== w) continue;
    for (const f of win.items) out.push({ t: f.time, rank: 0, text: `${clockOf(sim, f.time)}  ${f.kind} (${f.public ? 'in public' : 'in private'}) at ${name(f.cell)}.` });
  }

  // what the game reported of the order of the street, which the mirror does not re-describe
  const T0 = w * sim.data.time.W;
  for (const id of sim.k.store.idsOfKind('core:event')) {
    const h = sim.k.store.header(id);
    if (h?.origin.by !== 'minted' || h.origin.creator !== sim.w.port) continue;
    const kind = sim.k.value(id, 'kind');
    const time = sim.k.value(id, 'time');
    if (typeof kind !== 'string' || !kind.startsWith('enf.') || typeof time !== 'number' || time < T0 || time >= T0 + sim.data.time.W) continue;
    const place = sim.k.value(id, 'place');
    const wc = sim.k.value(id, 'witnesses#count');
    out.push({ t: time, rank: 0, text: `${clockOf(sim, time)}  the game reported ${kind} at ${name(typeof place === 'string' ? place : undefined)} with ${typeof wc === 'number' ? wc : 0} watching.` });
  }

  // opened items
  const acts = sim.k.evolution.states.get('scene.acts')?.state as ActsState | null | undefined;
  for (const p of acts?.published ?? []) {
    if (p.w !== w) continue;
    const ev = sim.policies.viewEvent(p.item);
    const t = ev?.time ?? w * sim.data.time.W;
    const who = (ev?.participants ?? []).map((x) => `${ROLE_WORDS[x.role] ?? x.role} ${name(x.who)}`);
    out.push({ t, rank: 0, text: `${clockOf(sim, t)}  seen up close: ${ev?.kind ?? 'an incident'} at ${name(p.cell)}${who.length > 0 ? ` ${who.join(' ')}` : ''}.` });
  }

  // the changes the processes published
  const changes = (key: string, tr: Transition): string | undefined => {
    const [what, ...rest] = key.split('|');
    const subject = (x: string | undefined): string => name(x as Id);
    switch (what) {
      case 'band': return `the heat of ${subject(rest[0])} went from ${tr.prev ?? 'unknown'} to ${tr.value}.`;
      case 'status': return `a service in the area went from ${tr.prev ?? 'unknown'} to ${tr.value}.`;
      case 'regime': return `the district's regime went from ${tr.prev ?? 'none'} to ${tr.value}.`;
      case 'price': return `prices in ${subject(rest[0])} went from ${tr.prev ?? 'unknown'} to ${tr.value}.`;
      case 'refuge': return `lying low in ${subject(rest[0])} went from ${tr.prev ?? 'unknown'} to ${tr.value}.`;
      case 'gap': return `the gap between what people think and what they do about the ${rest[0]} norm in ${subject(rest[1])} went from ${tr.prev ?? 'unknown'} to ${tr.value}.`;
      case 'group-gap': return `the gap between what ${subject(rest[0])} says and does went from ${tr.prev ?? 'unknown'} to ${tr.value}.`;
      case 'label': return `what ${subject(rest[0])} makes of V as ${rest[1]} went from ${tr.prev ?? 'unknown'} to ${tr.value}.`;
      default: return undefined;
    }
  };
  const feeds: Array<{ windows: Array<{ w: number; items: Transition[] }> } | undefined> = [
    sim.k.evolution.digestPeek<EventsDigest>('city.events')?.changes, norms?.changes, sim.k.evolution.digestPeek<GroupDigest>('group.decide')?.changes, sim.k.evolution.digestPeek<LedgerDigest>('order.ledger')?.changes,
  ];
  for (const feed of feeds) {
    for (const win of feed?.windows ?? []) {
      if (win.w !== w) continue;
      for (const tr of win.items) {
        const text = changes(tr.key, tr);
        if (text) out.push({ t: tr.t, rank: 2, text: `${clockOf(sim, tr.t)}  ${text}` });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t || a.rank - b.rank || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
}

/** The lines of a stretch of windows, in the order written: each window's lines in time order, the windows in order. */
export function weekText(sim: Sim, from: number, to: number): string[] {
  const out: string[] = [];
  for (let w = from; w <= to; w++) out.push(...weekLines(sim, w).map((l) => l.text));
  return out;
}
