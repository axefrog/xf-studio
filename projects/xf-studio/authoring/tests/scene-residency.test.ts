/**
 * Profiles phase 4a-iv (experiment 043 §10, T1): residency and the superseding subject change, as a DOM-free state machine. Builds run on
 * an injected clock in steps that each check their signal, as a scene runtime's build does. A seeded model drives random subject and body
 * changes (with cancels by supersession) and checks after every step: the last choice is what ends up shown, nothing superseded is ever
 * shown, a superseded build stops within 100 ms of clock, a warm runtime is reused without a build, the least recently shown is evicted
 * first, and every runtime built is disposed exactly once by the end. Phase 4a-v adds preparation: a runtime is shown only once built and
 * prepared, its typed progress only grows, a want superseded while it prepares stops and is never shown, and a warm runtime is prepared
 * again only when it needs to be.
 */
import { describe, expect, test } from "bun:test";
import { SceneResidency, type PreparationState, type ResidencyWant } from "../src/preview/scene-residency";

/** A virtual clock: timers run only when it is advanced. */
class Clock {
  now = 0;
  private timers: { at: number; run: () => void; order: number }[] = [];
  private order = 0;
  sleep(ms: number) { return new Promise<void>(resolve => this.timers.push({ at: this.now + ms, run: resolve, order: this.order++ })); }
  async advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      await flush();
      this.timers.sort((a, b) => a.at - b.at || a.order - b.order);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.now = next.at;
      next.run();
    }
    this.now = end;
    await flush();
  }
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };

type Want = ResidencyWant & { subject: string; body: "female" | "male" };
const wantOf = (scene: string, subject: string, body: "female" | "male"): Want => ({ scene, subject, body, key: `${scene}|${subject}|${body}` });
type Runtime = { id: number; key: string; disposed: number; shown: boolean };

/** A residency over runtimes built in steps on the clock (each step 10–40 ms; a masculine head takes 12 steps, its core prepared first, a feminine one 3), recording everything. */
function harness(clock: Clock, options: { warm?: number; fail?: (want: Want) => boolean } = {}) {
  const log: string[] = [], built: Runtime[] = [], cancels: number[] = [], shownWants: string[] = [];
  let next = 0, latest = "";
  const residency = new SceneResidency<Want, Runtime>({
    build: async (want, signal) => {
      const steps = want.body === "male" ? 12 : 3;
      for (let step = 0; step < steps; step++) {
        await clock.sleep(10 + ((step * 13) % 31));
        if (signal.aborted) {
          const at = (signal as AbortSignal & { abortedAt?: number }).abortedAt!;
          cancels.push(clock.now - at);
          throw signal.reason;
        }
      }
      if (options.fail?.(want)) throw Error(`The ${want.body} head couldn't be read.`);
      const runtime: Runtime = { id: ++next, key: want.key, disposed: 0, shown: false };
      built.push(runtime);
      log.push(`built:${want.key}`);
      return runtime;
    },
    show: (runtime, want) => {
      // The superseding rule: only the newest want's runtime is ever shown.
      shownWants.push(want.key);
      expect(want.key).toBe(latest);
      expect(runtime.disposed).toBe(0);
      expect(built.filter(item => item.shown)).toEqual([]);
      runtime.shown = true;
      log.push(`show:${want.key}`);
    },
    hide: runtime => { expect(runtime.shown).toBe(true); runtime.shown = false; log.push(`hide:${runtime.key}`); },
    dispose: runtime => { expect(runtime.shown).toBe(false); runtime.disposed++; log.push(`dispose:${runtime.key}`); },
  }, { warm: options.warm });
  /** Want `want`, stamping when its predecessor's build is aborted (for the cancel latency). */
  const want = (target: Want) => {
    const building = (residency as unknown as { building: { controller: AbortController } | null }).building;
    if (building) {
      const signal = building.controller.signal as AbortSignal & { abortedAt?: number };
      signal.addEventListener("abort", () => { signal.abortedAt = clock.now; }, { once: true });
    }
    latest = target.key;
    const outcome = residency.want(target).then(() => "shown", (error: Error) => error.name === "AbortError" ? "superseded" : `failed:${error.message}`);
    return outcome;
  };
  return { residency, log, built, cancels, shownWants, want };
}

