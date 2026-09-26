/**
 * What V wears, as a save records it: the vanilla equipment system's loadout, read with vanilla semantics only (knowledge/clothing.md §2).
 * Pure and browser-safe. The reader never interprets a script mod's data: EquipmentEx's saved outfit sits beside the vanilla data in the
 * same package and is left alone (the clothing render plan's provisional decision 1); what a script mod shows at runtime is the running
 * game's answer, not the save's.
 *
 * Sources [source: game 2.31 scripts, `cyberpunk/systems/equipmentSystem.script`; RTTI dump `EquipmentSystemPlayerData`; WolvenKit
 * `WardrobeSystemClothingSetsParser.cs` at 11720772]:
 * - `ScriptableSystemsContainer` is one object package (save-package.ts). The equipment system keeps one `EquipmentSystemPlayerData` per
 *   owner; the player's is the one whose `ownerID` is the player's entity ID (1), else the one with a loadout.
 * - `equipment.equipAreas[]`: `{areaType, equipSlots[{itemID}], activeIndex}`; the item drawn in an area without a wardrobe set is the
 *   active slot's (`GetActiveItem`).
 * - `clothingVisualsInfo[]`: `{areaType, isHidden, visualItem}` per clothing area (`Outfit` has none: `GetVisualSlotIndex`).
 * - `WardrobeSystem_ClothingSets`: a u8 set count, then a u32 that is 8 in a save without sets, the value of
 *   `gameWardrobeClothingSetIndex.INVALID` [hypothesis: it is the active set's index, `Slot1`…`Slot7` = 0…6]. While a set is active, an
 *   area's visual item overrides its equipped item (`GetVisualItemInSlot`), except in the underwear areas.
 * Fields at their default are not written (an absent `isHidden` is false, an absent `activeIndex` 0).
 */
import { field, readSavePackage, type PackageValue } from "./save-package";

/** The clothing areas of the equipment system, in the order the vanilla visuals table lists them (`InitializeClothingOverrideInfo`). */
export const CLOTHING_AREAS = ["Outfit", "OuterChest", "InnerChest", "Legs", "Feet", "Head", "Face", "UnderwearTop", "UnderwearBottom"] as const;
export type ClothingArea = typeof CLOTHING_AREAS[number];
export const isClothingArea = (value: unknown): value is ClothingArea => (CLOTHING_AREAS as readonly unknown[]).includes(value);

/** A worn item by its TweakDB record ID: the save's u64 (CRC-32 of the record name, its length in the next byte), in decimal. */
export type SavedItem = { readonly area: ClothingArea; readonly item: string };
export type SavedLoadout = {
  readonly schema: "xfs/saved-loadout-1";
  /** The active item of each clothing area that has one. */
  readonly equipped: readonly SavedItem[];
  /** Each clothing area's visual override and hide flag, as the save stores them. */
  readonly visuals: readonly { readonly area: ClothingArea; readonly hidden: boolean; readonly item: string | null }[];
  /** The active wardrobe set (0–6), or null when none is active or the save doesn't say. */
  readonly wardrobeSet: number | null;
  /** Evidence: the player's owner ID, how many owners the save lists, and fields the reader could not read (type names only). */
  readonly evidence: { readonly owner: string | null; readonly owners: number; readonly skipped: readonly string[] };
};

const ENUMS: ReadonlySet<string> = new Set(["gamedataEquipmentArea", "gameWardrobeClothingSetIndex", "gameEHotkey", "gamedataItemType",
  "gamedataEquipmentManipulationAction"]);
const PLAYER_ENTITY = "1";
const WARDROBE_SETS = 7;
/** A TweakDBID the save stores as "no item". */
const NO_ITEM = "0";

const isList = (value: PackageValue | undefined): value is PackageValue[] => Array.isArray(value);
const text = (value: PackageValue | undefined) => typeof value === "string" ? value : null;
const itemOf = (value: PackageValue | undefined): string | null => {
  const id = text(field(value, "id"));
  return id && /^[0-9]{1,20}$/.test(id) && id !== NO_ITEM ? id : null;
};

