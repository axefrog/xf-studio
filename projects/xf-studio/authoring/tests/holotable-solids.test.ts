import { expect, test } from "bun:test";
import { camera, clipSegment, clipToRect, ORBITS, project } from "../src/features/holotable/view/projection";
import { solidDrawing, solidGeometry, SOLID_DRAW_CAP } from "../src/features/holotable/view/solid-projection";
import type { HoloSession, HoloSolid } from "../src/features/holotable/types";

const box = (id: string, center: HoloSolid["center"], kind: HoloSolid["kind"] = "box"): HoloSolid => ({ id, center, kind,
  axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], size: [5, 8, 10] });
const s: HoloSession = { meta: { session: "synthetic", run: 1, start: 0, end: 1, from: 0, to: 1, channels: ["v"], complete: true, dropped: 0,
  missedDeadlines: 0, largestGapS: 0, coverage: "synthetic", problems: [] }, v: [{ t: 0, seq: 1, position: [0, 0, 0], yaw: 0, speed: 0,
  health: 100, healthMax: 100, inCombat: false, vehicle: false, busy: "" }], camera: [], events: [], gaps: [] };
const layers = { v: true, camera: true, events: true, gaps: true, areas: false, cells: false, solids: true };

test("a box has its 12 crisp edges and faint visible faces; sphere and capsule each have a silhouette and meridian", () => {
  const C = camera([0, 0, 0], ORBITS.tilt, 800, 480);
  const b = solidDrawing(box("box", [0, 0, 0]), C, 1);
  expect(b.lines.length).toBe(12); expect(b.faces.length).toBe(3); expect(b.faces.some(f => f.top)).toBe(true);
  for (const kind of ["sphere", "capsule"] as const) {
    const d = solidDrawing(box(kind, [0, 0, 0], kind), C, 1);
    expect(d.lines.length).toBe(2); expect(d.faces.length).toBe(1);
  }
});

test("distance culling precedes the significance cap, large volumes survive and geometry paints far to near below data", () => {
  const solids = [...Array.from({ length: 30 }, (_, i) => box(`far${i}`, [400 + i, 0, 0])),
    ...Array.from({ length: SOLID_DRAW_CAP + 1 }, (_, i) => box(String(i).padStart(5, "0"), [0, 0, 0])),
    { ...box("building", [80, 0, 0]), size: [25, 25, 25] as const }];
  const scene = project(s, { provenance: null, areas: [], cells: [], solids }, 0, layers, ORBITS.tilt, 800, 480, null);
  expect(scene.solidsDrawn).toBe(SOLID_DRAW_CAP); expect(scene.solidsCut).toBe(2);
  const drawn = scene.primitives.filter(p => p.kind === "solid");
  expect(drawn.some(p => p.id.startsWith("far"))).toBe(false);
  expect(drawn.some(p => p.id === "building")).toBe(true);
  expect(drawn.some(p => p.id === String(SOLID_DRAW_CAP).padStart(5, "0"))).toBe(false);
  const C = camera([0, 0, 0], ORBITS.tilt, 800, 480), distance = (id: string) => Math.hypot(...solids.find(s => s.id === id)!.center.map((x, i) => x - C.position[i]));
  for (let i = 1; i < drawn.length; i++) expect(distance(drawn[i - 1].id)).toBeGreaterThanOrEqual(distance(drawn[i].id));
  expect(scene.primitives.map(p => p.kind).lastIndexOf("solid")).toBeLessThan(scene.primitives.findIndex(p => p.kind === "marker"));
  expect(project(s, { provenance: null, areas: [], cells: [], solids }, 0, { ...layers, solids: false }, ORBITS.tilt, 800, 480, null).solidsDrawn).toBe(0);
});

test("sub-four-pixel shapes beyond 30 m drop out while equally small shapes beside V remain", () => {
  const tiny = (id: string, x: number) => ({ ...box(id, [x, 0, 0]), size: [0.05, 0.05, 0.05] as const });
  const scene = project(s, { provenance: null, areas: [], cells: [], solids: [tiny("near", 20), tiny("far", 50)] }, 0, layers, ORBITS.tilt, 800, 480, null);
  expect(scene.primitives.filter(p => p.kind === "solid").map(p => p.id)).toEqual(["near"]);
});

