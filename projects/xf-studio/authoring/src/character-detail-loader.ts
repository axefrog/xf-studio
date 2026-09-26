import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { materialAdapter, textureColourSpace, type AdaptedMaterial, type AdapterContext, type TextureUse, type TextureWrap } from "./character-material-adapters";
import { CHARACTER_DETAIL_ASSETS, chunkOfMesh, DETAIL_SLOTS, parseCharacterDetail, RECORD_LIMITS, type CharacterDetail, type DetailSlot, type RenderComponent,
  type RenderResource, type RenderTexture, UNCOVERED_BODY, withdrawUncoveredBody } from "./render-detail";
import { renderTemplate } from "./render-templates";
import { restoreFirstWeights } from "./skin";
import type { DetailLimit } from "./detail-limits";
import { prepareEyeballGeometry, type EyeballHandle, type EyeShellHandle } from "./eye-material";
import type { FaceDecalHandle } from "./face-decal-material";
import type { LayeredHandle } from "./layered-material";
import { transferDeltas, VertexGrid } from "./decal-underlay";

/**
 * Renderer device port for the resolved character details (head skin, face details, brows, lashes, hair, eyes, piercings): it reads the host's
 * content-addressed character record, fetches and hash-checks each GLB and texture, keeps only the
 * chunks the record says are visible and drawable, and builds each chunk's material through the
 * adapter for its game template. It returns ready Three objects plus plain per-slot problems; on
 * failure or cancellation it disposes what it created. It never names a mod or a choice. A load may reuse the shown details'
 * unchanged components (`reuse`, PREV-68).
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
  /** Why this component is drawn only in part, as codes (kept with it, so a reused component still reports them). */
  limits?: DetailLimit[];
};
export type LoadedCharacterDetails = {
  record: CharacterDetail;
  components: LoadedCharacterComponent[];
  /** Slots that could not be shown in full, in plain words. */
  problems: { slot: DetailSlot; message: string }[];
  /** Shown slots with a part the preview can't draw yet, as codes the presentation words. */
  limits: { slot: DetailSlot; limit: DetailLimit }[];
  notes: string[];
  /** How many components were taken over from `reuse` unchanged. */
  reused: number;
  readonly disposed: boolean;
  /** The scene shows these details now: the components taken over from `reuse` become theirs to release. */
  adopt(): void;
  /** Release what these details own, except `keep` (the components the next shown details took over). Safe to call twice. */
  dispose(keep?: ReadonlySet<LoadedCharacterComponent>): void;
};
export type CharacterDetailLoadOptions = {
  fetcher?: CharacterDetailFetch;
  anisotropy: number;
  signal?: AbortSignal;
  context(slot: DetailSlot): Omit<AdapterContext, "slot">;
  /** The details the scene shows now: components whose content is unchanged are taken over instead of loaded again. */
  reuse?: LoadedCharacterDetails | null;
};

const MAX_BYTES = 256 * 1024 * 1024, MAX_VERTICES = 1_500_000;
const SLOT_NOUN: Record<DetailSlot, [string, string]> = { skin: ["skin", "it isn't"], face: ["face details", "they aren't"], brows: ["eyebrows", "they aren't"], lashes: ["eyelashes", "they aren't"],
  hair: ["hair", "it isn't"], eyes: ["eyes", "they aren't"], teeth: ["teeth", "they aren't"], piercings: ["piercings", "they aren't"], body: ["body", "it isn't"],
  clothing: ["clothes", "they aren't"] };
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
/**
 * The shape key a body decal without shape keys of its own (the underwear cover, a garment decal) gets from the body skin under it: the
 * sum of the shapes the body's record applied (breast size), carried over by the nearest body vertex (decal-underlay.ts `transferDeltas`).
 * The renderer keeps it at full weight.
 */
export const BODY_SHAPE_KEY = "xfs_body_shape";
/** A loaded body skin part's applied shapes, for decals over it that have none (`followBodyShape`). */
type BodyShape = { meshes: readonly THREE.SkinnedMesh[]; names: readonly string[] };
/** The body's applied shape as one searchable field: world-space rest positions, their shape deltas, and the grid over them. */
type BodyShapeField = { positions: Float32Array; deltas: Float32Array; grid: VertexGrid };
/**
 * World-space rest positions and applied shape deltas of the body's skin parts, with one grid over them: built once per load and
 * searched by every body decal and garment that follows the body's shape (PREV-106).
 */
