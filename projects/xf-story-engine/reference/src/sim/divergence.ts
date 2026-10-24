// The `divergence(believer, subject)` read (S1 9.1): `large` if any memorable belief of the believer about the subject's `alive` or
// `affiliation` differs from the mirrored reading, `small` if another memorable belief differs, else `none`. Beliefs emit no kernel
// Changes, so the read is re-evaluated at every boundary, and the record's `divLog` keeps its transitions, at most eight per pair.
//
// The value now is worked out from the beliefs now; the value at a time before now is read from the log, which is the record of what the
// beliefs said then (SIM-08), and is `maybe` where the log no longer reaches.

import type { GameTime, Id } from '../types.ts';
import type { Sim } from './sim.ts';

export type DivValue = 'none' | 'small' | 'large';
const LOG_MAX = 8;

export class Divergence {
  constructor(private readonly sim: Sim) {}

  private get k() {
    return this.sim.k;
  }

  /** The divergence of a believer from the game about a subject, from the beliefs held now and the mirrored reading at `t` (not before now). */
  current(believer: Id, subject: Id, t: GameTime = this.k.now): DivValue {
    const h = this.k.store.header(subject);
    if (!h || h.origin.by !== 'mirrored') return 'none';
    let out: DivValue = 'none';
    for (const b of this.k.beliefs.activeOf(believer)) {
      if (b.subject !== subject || !b.memorable || b.value === undefined) continue;
      const info = this.k.schema.slotInfo(h.kind, b.path);
      if (!info || info.def.mode !== 'mirrored') continue;
      const reading = this.k.value(subject, b.path, t);
      if (reading === undefined || String(reading) === String(b.value)) continue;
      if (b.path === 'alive' || b.path === 'affiliation') return 'large';
      out = 'small';
    }
    return out;
  }

  /**
   * The divergence as of `t`. A time at or after now is the value now. A time before now is the value the log gives: the beliefs of then
   * are not kept, only what they said, so scanning today's beliefs would answer for a belief formed after `t`. Where the log no longer
   * reaches (its oldest transitions were dropped) the answer is `maybe`.
   */
  evaluate(believer: Id, subject: Id, t: GameTime = this.k.now): DivValue | 'maybe' {
    if (t >= this.k.now) return this.current(believer, subject, t);
    const key = `${believer}|${subject}`;
    const floor = this.sim.record.divFloor[key];
    if (floor !== undefined && t < floor) return 'maybe';
    let value: DivValue = 'none';
    for (const e of this.sim.record.divLog[key] ?? []) if (e.t <= t) value = e.value;
    return value;
  }

  private log(believer: Id, subject: Id, t: GameTime, value: DivValue, source: { ord?: number } = {}): void {
    const key = `${believer}|${subject}`;
    const list = (this.sim.record.divLog[key] ??= []);
    const last = list.length > 0 ? list[list.length - 1]!.value : 'none';
    if (last === value) return;
    const ord = source.ord ?? (source.ord = this.sim.record.ord++);
    list.push({ t, value, ord });
    if (list.length > LOG_MAX) {
      while (list.length > LOG_MAX) list.shift();
      // what came before the oldest transition kept is no longer known
      this.sim.record.divFloor[key] = list[0]!.t;
    }
  }

  /** A belief about a mirrored subject was set or dropped, by anyone: the believer's divergence from the game is looked at now (SIM-08). */
  noteBelief(believer: Id, subject: Id): void {
    const h = this.k.store.header(subject);
    if (!h || h.origin.by !== 'mirrored') return;
    this.log(believer, subject, this.k.now, this.current(believer, subject));
  }

  /** A mirrored reading changed (the game or a correction): every believer with a belief about that subject is looked at. */
  noteReading(subject: Id, _slot: string): void {
    const source: { ord?: number } = {};
    for (const e of this.k.beliefs.entries()) {
      if (!e.active || e.belief.subject !== subject) continue;
      this.log(e.belief.believer, subject, this.k.now, this.current(e.belief.believer, subject), source);
    }
  }

  /** The boundary hook: a believer's divergences are re-evaluated, because belief changes emit no Changes. */
  onTick(believer: Id, at: GameTime): void {
    const subjects = new Set<Id>();
    for (const b of this.k.beliefs.activeOf(believer)) if (b.memorable) subjects.add(b.subject);
    for (const key of Object.keys(this.sim.record.divLog)) if (key.startsWith(`${believer}|`)) subjects.add(key.slice(believer.length + 1));
    for (const s of [...subjects].sort()) this.log(believer, s, at, this.current(believer, s, at));
  }

  /** The value at `from` and every change in `(from, to]`, from the log (S1 9.1); `maybe` before the log reaches. */
  transitions(believer: Id, subject: Id, from: GameTime, to: GameTime): Array<{ t: GameTime; value: DivValue | 'maybe'; ord?: number }> {
    const list = this.sim.record.divLog[`${believer}|${subject}`] ?? [];
    return [{ t: from, value: this.evaluate(believer, subject, from) }, ...list.flatMap((e) => (e.t > from && e.t <= to ? [{ t: e.t, value: e.value, ord: e.ord }] : []))];
  }
}
