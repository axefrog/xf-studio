/**
 * S1 fixture, through the Studio's real path (phase 1, chunk 1d-ii on): the large workspace fixture's first look (16 layers) shown by the
 * look editor and edited by real dispatches until its Undo history is full (80 steps, the most a look keeps), then read back from the
 * library as the look's working-copy document (`look-working`, the value the outbox writes on every commit).
 *   bun tools/look-fixture.ts <out-dir> [layers=16]
 * Writes look-<layers>x80.json (the document's value) and prints its size and the main-thread cost of an edit, recording included.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { livePart } from "../../../projects/xf-studio/authoring/src/app/workspace/makeup-workspace";
import { STUDIO_DOCUMENTS } from "../../../projects/xf-studio/authoring/src/compose/studio-registry";
import { lookRef } from "../../../projects/xf-studio/authoring/src/library/collection-documents";
import { documentKey } from "../../../projects/xf-studio/authoring/src/platform/api/document-commands";
import { profileStudio } from "../../../projects/xf-studio/authoring/tests/fixtures/profile-studio";
import { restore } from "../../../projects/xf-studio/authoring/tests/fixtures/workspace-observable";
import { largeWorkspaceV1 } from "../../../projects/xf-studio/authoring/tests/fixtures/workspace-v1-fixtures";
import { percentile } from "./kit";

const [out, layerArg] = process.argv.slice(2);
if (!out) throw Error("Usage: bun tools/look-fixture.ts <out-dir> [layers=16]");
const layers = Number(layerArg ?? 16);
const state = restore(largeWorkspaceV1(layers, 80)).state;
const look = state.collections!.collection.presets[0]!;
const studio = await profileStudio({ looks: [{ name: look.name, recipe: livePart(look, STUDIO_DOCUMENTS)! }] });
await studio.collection.initialize();
const layer = () => studio.document.recipe.layers[1]!.id;
const edit: number[] = [];
for (let i = 0; i < 200; i++) {
  const start = performance.now();
  studio.app.dispatch({ kind: "layer.setOpacity", layerId: layer(), opacity: (i % 90) / 100 + .05 });
  edit.push(performance.now() - start);
}
await studio.settle();
const ref = lookRef(studio.scene.look()!), value = studio.library.documents.read([ref])[documentKey(ref)]!.value as { parts?: unknown; memory?: unknown };
writeFileSync(join(out, `look-${layers}x80.json`), JSON.stringify(value));
const ms = (values: number[]) => ({ p50: +percentile(values, 50).toFixed(3), p95: +percentile(values, 95).toFixed(3), max: +Math.max(...values).toFixed(3) });
console.log(JSON.stringify({ layers, historySteps: studio.app.history(studio.document.scopeId).depth, units: JSON.stringify(value).length,
  memoryUnits: JSON.stringify(value.memory ?? null).length, editMs: ms(edit) }));
process.exit(0);