/** The player's loadout from a `ScriptableSystemsContainer` node's package bytes and the wardrobe-sets node's bytes (both after the node id). */
export function readSavedLoadout(systems: Uint8Array, wardrobeSets: Uint8Array | null): SavedLoadout {
  const view = new DataView(systems.buffer, systems.byteOffset, systems.byteLength);
  if (systems.length < 4) throw Error("The save's script data is truncated.");
  const size = view.getUint32(0, true);
  if (size > systems.length - 4) throw Error("The save's script data is truncated.");
  const pkg = readSavePackage(systems.subarray(4, 4 + size));
  const owners = pkg.chunks.filter(chunk => chunk.type === "EquipmentSystemPlayerData").map(chunk => pkg.decode(chunk.index, ENUMS));
  if (!owners.length) throw Error("The save has no equipment data.");
  const ownerId = (entry: typeof owners[number]) => text(field(field(entry.object, "ownerID"), "hash"));
  const hasLoadout = (entry: typeof owners[number]) => isList(field(field(entry.object, "equipment"), "equipAreas"));
  const player = owners.find(entry => ownerId(entry) === PLAYER_ENTITY) ?? owners.find(hasLoadout) ?? owners[0]!;
  const equipped: SavedItem[] = [];
  const areas = field(field(player.object, "equipment"), "equipAreas");
  for (const area of isList(areas) ? areas : []) {
    const type = text(field(area, "areaType"));
    if (!isClothingArea(type)) continue;
    const slots = field(area, "equipSlots"), active = field(area, "activeIndex");
    const index = typeof active === "number" && Number.isInteger(active) ? active : 0;
    const slot = isList(slots) ? slots[index] : undefined;
    const item = itemOf(field(slot, "itemID"));
    if (item && !equipped.some(entry => entry.area === type)) equipped.push({ area: type, item });
  }
  const visuals: SavedLoadout["visuals"][number][] = [];
  const stored = field(player.object, "clothingVisualsInfo");
  for (const entry of isList(stored) ? stored : []) {
    const type = text(field(entry, "areaType"));
    if (!isClothingArea(type) || visuals.some(visual => visual.area === type)) continue;
    visuals.push({ area: type, hidden: field(entry, "isHidden") === true, item: itemOf(field(entry, "visualItem")) });
  }
  let wardrobeSet: number | null = null;
  if (wardrobeSets && wardrobeSets.length >= 5) {
    const index = new DataView(wardrobeSets.buffer, wardrobeSets.byteOffset, wardrobeSets.byteLength).getUint32(1, true);
    wardrobeSet = index < WARDROBE_SETS ? index : null;
  }
  return { schema: "xfs/saved-loadout-1", equipped, visuals, wardrobeSet,
    evidence: { owner: ownerId(player), owners: owners.length, skipped: [...new Set(player.skipped.map(entry => entry.replace(/\[[0-9]+\]/g, "[]")))].slice(0, 32) } };
}

/** One clothing area as the save leaves it: the item the game draws there before other items' tags hide it, and the saved hide flag. */
export type WornArea = { readonly area: ClothingArea; readonly item: string; readonly hidden: boolean };
const UNDERWEAR: readonly ClothingArea[] = ["UnderwearTop", "UnderwearBottom"];

/**
 * What each clothing area shows by the save's own data (`GetVisualItemInSlot`): with a wardrobe set active, an area's visual item where it
 * has one (the underwear areas never take a set's item), else the equipped item. `hidden` is the saved `isHidden`.
 */
export function wornAreas(loadout: SavedLoadout): WornArea[] {
  const out: WornArea[] = [];
  for (const area of CLOTHING_AREAS) {
    const visual = loadout.visuals.find(entry => entry.area === area);
    const equipped = loadout.equipped.find(entry => entry.area === area)?.item ?? null;
    const item = loadout.wardrobeSet !== null && !UNDERWEAR.includes(area) && area !== "Outfit" && visual?.item ? visual.item : equipped;
    if (item) out.push({ area, item, hidden: visual?.hidden ?? false });
  }
  return out;
}

/** Validate a stored loadout (the workspace keeps it with the saved V). */
export function parseSavedLoadout(value: unknown): SavedLoadout {
  const v = value as SavedLoadout;
  const item = (x: unknown) => typeof x === "string" && /^[1-9][0-9]{0,19}$/.test(x);
  if (!v || v.schema !== "xfs/saved-loadout-1" || !Array.isArray(v.equipped) || !Array.isArray(v.visuals) || v.equipped.length > CLOTHING_AREAS.length ||
    v.visuals.length > CLOTHING_AREAS.length || !v.equipped.every(entry => entry && isClothingArea(entry.area) && item(entry.item)) ||
    !v.visuals.every(entry => entry && isClothingArea(entry.area) && typeof entry.hidden === "boolean" && (entry.item === null || item(entry.item))) ||
    !(v.wardrobeSet === null || (Number.isInteger(v.wardrobeSet) && v.wardrobeSet >= 0 && v.wardrobeSet < WARDROBE_SETS)) || !v.evidence ||
    !(v.evidence.owner === null || (typeof v.evidence.owner === "string" && v.evidence.owner.length <= 24)) || !Number.isInteger(v.evidence.owners) ||
    !Array.isArray(v.evidence.skipped) || v.evidence.skipped.length > 32 || !v.evidence.skipped.every(entry => typeof entry === "string" && entry.length <= 512))
    throw Error("Invalid stored loadout");
  return { schema: v.schema, equipped: v.equipped.map(entry => ({ area: entry.area, item: entry.item })),
    visuals: v.visuals.map(entry => ({ area: entry.area, hidden: entry.hidden, item: entry.item })), wardrobeSet: v.wardrobeSet,
    evidence: { owner: v.evidence.owner, owners: v.evidence.owners, skipped: [...v.evidence.skipped] } };
}
