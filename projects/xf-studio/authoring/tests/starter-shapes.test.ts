/**
 * Starter shapes (profiles design §6, the second kind of contributed defaults).
 *
 * - **Contributed starters** are valid, symmetric, inside the plate with room for their feather, and placed from the plate's landmarks
 *   (the lash line, the crease, the corners): a wash on the lid, a wing from the outer corner, a crescent on the crease, a smudge under
 *   the lower lash line. "Wing (original)" is exactly what new layers started as before.
 * - **The default** is a choice kept in the workspace that only "Use for new layers" changes; a missing or deleted one falls back to Lid wash.
 * - **Own starters** are saved, renamed, deleted (a tombstone) and restored through the outbox; a conflict keeps both at once.
 * - **A new layer, a reset layer and a new look** start from the default (or the starter named); existing drafts are untouched.
 * - **A read-only window** refuses every starter action and adding a layer, with the window's reason.
 */
import { describe, expect, test } from "bun:test";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { ShapeStarters, STARTER_DOCUMENT, STARTER_SCHEMA, type ShapeStartersDeps } from "../src/app/starters/shape-starters";
import { StarterActions } from "../src/app/starters/starter-actions";
import { curve, MAX_FEATHER, MIN_FEATHER, coverage, type Layer } from "../src/engines/layered-makeup/recipe";
import { layerWithShape, readStarterShape, shapeOfLayer, type StarterShape } from "../src/engines/layered-makeup/starter-shape";
import { editLayers } from "../src/engines/layered-makeup/layer-stack";
import { EYE_MAKEUP_REGION, newLayerTemplate, starterRecipe } from "../src/features/eye-makeup/region";
import { EYE_DEFAULT_STARTER, EYE_LANDMARKS, EYE_STARTERS } from "../src/features/eye-makeup/starters";
import { eyeMakeupMemory } from "../src/features/eye-makeup/part";
import { freshWorkspace, loadWorkspace, serializeWorkspace } from "../src/app/workspace/workspace-state";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { memoryOutboxStorage, storeDocuments } from "./fixtures/platform-doubles";
import { profileStudio, type StudioLookInput } from "./fixtures/profile-studio";
import { initialRecipe } from "./fixtures/eye-region";
import { seededRandom } from "./fixtures/profile-sessions";

const REGION = EYE_MAKEUP_REGION, MODELS = REGION.models;
const starter = (id: string) => EYE_STARTERS.find(item => item.id === id)!;
const tick = () => new Promise(resolve => setTimeout(resolve, 2));
async function quiet(outbox: DocumentOutbox) { for (let i = 0; i < 200 && (outbox.status().pending || outbox.status().failing); i++) await tick(); }
type UV = { u: number; v: number };
const outlineOf = (shape: StarterShape): UV[] => curve(structuredClone(shape.points) as never, 10).map(({ u, v }) => ({ u, v }));
/** The landmark line's v at `u` (linear between its samples). */
function lineAt(line: readonly (readonly [number, number])[], u: number): number {
  const sorted = [...line].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) if (u <= sorted[i]![0]) {
    const [u0, v0] = sorted[i - 1]!, [u1, v1] = sorted[i]!;
    return v0 + (v1 - v0) * (u - u0) / (u1 - u0);
  }
  return sorted.at(-1)![1];
}
/** The outline's lowest (largest v) and highest (smallest v) edge at `u`. */
function spanAt(outline: readonly UV[], u: number): { top: number; bottom: number } | undefined {
  const crossings: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
    if ((a.u <= u && b.u > u) || (b.u <= u && a.u > u)) crossings.push(a.v + (b.v - a.v) * (u - a.u) / (b.u - a.u));
  }
  return crossings.length ? { top: Math.min(...crossings), bottom: Math.max(...crossings) } : undefined;
}
const inside = (outline: readonly UV[], point: UV) => {
  let result = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!, b = outline[j]!;
    if ((a.v > point.v) !== (b.v > point.v) && point.u < (b.u - a.u) * (point.v - a.v) / (b.v - a.v) + a.u) result = !result;
  }
  return result;
};
const L = EYE_LANDMARKS, millimetres = { u: REGION.skin.mmPerUv.u, v: REGION.skin.mmPerUv.v };

