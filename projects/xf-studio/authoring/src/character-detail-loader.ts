import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { materialAdapter, textureColourSpace, type AdapterContext, type TextureUse, type TextureWrap } from "./character-material-adapters";
import { CHARACTER_DETAIL_ASSETS, parseCharacterDetail, type CharacterDetail, type DetailSlot, type RenderComponent,
  type RenderResource, type RenderTexture } from "./render-detail";
import { restoreFirstWeights } from "./skin";

/**
 * Renderer device port for the resolved character details (brows, lashes, hair): it reads the host's
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
};
export type LoadedCharacterDetails = {
  record: CharacterDetail;
  components: LoadedCharacterComponent[];
  /** Slots that could not be shown in full, in plain words. */
  problems: { slot: DetailSlot; message: string }[];
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
const SLOT_NOUN: Record<DetailSlot, [string, string]> = { brows: ["eyebrows", "they aren't"], lashes: ["eyelashes", "they aren't"], hair: ["hair", "it isn't"] };
/** WolvenKit names each exported render chunk `submesh_<chunk>_LOD_<lod>` (optionally with a suffix). */
export function chunkOfMesh(name: string): number | null {
  const match = /^submesh_(\d+)_LOD_\d+/.exec(name);
  return match ? Number(match[1]) : null;
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
    for (const root of roots) {
      root.removeFromParent();
      root.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    }
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
  const problems: LoadedCharacterDetails["problems"] = [], notes: string[] = [];
  const components: LoadedCharacterComponent[] = [];
  try {
    for (const component of record.components) {
      aborted();
      const adapterContext = { slot: component.slot, ...options.context(component.slot) };
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
        root.name = `detail_${component.slot}_${component.component}`;
        const meshes: THREE.SkinnedMesh[] = [], unwanted: THREE.Object3D[] = [], bones: THREE.Bone[] = [];
        root.traverse(object => {
          if (object instanceof THREE.Bone) { bones.push(object); return; }
          if (!(object instanceof THREE.Mesh)) return;
          const chunk = chunkOfMesh(object.name);
          const material = chunk === null ? undefined : component.materials.find(entry => entry.chunk === chunk);
          const adapter = material ? materialAdapter(material.template) : undefined;
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
          object.material = adapted.material;
          object.name = `detail_${component.slot}_${object.name}`;
          verticesUsed += object.geometry.getAttribute("position").count;
          meshes.push(object);
        });
        for (const object of unwanted) {
          object.removeFromParent();
          if (object instanceof THREE.Mesh) object.geometry.dispose();
        }
        if (verticesUsed > MAX_VERTICES) throw Error("the details have more geometry than the preview allows");
        if (!meshes.length) throw Error("no drawable chunk was found in the exported geometry");
        components.push({ component, root, meshes, bones });
      } catch (error) {
        if (signal?.aborted) throw error;
        const [noun, isnt] = SLOT_NOUN[component.slot];
        problems.push({ slot: component.slot, message: `XF Studio couldn't load your V's ${noun}, so ${isnt} shown.` });
        notes.push(`${component.slot} ${component.component}: ${(error as Error).message}`);
        const index = roots.findIndex(root => root.name === `detail_${component.slot}_${component.component}`);
        if (index >= 0) { roots[index]!.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); roots.splice(index, 1); }
      }
    }
  } catch (error) { dispose(); throw error; }
  // A slot with at least one loaded component is shown; report a problem only when nothing of it loaded.
  const shown = new Set(components.map(item => item.component.slot));
  return { record, components, problems: problems.filter((problem, index) => !shown.has(problem.slot) &&
    problems.findIndex(other => other.slot === problem.slot) === index), notes, dispose };
}
