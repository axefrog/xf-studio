import * as THREE from "three";

/**
 * Light that reaches the mouth interior, for the preview, whose shadow maps and contact march can't close a lip parting of a few millimetres.
 *
 * In game the teeth sit about 13 mm behind the lip surface (the vanilla female teeth and head meshes at rest [resource: measured on the
 * exported meshes]), and whatever light reaches them comes through the parting of the lips: shadow maps, screen-space ambient occlusion,
 * contact shadows and the subsurface blur across the lips darken the interior [hypothesis: the game's occlusion passes are not decoded].
 *
 * The stand-in, per vertex of a part drawn inside the head: its depth `d` behind the face (the frontmost surface of the drawn head straight
 * in front of it, along the face's forward axis), baked once as a vertex attribute; and the share of the outside a point at that depth sees
 * through a lip parting of height `h` (a slit in front of the point: `(h/2) / √((h/2)² + d²)`, the sine of its half-angle), kept above a
 * floor. **`h` is the lips' real aperture each frame** (PREV-147 step A): the renderer measures it on the posed face (mouth-aperture.ts)
 * and writes it to a uniform the interior's program reads, so the closed mouth keeps only the floor, the creator idle's breaths (2.75–2.91
 * mm) give the front teeth about 0.11, the teeth page's 15 mm about 0.5, and a wide smile opens further. A vertex with no head surface in
 * front of it is not inside the head and keeps all its light. Every light term (direct and ambient, diffuse and specular) is scaled by
 * the factor, since shadows and occlusion both act there.
 *
 * Nothing here depends on which part it is; the loader applies it to the teeth slot (the creator's mouth interior).
 * The floor is a Studio choice [hypothesis], to be settled by capture C1 (the game's teeth-to-lip luminance at the breaths); whether the game
 * darkens the interior this way at all is unproven until then (research/character-customization/render-gap-plans.md §1).
 */
export const MOUTH_OCCLUSION = Object.freeze({
  /**
   * The parting assumed where the face's lip joints can't be read (no face data for this head, a developer's prepared idle): the earlier
   * stand-in's fixed 10 mm, so such a head looks as it did before.
   */
  unknownParting: 0.010,
  /** The least share of light any interior vertex keeps (was 0.3 with the fixed parting). */
  floor: 0.05,
  /** How far in front of a vertex the head surface may be to count (metres). */
  reach: 0.08,
});
/**
 * What the interior's program reads, one pair per scene: the lips' aperture (metres), which the renderer writes each frame, and the floor
 * (`MOUTH_OCCLUSION.floor`; a developer comparison may set the earlier stand-in's).
 */
export type MouthInteriorUniforms = { readonly parting: { value: number }; readonly floor: { value: number } };
export const mouthInteriorUniforms = (): MouthInteriorUniforms => ({ parting: { value: MOUTH_OCCLUSION.unknownParting }, floor: { value: MOUTH_OCCLUSION.floor } });

/** The share of light a point `depth` metres behind a lip parting of `parting` metres keeps (before the floor). */
export const partingVisibility = (depth: number, parting: number = MOUTH_OCCLUSION.unknownParting) => {
  const half = Math.max(0, parting) / 2;
  return depth <= 0 ? 1 : half / Math.hypot(half, depth);
};
/** The factor the program applies: all of the light outside the head (`depth` 0), else the visibility kept above the floor. */
export const interiorLight = (depth: number, parting: number, floor: number = MOUTH_OCCLUSION.floor) =>
  depth <= 0 ? 1 : Math.max(floor, partingVisibility(depth, parting));

/**
 * Each interior vertex's depth behind the face (world positions, xyz), from the drawn head's triangles (world positions and indices): the
 * frontmost head surface in reach straight in front of it, or 0 where there is none (the vertex is not inside the head). `forward` is the
 * face's forward axis in the same space: the preview's V faces −Z. Pure; tests call it with plain arrays.
 */
