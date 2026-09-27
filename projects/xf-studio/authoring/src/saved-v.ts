/**
 * The saved V as XF Studio keeps it: the creator's resolved choices (`SavedV`, save-reader.ts reads them from a save) and what V wears
 * (`SavedLoadout`, save-loadout.ts), with their validators for stored copies and the pure "what each clothing area shows" rule. Types
 * and pure helpers only: the scene host and the workspace read these records without reaching the save readers.
 */

export type Appearance = {
  resourceHash: string;
  definition: string;
  name: string;
  censorFlag: number;
  censorAction: number;
};
export type Morph = {
  region: string;
  target: string;
  censorFlag: number;
  censorAction: number;
};
export type CustomizationGroup = {
  name: string;
  appearances: Appearance[];
  morphs: Morph[];
};
export type SavedV = {
  schema: "eye-artistry/saved-v-1";
  saveVersion: number;
  gameVersion: number;
  presetVersion: number;
  isMale: boolean;
  brainIsMale: boolean;
  groups: {
    head: CustomizationGroup[];
    arms: CustomizationGroup[];
    body: CustomizationGroup[];
  };
  perspectives: { name: string; fpp: string; tpp: string }[];
  tags: string[];
  /**
   * What V wears, as the save's vanilla equipment data records it; null when this save's script data couldn't be read, absent for a V
   * stored by an earlier XF Studio (which didn't read clothes).
   */
  loadout?: SavedLoadout | null;
  evidence: {
    nodeName: string;
    nodeBytes: number;
    bytesRead: number;
    trailingBytes: number;
    chunks: number;
    decompressedBytes: number;
  };
};

/** Validate decoded browser storage without retaining raw save bytes. */
export function parseSavedV(value: unknown): SavedV {
  const v = value as SavedV;
  const text = (x: unknown): x is string => typeof x === "string" && x.length <= 65536;
  const uint = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 0xffffffff;
  const array = <T>(x: unknown, valid: (item: T) => boolean): x is T[] =>
    Array.isArray(x) && x.length <= 4096 && x.every(item => item && valid(item));
  const group = (g: CustomizationGroup) => text(g.name) &&
    array<Appearance>(g.appearances, a => text(a.resourceHash) && /^\d{1,20}$/.test(a.resourceHash) &&
      text(a.definition) && text(a.name) && uint(a.censorFlag) && uint(a.censorAction)) &&
    array<Morph>(g.morphs, m => text(m.region) && text(m.target) && uint(m.censorFlag) && uint(m.censorAction));
  if (!v || v.schema !== "eye-artistry/saved-v-1" || !uint(v.saveVersion) || !uint(v.gameVersion) ||
    !uint(v.presetVersion) || typeof v.isMale !== "boolean" || typeof v.brainIsMale !== "boolean" ||
    !v.groups || ![v.groups.head, v.groups.arms, v.groups.body].every(x => array(x, group)) ||
    !array<SavedV["perspectives"][number]>(v.perspectives, p => text(p.name) && text(p.fpp) && text(p.tpp)) ||
    !Array.isArray(v.tags) || v.tags.length > 4096 || !v.tags.every(text) || !v.evidence ||
    !text(v.evidence.nodeName) || ![v.evidence.nodeBytes, v.evidence.bytesRead, v.evidence.trailingBytes,
      v.evidence.chunks, v.evidence.decompressedBytes].every(uint))
    throw Error("Invalid stored V appearance");
  const loadout = v.loadout === undefined ? undefined : v.loadout === null ? null : parseSavedLoadout(v.loadout);
  const copy = structuredClone(v);
  if (loadout === undefined) delete copy.loadout; else copy.loadout = loadout;
  return copy;
}

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
/** The wardrobe's set slots (`gameWardrobeClothingSetIndex.Slot1`…`Slot7`). */
export const WARDROBE_SETS = 7;

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
