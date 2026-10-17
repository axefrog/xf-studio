import { expect, test } from "bun:test";
import { Aborter, MemoryStore } from "strata";
import { Scheduler, seededRandom, simClock, settle } from "strata/testing";
import { createExperiments, experimentOverrides } from "../src/platform/core/experiments";
import { featureId } from "../src/platform/api";
import type { ExperimentRegistration } from "../src/platform/api/experiments";

const registration: ExperimentRegistration = {
  module: { id: "hair-lab", label: "Hair Lab", icon: "character", group: "character", stage: "dev", shownByDefault: true, description: "Test" },
  service: { module: "hair-lab", capability: () => ({ available: true }), dispatch: async () => ({ ok: true }), subscribe: () => () => {} },
  renderer: { feature: featureId("hair-lab"), create: () => ({ dispose() {} }) },
};
const sources = () => ({ clock: simClock(new Scheduler()), random: seededRandom(19) });
test("Hair Lab model: strict isolated override, unknown and duplicate flags ignored", () => {
  expect(experimentOverrides("?experiment.hair-lab=1", ["hair-lab"])).toEqual({});
  expect(experimentOverrides("?verify=1&experiment.hair-lab=1&experiment.unknown=1", ["hair-lab"], true)).toEqual({ "hair-lab": true });
  expect(experimentOverrides("?verify=1&experiment.hair-lab=true", ["hair-lab"], true)).toEqual({});
  expect(experimentOverrides("?verify=1&experiment.hair-lab=1&experiment.hair-lab=0", ["hair-lab"], true)).toEqual({});
});
test("Hair Lab model: zero flag-off imports, persistence and stale import cancellation", async () => {
  const life = new Aborter(), store = new MemoryStore(); let loads = 0, creates = 0, complete!: (value: { create(): ExperimentRegistration }) => void;
  const platform = await createExperiments<ExperimentRegistration>({ sources: sources(), store, signal: life.signal, overrides: {}, definitions: [{ id: "hair-lab", label: "Hair Lab", description: "Test",
    load: () => { loads++; return new Promise(resolve => { complete = resolve; }); } }] });
  expect(loads).toBe(0); expect(platform.registrations()).toEqual([]);
  await platform.set("hair-lab", true); expect(loads).toBe(1);
  await platform.set("hair-lab", false);
  complete({ create: () => { creates++; return registration; } }); await settle();
  expect(creates).toBe(0); expect(platform.registrations()).toEqual([]);
  life.abort();
  const nextLife = new Aborter();
  const next = await createExperiments({ sources: sources(), store, signal: nextLife.signal, overrides: {}, definitions: [{ id: "hair-lab", label: "Hair Lab", description: "Test", load: async () => { loads++; return { create: () => registration }; } }] });
  expect(next.snapshot()[0].enabled).toBe(false); expect(loads).toBe(1);
  await next.set("hair-lab", true); await settle(); expect(next.registrations()).toHaveLength(1);
  await next.set("hair-lab", false); expect(next.registrations()).toHaveLength(0); nextLife.abort();
});
test("Hair Lab model: overrides never alter persisted preferences, two isolated platforms", async () => {
  const store = new MemoryStore(), life = new Aborter();
  const definitions = [{ id: "hair-lab", label: "Hair Lab", description: "Test", load: async () => ({ create: () => registration }) }];
  const a = await createExperiments({ sources: sources(), store, signal: life.signal, overrides: { "hair-lab": true }, definitions });
  const b = await createExperiments({ sources: sources(), store, signal: life.signal, overrides: {}, definitions });
  expect(a.snapshot()[0].enabled).toBe(true); expect(b.snapshot()[0].enabled).toBe(false);
  expect((await a.set("hair-lab", false)).ok).toBe(false); life.abort();
});
