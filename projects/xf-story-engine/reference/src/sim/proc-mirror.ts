// `city.mirror` (S1 7.3): maps the game's raw events to the city's vocabulary, so that the record of what the game did is in the
// language the sifter reads, and sets nothing it cannot read from the game. Raw events are records of what the game did, kept as
// they are, never filtered or edited; a derived event re-describes one. It is not a new occurrence, so the production gate does not
// refuse it, it bypasses admission and consumes no budget, and it takes the time of the raw event it re-describes.

import { processCause } from '../evolution.ts';
import type { ProcessOp } from '../evolution.ts';
import { mintedId } from '../id.ts';
import type { Effect, GameTime, Id } from '../types.ts';
import { type DigestBase, type EventFact, type Feed, pushFeed } from './occ.ts';
import { RAW_KIND_NAMES } from './kinds.ts';
import { PROCESS_VERSIONS, type S1Ctx, type S1Process, type S1Result } from './s1ctx.ts';
import type { Sim } from './sim.ts';

export interface MirrorState {
  v: 1;
  /** Raw event Ids processed, newest last, at most 1024. */
  seen: Id[];
  /** By district. */
  counters: Record<Id, { gig: number; hustle: number; failed: number }>;
  /** The last heat stage mirrored (0 to 5). */
  lastHeat: number;
  next: number;
  /** What the game covers now; entries older than `coverLull` windows are removed. */
  cover: Array<{ kind: string; cell?: Id; district: Id; since: number }>;
}

export interface MirrorDigest extends DigestBase {
  cover: MirrorState['cover'];
  /** The derived events, as minted; creator `mirror`. */
  facts: Feed<EventFact>;
  counters: MirrorState['counters'];
}

