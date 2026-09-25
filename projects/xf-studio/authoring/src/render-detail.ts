/**
 * Typed records the renderer loads details from. A record names each renderable resource
 * (geometry or texture), where to fetch it, its expected bytes, and which game resources it
 * came from (depot paths, materials, parameters and the adapter applied), so the renderer
 * never guesses identities from fixed URLs. Hosts produce records (the derived core preview
 * today; resolver output for skin, hair, piercings and other characters next). Pure: no IO.
 */
export const RENDER_DETAIL_SCHEMA = "xfs/render-detail-1" as const;
export const CORE_DETAIL_URL = "/assets/preview-core.json";

export type RenderSource = { depotPath: string; sha256?: string; material?: string; parameter?: string; adapter?: string };
export type RenderResource = {
  /** File name under `/assets/`. */
  file: string;
  /** Expected SHA-256 of the served bytes; null when the source (a developer intake) records none. */
  sha256: string | null;
  sources: RenderSource[];
};
export type CoreTextureSlot = "head.albedo" | "head.normal" | "head.roughness" | "eyes.albedo";
export const CORE_TEXTURE_SLOTS: readonly CoreTextureSlot[] = ["head.albedo", "head.normal", "head.roughness", "eyes.albedo"];
export const CORE_TEXTURE_COLOUR: Record<CoreTextureSlot, "srgb" | "linear"> =
  { "head.albedo": "srgb", "head.normal": "linear", "head.roughness": "linear", "eyes.albedo": "srgb" };
export type CoreDetail = {
  schema: typeof RENDER_DETAIL_SCHEMA;
  detail: "core-head";
  /** Stable identity of this exact derivation (the host's cache key), or "prepared". */
  identity: string;
  origin: "game-files" | "prepared";
  provenance: { label: string; notes: string[] };
  geometry: RenderResource & { nodes: { head: string; plate: string; eyes: string } };
  textures: Record<CoreTextureSlot, RenderResource>;
};

const fail = (message: string): never => { throw Error(`Render detail: ${message}`); };
const text = (value: unknown, name: string) => typeof value === "string" && value.length > 0 && value.length < 512 ? value : fail(`${name} is invalid.`);
const file = (value: unknown, name: string) => /^[a-z0-9][a-z0-9._-]{0,95}\.(glb|png)$/.test(String(value)) ? String(value) : fail(`${name} is not a plain asset file name.`);
const sha = (value: unknown, name: string) => value === null || /^[a-f0-9]{64}$/.test(String(value)) ? (value as string | null) : fail(`${name} hash is invalid.`);

function resource(value: unknown, name: string): RenderResource {
  const item = value as RenderResource;
  if (!item || typeof item !== "object" || !Array.isArray(item.sources)) fail(`${name} is missing.`);
  return { file: file(item.file, name), sha256: sha(item.sha256, name), sources: item.sources.map((source, index) => ({
    depotPath: text(source?.depotPath, `${name} source ${index}`),
    ...(source.sha256 !== undefined ? { sha256: sha(source.sha256, `${name} source ${index}`)! } : {}),
    ...(source.material !== undefined ? { material: text(source.material, `${name} material`) } : {}),
    ...(source.parameter !== undefined ? { parameter: text(source.parameter, `${name} parameter`) } : {}),
    ...(source.adapter !== undefined ? { adapter: text(source.adapter, `${name} adapter`) } : {}),
  })) };
}

/** Strict parse: an unexpected field shape never reaches the loader. */
export function parseCoreDetail(value: unknown): CoreDetail {
  const doc = value as CoreDetail;
  if (!doc || doc.schema !== RENDER_DETAIL_SCHEMA || doc.detail !== "core-head") fail("not a core head record.");
  if (doc.origin !== "game-files" && doc.origin !== "prepared") fail("origin is invalid.");
  const nodes = doc.geometry?.nodes;
  if (!nodes || typeof nodes !== "object") fail("geometry nodes are missing.");
  const textures = Object.fromEntries(CORE_TEXTURE_SLOTS.map(slot => [slot, resource(doc.textures?.[slot], slot)])) as CoreDetail["textures"];
  return {
    schema: RENDER_DETAIL_SCHEMA, detail: "core-head", identity: text(doc.identity, "identity"), origin: doc.origin,
    provenance: { label: text(doc.provenance?.label, "provenance label"),
      notes: Array.isArray(doc.provenance?.notes) ? doc.provenance.notes.map(note => text(note, "note")) : [] },
    geometry: { ...resource(doc.geometry, "geometry"), nodes: { head: text(nodes.head, "head node"), plate: text(nodes.plate, "plate node"), eyes: text(nodes.eyes, "eyes node") } },
    textures,
  };
}

/** The developer intake's five prepared files carry no record; describe them with their fixed names. */
export const PREPARED_CORE_DETAIL: CoreDetail = Object.freeze({
  schema: RENDER_DETAIL_SCHEMA, detail: "core-head", identity: "prepared", origin: "prepared",
  provenance: { label: "Developer-prepared preview files", notes: ["Prepared outside XF Studio; no source record."] },
  geometry: { file: "head.glb", sha256: null, sources: [], nodes: { head: "head", plate: "makeup_plate", eyes: "eyes" } },
  textures: {
    "head.albedo": { file: "head-color.png", sha256: null, sources: [] },
    "head.normal": { file: "head-normal.png", sha256: null, sources: [] },
    "head.roughness": { file: "head-roughness.png", sha256: null, sources: [] },
    "eyes.albedo": { file: "eye-color.png", sha256: null, sources: [] },
  },
}) as CoreDetail;
