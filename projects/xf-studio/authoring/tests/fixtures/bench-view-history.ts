/**
 * Cost of the View and lighting history during a lighting-slider drag (one coalesced step per drag, CORE-95) and the size of one
 * large experiment document's history step, through interfaces that exist before and after the history service, so the same script runs on both:
 *   bun tests/fixtures/bench-view-history.ts
 * Prints medians in milliseconds and sizes in UTF-16 code units.
 */
import { MAIN_VIEW } from "../../src/platform/api/view-graph";
import { createStudioViewGraph } from "../../src/preview-view-graph";
import { DEFAULT_CREATOR_LIGHTING } from "../../src/creator-lighting";
import { createDocumentHistory } from "../../src/platform/core/document-history";
import { freshWorkspace } from "./eye-region";

const median = (runs: number, work: () => void) => {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) { const start = performance.now(); work(); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(times.length / 2)] * 1000) / 1000;
};
const frames = Number(process.argv[2] ?? 600);
const results: Record<string, number> = {};
const views = createStudioViewGraph(freshWorkspace().preview);
const exposure = (value: number) => ({ state: { creatorLighting: { ...DEFAULT_CREATOR_LIGHTING, exposure: value } } });
let turn = 0;
// One drag: `frames` slider frames coalesced into one step, then the release.
const drag = () => {
  turn++;
  for (let i = 0; i < frames; i++) views.edit(MAIN_VIEW, "lights", exposure(1 + ((turn + i) % 200) / 100), { label: "Exposure", coalesce: "exposure" });
  views.seal();
};
for (let i = 0; i < 5; i++) drag();
results.dragFrames = frames;
results.drag = median(21, drag);
results.perFrameMicros = Math.round(results.drag / frames * 1000 * 100) / 100;
// The same frames without recording (the graph's own edit cost), to separate the history's share.
const plain = () => { turn++; for (let i = 0; i < frames; i++) views.edit(MAIN_VIEW, "lights", exposure(1 + ((turn + i) % 200) / 100)); };
results.unrecorded = median(21, plain);
results.undoRedo = median(51, () => { views.undo(); views.redo(); });

// A large experiment document (about a Hair Lab groom's size: fields plus a scalp of about 10,000 vertices).
const constant = (value: number, unit: string) => ({ kind: "constant", value, unit });
const scalp = Array.from({ length: 101 * 101 }, (_, i) => [Math.sin(i) * .09, Math.cos(i) * .12, Math.sin(i * .5) * .1, i % 101 / 100, Math.floor(i / 101) / 100]);
const groom = { schema: "bench/document-1", scalp, fields: { length: constant(.5, "m"), waves: constant(.01, "m"), spread: constant(.04, "m") } };
results.groomVertices = scalp.length;
results.groomUnits = JSON.stringify(groom).length;
const edited = { ...groom, fields: { ...groom.fields, length: constant(.6, "m") } };
results.groomEditedFieldUnits = JSON.stringify(edited.fields).length;
// Recording and moving through a groom's document history (Hair Lab's flow: record each edit, then Undo and Redo).
const book = createDocumentHistory();
let value: typeof groom = groom, n = 0;
results.groomRecord = median(51, () => {
  const next = { ...value, fields: { ...value.fields, length: constant(.1 + (++n % 70) / 100, "m") } };
  book.record("hair:g", "Hair Lab", { id: `s${n}`, label: "Hair length", actionKind: "hairLab.set" }, { before: value, after: next }); value = next;
});
results.groomUndoRedo = median(51, () => { const t = book.snapshot("hair:g"); book.move("hair:g", t.current - 1); book.move("hair:g", t.current); });
console.log(JSON.stringify(results, null, 1));
