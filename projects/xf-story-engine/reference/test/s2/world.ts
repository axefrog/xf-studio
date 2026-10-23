// The fixture world of S2's tests: the kernel's core schema plus a few kinds, a stub game port, the facts
// table, and helpers to drive facts, the play clock and saves. Every fixture uses `worldSeed = H("fixture", id)`,
// a fixture pack `xf.fixture`, the kernel's core schema plus S2 section 0.4, and the director off.

import { coreDefs, mergeDefs } from '../../src/core-schema.ts';
import { H, s as hs, mirroredId } from '../../src/id.ts';
import { Kernel } from '../../src/kernel.ts';
import type { GamePort } from '../../src/persistence.ts';
import type { SchemaDefs } from '../../src/schema-types.ts';
import type { Id, Value } from '../../src/types.ts';
import { Layer2, type Layer2Options } from '../../src/seeding/layer2.ts';
import { ScriptPort } from '../../src/seeding/port.ts';
import type { FactsTable } from '../../src/seeding/types.ts';
import { dim, fxSeed, kind, slot } from '../helpers.ts';

export const EVENT_KINDS = ['shared-activity', 'collector-visit', 'kill'];

export function s2Defs(): SchemaDefs {
  return {
    dims: [
      dim('fx:flag', { t: 'int', min: 0, max: 1 }),
      dim('fx:mood', { t: 'enum', values: ['quiet', 'busy'] }),
      dim('fx:place-name', { t: 'text' }),
    ],
    kinds: [
      kind('fx:character', [
        slot('alive', 'fx:flag', { mode: 'mirrored' }),
        slot('allied', 'fx:flag', { mode: 'mirrored' }),
        slot('in-city', 'fx:flag', { mode: 'mirrored' }),
        slot('where', 'core:place-ref', { mode: 'mirrored' }),
      ], { extends: ['core:person'] }),
      kind('fx:spot', [slot('mood', 'fx:mood')], { extends: ['core:place'] }),
    ],
    edgeTypes: [],
  };
}

/** The facts table: game facts layer 2 may read, and the guard of a decision fact. */
export const FACTS: FactsTable = {
  q112_done: {},
  q112_takemura_dead: { decidedBy: 'q112_done == 1' },
  q115_point_of_no_return: {},
  x: {},
  y: {},
  flag: {},
};

export interface World {
  k: Kernel;
  l2: Layer2;
  port: ScriptPort;
  v: Id;
  city: Id;
  japantown: Id;
  /** What the game currently holds, for a load's reconcile. */
  game: Map<string, { kind: string; slot: string; value: Value }>;
  gamePort: GamePort;
  gameNow: number;
}

export interface WorldOpts {
  l2?: Partial<Layer2Options>;
  config?: Partial<import('../../src/config.ts').Config>;
  now?: number;
}

export function makeWorld(name: string, opts: WorldOpts = {}): World {
  const defs = mergeDefs(coreDefs(600, { extraEventKinds: EVENT_KINDS }), s2Defs());
  const k = Kernel.create({ defs, worldSeed: fxSeed(name), ...(opts.config ? { config: opts.config } : {}), ...(opts.now !== undefined ? { now: opts.now } : {}) });
  const port = new ScriptPort();
  const l2 = new Layer2(k, { port, facts: FACTS, ...(opts.l2 ?? {}) });
  const v = k.root('v', 'core:person');
  const city = k.root('city', 'core:place');
  const japantown = k.root('japantown', 'core:place');
  k.addEdge({ type: 'core:located-in', from: japantown, to: city, cause: H(hs('fx'), hs('world')) });
  const game = new Map<string, { kind: string; slot: string; value: Value }>();
  const w: World = {
    k, l2, port, v, city, japantown, game, gameNow: 0,
    gamePort: {
      now: () => w.gameNow,
      readMirrored: () => [...game.entries()].map(([key, g]) => ({ gameKey: key.split('|')[0]!, kind: g.kind, slot: g.slot, value: g.value })),
    },
  };
  return w;
}

/** Move the world's clock forward to `t`, taking every boundary on the way. */
export function advance(w: World, t: number): void {
  if (t > w.k.now) w.k.settle({ to: t });
  w.gameNow = Math.max(w.gameNow, t);
}

/** A game reading of a fact (a mirrored node), at a time. The clock moves to the time first. */
export function setFact(w: World, name: string, value: number, t: number): void {
  const key = `fact:${name}`;
  advance(w, t);
  w.k.reading(w.l2.factNode(name), 'value', value, t);
  w.game.set(`${key}|value`, { kind: 'core:game-fact', slot: 'value', value });
  w.gameNow = Math.max(w.gameNow, t);
}

/** A game reading of a slot of a mirrored character. */
export function setGame(w: World, gameKey: string, kindId: string, slotKey: string, value: Value, t: number): Id {
  advance(w, t);
  const node = w.k.mirrored(gameKey, kindId);
  w.k.reading(node, slotKey, value, t);
  w.game.set(`${gameKey}|${slotKey}`, { kind: kindId, slot: slotKey, value });
  w.gameNow = Math.max(w.gameNow, t);
  return node;
}

/** The mirrored character Takemura, alive, allied and in the city. */
export function takemura(w: World, t = 0, opts: { alive?: number; allied?: number; adult?: boolean } = {}): Id {
  const node = setGame(w, 'takemura', 'fx:character', 'alive', opts.alive ?? 1, t);
  setGame(w, 'takemura', 'fx:character', 'allied', opts.allied ?? 1, t);
  setGame(w, 'takemura', 'fx:character', 'in-city', 1, t);
  setGame(w, 'takemura', 'fx:character', 'age-class', opts.adult === false ? 'minor' : 'adult', t);
  return node;
}

/** Places in Japantown: a quiet one and a busy one. */
export function spots(w: World): { quiet: Id; busy: Id } {
  const k = w.k;
  const cause = H(hs('fx'), hs('spots'));
  const quiet = k.root('spot-quiet', 'fx:spot');
  const busy = k.root('spot-busy', 'fx:spot');
  k.addEdge({ type: 'core:located-in', from: quiet, to: w.japantown, cause });
  k.addEdge({ type: 'core:located-in', from: busy, to: w.city, cause });
  k.pin({ node: quiet, slot: 'mood', value: 'quiet', reason: 'authored', cause });
  k.pin({ node: busy, slot: 'mood', value: 'busy', reason: 'authored', cause });
  return { quiet, busy };
}

/** Run the kernel and layer 2 to quiescence at the current time. */
export function settle(w: World): void {
  w.k.settle();
  w.k.dispatcher.drain();
}

/** Advance game time (the kernel's boundaries) and settle. */
export function tickTo(w: World, t: number): void {
  w.gameNow = Math.max(w.gameNow, t);
  w.k.settle({ to: t });
  w.k.dispatcher.drain();
}

export { mirroredId, fxSeed };
