import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { materialAdapter, textureColourSpace, type AdaptedMaterial, type AdapterContext, type TextureUse, type TextureWrap } from "./character-material-adapters";
import { CHARACTER_DETAIL_ASSETS, chunkOfMesh, DETAIL_SLOTS, parseCharacterDetail, type CharacterDetail, type DetailSlot, type RenderComponent,
  type RenderResource, type RenderTexture } from "./render-detail";
import { restoreFirstWeights } from "./skin";
import type { DetailLimit } from "./detail-limits";
import type { EyeballHandle, EyeShellHandle } from "./eye-material";
import type { FaceDecalHandle } from "./face-decal-material";
import type { LayeredHandle } from "./layered-material";

/**
 * Renderer device port for the resolved character details (head skin, face details, brows, lashes, hair, eyes, piercings): it reads the host's
 * content-addressed character record, fetches and hash-checks each GLB and texture, keeps only the
 * chunks the record says are visible and drawable, and builds each chunk's material through the
 * adapter for its game template. It returns ready Three objects plus plain per-slot problems; on
 * failure or cancellation it disposes what it created. It never names a mod or a choice.
 */
export type CharacterDetailFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type LoadedCharacterComponent = {
  component: RenderComponent;
  root: THREE.Object3D;
  meshes: THREE.SkinnedMesh[];
  bones: THREE.Bone[];
  /** The skin adapter's handle and toned base colour, for the head's skin chunk. */
  skin?: NonNullable<AdaptedMaterial["skin"]>;
  /** The eye component's drawn eyeball and wetness-shell meshes, by the role their template gives them. */
  eyes?: { eyeballs: { mesh: THREE.SkinnedMesh; handle: EyeballHandle }[]; shells: { mesh: THREE.SkinnedMesh; handle: EyeShellHandle }[] };
  /**
   * A face detail's drawn decal chunks, with their chunk material (template priority), handle, and how the skin under
   * each was read (null when the decal blends without it). The evidence travels with the loaded entry, so it is right
   * whichever order the scene swaps characters in (PREV-51).
   */
  decals?: { mesh: THREE.SkinnedMesh; chunk: RenderComponent["materials"][number]; handle: FaceDecalHandle; surface: AdaptedMaterial["decalSurface"] | null }[];
  /** Layered chunks: their meshes and bake handles (the scene bakes each stack once, with its renderer). */
  layered?: { mesh: THREE.SkinnedMesh; handle: LayeredHandle }[];
};
export type LoadedCharacterDetails = {
  record: CharacterDetail;
  components: LoadedCharacterComponent[];
  /** Slots that could not be shown in full, in plain words. */
  problems: { slot: DetailSlot; message: string }[];
  /** Shown slots with a part the preview can't draw yet, as codes the presentation words. */
  limits: { slot: DetailSlot; limit: DetailLimit }[];
  notes: string[];
  dispose(): void;
};
export type CharacterDetailLoadOptions = {
  fetcher?: CharacterDetailFetch;
  anisotropy: number;
  signal?: AbortSignal;
  context(slot: DetailSlot): Omit<AdapterContext, "slot">;
};

const MAX_BYTES = 256 * 1024 * 1024, MAX_VERTICES = 1_500_000;
const SLOT_NOUN: Record<DetailSlot, [string, string]> = { skin: ["skin", "it isn't"], face: ["face details", "they aren't"], brows: ["eyebrows", "they aren't"], lashes: ["eyelashes", "they aren't"],
  hair: ["hair", "it isn't"], eyes: ["eyes", "they aren't"], piercings: ["piercings", "they aren't"] };
/** Every served texture a chunk names: its parameters' textures and, for a layered chunk, each layer's maps and mask. */
export const chunkTextureFiles = (material: RenderComponent["materials"][number]): RenderTexture[] =>
  [...Object.values(material.textures), ...(material.layered?.layers.flatMap(layer => Object.values(layer.textures)) ?? [])];
export { chunkOfMesh };

/**
 * Release what a loaded detail object owns on the GPU: every mesh's geometry and every skinned mesh's
 * skeleton (its bone texture). Materials and textures are shared per load and released by `dispose`.
 * `keep` names geometries another loaded component still draws (two components parsed from one file share them).
 */
