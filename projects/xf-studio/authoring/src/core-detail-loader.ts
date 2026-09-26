import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { HeadLoadError } from "./head-load-error";
import { restoreFirstWeights } from "./skin";
import { CORE_DETAIL_URL, CORE_TEXTURE_COLOUR, CORE_TEXTURE_SLOTS, parseCoreDetail, type CoreDetail,
  type CoreTextureSlot, type RenderResource } from "./render-detail";

/**
 * Renderer device port for the core head detail: it takes the host's typed render record for
 * the preview derived from the player's game files, fetches and hash-checks each
 * resource, and returns ready Three.js objects. On any failure it disposes what it created.
 * Later details (skin variants, hair, piercings, other characters) should load through the
 * same record shape instead of fixed URLs.
 */
export type LoadedCoreDetail = {
  record: CoreDetail;
  gltf: GLTF;
  meshes: THREE.Mesh[];
  head: THREE.SkinnedMesh;
  /**
   * The record's surfaces beside the head, by node key: every geometry node but the head and the eyes (today one, `plate`, the
   * expanded eye plate). Features draw on them through the scene port (CORE-89).
   */
  surfaces: ReadonlyMap<string, THREE.SkinnedMesh>;
  eyes: THREE.Mesh;
  textures: Record<CoreTextureSlot, THREE.Texture>;
};
export type CoreDetailFetch = (url: string) => Promise<Response>;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The host's record for the derived preview; there is no other source of the core head. */
export async function readCoreDetail(fetcher: CoreDetailFetch = fetch): Promise<CoreDetail> {
  let response: Response;
  try { response = await fetcher(CORE_DETAIL_URL); }
  catch (error) { throw new HeadLoadError("preview_unreachable", "The 3D preview record could not be read.", { cause: error }); }
  if (response.status === 404) throw new HeadLoadError("preview_unreachable", "The 3D preview hasn't been prepared from your game files yet.");
  if (!response.ok) throw new HeadLoadError("preview_unreachable", "The 3D preview record could not be read.");
  try { return parseCoreDetail(await response.json()); }
  catch (error) { throw new HeadLoadError("preview_damaged", "The 3D preview record is damaged.", { cause: error }); }
}

async function resourceBytes(resource: RenderResource, fetcher: CoreDetailFetch): Promise<ArrayBuffer> {
  let response: Response;
  try { response = await fetcher(`/assets/${resource.file}`); }
  catch (error) { throw new HeadLoadError("preview_unreachable", `${resource.file} could not be fetched.`, { cause: error }); }
  if (!response.ok) throw new HeadLoadError("preview_unreachable", `${resource.file} is unavailable.`);
  const bytes = await response.arrayBuffer();
  if (await sha256Hex(bytes) !== resource.sha256) throw new HeadLoadError("preview_damaged", `${resource.file} does not match its record.`);
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
    const head = named(record.geometry.nodes.head), eyes = named(record.geometry.nodes.eyes);
    const surfaces = new Map(Object.entries(record.geometry.nodes).filter(([key]) => key !== "head" && key !== "eyes")
      .map(([key, node]) => [key, named(node)] as const));
    if (!(head instanceof THREE.SkinnedMesh) || !eyes || [...surfaces.values()].some(mesh => !(mesh instanceof THREE.SkinnedMesh)))
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
    return { record, gltf, meshes, head, surfaces: surfaces as Map<string, THREE.SkinnedMesh>, eyes, textures: textures as Record<CoreTextureSlot, THREE.Texture> };
  } catch (error) {
    for (const texture of Object.values(textures)) texture?.dispose();
    gltf?.scene.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    // Anything that fails once the files arrived intact (model parse, missing parts, textures) is a damaged preview.
    throw error instanceof HeadLoadError ? error : new HeadLoadError("preview_damaged", (error as Error)?.message ?? "The 3D preview could not be read.", { cause: error });
  }
}