describe("the contributed starters", () => {
  test("Eye makeup contributes Lid wash, Classic wing, Crease / smoky, Lower-lash smudge and Wing (original), Lid wash the fallback", () => {
    expect(EYE_STARTERS.map(item => item.name)).toEqual(["Lid wash", "Classic wing", "Crease / smoky", "Lower-lash smudge", "Wing (original)"]);
    expect(new Set(EYE_STARTERS.map(item => item.id)).size).toBe(EYE_STARTERS.length);
    expect(REGION.starters).toBe(EYE_STARTERS);
    expect(REGION.defaultStarter).toBe(EYE_DEFAULT_STARTER);
    expect(starter(EYE_DEFAULT_STARTER).name).toBe("Lid wash");
    for (const item of EYE_STARTERS) { expect(item.name.length).toBeLessThanOrEqual(60); expect(item.description.length).toBeGreaterThan(10); }
  });

  test.each(EYE_STARTERS.map(item => [item.name, item] as const))("%s is a valid, frozen, symmetric shape inside the plate with room for its feather", (_name, item) => {
    const shape = item.shape, base = newLayerTemplate();
    // Valid by the layer rules, and read back as itself.
    expect(readStarterShape(shape, base, MODELS)).toEqual(shape);
    expect(Object.isFrozen(shape) && Object.isFrozen(shape.points) && Object.isFrozen(shape.points[0])).toBe(true);
    expect(shape.points.length).toBeGreaterThanOrEqual(4);
    expect(shape.points.length).toBeLessThanOrEqual(24);
    expect(shape.feather).toBeGreaterThanOrEqual(MIN_FEATHER);
    expect(shape.feather).toBeLessThanOrEqual(MAX_FEATHER);
    expect(shape.pathMode).toBe("bezier");
    expect(shape.points.every(point => point.handles && point.weight === 1)).toBe(true);
    expect(shape.opacity).toBeGreaterThan(0.4);
    expect(shape.finish).toBe("matte");
    // Symmetric: mirrored across the face's centre line, and drawn on one side only, clear of the line by its feather.
    expect(shape.symmetry).toBe(true);
    const layer = layerWithShape(base, shape), outline = outlineOf(shape);
    for (const [u, v] of [[0.4, 0.24], [0.37, 0.25], [0.35, 0.24], [0.42, 0.23]] as const)
      expect(coverage(1 - u, v, layer, REGION.mirror)).toBeCloseTo(coverage(u, v, layer, REGION.mirror), 12);
    expect(Math.max(...outline.map(point => point.u)) + 3 * shape.feather).toBeLessThan(REGION.mirror.centre);
    // Inside the plate's UV rectangle, with three feathers of margin, so nothing is cut off at the plate's edge.
    const area = REGION.area, margin = 3 * shape.feather;
    expect(Math.min(...outline.map(point => point.u)) - margin).toBeGreaterThan(area.u0);
    expect(Math.max(...outline.map(point => point.u)) + margin).toBeLessThan(area.u1);
    expect(Math.min(...outline.map(point => point.v)) - margin).toBeGreaterThan(area.v0);
    expect(Math.max(...outline.map(point => point.v)) + margin).toBeLessThan(area.v1);
    // It paints: the layer it makes has coverage inside its own outline and none far from it.
    const middle = outline.reduce((sum, point) => ({ u: sum.u + point.u / outline.length, v: sum.v + point.v / outline.length }), { u: 0, v: 0 });
    expect(inside(outline, middle) ? coverage(middle.u, middle.v, layer, REGION.mirror) : 1).toBeGreaterThan(0.2);
    expect(coverage(0.3, 0.3, layer, REGION.mirror)).toBe(0);
  });

  test("Lid wash covers the lid from the upper lash line to above the crease, from corner to corner", () => {
    const outline = outlineOf(starter("lid-wash").shape);
    for (const u of [0.385, 0.395, 0.405, 0.415, 0.422]) {
      const span = spanAt(outline, u)!, lash = lineAt(L.lashLine, u), crease = lineAt(L.crease, u);
      expect(lash - span.bottom).toBeGreaterThan(0);       // its lower edge on the lid side of the lash line…
      expect(lash - span.bottom).toBeLessThan(0.006);      // …and hugging it
      expect(span.top).toBeLessThan(crease);               // its top above the crease
      expect(crease - span.top).toBeLessThan(0.016);       // but not up into the brow
    }
    expect(Math.min(...outline.map(point => point.u))).toBeLessThan(L.outerCorner[0]);
    expect(Math.max(...outline.map(point => point.u))).toBeGreaterThan(L.innerCorner[0]);
  });

  test("Classic wing is a band on the upper lash line that flicks out of the outer corner at a natural angle", () => {
    const shape = starter("classic-wing").shape, outline = outlineOf(shape);
    for (const u of [0.385, 0.395, 0.405, 0.415]) {
      const span = spanAt(outline, u)!, lash = lineAt(L.lashLine, u);
      expect(lash - span.bottom).toBeGreaterThan(-0.0005);  // on the lash line, not through it
      expect(lash - span.bottom).toBeLessThan(0.003);
      expect(span.bottom - span.top).toBeGreaterThan(0.001); // a line with body…
      expect(span.bottom - span.top).toBeLessThan(0.007);    // …but clean, not a wash
    }
    // The tip: beyond and above the outer corner, 8 to 14 mm out, 20 to 35 degrees up in millimetres on the skin.
    const tip = shape.points.find(point => point.handles?.mode === "corner")!;
    const dx = (L.outerCorner[0] - tip.u) * millimetres.u, dy = (L.outerCorner[1] - tip.v) * millimetres.v;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(8); expect(Math.hypot(dx, dy)).toBeLessThan(14);
    expect(Math.atan2(dy, dx) * 180 / Math.PI).toBeGreaterThan(20); expect(Math.atan2(dy, dx) * 180 / Math.PI).toBeLessThan(35);
    // It tapers: thicker at the corner than near the tip.
    const near = spanAt(outline, L.outerCorner[0] - 0.003)!, far = spanAt(outline, tip.u + 0.004)!;
    expect(near.bottom - near.top).toBeGreaterThan(far.bottom - far.top);
  });

  test("Crease / smoky is a soft crescent along the crease, with the crease inside it and the softest edge of the four", () => {
    const shape = starter("crease-smoky").shape, outline = outlineOf(shape);
    for (const u of [0.38, 0.39, 0.4, 0.41, 0.42]) {
      const crease = lineAt(L.crease, u);
      expect(inside(outline, { u, v: crease })).toBe(true);
      const span = spanAt(outline, u)!;
      expect(crease - span.top).toBeGreaterThan(0.002); expect(span.bottom - crease).toBeGreaterThan(0.002);
    }
    expect(shape.feather).toBe(Math.max(...EYE_STARTERS.filter(item => item.id !== "wing-original").map(item => item.shape.feather)));
  });

  test("Lower-lash smudge sits under the lower lash line, fuller toward the outer corner", () => {
    const outline = outlineOf(starter("lower-lash-smudge").shape);
    const thickness = (u: number) => { const span = spanAt(outline, u)!; return span.bottom - span.top; };
    for (const u of [0.38, 0.39, 0.4, 0.41]) {
      const span = spanAt(outline, u)!, lash = lineAt(L.lashLine, u);
      expect(span.top).toBeGreaterThan(lash);               // under the line…
      expect(span.top - lash).toBeLessThan(0.003);          // …hugging it
      expect(span.bottom - lash).toBeLessThan(0.014);
    }
    expect(thickness(0.385)).toBeGreaterThan(thickness(0.415));
    expect(Math.min(...outline.map(point => point.u))).toBeLessThan(L.outerCorner[0] + 0.001);
    expect(Math.max(...outline.map(point => point.u))).toBeLessThan(L.innerCorner[0]);
  });

  test("Wing (original) is exactly the shape new layers started from before starters", () => {
    const shape = starter("wing-original").shape, layer = layerWithShape(newLayerTemplate(), shape);
    expect(layer.points.map(point => [point.u, point.v])).toEqual([[0.311, 0.236], [0.335, 0.215], [0.402, 0.214], [0.434, 0.246]]);
    expect(layer.feather).toBe(0.006); expect(layer.opacity).toBe(0.85); expect(layer.finish).toBe("matte");
    // Catmull–Rom tangents as that template converted them: a sixth of the neighbours' span, equal arms.
    expect(layer.points[0]!.handles).toEqual({ in: { u: -(0.335 - 0.434) / 6, v: -(0.215 - 0.246) / 6 }, out: { u: (0.335 - 0.434) / 6, v: (0.215 - 0.246) / 6 }, mode: "symmetric" });
  });

  test("a shape applies only its contour: the layer keeps its colour, its optics and its warp-free field list", () => {
    const base: Layer = { ...newLayerTemplate(), color: "#123456", finish: "glitter", flakes: undefined, fields: [] };
    const layer = layerWithShape(base, starter("classic-wing").shape);
    expect(layer.color).toBe("#123456"); expect(layer.finish).toBe("matte");
    // A shape of a layer drops a finish that needs an optical block, and a shape without a finish leaves the layer's own.
    const { finish: _finish, ...bare } = starter("lid-wash").shape;
    expect(layerWithShape({ ...base, finish: "regular" }, bare).finish).toBe("regular");
    expect(shapeOfLayer({ ...base, finish: "glitter" }).finish).toBeUndefined();
    expect(shapeOfLayer({ ...base, finish: "regular" }).finish).toBe("regular");
  });

  test("a shape that breaks the layer rules is not read", () => {
    const shape = starter("lid-wash").shape, base = newLayerTemplate();
    expect(readStarterShape({ ...shape, feather: 0 }, base, MODELS)).toBeUndefined();
    expect(readStarterShape({ ...shape, points: shape.points.slice(0, 2) }, base, MODELS)).toBeUndefined();
    expect(readStarterShape({ ...shape, extra: 1 }, base, MODELS)).toBeUndefined();
    expect(readStarterShape({ ...shape, finish: "glitter" }, base, MODELS)).toBeUndefined();
    expect(readStarterShape({ ...shape, points: shape.points.map(point => ({ ...point, u: 2 })) }, base, MODELS)).toBeUndefined();
    expect(readStarterShape(null, base, MODELS)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The owner of own starters and of the default.

let windows = 0;
/** A window: its outbox over the library, its starters, and the workspace's choice of default. */
function windowOn(documents = storeDocuments(), storage = memoryOutboxStorage(), options: { writable?: () => boolean; read?: ShapeStartersDeps["read"]; choice?: { value?: string } } = {}) {
  const outbox = new DocumentOutbox(documents, storage, { retryMs: 5, writable: options.writable });
  outbox.open();
  const notes: string[] = [], errors: unknown[] = [], choice = options.choice ?? {};
  const starters = new ShapeStarters({ documents, outbox, feature: REGION.id, label: "Eye makeup", contributed: REGION.starters, fallback: REGION.defaultStarter,
    read: options.read ?? (shape => readStarterShape(shape, REGION.newLayer(), MODELS)), choice: { get: () => choice.value, set: id => { choice.value = id; } },
    random: seededRandom(31 + ++windows), writable: options.writable, note: text => notes.push(text), report: error => errors.push(error) });
  return { documents, storage, outbox, starters, notes, errors, choice };
}
type Window = ReturnType<typeof windowOn>;
const created = (w: Window, name: string, id = "classic-wing") => { const done = w.starters.dispatch({ kind: "create", name, shape: starter(id).shape }); if (!done.ok) throw Error(done.reason); return done.id; };
const stored = (w: Window) => w.documents.store.list(STARTER_DOCUMENT);

describe("the default starter", () => {
  test("is Lid wash until one is chosen, and a missing or deleted choice falls back to it", async () => {
    const w = windowOn(); await w.starters.load();
    expect(w.starters.defaultId()).toBe("lid-wash");
    expect(w.starters.list().filter(item => item.isDefault).map(item => item.name)).toEqual(["Lid wash"]);
    w.choice.value = "no-such-starter";
    expect(w.starters.defaultId()).toBe("lid-wash");
    expect(w.starters.shapeOf()).toEqual(starter("lid-wash").shape);
    const own = created(w, "Mine");
    expect(w.starters.setDefault(own)).toEqual({ ok: true, id: own });
    expect(w.starters.defaultId()).toBe(own);
    expect(w.choice.value).toBe(own);
    expect(w.starters.shapeOf()).toEqual(starter("classic-wing").shape);
    // Deleted: new layers fall back at once; restored: it is the default again (the choice was never changed).
    expect(w.starters.dispatch({ kind: "delete", id: own }).ok).toBe(true);
    expect(w.starters.defaultId()).toBe("lid-wash");
    expect(w.starters.list().filter(item => item.isDefault).map(item => item.id)).toEqual(["lid-wash"]);
    expect(w.choice.value).toBe(own);
    expect(w.starters.dispatch({ kind: "restore", id: own }).ok).toBe(true);
    expect(w.starters.defaultId()).toBe(own);
  });

  test("changes only by Use for new layers: saving, renaming and adding layers never move it", async () => {
    const w = windowOn(); await w.starters.load();
    expect(w.starters.setDefault("crease-smoky").ok).toBe(true);
    created(w, "Fresh"); w.starters.dispatch({ kind: "rename", id: created(w, "Another"), name: "Renamed" });
    expect(w.starters.defaultId()).toBe("crease-smoky");
    expect(w.starters.setDefault("nonexistent")).toMatchObject({ ok: false, code: "missing_target" });
    expect(w.starters.defaultId()).toBe("crease-smoky");
  });

  test("a starter this build can't read is listed with its reason, kept, and never the default", async () => {
    const documents = storeDocuments(), w = windowOn(documents);
    const id = created(w, "Newer"); await quiet(w.outbox);
    const reader = windowOn(documents, memoryOutboxStorage(), { read: shape => (shape as { points: unknown[] }).points.length > 100 ? starter("lid-wash").shape : undefined });
    await reader.starters.load();
    const view = reader.starters.get(id)!;
    expect(view).toMatchObject({ name: "Newer", unavailable: expect.stringContaining("newer version") });
    expect(view.shape).toBeUndefined();
    expect(reader.starters.setDefault(id)).toMatchObject({ ok: false, code: "unavailable" });
    expect(reader.starters.shapeOf(id)).toBeUndefined();
    expect(reader.starters.dispatch({ kind: "rename", id, name: "Still mine" }).ok).toBe(true);
    expect(reader.starters.dispatch({ kind: "delete", id }).ok).toBe(true);
  });
});

describe("own starters", () => {
  test("are saved, renamed, deleted and restored through the outbox, and the library holds what the list shows", async () => {
    const w = windowOn(); await w.starters.load();
    const id = created(w, "  Evening wing  ");
    expect(w.starters.list().map(item => item.name)).toEqual([...EYE_STARTERS.map(item => item.name), "Evening wing"]);
    expect(w.starters.get(id)).toMatchObject({ owner: { kind: "user" }, isDefault: false, shape: starter("classic-wing").shape });
    // Recorded at once (survives a restart before the library has it), then in the library.
    expect(w.outbox.pendingEntries().length).toBeGreaterThan(0);
    await quiet(w.outbox);
    expect(stored(w)).toHaveLength(1);
    expect(w.documents.store.get<{ schema: string; feature: string; name: string; shape: unknown }>(STARTER_DOCUMENT, id)!.value)
      .toMatchObject({ schema: STARTER_SCHEMA, feature: REGION.id, name: "Evening wing", shape: starter("classic-wing").shape });
    expect(w.starters.dispatch({ kind: "rename", id, name: "Night wing" }).ok).toBe(true);
    expect(w.starters.get(id)!.name).toBe("Night wing");
    expect(w.starters.dispatch({ kind: "delete", id }).ok).toBe(true);
    expect(w.starters.get(id)).toBeUndefined();
    expect(w.starters.capability({ kind: "rename", id, name: "Gone" })).toMatchObject({ available: false, code: "missing_target" });
    await quiet(w.outbox);
    expect(stored(w)).toHaveLength(1);   // a tombstone, kept so Undo can restore it
    expect(w.starters.dispatch({ kind: "restore", id }).ok).toBe(true);
    expect(w.starters.get(id)).toMatchObject({ name: "Night wing", shape: starter("classic-wing").shape });
    await quiet(w.outbox);
    // A new window reads it from the library, and one restarted before the library had it finds it in its outbox.
    const again = windowOn(w.documents); await again.starters.load();
    expect(again.starters.get(id)!.name).toBe("Night wing");
  });

  test("keep what the outbox holds across a restart before the library has it", async () => {
    const documents = storeDocuments(), storage = memoryOutboxStorage(), a = windowOn(documents, storage);
    const id = created(a, "Kept");
    const b = windowOn(documents, storage); await b.starters.load();
    expect(b.starters.get(id)!.name).toBe("Kept");
    await quiet(b.outbox);
    expect(stored(b)).toHaveLength(1);
  });

  test("names are 1 to 60 characters and need not be unique; contributed starters can't be renamed or deleted", async () => {
    const w = windowOn(); await w.starters.load();
    expect(w.starters.capability({ kind: "create", name: "   ", shape: starter("lid-wash").shape })).toMatchObject({ available: false, reason: "Name the starter." });
    expect(w.starters.capability({ kind: "create", name: "x".repeat(61), shape: starter("lid-wash").shape })).toMatchObject({ available: false, reason: "Use 60 characters or fewer." });
    expect(w.starters.capability({ kind: "create", name: "x".repeat(60), shape: starter("lid-wash").shape }).available).toBe(true);
    expect(w.starters.capability({ kind: "create", name: "Lid wash", shape: { ...starter("lid-wash").shape, feather: 0 } as StarterShape })).toMatchObject({ available: false, code: "invalid_value" });
    created(w, "Twin"); created(w, "Twin");
    expect(w.starters.list().filter(item => item.name === "Twin")).toHaveLength(2);
    for (const kind of ["rename", "delete"] as const) expect(w.starters.capability(kind === "rename" ? { kind, id: "lid-wash", name: "Mine" } : { kind, id: "lid-wash" }))
      .toMatchObject({ available: false, code: "invalid_value", reason: expect.stringContaining("can't be changed") });
    expect(w.starters.capability({ kind: "restore", id: "lid-wash" }).available).toBe(false);
  });

  test("two windows changing one starter keep both: this window's version as a copy, the other window's original", async () => {
    const documents = storeDocuments(), a = windowOn(documents); await a.starters.load();
    const id = created(a, "Shared"); await quiet(a.outbox);
    const b = windowOn(documents); await b.starters.load();
    expect(b.starters.dispatch({ kind: "rename", id, name: "B's name" }).ok).toBe(true); await quiet(b.outbox);
    const localName = "A".repeat(60);
    expect(a.starters.dispatch({ kind: "rename", id, name: localName }).ok).toBe(true);
    await quiet(a.outbox);
    expect(a.starters.conflicts()).toEqual([]);
    expect(documents.store.get<{ name: string }>(STARTER_DOCUMENT, id)!.value.name).toBe("B's name");
    expect(a.starters.get(id)!.name).toBe("B's name");
    const copy = a.starters.list().find(item => item.owner.kind === "user" && item.id !== id)!, copyName = `${localName.slice(0, 46)} (this window)`;
    expect(copy.name).toBe(copyName); expect(copy.name.length).toBeLessThanOrEqual(60);
    expect(copy.shape).toEqual(starter("classic-wing").shape);
    expect(documents.store.get(STARTER_DOCUMENT, copy.id)!.value).toMatchObject({ name: copyName });
    expect(a.notes).toEqual([`“${localName}” was also changed in another window. Both are kept: yours is “${copyName}”.`]);
    expect(a.errors).toEqual([]);
    await a.outbox.check(); await a.outbox.check();
    expect(stored(a)).toHaveLength(2);
    expect(a.notes).toHaveLength(1);
  });

  test("a local deletion conflicting with the other window's edit takes their version, with no copy", async () => {
    const documents = storeDocuments(), a = windowOn(documents); await a.starters.load();
    const id = created(a, "Night shoot"); await quiet(a.outbox);
    const b = windowOn(documents); await b.starters.load();
    b.starters.dispatch({ kind: "rename", id, name: "Their night shoot" }); await quiet(b.outbox);
    expect(a.starters.dispatch({ kind: "delete", id }).ok).toBe(true);
    await quiet(a.outbox);
    expect(a.starters.conflicts()).toEqual([]);
    expect(a.starters.get(id)!.name).toBe("Their night shoot");
    expect(stored(a)).toHaveLength(1);
    expect(a.notes).toEqual(["“Night shoot” was changed in another window, so it's kept."]);
  });

  test("another window's new starters are found at the next revision check", async () => {
    const documents = storeDocuments(), a = windowOn(documents), b = windowOn(documents);
    await a.starters.load(); await b.starters.load();
    const id = created(b, "From B"); await quiet(b.outbox);
    expect(a.starters.get(id)).toBeUndefined();
    await a.outbox.check();
    expect(a.starters.get(id)!.name).toBe("From B");
  });

  /** Make the on-disk conflict an earlier build left, using the real outbox and store, before this owner starts. */
  async function storedConflict() {
    const documents = storeDocuments(), a = windowOn(documents), storage = memoryOutboxStorage();
    await a.starters.load();
    const id = created(a, "Night shoot");
    await quiet(a.outbox); a.outbox.stop();
    const before = documents.store.get<Record<string, unknown>>(STARTER_DOCUMENT, id)!;
    const old = new DocumentOutbox(documents, storage); old.open();
    old.hold({ kind: STARTER_DOCUMENT, id }, before);
    const b = windowOn(documents); await b.starters.load();
    b.starters.dispatch({ kind: "rename", id, name: "Other window" }); await quiet(b.outbox);
    old.commit("shape-starter.rename", [{ kind: STARTER_DOCUMENT, id, value: { ...before.value, name: "Mine", future: { kept: true } } }]);
    await quiet(old);
    expect(old.conflicts()).toHaveLength(1);
    old.stop();
    return { documents, storage, id };
  }

  test("a read-only window leaves a stored conflict untouched, keeping unknown fields; its writable holder resolves it once", async () => {
    const { documents, storage, id } = await storedConflict();
    const stored = [...storage.keys];
    let writable = false;
    const w = windowOn(documents, storage, { writable: () => writable });
    await w.starters.load(); await w.outbox.check();
    expect(w.starters.conflicts()).toHaveLength(1);
    expect([...storage.keys]).toEqual(stored);
    expect(stored.length).toBeGreaterThan(0);
    expect(documents.store.list(STARTER_DOCUMENT)).toHaveLength(1);
    expect(w.notes).toEqual([]); expect(w.errors).toEqual([]);
    writable = true;
    await w.outbox.check(); await quiet(w.outbox);
    expect(w.starters.conflicts()).toEqual([]);
    expect(documents.store.list(STARTER_DOCUMENT)).toHaveLength(2);
    expect(w.starters.get(id)!.name).toBe("Other window");
    const copy = w.starters.list().find(item => item.owner.kind === "user" && item.id !== id)!;
    expect(copy.name).toBe("Mine (this window)");
    expect(documents.store.get(STARTER_DOCUMENT, copy.id)!.value).toMatchObject({ future: { kept: true } });
    expect(w.notes).toHaveLength(1);
    await w.outbox.check();
    expect(w.notes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The application: adding, resetting and new looks start from a starter; actions are registered; a read-only window refuses.

async function studioWithStarters(options: { looks?: StudioLookInput[] } = {}) {
  const choice: { value?: string } = {}, notes: string[] = [];
  const holder: { starters?: ShapeStarters } = {};
  const studio = await profileStudio({ ...(options.looks ? { looks: options.looks } : {}), newId: (() => { let n = 0; return () => `id-${++n}`; })(),
    starterPart: () => REGION.starter(holder.starters?.shapeOf()) });
  const starters = new ShapeStarters({ documents: studio.port, outbox: studio.outbox, feature: REGION.id, label: "Eye makeup", contributed: REGION.starters,
    fallback: REGION.defaultStarter, read: shape => readStarterShape(shape, REGION.newLayer(), MODELS), choice: { get: () => choice.value, set: id => { choice.value = id; } },
    random: seededRandom(77), note: text => notes.push(text) });
  holder.starters = starters;
  await starters.load();
  const actions = new StarterActions({ starters, feature: REGION.id, label: "Eye makeup", layer: id => studio.document.recipe.layers.find(layer => layer.id === id) });
  studio.core.app.attach({ starters: actions, starterShapes: starters });
  return { studio, starters, actions, choice, notes };
}
const pointsOf = (layer: Layer) => layer.points.map(point => [point.u, point.v]);
const shapePoints = (id: string) => pointsOf(layerWithShape(newLayerTemplate(), starter(id).shape));

describe("in the application", () => {
  test("Add layer starts from the default starter, a starter it names, and the default after Use for new layers", async () => {
    const { studio } = await studioWithStarters({ looks: [{ name: "Look", recipe: starterRecipe() }] });
    const layers = () => studio.document.recipe.layers;
    expect(studio.app.dispatch({ kind: "layer.edit", command: { kind: "add" } })).toMatchObject({ ok: true });
    expect(pointsOf(layers().at(-1)!)).toEqual(shapePoints("lid-wash"));
    expect(layers().at(-1)!.opacity).toBe(starter("lid-wash").shape.opacity!);
    expect(studio.app.dispatch({ kind: "layer.edit", command: { kind: "add", starter: "classic-wing" } })).toMatchObject({ ok: true });
    expect(pointsOf(layers().at(-1)!)).toEqual(shapePoints("classic-wing"));
    expect(layers().at(-1)!.feather).toBe(starter("classic-wing").shape.feather);
    expect(studio.app.dispatch({ kind: "starters.setDefault", starter: "crease-smoky" })).toMatchObject({ ok: true });
    studio.app.dispatch({ kind: "layer.edit", command: { kind: "add" } });
    expect(pointsOf(layers().at(-1)!)).toEqual(shapePoints("crease-smoky"));
    // The default doesn't follow use: adding from another starter leaves it where it was.
    studio.app.dispatch({ kind: "layer.edit", command: { kind: "add", starter: "lower-lash-smudge" } });
    studio.app.dispatch({ kind: "layer.edit", command: { kind: "add" } });
    expect(pointsOf(layers().at(-1)!)).toEqual(shapePoints("crease-smoky"));
    // A starter that is gone is refused, naming it.
    const gone = studio.app.dispatch({ kind: "layer.edit", command: { kind: "add", starter: "s-nothing" } });
    expect(gone).toMatchObject({ ok: false, code: "missing_target", message: "That starter isn't available any more." });
    expect(studio.app.capability({ kind: "layer.edit", command: { kind: "add", starter: "s-nothing" } })).toMatchObject({ available: false, code: "missing_target" });
  });

  test("a layer added from the person's own starter takes its shape; Reset takes the default's", async () => {
    const { studio, starters } = await studioWithStarters({ looks: [{ name: "Look", recipe: starterRecipe() }] });
    const layerId = studio.document.recipe.layers[0]!.id;
    // Save the first layer's shape (moved a little first), then add from it.
    studio.app.dispatch({ kind: "path.edit", layerId, command: { kind: "enable-bezier" } });
    expect(studio.app.dispatch({ kind: "starters.save", layerId, name: "My shape" })).toMatchObject({ ok: true });
    const own = starters.list().find(item => item.name === "My shape")!;
    expect(own.shape).toEqual(shapeOfLayer(studio.document.recipe.layers[0]!));
    studio.app.dispatch({ kind: "layer.edit", command: { kind: "add", starter: own.id } });
    expect(pointsOf(studio.document.recipe.layers.at(-1)!)).toEqual(pointsOf(studio.document.recipe.layers[0]!));
    studio.app.dispatch({ kind: "starters.setDefault", starter: "classic-wing" });
    studio.app.dispatch({ kind: "layer.edit", command: { kind: "reset", id: layerId } });
    expect(pointsOf(studio.document.recipe.layers[0]!)).toEqual(shapePoints("classic-wing"));
    expect(studio.document.recipe.layers[0]!.name).toBe("Eye makeup");
  });

  test("save as starter, rename, delete and restore are registered actions with capabilities; delete is a recovery step with Undo's restore", async () => {
    const { studio, starters } = await studioWithStarters();
    const layerId = studio.document.recipe.layers[0]!.id;
    expect(studio.app.capability({ kind: "starters.save", layerId, name: "" })).toMatchObject({ available: false });
    expect(studio.app.capability({ kind: "starters.save", layerId: "missing", name: "X" })).toMatchObject({ available: false, code: "missing_target" });
    expect(studio.app.capability({ kind: "starters.save", layerId, name: "x".repeat(61) })).toMatchObject({ available: false });
    expect(studio.app.dispatch({ kind: "starters.save", layerId, name: "Mine" })).toMatchObject({ ok: true });
    const id = starters.list().find(item => item.name === "Mine")!.id;
    expect(studio.app.dispatch({ kind: "starters.rename", starter: id, name: "Renamed" })).toMatchObject({ ok: true });
    expect(studio.app.capability({ kind: "starters.rename", starter: "lid-wash", name: "Mine" })).toMatchObject({ available: false });
    expect(studio.app.dispatch({ kind: "starters.delete", starter: id })).toMatchObject({ ok: true });
    expect(starters.get(id)).toBeUndefined();
    expect(studio.app.dispatch({ kind: "starters.restore", starter: id })).toMatchObject({ ok: true });
    expect(starters.get(id)!.name).toBe("Renamed");
    expect(studio.app.dispatch({ kind: "starters.setDefault", starter: "nothing" })).toMatchObject({ ok: false, code: "missing_target" });
    await studio.settle();
  });

  test("New look starts its first layer from the default starter, and from Lid wash when none is chosen", async () => {
    const { studio, starters } = await studioWithStarters({ looks: [{ name: "Look", recipe: starterRecipe() }] });
    await studio.collection.initialize();
    const add = () => { const done = studio.service.dispatch({ kind: "preset.edit", collection: studio.shown()!, command: { kind: "add" } }); return done; };
    add();
    expect(pointsOf(studio.document.recipe.layers[0]!)).toEqual(shapePoints("lid-wash"));
    studio.app.dispatch({ kind: "starters.setDefault", starter: "lower-lash-smudge" });
    add();
    expect(studio.document.recipe.layers).toHaveLength(1);
    expect(pointsOf(studio.document.recipe.layers[0]!)).toEqual(shapePoints("lower-lash-smudge"));
    expect(studio.document.recipe.layers[0]!.opacity).toBe(starter("lower-lash-smudge").shape.opacity!);
    expect(starters.defaultId()).toBe("lower-lash-smudge");
    await studio.settle();
  });

  test("existing drafts are untouched: choosing, saving and deleting starters change no layer", async () => {
    const recipe = initialRecipe();
    const { studio } = await studioWithStarters({ looks: [{ name: "Look", recipe }] });
    const before = JSON.stringify(studio.document.recipe), layerId = studio.document.recipe.layers[0]!.id;
    studio.app.dispatch({ kind: "starters.setDefault", starter: "classic-wing" });
    studio.app.dispatch({ kind: "starters.save", layerId, name: "Saved" });
    expect(JSON.stringify(studio.document.recipe)).toBe(before);
    expect(studio.document.recipe).toEqual(parseRound(recipe));
    await studio.settle();
  });

  test("a read-only window shows every starter action, and adding a layer, unavailable with the window's reason", async () => {
    const { studio } = await studioWithStarters();
    const reason = "Another window is editing this workspace. Use it here to make changes.";
    studio.core.app.attach({ access: { refusal: () => ({ available: false, code: "unavailable", reason }) } });
    const layerId = studio.document.recipe.layers[0]!.id;
    for (const action of [{ kind: "starters.setDefault", starter: "classic-wing" }, { kind: "starters.save", layerId, name: "Mine" },
      { kind: "starters.rename", starter: "x", name: "Y" }, { kind: "starters.delete", starter: "x" }, { kind: "starters.restore", starter: "x" },
      { kind: "layer.edit", command: { kind: "add", starter: "classic-wing" } }, { kind: "layer.edit", command: { kind: "add" } }] as const) {
      expect(studio.app.capability(action as never), action.kind).toMatchObject({ available: false, reason });
      expect(studio.app.dispatch(action as never), action.kind).toMatchObject({ ok: false, message: reason });
    }
  });
});
const parseRound = (recipe: unknown) => JSON.parse(JSON.stringify(recipe));

describe("the default is kept in the workspace's eye makeup memory", () => {
  test("it is read and written with the feature memory, absent when never chosen, and an older memory is unchanged", () => {
    expect(eyeMakeupMemory.serialize({ choices: {} })).toEqual({ choices: {} });
    expect(eyeMakeupMemory.parse({ choices: {} })).toEqual({ choices: {} });
    expect(eyeMakeupMemory.serialize({ choices: {}, defaultStarter: "classic-wing" })).toEqual({ choices: {}, defaultStarter: "classic-wing" });
    expect(eyeMakeupMemory.parse({ choices: {}, defaultStarter: "s-abc123" })).toEqual({ choices: {}, defaultStarter: "s-abc123" });
    for (const bad of [5, "", "x".repeat(81), null, {}]) expect(eyeMakeupMemory.parse({ choices: {}, defaultStarter: bad })).toEqual({ choices: {} });
  });

  test("a workspace stores it under features[\"eye-makeup\"] and a fresh or older one has none", () => {
    const state = freshWorkspace(starterRecipe());
    const plain = serializeWorkspace(state, STUDIO_DOCUMENTS);
    expect((plain.features["eye-makeup"] as { defaultStarter?: string }).defaultStarter).toBeUndefined();
    expect(plain.features["eye-makeup"]).toEqual({ choices: {} });
    state.defaultStarter = "crease-smoky";
    const stored = serializeWorkspace(state, STUDIO_DOCUMENTS);
    expect(stored.features["eye-makeup"]).toEqual({ choices: {}, defaultStarter: "crease-smoky" });
    expect("defaultStarter" in stored).toBe(false);
    const loaded = loadWorkspace({ getItem: () => JSON.stringify(stored) }, false, STUDIO_DOCUMENTS);
    expect(loaded.state.defaultStarter).toBe("crease-smoky");
    expect(loadWorkspace({ getItem: () => JSON.stringify(plain) }, false, STUDIO_DOCUMENTS).state.defaultStarter).toBeUndefined();
  });
});

describe("the layer commands", () => {
  test("a command's starter and shape are validated, and a contributed starter resolves without the application", () => {
    const base = { uv: "gltf-uv0-top-left" as const, layers: [] };
    const named = editLayers(base, undefined, { kind: "add", newId: "a", starter: "classic-wing" }, REGION).recipe.layers[0]!;
    expect(pointsOf(named)).toEqual(shapePoints("classic-wing"));
    const plain = editLayers(base, undefined, { kind: "add", newId: "b" }, REGION).recipe.layers[0]!;
    expect(pointsOf(plain)).toEqual(shapePoints("lid-wash"));
    expect(() => editLayers(base, undefined, { kind: "add", newId: "c", shape: { ...starter("lid-wash").shape, feather: 0 } as StarterShape }, REGION)).toThrow();
  });
});
