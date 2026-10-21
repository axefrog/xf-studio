/**
 * Cost of the View and lighting history during a lighting-slider drag (one coalesced step per drag, CORE-95) and the size of one
 * Hair Lab groom history step, through interfaces that exist before and after the history service, so the same script runs on both:
 *   bun tests/fixtures/bench-view-history.ts
 * Prints medians in milliseconds and sizes in UTF-16 code units.
 */
import { MAIN_VIEW } from "../../src/platform/api/view-graph";
import { createStudioViewGraph } from "../../src/preview-view-graph";
import { DEFAULT_CREATOR_LIGHTING } from "../../src/creator-lighting";
import { defaultGroom } from "../../src/features/hair-lab/groom";
import { constant } from "../../src/features/hair-lab/fields";
import type { HeadSurface } from "../../src/features/hair-lab/types";
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

// A groom as Hair Lab stores it, on a synthetic head of about a real head's vertex count.
function sphere(n: number, m: number): HeadSurface {
  const positions: number[] = [], indices: number[] = [], uv: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= m; i++) {
    const p = Math.PI * j / n, a = 2 * Math.PI * i / m;
    positions.push(.09 * Math.sin(p) * Math.cos(a), .12 * Math.cos(p), .10 * Math.sin(p) * Math.sin(a)); uv.push(i / m, j / n);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < m; i++) { const a = j * (m + 1) + i, b = a + m + 1; indices.push(a, a + 1, b, a + 1, b + 1, b); }
  return { resource: "synthetic-head", topology: `sphere-${n}-${m}`, revision: "1", positions, indices, uv, down: [0, -1, 0], capsules: [] };
}
const groom = defaultGroom(sphere(100, 100));
results.groomVertices = 101 * 101;
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