export function releaseDetailObject(root: THREE.Object3D, keep?: ReadonlySet<THREE.BufferGeometry>): void {
  root.removeFromParent();
  root.traverse(object => {
    if (object instanceof THREE.Mesh && !keep?.has(object.geometry)) object.geometry.dispose();
    if (object instanceof THREE.SkinnedMesh) object.skeleton?.dispose();
  });
}
const geometriesOf = (roots: readonly THREE.Object3D[]) => {
  const out = new Set<THREE.BufferGeometry>();
  for (const root of roots) root.traverse(object => { if (object instanceof THREE.Mesh) out.add(object.geometry); });
  return out;
};

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Bind an unskinned chunk whole to one bone at the root, as a skinned mesh (so it draws, morphs and is released like every other
 * chunk). It stays where the export placed it: the idle rig never moves that bone [hypothesis: how the engine places a rigid mesh in
 * a skinned component is unread].
 */
export function bindRigid(mesh: THREE.Mesh, root: THREE.Object3D): THREE.SkinnedMesh {
  const geometry = mesh.geometry, count = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Float32Array.from({ length: count * 4 }, (_, i) => i % 4 ? 0 : 1), 4));
  const skinned = new THREE.SkinnedMesh(geometry, mesh.material);
  skinned.name = mesh.name;
  skinned.position.copy(mesh.position); skinned.quaternion.copy(mesh.quaternion); skinned.scale.copy(mesh.scale);
  const parent = mesh.parent ?? root;
  parent.add(skinned);
  mesh.removeFromParent();
  const bone = new THREE.Bone();
  bone.name = `xfs_rigid_${mesh.name}`;
  root.add(bone);
  root.updateMatrixWorld(true);
  skinned.bind(new THREE.Skeleton([bone]));
  return skinned;
}

export async function readCharacterRecord(file: string, fetcher: CharacterDetailFetch = fetch, signal?: AbortSignal): Promise<CharacterDetail> {
  const response = await fetcher(`${CHARACTER_DETAIL_ASSETS}${file}`, { signal });
  if (!response.ok) throw Error("The prepared details are unavailable.");
  return parseCharacterDetail(await response.json());
}

