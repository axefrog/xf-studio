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
  /** Expected SHA-256 of the served bytes. */
  sha256: string;
  sources: RenderSource[];
};
/** The morph resource that supplied one mesh node's facial targets (paired across nodes by target and region). */
export type RenderMorphSource = { node: string; depotPath: string; sha256: string | null };
export type CoreTextureSlot = "head.albedo" | "head.normal" | "head.roughness" | "eyes.albedo";
export const CORE_TEXTURE_SLOTS: readonly CoreTextureSlot[] = ["head.albedo", "head.normal", "head.roughness", "eyes.albedo"];
export const CORE_TEXTURE_COLOUR: Record<CoreTextureSlot, "srgb" | "linear"> =
  { "head.albedo": "srgb", "head.normal": "linear", "head.roughness": "linear", "eyes.albedo": "srgb" };
export type CoreDetail = {
  schema: typeof RENDER_DETAIL_SCHEMA;
  detail: "core-head";
  /** Stable identity of this exact derivation (the host's cache key). */
  identity: string;
  origin: "game-files";
  provenance: { label: string; notes: string[] };
  geometry: RenderResource & { nodes: { head: string; plate: string; eyes: string };
    /** Morph resource per mesh node. */
    morphs: RenderMorphSource[] };
  textures: Record<CoreTextureSlot, RenderResource>;
};

const fail = (message: string): never => { throw Error(`Render detail: ${message}`); };
const text = (value: unknown, name: string) => typeof value === "string" && value.length > 0 && value.length < 512 ? value : fail(`${name} is invalid.`);
const file = (value: unknown, name: string) => /^[a-z0-9][a-z0-9._-]{0,95}\.(glb|png)$/.test(String(value)) ? String(value) : fail(`${name} is not a plain asset file name.`);
const sha = (value: unknown, name: string) => /^[a-f0-9]{64}$/.test(String(value)) ? value as string : fail(`${name} hash is invalid.`);
const optionalSha = (value: unknown, name: string) => value === null ? null : sha(value, name);

function resource(value: unknown, name: string): RenderResource {
  const item = value as RenderResource;
  if (!item || typeof item !== "object" || !Array.isArray(item.sources)) fail(`${name} is missing.`);
  return { file: file(item.file, name), sha256: sha(item.sha256, name), sources: item.sources.map((source, index) => ({
    depotPath: text(source?.depotPath, `${name} source ${index}`),
    ...(source.sha256 !== undefined ? { sha256: sha(source.sha256, `${name} source ${index}`) } : {}),
    ...(source.material !== undefined ? { material: text(source.material, `${name} material`) } : {}),
    ...(source.parameter !== undefined ? { parameter: text(source.parameter, `${name} parameter`) } : {}),
    ...(source.adapter !== undefined ? { adapter: text(source.adapter, `${name} adapter`) } : {}),
  })) };
}

function morphSources(value: unknown): RenderMorphSource[] {
  if (!Array.isArray(value) || value.length > 16) fail("geometry morphs are invalid.");
  return (value as RenderMorphSource[]).map((entry, index) => ({ node: text(entry?.node, `morph ${index} node`),
    depotPath: text(entry?.depotPath, `morph ${index} source`), sha256: optionalSha(entry?.sha256 ?? null, `morph ${index}`) }));
}

/** Strict parse: an unexpected field shape never reaches the loader. */
export function parseCoreDetail(value: unknown): CoreDetail {
  const doc = value as CoreDetail;
  if (!doc || doc.schema !== RENDER_DETAIL_SCHEMA || doc.detail !== "core-head") fail("not a core head record.");
  if (doc.origin !== "game-files") fail("origin is invalid.");
  const nodes = doc.geometry?.nodes;
  if (!nodes || typeof nodes !== "object") fail("geometry nodes are missing.");
  const textures = Object.fromEntries(CORE_TEXTURE_SLOTS.map(slot => [slot, resource(doc.textures?.[slot], slot)])) as CoreDetail["textures"];
  return {
    schema: RENDER_DETAIL_SCHEMA, detail: "core-head", identity: text(doc.identity, "identity"), origin: doc.origin,
    provenance: { label: text(doc.provenance?.label, "provenance label"),
      notes: Array.isArray(doc.provenance?.notes) ? doc.provenance.notes.map(note => text(note, "note")) : [] },
    geometry: { ...resource(doc.geometry, "geometry"), nodes: { head: text(nodes.head, "head node"), plate: text(nodes.plate, "plate node"), eyes: text(nodes.eyes, "eyes node") },
      morphs: morphSources(doc.geometry.morphs) },
    textures,
  };
}
