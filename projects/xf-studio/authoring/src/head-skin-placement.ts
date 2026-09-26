import * as THREE from "three";
import { sampleUnderlayAlbedo } from "./brow-material";
import { decodeSrgbByte, nearestVertices, sampleAtVertices } from "./decal-underlay";
import type { ResolvedSkinSurface } from "./character-material-adapters";
import type { DetailLimit } from "./detail-limits";
import { compareHeadSurfaces, type HeadSurface } from "./head-surface";
import { imageTexels, SKIN_TEMPLATE_DEFAULTS, skinRoughness, type SkinTexels } from "./skin-material";

/**
 * Renderer adapter that decides where the V's resolved skin is drawn, and reads the skin colour under decals
 * (brows) on that same head. The core head carries the eye plate cut and the idle binding, so the resolved
 * skin goes on it whenever the launch route's head is the same surface (one chunk, same positions, UVs,
 * triangles and facial morphs). Otherwise the resolved head is drawn itself and the core head is hidden, so
 * the two never overlap (PREV-42); a different shape reports the `head-shape` limit code, which the
 * presentation words. Decals are projected onto whichever head is drawn (PREV-41).
 */
export type HeadSkinPlacement = {
  mode: "core-head" | "resolved-head";
  /** Developer evidence: why (the surface comparison's reason). */
  reason: string;
  limit?: Extract<DetailLimit, "head-shape">;
};

/** A mesh's morph target names in influence order (GLTFLoader keys the dictionary by `extras.targetNames`). */
export function morphTargetNames(mesh: THREE.Mesh): string[] {
  const names: string[] = [];
  for (const [name, index] of Object.entries(mesh.morphTargetDictionary ?? {})) names[index] = name;
  return names;
}

/** A buffer attribute's values in vertex order (interleaved attributes included). */
function attributeValues(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): ArrayLike<number> {
  if (!(attribute instanceof THREE.InterleavedBufferAttribute)) return attribute.array;
  const out = new Float32Array(attribute.count * attribute.itemSize);
  for (let i = 0; i < attribute.count; i++) for (let k = 0; k < attribute.itemSize; k++) out[i * attribute.itemSize + k] = attribute.getComponent(i, k);
  return out;
}

/** The drawn surface of a head mesh, for comparing two exports of it (head-surface.ts). */
export function headSurface(mesh: THREE.Mesh): HeadSurface {
  const geometry = mesh.geometry, uv = geometry.getAttribute("uv");
  return { positions: attributeValues(geometry.getAttribute("position")), uvs: uv ? attributeValues(uv) : null, index: geometry.index?.array ?? null,
    morphNames: morphTargetNames(mesh), morphPositions: (geometry.morphAttributes.position ?? []).map(attributeValues) };
}

/**
 * Several chunks as one surface, in chunk order: positions and UVs concatenated, triangles re-indexed (a
 * non-indexed chunk contributes its vertices in order), and each facial morph's deltas concatenated, with
 * zero deltas for a chunk that lacks that morph. UVs are null when any chunk has none.
 */
export function mergeSurfaces(chunks: readonly HeadSurface[]): HeadSurface {
  if (chunks.length === 1) return chunks[0]!;
  const vertices = chunks.map(chunk => chunk.positions.length / 3), total = vertices.reduce((sum, n) => sum + n, 0);
  const positions = new Float32Array(total * 3), uvs = chunks.every(chunk => chunk.uvs) ? new Float32Array(total * 2) : null;
  const triangles = chunks.reduce((sum, chunk, i) => sum + (chunk.index?.length ?? vertices[i]!), 0), index = new Uint32Array(triangles);
  const names = [...new Set(chunks.flatMap(chunk => chunk.morphNames))];
  const morphPositions = names.map(() => new Float32Array(total * 3));
  let base = 0, at = 0;
  chunks.forEach((chunk, i) => {
    positions.set(chunk.positions, base * 3);
    if (uvs) uvs.set(chunk.uvs!, base * 2);
    if (chunk.index) for (let k = 0; k < chunk.index.length; k++) index[at++] = chunk.index[k]! + base;
    else for (let k = 0; k < vertices[i]!; k++) index[at++] = base + k;
    chunk.morphNames.forEach((name, m) => morphPositions[names.indexOf(name)]!.set(chunk.morphPositions[m] ?? [], base * 3));
    base += vertices[i]!;
  });
  return { positions, uvs, index, morphNames: names, morphPositions };
}

