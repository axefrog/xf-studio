import { expect, test } from "bun:test";
import * as THREE from "three";
import { createHeadSkinPlacement, headSurface, mergeSurfaces, placeHeadSkin } from "../src/head-skin-placement";
import type { SkinTexels } from "../src/skin-material";

/**
 * A square patch of head: `n`×`n` vertices over 10 cm at depth `z`, UVs across it (mirrored in u when
 * `mirrorU`), and one facial morph. `rows` limits it to a band of rows, so two bands form one surface.
 */
function patch(options: { z?: number; mirrorU?: boolean; rows?: [number, number]; morph?: number } = {}): THREE.Mesh {
  const n = 5, [first, last] = options.rows ?? [0, n - 1];
  const positions: number[] = [], uvs: number[] = [], index: number[] = [], morph: number[] = [];
  for (let y = first; y <= last; y++) for (let x = 0; x < n; x++) {
    positions.push(x * 0.025, 1.6 + y * 0.025, options.z ?? 0);
    uvs.push(options.mirrorU ? 1 - x / (n - 1) : x / (n - 1), y / (n - 1));
    morph.push(0, 0, options.morph ?? 0.001);
  }
  const width = n, rows = last - first + 1;
  for (let y = 0; y < rows - 1; y++) for (let x = 0; x < width - 1; x++) {
    const a = y * width + x;
    index.push(a, a + 1, a + width, a + 1, a + width + 1, a + width);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  const delta = new THREE.Float32BufferAttribute(morph, 3); delta.name = "h001_eyes";
  geometry.morphAttributes.position = [delta];
  const mesh = new THREE.Mesh(geometry);
  mesh.updateMorphTargets();
  return mesh;
}
/** A 16×16 image whose red rises with u and green with v (8-bit sRGB). */
const gradient: SkinTexels = { width: 16, height: 16, texel: (x, y, c) => c === 0 ? x * 16 : c === 1 ? y * 16 : 0 };
const flat = (value: number): SkinTexels => ({ width: 16, height: 16, texel: () => value });

test("the resolved skin goes on the core head only when it is the same one-chunk surface", () => {
  const core = headSurface(patch());
  expect(placeHeadSkin(core, [headSurface(patch())])).toEqual({ mode: "core-head", reason: "same surface" });
  const moved = placeHeadSkin(core, [headSurface(patch({ z: 0.004 }))]);
  expect(moved).toEqual({ mode: "resolved-head", reason: "vertex positions differ", limit: "head-shape" });
  expect(placeHeadSkin(core, [headSurface(patch({ morph: 0.002 }))]).limit).toBe("head-shape");
});

test("a skin component with several chunks is compared over all of them and drawn instead of the core head (PREV-42)", () => {
  const core = headSurface(patch());
  // Two bands of rows; a core head that is exactly those two bands in one mesh is the same surface.
  const bands = [patch({ rows: [0, 2] }), patch({ rows: [3, 4] })];
  const [split, rest] = bands.map(headSurface) as [ReturnType<typeof headSurface>, ReturnType<typeof headSurface>];
  const merged = mergeSurfaces([split, rest]);
  const same = placeHeadSkin(merged, bands.map(headSurface));
  // Several chunks can't share the core head's one material: never both drawn (no z-fighting), no shape limit.
  expect(same).toEqual({ mode: "resolved-head", reason: "same surface over 2 chunks, each with its own material" });
  expect(merged.positions.length).toBe(split.positions.length + rest.positions.length);
  expect(Array.from(merged.index!).slice(-3).every(i => i >= split.positions.length / 3)).toBe(true);
  // Chunks that differ from the core surface report the head-shape limit.
  const different = placeHeadSkin(core, bands.map(headSurface));
  expect(different.mode).toBe("resolved-head");
  expect(different.limit).toBe("head-shape");
  expect(different.reason).toContain("2 chunks");
});

test("merged chunks keep each facial morph, with zero deltas where a chunk lacks it", () => {
  const a = headSurface(patch({ rows: [0, 1] })), b = { ...headSurface(patch({ rows: [2, 3] })), morphNames: [], morphPositions: [] };
  const merged = mergeSurfaces([a, b]);
  expect(merged.morphNames).toEqual(["h001_eyes"]);
  const deltas = merged.morphPositions[0]!;
  expect(deltas[2]).toBeCloseTo(0.001, 9);
  expect(deltas[a.positions.length + 2]).toBe(0);
});

test("the brow underlay reads the skin on whichever head is drawn (PREV-41)", () => {
  const core = patch();
  // A mod's head of another shape (4 mm forward) whose UVs run the other way: the core head's UVs would read the wrong texels.
  const resolved = patch({ z: 0.004, mirrorU: true });
  const placement = createHeadSkinPlacement(core, { coreAlbedo: () => flat(40) });
  const decal = patch({ z: 0.0045, rows: [1, 2] });
  const skin = { base: () => gradient, chunks: [resolved] };
  expect(placement.place(skin.chunks).mode).toBe("resolved-head");
  const onResolved = placement.underlay(decal, skin);
  expect(onResolved.evidence).toMatchObject({ source: "resolved-skin", surface: "resolved-head", unmatched: 0 });
  expect(onResolved.evidence.maxMatchedDistance).toBeCloseTo(0.0005, 6);
  // The decal's second vertex sits over the resolved head's u = 0.75 (mirrored) and its fourth over u = 0.25.
  const red = (attribute: THREE.BufferAttribute, vertex: number) => attribute.getX(vertex);
  expect(red(onResolved.attribute, 1)).toBeGreaterThan(red(onResolved.attribute, 3));
  // The same skin on the core head's surface reads those texels the other way round.
  const sameShape = { base: () => gradient, chunks: [patch()] };
  const onCore = placement.underlay(patch({ z: 0.0005, rows: [1, 2] }), sameShape);
  expect(onCore.evidence).toMatchObject({ source: "resolved-skin", surface: "core-head" });
  expect(red(onCore.attribute, 1)).toBeLessThan(red(onCore.attribute, 3));
  // Placement is decided once per loaded skin: the scene gets the answer the decals were projected with.
  expect(placement.place(skin.chunks)).toBe(placement.place(skin.chunks));
});

test("without a resolved skin the underlay reads the core albedo on the core head; a reshaped head needs its own skin colour", () => {
  const core = patch();
  let reads = 0;
  const placement = createHeadSkinPlacement(core, { coreAlbedo: () => { reads++; return flat(128); } });
  const decal = patch({ z: 0.0005, rows: [1, 2] });
  const first = placement.underlay(decal, null), second = placement.underlay(decal, null);
  expect(first.evidence).toMatchObject({ source: "core-albedo", surface: "core-head" });
  expect(first.attribute.getX(0)).toBeCloseTo(Math.pow((128 / 255 + 0.055) / 1.055, 2.4), 6);
  expect(second.attribute.array).toEqual(first.attribute.array);
  // The core albedo is read once per scene, not per V load.
  expect(reads).toBe(1);
  const reshaped = { base: () => null, chunks: [patch({ z: 0.004 })] };
  expect(() => placement.underlay(patch({ z: 0.0045, rows: [1, 2] }), reshaped)).toThrow("skin colour is unavailable");
  // A decal away from the drawn head is refused rather than coloured from the wrong place.
  expect(() => placement.underlay(patch({ z: 0.2 }), null)).toThrow("not over the head surface");
});

test("a face decal's surface underlay carries the skin's roughness and metalness, so a partial surface write keeps both (PREV-52)", () => {
  const core = patch();
  // The resolved skin's surface bytes: roughness in channel 0, metalness (its Roughness map's G) in channel 1.
  const surface: SkinTexels = { width: 16, height: 16, texel: (_x, _y, c) => c === 0 ? 153 : c === 1 ? 51 : 255 };
  const placement = createHeadSkinPlacement(core, { coreAlbedo: () => flat(128), coreRoughness: () => ({ width: 16, height: 16, texel: (_x, _y, c) => c === 0 ? 102 : 0 }) });
  const decal = patch({ z: 0.0004, rows: [1, 2] });
  const resolved = placement.surfaceUnderlay(decal, { base: () => flat(128), chunks: [patch()], roughness: () => surface });
  expect(resolved.evidence.roughness).toBe("resolved-skin");
  expect(resolved.roughness.getX(0)).toBeCloseTo(0.6, 6);
  expect(resolved.metalness.getX(0)).toBeCloseTo(0.2, 6);
  expect(resolved.metalness.count).toBe(resolved.roughness.count);
  // The core head has no metalness; without any surface reading the flat skin roughness and zero metalness stand in.
  const coreOnly = placement.surfaceUnderlay(decal, null);
  expect([coreOnly.evidence.roughness, coreOnly.metalness.getX(0)]).toEqual(["core-roughness", 0]);
  expect(coreOnly.roughness.getX(0)).toBeCloseTo(0.4, 6);
  const bare = createHeadSkinPlacement(core, { coreAlbedo: () => flat(128) }).surfaceUnderlay(decal, null);
  expect([bare.evidence.roughness, bare.metalness.getX(0)]).toEqual(["flat", 0]);
  expect(bare.roughness.getX(0)).toBeCloseTo(0.6, 6);
});
