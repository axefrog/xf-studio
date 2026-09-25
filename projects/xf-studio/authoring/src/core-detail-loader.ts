import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { restoreFirstWeights } from "./skin";
import { CORE_DETAIL_URL, CORE_TEXTURE_COLOUR, CORE_TEXTURE_SLOTS, parseCoreDetail, PREPARED_CORE_DETAIL, type CoreDetail,
  type CoreTextureSlot, type RenderResource } from "./render-detail";

/**
 * Renderer device port for the core head detail: it takes a typed render record (from the
 * host, or the fixed description of developer-prepared files), fetches and hash-checks each
 * resource, and returns ready Three.js objects. On any failure it disposes what it created.
 * Later details (skin variants, hair, piercings, other characters) should load through the
 * same record shape instead of fixed URLs.
 */
export type LoadedCoreDetail = {
  record: CoreDetail;
  gltf: GLTF;
  meshes: THREE.Mesh[];
  head: THREE.SkinnedMesh;
  plate: THREE.SkinnedMesh;
  eyes: THREE.Mesh;
  textures: Record<CoreTextureSlot, THREE.Texture>;
};
export type CoreDetailFetch = (url: string) => Promise<Response>;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The host's record when it has one; the developer intake's fixed files otherwise. */
export async function readCoreDetail(fetcher: CoreDetailFetch = fetch): Promise<CoreDetail> {
  let response: Response;
  try { response = await fetcher(CORE_DETAIL_URL); } catch { return PREPARED_CORE_DETAIL; }
  if (response.status === 404) return PREPARED_CORE_DETAIL;
  if (!response.ok) throw Error("The 3D preview record could not be read.");
  return parseCoreDetail(await response.json());
}

async function resourceBytes(resource: RenderResource, fetcher: CoreDetailFetch): Promise<ArrayBuffer> {
  const response = await fetcher(`/assets/${resource.file}`);
  if (!response.ok) throw Error(`${resource.file} is unavailable.`);
  const bytes = await response.arrayBuffer();
  if (resource.sha256 && await sha256Hex(bytes) !== resource.sha256) throw Error(`${resource.file} does not match its record.`);
  return bytes;
}

export async function loadCoreDetail(renderer: THREE.WebGLRenderer, fetcher: CoreDetailFetch = fetch): Promise<LoadedCoreDetail> {
  const record = await readCoreDetail(fetcher);
  const textures: Partial<Record<CoreTextureSlot, THREE.Texture>> = {};
  let gltf: GLTF | undefined;
  try {
    const data = await resourceBytes(record.geometry, fetcher);
    const weights = restoreFirstWeights(data);
    gltf = await new GLTFLoader().parseAsync(data, "/assets/");
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    const named = (name: string) => meshes.find(mesh => mesh.name === name);
    const head = named(record.geometry.nodes.head), plate = named(record.geometry.nodes.plate), eyes = named(record.geometry.nodes.eyes);
    if (!(head instanceof THREE.SkinnedMesh) || !(plate instanceof THREE.SkinnedMesh) || !eyes)
      throw Error("Preview asset is missing required meshes.");
    for (const mesh of meshes) {
      mesh.frustumCulled = false;
      if (!(mesh instanceof THREE.SkinnedMesh)) continue;
      // Three normalizes four influences; the source has eight, so restore the exported first set.
      const association = gltf.parser.associations.get(mesh);
      const raw = weights.get(gltf.parser.json.meshes[association?.meshes ?? -1]?.name);
      if (!raw) throw Error(`Cannot restore full skin weights for ${mesh.name}`);
      mesh.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(raw, 4));
    }
    const loader = new THREE.TextureLoader();
    await Promise.all(CORE_TEXTURE_SLOTS.map(async slot => {
      const bytes = await resourceBytes(record.textures[slot], fetcher);
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      try {
        const texture = await loader.loadAsync(url);
        texture.flipY = false;
        texture.colorSpace = CORE_TEXTURE_COLOUR[slot] === "srgb" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.name = record.textures[slot].file;
        textures[slot] = texture;
      } finally { URL.revokeObjectURL(url); }
    }));
    return { record, gltf, meshes, head, plate, eyes, textures: textures as Record<CoreTextureSlot, THREE.Texture> };
  } catch (error) {
    for (const texture of Object.values(textures)) texture?.dispose();
    gltf?.scene.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    throw error;
  }
}
