// Effects (S2 section 2.5): a seed's writes. Seed facts are `committed` pins with one current pin each;
// game-fact writes and rewards go to the game port under a declared capability; kernel effects are committed
// canon events. Every effect fires on `yes` only (S2-I-8): the callers evaluate the condition first.

import { ceilingOf } from '../settings.ts';
import type { GameTime, Id } from '../types.ts';
import { readSeedFact } from './eval.ts';
import * as ids from './ids.ts';
import type { Instance, Layer2 } from './layer2.ts';
import type { CosmeticMark, EffectDecl, PersistClass } from './types.ts';

export interface EffectCtx {
  origin: 'action' | 'decline' | 'null' | 'beat' | 'fragment' | 'unattended' | 'reply';
  /** A unique, stable tag for the event ids of this application. */
  tag: string;
}

/** The default persistence class (S2 section 2.5): route variables are lasting, the incidental resettable. */
export function persistClassOf(inst: Instance, e: EffectDecl): PersistClass {
  if (e.persist) return e.persist;
  if ('fact' in e) return inst.st.document.facts?.[e.fact]?.route ? 'lasting' : 'resettable';
  return 'lasting';
}

/** Write one seed fact (S2 section 2.5): at most one current pin per fact, the old one withdrawn and kept as history. */
export function writeSeedFact(l2: Layer2, inst: Instance, key: string, value: number, cls: PersistClass): Id {
  const k = l2.k;
  const now = k.now;
  const node = ids.seedFactNode(inst.id, key);
  const cur = inst.st.facts[key] ?? { n: 0 };
  if (cur.pin !== undefined && !k.store.isWithdrawn(cur.pin)) k.withdrawPin(cur.pin, inst.id, now);
  const pinId = ids.seedFactPinId(inst.id, key, cur.n);
  k.pin({ id: pinId, node, slot: 'value', value, reason: 'committed', cause: inst.id, at: now });
  inst.st.facts[key] = { pin: pinId, n: cur.n + 1 };
  if (cls === 'resettable') {
    const reset = Math.max(0, Math.floor(l2.tun.reset * k.settings.at(now).resetScale));
    l2.global.maintenance.push({ kind: 'reset', at: now + reset, seed: inst.id, fact: key, pin: pinId, node });
  }
  l2.record(inst, 'beat', { effect: 'seed-fact', fact: key, value, class: cls });
  return pinId;
}

/**
 * Apply effects (S2 sections 2.5, 3.2). Returns the events minted. A game write without the capability, or
 * on a port that cannot do it, is skipped with a record entry: nothing is lost silently (S2-I-5).
 */
export function applyEffects(l2: Layer2, inst: Instance, effects: EffectDecl[] | undefined, ctx: EffectCtx): Id[] {
  const k = l2.k;
  const minted: Id[] = [];
  (effects ?? []).forEach((e, i) => {
    const cls = persistClassOf(inst, e);
    if ('fact' in e) {
      // A cosmetic effect is the canon event and its carrier, and no pin (S2 section 2.5): nothing reads it back.
      if (cls === 'cosmetic') l2.record(inst, 'beat', { effect: 'seed-fact', fact: e.fact, class: cls, pin: false });
      else {
        const cur = readSeedFact(l2, inst, e.fact);
        const value = e.set !== undefined ? e.set : cur + (e.add ?? 0);
        writeSeedFact(l2, inst, e.fact, value, cls);
      }
    } else if ('game' in e) {
      if (!l2.port.capabilities().has('story.write-vanilla')) {
        l2.record(inst, 'unfilled', { effect: 'game-write', skipped: e.game.fact, why: 'the game port does not offer story.write-vanilla' });
        return;
      }
      const req: { set?: number; add?: number } = {};
      if (e.game.set !== undefined) req.set = e.game.set;
      if (e.game.add !== undefined) req.add = e.game.add;
      l2.port.writeGameFact(e.game.fact, req);
      l2.record(inst, 'beat', { effect: 'game-write', fact: e.game.fact, ...req });
    } else if ('reward' in e) {
      const route = e.reward.byRoute !== undefined ? readSeedFact(l2, inst, e.reward.byRoute) : undefined;
      l2.port.reward(e.reward.table, e.reward.tier, route);
      l2.record(inst, 'beat', { effect: 'reward', table: e.reward.table, tier: e.reward.tier });
    } else if ('kernel' in e) {
      const target = inst.st.roles[e.kernel.on]?.cast;
      if (target === undefined) {
        l2.record(inst, 'unfilled', { effect: 'kernel', skipped: e.kernel.on, why: 'the role is not cast' });
        return;
      }
      const ev = k.events.mintEvent({
        creator: inst.id, cause: inst.id, name: `effect:${ctx.tag}:${i}`, time: k.now, kind: 'generic',
        participants: [{ who: inst.id, role: 'actor' }], effects: [{ on: target, effect: e.kernel.effect }],
      });
      k.events.makeCanon(ev, 'committed', inst.id);
      minted.push(ev);
    }
    if (cls === 'cosmetic' && e.carrier) markCosmetic(l2, inst, e, ctx, i);
  });
  l2.queueReeval(inst, 'effects');
  return minted;
}