test("every solid line and face stays inside the drawing plus margin, including near-plane crossings", () => {
  for (const orbit of Object.values(ORBITS)) for (const width of [300, 800]) for (const kind of ["box", "sphere", "capsule"] as const) {
    for (const center of [[0, 0, 0], [200, 30, 0], [-60, -60, 40]] as const) {
      const shape = { ...box(kind, center, kind), size: [60, 140, 50] as const };
      const d = solidDrawing(shape, camera([0, 0, 0], orbit, width, 480), 1);
      for (const p of [...d.lines.flatMap(l => l.points), ...d.faces.flatMap(f => f.points)]) {
        expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true);
        expect(p[0]).toBeGreaterThanOrEqual(-32.001); expect(p[0]).toBeLessThanOrEqual(width + 32.001);
        expect(p[1]).toBeGreaterThanOrEqual(-32.001); expect(p[1]).toBeLessThanOrEqual(512.001);
      }
    }
  }
});

test("a primitive crossing the 350 m boundary is culled as a whole before the draw cap", () => {
  const large = { ...box("large", [0, 0, 0]), size: [400, 2, 2] as const };
  const edge = box("edge", [349, 0, 0]);
  const scene = project(s, { provenance: null, areas: [], cells: [], solids: [large, edge, box("near", [0, 0, 0])] }, 0, layers, ORBITS.tilt, 800, 480, null);
  expect(scene.primitives.filter(p => p.kind === "solid").map(p => p.id)).toEqual(["near"]);
});

test("the Canvas scalar clipper agrees with the polyline oracle for crossing, parallel and invisible edges", () => {
  for (let i = 0; i < 100; i++) {
    const a: [number, number] = [Math.sin(i * 2) * 800, Math.cos(i) * 600], b: [number, number] = [Math.cos(i * 3) * 900, Math.sin(i) * 700];
    let actual: number[][] = [];
    clipSegment(...a, ...b, -32, -32, 800 + 32, 480 + 32, (ax, ay, bx, by) => { actual = [[ax, ay], [bx, by]]; });
    const expected = clipToRect([a, b], -32, -32, 832, 512)[0]?.points ?? [];
    expect(actual.length).toBe(expected.length);
    for (let j = 0; j < actual.length; j++) for (let k = 0; k < 2; k++) expect(actual[j][k]).toBeCloseTo(expected[j][k], 9);
  }
});

test("significance's cheap bound never rejects visible geometry and exact reuse follows target and camera", () => {
  for (const orbit of Object.values(ORBITS)) for (let i = 0; i < 150; i++) {
    const shape = { ...box(String(i), [Math.sin(i) * 300, Math.cos(i * 2) * 300, Math.sin(i * 3) * 200]), size: [1 + i % 45, 3, 8] as const };
    const C = camera([0, 0, 0], orbit, 772, 580), g = solidGeometry(shape), exact = C.extent(g.corners), bound = C.boundExtent(shape.center, g.radius);
    if (!bound) { const drawing = solidDrawing(shape, C, 1); expect(drawing.lines.length + drawing.faces.length).toBe(0); }
    else if (g.corners.every(p => C.point(p))) expect(bound + 1e-8).toBeGreaterThanOrEqual(exact);
  }
  const world = { provenance: null, areas: [], cells: [], solids: [box("kept", [0, 0, 0])] }, first = project(s, world, 0, layers, ORBITS.tilt, 800, 480, null);
  expect(project(s, world, 1, layers, ORBITS.tilt, 800, 480, null).solids).toBe(first.solids);
  expect(project(s, world, 0, layers, { ...ORBITS.tilt, yaw: 1 }, 800, 480, null).solids).not.toBe(first.solids);
  const moved = { ...s, v: [{ ...s.v[0], position: [1000, 0, 0] as const }] };
  expect(project(moved, world, 0, layers, ORBITS.tilt, 800, 480, null).solids).toHaveLength(0);
});
