import type { Session } from './feed.ts';

/** Coordinator-declared fallback: standard 8:1 scale; epoch zero is synthetic. */
export class ShadowClock {
  private anchor?: { source: number; game: number };
  private previous = -Infinity;
  readonly rules = new Set<string>();
  constructor(readonly meta: Session['meta'], readonly defaultStart = 0) {
    if (!Number.isFinite(defaultStart)) throw Error('Invalid default game start');
  }
  at(t: number, gameTime?: number): { game: number; derived: boolean } {
    if (!Number.isFinite(t)) throw Error('Invalid QPC clock');
    let game: number, derived = false;
    const recorded = this.meta.gameTimeSamples?.filter(x => x.source <= t).at(-1);
    if (Number.isFinite(gameTime)) {
      game = gameTime!; this.anchor = { source: t, game }; this.rules.add('feed game time');
    } else {
      derived = true;
      const anchor = this.anchor && (!recorded || this.anchor.source >= recorded.source) ? this.anchor : recorded;
      if (anchor) { game = anchor.game + (t - anchor.source) * 8; this.rules.add('QPC × 8 from recorded game time'); }
      else { game = this.defaultStart + (t - this.meta.start) * 8; this.rules.add('QPC × 8 from declared default game epoch'); }
    }
    if (game < this.previous) throw Error('Game clock moved backwards; start a separate shadow run');
    this.previous = game;
    return { game, derived };
  }
}
