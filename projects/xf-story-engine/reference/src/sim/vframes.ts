// `v.frames` (S1 8.2): opens only what the game states, from the mirror, and never V's drives (S0 I-12). A situation frame for V's cell at
// tier 3 and one for each of its neighbouring cells at tier 2, always open; a goal frame for each objective the game tracks, saying what the
// game asked and not what V feels. The authored frames of R1's people and of any mirrored canon person stay active and are not advanced here.

import type { ContextFrame } from '../frames.ts';
import { mintedId } from '../id.ts';
import type { Id, Value } from '../types.ts';
import type { Sim } from './sim.ts';

export class VFrames {
  constructor(private readonly sim: Sim) {}

  private get k() {
    return this.sim.k;
  }

  situationId(cell: Id): Id {
    return mintedId(this.sim.w.v, this.sim.w.v, `frame:situation:${cell}`);
  }
  goalId(journal: Id): Id {
    return mintedId(this.sim.w.v, this.sim.w.v, `frame:goal:${journal}`);
  }

  /**
   * The live frame under an Id, if there is one. A frame that has ended (satisfied or abandoned) is not reactivated: a save keeps the live
   * frames and the ended ones a persisted record refers to (S0 10.4), so whether an ended frame is still there depends on whether the game was
   * saved and loaded, and a run that goes on and a run that was saved and loaded must treat a returning cell or a re-tracked entry alike. Both
   * open the frame afresh, as the run that was loaded must (its `opened` is the time of the return); what hangs from the old one stays attached.
   */
  private live(id: Id): ContextFrame | undefined {
    const have = this.k.frames.frame(id);
    if (have !== undefined && !this.k.frames.eligible(have)) {
      this.k.frames.remove(id);
      return undefined;
    }
    return have;
  }

  /** V's mirrored cell changed: the frames for the old cell are abandoned and the new ones opened (S1 8.2). */
  cellChanged(_old: Value | undefined, nw: Value): void {
    const k = this.k;
    const v = this.sim.w.v;
    const cause = this.sim.w.vState;
    const want = new Map<Id, 3 | 2>();
    if (typeof nw === 'string' && this.sim.w.index.cells[nw]) {
      want.set(nw, 3);
      for (const c of this.sim.w.cell(nw).adj1) if (!want.has(c)) want.set(c, 2);
    }
    for (const f of k.frames.framesOf(v)) {
      if (f.level !== 'situation') continue;
      const cell = f.focus.nodes[0];
      if (cell === undefined || f.id !== this.situationId(cell)) continue;
      if (!want.has(cell) && (f.status === 'active' || f.status === 'blocked')) k.frames.setStatus(f.id, 'abandoned', cause);
    }
    for (const [cell, tier] of want) {
      const id = this.situationId(cell);
      const have = this.live(id);
      if (!have) {
        k.frames.open({ id, actor: v, level: 'situation', origin: v, weight: 1, focus: { nodes: [cell], tier }, cause });
        continue;
      }
      if (have.focus.tier !== tier) k.frames.setFocus(id, { tier }, cause);
      if (have.status !== 'active') k.frames.setStatus(id, 'active', cause);
    }
  }

  /** A tracked journal entry becomes a goal frame on V that wants the entry's target, active or blocked by the entry's journal state (S1 8.2). */
  journalChanged(journal: Id): void {
    const k = this.k;
    const v = this.sim.w.v;
    const tracked = k.value(journal, 'tracked') === 'yes';
    const state = k.value(journal, 'jstate');
    const id = this.goalId(journal);
    if (!tracked || state === 'finished' || state === 'failed') {
      const have = k.frames.frame(id);
      if (have && (have.status === 'active' || have.status === 'blocked')) k.frames.setStatus(id, state === 'finished' ? 'satisfied' : 'abandoned', journal);
      return;
    }
    const have = this.live(id);
    const status = state === 'blocked' ? 'blocked' : 'active';
    if (!have) {
      const target = k.value(journal, 'target');
      const district = k.value(journal, 'district');
      const wants = typeof target === 'string' && /^[0-9a-f]{32}$/.test(target) ? [{ slot: '*' as const, scope: { nodes: [target] } }] : [];
      k.frames.open({
        id, actor: v, level: 'goal', origin: journal, weight: 1, focus: { nodes: typeof target === 'string' && /^[0-9a-f]{32}$/.test(target) ? [target] : [], tier: 2 }, status, cause: journal,
        payload: typeof district === 'string' && /^[0-9a-f]{32}$/.test(district) ? { place: district } : {}, own: { wants },
      });
    } else if (have.status !== status) k.frames.setStatus(id, status, journal);
  }
}
