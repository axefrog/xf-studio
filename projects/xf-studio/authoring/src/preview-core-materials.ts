/**
 * Pure reader for WolvenKit's mesh material export (`<mesh>.Material.json`). WolvenKit
 * resolves each mesh-local material through its `.mi` inheritance chain (the nearest
 * definition of a parameter wins) exactly as it does for its own tools; we read the result
 * instead of re-implementing that walk. Nothing here names a specific texture: the recipe
 * names an appearance and a parameter, and the game data supplies the depot path.
 */
export type MaterialExport = {
  Materials: { Name: string; BaseMaterial?: string; MaterialTemplate?: string; Data: Record<string, unknown> }[];
  Appearances: Record<string, string[]>;
};

export function parseMaterialExport(value: unknown): MaterialExport {
  const doc = value as MaterialExport;
  if (!doc || !Array.isArray(doc.Materials) || !doc.Appearances || typeof doc.Appearances !== "object")
    throw Error("WolvenKit's material export has an unexpected shape.");
  return doc;
}

/**
 * WolvenKit keys appearances as `<name><index>` (e.g. `default0`). Return the chunk
 * material names of the one appearance with exactly this name.
 */
export function appearanceMaterials(doc: MaterialExport, appearance: string): string[] {
  const matches = Object.entries(doc.Appearances).filter(([key]) =>
    key.startsWith(appearance) && /^\d+$/.test(key.slice(appearance.length)));
  if (matches.length !== 1) throw Error(`Appearance ${appearance} ${matches.length ? "is ambiguous" : "is missing"} in the material export.`);
  const materials = matches[0]![1];
  if (!Array.isArray(materials) || !materials.every(name => typeof name === "string")) throw Error(`Appearance ${appearance} is malformed.`);
  return materials;
}

export type ResolvedParameter = { appearance: string; material: string; baseMaterial: string | null; template: string | null; parameter: string; depotPath: string };

/** Depot path of one texture parameter for one chunk of one appearance. */
export function resolveTextureParameter(doc: MaterialExport, appearance: string, chunk: number, parameter: string): ResolvedParameter {
  const materials = appearanceMaterials(doc, appearance);
  const name = materials[chunk];
  if (!name) throw Error(`Appearance ${appearance} has no chunk ${chunk}.`);
  const material = doc.Materials.find(entry => entry.Name === name);
  if (!material) throw Error(`Material ${name} is missing from the material export.`);
  const value = material.Data?.[parameter];
  if (typeof value !== "string" || !/\.xbm$/i.test(value) || /[\0:]|(^|\\)\.\.(\\|$)/.test(value))
    throw Error(`Material ${name} has no texture for ${parameter}.`);
  return { appearance, material: name, baseMaterial: material.BaseMaterial ?? null, template: material.MaterialTemplate ?? null,
    parameter, depotPath: value };
}

/** WolvenKit writes a decoded texture beside its depot path with the export extension. */
export const decodedTexturePath = (depotPath: string, extension = "png") =>
  depotPath.replace(/\.xbm$/i, `.${extension}`).split("\\");