describe("residency and the superseding subject change (4a-iv T1)", () => {
  test("a superseding body switch shows the last choice: female, male, then female 150 ms later shows female, and the male build stops", async () => {
    const clock = new Clock(), h = harness(clock);
    const female = wantOf("s1", "v1", "female"), male = wantOf("s1", "v1", "male");
    expect(await Promise.race([h.want(female), clock.advance(200).then(() => "timeout")])).toBe("shown");
    const toMale = h.want(male);
    await clock.advance(150);
    // The female V is still shown while the male one builds.
    expect(h.residency.shown()?.key).toBe(female.key);
    const back = h.want(female);
    expect(await back).toBe("shown");
    await clock.advance(500);
    expect(await toMale).toBe("superseded");
    expect(h.residency.shown()?.key).toBe(female.key);
    // The male build never finished: nothing of it was shown, and it stopped at its next step.
    expect(h.built.map(runtime => runtime.key)).toEqual([female.key]);
    expect(h.cancels.length).toBe(1);
    expect(h.cancels[0]).toBeLessThanOrEqual(100);
    expect(h.log).toEqual([`built:${female.key}`, `show:${female.key}`]);
  });

  test("the previous runtime stays shown until the new one is built; a late result is never shown, and goes", async () => {
    const clock = new Clock(), h = harness(clock);
    const a = wantOf("s1", "v1", "female"), b = wantOf("s1", "v2", "female"), c = wantOf("s1", "v3", "female");
    h.want(a); await clock.advance(200);
    const toB = h.want(b);
    await clock.advance(20);
    expect(h.residency.shown()?.key).toBe(a.key);
    expect(h.residency.pending()?.key).toBe(b.key);
    const toC = h.want(c);
    await clock.advance(300);
    expect([await toB, await toC]).toEqual(["superseded", "shown"]);
    expect(h.shownWants).toEqual([a.key, c.key]);
    expect(h.log.filter(line => line.includes("v2"))).toEqual([]);
  });

  test("a build that finishes after it was superseded is disposed, never shown (the generation check)", async () => {
    const clock = new Clock();
    let release!: (runtime: Runtime) => void;
    const runtimes: Runtime[] = [], log: string[] = [];
    const residency = new SceneResidency<Want, Runtime>({
      // A build that ignores its signal (its last step can't be stopped part-way, like a glTF parse).
      build: want => want.subject === "slow" ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ id: 0, key: want.key, disposed: 0, shown: false }),
      show: (runtime) => { log.push(`show:${runtime.key}`); },
      hide: runtime => log.push(`hide:${runtime.key}`),
      dispose: runtime => { runtime.disposed++; log.push(`dispose:${runtime.key}`); },
    });
    const slow = residency.want(wantOf("s1", "slow", "male")).catch((error: Error) => error.name);
    await residency.want(wantOf("s1", "fast", "female"));
    const late: Runtime = { id: 9, key: "s1|slow|male", disposed: 0, shown: false };
    runtimes.push(late);
    release(late);
    expect(await slow).toBe("AbortError");
    await clock.advance(0);
    expect(late.disposed).toBe(1);
    expect(log).toEqual(["show:s1|fast|female", "dispose:s1|slow|male"]);
  });

  test("a warm runtime is reused without a build; past the budget the least recently shown is evicted, and closing disposes everything", async () => {
    const clock = new Clock(), h = harness(clock, { warm: 1 });
    const a = wantOf("s1", "v1", "female"), b = wantOf("s1", "v1", "male"), c = wantOf("s1", "v2", "female");
    h.want(a); await clock.advance(200);
    h.want(b); await clock.advance(300);
    expect(h.residency.snapshot().residents.map(item => `${item.key}:${item.state}`)).toEqual([`${a.key}:warm`, `${b.key}:shown`]);
    // Back to A: warm, so shown at once with no build.
    const builds = h.built.length;
    expect(await h.want(a)).toBe("shown");
    expect(h.built.length).toBe(builds);
    expect(h.log.slice(-2)).toEqual([`hide:${b.key}`, `show:${a.key}`]);
    // C is built; B (shown longer ago than A) is evicted, A stays warm.
    h.want(c); await clock.advance(200);
    expect(h.log.slice(-3)).toEqual([`hide:${a.key}`, `show:${c.key}`, `dispose:${b.key}`]);
    expect(h.residency.snapshot().residents.map(item => `${item.key}:${item.state}`)).toEqual([`${a.key}:warm`, `${c.key}:shown`]);
    h.residency.close("s1");
    expect(h.residency.shown()).toBeUndefined();
    expect(h.built.map(runtime => runtime.disposed)).toEqual([1, 1, 1]);
  });

  test("a context loss drops the warm runtimes first; the shown one and a build in flight stay", async () => {
    const clock = new Clock(), h = harness(clock, { warm: 2 });
    const a = wantOf("s1", "v1", "female"), b = wantOf("s1", "v2", "female"), c = wantOf("s1", "v3", "female"), d = wantOf("s1", "v4", "male");
    for (const want of [a, b, c]) { h.want(want); await clock.advance(200); }
    const toD = h.want(d);
    await clock.advance(10);
    h.residency.contextLost();
    expect(h.residency.snapshot()).toMatchObject({ residents: [{ key: c.key, state: "shown" }], building: { key: d.key } });
    expect(h.log.filter(line => line.startsWith("dispose:"))).toEqual([`dispose:${a.key}`, `dispose:${b.key}`]);
    await clock.advance(400);
    expect(await toD).toBe("shown");
    // A zero budget keeps only the shown runtime.
    const none = harness(clock, { warm: 0 });
    none.want(a); await clock.advance(200);
    none.want(b); await clock.advance(200);
    expect(none.residency.snapshot().residents.map(item => item.key)).toEqual([b.key]);
    expect(() => new SceneResidency({} as never, { warm: -1 })).toThrow("whole number");
  });

  test("a failed build leaves the previous runtime shown and the next want builds again", async () => {
    const clock = new Clock(), h = harness(clock, { fail: want => want.body === "male" });
    const a = wantOf("s1", "v1", "female"), b = wantOf("s1", "v1", "male");
    h.want(a); await clock.advance(200);
    const toB = h.want(b);
    await clock.advance(400);
    expect(await toB).toBe("failed:The male head couldn't be read.");
    expect(h.residency.shown()?.key).toBe(a.key);
    expect(h.residency.pending()).toBeUndefined();
  });

  test("a runtime that can't be shown goes, and the one shown before is shown again", async () => {
    const shown: string[] = [], disposed: string[] = [];
    const residency = new SceneResidency<Want, string>({
      build: async want => want.key,
      show: runtime => { if (runtime.includes("broken")) throw Error("The head couldn't be connected."); shown.push(runtime); },
      hide: () => {}, dispose: runtime => disposed.push(runtime),
    });
    await residency.want(wantOf("s1", "v1", "female"));
    await expect(residency.want(wantOf("s1", "broken", "female"))).rejects.toThrow("couldn't be connected");
    expect(residency.shown()).toBe("s1|v1|female");
    expect(shown).toEqual(["s1|v1|female", "s1|v1|female"]);
    expect(disposed).toEqual(["s1|broken|female"]);
  });

  for (const seed of [1, 7, 42, 1234, 99991]) {
    test(`model run (seed ${seed}): random subject and body changes always end on the last choice, nothing superseded is shown, cancels take ≤ 100 ms, warm runtimes are reused`, async () => {
      const clock = new Clock(), random = seeded(seed), h = harness(clock, { warm: 1 });
      const subjects = ["v1", "v2", "v3"], bodies = ["female", "male"] as const;
      let last: Want | undefined;
      const outcomes: Promise<string>[] = [];
      for (let step = 0; step < 60; step++) {
        const target = wantOf("s1", subjects[Math.floor(random() * subjects.length)]!, bodies[Math.floor(random() * 2)]!);
        const warmBefore = h.residency.snapshot().residents.some(item => item.key === target.key && item.state === "warm");
        const builtBefore = h.built.length;
        outcomes.push(h.want(target));
        last = target;
        if (warmBefore) {
          // Reused at once: shown with no build.
          expect(h.residency.shown()?.key).toBe(target.key);
          expect(h.built.length).toBe(builtBefore);
        }
        await clock.advance(Math.floor(random() * 120));
        const snapshot = h.residency.snapshot();
        expect(snapshot.residents.filter(item => item.state === "shown").length).toBeLessThanOrEqual(1);
        expect(snapshot.residents.filter(item => item.state === "warm").length).toBeLessThanOrEqual(1);
      }
      await clock.advance(1000);
      expect(h.residency.shown()?.key).toBe(last!.key);
      expect(await outcomes.at(-1)).toBe("shown");
      // Every want was either shown or superseded (a check failing inside the port's `show` would surface here as a failure).
      expect((await Promise.all(outcomes)).filter(outcome => outcome !== "shown" && outcome !== "superseded")).toEqual([]);
      for (const latency of h.cancels) expect(latency).toBeLessThanOrEqual(100);
      // Every runtime shown was the newest want when it was shown (checked in `show`); every one built is resident or disposed once.
      h.residency.dispose();
      expect(h.built.every(runtime => runtime.disposed === 1)).toBe(true);
    });
  }
});

