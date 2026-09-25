import { createHash } from "node:crypto";
import recipeJson from "./eye-plate-recipe.json" with { type: "json" };

/**
 * The expanded eye plate ships as an asset-free recipe: a triangle selection of the
 * installed female player head plus the source revisions it has been audited against.
 * Build derives the plate from the player's own game files; no game geometry is tracked.
 */
export const EYE_PLATE_RECIPE_SCHEMA = "xfs/eye-plate-recipe-1" as const;
/** Bump whenever the cut or resource writer changes output bytes for the same recipe and source. */
export const EYE_PLATE_DERIVER_VERSION = 1;

export type EyePlateSourceRevision = { id: string; label: string; meshSha256: string; morphSha256: string };
export type EyePlateTopology = { componentVertexCounts: number[]; boundaryEdges: number; boundaryLoops: number; nonManifoldEdges: number };
export type EyePlateRecipe = {
  schema: typeof EYE_PLATE_RECIPE_SCHEMA;
  id: string;
  revision: number;
  description: string;
  source: { archiveDirectory: string; meshDepotPath: string; morphDepotPath: string; supported: EyePlateSourceRevision[] };
  selection: {
    renderChunk: number; faceCount: number; vertexCount: number; morphTargetCount: number;
    faceIdsSha256: string; vertexIdsSha256: string; topology: EyePlateTopology;
    faceRangesInclusive: [number, number][];
  };
  output: { stem: string; appearance: string; dropVertexUsages: string[]; vertexFactory: number;
    baseMaterial: string; morphBaseTexture: string };
};

const fail = (message: string): never => { throw Error(`Eye plate recipe: ${message}`); };
const record = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object.`);
  return value as Record<string, unknown>;
};
const exactKeys = (value: Record<string, unknown>, keys: readonly string[], name: string) => {
  const actual = Object.keys(value).sort(), expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${name} must contain exactly ${expected.join(", ")}.`);
};
const text = (value: unknown, name: string, pattern = /^[^\x00-\x1f]+$/): string => {
  if (typeof value !== "string" || !pattern.test(value)) fail(`${name} is invalid.`);
  return value as string;
};
const count = (value: unknown, name: string, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(`${name} must be an integer of at least ${minimum}.`);
  return value as number;
};
const sha = (value: unknown, name: string) => text(value, name, /^[a-f0-9]{64}$/);
const identifier = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const depotPath = /^[a-z0-9_]+(?:\\[a-z0-9_.@-]+)+$/;
const resourceName = /^xfs_[a-z0-9_]{1,60}$/;

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Face IDs in ascending order, expanded from the recipe's inclusive ranges. */
export function selectedFaceIds(recipe: Pick<EyePlateRecipe, "selection">): number[] {
  return recipe.selection.faceRangesInclusive.flatMap(([first, last]) =>
    Array.from({ length: last - first + 1 }, (_, index) => first + index));
}

/** Little-endian uint32 digest used for both face and vertex ID lists. */
export function idListSha256(ids: readonly number[]): string {
  const bytes = Buffer.alloc(ids.length * 4);
  ids.forEach((id, index) => bytes.writeUInt32LE(id, index * 4));
  return sha256Hex(bytes);
}