function bodyShapeField(shapes: readonly BodyShape[]): BodyShapeField | null {
  const positions: number[] = [], deltas: number[] = [];
  const v = new THREE.Vector3(), moved = new THREE.Vector3();
  for (const { meshes, names } of shapes) for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.getAttribute("position"), targets = mesh.geometry.morphAttributes.position ?? [];
    const indices = names.map(name => mesh.morphTargetDictionary?.[name]).filter((index): index is number => index !== undefined && !!targets[index]);
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i); moved.copy(v);
      for (const index of indices) {
        const target = targets[index]!;
        moved.x += target.getX(i); moved.y += target.getY(i); moved.z += target.getZ(i);
      }
      v.applyMatrix4(mesh.matrixWorld); moved.applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z); deltas.push(moved.x - v.x, moved.y - v.y, moved.z - v.z);
    }
  }
  if (!positions.length || !deltas.some(value => value !== 0)) return null;
  const field = Float32Array.from(positions);
  return { positions: field, deltas: Float32Array.from(deltas), grid: new VertexGrid(field) };
}
/** Give a body decal the body's applied shape as one shape key (`BODY_SHAPE_KEY`); returns the vertices it moves. */
function followBodyShape(mesh: THREE.SkinnedMesh, field: BodyShapeField): number {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute("position"), world = new Float32Array(position.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).toArray(world, i * 3);
  const { deltas, moved } = transferDeltas(world, field.grid, field.deltas);
  if (!moved) return 0;
  // Into the mesh's own space (a direction: the inverse of the world matrix's linear part).
  const inverse = new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld).invert();
  for (let i = 0; i < position.count; i++) v.fromArray(deltas, i * 3).applyMatrix3(inverse).toArray(deltas, i * 3);
  const geometry = mesh.geometry;
  const existing = geometry.morphAttributes.position ?? [];
  // A mesh with shape keys of its own keeps them (relative deltas, as glTF stores them); the body's shape joins as one more.
  if (existing.length && !geometry.morphTargetsRelative) return 0;
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [...existing, new THREE.Float32BufferAttribute(deltas, 3)];
  if (geometry.morphAttributes.normal) geometry.morphAttributes.normal = [...geometry.morphAttributes.normal,
    new THREE.Float32BufferAttribute(new Float32Array(deltas.length), 3)];
  mesh.morphTargetDictionary = { ...(mesh.morphTargetDictionary ?? {}), [BODY_SHAPE_KEY]: existing.length };
  mesh.morphTargetInfluences = [...(mesh.morphTargetInfluences ?? []), 1];
  return moved;
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
 * Bind an unskinned chunk whole to one bone, as a skinned mesh (so it draws, morphs and is released like every other chunk). By default
 * the bone sits at the root and stays where the export placed it: the idle rig never moves it (`userData.xfsStill`), and the loader
 * reports the part with the limit `rigid-part`. The component's `parentTransform` and `skinning` bindings both name the entity's `root`
 * animated component, not a head bone (every vanilla and framework piercing `.app` on the reference installation) [resource], so the data
 * gives no bone to follow; how the engine moves an unskinned mesh in a skinned component is unread [hypothesis] (PREV-64).
 *
 * With `follow` (a body part: a nails mesh exported without its skin) the bone sits at the chunk's centre, and the idle moves it with the
 * rig segment nearest that centre (idle-animation.ts), so the part keeps to its hand as one piece (limit `rigid-body-part`).
 */
export function bindRigid(mesh: THREE.Mesh, root: THREE.Object3D, options: { follow?: boolean } = {}): THREE.SkinnedMesh {
  const geometry = mesh.geometry, count = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Float32Array.from({ length: count * 4 }, (_, i) => i % 4 ? 0 : 1), 4));
  const skinned = new THREE.SkinnedMesh(geometry, mesh.material);
  skinned.name = mesh.name;
  // The shape keys keep their names (the loader matched them by `<target>_<region>`), which a new mesh would number instead.
  if (mesh.morphTargetDictionary) {
    skinned.morphTargetDictionary = { ...mesh.morphTargetDictionary };
    skinned.morphTargetInfluences = [...(mesh.morphTargetInfluences ?? [])];
  }
  skinned.position.copy(mesh.position); skinned.quaternion.copy(mesh.quaternion); skinned.scale.copy(mesh.scale);
  const parent = mesh.parent ?? root;
  parent.add(skinned);
  mesh.removeFromParent();
  const bone = new THREE.Bone();
  bone.name = `xfs_rigid_${mesh.name}`;
  if (options.follow) {
    root.updateMatrixWorld(true);
    geometry.computeBoundingBox();
    const centre = geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(skinned.matrixWorld);
    bone.position.copy(root.worldToLocal(centre));
    bone.userData.xfsFollow = true;
  } else bone.userData.xfsStill = true;
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

