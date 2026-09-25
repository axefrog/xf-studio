import { canonicalJson, EYE_PLATE_RECIPE, eyePlateRecipeSha256, sha256Hex, type EyePlateRecipe } from "./eye-plate-recipe";
import type { CoreTextureSlot } from "./render-detail";

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
  /** The head and plate come from the eye plate recipe's audited source, so Build and preview share one head. */
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

/** The render detail record the renderer loads first; it names and hashes the other files. */
export const PREVIEW_CORE_RECORD_FILE = "preview-core.json";
export const PREVIEW_CORE_FILES = ["head.glb", ...PREVIEW_CORE_RECIPE.maps.map(map => map.file), PREVIEW_CORE_RECORD_FILE] as const;

export const previewCoreRecipeSha256 = (recipe: PreviewCoreRecipe, plate: EyePlateRecipe) =>
  sha256Hex(canonicalJson({ preview: recipe, plate: eyePlateRecipeSha256(plate) }));

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
