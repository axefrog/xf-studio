// The offline replay port (S1 3.4): feeds the model what the game's feed would. It is the first client of the mirror, and the only
// one in M3 (D-18). A replay script is a list of timestamped lines; the port turns each into an external operation stamped with that
// time, which the kernel applies at the boundary after the window it falls in (S0 9.4).
//
// Node names in a script are game keys; the port resolves them to `H("game", key)`. The key `v` is V (the root, for participants)
// and V's mirrored state (for readings); a place is named by the slice's names (a cell, a district key) or `city`.

import { H, id as hid, mirroredId, s as hs } from '../id.ts';
import type { Effect, Id, Value } from '../types.ts';
import type { Sim } from './sim.ts';

export type ReplayLine =
  | { t: number; op: 'reading'; node: string; slot: string; value: Value }
  | { t: number; op: 'fact'; name: string; value: number }
  | {
      t: number; op: 'event'; kind: string; place?: string; participants: Array<{ who: string; role: string }>;
      effects?: Array<{ on: string; effect: Effect }>; witnesses?: number;
    }
  | { t: number; op: 'person'; key: string; slots: Record<string, Value> };

const PLACE_SLOTS = new Set(['district', 'cell']);

export class ReplayPort {
  private rawCount = new Map<number, number>();

  constructor(private readonly sim: Sim) {}

  private get k() {
    return this.sim.k;
  }

  /** The Id a place name stands for: a cell or district by the slice's names, the city, or an Id already. */
  place(name: string): Id {
    if (name === 'city') return this.sim.w.city;
    const hit = this.sim.w.index.names?.[name];
    if (hit) return hit;
    if (/^[0-9a-f]{32}$/.test(name)) return name;
    throw new Error(`the replay script names an unknown place: ${name}`);
  }

  /** The Id of a game key; `v` is V. */
  node(key: string, kind = 'xf:person'): Id {
    if (key === 'v') return this.k.vId;
    if (key.startsWith('journal:')) return this.k.mirrored(key, 'xf:journal');
    if (key.startsWith('fact:')) return this.k.mirrored(key, 'core:game-fact');
    return this.k.mirrored(key, kind);
  }

  /** The node whose slots a reading of `key` sets: V's readings are on its mirrored state. */
  private readingNode(key: string): Id {
    return key === 'v' ? this.sim.w.vState : this.node(key);
  }

  submit(lines: readonly ReplayLine[]): void {
    for (const line of lines) this.submitOne(line);
  }

  private send(stamp: number, op: Parameters<Sim['k']['submit']>[0]['op']): void {
    const r = this.k.submit({ epoch: this.k.epoch, stamp, op });
    if (!r.accepted) throw new Error(r.reason);
  }

  private reading(t: number, node: Id, slot: string, value: Value): void {
    this.send(t, { op: 'reading', node, slot, value });
  }

  private submitOne(line: ReplayLine): void {
    switch (line.op) {
      case 'reading': {
        const value = PLACE_SLOTS.has(line.slot) && typeof line.value === 'string' && line.node === 'v' ? this.place(line.value) : line.value;
        this.reading(line.t, this.readingNode(line.node), line.slot, value);
        return;
      }
      case 'fact': {
        const node = this.k.mirrored(`fact:${line.name}`, 'core:game-fact');
        this.reading(line.t, node, 'value', line.value);
        return;
      }
      case 'person': {
        const node = this.node(line.key);
        for (const slot of Object.keys(line.slots).sort()) this.reading(line.t, node, slot, line.slots[slot]!);
        return;
      }
      case 'event': {
        const n = this.rawCount.get(line.t) ?? 0;
        this.rawCount.set(line.t, n + 1);
        const name = `raw/${line.t}/${n}`;
        const port = this.sim.w.port;
        const spec: Parameters<Sim['k']['events']['mintEvent']>[0] = {
          creator: port, cause: port, name, time: line.t, kind: line.kind, place: line.place === undefined ? this.sim.w.city : this.place(line.place),
          participants: line.participants.map((p) => ({ who: this.node(p.who), role: p.role })),
          effects: (line.effects ?? []).map((e) => ({ on: this.node(e.on), effect: e.effect })),
          witnesses: Array.from({ length: line.witnesses ?? 0 }, (_, i) => H(hs('witness'), hs(name), hid(port), hs(String(i)))),
        };
        this.send(line.t, { op: 'event', spec });
        return;
      }
    }
  }
}

export { mirroredId };