export function interiorDepths(inside: ArrayLike<number>, head: readonly { positions: ArrayLike<number>; index: ArrayLike<number> }[],
  options: { forward?: 1 | -1; reach?: number } = {}): Float32Array {
  const forward = options.forward ?? -1, reach = options.reach ?? MOUTH_OCCLUSION.reach;
  const count = Math.floor(inside.length / 3), out = new Float32Array(count);
  if (!count) return out;
  // Only triangles over the interior's footprint (in the plane across the forward axis) can lie in front of it.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = inside[i * 3]!, y = inside[i * 3 + 1]!;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // A uniform grid over that footprint: each cell lists the triangles whose box touches it.
  const cell = 0.002, columns = Math.max(1, Math.ceil((maxX - minX) / cell) + 1), rows = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  const grid: number[][] = Array.from({ length: columns * rows }, () => []);
  const triangles: number[] = [];
  for (const { positions, index } of head) {
    for (let t = 0; t + 2 < index.length; t += 3) {
      const a = index[t]! * 3, b = index[t + 1]! * 3, c = index[t + 2]! * 3;
      const x0 = Math.min(positions[a]!, positions[b]!, positions[c]!), x1 = Math.max(positions[a]!, positions[b]!, positions[c]!);
      const y0 = Math.min(positions[a + 1]!, positions[b + 1]!, positions[c + 1]!), y1 = Math.max(positions[a + 1]!, positions[b + 1]!, positions[c + 1]!);
      if (x1 < minX || x0 > maxX || y1 < minY || y0 > maxY) continue;
      const id = triangles.length;
      triangles.push(positions[a]!, positions[a + 1]!, positions[a + 2]!, positions[b]!, positions[b + 1]!, positions[b + 2]!,
        positions[c]!, positions[c + 1]!, positions[c + 2]!);
      const c0 = Math.max(0, Math.floor((x0 - minX) / cell)), c1 = Math.min(columns - 1, Math.floor((x1 - minX) / cell));
      const r0 = Math.max(0, Math.floor((y0 - minY) / cell)), r1 = Math.min(rows - 1, Math.floor((y1 - minY) / cell));
      for (let r = r0; r <= r1; r++) for (let q = c0; q <= c1; q++) grid[r * columns + q]!.push(id);
    }
  }
  for (let i = 0; i < count; i++) {
    const x = inside[i * 3]!, y = inside[i * 3 + 1]!, z = inside[i * 3 + 2]!;
    const q = Math.min(columns - 1, Math.floor((x - minX) / cell)), r = Math.min(rows - 1, Math.floor((y - minY) / cell));
    let depth = -1;
    for (const id of grid[r * columns + q]!) {
      const t = id;
      const ax = triangles[t]!, ay = triangles[t + 1]!, az = triangles[t + 2]!, bx = triangles[t + 3]!, by = triangles[t + 4]!, bz = triangles[t + 5]!;
      const cx = triangles[t + 6]!, cy = triangles[t + 7]!, cz = triangles[t + 8]!;
      // The ray runs along the forward axis, so the hit is a 2D point-in-triangle test and the depth is the interpolated z.
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-14) continue;
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det, v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det, w = 1 - u - v;
      if (u < 0 || v < 0 || w < 0) continue;
      const along = ((u * az + v * bz + w * cz) - z) * forward;
      if (along > 0 && along <= reach) depth = Math.max(depth, along);
    }
    if (depth > 0) out[i] = depth;
  }
  return out;
}

/** Occlusion factors at one parting (the program's arithmetic on the CPU): for notes, tests and offline checks. */
export function interiorOcclusion(inside: ArrayLike<number>, head: readonly { positions: ArrayLike<number>; index: ArrayLike<number> }[],
  options: { forward?: 1 | -1; parting?: number; floor?: number; reach?: number } = {}): Float32Array {
  const parting = options.parting ?? MOUTH_OCCLUSION.unknownParting, floor = options.floor ?? MOUTH_OCCLUSION.floor;
  return interiorDepths(inside, head, options).map(depth => interiorLight(depth, parting, floor));
}

/** Bind-pose world positions and triangle indices of a mesh (an unindexed mesh reads as consecutive triangles). */
export function worldTriangles(mesh: THREE.Mesh): { positions: Float32Array; index: ArrayLike<number> } {
  mesh.updateWorldMatrix(true, false);
  const source = mesh.geometry.getAttribute("position"), positions = new Float32Array(source.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < source.count; i++) v.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
  const index = mesh.geometry.index?.array ?? Uint32Array.from({ length: source.count }, (_, i) => i);
  return { positions, index };
}