function markCosmetic(l2: Layer2, inst: Instance, e: EffectDecl, ctx: EffectCtx, i: number): void {
  const k = l2.k;
  const carrier = e.carrier!;
  const at = /^[0-9a-f]{32}$/.test(carrier.at) ? carrier.at : inst.st.roles[carrier.at]?.cast;
  if (at === undefined) {
    l2.record(inst, 'unfilled', { effect: 'cosmetic', skipped: carrier.at, why: 'the carrier is not cast' });
    return;
  }
  const ev = k.events.mintEvent({
    creator: inst.id, cause: inst.id, name: `mark:${ctx.tag}:${i}`, time: k.now, kind: 'generic', participants: [{ who: inst.id, role: 'actor' }],
  });
  k.events.makeCanon(ev, 'committed', inst.id);
  const mark: CosmeticMark = { id: ev, seed: inst.id, event: ev, carrier: { kind: carrier.kind, at }, shownAt: k.now };
  if (carrier.durability !== 'permanent') {
    mark.until = k.now + carrier.durability.s;
    l2.global.maintenance.push({ kind: 'mark-expiry', at: mark.until, seed: inst.id, mark: ev });
  }
  l2.global.marks.push(mark);
}

/** The cosmetic marks shown at a carrier now (S2 section 2.5: re-derived after a load, until they expire). */
export function marksAt(l2: Layer2, carrier: Id, t: GameTime): CosmeticMark[] {
  return l2.global.marks.filter((m) => m.carrier.at === carrier && (m.until === undefined || t < m.until));
}

/** Run the maintenance queue's due jobs, in time order (S2 section 8.6). Returns the units used. */
export function runMaintenance(l2: Layer2, now: GameTime): number {
  const k = l2.k;
  // Closing deliveries live until they are shown or `closeExpiry` passes; then their job, and with it the references
  // it kept as retention roots, goes (S2 section 8.6).
  let retired = 0;
  for (const j of [...l2.global.maintenance]) {
    if (j.kind !== 'closing') continue;
    const inst = l2.insts.get(j.seed);
    const d = inst?.st.deliveries.find((x) => x.id === j.delivery);
    const outstanding = d !== undefined && (d.state === 'queued' || d.state === 'released');
    if (outstanding && j.until > now) continue;
    if (outstanding && inst) {
      d!.state = 'expired';
      l2.record(inst, 'expired', { delivery: d!.id, why: 'closeExpiry' });
    }
    l2.global.maintenance.splice(l2.global.maintenance.indexOf(j), 1);
    retired++;
  }
  const due = l2.global.maintenance.filter((j) => j.kind !== 'closing' && j.at <= now);
  if (due.length === 0) return retired;
  due.sort((a, b) => (a as { at: number }).at - (b as { at: number }).at || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || ((a as { seed: Id }).seed < (b as { seed: Id }).seed ? -1 : 1));
  for (const j of due) {
    if (j.kind === 'reset') {
      const inst = l2.insts.get(j.seed);
      const live = !k.store.isWithdrawn(j.pin) && k.store.pin(j.pin) !== undefined;
      if (live) k.withdrawPin(j.pin, j.seed, now);
      if (inst && inst.st.facts[j.fact]?.pin === j.pin) inst.st.facts[j.fact] = { n: inst.st.facts[j.fact]!.n };
      if (inst) {
        l2.record(inst, 'beat', { effect: 'reset', fact: j.fact });
        l2.queueReeval(inst, 'reset');
      }
    } else if (j.kind === 'mark-expiry') {
      l2.global.marks = l2.global.marks.filter((m) => m.id !== j.mark);
    }
    l2.global.maintenance.splice(l2.global.maintenance.indexOf(j), 1);
  }
  return due.length + retired;
}

void ceilingOf;
