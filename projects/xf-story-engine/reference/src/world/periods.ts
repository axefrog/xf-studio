import table from './periods.json';
import type { Per4 } from '../sim/data.ts';
import type { W1Period } from './types.ts';
const clockPattern = new RegExp(table.clockPattern);
const clock12HourPattern = new RegExp(table.clock12Hour.pattern);
export type PeriodRule = 'named' | 'clock' | 'clock-12h' | 'unknown';

/** Declared, derived assumptions, not verified game schedule semantics. */
export function periodStart(name: string): { start: number | null; rule: PeriodRule } {
  if (Object.hasOwn(table.named, name)) return { start: table.named[name as keyof typeof table.named], rule: 'named' };
  const clock = clockPattern.exec(name);
  if (clock && +clock[1] < 24 && +clock[2] < 60) return { start: +clock[1] * 60 + +clock[2], rule: 'clock' };
  const clock12 = clock12HourPattern.exec(name), rule = table.clock12Hour;
  if (clock12 && +clock12[1] >= 1 && +clock12[1] <= rule.hourCycle && +clock12[2] < 60)
    return { start: (+clock12[1] % rule.hourCycle) * 60 + +clock12[2] + rule.offsetMinutes[clock12[3] as keyof typeof rule.offsetMinutes], rule: 'clock-12h' };
  return { start: null, rule: 'unknown' };
}

export interface PeriodSpan { period: W1Period; start: number; minutes: number }
/** Duplicate starts share their entire span; unknown names run all day and
 * do not introduce a boundary into the known-name cycle. Units are minutes. */
export function periodSpans(periods: W1Period[]): PeriodSpan[] {
  const mapped = periods.map((period) => ({ period, ...periodStart(period.name) }));
  const starts = [...new Set(mapped.flatMap((p) => p.start === null ? [] : [p.start]))].sort((a,b) => a-b);
  const lengths = new Map(starts.map((start,i) => [start, (starts[(i+1) % starts.length] - start + 1440) % 1440 || 1440]));
  return mapped.map(({ period, start }) => {
    if (start === null) return { period, start: 0, minutes: 1440 };
    return { period, start, minutes: lengths.get(start)! };
  });
}

/** Integrate a circular span over S1's four six-hour windows in engine order. */
export function spanOverlap({ start, minutes }: Pick<PeriodSpan, 'start' | 'minutes'>): Per4 {
  return table.s1Starts.map((s1) => [-1440, 0, 1440].reduce((sum, offset) =>
    sum + Math.max(0, Math.min(start + minutes, s1 + offset + 360) - Math.max(start, s1 + offset)), 0) / 360) as Per4;
}