/** Where the resolved skin's chunks are drawn, compared with the core head. Pure. */
export function placeHeadSkin(core: HeadSurface, chunks: readonly HeadSurface[]): HeadSkinPlacement {
  if (!chunks.length) throw Error("A resolved skin has at least one chunk.");
  const comparison = compareHeadSurfaces(core, mergeSurfaces(chunks));
  if (chunks.length === 1 && comparison.same) return { mode: "core-head", reason: comparison.reason };
  // Several chunks can't share the core head's one material: draw them as they are, instead of the core head.
  if (comparison.same) return { mode: "resolved-head", reason: `same surface over ${chunks.length} chunks, each with its own material` };
  return { mode: "resolved-head", reason: chunks.length > 1 ? `${comparison.reason} (${chunks.length} chunks)` : comparison.reason, limit: "head-shape" };
}

/** Bind-pose world positions of a mesh's vertices. */
function worldPositions(mesh: THREE.Mesh): Float32Array {
  mesh.updateWorldMatrix(true, false);
  const source = mesh.geometry.getAttribute("position"), out = new Float32Array(source.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < source.count; i++) v.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld).toArray(out, i * 3);
  return out;
}
function concatenate(parts: readonly ArrayLike<number>[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

export type BrowUnderlayEvidence = { maxMatchedDistance: number; unmatched: number; source: "resolved-skin" | "core-albedo";
  surface: HeadSkinPlacement["mode"] };
/**
 * The skin under a face decal, per vertex: linear colour (3), roughness (1) and metalness (1), read on the drawn head.
 * `roughness` in the evidence names where both surface values came from.
 */
export type DecalSurfaceUnderlay = { colour: THREE.BufferAttribute; roughness: THREE.BufferAttribute; metalness: THREE.BufferAttribute;
  evidence: BrowUnderlayEvidence & { roughness: "resolved-skin" | "core-roughness" | "flat" } };
/** Roughness assumed under a decal when no skin roughness can be read (bare lid skin reads about 0.6; head-cc-rendering.md §3). */
export const FLAT_SKIN_ROUGHNESS = 0.6;

/** 8-bit sRGB pixels of a loaded image, read once through a canvas (browser only). */
function canvasTexels(image: CanvasImageSource & { width: number; height: number }): SkinTexels {
  const canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw Error("Cannot read the head albedo for the brow decal blend");
  context.drawImage(image, 0, 0);
  return imageTexels(context.getImageData(0, 0, image.width, image.height));
}

/**
 * The placement adapter for one core head. `place` is remembered per loaded skin (the same chunk list gives
 * the same answer to the decal loader and to the scene). `underlay` returns the linear skin colour under
 * each vertex of a decal, read on the head that will be drawn; it throws when that is not possible.
 */
export function createHeadSkinPlacement(core: THREE.Mesh, options: { coreAlbedo(): SkinTexels;
  /** The core head's surface as bytes: effective roughness in channel 0, metalness in channel 1 (face decals); optional. */
  coreRoughness?(): SkinTexels | null }) {
  let coreSurface: HeadSurface | undefined, coreAlbedo: SkinTexels | undefined, coreRoughness: SkinTexels | null | undefined;
  const placements = new WeakMap<readonly THREE.Mesh[], HeadSkinPlacement>();
  function place(chunks: readonly THREE.Mesh[]): HeadSkinPlacement {
    let placement = placements.get(chunks);
    if (!placement) {
      coreSurface ??= headSurface(core);
      placement = placeHeadSkin(coreSurface, chunks.map(headSurface));
      placements.set(chunks, placement);
    }
    return placement;
  }
  function underlay(decal: THREE.Mesh, skin: ResolvedSkinSurface | null): { attribute: THREE.BufferAttribute; evidence: BrowUnderlayEvidence } {
    const surface = skin ? place(skin.chunks).mode : "core-head";
    const texels = skin?.base() ?? null;
    // The core albedo belongs to the core head's UVs; a head of another shape has only its own skin colour.
    if (surface === "resolved-head" && !texels) throw Error("the resolved head's skin colour is unavailable");
    const meshes = surface === "resolved-head" ? skin!.chunks : [core];
    const uvs = meshes.map(mesh => mesh.geometry.getAttribute("uv")?.array);
    if (uvs.some(uv => !uv)) throw Error("the drawn head has no UVs");
    const result = sampleUnderlayAlbedo(worldPositions(decal), concatenate(meshes.map(worldPositions)), concatenate(uvs as ArrayLike<number>[]),
      texels ?? (coreAlbedo ??= options.coreAlbedo()));
    if (result.unmatched) throw Error(`${result.unmatched} decal vertices are not over the head surface`);
    return { attribute: new THREE.BufferAttribute(result.underlay, 3),
      evidence: { maxMatchedDistance: result.maxMatchedDistance, unmatched: result.unmatched, source: texels ? "resolved-skin" : "core-albedo", surface } };
  }
  /**
   * The skin colour, roughness and metalness under each vertex of a face decal, read on the head that will be drawn (one
   * nearest-vertex search for all three). Throws when the decal is not over that head.
   */
  function surfaceUnderlay(decal: THREE.Mesh, skin: ResolvedSkinSurface | null): DecalSurfaceUnderlay {
    const surface = skin ? place(skin.chunks).mode : "core-head";
    const texels = skin?.base() ?? null;
    if (surface === "resolved-head" && !texels) throw Error("the resolved head's skin colour is unavailable");
    const meshes = surface === "resolved-head" ? skin!.chunks : [core];
    const uvArrays = meshes.map(mesh => mesh.geometry.getAttribute("uv")?.array);
    if (uvArrays.some(uv => !uv)) throw Error("the drawn head has no UVs");
    const uvs = concatenate(uvArrays as ArrayLike<number>[]);
    const nearest = nearestVertices(worldPositions(decal), concatenate(meshes.map(worldPositions)));
    if (nearest.unmatched) throw Error(`${nearest.unmatched} decal vertices are not over the head surface`);
    const colour = sampleAtVertices(nearest, uvs, texels ?? (coreAlbedo ??= options.coreAlbedo()), 3, decodeSrgbByte);
    // The resolved skin's surface; the core head's only while no resolved skin is drawn. Channel 0 is roughness, 1 metalness
    // (the skin writes its Roughness map's G there; a decal that writes a partial surface keeps the rest of it, PREV-52).
    let roughTexels = skin?.roughness?.() ?? null;
    if (!skin) roughTexels = coreRoughness === undefined ? (coreRoughness = options.coreRoughness?.() ?? null) : coreRoughness;
    const count = nearest.index.length, roughness = new Float32Array(count).fill(FLAT_SKIN_ROUGHNESS), metalness = new Float32Array(count);
    if (roughTexels) {
      const surface = sampleAtVertices(nearest, uvs, roughTexels, 2, byte => byte / 255);
      for (let i = 0; i < count; i++) { roughness[i] = surface[i * 2]!; metalness[i] = surface[i * 2 + 1]!; }
    }
    return { colour: new THREE.BufferAttribute(colour, 3), roughness: new THREE.BufferAttribute(roughness, 1),
      metalness: new THREE.BufferAttribute(metalness, 1),
      evidence: { maxMatchedDistance: nearest.maxMatchedDistance, unmatched: nearest.unmatched, source: texels ? "resolved-skin" : "core-albedo", surface,
        roughness: !roughTexels ? "flat" : skin ? "resolved-skin" : "core-roughness" } };
  }
  return { place, underlay, surfaceUnderlay };
}

/**
 * The skin colour, roughness and metalness under each vertex of a decal over resolved skins that are not the head (the body's tattoos,
 * scars and underwear cover over the body, its feet and arms), read by the nearest vertex of any of their chunks on that skin's own
 * maps, as the face decals read the head. Throws when a skin's colour can't be read or the decal is not over them.
 */
export function skinSurfaceUnderlay(decal: THREE.Mesh, skins: readonly ResolvedSkinSurface[]): DecalSurfaceUnderlay {
  if (!skins.length) throw Error("no skin lies under this decal");
  const chunks = skins.flatMap(skin => skin.chunks);
  const uvArrays = chunks.map(mesh => mesh.geometry.getAttribute("uv")?.array);
  if (uvArrays.some(uv => !uv)) throw Error("the skin under this decal has no UVs");
  // Which skin each source vertex belongs to.
  const owner: number[] = [];
  skins.forEach((skin, s) => { for (const mesh of skin.chunks) for (let i = mesh.geometry.getAttribute("position").count; i > 0; i--) owner.push(s); });
  const uvs = concatenate(uvArrays as ArrayLike<number>[]);
  const nearest = nearestVertices(worldPositions(decal), concatenate(chunks.map(worldPositions)));
  if (nearest.unmatched) throw Error(`${nearest.unmatched} decal vertices are not over the skin`);
  const count = nearest.index.length, colour = new Float32Array(count * 3);
  const roughness = new Float32Array(count).fill(FLAT_SKIN_ROUGHNESS), metalness = new Float32Array(count);
  let rough = "flat" as "flat" | "resolved-skin";
  skins.forEach((skin, s) => {
    const own = { ...nearest, index: nearest.index.map(source => source >= 0 && owner[source] === s ? source : -1) };
    if (!own.index.some(source => source >= 0)) return;
    const texels = skin.base();
    if (!texels) throw Error("the skin colour under this decal is unavailable");
    const sampled = sampleAtVertices(own, uvs, texels, 3, decodeSrgbByte);
    const roughTexels = skin.roughness?.() ?? null;
    const surface = roughTexels ? sampleAtVertices(own, uvs, roughTexels, 2, byte => byte / 255) : null;
    if (surface) rough = "resolved-skin";
    own.index.forEach((source, t) => {
      if (source < 0) return;
      colour.set(sampled.subarray(t * 3, t * 3 + 3), t * 3);
      if (surface) { roughness[t] = surface[t * 2]!; metalness[t] = surface[t * 2 + 1]!; }
    });
  });
  return { colour: new THREE.BufferAttribute(colour, 3), roughness: new THREE.BufferAttribute(roughness, 1),
    metalness: new THREE.BufferAttribute(metalness, 1),
    evidence: { maxMatchedDistance: nearest.maxMatchedDistance, unmatched: nearest.unmatched, source: "resolved-skin", surface: "resolved-head",
      roughness: rough } };
}

/**
 * The core head's roughness as effective roughness bytes (channel 0: R with the template's detail bias gated by B at a mid
 * microdetail term), read through a canvas once, or null when it can't be read (face decals then assume a flat value).
 * Channel 1 is the core head's metalness, which is zero (its default material has none).
 */
export const coreRoughnessReader = (roughness: THREE.Texture) => (): SkinTexels | null => {
  try {
    const raw = canvasTexels(roughness.image as CanvasImageSource & { width: number; height: number });
    const bias = [SKIN_TEMPLATE_DEFAULTS.DetailRoughnessBiasMin, SKIN_TEMPLATE_DEFAULTS.DetailRoughnessBiasMax] as const;
    return { width: raw.width, height: raw.height,
      texel: (x, y, channel) => channel === 0 ? Math.round(skinRoughness(raw.texel(x, y, 0) / 255, raw.texel(x, y, 2) / 255, bias, 0.5) * 255) : 0 };
  } catch { return null; }
};

/** The core albedo reader the scene uses: the core head's own albedo texture, read through a canvas once. */
export const coreAlbedoReader = (albedo: THREE.Texture) => () => canvasTexels(albedo.image as CanvasImageSource & { width: number; height: number });