/** A residency whose runtimes are built, then prepared in clock steps that check their signal and report their stages (4a-v). */
function preparing(clock: Clock, options: { warm?: number; prepareSteps?: number; fail?: boolean; stale?: Set<string> } = {}) {
  const log: string[] = [], reports: string[] = [], states: PreparationState[] = [], cancels: number[] = [];
  let next = 0;
  const steps = options.prepareSteps ?? 4;
  const residency = new SceneResidency<Want, Runtime>({
    build: async (want, signal, progress) => {
      progress({ stage: "build", fraction: 0 });
      await clock.sleep(20);
      if (signal.aborted) throw signal.reason;
      progress({ stage: "build", fraction: 1 });
      log.push(`built:${want.key}`);
      return { id: ++next, key: want.key, disposed: 0, shown: false };
    },
    prepare: async (runtime, want, signal, progress) => {
      log.push(`prepare:${want.key}`);
      const stages = ["details", "programs", "textures", "warm-up"] as const;
      for (let step = 0; step < steps; step++) {
        progress({ stage: stages[step % stages.length]!, fraction: 0.5, waiting: step === 1 ? "driver" : null });
        await clock.sleep(25);
        if (signal.aborted) {
          cancels.push(clock.now - (signal as AbortSignal & { abortedAt?: number }).abortedAt!);
          log.push(`prepare-stopped:${want.key}`);
          throw signal.reason;
        }
        // A step that reports an earlier stage again never moves the state back.
        progress({ stage: "details", fraction: 0 });
      }
      if (options.fail) throw Error("The driver lost a program.");
      log.push(`prepared:${runtime.key}`);
    },
    prepared: runtime => !options.stale?.has(runtime.key),
    show: runtime => { runtime.shown = true; log.push(`show:${runtime.key}`); },
    hide: runtime => { runtime.shown = false; log.push(`hide:${runtime.key}`); },
    dispose: runtime => { runtime.disposed++; log.push(`dispose:${runtime.key}`); },
  }, { warm: options.warm });
  residency.subscribe(() => {
    const state = residency.preparation();
    if (state) { states.push(state); reports.push(`${state.key}:${state.stage}:${state.fraction.toFixed(3)}:${state.waiting ?? "-"}`); }
  });
  const want = (target: Want) => {
    const building = (residency as unknown as { building: { controller: AbortController } | null }).building;
    if (building) {
      const signal = building.controller.signal as AbortSignal & { abortedAt?: number };
      signal.addEventListener("abort", () => { signal.abortedAt = clock.now; }, { once: true });
    }
    return residency.want(target).then(() => "shown", (error: Error) => error.name === "AbortError" ? "superseded" : `failed:${error.message}`);
  };
  return { residency, log, reports, states, cancels, want };
}