/** Strict validation: an unknown field or a drifted selection must never reach the resource writer. */
export function parseEyePlateRecipe(value: unknown): EyePlateRecipe {
  const root = record(value, "Recipe");
  exactKeys(root, ["schema", "id", "revision", "description", "source", "selection", "output"], "Recipe");
  if (root.schema !== EYE_PLATE_RECIPE_SCHEMA) fail("unsupported schema.");
  const source = record(root.source, "source");
  exactKeys(source, ["archiveDirectory", "meshDepotPath", "morphDepotPath", "supported"], "source");
  if (!Array.isArray(source.supported) || source.supported.length === 0) fail("source.supported must list at least one revision.");
  const supported = (source.supported as unknown[]).map((entry, index) => {
    const item = record(entry, `source.supported[${index}]`);
    exactKeys(item, ["id", "label", "meshSha256", "morphSha256"], `source.supported[${index}]`);
    return { id: text(item.id, "source revision id", identifier), label: text(item.label, "source revision label"),
      meshSha256: sha(item.meshSha256, "source mesh hash"), morphSha256: sha(item.morphSha256, "source morph hash") };
  });
  if (new Set(supported.map(item => item.id)).size !== supported.length) fail("source revision ids must be unique.");
  const selection = record(root.selection, "selection");
  exactKeys(selection, ["renderChunk", "faceCount", "vertexCount", "morphTargetCount", "faceIdsSha256",
    "vertexIdsSha256", "topology", "faceRangesInclusive"], "selection");
  const topology = record(selection.topology, "selection.topology");
  exactKeys(topology, ["componentVertexCounts", "boundaryEdges", "boundaryLoops", "nonManifoldEdges"], "selection.topology");
  if (!Array.isArray(topology.componentVertexCounts) || topology.componentVertexCounts.length === 0) fail("topology components are missing.");
  const components = (topology.componentVertexCounts as unknown[]).map(item => count(item, "topology component", 1));
  if (!Array.isArray(selection.faceRangesInclusive) || selection.faceRangesInclusive.length === 0) fail("face ranges are missing.");
  let previous = -1;
  const ranges = (selection.faceRangesInclusive as unknown[]).map(range => {
    if (!Array.isArray(range) || range.length !== 2) fail("each face range must be [first, last].");
    const [first, last] = [count((range as unknown[])[0], "face range start"), count((range as unknown[])[1], "face range end")];
    if (last < first || first <= previous) fail("face ranges must be ascending, non-empty and non-overlapping.");
    previous = last;
    return [first, last] as [number, number];
  });
  const output = record(root.output, "output");
  exactKeys(output, ["stem", "appearance", "dropVertexUsages", "vertexFactory", "baseMaterial", "morphBaseTexture"], "output");
  if (!Array.isArray(output.dropVertexUsages)) fail("output.dropVertexUsages must be a list.");
  const recipe: EyePlateRecipe = {
    schema: EYE_PLATE_RECIPE_SCHEMA,
    id: text(root.id, "id", identifier),
    revision: count(root.revision, "revision", 1),
    description: text(root.description, "description"),
    source: { archiveDirectory: text(source.archiveDirectory, "archive directory", /^[a-z0-9_]+(?:\/[a-z0-9_]+)*$/),
      meshDepotPath: text(source.meshDepotPath, "mesh depot path", depotPath),
      morphDepotPath: text(source.morphDepotPath, "morph depot path", depotPath), supported },
    selection: {
      renderChunk: count(selection.renderChunk, "render chunk"),
      faceCount: count(selection.faceCount, "face count", 1),
      vertexCount: count(selection.vertexCount, "vertex count", 3),
      morphTargetCount: count(selection.morphTargetCount, "morph target count"),
      faceIdsSha256: sha(selection.faceIdsSha256, "face ID hash"),
      vertexIdsSha256: sha(selection.vertexIdsSha256, "vertex ID hash"),
      topology: { componentVertexCounts: components, boundaryEdges: count(topology.boundaryEdges, "boundary edges"),
        boundaryLoops: count(topology.boundaryLoops, "boundary loops"), nonManifoldEdges: count(topology.nonManifoldEdges, "non-manifold edges") },
      faceRangesInclusive: ranges,
    },
    output: {
      stem: text(output.stem, "output stem", resourceName),
      appearance: text(output.appearance, "output appearance", resourceName),
      dropVertexUsages: (output.dropVertexUsages as unknown[]).map(item => text(item, "dropped vertex usage", /^PS_[A-Za-z]+$/)),
      vertexFactory: count(output.vertexFactory, "vertex factory"),
      baseMaterial: text(output.baseMaterial, "base material", depotPath),
      morphBaseTexture: text(output.morphBaseTexture, "morph base texture", depotPath),
    },
  };
  const faces = selectedFaceIds(recipe);
  if (faces.length !== recipe.selection.faceCount) fail("face ranges do not add up to faceCount.");
  if (idListSha256(faces) !== recipe.selection.faceIdsSha256) fail("face ranges do not match faceIdsSha256.");
  if (components.reduce((sum, value) => sum + value, 0) !== recipe.selection.vertexCount) fail("topology components do not add up to vertexCount.");
  return recipe;
}

/** Stable JSON with sorted object keys, so equivalent recipes hash identically. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export const eyePlateRecipeSha256 = (recipe: EyePlateRecipe) => sha256Hex(canonicalJson(recipe));

export type EyePlateSourceHashes = { meshSha256: string; morphSha256: string };
/**
 * Cache identity: recipe content, exact source resources, the deriver's output contract and, when known, the
 * head provenance (winning archives, providers and hashes of every resource and applied patch), so a plate cut
 * from a mod's head is never reused for another source and its cached provenance stays exact.
 */
export function eyePlateCacheKey(recipe: EyePlateRecipe, source: EyePlateSourceHashes, head?: unknown): string {
  return sha256Hex(canonicalJson({ deriver: EYE_PLATE_DERIVER_VERSION, recipe: eyePlateRecipeSha256(recipe),
    sourceMesh: source.meshSha256, sourceMorph: source.morphSha256, ...(head === undefined ? {} : { head }) }));
}
export const eyePlateCacheName = (recipe: EyePlateRecipe, key: string) => `${recipe.id}-r${recipe.revision}-${key.slice(0, 16)}`;

export function supportedEyePlateSource(recipe: EyePlateRecipe, source: EyePlateSourceHashes): EyePlateSourceRevision | null {
  return recipe.source.supported.find(item => item.meshSha256 === source.meshSha256 && item.morphSha256 === source.morphSha256) ?? null;
}

export const EYE_PLATE_RECIPE: EyePlateRecipe = parseEyePlateRecipe(recipeJson);
