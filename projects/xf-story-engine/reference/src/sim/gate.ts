// The production gate (S1 6): everything S1 produces, as new occurrences, passes one stateless choke point before it is published.
// Gates sit at choke points, not on each feature. The gate holds no budget and no counter: budgets belong to the admission owner
// (`city.events`), which calls the gate. It refuses plainly, with a reason; a refusal is never silent.

import type { GameTime, Id } from '../types.ts';
import { ceilingOf } from '../settings.ts';
import type { SettingsEntry } from '../settings.ts';
import type { GateResult, Occurrence } from './occ.ts';
import type { People } from './people.ts';
import type { World } from './world.ts';

export class Gate {
  /** Persons marked real: never bound in a floor role. */
  readonly real = new Set<Id>();

  constructor(private readonly w: World, private readonly people: People) {}

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
  produce(o: Occurrence, settings: SettingsEntry, now: GameTime): GateResult {
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
    // 4. the protected set
    for (const e of o.effects) if (gate.harmEffects.includes(e.effect) && this.people.protectedAt(e.on, now)) return { ok: false, reason: 'protected' };
    for (const p of o.participants) if ((p.role === 'victim' || p.role === 'target') && this.people.protectedAt(p.who, now)) return { ok: false, reason: 'protected' };
    return { ok: true };
  }
}
