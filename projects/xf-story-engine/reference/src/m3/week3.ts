import { supply3 } from './supply3.ts';
import type { Snapshot3, Thread3 } from './measures3.ts';
import { run3World } from './run3.ts';
import { Run, policies, type Policy } from './driver.ts';
import { stateById } from './states.ts';
import { ThreadArchive } from './threads3.ts';
import { controls } from './controls3.ts';
import type { Tempo } from '../procedural/types.ts';
import type { WorldIndex } from '../sim/index-types.ts';

export interface Week3Config { id: string; world: string; arm: 'E' | 'A1'; tempo: Tempo; policy: string; windows: number }
export function createWeek3(c: Week3Config, index?: WorldIndex): Run {
  const engage: Policy = { id: 'engage', answer: o => ({ kind: 'action', id: o.actions[0]! }) };
  const policy = c.policy === 'engage' ? engage : policies[c.policy];
  if (!policy) throw Error('Unknown run-3 policy');
  return new Run({ ...run3World(c.world, c.arm, c.tempo).opts, ...(index ? { index } : {}) }, stateById('S-mid-squeezed'), policy, { walk: true });
}

/** The reviewed-v5 week harness, shared by the matrix worker and offline publishers.
 * Read-only observers sample each complete window before the archive drains the
 * diagnostic sink. The engine/archive/control order is otherwise unchanged.
 */
export function runWeek3(c: Week3Config, options: {
  run?: Run;
  boundary?: (run: Run) => void;
  progress?: (run: Run, seconds: number) => void;
  deadline?: number;
} = {}) {
  const start = performance.now(), deadline = options.deadline ?? Date.now() + 3 * 3600000;
  const r = options.run ?? createWeek3(c), archive = new ThreadArchive(), controlThreads: Thread3[] = [], observations: Snapshot3[] = [];
  for (let w = 0; w < c.windows; w++) {
    if (Date.now() > deadline) throw Error('Per-week deadline exceeded');
    r.step(); options.boundary?.(r); archive.capture(r);
    if (c.arm === 'E' && w % 144 === 0) controlThreads.push(...controls(r, c.id, Math.floor(w / 144)));
    if ([18000, 36000, 72000, 100800].includes(r.play)) observations.push({ run: c.id, play: r.play, threads: archive.threads(r, c.arm, c.id) });
    if ((w + 1) % 144 === 0) options.progress?.(r, Math.round((performance.now() - start) / 1000));
  }
  const threads = archive.threads(r, c.arm, c.id);
  return { version: 3, method: 'reviewed-v5', id: c.id, world: c.world, arm: c.arm, tempo: c.tempo, policy: c.policy, windows: c.windows, play: r.play,
    findings: r.w.findings, threads, observations, supply: supply3(r), controlThreads, deliveries: r.deliveries, decisions: archive.decisions, gates: [...archive.gates.values()],
    diagnostics: { entries: archive.entries.size, perceivedBelowThread: [...archive.entries.values()].filter(e => !archive.seenAware.has(e.id) && Object.values(e.graph!.junctures).some(j => j.perceived)).length, seconds: Math.round((performance.now() - start) / 1000) } };
}

export type Week3Record = ReturnType<typeof runWeek3>;
