/**
 * S1 fixture and the look document's build cost, through the Studio's real core: the large workspace fixture's selected look
 * (16 layers, a full 80-step Undo history, the most a look keeps) edited by real dispatches, its working-copy value built after
 * each committed edit as the library would store it ({ preset, memory } with the look-level history, CORE-39).
 *   bun tools/look-fixture.ts <out-dir> [layers=16]
 * Writes look-<layers>x80.json and prints the build cost per committed edit.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CollectionActions } from "../../../projects/xf-studio/authoring/src/library/collection-actions";
import { withLiveMemory } from "../../../projects/xf-studio/authoring/src/app/workspace/collection-workspace";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../../../projects/xf-studio/authoring/src/compose/studio-registry";
import { createTrustedAuthoringCore } from "../../../projects/xf-studio/authoring/src/app/trusted-authoring-core";
import { restore } from "../../../projects/xf-studio/authoring/tests/fixtures/workspace-observable";
import { largeWorkspaceV1 } from "../../../projects/xf-studio/authoring/tests/fixtures/workspace-v1-fixtures";
import { percentile } from "./kit";

const [out, layerArg] = process.argv.slice(2);
const layers = Number(layerArg ?? 16);
const state = restore(largeWorkspaceV1(layers, 80)).state;
const core = createTrustedAuthoringCore(state, { resetStack: () => {}, selectedCollection: () => "draft", newId: (() => { let n = 0; return () => `b${++n}`; })() },
  STUDIO_COMPOSITION);
const actions = new CollectionActions(STUDIO_DOCUMENTS, state.collections!, () => core.document.export(),
  editor => core.document.restore({ ...editor, fieldSelection: editor.fieldSelection ?? {} }));
const collections = state.collections!;
const id = actions.selected()!;
const parts = STUDIO_DOCUMENTS.parts;
const lookValue = () => {
  const preset = collections.collection.presets.find(look => look.id === id)!;
  return { preset: parts.minimalLook(preset, false),
    memory: parts.writeMemory(withLiveMemory(collections.memory[id], core.document.export(), STUDIO_DOCUMENTS), { lookLevel: true }) };
};
const layerId = core.document.recipe.layers[1].id;
const build: number[] = [], stringify: number[] = [], sizes: number[] = [];
for (let i = 0; i < 200; i++) {
  core.app.dispatch({ kind: "layer.setOpacity", layerId, opacity: (i % 90) / 100 + .05 });
  let t = performance.now();
  const value = lookValue();
  build.push(performance.now() - t);
  t = performance.now();
  const text = JSON.stringify(value);
  stringify.push(performance.now() - t);
  sizes.push(text.length);
}
const value = lookValue();
writeFileSync(join(out, `look-${layers}x80.json`), JSON.stringify(value));
const ms = (values: number[]) => ({ p50: +percentile(values, 50).toFixed(3), p95: +percentile(values, 95).toFixed(3), max: +Math.max(...values).toFixed(3) });
console.log(JSON.stringify({ layers, historySteps: core.app.historyTimeline().steps.length, units: sizes.at(-1),
  presetUnits: JSON.stringify(value.preset).length, memoryUnits: JSON.stringify(value.memory).length, buildMs: ms(build), stringifyMs: ms(stringify) }));
