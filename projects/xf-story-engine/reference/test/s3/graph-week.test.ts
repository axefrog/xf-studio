// SF3-60 keeps the same scripted assertions and default/FULL scales in a shared fixture.
import { expect, test, setDefaultTimeout } from 'bun:test';
import { layeredWeek } from './layered-week.ts';
setDefaultTimeout(180_000);
test('SF3-60: a scripted layered Kabuki week with R2 prime replays every stance', () => {
  for (const stance of ['pay', 'standup', 'decline'] as const) expect(layeredWeek(stance, true)).toEqual(layeredWeek(stance));
});
