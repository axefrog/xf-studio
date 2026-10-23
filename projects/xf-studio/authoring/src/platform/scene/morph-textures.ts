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
 * fills it, each batch of layers uploaded on its own (`DataArrayTexture.layerUpdates`), and the finished texture registered with the
 * renderer as Three registers its own, so the first draw finds it ready and builds nothing. Nothing of it is drawn before it is complete.
 *
 * **Three's map, through a patch.** Three r186 keeps the map private to the renderer. The Studio patches Three (`patches/three@0.186.0.patch`,
 * applied by `bun install` from `patchedDependencies`; experiment 043 §13, docs/toolchain.md) so each renderer exposes its context's morph
 * textures as `xfsMorphTextures`: `get(geometry)`, and `set(geometry, count, texture, size)`, which registers a texture as `update` registers
 * its own (the entry, and its release when the geometry is disposed). It is per renderer and per context: Three makes a new one when the
 * context is restored, so steps begun before a loss hand nothing over. Without the patch (a Three upgrade that dropped it) nothing is made
 * ahead and Three builds its own at the draw, as before; `tests/morph-textures.test.ts` fails then, and holds the bytes against Three's.
 */
import * as THREE from "three";
import { contextGeneration, inGeneration } from "./context-generation";

/** Three's entry for a geometry's morph texture (WebGLMorphtargets, r186). */
type MorphEntry = { count: number; texture: THREE.DataArrayTexture; size: THREE.Vector2 };
/** A renderer's morph textures for its current context, as the Studio's Three patch exposes them. */
export type MorphTextures = {
  get(geometry: THREE.BufferGeometry): MorphEntry | undefined;
  set(geometry: THREE.BufferGeometry, count: number, texture: THREE.DataArrayTexture, size: THREE.Vector2): MorphEntry;
};

/** `renderer`'s morph textures for its current context (undefined: Three isn't patched). */
export function morphTextures(renderer: THREE.WebGLRenderer): MorphTextures | undefined {
  return (renderer as THREE.WebGLRenderer & { xfsMorphTextures?: MorphTextures }).xfsMorphTextures;
}

/** Whether `object` draws with morph targets (Three builds a morph texture for its geometry). */
export function morphGeometry(object: THREE.Object3D): THREE.BufferGeometry | undefined {
  const geometry = (object as THREE.Mesh).isMesh ? (object as THREE.Mesh).geometry : undefined;
  const morphs = geometry?.morphAttributes;
  return morphs && (morphs.position !== undefined || morphs.normal !== undefined || morphs.color !== undefined) ? geometry : undefined;
}

/**
 * The steps that make `geometry`'s morph texture ahead, each within `budget` ms of `now` (fill) or `chunk` bytes (upload); undefined when
 * there is nothing to make (Three isn't patched, or the renderer holds the geometry's texture already). `step()` returns true once the
 * texture is registered with the renderer. `dispose()` frees a texture not handed over (a preparation that stopped part-way).
 */
export function morphTextureSteps(renderer: THREE.WebGLRenderer, geometry: THREE.BufferGeometry,
  options: { now?(): number; budget?: number; chunk?: number } = {}): { step(): boolean; dispose(): void } | undefined {
  const map = morphTextures(renderer);
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
      // A context lost meanwhile took the renderer's morph textures with it: Three builds its own at the draw, as before.
      if (!inGeneration(renderer, generation) || morphTextures(renderer) !== map) { release(); return true; }
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
        // Complete: registered as Three registers its own (the entry, and its release with the geometry).
        map.set(geometry, count, texture, new THREE.Vector2(width, height));
        handed = true;
        buffer = null;
        return true;
      }
      do fill(filled++); while (filled < count && now() - start < budget);
      return false;
    },
    dispose: release,
  };
}
