import { expect, test } from "bun:test";
import { TargetResolver, type TargetResolverDeps } from "../src/app/profiles/targets";
import { FocusService } from "../src/platform/core/focus";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import { studioReadDeps, targetReadBaseline } from "./fixtures/target-read-baseline";

// Alternate order, warm both implementations, and compare medians of batches on this machine. No cross-machine microsecond budget.
function compare(label: string, baseline: () => unknown, live: () => unknown) {
  expect(live()).toEqual(baseline());
  for (let i = 0; i < 100; i++) { baseline(); live(); }
  const batch = (read: () => unknown) => { const start = performance.now(); for (let i = 0; i < 100; i++) read(); return (performance.now() - start) * 10; };
  const before: number[] = [], after: number[] = [];
  for (let i = 0; i < 15; i++) {
    if (i % 2) { after.push(batch(live)); before.push(batch(baseline)); }
    else { before.push(batch(baseline)); after.push(batch(live)); }
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]!;
  const base = median(before), actual = median(after);
  console.log(`target reads ${label}: baseline ${base.toFixed(2)} us, live ${actual.toFixed(2)} us, ${(actual / base).toFixed(2)}x`);
  return actual / base;
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
  expect(compare("30 views named", () => baseline.named("presets"), () => targets.named("presets"))).toBeLessThan(1.5);
});
