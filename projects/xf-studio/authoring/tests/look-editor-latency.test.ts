/**
 * Profiles phase 1d-ii's latency gate for edits (profiles design §9.2, S1's budget): writing the shown look after an edit costs the main
 * thread at most 4 ms (p95) on the largest look a person makes (16 layers with a full 80-step Undo history), outbox write included, and an
 * edit itself never waits for it (the look is written shortly after the document settles).
 */
import { expect, test } from "bun:test";
import { restore } from "./fixtures/workspace-observable";
import { largeWorkspaceV1 } from "./fixtures/workspace-v1-fixtures";
import { profileStudio } from "./fixtures/profile-studio";
import { livePart } from "../src/app/workspace/collection-workspace";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)]!;

test("an edit costs no look write; writing the look after it stays within 4 ms at p95 (16 layers, 80 Undo steps)", async () => {
  const state = restore(largeWorkspaceV1(16, 80)).state;
  const look = state.collections!.collection.presets[0]!;
  const studio = await profileStudio({ looks: [{ name: look.name, recipe: livePart(look, STUDIO_DOCUMENTS)! }] });
  await studio.collection.initialize();
  const layer = () => studio.document.recipe.layers[0]!.id;
  // A full history: 80 steps, as the look gets after an evening's edits.
  for (let i = 0; i < 80; i++) studio.app.dispatch({ kind: "layer.setOpacity", layerId: layer(), opacity: (i % 50) / 100 + 0.3 });
  studio.lookEditor.commit();
  await studio.settle();
  const edits: number[] = [], writes: number[] = [];
  for (let i = 0; i < 60; i++) {
    let start = performance.now();
    studio.app.dispatch({ kind: "layer.setOpacity", layerId: layer(), opacity: (i % 40) / 100 + 0.4 });
    edits.push(performance.now() - start);
    start = performance.now();
    expect(studio.lookEditor.commit()).toBe(true);
    writes.push(performance.now() - start);
  }
  const size = JSON.stringify(studio.owner.look(studio.scene.look()!)).length;
  console.log(`look ${size} UTF-16 units; edit p95 ${p95(edits).toFixed(2)} ms; look write p95 ${p95(writes).toFixed(2)} ms`);
  expect(studio.app.history().depth).toBe(80);
  expect(p95(writes)).toBeLessThan(4);
  await studio.settle();
});
