/**
 * Profiles phase 1d-ii's latency gate for edits (profiles design §9.2, S1's budget): every change of the shown look is recorded in the
 * outbox as it is made (`look.update`, stored within `STORE_SOON_MS`), so an edit, recording included, costs the main thread at most 4 ms
 * (p95) on the largest look a person makes (16 layers with a full 80-step Undo history), and so does each frame of a drag. Storing the
 * look's key is one write per interval, measured on its own.
 */
import { expect, test } from "bun:test";
import { restore } from "./fixtures/workspace-observable";
import { largeWorkspaceV1 } from "./fixtures/workspace-v1-fixtures";
import { profileStudio } from "./fixtures/profile-studio";
import { livePart } from "../src/app/workspace/collection-workspace";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)]!;

test("an edit and each frame of a drag, recording included, stay within 4 ms at p95; storing is one write per interval (16 layers, 80 Undo steps)", async () => {
  const state = restore(largeWorkspaceV1(16, 80)).state;
  const look = state.collections!.collection.presets[0]!;
  const studio = await profileStudio({ looks: [{ name: look.name, recipe: livePart(look, STUDIO_DOCUMENTS)! }] });
  await studio.collection.initialize();
  const layer = () => studio.document.recipe.layers[0]!.id;
  // A full history: 80 steps, as the look gets after an evening's edits.
  for (let i = 0; i < 80; i++) studio.app.dispatch({ kind: "layer.setOpacity", layerId: layer(), opacity: (i % 50) / 100 + 0.3 });
  await studio.settle();
  const edits: number[] = [], frames: number[] = [], stores: number[] = [];
  for (let i = 0; i < 60; i++) {
    let start = performance.now();
    studio.app.dispatch({ kind: "layer.setOpacity", layerId: layer(), opacity: (i % 40) / 100 + 0.4 });
    edits.push(performance.now() - start);
    // A drag's frame: the layer changes in place and the document publishes it (as a gesture does), recorded as it is made.
    start = performance.now();
    const recipe = studio.document.recipe, first = recipe.layers[0]!;
    first.opacity = (i % 30) / 100 + 0.5;
    studio.document.gestureChanged(0, "opacity");
    frames.push(performance.now() - start);
    // The interval ends (or a flush): the look's key is stored.
    start = performance.now();
    studio.outbox.store();
    stores.push(performance.now() - start);
  }
  const size = JSON.stringify(studio.owner.look(studio.scene.look()!)).length;
  console.log(`look ${size} UTF-16 units; edit p95 ${p95(edits).toFixed(2)} ms; drag frame p95 ${p95(frames).toFixed(2)} ms; store p95 ${p95(stores).toFixed(2)} ms`);
  expect(studio.app.history().depth).toBe(80);
  // Every change reached the outbox as it was made.
  expect(studio.outbox.document({ kind: "look-working", id: `${studio.scene.look()!.collection}/${studio.scene.look()!.look}` })).toBeTruthy();
  expect(p95(edits)).toBeLessThan(4);
  expect(p95(frames)).toBeLessThan(4);
  expect(p95(stores)).toBeLessThan(4);
  await studio.settle();
});
