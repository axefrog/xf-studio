import { canonicalJson, EYE_PLATE_MASCULINE_RECIPE, EYE_PLATE_RECIPE, eyePlateRecipeSha256, sha256Hex, type EyePlateRecipe } from "./eye-plate-recipe";
import { CORE_ASSET_PREFIX, CORE_BODIES, coreAssetName, type CoreBody, type CoreTextureSlot } from "./render-detail";
export { CORE_ASSET_PREFIX, CORE_BODIES, coreAssetName, type CoreBody };

/**
 * The 3D preview core (head, expanded eye plate, eyes and their maps) ships as an asset-free
 * recipe, like the built-in eye plate: which installed resources to read, which of the game's
 * own appearances and material parameters select the maps, and how each map is adapted for
 * the browser renderer. No game geometry or pixels are tracked; every user derives them from
 * their own Cyberpunk 2077 installation.
 */
export const PREVIEW_CORE_RECIPE_SCHEMA = "xfs/preview-core-recipe-1" as const;
/** Bump whenever assembly, map adapters or the manifest change output bytes for the same sources. */
/** 3: the key also covers the exported GLBs, material exports and the exporting tool; the record names the tool. */
export const PREVIEW_CORE_DERIVER_VERSION = 3;

export type MapAdapter = "colour-copy" | "packed-normal" | "red-to-grey";
export type PreviewCoreMap = {
  /** Output file served to the renderer. */
  file: "head-color.png" | "head-normal.png" | "head-roughness.png" | "eye-color.png";
  /** Which mesh's resolved material supplies it. */
  mesh: "head" | "eye";
  /** Material parameter as WolvenKit resolves it through the `.mi` inheritance chain. */
  parameter: "Albedo" | "Normal" | "Roughness";
  adapter: MapAdapter;
  /** Where the renderer uses it. */
  slot: CoreTextureSlot;
};
export type PreviewCoreRecipe = {
  schema: typeof PREVIEW_CORE_RECIPE_SCHEMA;
  id: string;
  revision: number;
  body: CoreBody;
  /**
   * The eye plate recipe whose depot paths name the head and plate the preview shows. The preview reads them
   * from the base game's content archives only; Build cuts the plate from the head the selected launch route
   * loads (a head mod may win). With a head mod installed the two can differ until the preview reads the
   * resolver's winning archives too (PREV-03).
   */
  plateRecipeId: string;
  /**
   * The eye component: its mesh (materials and base geometry) and the morph resource the installed
   * eye entity binds (`he_000_pwa__basehead.ent` → `morphResource`), whose `eyes` targets pair with
   * the head's by `(target, region)` so the eyeballs follow the eye-shape choice.
   */
  eye: { meshDepotPath: string; morphDepotPath: string; surfaceMesh: string; appearance: string; chunk: number };
  head: { appearance: string; chunk: number };
  maps: PreviewCoreMap[];
};

export const PREVIEW_CORE_RECIPE: PreviewCoreRecipe = Object.freeze({
  schema: PREVIEW_CORE_RECIPE_SCHEMA,
  id: "xfs-preview-core-female-average",
  revision: 2,
  body: "female",
  plateRecipeId: EYE_PLATE_RECIPE.id,
  // The female eye mesh that sits beside the head mesh; its surface chunk is the eyeball. The eye
  // entity binds `he_000_pwa__morphs` (baseMesh = this mesh), separate from the head's morph resource.
  eye: { meshDepotPath: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\he_000_pwa_c__basehead.mesh",
    morphDepotPath: "base\\characters\\head\\player_base_heads\\player_female_average\\he_000_pwa__morphs.morphtarget",
    surfaceMesh: "submesh_01_LOD_1", appearance: "gradient_brown", chunk: 1 },
  // The head mesh's own `default` appearance (the vanilla pale skin tone).
  head: { appearance: "default", chunk: 0 },
  maps: [
    { file: "head-color.png", mesh: "head", parameter: "Albedo", adapter: "colour-copy", slot: "head.albedo" },
    { file: "head-normal.png", mesh: "head", parameter: "Normal", adapter: "packed-normal", slot: "head.normal" },
    { file: "head-roughness.png", mesh: "head", parameter: "Roughness", adapter: "red-to-grey", slot: "head.roughness" },
    { file: "eye-color.png", mesh: "eye", parameter: "Albedo", adapter: "colour-copy", slot: "eyes.albedo" },
  ],
}) as PreviewCoreRecipe;

/**
 * The masculine head's plate (male V plan §4.1: the male head's triangles over the feminine plate's UVs,
 * `tools/derive-plate-selection.ts`), the recipe Build cuts the masculine plate with (phase 5).
 */