/** What one loaded component owns on the GPU, released with it. */
type PartResources = { materials: THREE.Material[]; owned: THREE.Texture[]; textureKeys: string[] };
/**
 * Textures shared between loads (PREV-68): a load that reuses the shown details' components also takes over their ledger, so a map
 * several parts (or two records) use is uploaded once and disposed when its last user is released.
 */
class DetailLedger {
  readonly textures = new Map<string, { texture: THREE.Texture; refs: number; file: string }>();
  readonly images = new Map<string, HTMLImageElement>();
  readonly parts = new WeakMap<LoadedCharacterComponent, PartResources>();
  release(part: PartResources | undefined) {
    if (!part) return;
    for (const material of part.materials) material.dispose();
    for (const texture of part.owned) texture.dispose();
    for (const key of part.textureKeys) {
      const entry = this.textures.get(key);
      if (!entry || --entry.refs > 0) continue;
      entry.texture.dispose();
      this.textures.delete(key);
      if (![...this.textures.values()].some(other => other.file === entry.file)) this.images.delete(entry.file);
    }
    part.materials.length = 0; part.owned.length = 0; part.textureKeys.length = 0;
  }
}
const ledgers = new WeakMap<LoadedCharacterDetails, DetailLedger>();
/**
 * A shared texture's ledger key: its file, how the adapter reads it and how it wraps, and the resource's own `isGamma` flag, which
 * decides a colour input's colour space (PREV-79): two resources with one image but different flags are two textures.
 */
export const textureLedgerKey = (source: Pick<RenderTexture, "file" | "isGamma">, use: TextureUse, wrap: TextureWrap) =>
  `${source.file}|${use}|${wrap}|${source.isGamma ? "gamma" : "linear"}`;
/** A component's content identity: its whole record entry (geometry file hash, chunks and every material input). */
const contentKey = (component: RenderComponent) => JSON.stringify(component);
/** Slots whose adapters read the resolved skin under them (the face decals' and brows' underlay): reused only with an unchanged skin. */
const READS_SKIN: ReadonlySet<DetailSlot> = new Set(["face", "brows"]);
/** Whether a component draws with the skin adapter (the head's skin, or the body's: its skin, arms, feet, nails). */
const drawsSkin = (component: RenderComponent) => component.materials.some(material => renderTemplate(material.template, material.templateName)?.adapter === "skin");
/**
 * Whether a component reads the body's skin under it (a body decal: tattoo, scar, the underwear cover), so it is reused only while the
 * body's skin parts are unchanged.
 */
const readsBodySkin = (component: RenderComponent) => component.slot === "body" &&
  component.materials.some(material => !!renderTemplate(material.template, material.templateName)?.decal);
/**
 * A garment follows only the body's applied shape (which body meshes, with which shape keys), not its chunk masks or materials: a change of
 * clothing, which re-masks the body, keeps every garment whose body shape is unchanged instead of loading and baking it again (PREV-106).
 */
const followsBodyShape = (component: RenderComponent) => component.slot === "clothing";
const bodyShapeKey = (components: readonly RenderComponent[]) => components.filter(item => item.slot === "body" && drawsSkin(item) && item.morphs?.length)
  .map(item => `${item.geometry.depotHash}|${item.morphs!.join(",")}`).sort().join("\n");

/**
 * Load a record's components. With `reuse` (the details the scene shows now), a component whose content is unchanged is taken over as
 * it is (its objects, materials, bake and textures), so a tried piercing style loads only the piercings; a part that reads the skin under
 * it is reused only while the skin is unchanged. Ownership of reused parts moves to the new details when the scene swaps them in
 * (`adopt`); until then disposing the new details (a superseded load) leaves them with `reuse`.
 */
