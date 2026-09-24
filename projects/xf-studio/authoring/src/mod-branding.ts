/**
 * Mod branding: the single source of truth for user-visible mod names.
 *
 * XF Studio is the app. Each mod it produces carries its own XF-branded name
 * in game and in mod managers. The eye-makeup export is XF Eye Artistry: its
 * character-creator selector label, MO2 mod entry/folder and package naming all
 * come from this module. The export plan carries these values to the Python
 * resource builder and verifier, so neither side keeps its own copy.
 *
 * Internal resource identifiers (`xfs_` names, UUID-derived namespaces, schema
 * IDs and the `axefrog/appearance_studio` depot root) are not branding and are
 * deliberately not derived from these names.
 */
const modName = "XF Eye Artistry";

export const EYE_MAKEUP_MOD = Object.freeze({
  /** Mod-manager entry, MO2 mod folder and user-facing package name. */
  modName,
  /** Character-creator selector label (the customization option's `localizedName`). */
  selectorLabel: modName,
  /**
   * Earlier MO2 folder names used by diagnostic installs of this same mod before
   * it had its own brand. Tools treat these as an existing XF Eye Artistry
   * install: they refuse to create a second copy alongside one, but can still
   * roll back or recover a promotion that created one.
   */
  legacyModFolders: Object.freeze(["XF Studio"] as const),
});

/** Every MO2 folder name that denotes this mod, current name first. */
export const eyeMakeupModFolders: readonly string[] =
  Object.freeze([EYE_MAKEUP_MOD.modName, ...EYE_MAKEUP_MOD.legacyModFolders]);

/** Case-insensitive match against the current or a legacy mod folder name. */
export function isEyeMakeupModFolder(name: string): boolean {
  const key = name.toLowerCase();
  return eyeMakeupModFolders.some(folder => folder.toLowerCase() === key);
}
