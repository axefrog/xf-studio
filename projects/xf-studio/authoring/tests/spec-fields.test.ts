/**
 * Input limits, units and consequences come from the action specs (feature-module platform §1, §4,
 * step 5): `spec.units` and the feature's `spec.limits`, and `spec.consequence` on top of the generic
 * rule. The golden was captured before the move from `action-limits.ts` and `action-consequences.ts`
 * (`tests/fixtures/capture-spec-fields-golden.ts`); every observation must match it.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { EYE_MAKEUP } from "../src/features/eye-makeup";
import { observeSpecFields } from "./fixtures/spec-fields";

test("limits, units and consequences through the port equal the pre-move golden in every state", () => {
  const golden = JSON.parse(readFileSync(new URL("./golden/spec-fields.json", import.meta.url), "utf8"));
  expect(observeSpecFields()).toEqual(golden.states);
});

test("units, limits and consequence overrides are spec fields; the hand-kept tables are gone", () => {
  // Eye makeup's state-dependent limits and destructive-edit override live on its specs.
  expect(EYE_MAKEUP.actions["glitter.setIrregular"].limits).toBeFunction();
  expect(EYE_MAKEUP.actions["layer.setOpacity"].units).toEqual({ opacity: "fraction" });
  const consequence = (kind: keyof typeof EYE_MAKEUP.actions) => EYE_MAKEUP.actions[kind].consequence as ((action: unknown) => unknown) | undefined;
  expect(consequence("point.remove")?.({ kind: "point.remove", layerId: "a", index: 0 })).toEqual({ replaces: "layer-content" });
  expect(consequence("layer.edit")?.({ kind: "layer.edit", command: { kind: "duplicate", id: "a" } })).toBeUndefined();
  // System families carry units too.
  const route = STUDIO_REGISTRY.route("camera.setFov");
  expect(route.ok && route.spec.units).toEqual({ degrees: "degrees" });
  // The retired tables are gone.
  expect(() => readFileSync(new URL("../src/action-limits.ts", import.meta.url))).toThrow();
});
