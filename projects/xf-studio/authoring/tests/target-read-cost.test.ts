import { expect, test } from "bun:test";
import { TargetResolver, type TargetResolverDeps } from "../src/app/profiles/targets";
import { FocusService } from "../src/platform/core/focus";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import { studioReadDeps, targetReadBaseline } from "./fixtures/target-read-baseline";

// Alternate order, warm both implementations, and compare the two on this machine. No cross-machine microsecond budget.
// A read takes 10–100 us, so a batch of 100 lasted about a millisecond and a busy CI runner's bursts moved the median ratio from 0.9x
// to 1.7x. Each batch is sized to target about 2 ms (from one baseline batch), and each side's cost is its fastest batch (pauses only ever add time). A ratio over
// budget is measured again, up to three times: a real regression stays over budget, a burst of load usually doesn't.
function compare(label: string, baseline: () => unknown, live: () => unknown, limit = 1.5) {
  expect(live()).toEqual(baseline());
  for (let i = 0; i < 100; i++) { baseline(); live(); }
  let reads = 100;
  while (reads < 100_000) {
    const start = performance.now();
    for (let i = 0; i < reads; i++) baseline();
    if (performance.now() - start >= 2) break;
    reads *= 2;
  }
  const batch = (read: () => unknown) => { const start = performance.now(); for (let i = 0; i < reads; i++) read(); return (performance.now() - start) * 1000 / reads; };
  const measure = () => {
    let base = Infinity, actual = Infinity;
    for (let i = 0; i < 15; i++) {
      if (i % 2) { actual = Math.min(actual, batch(live)); base = Math.min(base, batch(baseline)); }
      else { base = Math.min(base, batch(baseline)); actual = Math.min(actual, batch(live)); }
    }
    return { base, actual };
  };
  let m = measure();
  for (let attempt = 1; attempt < 3 && m.actual / m.base >= limit; attempt++) m = measure();
  console.log(`target reads ${label}: baseline ${m.base.toFixed(2)} us, live ${m.actual.toFixed(2)} us, ${(m.actual / m.base).toFixed(2)}x (${reads} reads a batch)`);
  return m.actual / m.base;
}

test("live target reads stay close to the c87a734e cost reference (real three-view composition)", async () => {
  const w = await profileContextStudio(), life = new AbortController();
  try {
    const baseline = targetReadBaseline(studioReadDeps(w)), targets = w.targets, panel = "presets--follow", capture = targets.capture(panel, life.signal);
    const ratios = [compare("3 views named", () => baseline.named(panel), () => targets.named(panel)),
      compare("3 views describe", () => baseline.describe(panel), () => targets.describe(panel)),
      compare("3 views current", () => baseline.current(capture), () => targets.current(capture))];
    // Leave room for allocation/host noise, but refuse the repeated copies of the ownership sweep.
    for (const ratio of ratios) expect(ratio).toBeLessThan(1.5);
  } finally { life.abort(); await w.dispose(); }
}, 20000);

test("naming thirty eligible views scales without copying and freezing every chain", () => {
  const views = Array.from({ length: 30 }, (_, i) => ({ id: `v${i}`, scene: `s${i}`, tab: "t" }));
  const scenes = Object.fromEntries(views.map(({ scene }, i) => [scene, { kind: "character", gen: 1,
    subject: { kind: "character", id: `c-${i}` }, look: { collection: "k", look: `l-${i}` } }]));
  const deps: TargetResolverDeps = { session: { tab: () => "t", views: () => views, scene: id => scenes[id], panel: () => ({ type: "presets", tab: "t" }) },
    focus: new FocusService({ seq: 30, views: Object.fromEntries(views.map((v, i) => [v.id, i + 1])) }), acting: () => undefined,
    status: { subject: ref => ({ state: "present", owner: ref }), look: ref => ({ state: "present", owner: { kind: "look", id: ref.look } }) },
    context: () => ({ kind: "look" }) };
  const baseline = targetReadBaseline(deps), targets = new TargetResolver(deps);
  // What this guards is a copy and freeze of every view's chain per read, which costs several times the baseline. The live path's own
  // work sits at 1.1–1.4x locally but 1.47–1.70x on CI's Windows runners (28–29 Oct), so 2x keeps the guard without failing on the runner.
  expect(compare("30 views named", () => baseline.named("presets"), () => targets.named("presets"), 2)).toBeLessThan(2);
});
