// Roles and casting the people of an event (S1 5.4). Casting is a pure function of a descriptor and of recorded history as of the
// occurrence's own time. It is the same function for an event at admission, an item at opening and a parent re-cast for its child.
// V is never drawn. The gate checks the cast again at production time (`gate.ts`).

import { invCum } from './arith.ts';
import type { KindName } from './data.ts';
import type { DistrictIndex } from './index-types.ts';
import type { IdentityKeys } from './keys.ts';
import { type KindDef1, type RoleSpec, isHarmRole, rolesOf } from './kinds.ts';
import type { CastEntry, Descriptor } from './occ.ts';
import type { People, ResidentView } from './people.ts';
import { recipeClasses } from './fit.ts';
import type { Id } from '../types.ts';
import type { World } from './world.ts';

/** The boosts a group digest gives (S1 7.8): by affiliation class index and kind, and by pair. */
export interface Boosts {
  boost(district: Id, f: number, kind: KindName): number;
  pairBoost(district: Id, a: number, b: number): number;
}
export const NO_BOOSTS: Boosts = { boost: () => 0, pairBoost: () => 1 };

export class Casting {
  constructor(private readonly w: World, private readonly people: People, private readonly keys: IdentityKeys) {}

  private districtOf(cell: Id): DistrictIndex {
    return this.w.district(this.w.cell(cell).district);
  }

  /** The class index of an affiliation name: its place in the district's six, or `other` (5). */
  classIndexOf(d: DistrictIndex, aff: string): number {
    const at = d.affOrder.indexOf(aff);
    return at >= 0 ? at : 5;
  }

  /** `presence_f(c)` for a class index (S1 5.4): civilian and ncpd by name, A1 to A3 by their affiliation, `other` the rest. */
  classPresence(cell: Id, f: number): number {
    const c = this.w.cell(cell);
    const d = this.districtOf(cell);
    if (f < 5) return c.presence[d.affOrder[f]!] ?? 0;
    let sum = 0;
    // summed in the order of the names, never the order the record happens to list them
    for (const aff of Object.keys(c.presence).sort()) if (d.affOrder.indexOf(aff) < 0 || d.affOrder.indexOf(aff) === 5) sum += c.presence[aff]!;
    return sum;
  }

  /** The offender weights over the six classes (S1 5.4): `civilian` has `base`; each other class `presence x rw x (1 + boost)`. */
  offenderWeights(cell: Id, kind: KindName, boosts: Boosts): number[] {
    const kd = this.w.cityKindByName.get(kind)!;
    const district = this.w.cell(cell).district;
    const d = this.districtOf(cell);
    const cls = recipeClasses(d);
    const out: number[] = [];
    for (let f = 0; f < 6; f++) {
      if (f === 0) {
        out.push(kd.base);
        continue;
      }
      // `other` stands for gang in the offender term (S1 5.4), whatever the recipe calls it
      const rw = f === 1 ? kd.rw.ncpd : f === 5 ? kd.rw.gang : cls[f] === 'corp' ? kd.rw.corp : kd.rw.gang;
      out.push(this.classPresence(cell, f) * rw * (1 + boosts.boost(district, f, kind)));
    }
    return out;
  }

  /** The sides of an occurrence, drawn once (S1 5.4): the aggressor class, and for a gang clash the oriented pair. */
  drawSides(occ: Id, cell: Id, kind: KindName, boosts: Boosts): { a?: number; b?: number } {
    const d = this.districtOf(cell);
    const c = this.w.cell(cell);
    if (kind === 'gang-clash') {
      const district = c.district;
      const weights = c.pairs.map((p) => p.w * boosts.pairBoost(district, this.classIndexOf(d, p.a), this.classIndexOf(d, p.b)));
      if (weights.length === 0 || !(weights.reduce((x, y) => x + y, 0) > 0)) return {};
      const p = c.pairs[invCum(weights, this.keys.castPair(occ))]!;
      return { a: this.classIndexOf(d, p.a), b: this.classIndexOf(d, p.b) };
    }
    const kd = this.w.kinds.get(kind);
    if (!kd || !kd.roles.some((r) => r.source.from === 'offenders' || r.source.from === 'group')) return {};
    const w = this.offenderWeights(cell, kind, boosts);
    if (!(w.reduce((x, y) => x + y, 0) > 0)) return {};
    return { a: invCum(w, this.keys.castF(occ)) };
  }

  /** The group node for a class index: only the groups of `A1 ... A3` have nodes (S1 7.0). */
  groupOf(cell: Id, f: number | undefined): Id | undefined {
    if (f === undefined || f < 2 || f > 4) return undefined;
    return this.w.group(this.w.cell(cell).district, (['A1', 'A2', 'A3'] as const)[f - 2]!);
  }