export async function loadCharacterDetails(record: CharacterDetail, options: CharacterDetailLoadOptions): Promise<LoadedCharacterDetails> {
  const fetcher = options.fetcher ?? fetch, signal = options.signal;
  const previous = options.reuse && !options.reuse.disposed ? options.reuse : null;
  const ledger = (previous && ledgers.get(previous)) ?? new DetailLedger();
  let bytesUsed = 0, verticesUsed = 0, texelsUsed = 0;
  const components: LoadedCharacterComponent[] = [];
  /** Components taken over from `reuse`: not this load's to release until the scene adopts it. */
  const borrowed = new Set<LoadedCharacterComponent>();
  const released = new Set<LoadedCharacterComponent>();
  let disposed = false;
  const releaseAll = (keep?: ReadonlySet<LoadedCharacterComponent>) => {
    const leaving = components.filter(item => !borrowed.has(item) && !keep?.has(item) && !released.has(item));
    const staying = [...components.filter(item => !leaving.includes(item)), ...(keep ?? [])];
    const kept = geometriesOf(staying.map(item => item.root));
    for (const item of leaving) { releaseDetailObject(item.root, kept); ledger.release(ledger.parts.get(item)); released.add(item); }
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
  const imageOf = (texture: RenderTexture): Promise<HTMLImageElement> => {
    const known = ledger.images.get(texture.file);
    if (known) return Promise.resolve(known);
    return fetchBytes(texture).then(async bytes => {
      const again = ledger.images.get(texture.file);
      if (again) return again;
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      try { const image = await new THREE.ImageLoader().loadAsync(url); ledger.images.set(texture.file, image); return image; }
      finally { URL.revokeObjectURL(url); }
    });
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
  const problems: LoadedCharacterDetails["problems"] = [], limits: LoadedCharacterDetails["limits"] = [], notes: string[] = [];
  const addLimit = (slot: DetailSlot, limit: DetailLimit) => { if (!limits.some(item => item.slot === slot && item.limit === limit)) limits.push({ slot, limit }); };
  // What the shown details can lend: their components by content, and whether the skin under decals stays the same.
  const lendable = new Map<string, LoadedCharacterComponent>();
  for (const item of previous?.components ?? []) lendable.set(contentKey(item.component), item);
  const skinKey = (components: readonly RenderComponent[]) => components.filter(item => item.slot === "skin").map(contentKey).join("\n");
  const sameSkin = !!previous && skinKey(previous.record.components) === skinKey(record.components);
  // The body's decals read the body's own skin (its skin-drawing parts), so they are reused only while that is unchanged.
  const bodySkinKey = (components: readonly RenderComponent[]) => components.filter(item => item.slot === "body" && drawsSkin(item)).map(contentKey).join("|");
  const sameBodySkin = !!previous && bodySkinKey(previous.record.components) === bodySkinKey(record.components);
  const sameBodyShape = !!previous && bodyShapeKey(previous.record.components) === bodyShapeKey(record.components);
  // The skin loads first, so decals over it (brows) can blend against the resolved skin colour, read on the
  // head the scene will draw (the skin's own chunks or the core head; head-skin-placement.ts).
  const ordered = [...record.components].sort((a, b) => DETAIL_SLOTS.indexOf(a.slot) - DETAIL_SLOTS.indexOf(b.slot));
  let resolvedSkin: AdapterContext["skin"];
  /**
   * The body's loaded skin parts (the body, its feet, arms and nails), which body decals blend against, lit by the first one's light, and
   * the shapes those parts carry (knowledge/body-rendering.md).
   */
  const bodySkins: NonNullable<AdapterContext["skins"]>[number][] = [], bodyShapes: BodyShape[] = [];
  /** The body's shape field, built once from the skin parts loaded so far (they load before the parts that follow them; PREV-106). */
  let field: { shapes: number; value: BodyShapeField | null } | null = null;
  const shapeField = () => {
    if (field?.shapes !== bodyShapes.length) field = { shapes: bodyShapes.length, value: bodyShapeField(bodyShapes) };
    return field.value;
  };
  const skinFor = (slot: DetailSlot) => slot === "body" ? bodySkins[0] : resolvedSkin;
  const keepSkin = (component: RenderComponent, skin: NonNullable<LoadedCharacterComponent["skin"]>, meshes: THREE.SkinnedMesh[]) => {
    // The teeth draw with the skin adapter but are never the skin under a decal (a lip decal reads the head's skin, not the mouth's).
    if (component.slot === "teeth") return;
    const surface = { base: skin.base, chunks: meshes, roughness: skin.roughness, parameters: skin.handle.parameters };
    if (component.slot !== "body") { resolvedSkin ??= surface; return; }
    bodySkins.push(surface);
    if (component.morphs?.length) bodyShapes.push({ meshes, names: component.morphs });
  };
  /** Decoded texels of the distinct textures this record draws, against the record's budget (PIPE-43). */
  const texels = new Map<string, number>();
  /** Texels a component adds: each distinct texture it names once (several chunks of one part share maps: the body's five skin chunks). */
  const texelsOf = (component: RenderComponent) => {
    const added = new Map<string, number>();
    for (const material of component.materials) for (const texture of chunkTextureFiles(material))
      if (!texels.has(texture.file)) added.set(texture.file, texture.width * texture.height);
    return [...added.values()].reduce((sum, n) => sum + n, 0);
  };
  const spendTexels = (component: RenderComponent) => {
    for (const material of component.materials) for (const texture of chunkTextureFiles(material))
      if (!texels.has(texture.file)) { texels.set(texture.file, texture.width * texture.height); texelsUsed += texture.width * texture.height; }
  };
  try {
    for (const component of ordered) {
      aborted();
      const [noun, isnt] = SLOT_NOUN[component.slot];
      if (texelsUsed + texelsOf(component) > RECORD_LIMITS.decodedPixels) {
        problems.push({ slot: component.slot, message: `XF Studio couldn't load your V's ${noun}, so ${isnt} shown.` });
        notes.push(`${component.slot} ${component.component}: over the preview's texture budget for one V.`);
        continue;
      }
      const lent = lendable.get(contentKey(component));
      if (lent && (!READS_SKIN.has(component.slot) || sameSkin) && (!readsBodySkin(component) || sameBodySkin) &&
        (!followsBodyShape(component) || sameBodyShape) && !components.includes(lent)) {
        spendTexels(component);
        components.push(lent); borrowed.add(lent);
        for (const limit of lent.limits ?? []) addLimit(component.slot, limit);
        verticesUsed += lent.meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute("position").count, 0);
        if (lent.skin) keepSkin(component, lent.skin, lent.meshes);
        continue;
      }
      spendTexels(component);
      const skinUnder = skinFor(component.slot);
      const adapterContext: AdapterContext = { slot: component.slot, ...options.context(component.slot), ...(skinUnder ? { skin: skinUnder } : {}),
        ...(component.slot === "body" ? { skins: [...bodySkins] } : {}) };
      const part: PartResources = { materials: [], owned: [], textureKeys: [] };
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
        componentRoot = root;
        root.name = `detail_${component.slot}_${component.component}`;
        const meshes: THREE.SkinnedMesh[] = [], unwanted: THREE.Object3D[] = [], bones: THREE.Bone[] = [];
        let skin: LoadedCharacterComponent["skin"];
        const eyes: NonNullable<LoadedCharacterComponent["eyes"]> = { eyeballs: [], shells: [] };
        const decals: NonNullable<LoadedCharacterComponent["decals"]> = [];
        const layered: NonNullable<LoadedCharacterComponent["layered"]> = [];
        const partLimits: DetailLimit[] = [];
        // A drawn chunk whose exported geometry has no skin (a framework's linked mesh can be rigid) is bound whole to one root bone;
        // it does not follow the head (limit `rigid-part`).
        const rigid: THREE.Mesh[] = [];
        root.traverse(object => { if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh) && chunkOfMesh(object.name) !== null) rigid.push(object); });
        for (const mesh of rigid) bindRigid(mesh, root, { follow: component.slot === "body" || component.slot === "clothing" });
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
          const rigidLimit = component.slot === "body" || component.slot === "clothing" ? "rigid-body-part" : "rigid-part";
          if (rigidNames.has(object.name) && !partLimits.includes(rigidLimit)) partLimits.push(rigidLimit);
          object.frustumCulled = false;
          const chunkTextures = (parameter: string | RenderTexture, use: TextureUse, wrap: TextureWrap) => {
            const source = typeof parameter === "string" ? material.textures[parameter] : parameter;
            if (!source) return undefined;
            const key = textureLedgerKey(source, use, wrap);
            let entry = ledger.textures.get(key);
            if (!entry) {
              const texture = new THREE.Texture(loadedImages.get(source.file));
              texture.flipY = false;
              // Adapters choose colour or data; only a colour input honours the resource's own isGamma flag.
              texture.colorSpace = textureColourSpace(use, source.isGamma);
              texture.wrapS = texture.wrapT = wrap === "repeat" ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
              texture.anisotropy = options.anisotropy;
              texture.name = source.depotPath;
              texture.needsUpdate = true;
              entry = { texture, refs: 0, file: source.file };
              ledger.textures.set(key, entry);
            }
            if (!part.textureKeys.includes(key)) { part.textureKeys.push(key); entry.refs++; }
            return entry.texture;
          };
          const adapted = adapter.create(material, chunkTextures, object, adapterContext);
          part.materials.push(adapted.material);
          part.owned.push(...adapted.owned);
          notes.push(...adapted.notes.map(note => `${component.slot} ${object.name}: ${note}`));
          for (const limit of adapted.limits ?? []) if (!partLimits.includes(limit)) partLimits.push(limit);
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
        // The eyeballs' frame and per-eye vectors, from the component's own eyeball meshes (eye-material.ts `eyeAxes`).
        if (eyes.eyeballs.length) {
          const axes = prepareEyeballGeometry(eyes.eyeballs.map(entry => entry.mesh.geometry));
          if (axes.eyes === 0) notes.push(`${component.slot}: no pupil found on the eyeball; the iris is drawn without refraction`);
          else if (!axes.lateral) notes.push(`${component.slot}: one eyeball only; its iris axis is its pupil`);
        }
        // A body decal with no shapes of its own (the underwear cover) follows the body's applied shape, so it stays over the skin; so does a
        // garment, a first stand-in for the game's garment support (knowledge/clothing.md §4.5).
        if (((component.slot === "body" && decals.length) || component.slot === "clothing") && !component.morphs?.length) {
          const field = shapeField();
          // A geometry another component draws too (a file used twice) is this component's own copy first: the shape key it gains is its own.
          if (field) for (const mesh of meshes) { if (shared) mesh.geometry = mesh.geometry.clone(); followBodyShape(mesh, field); }
        }
        const item: LoadedCharacterComponent = { component, root, meshes, bones, ...(skin ? { skin } : {}),
          ...(eyes.eyeballs.length || eyes.shells.length ? { eyes } : {}), ...(decals.length ? { decals } : {}), ...(layered.length ? { layered } : {}),
          ...(partLimits.length ? { limits: partLimits } : {}) };
        ledger.parts.set(item, part);
        components.push(item);
        for (const limit of partLimits) addLimit(component.slot, limit);
        if (skin) keepSkin(component, skin, meshes);
      } catch (error) {
        ledger.release(part);
        if (signal?.aborted) throw error;
        problems.push({ slot: component.slot, message: `XF Studio couldn't load your V's ${noun}, so ${isnt} shown.` });
        notes.push(`${component.slot} ${component.component}: ${(error as Error).message}`);
        if (componentRoot) releaseDetailObject(componentRoot, geometriesOf(components.map(item => item.root)));
      }
    }
  } catch (error) { releaseAll(); throw error; }
  // Fail closed (PIPE-97): a cover that didn't load (a failed part, or one over the texture budget) takes the parts it covers with it, and
  // with them the body, which is reported unavailable; what this load made of it is released now.
  const { kept, withdrawn } = withdrawUncoveredBody(components, item => item.component, record.components.filter(item => item.censor === "cover").length);
  if (withdrawn) {
    const leaving = components.filter(item => !kept.includes(item));
    const staying = geometriesOf(kept.map(item => item.root));
    for (const item of leaving) {
      // A part taken over from the shown details stays theirs to release; the rest is this load's.
      if (!borrowed.has(item)) { releaseDetailObject(item.root, staying); ledger.release(ledger.parts.get(item)); }
      borrowed.delete(item);
    }
    components.splice(0, components.length, ...kept);
    for (let i = limits.length - 1; i >= 0; i--) if (limits[i]!.slot === "body") limits.splice(i, 1);
    for (let i = problems.length - 1; i >= 0; i--) if (problems[i]!.slot === "body") problems.splice(i, 1);
    problems.push({ slot: "body", message: UNCOVERED_BODY });
    notes.push("body: its underwear couldn't be loaded, so the body is not shown.");
  }
  // A slot with at least one loaded component is shown; report a problem only when nothing of it loaded.
  const shown = new Set(components.map(item => item.component.slot));
  const loaded: LoadedCharacterDetails = { record, components, problems: problems.filter((problem, index) => !shown.has(problem.slot) &&
    problems.findIndex(other => other.slot === problem.slot) === index), limits: limits.filter(limit => shown.has(limit.slot)), notes,
    reused: borrowed.size,
    get disposed() { return disposed; },
    // The scene shows these details now: the parts taken over from the shown details are this load's to release from here on
    // (their resources are already in the shared ledger).
    adopt() { borrowed.clear(); },
    dispose(keep) {
      if (disposed) return;
      releaseAll(keep);
      disposed = true;
    } };
  ledgers.set(loaded, ledger);
  return loaded;
}