const COVERED_KINDS = ['gang-clash', 'assault', 'theft', 'police-action'];
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function mirrorProcess(sim: Sim): S1Process<MirrorState, MirrorDigest> {
  const procId = 'city.mirror';
  const proc = processCause(procId);
  const cfg = sim.data.mirror;
  const W = sim.data.time.W;
  const rawKinds = [...RAW_KIND_NAMES] as string[];

  /** The class of an affiliation name from the index: `gang`, `corp`, `ncpd` or `civilian`. */
  const classOfAff = (aff: string | undefined): 'gang' | 'corp' | 'ncpd' | 'civilian' => {
    if (aff === undefined || aff === 'civilian') return 'civilian';
    if (aff === 'ncpd') return 'ncpd';
    for (const id of Object.keys(sim.w.index.districts).sort()) for (const b of sim.w.index.districts[id]!.entry.byAff) if (b.aff === aff) return b.cls;
    return 'civilian';
  };

  return {
    id: procId, version: PROCESS_VERSIONS[procId]!, tier: 1, coarseFine: { kind: 'exact' }, lag: 1,
    init: () => ({ v: 1, seen: [], counters: {}, lastHeat: 0, next: 0, cover: [] }),

    run(c: S1Ctx, w: number): S1Result<MirrorState, MirrorDigest> {
      const st = c.own<MirrorState>();
      const T = c.T;
      const k = sim.k;
      const val = (node: Id, path: string, at: GameTime = T): unknown => c.pctx.value(node, path, at);
      const ops: ProcessOp[] = [];
      const facts: EventFact[] = [];
      const first = sim.windowStart(Math.max(0, w - 6));

      // find the raw events: by query, within the last six windows, not yet seen, in (time, Id) order
      const q = c.pctx.query({
        find: 'core:event', scope: { under: sim.w.city }, at: T, limit: 'all',
        must: [{ path: 'kind', op: 'in', arg: rawKinds }, { path: 'time', op: 'range', arg: [first, T - 1] }],
      });
      const seen = new Set(st.seen);
      const raws = (q.status === 'ok' ? q.items : [])
        .map((it) => ({ id: it.id, time: val(it.id, 'time') as number, kind: val(it.id, 'kind') as string }))
        .filter((r) => !seen.has(r.id) && typeof r.time === 'number')
        .sort((a, b) => a.time - b.time || cmp(a.id, b.id));

      const vDistrict = (t: GameTime): Id => {
        const d = val(sim.w.vState, 'district', t);
        return typeof d === 'string' && sim.w.index.districts[d] ? d : sim.w.districts[0]!.id;
      };
      const placeOf = (raw: Id): { place: Id; district: Id; cell?: Id; pub: boolean } => {
        const p = val(raw, 'place') as Id | undefined;
        const t = val(raw, 'time') as number;
        const cell = p !== undefined ? sim.w.index.cells[p] : undefined;
        if (cell) return { place: p!, district: cell.district, cell: p!, pub: cell.public === 'public' };
        if (p !== undefined && sim.w.index.districts[p]) return { place: p, district: p, pub: false };
        const d = vDistrict(t);
        return { place: d, district: d, pub: false };
      };
      const participants = (raw: Id): Array<{ who: Id; role: string }> => {
        const n = val(raw, 'participants#count');
        const out: Array<{ who: Id; role: string }> = [];
        for (let i = 0; i < (typeof n === 'number' ? n : 0); i++) {
          const m = k.address(raw, `participants[${i}]`);
          out.push({ who: val(m, 'who') as Id, role: val(m, 'role') as string });
        }
        return out;
      };
      const witnessesOf = (raw: Id): Id[] => {
        const n = val(raw, 'witnesses#count');
        const out: Id[] = [];
        for (let i = 0; i < (typeof n === 'number' ? n : 0); i++) out.push(val(raw, `witnesses[${i}]`) as Id);
        return out;
      };
      const affOf = (who: Id, at: GameTime): string | undefined => {
        if (who === sim.w.v) return 'civilian';
        const a = val(who, 'affiliation', at);
        return typeof a === 'string' ? a : undefined;
      };

      let derivedCount = 0;
      const lateBefore = sim.windowStart(Math.max(0, w - 1));
      for (const raw of raws) {
        seen.add(raw.id);
        st.seen.push(raw.id);
        if (raw.time < lateBefore) c.log({ w, proc: procId, kind: 'defect', reason: 'late-raw', refs: [raw.id] });
        const where = placeOf(raw.id);
        const parts = participants(raw.id);
        const wit = witnessesOf(raw.id);
        const dist = sim.w.district(where.district);
        let kind: string | undefined;
        let size = 1;
        let sides: { a?: number; b?: number } | undefined;
        let dParts: Array<{ who: Id; role: string }> = [];
        let dEffects: Array<{ on: Id; effect: Effect }> = [];
        let outcome: 'done' | 'failed' = 'done';
        let placeId = where.cell ?? where.district;
        switch (raw.kind) {
          case 'game.death': {
            const victim = parts.find((p) => p.role === 'victim');
            const actor = parts.find((p) => p.role === 'actor');
            if (!victim) break;
            const va = affOf(victim.who, raw.time);
            const aa = actor ? affOf(actor.who, raw.time) : undefined;
            kind = classOfAff(va) === 'gang' && actor !== undefined && classOfAff(aa) === 'gang' && va !== aa ? 'gang-clash' : 'assault';
            const group = va !== undefined && (va === dist.affOrder[2] || va === dist.affOrder[3]);
            size = group || wit.length >= cfg.deathGroupWitnesses ? 2 : 1;
            dParts = [{ who: victim.who, role: 'victim' }, ...(actor ? [{ who: actor.who, role: 'aggressor' }] : [])];
            dEffects = [{ on: victim.who, effect: 'kill' }];
            sides = { b: sim.casting.classIndexOf(dist, va ?? 'civilian') };
            if (actor) sides.a = sim.casting.classIndexOf(dist, aa ?? 'civilian');
            break;
          }
          case 'game.combat.start': {
            const hostile = parts.filter((p) => p.role === 'hostile');
            const classes = hostile.map((h) => classOfAff(affOf(h.who, raw.time)));
            kind = classes.includes('gang') ? 'gang-clash' : classes.includes('ncpd') ? 'police-action' : 'assault';
            size = hostile.length >= 3 ? 2 : 1;
            dParts = hostile.map((h) => ({ who: h.who, role: 'hostile' }));
            break;
          }
          case 'game.journal.finished':
          case 'game.journal.failed': {
            const entry = parts.find((p) => p.role === 'entry');
            if (!entry) break;
            kind = 'gig-outcome';
            outcome = raw.kind === 'game.journal.failed' ? 'failed' : 'done';
            dParts = [{ who: entry.who, role: 'entry' }];
            const fam = val(entry.who, 'family', raw.time);
            const jd = val(entry.who, 'district', raw.time);
            const dd = typeof jd === 'string' && sim.w.index.districts[jd] ? jd : where.district;
            const cnt = (st.counters[dd] ??= { gig: 0, hustle: 0, failed: 0 });
            if (fam === 'gig') cnt.gig++;
            else if (fam === 'hustle') cnt.hustle++;
            if (outcome === 'failed') cnt.failed++;
            break;
          }
          default: {
            const m = /^game\.heat\.(\d)$/.exec(raw.kind);
            if (m) {
              const n = Number(m[1]);
              if (n >= 1 && n > st.lastHeat) {
                kind = 'police-action';
                size = n >= 3 ? 2 : 1;
                placeId = vDistrict(raw.time);
              }
              st.lastHeat = n;
            }
          }
        }
        if (kind === undefined) continue;
        if (derivedCount >= cfg.cap) {
          c.log({ w, proc: procId, kind: 'defect', reason: 'cap-hit', refs: [raw.id] });
          continue;
        }
        derivedCount++;
        const id = mintedId(proc, raw.id, 'mir');
        ops.push({
          op: 'mint-event',
          spec: { creator: proc, cause: raw.id, name: 'mir', time: raw.time, kind, place: placeId, participants: dParts, effects: dEffects, witnesses: wit, causes: [raw.id], outcome },
        });
        const district = sim.w.index.cells[placeId] ? sim.w.cell(placeId).district : placeId;
        const f: EventFact = {
          id, kind, size, w, time: raw.time, cell: placeId, district, public: where.pub && wit.length >= cfg.publicMinWitnesses, witnesses: wit.length,
          policeChild: false, creator: 'mirror', outcome: outcome === 'failed' ? 'failed' : 'done', parties: sim.partiesOf(dParts, raw.time),
        };
        if (sides) f.sides = sides;
        facts.push(f);
        if (where.cell !== undefined && COVERED_KINDS.includes(kind)) st.cover.push({ kind, cell: where.cell, district: where.district, since: w });
      }
      if (st.seen.length > cfg.seenMax) st.seen = st.seen.slice(st.seen.length - cfg.seenMax);
      st.cover = st.cover.filter((e) => w - e.since <= sim.data.events.coverLull);
      st.next += facts.length;
      void W;
      const prev = c.digest<MirrorDigest>(procId);
      const digest: MirrorDigest = { v: 1, through: w, cover: st.cover.map((e) => ({ ...e })), facts: pushFeed(prev?.facts, w, facts, sim.data.feed.keep), counters: structuredClone(st.counters) };
      return { ops, state: st, digest };
    },
  };
}
