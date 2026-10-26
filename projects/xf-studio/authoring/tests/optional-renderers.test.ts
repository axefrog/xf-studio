import { expect, test } from "bun:test";
import type { FeatureRendererFactory } from "../src/platform/api/scene";
import { followOptionalRenderers } from "../src/platform/scene/optional-renderers";

const source = () => {
  let wanted: FeatureRendererFactory[] = [];
  const listeners = new Set<() => void>();
  return {
    registrations: () => wanted.map(renderer => ({ renderer })) as never,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next: FeatureRendererFactory[]) { wanted = next; for (const listener of [...listeners]) listener(); },
    notify() { for (const listener of [...listeners]) listener(); },
  };
};
const factory = (name: string) => ({ feature: name }) as unknown as FeatureRendererFactory;

test("a renderer whose creation notifies the experiments is registered once, not again and again", () => {
  const experiments = source(), hair = factory("hair-lab");
  let created = 0;
  experiments.set([hair]);
  const release = followOptionalRenderers(experiments, () => {
    created++;
    if (created > 5) throw new Error("registered again while being created");
    experiments.notify(); // creating Hair Lab's renderer binds it, which notifies the experiments
  });
  expect(created).toBe(1);
  experiments.notify();
  expect(created).toBe(1);
  release();
});

test("an unwanted renderer is withdrawn, a wanted one comes back, and release withdraws everything", () => {
  const experiments = source(), hair = factory("hair-lab");
  const signals: AbortSignal[] = [];
  experiments.set([hair]);
  const release = followOptionalRenderers(experiments, (_, signal) => { signals.push(signal); });
  expect(signals.length).toBe(1);
  experiments.set([]);
  expect(signals[0].aborted).toBe(true);
  experiments.set([hair]);
  expect(signals.length).toBe(2);
  release();
  expect(signals[1].aborted).toBe(true);
  experiments.set([]);
  experiments.set([hair]);
  expect(signals.length).toBe(2);
});

test("PREV-247: failed initial reconciliation releases earlier registrations and its subscription", () => {
  const experiments = source(), hair = factory("hair-lab"), broken = factory("broken");
  let attempts = 0;
  const signals: AbortSignal[] = [];
  experiments.set([hair, broken]);
  expect(() => followOptionalRenderers(experiments, (item, signal) => {
    attempts++; signals.push(signal); if (item === broken) throw new Error("no GPU");
  })).toThrow("no GPU");
  expect(signals.every(signal => signal.aborted)).toBe(true);
  expect(() => experiments.notify()).not.toThrow();
  experiments.set([]); experiments.set([hair]);
  expect(attempts).toBe(2);
});