describe("prepared before shown, with typed progress (4a-v T1)", () => {
  test("the previous runtime stays shown until the new one is built and prepared; progress is typed, monotonic and ends", async () => {
    const clock = new Clock(), h = preparing(clock);
    const a = wantOf("s1", "v1", "female"), b = wantOf("s1", "v1", "male");
    h.want(a); await clock.advance(300);
    expect(h.residency.shown()?.key).toBe(a.key);
    const toB = h.want(b);
    await clock.advance(60);
    // B is built and preparing; A is still the one shown.
    expect(h.residency.shown()?.key).toBe(a.key);
    expect(h.residency.snapshot().preparation).toMatchObject({ key: b.key, warm: false });
    expect(["details", "programs"]).toContain(h.residency.preparation()!.stage);
    await clock.advance(300);
    expect(await toB).toBe("shown");
    expect(h.log.slice(-4)).toEqual([`prepare:${b.key}`, `prepared:${b.key}`, `hide:${a.key}`, `show:${b.key}`]);
    expect(h.residency.preparation()).toBeNull();
    // Each want's fraction only grows, its stages never go back, and a driver wait is said while it lasts.
    for (const key of [a.key, b.key]) {
      const states = h.states.filter(state => state.key === key);
      const order = ["core", "build", "details", "programs", "textures", "warm-up"];
      for (let i = 1; i < states.length; i++) {
        expect(states[i]!.fraction).toBeGreaterThanOrEqual(states[i - 1]!.fraction);
        expect(order.indexOf(states[i]!.stage)).toBeGreaterThanOrEqual(order.indexOf(states[i - 1]!.stage));
      }
      expect(states.at(-1)!.stage).toBe("warm-up");
      expect(states.some(state => state.waiting === "driver")).toBe(true);
    }
  });

  test("a want superseded while it prepares stops within 100 ms, is disposed and never shown; its late reports are ignored", async () => {
    const clock = new Clock(), h = preparing(clock, { prepareSteps: 8 });
    const a = wantOf("s1", "v1", "female"), b = wantOf("s1", "v2", "female"), c = wantOf("s1", "v3", "female");
    h.want(a); await clock.advance(400);
    const toB = h.want(b);
    await clock.advance(70);
    expect(h.log.at(-1)).toBe(`prepare:${b.key}`);
    const toC = h.want(c);
    await clock.advance(10);
    // C is in flight now: no state of B's is published after the supersession.
    expect(h.residency.preparation()?.key).toBe(c.key);
    const reportsAfter = h.reports.length;
    await clock.advance(600);
    expect([await toB, await toC]).toEqual(["superseded", "shown"]);
    expect(h.reports.slice(reportsAfter).every(line => line.startsWith(c.key))).toBe(true);
    expect(h.log).toContain(`prepare-stopped:${b.key}`);
    expect(h.log).toContain(`dispose:${b.key}`);
    expect(h.log.filter(line => line === `show:${b.key}`)).toEqual([]);
    expect(h.cancels.length).toBe(1);
    expect(h.cancels[0]).toBeLessThanOrEqual(100);
  });

  test("a warm runtime still prepared is shown at once; one that needs preparing again is prepared first and stays warm when superseded", async () => {
    const clock = new Clock(), stale = new Set<string>(), h = preparing(clock, { stale });
    const a = wantOf("s1", "v1", "female"), b = wantOf("s1", "v1", "male");
    h.want(a); await clock.advance(300);
    h.want(b); await clock.advance(300);
    // Back to A, still prepared: shown in the same turn, no build and no preparation.
    const before = h.log.length;
    const toA = h.want(a);
    expect(h.residency.shown()?.key).toBe(a.key);
    expect(await toA).toBe("shown");
    expect(h.log.slice(before)).toEqual([`hide:${b.key}`, `show:${a.key}`]);
    // B's lighting changed while it was warm: it is prepared again (no build), with A still shown, and only then shown.
    stale.add(b.key);
    const toB = h.want(b);
    await clock.advance(30);
    expect(h.residency.shown()?.key).toBe(a.key);
    expect(h.residency.preparation()).toMatchObject({ key: b.key, warm: true });
    expect(h.residency.preparation()!.stage).not.toBe("build");
    // Superseded by A again: B stops preparing, stays warm (not disposed), and A stays shown.
    const back = h.want(a);
    await clock.advance(100);
    expect(await back).toBe("shown");
    expect(await toB).toBe("superseded");
    expect(h.residency.snapshot().residents.map(item => `${item.key}:${item.state}`)).toEqual([`${a.key}:shown`, `${b.key}:warm`]);
    expect(h.log.filter(line => line === `dispose:${b.key}`)).toEqual([]);
    expect(h.log.filter(line => line === `built:${b.key}`).length).toBe(1);
    // Wanted again and left to finish: prepared, then shown.
    const again = h.want(b);
    await clock.advance(300);
    expect(await again).toBe("shown");
    expect(h.log.slice(-3)).toEqual([`prepared:${b.key}`, `hide:${a.key}`, `show:${b.key}`]);
  });

  test("a preparation that fails (not an abort) still shows the runtime: preparing is work ahead, never a reason to lose the want", async () => {
    const clock = new Clock(), h = preparing(clock, { fail: true });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const a = wantOf("s1", "v1", "female");
      const toA = h.want(a);
      await clock.advance(300);
      expect(await toA).toBe("shown");
      expect(h.residency.shown()?.key).toBe(a.key);
    } finally { console.warn = warn; }
  });

  test("evicting or losing a warm runtime that is being prepared again stops its preparation first", async () => {
    const clock = new Clock(), stale = new Set<string>(), h = preparing(clock, { stale, prepareSteps: 8 });
    const a = wantOf("s1", "v1", "female"), b = wantOf("s1", "v1", "male");
    h.want(a); await clock.advance(400);
    h.want(b); await clock.advance(400);
    stale.add(a.key);
    const toA = h.want(a);
    await clock.advance(30);
    h.residency.contextLost();
    await clock.advance(100);
    expect(await toA).toBe("superseded");
    expect(h.residency.preparation()).toBeNull();
    expect(h.log).toContain(`dispose:${a.key}`);
    expect(h.residency.shown()?.key).toBe(b.key);
  });
});

