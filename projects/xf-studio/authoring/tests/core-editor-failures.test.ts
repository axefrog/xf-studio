/**
 * The four assessment probes at main 4dec2131. These intentionally assert the present failures,
 * not xfail/skip. The fixing slice changes only the corresponding expected failure to null;
 * its positive construction gate supplies the behavior assertions. No placeholder facade counts.
 */
import { describe, expect, test } from "bun:test";
import { createAuthoringEditing, createTrustedAuthoringCore, type StudioComposition } from "../src/app/trusted-authoring-core";
import { StudioApplication } from "../src/app/studio-application";
import { loadWorkspace } from "../src/app/workspace/workspace-state";
import { freshWorkspace } from "../src/app/workspace/makeup-workspace";
import { STUDIO_COMPOSITION, STUDIO_OWNERS } from "../src/compose/studio-registry";
import { emptyRecipe } from "../src/engines/layered-makeup/recipe";
import { Registry } from "../src/platform/core/registry";
import { createHistoryService } from "../src/platform/core/history-service";
import { StudioRuntime } from "../src/studio-ui/runtime";
import type { Port } from "../src/studio-ui/runtime";
import type { Feedback } from "../src/studio-ui/feedback";
import { zeroFeatureComposition, syntheticEditorComposition, FIXTURE_LOOK } from "./fixtures/editor-composition";

function probe(run: () => unknown, expected: ErrorConstructor | string | null) {
  let failure: unknown = null;
  try { run(); } catch (error) { failure = error; }
  // Only application-authored diagnostics name their coupling in text; never match VM-generated TypeErrors.
  if (typeof expected === "string") expect(failure).toMatchObject({ message: expected });
  else if (expected) expect(failure).toBeInstanceOf(expected);
  else expect(failure).toBeNull();
}

// The current input still mandates `live` and `region`. Only these negative probes bridge that
// legacy shape; the reusable zero-feature fixture itself imports no makeup code and fabricates none.
function legacyZeroComposition(): StudioComposition {
  const zero = zeroFeatureComposition();
  return { registry: zero.registry, documents: { parts: zero.parts, live: "eye-makeup" }, region: STUDIO_COMPOSITION.region };
}

describe("CORE-03 captured startup failures", () => {
  test("slice 3 resolved: cold workspace load succeeds with an empty feature registry", () => {
    const expected: ErrorConstructor | null = null;
    const { documents } = legacyZeroComposition(), lookups: string[] = [];
    const feature = documents.parts.feature.bind(documents.parts);
    documents.parts.feature = id => { lookups.push(id); return feature(id); };
    probe(() => loadWorkspace({ getItem: () => null }, true, documents), expected);
    if (expected !== null) { expect(lookups).toEqual(["eye-makeup"]); expect(feature("eye-makeup")).toBeUndefined(); }
  });

  test("slice 4 resolved: preseeded neutral editing constructs without eye makeup or an application", () => {
    const expected: ErrorConstructor | null = null;
    for (const fixture of [zeroFeatureComposition(), syntheticEditorComposition()]) {
      const history = createHistoryService(), life = new AbortController();
      try {
        probe(() => createAuthoringEditing({}, { history, signal: life.signal, look: FIXTURE_LOOK, scope: "look:probe/empty" },
          { registry: fixture.registry, documents: { parts: fixture.parts } }), expected);
      } finally { life.abort(); }
    }
  });

  test("slice 5 resolved: removing eye makeup leaves no extra application handler", () => {
    const core = createTrustedAuthoringCore(freshWorkspace(emptyRecipe()), { resetStack() {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
    const registry = new Registry(STUDIO_OWNERS.filter(owner => owner.id !== "eye-makeup"));
    try {
      probe(() => {
        const application = new StudioApplication(core, registry);
        application.dispose();
      }, null);
    } finally { core.app.dispose(); core.document.dispose(); }
  });

  test("slice 7 flips: shell runtime reads finishCatalogue from an absent makeup facade", () => {
    // Honest missing feature. The constructor must not need any other port member to reach this probe.
    const expected: ErrorConstructor | null = TypeError, lookups: string[] = [];
    const port = { authoring: { actionDescriptors: () => ({}) }, feature: (id: string) => { lookups.push(id); return undefined; } } as unknown as Port;
    probe(() => new StudioRuntime(port, {} as Feedback), expected);
    if (expected !== null) expect(lookups).toEqual(["eye-makeup"]);
  });
});
