/** Product compatibility data supplied by a feature, never inferred from a name. */
export type FrameworkId = "archivexl" | "tweakxl" | "codeware" | "red4ext" | "redscript" | "cet";
export interface FrameworkRequirement { readonly framework: FrameworkId; readonly minimum: string; readonly reason: string; readonly products?: readonly string[] }
export type FrameworkProduct = { readonly name: string; readonly requirements: readonly FrameworkRequirement[] };
export type ProductDefaults = {
  readonly modName: string;
  readonly selectorLabel: string;
  readonly legacyFeature: string;
  readonly legacyModFolders: readonly string[];
  readonly predecessorMods: readonly string[];
  readonly requirements: readonly FrameworkRequirement[];
  readonly unsupportedStoreMessage: string;
  readonly installedHint: string;
  readonly predecessorAdvice: string;
  readonly predecessorCaution: string;
  readonly predecessorAction: string;
};
export const NO_PRODUCT: ProductDefaults = Object.freeze({ modName: "mod", selectorLabel: "", legacyFeature: "",
  legacyModFolders: [], predecessorMods: [], requirements: [], unsupportedStoreMessage: "This game edition doesn't support these mods.",
  installedHint: "to see it", predecessorAdvice: "", predecessorCaution: "", predecessorAction: "" });
export const productFolders = (product: ProductDefaults) => [product.modName, ...product.legacyModFolders];
export const productRelatedEntries = (product: ProductDefaults) => [...product.legacyModFolders, ...product.predecessorMods];
export const isProductFolder = (name: string, product: ProductDefaults) => productFolders(product).some(folder => folder.toLowerCase() === name.toLowerCase());
/** Shared presentation copy for naming any mod. */
export const MOD_NAME_HINT = "The name your mod manager shows for this mod.";
