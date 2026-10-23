/**
 * Morph-target textures made ahead, in steps (profiles phase 4a-vi, experiment 043 §13).
 *
 * Three r186 encodes a geometry's morph targets into one float `DataArrayTexture` (one layer per target, each vertex's position delta, then
 * its normal and colour deltas when the geometry has them) at the first draw of a mesh that uses it (`WebGLMorphtargets.update`): it fills
 * the whole buffer and uploads it whole, inside the draw's task. For the head's 105 targets that task took 50–102 ms on real data, the last
 * page task over 50 ms in G2 (043 §12). Three keeps the texture in a map private to the renderer, keyed by geometry, and builds one only
 * when the geometry has none for its count of targets.
 *
 * So a runtime's preparation makes the same texture ahead (`morphTextureSteps`): the buffer filled a few layers at a time, exactly as Three
 * fills it, each batch of layers uploaded on its own (`DataArrayTexture.layerUpdates`), and the finished texture put in Three's map with the
 * entry Three would have made, so the first draw finds it ready and builds nothing. Nothing of it is drawn before it is complete.
 *
 * **Finding Three's map.** It is a `WeakMap` inside the renderer that Three exposes no way to reach. The first draw of a morph geometry on a
 * renderer (a runtime's warm-up) is watched (`watchMorphMap`): of the `WeakMap`s read with that geometry as the key during the draw, the one
 * holding afterwards an entry of Three's shape (`{ count, texture: DataArrayTexture, size: Vector2 }`) is Three's. Until it is found, nothing
 * is made ahead and Three builds its own at the draw, as before: the first runtime on a renderer pays it (the first load, outside the switch
 * gates). Three makes a new map when the context is restored, so a map found belongs to its context's generation (context-generation.ts)
 * and is looked for again after a restore. The revision is checked (`REVISION` 186): another Three falls back to its own build.
 */
import * as THREE from "three";
import { contextGeneration, inGeneration } from "./context-generation";

/** Three's entry for a geometry's morph texture (WebGLMorphtargets, r186). */
type MorphEntry = { count: number; texture: THREE.DataArrayTexture; size: THREE.Vector2 };
type MorphMap = WeakMap<THREE.BufferGeometry, MorphEntry>;
/** The Three revision whose morph textures this module reproduces. */
export const MORPH_TEXTURE_REVISION = "186";

const maps = new WeakMap<object, { map: MorphMap; generation: AbortSignal }>();
const isEntry = (value: unknown): value is MorphEntry => {
  const entry = value as Partial<MorphEntry> | undefined;
  return !!entry && typeof entry.count === "number" && entry.texture?.isDataArrayTexture === true && (entry.size as THREE.Vector2 | undefined)?.isVector2 === true;
};

/** Three's map of morph textures for `renderer`'s current context, once a draw has shown it (`watchMorphMap`). */
export function morphTextureMap(renderer: THREE.WebGLRenderer): MorphMap | undefined {
  const found = maps.get(renderer);
  return found && inGeneration(renderer, found.generation) ? found.map : undefined;
}

/** Whether `object` draws with morph targets (Three builds a morph texture for its geometry). */
export function morphGeometry(object: THREE.Object3D): THREE.BufferGeometry | undefined {
  const geometry = (object as THREE.Mesh).isMesh ? (object as THREE.Mesh).geometry : undefined;
  const morphs = geometry?.morphAttributes;
  return morphs && (morphs.position !== undefined || morphs.normal !== undefined || morphs.color !== undefined) ? geometry : undefined;
}

/**
 * Run `draw` (a draw that may build the morph textures of `geometries`), and learn Three's map from it while the renderer's isn't known.
 * See the module header.
 */
export function watchMorphMap<T>(renderer: THREE.WebGLRenderer, geometries: readonly THREE.BufferGeometry[], draw: () => T): T {
  if (!geometries.length || THREE.REVISION !== MORPH_TEXTURE_REVISION || morphTextureMap(renderer)) return draw();
  const keys = new Set<object>(geometries), seen = new Set<WeakMap<object, unknown>>();
  const get = WeakMap.prototype.get;
  WeakMap.prototype.get = function (this: WeakMap<object, unknown>, key: object) {
    if (keys.has(key)) seen.add(this);
    return get.call(this, key);
  };
  try { return draw(); }
  finally {
    WeakMap.prototype.get = get;
    for (const map of seen) if (geometries.some(geometry => isEntry(get.call(map, geometry)))) {
      maps.set(renderer, { map: map as MorphMap, generation: contextGeneration(renderer) });
      break;
    }
  }
}

