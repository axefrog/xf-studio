import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { markPhase } from "../character-timing";
import { HeadLoadError } from "../../preview/head-load-error";
import { floatJointIndices, restoreFirstWeights } from "../../materials/render/skin";
import { CORE_TEXTURE_COLOUR, CORE_TEXTURE_SLOTS, coreAssetName, coreDetailUrl, parseCoreDetail, type CoreBody, type CoreDetail,
  type CoreTextureSlot, type RenderResource } from "../render-detail";

/**
 * Renderer device port for the core head detail: it takes the host's typed render record for
 * the preview derived from the player's game files, fetches and hash-checks each
 * resource, and returns ready Three.js objects. On any failure it disposes what it created.
 * Later details (skin variants, hair, piercings, other characters) should load through the
 * same record shape instead of fixed URLs.
 */
export type LoadedCoreDetail = {
  record: CoreDetail;
  /** Whose head this is: the feminine or the masculine V's core (each prepared from the player's game files). */
  body: CoreBody;
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
export type CoreDetailFetch = (url: string, init?: RequestInit) => Promise<Response>;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The host's record for a body's derived preview; there is no other source of the core head. */
export async function readCoreDetail(fetcher: CoreDetailFetch = fetch, body: CoreBody = "female"): Promise<CoreDetail> {
  let response: Response;
  try { response = await fetcher(coreDetailUrl(body)); }
  catch (error) { throw new HeadLoadError("preview_unreachable", "The 3D view record could not be read.", { cause: error }); }
  if (response.status === 404) throw new HeadLoadError("preview_unreachable", "The 3D view hasn't been prepared from your game files yet.");
  if (!response.ok) throw new HeadLoadError("preview_unreachable", "The 3D view record could not be read.");
  try { return parseCoreDetail(await response.json()); }
  catch (error) { throw new HeadLoadError("preview_damaged", "The 3D view record is damaged.", { cause: error }); }
}

async function resourceBytes(resource: RenderResource, fetcher: CoreDetailFetch, body: CoreBody): Promise<ArrayBuffer> {
  let response: Response;
  try { response = await fetcher(`/assets/${coreAssetName(body, resource.file)}`); }
  catch (error) { throw new HeadLoadError("preview_unreachable", `${resource.file} could not be fetched.`, { cause: error }); }
  if (!response.ok) throw new HeadLoadError("preview_unreachable", `${resource.file} is unavailable.`);
  const bytes = await response.arrayBuffer();
  if (await sha256Hex(bytes) !== resource.sha256) throw new HeadLoadError("preview_damaged", `${resource.file} does not match its record.`);
  return bytes;
}

type GeometryRead = { key: string; bytes: Promise<ArrayBuffer>; life: AbortController; wants: number; done: boolean; drop(): void };
const geometryBytes = new WeakMap<object, Map<CoreBody, GeometryRead>>();
/** End the viewport's CPU-byte cache as well as any pending transports, even if the disposed viewport object stays referenced. */
export function releaseCoreDetailFiles(owner: object): void {
  const reads = geometryBytes.get(owner);
  geometryBytes.delete(owner);
  for (const read of reads?.values() ?? []) if (!read.done) read.life.abort();
  reads?.clear();
}
/**
 * A body's core head file (12 MB) as one viewport's runtimes share it: fetched and checked once, whichever runtime asks first, instead of
 * once per runtime (a third scene's head waited 0.09–0.5 s for it, experiment 044 §16). The bytes are the record's hash, so a core
 * prepared again (another file) is another entry; only the latest of each body is kept, and a failed read is not kept.
 */
function sharedGeometryBytes(owner: object, body: CoreBody, resource: RenderResource, fetcher: CoreDetailFetch, signal?: AbortSignal): Promise<ArrayBuffer> {
  let bodies = geometryBytes.get(owner);
  if (!bodies) geometryBytes.set(owner, bodies = new Map());
  const key = `${resource.file}|${resource.sha256}`, kept = bodies.get(body);
  let entry = kept?.key === key && !kept.life.signal.aborted ? kept : undefined;
  if (!entry) {
    const life = new AbortController();
    const made: GeometryRead = { key, life, wants: 0, done: false,
      bytes: resourceBytes(resource, (url, init) => fetcher(url, { ...init, signal: life.signal }), body),
      drop: () => { if (bodies.get(body) === made) bodies.delete(body); } };
    bodies.set(body, made); entry = made;
    void made.bytes.then(() => { made.done = true; }, made.drop);
  }
  const read = entry;
  read.wants++;
  return new Promise((resolve, reject) => {
    let held = true;
    const release = () => {
      if (!held) return;
      held = false; signal?.removeEventListener("abort", abort);
      if (--read.wants === 0 && !read.done) { read.drop(); read.life.abort(); }
    };
    const abort = () => { release(); reject(signal!.reason); };
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    read.bytes.then(value => { release(); signal?.aborted ? reject(signal.reason) : resolve(value); }, error => { release(); reject(error); });
  });
}

type CoreFiles = { record: CoreDetail; geometry: Promise<ArrayBuffer>; textures: Record<CoreTextureSlot, Promise<ArrayBuffer>> };
/** Start verified file I/O before WebGL/context/lighting initialization. No Three/GPU objects are allocated by this read. */
export function startCoreDetail(fetcher: CoreDetailFetch, body: CoreBody, signal: AbortSignal, owner: object = {}) {
  const send: CoreDetailFetch = (url, init) => fetcher(url, { ...init, signal });
  const ready = readCoreDetail(send, body).then(record => {
    signal.throwIfAborted();
    markPhase("core:record");
    const geometry = sharedGeometryBytes(owner, body, record.geometry, fetcher, signal);
    const textures = Object.fromEntries(CORE_TEXTURE_SLOTS.map(slot => [slot, resourceBytes(record.textures[slot], send, body)])) as CoreFiles["textures"];
    // A renderer initialization failure or cancellation may leave these reads unconsumed; their signal still owns them.
    for (const read of [geometry, ...Object.values(textures)]) void read.catch(() => {});
    return { record, geometry, textures };
  });
  void ready.catch(() => {});
  // The runtime retains its loader option. Drop its captured read after consumption so it does not retain raw texture buffers too.
  let unread: Promise<CoreFiles> | undefined = ready;
  return { ready, load: async (renderer: THREE.WebGLRenderer) => {
    const pending = unread; unread = undefined;
    if (!pending) throw Error("The core read was already consumed.");
    return loadCoreDetail(renderer, send, body, signal, await pending);
  } };
}

/**
 * Load a body's core head. `signal` is checked between steps (the record, the geometry's bytes, its parse, the textures): an abort rejects
 * with its reason, and what was made is disposed. A step already running (a parse, a decode) finishes first.
 */
export async function loadCoreDetail(renderer: THREE.WebGLRenderer, fetcher: CoreDetailFetch = fetch, body: CoreBody = "female",
  signal?: AbortSignal, files?: CoreFiles): Promise<LoadedCoreDetail> {
  signal?.throwIfAborted();
  const send: CoreDetailFetch = (url, init) => fetcher(url, { ...init, ...(signal ? { signal } : {}) });
  let record: CoreDetail;
  try { record = files?.record ?? await readCoreDetail(send, body); }
  // An abort is no failure of the files: a read cut short by it rejects with its reason, not as an unreachable preview.
  catch (error) { if (signal?.aborted) throw signal.reason; throw error; }
  if (!files) markPhase("core:record");
  signal?.throwIfAborted();
  const textures: Partial<Record<CoreTextureSlot, THREE.Texture>> = {};
  let gltf: GLTF | undefined;
  try {
    const data = await (files?.geometry ?? sharedGeometryBytes(renderer, body, record.geometry, fetcher, signal));
    signal?.throwIfAborted();
    markPhase("core:bytes");
    const weights = restoreFirstWeights(data);
    gltf = await new GLTFLoader().parseAsync(data, "/assets/");
    markPhase("core:parsed");
    signal?.throwIfAborted();
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
      floatJointIndices(mesh.geometry);
    }
    const loader = new THREE.TextureLoader();
    await Promise.all(CORE_TEXTURE_SLOTS.map(async slot => {
      const bytes = await (files?.textures[slot] ?? resourceBytes(record.textures[slot], send, body));
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
    markPhase("core:textures");
    signal?.throwIfAborted();
    return { record, body, gltf, meshes, head, surfaces: surfaces as Map<string, THREE.SkinnedMesh>, eyes, textures: textures as Record<CoreTextureSlot, THREE.Texture> };
  } catch (error) {
    if (gltf) coreDisposer({ gltf, textures: textures as LoadedCoreDetail["textures"] })();
    else for (const texture of Object.values(textures)) texture?.dispose();
    // An abort is no failure of the files: its reason passes through as it is.
    if (signal?.aborted) throw signal.reason;
    // Anything that fails once the files arrived intact (model parse, missing parts, textures) is a damaged preview.
    throw error instanceof HeadLoadError ? error : new HeadLoadError("preview_damaged", (error as Error)?.message ?? "The 3D view could not be read.", { cause: error });
  }
}

/**
 * The GPU resources a loaded core head owns, captured now (before a rig swaps any mesh or material), and a function that frees them: every
 * geometry, material, texture and skeleton (its bone texture) of its glTF scene, and its record's textures. Whoever holds the core calls
 * it when the head goes; the renderer it was drawn with may live on (profiles phase 4a: several scenes on one renderer), so nothing waits
 * for the context to be lost.
 */
export function coreDisposer(core: Pick<LoadedCoreDetail, "gltf" | "textures">): () => void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  for (const texture of Object.values(core.textures)) if (texture) textures.add(texture);
  core.gltf.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    // A skinned mesh's bone texture is the skeleton's own GPU texture, made on its first draw.
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
    }
  });
  return () => {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
  };
}