  private matches(v: ResidentView, spec: RoleSpec, sides: Descriptor['sides'], cls: string[]): boolean {
    const src = spec.source;
    switch (src.from) {
      case 'offenders':
        return sides?.a !== undefined && v.affc === sides.a;
      case 'group': {
        const f = src.side === 'A' ? sides?.a : sides?.b;
        return f !== undefined && v.affc === f && (!src.roles || src.roles.includes(v.role));
      }
      case 'residents':
        return (!src.roles || src.roles.includes(v.role)) && (src.aff !== 'gang' || cls[v.affc] === 'gang');
      case 'responders':
        return v.affc === 1;
      case 'parent':
      case 'fixed':
        return false;
    }
  }

  /** The class index of a side, for group involvement. */
  private sideClass(spec: RoleSpec, sides: Descriptor['sides']): number | undefined {
    const src = spec.source;
    if (src.from === 'group') return src.side === 'A' ? sides?.a : sides?.b;
    if (src.from === 'offenders') return sides?.a;
    return undefined;
  }

  /** Cast an occurrence: the persons of each role, or group involvement for an unfilled role that allows it, or `no-cast` (S1 5.4). */
  cast(d: Descriptor): CastEntry[] | 'no-cast' {
    const kd: KindDef1 | undefined = this.w.kinds.get(d.kind);
    const specs = rolesOf(d.kind, d.parent !== undefined);
    const harm = this.w.data.gate.harmEffects;
    const floor = this.w.data.gate.floorRoles;
    const district = this.districtOf(d.cell);
    const cls = recipeClasses(district);
    const fixedRoles = new Set((d.fixed ?? []).map((f) => f.role));
    const present = specs.some((s) => s.source.from !== 'parent' && s.source.from !== 'fixed' && !fixedRoles.has(s.role)) ? this.people.presentAt(d.cell, d.time, this.w.data.people.presentCap) : [];
    const out: CastEntry[] = [];
    const taken = new Set<Id>();
    // v0.6 (S1 5.4): a goal act keeps its fixed cast, checked: each person other than V is alive, adult and where the act is, and not protected in a role of harm; V, fixed only in a protagonist-object role, is never checked
    for (const f of d.fixed ?? []) {
      if (f.role !== 'item' && f.who !== this.w.v) {
        const pv = this.people.view(f.who);
        if (!pv || !this.people.alive(f.who, d.time) || pv.ageClass !== 'adult') return 'no-cast';
        const wh = this.people.where(f.who, d.time);
        if (wh.cls === 'away' || wh.cell !== d.cell) return 'no-cast';
        if (isHarmRole(kd, f.role, harm) && this.people.protectedAt(f.who, d.time)) return 'no-cast';
      }
      out.push({ role: f.role, who: f.who });
      taken.add(f.who);
    }
    for (const spec of specs) {
      if (spec.source.from === 'fixed' || fixedRoles.has(spec.role)) {
        if (out.filter((e) => e.role === spec.role).length < spec.count[0]) return 'no-cast';
        continue;
      }
      if (spec.source.from === 'parent') {
        for (const x of d.inherit ?? []) if (x.role === spec.role) out.push({ role: spec.role, who: x.who });
        continue;
      }
      const harmRole = floor.includes(spec.role) || isHarmRole(kd, spec.role, harm);
      const eligible: Id[] = [];
      for (const r of present) {
        if (taken.has(r)) continue;
        const v = this.people.view(r);
        if (!v) continue;
        if (spec.adult && v.ageClass !== 'adult') continue;
        if (harmRole && this.people.protectedAt(r, d.time)) continue;
        if (!this.matches(v, spec, d.sides, cls)) continue;
        eligible.push(r);
      }
      const n = spec.count[0] === spec.count[1] ? spec.count[0] : spec.count[0] + Math.floor(this.keys.castN(d.id, spec.role) * (spec.count[1] - spec.count[0] + 1));
      let filled = 0;
      for (let i = 0; i < n && eligible.length > 0; i++) {
        const j = Math.floor(this.keys.castWho(d.id, spec.role, i) * eligible.length);
        const who = eligible.splice(j, 1)[0]!;
        taken.add(who);
        out.push({ role: spec.role, who });
        filled++;
      }
      if (filled < spec.count[0]) {
        const g = spec.groupOk ? this.groupOf(d.cell, this.sideClass(spec, d.sides)) : undefined;
        if (g === undefined) return 'no-cast';
        out.push({ role: `${spec.role}-group`, group: g });
      }
    }
    return out;
  }
}
