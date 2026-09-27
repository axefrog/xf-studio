/**
 * What V wears, as a save records it: the vanilla equipment system's loadout, read with vanilla semantics only (knowledge/clothing.md §2).
 * Pure and browser-safe. The reader never interprets a script mod's data: EquipmentEx's saved outfit sits beside the vanilla data in the
 * same package and is left alone (the clothing render plan's provisional decision 1); what a script mod shows at runtime is the running
 * game's answer, not the save's.
 *
 * Sources [source: game 2.31 scripts, `cyberpunk/systems/equipmentSystem.script`; RTTI dump `EquipmentSystemPlayerData`; WolvenKit
 * `WardrobeSystemClothingSetsParser.cs` at 11720772]:
 * - `ScriptableSystemsContainer` is one object package (engines/red-object/package.ts). Which of its named types are enums comes from the
 *   save's own type database (`TypeDatabase_v2`, through the type oracle); a caller without one gets a short list of the equipment enums.
 *   The equipment system keeps one `EquipmentSystemPlayerData` per owner; the player's is the one whose `ownerID` is the player's
 *   entity ID (1), else the one with a loadout.
 * - `equipment.equipAreas[]`: `{areaType, equipSlots[{itemID}], activeIndex}`; the item drawn in an area without a wardrobe set is the
 *   active slot's (`GetActiveItem`).
 * - `clothingVisualsInfo[]`: `{areaType, isHidden, visualItem}` per clothing area (`Outfit` has none: `GetVisualSlotIndex`).
 * - `WardrobeSystem_ClothingSets`: a u8 set count, then a u32 that is 8 in a save without sets, the value of
 *   `gameWardrobeClothingSetIndex.INVALID` [hypothesis: it is the active set's index, `Slot1`…`Slot7` = 0…6]. While a set is active, an
 *   area's visual item overrides its equipped item (`GetVisualItemInSlot`), except in the underwear areas.
 * Fields at their default are not written (an absent `isHidden` is false, an absent `activeIndex` 0).
 */
import { field, type PackageTypes, type PackageValue } from "./engines/red-object/package";
import { readSavePackage } from "./save-package";
import { isClothingArea, WARDROBE_SETS, type SavedItem, type SavedLoadout } from "./saved-v";

export { CLOTHING_AREAS, isClothingArea, parseSavedLoadout, wornAreas, type ClothingArea, type SavedItem, type SavedLoadout, type WornArea } from "./saved-v";

/** The equipment enums, for a caller with no type database to ask (a save's own database lists them all). */
const FALLBACK_ENUMS: ReadonlySet<string> = new Set(["gamedataEquipmentArea", "gameWardrobeClothingSetIndex", "gameEHotkey", "gamedataItemType",
  "gamedataEquipmentManipulationAction"]);
const PLAYER_ENTITY = "1";
/** A TweakDBID the save stores as "no item". */
const NO_ITEM = "0";

const isList = (value: PackageValue | undefined): value is PackageValue[] => Array.isArray(value);
const text = (value: PackageValue | undefined) => typeof value === "string" ? value : null;
const itemOf = (value: PackageValue | undefined): string | null => {
  const id = text(field(value, "id"));
  return id && /^[0-9]{1,20}$/.test(id) && id !== NO_ITEM ? id : null;
};

/**
 * The player's loadout from a `ScriptableSystemsContainer` node's package bytes and the wardrobe-sets node's bytes (both after the node id).
 * `types` says which named types are enums: the save's type oracle, or (without one) the equipment enums below.
 */
export function readSavedLoadout(systems: Uint8Array, wardrobeSets: Uint8Array | null, types: PackageTypes = FALLBACK_ENUMS): SavedLoadout {
  const view = new DataView(systems.buffer, systems.byteOffset, systems.byteLength);
  if (systems.length < 4) throw Error("The save's script data is truncated.");
  const size = view.getUint32(0, true);
  if (size > systems.length - 4) throw Error("The save's script data is truncated.");
  const pkg = readSavePackage(systems.subarray(4, 4 + size));
  const owners = pkg.chunks.filter(chunk => chunk.type === "EquipmentSystemPlayerData").map(chunk => pkg.decode(chunk.index, types));
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
