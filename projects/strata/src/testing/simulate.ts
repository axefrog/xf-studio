/**
 * The simulation harness. A run is a list of steps generated from a seed: the person's actions (with raw integer
 * arguments the scenario resolves against the current graph), deliveries of pending source events (which one is a
 * choice, so orderings are explored), time advancing, and crash-restarts. Invariants are checked after every step.
 * A failing run reports its seed and steps; the shrinker reduces the steps to a minimal failing list, which goes
 * into a regression file that every suite run replays.
 */
import { settle } from "./sim-sources";
import { prng } from "../random";

export type Step =
  | { readonly kind: "act"; readonly action: string; readonly args: readonly number[] }
  | { readonly kind: "deliver"; readonly pick: number }
  | { readonly kind: "advance"; readonly ms: number }
  | { readonly kind: "crash" };

export type SimAction<W> = {
  readonly name: string;
  /** Relative frequency among actions (default 1). */
  readonly weight?: number;
  /** Runs the action. Must not wait on source events (start async work and let deliveries finish it). */
  run(world: W, args: readonly number[]): void | Promise<void>;
};

export interface Scenario<W> {
  readonly name: string;
  setup(seed: string): W | Promise<W>;
  readonly actions: readonly SimAction<W>[];
  deliver(world: W, pick: number): void;
  advance(world: W, ms: number): void;
  /** Crash and restart: in-memory state dropped, reloaded from the store and the recovery copy. */
  crash?(world: W): W | Promise<W>;
  /** Invariant problems after a step (empty when every invariant holds). Each starts with the invariant's ID and a colon. */
  check(world: W, step: number): string[] | Promise<string[]>;
  /**
   * After the last step: ends everything the world started and returns what outlived it (lifetime problems: nodes,
   * processes, effects, demand or listeners left behind).
   */
  teardown?(world: W): string[] | Promise<string[]>;
}

export type SimFailure = { readonly seed: string; readonly step: number; readonly steps: readonly Step[]; readonly problems: readonly string[] };
export type SimResult = { readonly ok: true; readonly seed: string; readonly steps: readonly Step[] } | { readonly ok: false; readonly seed: string; readonly failure: SimFailure };

/** The steps of a run, from its seed. */
export function generateSteps<W>(scenario: Scenario<W>, seed: string, count: number): Step[] {
  const next = prng(`${seed}\u0000steps`);
  const uint = () => Math.floor(next() * 4294967296) >>> 0;
  const total = scenario.actions.reduce((sum, action) => sum + (action.weight ?? 1), 0);
  const steps: Step[] = [];
  for (let i = 0; i < count; i++) {
    const roll = next();
    if (roll < 0.55) {
      let pick = next() * total, action = scenario.actions[0];
      for (const item of scenario.actions) { pick -= item.weight ?? 1; if (pick < 0) { action = item; break; } }
      steps.push({ kind: "act", action: action.name, args: [uint(), uint(), uint(), uint(), uint()] });
    } else if (roll < 0.9) steps.push({ kind: "deliver", pick: next() < 0.7 ? 0 : uint() % 8 });
    else if (roll < 0.985 || !scenario.crash) steps.push({ kind: "advance", ms: [1, 5, 20, 100, 300, 2000][uint() % 6] });
    else steps.push({ kind: "crash" });
  }
  return steps;
}

/** Runs the given steps (a generated run, a shrunk trace or a regression). */
export async function runSteps<W>(scenario: Scenario<W>, seed: string, steps: readonly Step[]): Promise<SimResult> {
  let world = await scenario.setup(seed);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      switch (step.kind) {
        case "act": {
          const action = scenario.actions.find(item => item.name === step.action);
          if (action) await action.run(world, step.args);
          break;
        }
        case "deliver": scenario.deliver(world, step.pick); break;
        case "advance": scenario.advance(world, step.ms); break;
        case "crash": if (scenario.crash) world = await scenario.crash(world); break;
      }
      await settle();
    } catch (error) {
      return { ok: false, seed, failure: { seed, step: i, steps: steps.slice(0, i + 1), problems: [`exception: ${(error as Error)?.stack ?? error}`] } };
    }
    const problems = await scenario.check(world, i);
    if (problems.length) return { ok: false, seed, failure: { seed, step: i, steps: steps.slice(0, i + 1), problems } };
  }
  if (scenario.teardown) {
    let problems: string[];
    try { problems = await scenario.teardown(world); } catch (error) { problems = [`exception: ${(error as Error)?.stack ?? error}`]; }
    if (problems.length) return { ok: false, seed, failure: { seed, step: steps.length, steps, problems } };
  }
  return { ok: true, seed, steps };
}

/** One seeded run of `steps` steps. */
export function simulate<W>(scenario: Scenario<W>, options: { readonly seed: string | number; readonly steps: number }): Promise<SimResult> {
  const seed = String(options.seed);
  return runSteps(scenario, seed, generateSteps(scenario, seed, options.steps));
}

const invariantOf = (problems: readonly string[]) => (problems[0] ?? "").split(":")[0];

/**
 * Shrinks a failing trace: removes chunks of steps (halves, then smaller), then zeroes action arguments and delivery
 * picks, keeping each change that still fails the same invariant. Deterministic; bounded by `budget` re-runs.
 */
export async function shrink<W>(scenario: Scenario<W>, failure: SimFailure, options: { readonly budget?: number } = {}): Promise<SimFailure> {
  let best = failure, runs = 0;
  const budget = options.budget ?? 600, target = invariantOf(failure.problems);
  const attempt = async (steps: readonly Step[]): Promise<SimFailure | null> => {
    if (runs++ >= budget) return null;
    const result = await runSteps(scenario, failure.seed, steps);
    return !result.ok && invariantOf(result.failure.problems) === target ? result.failure : null;
  };
  for (let chunk = Math.max(1, best.steps.length >> 1); chunk >= 1 && runs < budget; chunk >>= 1) {
    let progress = true;
    while (progress && runs < budget) {
      progress = false;
      for (let start = 0; start < best.steps.length && runs < budget; start += chunk) {
        const candidate = [...best.steps.slice(0, start), ...best.steps.slice(start + chunk)];
        if (!candidate.length) continue;
        const found = await attempt(candidate);
        if (found) { best = found; progress = true; break; }
      }
    }
  }
  for (let i = 0; i < best.steps.length && runs < budget; i++) {
    const step = best.steps[i];
    const simpler: Step | null = step.kind === "act" && step.args.some(arg => arg !== 0) ? { ...step, args: step.args.map(() => 0) }
      : step.kind === "deliver" && step.pick !== 0 ? { kind: "deliver", pick: 0 } : null;
    if (!simpler) continue;
    const found = await attempt([...best.steps.slice(0, i), simpler, ...best.steps.slice(i + 1)]);
    if (found) best = found;
  }
  return best;
}

/** A regression: a named seed and step list that once failed, replayed by every suite run. */
export type Regression = { readonly name: string; readonly scenario: string; readonly seed: string; readonly steps: readonly Step[]; readonly note?: string };

/** Replays a regression; it must now pass. */
export function replay<W>(scenario: Scenario<W>, regression: Regression): Promise<SimResult> {
  return runSteps(scenario, regression.seed, regression.steps);
}