/**
 * The steps that make `geometry`'s morph texture ahead, each within `budget` ms of `now` (fill) or `chunk` bytes (upload); undefined when
 * there is nothing to make (Three's map isn't known yet, or it holds the geometry's texture already). `step()` returns true once the texture
 * is in Three's map. `dispose()` frees a texture not handed over (a preparation that stopped part-way).
 */
export function morphTextureSteps(renderer: THREE.WebGLRenderer, geometry: THREE.BufferGeometry,
  options: { now?(): number; budget?: number; chunk?: number } = {}): { step(): boolean; dispose(): void } | undefined {
  const map = morphTextureMap(renderer);
  const morphs = geometry.morphAttributes;
  // Three reads them the same way (`Vector4.fromBufferAttribute`, interleaved or not).
  type Attribute = THREE.BufferAttribute;
  const targets = (morphs.position ?? []) as Attribute[], normals = (morphs.normal ?? []) as Attribute[], colours = (morphs.color ?? []) as Attribute[];
  const count = (morphs.position ?? morphs.normal ?? morphs.color)?.length ?? 0;
  if (!map || !count || map.get(geometry)?.count === count) return undefined;
  const generation = contextGeneration(renderer);
  const now = options.now ?? (() => performance.now()), budget = options.budget ?? 8, chunk = options.chunk ?? 4 * 1024 * 1024;
  // The layout Three gives it (WebGLMorphtargets.update): a texel per vertex for each kind of delta, rows of the largest texture width.
  const hasPosition = morphs.position !== undefined, hasNormal = morphs.normal !== undefined, hasColour = morphs.color !== undefined;
  const kinds = hasColour ? 3 : hasNormal ? 2 : hasPosition ? 1 : 0;
  let width = geometry.attributes.position!.count * kinds, height = 1;
  const max = renderer.capabilities.maxTextureSize;
  if (width > max) { height = Math.ceil(width / max); width = max; }
  const layer = width * height * 4, stride = kinds * 4, delta = new THREE.Vector4();
  let buffer: Float32Array | null = null, texture: THREE.DataArrayTexture | null = null;
  let filled = 0, uploaded = 0, handed = false;
  const fill = (i: number) => {
    const offset = layer * i, target = targets[i], normal = normals[i], colour = colours[i], vertices = (target ?? normal ?? colour)!.count;
    for (let j = 0; j < vertices; j++) {
      const at = offset + j * stride;
      if (hasPosition) { delta.fromBufferAttribute(target!, j); buffer![at] = delta.x; buffer![at + 1] = delta.y; buffer![at + 2] = delta.z; buffer![at + 3] = 0; }
      if (hasNormal) { delta.fromBufferAttribute(normal!, j); buffer![at + 4] = delta.x; buffer![at + 5] = delta.y; buffer![at + 6] = delta.z; buffer![at + 7] = 0; }
      if (hasColour) {
        delta.fromBufferAttribute(colour!, j);
        buffer![at + 8] = delta.x; buffer![at + 9] = delta.y; buffer![at + 10] = delta.z; buffer![at + 11] = colour!.itemSize === 4 ? delta.w : 1;
      }
    }
  };
  const release = () => { if (texture && !handed) texture.dispose(); texture = null; buffer = null; };
  return {
    step() {
      if (handed) return true;
      // A context lost meanwhile took Three's map with it: Three builds its own at the draw, as before.
      if (!inGeneration(renderer, generation) || morphTextureMap(renderer) !== map) { release(); return true; }
      // Three drew the geometry meanwhile and made its own: nothing to hand over.
      if (map.get(geometry)?.count === count) { release(); return true; }
      const start = now();
      if (!texture) {
        buffer = new Float32Array(layer * count);
        texture = new THREE.DataArrayTexture(buffer, width, height, count);
        texture.type = THREE.FloatType;
        return false;
      }
      if (filled > uploaded) {
        // The layers filled since the last upload, at most `chunk` bytes of them, on their own (storage made with the first).
        const last = Math.min(filled, uploaded + Math.max(1, Math.floor(chunk / (layer * 4))));
        for (let i = uploaded; i < last; i++) texture.addLayerUpdate(i);
        texture.needsUpdate = true;
        renderer.initTexture(texture);
        uploaded = last;
        if (uploaded < count) return false;
        // Complete: Three's own entry, and its release with the geometry.
        const made = texture, entry: MorphEntry = { count, texture: made, size: new THREE.Vector2(width, height) };
        map.set(geometry, entry);
        handed = true;
        const dispose = () => { made.dispose(); if (map.get(geometry) === entry) map.delete(geometry); geometry.removeEventListener("dispose", dispose); };
        geometry.addEventListener("dispose", dispose);
        buffer = null;
        return true;
      }
      do fill(filled++); while (filled < count && now() - start < budget);
      return false;
    },
    dispose: release,
  };
}
