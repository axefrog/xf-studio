import { EYE_MAKEUP_MOD } from "./mod-branding";
import { parseRecipe, type Recipe } from "./recipe";

export type PresetCollection = {
  // File-format compatibility ID; product branding does not change existing inputs.
  schema: "xfas/collection-1"; id: string; name: string;
  presets: { id: string; name: string; revision: number; recipe: Recipe }[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const title = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 120;

/** Identity is independent of display names, revisions and collection order. */
export function parseCollection(value: unknown, allowEmpty = false): PresetCollection {
  const input = value as PresetCollection;
  if (!input || input.schema !== "xfas/collection-1" || !uuid.test(input.id ?? "") || !title(input.name) || !Array.isArray(input.presets) || (!allowEmpty && !input.presets.length))
    throw Error("Expected a named XF Studio collection with a stable UUID and at least one preset.");
  const seen = new Set<string>();
  const presets = input.presets.map(p => {
    if (!p || !uuid.test(p.id ?? "") || seen.has(p.id) || !title(p.name) || !Number.isSafeInteger(p.revision) || p.revision < 1)
      throw Error("Preset identities must be unique UUIDs with a name and positive revision.");
    seen.add(p.id);
    return { id:p.id,name:p.name,revision:p.revision,recipe:parseRecipe(p.recipe) };
  });
  return { schema:input.schema,id:input.id,name:input.name,presets };
}

export function planCollection(value: unknown) {
  const collection = parseCollection(value), key = collection.id.replaceAll("-", "");
  const namespace = `xfs_c${key}`, depot = `axefrog/appearance_studio/collections/${key}`;
  const presets = collection.presets.map((preset, i) => {
    const appearance = `xfs_p${preset.id.replaceAll("-", "")}`;
    return { ...preset, index:i+1, appearance, appAppearance:`${namespace}__${appearance}`,
      textures:Object.fromEntries(["diffuse","roughness","metalness"].map(channel => [channel,`${depot}/textures/${appearance}_${channel}.xbm`])) as Record<"diffuse"|"roughness"|"metalness",string> };
  });
  // Branding (modName/selectorLabel) is display text, never part of a resource identity.
  return { schema:"xfas/export-plan-1" as const, collectionId:collection.id, name:collection.name,
    modName:EYE_MAKEUP_MOD.modName, selectorLabel:EYE_MAKEUP_MOD.selectorLabel, namespace, depot,
    selector:namespace, component:`${namespace}_makeup`, offAppearance:"xfs_off", templateAppearance:`${namespace}__xfs_template`,
    app:`${depot}/xfs_collection.app`, customization:`${depot}/xfs_collection.inkcharcustomization`,
    mesh:`${depot}/models/xfs_eye_plate.mesh`, morph:`${depot}/models/xfs_eye_plate.morphtarget`,
    presets, requirements:{ArchiveXL:"1.27.3",game:"2.31"},
    limitations:["Appearance names are stable; game save/index persistence across reorder/removal still requires runtime proof.",
      "One pack creates one selector. Multi-pack aggregation into one global selector is not implemented."] };
}
