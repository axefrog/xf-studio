import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { materialAdapter, textureColourSpace, type AdaptedMaterial, type AdapterContext, type TextureUse, type TextureWrap } from "./character-material-adapters";
import { CHARACTER_DETAIL_ASSETS, DETAIL_SLOTS, parseCharacterDetail, type CharacterDetail, type DetailSlot, type RenderComponent,
  type RenderResource, type RenderTexture } from "./render-detail";
import { restoreFirstWeights } from "./skin";
import type { DetailLimit } from "./detail-limits";
import type { EyeballHandle, EyeShellHandle } from "./eye-material";
import type { FaceDecalHandle } from "./face-decal-material";

/**
 * Renderer device port for the resolved character details (head skin, brows, lashes, hair, eyes): it reads the host's
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
  /** A face detail's drawn decal chunks, with their chunk material (template priority) and handle. */
  decals?: { mesh: THREE.SkinnedMesh; chunk: RenderComponent["materials"][number]; handle: FaceDecalHandle }[];
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
  hair: ["hair", "it isn't"], eyes: ["eyes", "they aren't"] };
/** WolvenKit names each exported render chunk `submesh_<chunk>_LOD_<lod>` (optionally with a suffix). */
export function chunkOfMesh(name: string): number | null {
  const match = /^submesh_(\d+)_LOD_\d+/.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * Release what a loaded detail object owns on the GPU: every mesh's geometry and every skinned mesh's
 * skeleton (its bone texture). Materials and textures are shared per load and released by `dispose`.
 */
export function releaseDetailObject(root: THREE.Object3D): void {
  root.removeFromParent();
  root.traverse(object => {
    if (object instanceof THREE.Mesh) object.geometry.dispose();
    if (object instanceof THREE.SkinnedMesh) object.skeleton?.dispose();
  });
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
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
        for (const material of component.materials) for (const texture of Object.values(material.textures))
          loadedImages.set(texture.file, await imageOf(texture));
        aborted();
        const buffer = await fetchBytes(component.geometry);
        aborted();
        const weights = restoreFirstWeights(buffer);
        const gltf = await new GLTFLoader().parseAsync(buffer.slice(0), "");
        const root = gltf.scene;
        roots.push(root);
        componentRoot = root;
        root.name = `detail_${component.slot}_${component.component}`;
        const meshes: THREE.SkinnedMesh[] = [], unwanted: THREE.Object3D[] = [], bones: THREE.Bone[] = [];
        let skin: LoadedCharacterComponent["skin"];
        const eyes: NonNullable<LoadedCharacterComponent["eyes"]> = { eyeballs: [], shells: [] };
        const decals: NonNullable<LoadedCharacterComponent["decals"]> = [];
        root.traverse(object => {
          if (object instanceof THREE.Bone) { bones.push(object); return; }
          if (!(object instanceof THREE.Mesh)) return;
          const chunk = chunkOfMesh(object.name);
          const material = chunk === null ? undefined : component.materials.find(entry => entry.chunk === chunk);
          const adapter = material ? materialAdapter(material.template, material.templateName, component.slot) : undefined;
          if (!material || !adapter || !(object instanceof THREE.SkinnedMesh)) { unwanted.push(object); return; }
          const association = gltf.parser.associations.get(object);
          const raw = weights.get(gltf.parser.json.meshes[association?.meshes ?? -1]?.name);
          if (!raw) throw Error(`missing skin weights for ${object.name}`);
          object.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(raw, 4));
          object.frustumCulled = false;
          const chunkTextures = (parameter: string, use: TextureUse, wrap: TextureWrap) => {
            const source = material.textures[parameter];
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
          if (adapted.decal) decals.push({ mesh: object, chunk: material, handle: adapted.decal });
          // A placeholder chunk is recorded (so its limit is said) but never drawn.
          if (adapted.hidden) object.visible = false;
          object.material = adapted.material;
          object.name = `detail_${component.slot}_${object.name}`;
          verticesUsed += object.geometry.getAttribute("position").count;
          meshes.push(object);
        });
        // Never drawn, so no bone texture exists; a kept mesh may share their skeleton.
        for (const object of unwanted) {
          object.removeFromParent();
          if (object instanceof THREE.Mesh) object.geometry.dispose();
        }
        if (verticesUsed > MAX_VERTICES) throw Error("the details have more geometry than the preview allows");
        if (!meshes.length) throw Error("no drawable chunk was found in the exported geometry");
        components.push({ component, root, meshes, bones, ...(skin ? { skin } : {}),
          ...(eyes.eyeballs.length || eyes.shells.length ? { eyes } : {}), ...(decals.length ? { decals } : {}) });
        if (skin && !resolvedSkin) resolvedSkin = { base: skin.base, chunks: meshes, roughness: skin.roughness, parameters: skin.handle.parameters };
      } catch (error) {
        if (signal?.aborted) throw error;
        const [noun, isnt] = SLOT_NOUN[component.slot];
        problems.push({ slot: component.slot, message: `XF Studio couldn't load your V's ${noun}, so ${isnt} shown.` });
        notes.push(`${component.slot} ${component.component}: ${(error as Error).message}`);
        const index = componentRoot ? roots.indexOf(componentRoot) : -1;
        if (index >= 0) { releaseDetailObject(roots[index]!); roots.splice(index, 1); }
      }
    }
  } catch (error) { dispose(); throw error; }
  // A slot with at least one loaded component is shown; report a problem only when nothing of it loaded.
  const shown = new Set(components.map(item => item.component.slot));
  return { record, components, problems: problems.filter((problem, index) => !shown.has(problem.slot) &&
    problems.findIndex(other => other.slot === problem.slot) === index), limits: limits.filter(limit => shown.has(limit.slot)), notes, dispose };
}