describe("the shown runtime prepared again for a change it isn't prepared for (refresh, profiles phase 4a-v-b)", () => {
  /** Runtimes that are asked for a change (`needs`, a generation) and prepared for one (`prepared`) while shown, in three steps of 20 ms. */
  type Shown = { key: string; needs: number; prepared: number; shown: boolean };
  function shownHarness(clock: Clock) {
    const log: string[] = [];
    const residency = new SceneResidency<Want, Shown>({
      build: async want => { await clock.sleep(10); return { key: want.key, needs: 0, prepared: 0, shown: false }; },
      prepared: runtime => runtime.prepared >= runtime.needs,
      prepareShown: async (runtime, _want, signal, progress) => {
        const target = runtime.needs;
        log.push(`prepare:${runtime.key}:${target}`);
        for (const stage of ["programs", "textures", "warm-up"] as const) {
          progress({ stage, fraction: 0.5 });
          await clock.sleep(20);
          if (signal.aborted) { log.push(`stopped:${target}`); throw signal.reason; }
        }
        runtime.prepared = target;
        log.push(`ready:${target}`);
      },
      show: runtime => { runtime.shown = true; log.push(`show:${runtime.key}`); },
      hide: runtime => { runtime.shown = false; log.push(`hide:${runtime.key}`); },
      dispose: runtime => { log.push(`dispose:${runtime.key}`); },
    });
    return { residency, log };
  }

  test("it is prepared while it stays shown, its progress says it is the shown one's, and a newer change restarts it", async () => {
    const clock = new Clock(), { residency, log } = shownHarness(clock);
    const a = wantOf("s1", "v1", "female");
    const showing = residency.want(a);
    await clock.advance(20);
    const runtime = await showing;
    // Prepared for everything asked: nothing to do.
    await residency.refresh();
    expect(log.some(entry => entry.startsWith("prepare"))).toBe(false);
    runtime.needs = 1;
    const first = residency.refresh().then(() => "ready", (error: Error) => error.name);
    await clock.advance(25);
    expect(residency.shown()).toBe(runtime);
    expect(runtime.shown).toBe(true);
    expect(residency.preparation()).toMatchObject({ key: a.key, change: "shown", warm: true, stage: "textures" });
    // A newer change while it is prepared: the preparation in flight stops, and the newest is prepared.
    runtime.needs = 2;
    const second = residency.refresh();
    await clock.advance(100);
    expect(await first).toBe("AbortError");
    await second;
    expect(runtime.prepared).toBe(2);
    expect(residency.preparation()).toBeNull();
    // It was never hidden or shown again.
    expect(log.filter(entry => entry.startsWith("show") || entry.startsWith("hide"))).toEqual([`show:${a.key}`]);
    expect(log).toContain("stopped:1");
  });

  test("a want for another runtime supersedes it; asked while another runtime is wanted, it waits; back to what is prepared, it stops", async () => {
    const clock = new Clock(), { residency, log } = shownHarness(clock);
    const a = wantOf("s1", "v1", "female"), b = wantOf("s1", "v2", "female");
    const showing = residency.want(a);
    await clock.advance(20);
    const runtime = await showing;
    runtime.needs = 1;
    const refreshing = residency.refresh().then(() => "ready", (error: Error) => error.name);
    await clock.advance(5);
    // Another runtime wanted: the shown one's preparation stops (it is about to be hidden).
    const toB = residency.want(b);
    expect(residency.preparation()).toMatchObject({ key: b.key, change: "subject" });
    // Asked again while B is built: nothing starts (A is hidden once B is shown, and takes its change at once then).
    await residency.refresh();
    expect(residency.preparation()?.key).toBe(b.key);
    await clock.advance(30);
    expect(await refreshing).toBe("AbortError");
    await toB;
    // B shown; A warm. Its change back to what it was prepared for: a preparation in flight stops, and nothing is prepared.
    const runtimeB = residency.shown()!;
    runtimeB.needs = 1;
    const again = residency.refresh().then(() => "ready", (error: Error) => error.name);
    await clock.advance(10);
    runtimeB.needs = 0;
    await residency.refresh();
    await clock.advance(30);
    expect(await again).toBe("AbortError");
    expect(residency.preparation()).toBeNull();
    expect(runtimeB.prepared).toBe(0);
    expect(log.filter(entry => entry.startsWith("show"))).toEqual([`show:${a.key}`, `show:${b.key}`]);
  });
});
