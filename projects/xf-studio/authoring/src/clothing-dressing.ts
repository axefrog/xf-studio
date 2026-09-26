/**
 * The viewer's **Clothing** setting: which of V's clothes the preview dresses her in. Pure and shared by the page and the host. It is a
 * presentation choice over the resolved character: it never edits the save, a recipe or an export (the clothing render plan, "The
 * undress/dress control").
 *
 * States (provisional decisions 2 and 3 of the plan):
 * - `saved`: what the save shows (its equipped items, a wardrobe set's items, its hidden areas).
 * - `no-headwear`: the same without the head and face areas (helmets, hats, glasses and masks cover the eyes); the default while the
 *   eye-makeup editor is open, kept per workspace.
 * - `underwear`: only underwear, the lowest state offered (the Studio never shows more than the game's own uncensored mode): the save's
 *   underwear items, each missing piece filled with the game's basic underwear (`Items.Underwear_Basic_01_Bottom`, and `_Top` for a female
 *   V, as the game equips it on the creator puppet when nudity isn't allowed: `preGameMenuGameController.script` `UpdateCensorshipItems`).
 * - `custom`: the saved items of the areas the viewer picks.
 *
 * The request carries the save's areas as they are (the host needs every saved area to tell a wardrobe set's hidden area from one another
 * item's tag hides) and the areas the state shows; the host applies the game's hiding rules (clothing-resolver.ts).
 */
import { CLOTHING_AREAS, type ClothingArea, isClothingArea, type SavedLoadout, wornAreas, type WornArea } from "./save-loadout";
import { tweakDbId } from "./tweakdb-flats";

/** The creator's hair tag the `HairType` item suffix reads (`GetHairSuffix`: `Short`, `Long`, `Dreads`, `Buzz`, else `Bald`). */
export type HairType = "Short" | "Long" | "Dreads" | "Buzz" | "Bald";
export const HAIR_TYPES: readonly HairType[] = ["Short", "Long", "Dreads", "Buzz", "Bald"];
/** The hair type a V's creator tags give (the save's `tags`), as `GetHairSuffix` reads them [source: equipmentSystem.script]. */
export const hairTypeOf = (tags: readonly string[]): HairType => (["Short", "Long", "Dreads", "Buzz"] as const).find(tag => tags.includes(tag)) ?? "Bald";

export const CLOTHING_STATES = ["saved", "no-headwear", "underwear", "custom"] as const;
export type ClothingState = typeof CLOTHING_STATES[number];
export const isClothingState = (value: unknown): value is ClothingState => (CLOTHING_STATES as readonly unknown[]).includes(value);
/** The areas the `no-headwear` state leaves out. */
export const HEADWEAR_AREAS: readonly ClothingArea[] = ["Head", "Face"];
export const UNDERWEAR_AREAS: readonly ClothingArea[] = ["UnderwearTop", "UnderwearBottom"];
/** The default while the eye-makeup editor is open. */
export const DEFAULT_CLOTHING_STATE: ClothingState = "no-headwear";

/** The setting as the workspace keeps it: the state, and the areas `custom` shows. */
export type ClothingSetting = { readonly state: ClothingState; readonly custom: readonly ClothingArea[] };
export const DEFAULT_CLOTHING: ClothingSetting = Object.freeze({ state: DEFAULT_CLOTHING_STATE, custom: Object.freeze([...CLOTHING_AREAS]) });
/** A stored setting, validated (anything unreadable is the default). */
export function clothingSettingOf(value: unknown): ClothingSetting {
  const v = value as Partial<ClothingSetting> | null;
  if (!v || typeof v !== "object" || !isClothingState(v.state)) return DEFAULT_CLOTHING;
  const custom = Array.isArray(v.custom) ? [...new Set(v.custom.filter(isClothingArea))] : [...CLOTHING_AREAS];
  return { state: v.state, custom: CLOTHING_AREAS.filter(area => custom.includes(area)) };
}

/** The game's basic underwear records, as the save's decimal TweakDB record IDs. */
export const BASIC_UNDERWEAR: Readonly<Record<"UnderwearTop" | "UnderwearBottom", string>> = Object.freeze({
  UnderwearTop: String(tweakDbId("Items.Underwear_Basic_01_Top")), UnderwearBottom: String(tweakDbId("Items.Underwear_Basic_01_Bottom")) });

/** What a request carries to dress V (character-detail-request.ts). */
export type CharacterClothing = { hairType: HairType; worn: WornArea[]; shown: ClothingArea[] };

/**
 * What the setting dresses V in, from the save's loadout (null or absent: no loadout, the default V or a save read before clothes were),
 * or null when nothing is worn (the request then carries no clothing, and the V is prepared as without clothes).
 */
export function dressingFor(setting: ClothingSetting, loadout: SavedLoadout | null | undefined, bodyGender: "female" | "male",
  creatorTags: readonly string[]): CharacterClothing | null {
  const saved = loadout ? wornAreas(loadout) : [];
  let worn: WornArea[] = saved, shown: ClothingArea[];
  switch (setting.state) {
    case "saved": shown = [...CLOTHING_AREAS]; break;
    case "no-headwear": shown = CLOTHING_AREAS.filter(area => !HEADWEAR_AREAS.includes(area)); break;
    case "custom": shown = [...setting.custom]; break;
    case "underwear": {
      shown = [...UNDERWEAR_AREAS];
      const pieces: ClothingArea[] = bodyGender === "female" ? ["UnderwearTop", "UnderwearBottom"] : ["UnderwearBottom"];
      worn = pieces.map(area => ({ area, item: saved.find(entry => entry.area === area)?.item ?? BASIC_UNDERWEAR[area as keyof typeof BASIC_UNDERWEAR], hidden: false }));
      break;
    }
  }
  if (!worn.some(entry => shown.includes(entry.area))) return null;
  return { hairType: hairTypeOf(creatorTags), worn: worn.map(entry => ({ ...entry })), shown };
}

/** Plain words for a state (the control's labels). */
export const CLOTHING_STATE_LABELS: Readonly<Record<ClothingState, string>> = Object.freeze({
  saved: "As saved", "no-headwear": "Without headwear and face items", underwear: "Underwear only", custom: "Choose areas" });
/** Plain words for an area (the custom picks). */
export const CLOTHING_AREA_LABELS: Readonly<Record<ClothingArea, string>> = Object.freeze({ Outfit: "Outfit", OuterChest: "Outer torso",
  InnerChest: "Inner torso", Legs: "Legs", Feet: "Feet", Head: "Head", Face: "Face", UnderwearTop: "Underwear top", UnderwearBottom: "Underwear bottom" });
