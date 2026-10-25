// The production gate (S1 6): everything S1 produces, as new occurrences, passes one stateless choke point before it is published.
// Gates sit at choke points, not on each feature. The gate holds no budget and no counter: budgets belong to the admission owner
// (`city.events`), which calls the gate. It refuses plainly, with a reason; a refusal is never silent.

import type { GameTime, Id } from '../types.ts';
import { ceilingOf } from '../settings.ts';
import type { SettingsEntry } from '../settings.ts';
import type { GateResult, Occurrence } from './occ.ts';
import type { People } from './people.ts';
import type { World } from './world.ts';

/** What the protagonist-object clauses of the gate read (S1 6): the intentions of the snapshot's `group.decide` digest, the beliefs a grievance rests on and the `observed` pins. */
export interface GateEnv {
  /** The group's active intention against V as the snapshot's digest holds it: `against` (S1 7.8.1) with its warnings. */
  intent(group: Id): { id: Id; rung: 1 | 2 | 3; grounds: Id; warnings: Id[] } | undefined;
  /** Whether the group still holds the belief (a grievance). */
  held(group: Id, belief: Id): boolean;
  observedAt(node: Id, t: GameTime): GameTime | undefined;
}

/** The protagonist-object roles (S1 6, v0.6) and the kind and rungs each belongs to. */
const OBJECT_ROLES: Record<string, { kinds: Record<string, Array<1 | 2 | 3>> }> = {
  warned: { kinds: { warning: [1], price: [2] } },
  sought: { kinds: { search: [2, 3] } },
  confronted: { kinds: { confront: [3] } },
};
const MAX_RUNG = { calm: 1, steady: 2, restless: 3, off: 0 } as const;

export class Gate {
  /** Persons marked real: never bound in a floor role. */
  readonly real = new Set<Id>();

  constructor(private readonly w: World, private readonly people: People) {}

  /** The conditions under which an occurrence may name V as `warned`, `sought` or `confronted` (S1 6 step 3). */
  private punishAllowed(o: Occurrence, role: string, settings: SettingsEntry, now: GameTime, env: GateEnv | undefined): boolean {
    const pu = o.punish;
    if (pu === undefined || env === undefined) return false;
    const rungs = OBJECT_ROLES[role]!.kinds[o.kind];
    if (rungs === undefined || !rungs.includes(pu.rung)) return false;
    // the rung is within the cap `tempo` sets, and `tempo` is not `off`
    if (settings.tempo === 'off' || pu.rung > MAX_RUNG[settings.tempo]) return false;
    const it = env.intent(pu.group);
    if (it === undefined || it.id !== pu.intent || it.rung !== pu.rung) return false;
    if (!env.held(pu.group, it.grounds)) return false;
    // a price, a search and a confront need an earlier warning or price of the intention that was seen
    if (o.kind !== 'warning' && !it.warnings.some((x) => env.observedAt(x, now) !== undefined)) return false;
    return true;
  }

  /** The age class of a node: a resident's, or a mirrored person's reading. A missing or unavailable class counts as minor. */
  ageClassOf(who: Id, t: GameTime): 'adult' | 'minor' {
    const v = this.people.view(who);
    if (v) return v.ageClass;
    const c = this.w.k.value(who, 'age-class', t);
    return c === 'adult' ? 'adult' : 'minor';
  }

  /**
   * `produce(occurrence)`: the first failure is the result. The settings in force and the protected set are read as of `now`
   * (production time); the settings are passed in so a run uses the ones in force at its snapshot (S1 3.3).
   */
  produce(o: Occurrence, settings: SettingsEntry, now: GameTime, env?: GateEnv): GateResult {
    const kd = this.w.kinds.get(o.kind);
    const gate = this.w.data.gate;
    // 1. class exclusion
    if (kd && kd.classes !== 'none') for (const c of kd.classes) if (ceilingOf(settings, c.class) === 0) return { ok: false, reason: 'excluded' };
    // 2. the floors
    if (o.tags?.some((t) => t.startsWith('sex.')) || kd?.tags.some((t) => t.startsWith('sex.'))) return { ok: false, reason: 'sex-tag' };
    for (const p of o.participants) {
      if (!gate.floorRoles.includes(p.role)) continue; // a `<role>-group` participant is not a person and never fills a floor role
      if (this.real.has(p.who)) return { ok: false, reason: 'floor-real' };
      if (this.ageClassOf(p.who, now) !== 'adult') return { ok: false, reason: 'floor-minor' };
    }
    // 3. V-exclusion
    const v = this.w.v;
    for (const e of o.effects) if (gate.harmEffects.includes(e.effect) && e.on === v) return { ok: false, reason: 'v-target' };
    for (const p of o.participants) if ((p.role === 'victim' || p.role === 'target') && p.who === v) return { ok: false, reason: 'v-target' };
    // the protagonist-object roles (v0.6, D-30): V may be warned, sought or confronted only by an act of an active `punish` intention, within every condition of S1 7.8.1
    for (const p of o.participants) {
      if (p.who !== v || OBJECT_ROLES[p.role] === undefined) continue;
      if (!this.punishAllowed(o, p.role, settings, now, env)) return { ok: false, reason: 'v-object' };
    }
    // 4. the protected set
    for (const e of o.effects) if (gate.harmEffects.includes(e.effect) && this.people.protectedAt(e.on, now)) return { ok: false, reason: 'protected' };
    for (const p of o.participants) if ((p.role === 'victim' || p.role === 'target') && this.people.protectedAt(p.who, now)) return { ok: false, reason: 'protected' };
    return { ok: true };
  }
}
