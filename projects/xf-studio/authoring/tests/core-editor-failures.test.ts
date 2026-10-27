/**
 * The four assessment probes at main 4dec2131. These intentionally assert the present failures,
 * not xfail/skip. The fixing slice changes only the corresponding expected message to null;
 * its positive construction gate supplies the behavior assertions. No placeholder facade counts.
 */
import { describe, expect, test } from "bun:test";
import { createTrustedAuthoringCore, type StudioComposition } from "../src/app/trusted-authoring-core";
import { StudioApplication } from "../src/app/studio-application";
import { freshWorkspace, loadWorkspace } from "../src/app/workspace/workspace-state";
import { STUDIO_COMPOSITION, STUDIO_OWNERS } from "../src/compose/studio-registry";
import { emptyRecipe } from "../src/engines/layered-makeup/recipe";
import { Registry } from "../src/platform/core/registry";
import { StudioRuntime } from "../src/studio-ui/runtime";
import type { Port } from "../src/studio-ui/runtime";
import type { Feedback } from "../src/studio-ui/feedback";
import { zeroFeatureComposition } from "./fixtures/editor-composition";

function probe(run: () => unknown, expected: string | null) {
  let failure: string | null = null;
  try { run(); } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  expect(failure).toBe(expected);
}

// The current input still mandates `live` and `region`. Only these negative probes bridge that
// legacy shape; the reusable zero-feature fixture itself imports no makeup code and fabricates none.
function legacyZeroComposition(): StudioComposition {
  const zero = zeroFeatureComposition();
  return { registry: zero.registry, documents: { parts: zero.parts, live: "eye-makeup" }, region: STUDIO_COMPOSITION.region };
}

describe("CORE-03 captured startup failures", () => {
  test("slice 3 flips: cold workspace load dereferences the absent live feature's part", () => {
    probe(() => loadWorkspace({ getItem: () => null }, true, legacyZeroComposition().documents),
      "undefined is not an object (evaluating 'model.parts.feature(model.live).part')");
  });

  test("slice 4 flips: preseeded workspace cannot construct the trusted core without eye makeup", () => {
    probe(() => {
      const core = createTrustedAuthoringCore(freshWorkspace(emptyRecipe()), { resetStack() {}, selectedCollection: () => "draft" }, legacyZeroComposition());
      core.app.dispose(); core.document.dispose();
    }, "The live feature eye-makeup is not a registered feature with gestures.");
  });

  test("slice 5 flips: removing only eye makeup leaves an extra application handler", () => {
    const core = createTrustedAuthoringCore(freshWorkspace(emptyRecipe()), { resetStack() {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
    const registry = new Registry(STUDIO_OWNERS.filter(owner => owner.id !== "eye-makeup"));
    try {
      probe(() => {
        const application = new StudioApplication(core, registry);
        application.dispose();
      }, `Registered owners (${registry.owners().map(owner => owner.id).sort().join(", ")}) do not match the application's handlers (${STUDIO_OWNERS.map(owner => owner.id).sort().join(", ")}).`);
    } finally { core.app.dispose(); core.document.dispose(); }
  });

  test("slice 7 flips: shell runtime reads finishCatalogue from an absent makeup facade", () => {
    // Honest missing feature. The constructor must not need any other port member to reach this probe.
    const port = { authoring: { actionDescriptors: () => ({}) }, feature: () => undefined } as unknown as Port;
    probe(() => new StudioRuntime(port, {} as Feedback),
      "undefined is not an object (evaluating 'this.eyeMakeup.finishCatalogue')");
  });
});