const OCCLUSION_VERTEX = /* glsl */`
attribute float xfsInteriorDepth;
uniform float xfsMouthParting;
uniform float xfsMouthFloor;
varying float vXfsOcclusion;`;
// The interior's light, per vertex: `interiorLight` (above) with the scene's measured parting.
const OCCLUSION_BEGIN = /* glsl */`
{
  float xfsHalf = 0.5 * max(xfsMouthParting, 0.0);
  vXfsOcclusion = xfsInteriorDepth <= 0.0 ? 1.0 : max(xfsMouthFloor, xfsHalf / max(length(vec2(xfsHalf, xfsInteriorDepth)), 1e-6));
}`;
const OCCLUSION_FRAGMENT = /* glsl */`
reflectedLight.directDiffuse *= vXfsOcclusion;
reflectedLight.directSpecular *= vXfsOcclusion;
reflectedLight.indirectDiffuse *= vXfsOcclusion;
reflectedLight.indirectSpecular *= vXfsOcclusion;
#ifdef XFS_SCATTER_INPUT
xfsScatterE *= vXfsOcclusion; // the skin light's scatter input (skin-material.ts): the teeth's irradiance is occluded too
#endif`;

/**
 * Patch a lit Three program (standard or physical) to scale every light term by the interior's light: the `xfsInteriorDepth` vertex
 * attribute and the parting and floor uniforms (bound to `uniforms` when given: the scene's shared parting).
 */
export function patchOcclusionShader(shader: { vertexShader: string; fragmentShader: string; uniforms?: Record<string, { value: unknown }> },
  uniforms?: MouthInteriorUniforms) {
  const need = (source: string, find: string) => { if (!source.includes(find)) throw Error(`The occlusion patch expects ${find} in this Three.js build.`); };
  need(shader.vertexShader, "#include <common>"); need(shader.vertexShader, "#include <begin_vertex>");
  need(shader.fragmentShader, "#include <common>"); need(shader.fragmentShader, "#include <aomap_fragment>");
  shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${OCCLUSION_VERTEX}`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>\n${OCCLUSION_BEGIN}`);
  shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vXfsOcclusion;")
    .replace("#include <aomap_fragment>", `#include <aomap_fragment>\n${OCCLUSION_FRAGMENT}`);
  if (uniforms && shader.uniforms) { shader.uniforms.xfsMouthParting = uniforms.parting; shader.uniforms.xfsMouthFloor = uniforms.floor; }
  return shader;
}

/**
 * Give a drawn interior part its occlusion: each vertex's depth behind the drawn head as the mesh's `xfsInteriorDepth` attribute, and the
 * material's program patched to light it through `uniforms` (the scene's measured aperture and floor; chained after the adapter's own patch, with its
 * own program key). Returns the depths' range and the factors at the parting now, for the part's notes.
 */
export function attachInteriorOcclusion(mesh: THREE.Mesh, material: THREE.Material, head: readonly THREE.Mesh[],
  uniforms: MouthInteriorUniforms = mouthInteriorUniforms()): { depth: { min: number; max: number }; min: number; max: number } {
  const depths = interiorDepths(worldTriangles(mesh).positions, head.map(worldTriangles));
  mesh.geometry.setAttribute("xfsInteriorDepth", new THREE.BufferAttribute(depths, 1));
  const previous = material.onBeforeCompile.bind(material), key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => { previous(shader, renderer); patchOcclusionShader(shader, uniforms); };
  material.customProgramCacheKey = () => `${key()}|xfs-occlusion-2`;
  material.needsUpdate = true;
  let min = 1, max = 0, near = Infinity, far = 0;
  for (const depth of depths) {
    const factor = interiorLight(depth, uniforms.parting.value, uniforms.floor.value);
    min = Math.min(min, factor); max = Math.max(max, factor);
    if (depth > 0) { near = Math.min(near, depth); far = Math.max(far, depth); }
  }
  return { depth: { min: Number.isFinite(near) ? near : 0, max: far }, min, max };
}
