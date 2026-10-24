// The city's static model (S1 7.1, 7.2): the weekly shapes, the stable propensity of a cell, the opportunity of a cell, a district
// and the city, and the offender shares. Pure functions of `S1Data`, the world index and the world seed; nothing here reads V, the
// demand or the game as it is now (S1-I-5, S1-I-22).

import type { GameTime, Id } from '../types.ts';
import { LQ } from './arith.ts';
import type { KindName, Per4 } from './data.ts';
import type { IdentityKeys } from './keys.ts';
import type { People } from './people.ts';
import { periodOfSecond } from './people.ts';
import { recipeClasses } from './fit.ts';
import type { Casting } from './cast.ts';
import { simulatedDistricts } from './index-types.ts';
import type { World } from './world.ts';

const DAY = 86400;

export class CityModel {
  /** The normaliser of each kind's shape: its mean over the week, computed once at load. */
  readonly M: Record<KindName, number> = {};
  private epsCache = new Map<string, number>();
  private shareCache = new Map<string, number>();
  private offenderCache = new Map<string, number>();

  constructor(private readonly w: World, private readonly people: People, private readonly keys: IdentityKeys, private readonly casting: Casting) {
    for (const kd of w.data.kinds) this.M[kd.name] = this.weekMean(kd.name);
  }

  private get data() {
    return this.w.data;
  }

  private periodOfHour(hr: number): number {
    return periodOfSecond(hr * 3600, this.data.time.periodStartHour);
  }

  private raw(kind: KindName, wd: number, hr: number): number {
    const sh = this.data.shape.kinds[kind]!;
    let pulse = 1;
    for (const p of sh.pulses) if ((p.weekday === 'any' || p.weekday === wd) && hr >= p.fromHour && hr < p.toHour) pulse = pulse * p.factor;
    return sh.hour[this.periodOfHour(hr)]! * sh.day[wd]! * pulse;
  }

  private weekMean(kind: KindName): number {
    let sum = 0;
    for (let wd = 0; wd < 7; wd++) for (let hr = 0; hr < 24; hr++) sum = sum + this.raw(kind, wd, hr);
    return sum / 168;
  }

  /** The shape of a kind at `t`, mean 1 over the week; evaluated at the start of the window (S1 7.1). */
  shape(kind: KindName, t: GameTime): number {
    const hr = Math.floor(this.people.secondOfDay(t) / 3600);
    return this.raw(kind, this.people.weekday(t), hr) / this.M[kind]!;
  }

  /** A cell's stable propensity for a kind, `F x L`, from the world seed, the cell and the index only (S1 7.2). */
  eps(cell: Id, kind: KindName): number {
    const key = `${cell}|${kind}`;
    const hit = this.epsCache.get(key);
    if (hit !== undefined) return hit;
    const c = this.w.cell(cell);
    let L = 1;
    if (!this.data.events.flatPropensity) L = LQ[Math.floor(this.keys.prop(cell) * 4096)]!;
    const d = this.w.district(c.district);
    const over = this.data.events.propensityOverride[String(d.cellIds.indexOf(cell))];
    if (over !== undefined) L = over;
    const v = c.F[kind]! * L;
    this.epsCache.set(key, v);
    return v;
  }

  /** `a(c, k, p) = A[c][k][p] x (1 - gameCoverage[c][k]) x eps(c, k)`. */
  a(cell: Id, kind: KindName, p: number): number {
    const c = this.w.cell(cell);
    return c.A[kind]![p]! * (1 - c.gameCoverage[kind]!) * this.eps(cell, kind);
  }

  /** The weights of the cells of a district, in `cellIds` order. */
  cellWeights(district: Id, kind: KindName, p: number): number[] {
    return this.w.district(district).cellIds.map((c) => this.a(c, kind, p));
  }

  aD(district: Id, kind: KindName, p: number): number {
    let sum = 0;
    for (const c of this.w.district(district).cellIds) sum = sum + this.a(c, kind, p);
    return sum;
  }

  cityTotal(kind: KindName, p: number): number {
    let sum = 0;
    for (const d of simulatedDistricts(this.w.index)) sum = sum + this.aD(d.id, kind, p);
    for (const d of Object.values(this.w.index.districts).sort((x, y) => (x.id < y.id ? -1 : 1))) if (!d.simulated) sum = sum + d.staticTotalA[kind]![p]!;
    return sum + this.w.index.rest.totalA[kind]![p]!;
  }

  share(district: Id, kind: KindName, p: number): number {
    const key = `${district}|${kind}|${p}`;
    const hit = this.shareCache.get(key);
    if (hit !== undefined) return hit;
    const v = this.aD(district, kind, p) / this.cityTotal(kind, p);
    this.shareCache.set(key, v);
    return v;
  }

  /** `offenderShare(d, k, f)`: the static share of the offender term that class `f` holds in the district (S1 7.2). */
  offenderShare(district: Id, kind: KindName, f: number): number {
    const key = `${district}|${kind}|${f}`;
    const hit = this.offenderCache.get(key);
    if (hit !== undefined) return hit;
    const d = this.w.district(district);
    const cls = recipeClasses(d);
    void cls;
    const kd = this.w.cityKindByName.get(kind)!;
    let num = 0;
    let den = 0;
    for (const c of d.cellIds) {
      const weights = this.casting.offenderWeights(c, kind, { boost: () => 0, pairBoost: () => 1 });
      // the civilian term is `base`; the other classes are presence x rw
      den = den + weights.reduce((x, y) => x + y, 0);
      num = num + (f === 0 ? kd.base : weights[f]!);
    }
    const v = den > 0 ? num / den : 0;
    this.offenderCache.set(key, v);
    return v;
  }

  /** The mean of the people present in a cell during a period (S1 4.5). */
  meanPop(cell: Id, p: number): number {
    return this.w.cell(cell).pop[p as 0 | 1 | 2 | 3];
  }
}

export type { Per4 };
void DAY;
