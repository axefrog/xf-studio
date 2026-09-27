import { describe, expect, test } from "bun:test";
import { layerEdgeReach, surfaceOutline } from "../src/engines/layered-makeup/surface-edge";
import { parseRecipePart } from "../src/recipe-schema";

/** A flat plate over UV [0.3, 0.7] × [0.18, 0.32] (z = 0), `n × m` quads, with the quads in `holes` left out (an eye opening). */
function plate(n: number, m: number, holes: (i: number, j: number) => boolean) {
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  // Every quad has its own vertices (split, as the head cut's are at its UV and normal seams): only the position weld joins them.
  const vertex = (i: number, j: number) => {
    const u = 0.3 + 0.4 * i / n, v = 0.18 + 0.14 * j / m;
    positions.push(u, v, 0); uvs.push(u, v); return positions.length / 3 - 1;
  };
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
    if (holes(i, j)) continue;
    const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i + 1, j + 1), d = vertex(i, j + 1);
    index.push(a, b, c, a, c, d);
  }
  return { positions, uvs, index };
}
const point = (u: number, v: number) => ({ u, v, weight: 1, handles: { mode: "corner", in: { u: 0, v: 0 }, out: { u: 0, v: 0 } } });
const layer = (v0: number, feather: number) => parseRecipePart({ uv: "gltf-uv0-top-left", layers: [{ id: "a", name: "Wash", enabled: true, color: "#000000",
  finish: "matte", opacity: 0.6, feather, symmetry: false, pathMode: "bezier", points: [point(0.4, v0), point(0.5, v0), point(0.5, 0.28), point(0.4, 0.28)],
  fields: [], strength: { mode: "smooth-boundary", blend: 0.0005 }, softness: { mode: "uniform" } }] }).layers[0]!;

describe("surface edge (PREV-146)", () => {
  const mesh = plate(20, 7, (i, j) => i >= 8 && i < 12 && j >= 3 && j < 5);
  const outline = surfaceOutline(mesh);

  test("the outline is the outer boundary: welded seams and the eye opening are not part of it", () => {
    expect(outline.segments.length / 4).toBe(2 * (20 + 7));
    for (let s = 0; s < outline.segments.length; s += 4) {
      const [u0, v0, u1, v1] = outline.segments.subarray(s, s + 4);
      const onRim = (u: number, v: number) => Math.abs(u - 0.3) < 1e-9 || Math.abs(u - 0.7) < 1e-9 || Math.abs(v - 0.18) < 1e-9 || Math.abs(v - 0.32) < 1e-9;
      expect(onRim(u0!, v0!) && onRim(u1!, v1!)).toBe(true);
    }
  });

  test("a wash feathered past the top edge is cut there; one that fades inside is not", () => {
    const cut = layerEdgeReach(layer(0.2, 0.06), outline, { axis: "u", centre: 0.5 });
    expect(cut.length).toBeGreaterThan(0);
    for (let s = 0; s < cut.length; s += 4) expect(Math.min(cut[s + 1]!, cut[s + 3]!)).toBeCloseTo(0.18, 9);
    expect(layerEdgeReach(layer(0.23, 0.004), outline, { axis: "u", centre: 0.5 }).length).toBe(0);
  });

  test("a hidden layer is judged as shown, and a layer's result is kept until the layer changes", () => {
    const shown = layer(0.2, 0.06), hidden = { ...shown, enabled: false };
    expect(layerEdgeReach(hidden, outline, { axis: "u", centre: 0.5 }).length).toBe(layerEdgeReach(shown, outline, { axis: "u", centre: 0.5 }).length);
    expect(layerEdgeReach(shown, outline, { axis: "u", centre: 0.5 })).toBe(layerEdgeReach(shown, outline, { axis: "u", centre: 0.5 }));
  });
});
