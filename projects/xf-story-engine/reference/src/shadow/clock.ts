import type { Batch, Session } from './feed.ts';

/** Use the same causal clock as consumption, at the earliest driving observation. */
export function initialGameTime(batch: Batch, defaultStart = 0): number {
  const t = Math.min(batch.v.reduce((t, v) => Math.min(t, v.t), Infinity), batch.actors.reduce((t, a) => Math.min(t, a.t), Infinity));
  const v = batch.v.find(v => v.t === t);
  return new ShadowClock(batch.meta, defaultStart).at(t, v?.gameTime, !v).game;
}

/** Coordinator-declared fallback: standard 8:1 scale; epoch zero is synthetic. */
export class ShadowClock {
  private anchor?: { source: number; game: number };
  private previous = -Infinity;
  private previousSource = -Infinity;
  private previousDerived = false;
  readonly rules = new Set<string>();
  constructor(readonly meta: Session['meta'], readonly defaultStart = 0) {
    if (!Number.isFinite(defaultStart)) throw Error('Invalid default game start');
  }
  at(t: number, gameTime?: number, holdRecorded = false): { game: number; derived: boolean } {
    if (!Number.isFinite(t)) throw Error('Invalid QPC clock');
    let game: number, derived = false;
    const recorded = this.meta.gameTimeSamples?.filter(x => x.source <= t).at(-1);
    if (Number.isFinite(gameTime)) {
      game = gameTime!; this.anchor = { source: t, game }; this.rules.add('feed game time');
    } else {
      derived = true;
      const anchor = this.anchor && (!recorded || this.anchor.source >= recorded.source) ? this.anchor : recorded;
      if (anchor && holdRecorded && this.previousSource >= anchor.source) {
        game = this.previous; derived = this.previousDerived; this.rules.add('last effective game time held for actor samples');
      }
      else if (anchor && (holdRecorded || recorded && anchor === recorded)) {
        game = anchor.game; derived = false; this.rules.add('recorded game time held between samples');
      }
      else if (anchor) { game = anchor.game + (t - anchor.source) * 8; this.rules.add('QPC × 8 from recorded game time'); }
      else { game = this.defaultStart + (t - this.meta.start) * 8; this.rules.add('QPC × 8 from declared default game epoch'); }
    }
    if (game < this.previous) throw Error('Game clock moved backwards; start a separate shadow run');
    this.previous = game;
    this.previousSource = t; this.previousDerived = derived;
    return { game, derived };
  }
}