export async function loadCharacterDetails(record: CharacterDetail, options: CharacterDetailLoadOptions): Promise<LoadedCharacterDetails> {
  const fetcher = options.fetcher ?? fetch, signal = options.signal;
  let bytesUsed = 0, verticesUsed = 0;
  const textures: THREE.Texture[] = [], owned: THREE.Texture[] = [], materials: THREE.Material[] = [], roots: THREE.Object3D[] = [];
  const dispose = () => {
    for (const root of roots) releaseDetailObject(root);
    roots.length = 0;
    for (const material of materials) material.dispose();
    for (const texture of [...textures, ...owned]) texture.dispose();
  };
  const aborted = () => { if (signal?.aborted) throw new DOMException("Loading the details was cancelled.", "AbortError"); };
  const bytesOf = new Map<string, Promise<ArrayBuffer>>();
  const fetchBytes = (resource: RenderResource) => {
    let pending = bytesOf.get(resource.file);
    if (!pending) {
      pending = (async () => {
        const response = await fetcher(`${CHARACTER_DETAIL_ASSETS}${resource.file}`, { signal });
        if (!response.ok) throw Error(`${resource.file} is unavailable.`);
        const bytes = await response.arrayBuffer();
        bytesUsed += bytes.byteLength;
        if (bytesUsed > MAX_BYTES) throw Error("The prepared details are larger than the preview allows.");
        if (await sha256Hex(bytes) !== resource.sha256) throw Error(`${resource.file} does not match its record.`);
        return bytes;
      })();
      bytesOf.set(resource.file, pending);
    }
    return pending;
  };
  const images = new Map<string, Promise<HTMLImageElement>>();
  const imageOf = (texture: RenderTexture) => {
    let pending = images.get(texture.file);
    if (!pending) {
      pending = fetchBytes(texture).then(async bytes => {
        const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        try { return await new THREE.ImageLoader().loadAsync(url); } finally { URL.revokeObjectURL(url); }
      });
      images.set(texture.file, pending);
    }
    return pending;
  };
  // One parse per geometry file (PREV-53): components that draw the same file (face cyberware on the freckle mesh) each get
  // their own objects and skeleton, cloned from one parsed scene that shares the geometry; a file one component uses is
  // taken as parsed. Skin weights are the file's own floats (restoreFirstWeights), keyed by node name for the clones.
  const uses = new Map<string, number>();
  for (const component of record.components) uses.set(component.geometry.file, (uses.get(component.geometry.file) ?? 0) + 1);
  const parsed = new Map<string, Promise<{ scene: THREE.Group; weights: Map<string, Float32Array> }>>();
  const parseOf = (resource: RenderResource) => {
    let pending = parsed.get(resource.file);
    if (!pending) {
      pending = fetchBytes(resource).then(async buffer => {
        const raw = restoreFirstWeights(buffer);
        const gltf = await new GLTFLoader().parseAsync(buffer.slice(0), "");
        const weights = new Map<string, Float32Array>();
        gltf.scene.traverse(object => {
          if (!(object instanceof THREE.SkinnedMesh)) return;
          const found = raw.get(gltf.parser.json.meshes[gltf.parser.associations.get(object)?.meshes ?? -1]?.name);
          if (found) weights.set(object.name, found);
        });
        return { scene: gltf.scene, weights };
      });
      parsed.set(resource.file, pending);
    }
    return pending;
  };
  const made = new Map<string, THREE.Texture>();
  const problems: LoadedCharacterDetails["problems"] = [], limits: LoadedCharacterDetails["limits"] = [], notes: string[] = [];
  const components: LoadedCharacterComponent[] = [];
  // The skin loads first, so decals over it (brows) can blend against the resolved skin colour, read on the
  // head the scene will draw (the skin's own chunks or the core head; head-skin-placement.ts).
  const ordered = [...record.components].sort((a, b) => DETAIL_SLOTS.indexOf(a.slot) - DETAIL_SLOTS.indexOf(b.slot));
  let resolvedSkin: AdapterContext["skin"];
  try {
    for (const component of ordered) {
      aborted();
      const adapterContext: AdapterContext = { slot: component.slot, ...options.context(component.slot), ...(resolvedSkin ? { skin: resolvedSkin } : {}) };
      // Two components may share a name (two face choices drawing one mesh); a failure releases this one's root only.
      let componentRoot: THREE.Object3D | undefined;
      try {
        // Every texture a drawn chunk names is fetched and verified before any material is built.
        const loadedImages = new Map<string, HTMLImageElement>();
        for (const material of component.materials) for (const texture of chunkTextureFiles(material))
          loadedImages.set(texture.file, await imageOf(texture));
        aborted();
        const source = await parseOf(component.geometry);
        aborted();
        const shared = (uses.get(component.geometry.file) ?? 0) > 1;
        const root = shared ? cloneSkinned(source.scene) as THREE.Group : source.scene;
        roots.push(root);
        componentRoot = root;
        root.name = `detail_${component.slot}_${component.component}`;
        const meshes: THREE.SkinnedMesh[] = [], unwanted: THREE.Object3D[] = [], bones: THREE.Bone[] = [];
        let skin: LoadedCharacterComponent["skin"];
        const eyes: NonNullable<LoadedCharacterComponent["eyes"]> = { eyeballs: [], shells: [] };
        const decals: NonNullable<LoadedCharacterComponent["decals"]> = [];
        const layered: NonNullable<LoadedCharacterComponent["layered"]> = [];
        // A drawn chunk whose exported geometry has no skin (a framework's linked mesh can be rigid) is bound whole to one root bone.
        const rigid: THREE.Mesh[] = [];
        root.traverse(object => { if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh) && chunkOfMesh(object.name) !== null) rigid.push(object); });
        for (const mesh of rigid) bindRigid(mesh, root);
        const rigidNames = new Set(rigid.map(mesh => mesh.name));
        root.traverse(object => {
          if (object instanceof THREE.Bone) { bones.push(object); return; }
          if (!(object instanceof THREE.Mesh)) return;
          const chunk = chunkOfMesh(object.name);
          const material = chunk === null ? undefined : component.materials.find(entry => entry.chunk === chunk);
          const adapter = material ? materialAdapter(material.template, material.templateName, component.slot) : undefined;
          if (!material || !adapter || !(object instanceof THREE.SkinnedMesh)) { unwanted.push(object); return; }
          const raw = source.weights.get(object.name);
          if (!raw && !rigidNames.has(object.name)) throw Error(`missing skin weights for ${object.name}`);
          if (raw) object.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(raw, 4));
          object.frustumCulled = false;
          const chunkTextures = (parameter: string | RenderTexture, use: TextureUse, wrap: TextureWrap) => {
            const source = typeof parameter === "string" ? material.textures[parameter] : parameter;
            if (!source) return undefined;
            const key = `${source.file}|${use}|${wrap}`;
            let texture = made.get(key);
            if (!texture) {
              texture = new THREE.Texture(loadedImages.get(source.file));
              texture.flipY = false;
              // Adapters choose colour or data; only a colour input honours the resource's own isGamma flag.
              texture.colorSpace = textureColourSpace(use, source.isGamma);
              texture.wrapS = texture.wrapT = wrap === "repeat" ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
              texture.anisotropy = options.anisotropy;
              texture.name = source.depotPath;
              texture.needsUpdate = true;
              made.set(key, texture);
              textures.push(texture);
            }
            return texture;
          };
          const adapted = adapter.create(material, chunkTextures, object, adapterContext);
          materials.push(adapted.material);
          owned.push(...adapted.owned);
          notes.push(...adapted.notes.map(note => `${component.slot} ${object.name}: ${note}`));
          for (const limit of adapted.limits ?? []) if (!limits.some(item => item.slot === component.slot && item.limit === limit))
            limits.push({ slot: component.slot, limit });
          if (adapted.skin) skin ??= adapted.skin;
          if (adapted.eye?.role === "eyeball") eyes.eyeballs.push({ mesh: object, handle: adapted.eye });
          if (adapted.eye?.role === "shell") eyes.shells.push({ mesh: object, handle: adapted.eye });
          if (adapted.decal) decals.push({ mesh: object, chunk: material, handle: adapted.decal, surface: adapted.decalSurface ?? null });
          if (adapted.layered) layered.push({ mesh: object, handle: adapted.layered });
          // A placeholder chunk is recorded (so its limit is said) but never drawn.
          if (adapted.hidden) object.visible = false;
          object.material = adapted.material;
          object.name = `detail_${component.slot}_${object.name}`;
          verticesUsed += object.geometry.getAttribute("position").count;
          meshes.push(object);
        });
        // Never drawn, so neither their geometry nor a bone texture reached the GPU; a kept mesh may share their skeleton, and
        // another component parsed from the same file may draw their geometry.
        for (const object of unwanted) object.removeFromParent();
        if (verticesUsed > MAX_VERTICES) throw Error("the details have more geometry than the preview allows");
        if (!meshes.length) throw Error("no drawable chunk was found in the exported geometry");
        components.push({ component, root, meshes, bones, ...(skin ? { skin } : {}),
          ...(eyes.eyeballs.length || eyes.shells.length ? { eyes } : {}), ...(decals.length ? { decals } : {}), ...(layered.length ? { layered } : {}) });
        if (skin && !resolvedSkin) resolvedSkin = { base: skin.base, chunks: meshes, roughness: skin.roughness, parameters: skin.handle.parameters };
      } catch (error) {
        if (signal?.aborted) throw error;
        const [noun, isnt] = SLOT_NOUN[component.slot];
        problems.push({ slot: component.slot, message: `XF Studio couldn't load your V's ${noun}, so ${isnt} shown.` });
        notes.push(`${component.slot} ${component.component}: ${(error as Error).message}`);
        const index = componentRoot ? roots.indexOf(componentRoot) : -1;
        if (index >= 0) {
          const [failed] = roots.splice(index, 1);
          releaseDetailObject(failed!, geometriesOf(roots));
        }
      }
    }
  } catch (error) { dispose(); throw error; }
  // A slot with at least one loaded component is shown; report a problem only when nothing of it loaded.
  const shown = new Set(components.map(item => item.component.slot));
  return { record, components, problems: problems.filter((problem, index) => !shown.has(problem.slot) &&
    problems.findIndex(other => other.slot === problem.slot) === index), limits: limits.filter(limit => shown.has(limit.slot)), notes, dispose };
}
