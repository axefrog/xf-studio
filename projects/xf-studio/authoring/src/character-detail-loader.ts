import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { materialAdapter, textureColourSpace, type AdaptedMaterial, type AdapterContext, type TextureUse, type TextureWrap } from "./character-material-adapters";
import { CHARACTER_DETAIL_ASSETS, chunkOfMesh, DETAIL_SLOTS, parseCharacterDetail, RECORD_LIMITS, type CharacterDetail, type DetailSlot, type RenderComponent,
  type RenderResource, type RenderTexture } from "./render-detail";
import { renderTemplate } from "./render-templates";
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
  hair: ["hair", "it isn't"], eyes: ["eyes", "they aren't"], piercings: ["piercings", "they aren't"], body: ["body", "it isn't"] };
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
 * chunk). It stays where the export placed it: the idle rig never moves that bone, and the loader reports the part with the limit
 * `rigid-part`. The component's `parentTransform` and `skinning` bindings both name the entity's `root` animated component, not a head
 * bone (every vanilla and framework piercing `.app` on the reference installation) [resource], so the data gives no bone to follow;
 * how the engine moves an unskinned mesh in a skinned component is unread [hypothesis] (PREV-64).
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
/** Whether a body component reads the body's skin under it (a body decal: tattoo, scar, the underwear cover). */
const readsBodySkin = (component: RenderComponent) => component.slot === "body" &&
  component.materials.some(material => !!renderTemplate(material.template, material.templateName)?.decal);

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
  // The skin loads first, so decals over it (brows) can blend against the resolved skin colour, read on the
  // head the scene will draw (the skin's own chunks or the core head; head-skin-placement.ts).
  const ordered = [...record.components].sort((a, b) => DETAIL_SLOTS.indexOf(a.slot) - DETAIL_SLOTS.indexOf(b.slot));
  let resolvedSkin: AdapterContext["skin"];
  /** The body's loaded skin (its first skin-drawing part), which body decals blend against and are lit by (knowledge/body-rendering.md). */
  let bodySkin: AdapterContext["skin"];
  const skinFor = (slot: DetailSlot) => slot === "body" ? bodySkin : resolvedSkin;
  const keepSkin = (component: RenderComponent, skin: NonNullable<LoadedCharacterComponent["skin"]>, meshes: THREE.SkinnedMesh[]) => {
    const surface = { base: skin.base, chunks: meshes, roughness: skin.roughness, parameters: skin.handle.parameters };
    if (component.slot === "body") bodySkin ??= surface;
    else resolvedSkin ??= surface;
  };
  /** Decoded texels of the distinct textures this record draws, against the record's budget (PIPE-43). */
  const texels = new Map<string, number>();
  const texelsOf = (component: RenderComponent) => {
    let added = 0;
    for (const material of component.materials) for (const texture of chunkTextureFiles(material))
      if (!texels.has(texture.file)) added += texture.width * texture.height;
    return added;
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
      if (lent && (!READS_SKIN.has(component.slot) || sameSkin) && (!readsBodySkin(component) || sameBodySkin) && !components.includes(lent)) {
        spendTexels(component);
        components.push(lent); borrowed.add(lent);
        for (const limit of lent.limits ?? []) addLimit(component.slot, limit);
        verticesUsed += lent.meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute("position").count, 0);
        if (lent.skin) keepSkin(component, lent.skin, lent.meshes);
        continue;
      }
      spendTexels(component);
      const skinUnder = skinFor(component.slot);
      const adapterContext: AdapterContext = { slot: component.slot, ...options.context(component.slot), ...(skinUnder ? { skin: skinUnder } : {}) };
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
          if (rigidNames.has(object.name) && !partLimits.includes("rigid-part")) partLimits.push("rigid-part");
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