export const PREVIEW_MASCULINE_PLATE_RECIPE: EyePlateRecipe = EYE_PLATE_MASCULINE_RECIPE;

/**
 * The masculine V's core: his own head and plate, and his eye mesh, whose chunk roles are swapped against the feminine
 * one (chunk 1 the wetness shell, chunk 2 the eyeball; eye-rendering knowledge page). His head mesh has no `default`
 * appearance, so the core shows its first, the pale tone, until the V's resolved skin arrives.
 */
export const PREVIEW_CORE_MALE_RECIPE: PreviewCoreRecipe = Object.freeze({
  ...PREVIEW_CORE_RECIPE,
  id: "xfs-preview-core-male-average",
  revision: 1,
  body: "male",
  plateRecipeId: PREVIEW_MASCULINE_PLATE_RECIPE.id,
  eye: { meshDepotPath: "base\\characters\\head\\player_base_heads\\player_man_average\\h0_000_pma_c__basehead\\he_000_pma_c__basehead.mesh",
    morphDepotPath: "base\\characters\\head\\player_base_heads\\player_man_average\\he_000_pma__morphs.morphtarget",
    surfaceMesh: "submesh_02_LOD_1", appearance: "gradient_brown", chunk: 2 },
  head: { appearance: "01_ca_pale", chunk: 0 },
}) as PreviewCoreRecipe;

/** Each body's core recipe and the plate recipe that names its head. */
export const PREVIEW_CORE_RECIPES: Readonly<Record<CoreBody, { recipe: PreviewCoreRecipe; plate: EyePlateRecipe }>> = Object.freeze({
  female: { recipe: PREVIEW_CORE_RECIPE, plate: EYE_PLATE_RECIPE },
  male: { recipe: PREVIEW_CORE_MALE_RECIPE, plate: PREVIEW_MASCULINE_PLATE_RECIPE },
});

/** The render detail record the renderer loads first; it names and hashes the other files. */
export const PREVIEW_CORE_RECORD_FILE = "preview-core.json";
export const PREVIEW_CORE_FILES = ["head.glb", ...PREVIEW_CORE_RECIPE.maps.map(map => map.file), PREVIEW_CORE_RECORD_FILE] as const;
/** Every served core asset name, both bodies (render-detail.ts `coreAssetName`). */
export const PREVIEW_CORE_ASSET_NAMES: readonly string[] = CORE_BODIES.flatMap(body => PREVIEW_CORE_FILES.map(file => coreAssetName(body, file)));
/** The body and file an served core asset name addresses, or null for any other name. */
export function parseCoreAssetName(name: string): { body: CoreBody; file: string } | null {
  for (const body of CORE_BODIES) {
    const prefix = CORE_ASSET_PREFIX[body];
    if (!name.startsWith(prefix)) continue;
    const file = name.slice(prefix.length);
    if ((PREVIEW_CORE_FILES as readonly string[]).includes(file) && coreAssetName(body, file) === name) return { body, file };
  }
  return null;
}

/**
 * Recipe identity. `body` is left out: the depot paths already say whose head it is, and leaving it out keeps the feminine
 * core's identity (and every cached feminine preview) unchanged from before the masculine core existed.
 */
export const previewCoreRecipeSha256 = (recipe: PreviewCoreRecipe, plate: EyePlateRecipe) => {
  const { body: _body, ...identity } = recipe;
  return sha256Hex(canonicalJson({ preview: identity, plate: eyePlateRecipeSha256(plate) }));
};

export type PreviewCoreSourceHashes = {
  headMeshSha256: string; headMorphSha256: string; eyeMeshSha256: string; eyeMorphSha256: string;
  /** The exported head (with its facial shapes) and eye GLBs, and both meshes' material exports. */
  headGlbSha256: string; eyeGlbSha256: string; eyeMorphGlbSha256: string; headMaterialsSha256: string; eyeMaterialsSha256: string;
  /** Identity key of the exporting tool (e.g. WolvenKit version and content hash). */
  tool: string;
  /** Decoded source texture PNG hashes by output file. */
  textures: Record<string, string>;
};
/** Cache identity: recipe content, both recipes' revisions, exact sources and the deriver's output contract. */
export function previewCoreCacheKey(recipe: PreviewCoreRecipe, plate: EyePlateRecipe, source: PreviewCoreSourceHashes): string {
  return sha256Hex(canonicalJson({ deriver: PREVIEW_CORE_DERIVER_VERSION, recipe: previewCoreRecipeSha256(recipe, plate), source }));
}
export const previewCoreCacheName = (recipe: PreviewCoreRecipe, key: string) => `${recipe.id}-r${recipe.revision}-${key.slice(0, 16)}`;
