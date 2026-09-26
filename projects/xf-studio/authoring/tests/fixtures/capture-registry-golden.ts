/**
 * Captures `tests/golden/studio-registry.json` from the code checked out: the action kinds, descriptors and registry of a fresh
 * application. Rerun it only to review a deliberate change (a family added or retired), and read the diff.
 *   bun tests/fixtures/capture-registry-golden.ts
 */
import { writeFileSync } from "node:fs";
import { STUDIO_COMPOSITION } from "../../src/compose/studio-registry";
import { createTrustedAuthoringCore } from "../../src/trusted-authoring-core";
import { freshWorkspace } from "./eye-region";

const { app } = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
const golden = { actionKinds: app.actionKinds(), actionDescriptors: app.actionDescriptors(), registry: app.registry() };
writeFileSync(new URL("../golden/studio-registry.json", import.meta.url), JSON.stringify(golden, null, 1) + "\n");
console.log(`${golden.actionKinds.length} action kinds captured.`);
