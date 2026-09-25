/**
 * The character creator's presentation data that lives in TweakDB rather than in the `.inkcharcustomization`
 * resource: the ordered, labelled option categories and the swatch icons. Pure over a `TweakDbBlob`.
 *
 * - **Categories** [resource + source]: the creator's randomizer lists its categories from the record
 *   `CharacterRandomization.CharacterRandomizationCategories` (field `list`), each a `CharacterRandomizationCategoryUI`
 *   record with `categoryName` (a localisation key such as `UI-CharacterCreation-skin`) and `categoryType`, whose
 *   `enumName` equals the options' `randomizeCategory` (`Skin`, `Hair`, …). Script source: the game's
 *   `characterCreationPunkRandomizerMenu` (`InitializeRandomizerLocksList`), decompiled from the installed
 *   `final.redscripts`. The Studio uses that list as its section order and titles.
 * - **Icons** [source]: a choice's `icon` is a `UIIcon` record; the creator tints the swatch background with the choice's
 *   `color` and draws the icon's `atlasPartName` from its `atlasResourcePath` inkatlas (`characterCreationBodyMorphListItem`
 *   `SetTintColor`). Icons that TweakXL mods add in YAML are not in the compiled blob; they stay unresolved (R11).
 */
import { childId, type TweakDbBlob, type TweakId, tweakDbId } from "./tweakdb-flats";

export const CATEGORY_LIST_RECORD = "CharacterRandomization.CharacterRandomizationCategories";

export interface CreatorCategory {
  /** The enum name the options' `randomizeCategory` uses. */
  readonly id: string;
  /** Localisation key of the title. */
  readonly labelKey: string;
  readonly order: number;
}
export interface IconRef {
  /** The TweakDB record the choice names (`OptionsIcons.BrownLiquorice`), or `#<id>` when stored by ID only. */
  readonly record: string;
  /** The inkatlas's depot hash, and its path when known. */
  readonly atlas: { readonly hash: string; readonly path: string | null } | null;
  readonly part: string | null;
}
export interface CreatorPresentation {
  readonly categories: readonly CreatorCategory[];
  readonly icons: ReadonlyMap<string, IconRef>;
  /** Plain gaps (a missing category list, icons the blob lacks). */
  readonly gaps: readonly { code: string; subject: string; detail: string }[];
  readonly source: string;
}

/** A choice's icon identity as the resource stores it: a record name, or a numeric TweakDBID. */
export const iconKey = (value: { storage: "string" | "uint64"; value: string }): string | null =>
  value.storage === "string" ? value.value || null : value.value && value.value !== "0" ? `#${value.value}` : null;
const idOf = (key: string): TweakId | null => {
  if (key.startsWith("#")) {
    if (!/^#\d{1,20}$/.test(key)) return null;
    const bits = BigInt(key.slice(1)) & ((1n << 40n) - 1n);
    return bits ? Number(bits) : null;
  }
  return key ? tweakDbId(key) : null;
};

/** Read the creator's categories and the named icons from a TweakDB blob. `source` labels the blob for evidence. */
export function readCreatorPresentation(blob: TweakDbBlob, iconKeys: Iterable<string>, source: string): CreatorPresentation {
  const gaps: { code: string; subject: string; detail: string }[] = [];
  const list = blob.lookup([childId(tweakDbId(CATEGORY_LIST_RECORD), ".list")]).values().next().value;
  const categories: CreatorCategory[] = [];
  if (list?.type === "array:TweakDBID") {
    const fields = blob.lookup(list.value.flatMap(ui => [childId(ui, ".categoryName"), childId(ui, ".categoryType")]));
    const types = list.value.map(ui => fields.get(childId(ui, ".categoryType")));
    const enums = blob.lookup(types.flatMap(type => type?.type === "TweakDBID" ? [childId(type.value, ".enumName")] : []));
    list.value.forEach((ui, order) => {
      const name = fields.get(childId(ui, ".categoryName")), type = types[order];
      const enumName = type?.type === "TweakDBID" ? enums.get(childId(type.value, ".enumName")) : undefined;
      if (enumName?.type !== "CName" || !enumName.value) {
        gaps.push({ code: "category-unreadable", subject: `${CATEGORY_LIST_RECORD}[${order}]`, detail: "A creator category record has no readable type." });
        return;
      }
      categories.push({ id: enumName.value, labelKey: name?.type === "CName" ? name.value : "", order: categories.length });
    });
  } else gaps.push({ code: "category-list-missing", subject: CATEGORY_LIST_RECORD, detail: "The TweakDB blob has no creator category list; sections follow the resource's own order." });

  const icons = new Map<string, IconRef>();
  const wanted = [...new Set(iconKeys)].flatMap(key => { const id = idOf(key); return id === null ? [] : [[key, id] as const]; });
  const values = blob.lookup(wanted.flatMap(([, id]) => [childId(id, ".atlasResourcePath"), childId(id, ".atlasPartName")]));
  let missing = 0;
  for (const [key, id] of wanted) {
    const atlas = values.get(childId(id, ".atlasResourcePath")), part = values.get(childId(id, ".atlasPartName"));
    if (!atlas && !part) { missing++; continue; }
    icons.set(key, { record: key, atlas: atlas?.type === "raRef:CResource" && atlas.value !== "0" ? { hash: atlas.value, path: null } : null,
      part: part?.type === "CName" && part.value ? part.value : null });
  }
  if (missing) gaps.push({ code: "icons-not-in-tweakdb", subject: `${missing} icon record(s)`,
    detail: "Some choices name icon records the compiled TweakDB lacks (typically added by TweakXL mods, which the Studio doesn't read yet); their swatches show the colour only." });
  return { categories, icons, gaps, source };
}
