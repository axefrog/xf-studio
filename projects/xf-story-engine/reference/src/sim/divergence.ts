// The `divergence(believer, subject)` read (S1 9.1): `large` if any memorable belief of the believer about the subject's `alive` or
// `affiliation` differs from the mirrored reading, `small` if another memorable belief differs, else `none`. Beliefs emit no kernel
// Changes, so the read is re-evaluated at every boundary, and the record's `divLog` keeps its transitions, at most eight per pair.

import type { GameTime, Id } from '../types.ts';
import type { Sim } from './sim.ts';

export type DivValue = 'none' | 'small' | 'large';

export class Divergence {
  constructor(private readonly sim: Sim) {}

  private get k() {
    return this.sim.k;
  }

  /** The divergence of a believer from the game about a subject, as of `t`. */
  evaluate(believer: Id, subject: Id, t: GameTime = this.k.now): DivValue {
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

  private log(believer: Id, subject: Id, t: GameTime, value: DivValue): void {
    const key = `${believer}|${subject}`;
    const list = (this.sim.record.divLog[key] ??= []);
    const last = list.length > 0 ? list[list.length - 1]!.value : 'none';
    if (last === value) return;
    list.push({ t, value });
    while (list.length > 8) list.shift();
  }

  /** A mirrored reading changed (the game or a correction): every believer with a belief about that subject is looked at. */
  noteReading(subject: Id, _slot: string): void {
    for (const e of this.k.beliefs.entries()) {
      if (!e.active || e.belief.subject !== subject) continue;
      this.log(e.belief.believer, subject, this.k.now, this.evaluate(e.belief.believer, subject));
    }
  }

  /** The boundary hook: a believer's divergences are re-evaluated, because belief changes emit no Changes. */
  onTick(believer: Id, at: GameTime): void {
    const subjects = new Set<Id>();
    for (const b of this.k.beliefs.activeOf(believer)) if (b.memorable) subjects.add(b.subject);
    for (const key of Object.keys(this.sim.record.divLog)) if (key.startsWith(`${believer}|`)) subjects.add(key.slice(believer.length + 1));
    for (const s of [...subjects].sort()) this.log(believer, s, at, this.evaluate(believer, s, at));
  }

  /** The value at `t` and every change in `(from, to]`, from the log (S1 9.1). */
  transitions(believer: Id, subject: Id, from: GameTime, to: GameTime): Array<{ t: GameTime; value: DivValue }> {
    const list = this.sim.record.divLog[`${believer}|${subject}`] ?? [];
    let initial: DivValue = 'none';
    for (const e of list) if (e.t <= from) initial = e.value;
    return [{ t: from, value: initial }, ...list.filter((e) => e.t > from && e.t <= to).map((e) => ({ t: e.t, value: e.value }))];
  }
}
