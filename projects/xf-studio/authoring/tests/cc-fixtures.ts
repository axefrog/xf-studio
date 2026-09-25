// Asset-free creator fixtures: a small vanilla-shaped female creator resource and one CCXL-style mod that merges into a
// named option, overlays an option anonymously by slot, adds a switcher choice with a new option, and ships texts.
import { buildCatalogue, readCcoWithPresentation } from "../src/cc-catalogue";
import type { CreatorPresentation } from "../src/cc-presentation";
import { customLabel, loadMergedCco } from "../src/character-resolver";
import type { CharacterSource } from "../src/character-context";
import { TextTable } from "../src/game-text";
import { cn, cr2w, fixtureInstallation, handle, rp } from "./resolver-fixtures";

type Def = { name: string; loc?: string; color?: [number, number, number, number]; icon?: string };
type Common = { uiSlot?: string; link?: string; controller?: boolean; enabled?: boolean; hidden?: boolean; index?: number; loc?: string;
  category?: string; editTags?: string[]; defaultIndex?: number; thumbs?: boolean };
const base = (type: string, name: string | null, c: Common) => ({ $type: type, name: cn(name ?? "None"), uiSlot: cn(c.uiSlot ?? "None"),
  link: cn(c.link ?? "None"), linkController: c.controller ? 1 : 0, enabled: c.enabled === false ? 0 : 1, hidden: c.hidden ? 1 : 0,
  index: c.index ?? 0, defaultIndex: c.defaultIndex ?? 0, localizedName: c.loc ?? "", editTags: c.editTags ?? ["NewGame", "Ripperdoc"],
  randomizeCategory: c.category ?? "Body", censorFlag: "0", censorFlagAction: "Activate" });
export const appearance = (name: string | null, resource: string | null, defs: (string | Def)[], c: Common = {}) => handle({
  ...base("gameuiAppearanceInfo", name, c), resource: rp(resource, "Soft"), useThumbnails: c.thumbs ? 1 : 0,
  definitions: defs.map(d => typeof d === "string" ? { name: d } : d).map((d, index) => ({ $type: "gameuiIndexedAppearanceDefinition", name: cn(d.name), index,
    localizedName: d.loc ?? "", color: { $type: "Color", Red: d.color?.[0] ?? 0, Green: d.color?.[1] ?? 0, Blue: d.color?.[2] ?? 0, Alpha: d.color?.[3] ?? 0 },
    icon: d.icon ? { $type: "TweakDBID", $storage: "string", $value: d.icon } : { $type: "TweakDBID", $storage: "uint64", $value: "0" },
    tags: { $type: "redTagList", tags: [] } })) });
export const switcher = (name: string, choices: [string, string[]][], c: Common & { slots?: string[] } = {}) => handle({
  ...base("gameuiSwitcherInfo", name, c), uiSlots: (c.slots ?? []).map(cn),
  options: choices.map(([loc, names], index) => ({ $type: "gameuiSwitcherOption", index, localizedName: loc, names: names.map(cn), tags: { $type: "redTagList", tags: [] } })) });
export const morph = (name: string, targets: string[], c: Common = {}) => handle({
  ...base("gameuiMorphInfo", name, { uiSlot: name, ...c }),
  morphNames: ["None", ...targets].map((target, index) => ({ $type: "gameuiIndexedMorphName", index, localizedName: String(index + 1).padStart(2, "0"), morphName: cn(target) })) });
const groups = (map: Record<string, string[]>) => Object.entries(map).map(([name, options]) => ({ $type: "gameuiOptionsGroup", name: cn(name), options: options.map(cn) }));
export const creator = (head: object[], headGroups: Record<string, string[]>, body: object[] = [], bodyGroups: Record<string, string[]> = {}) =>
  cr2w({ $type: "gameuiCharacterCustomizationInfoResource", version: 12, headCustomizationOptions: head, headGroups: groups(headGroups),
    bodyCustomizationOptions: body, bodyGroups: groups(bodyGroups), armsCustomizationOptions: [], armsGroups: [] });

export const BASE_CCO = "base\\gameplay\\gui\\fullscreen\\main_menu\\female_cco.inkcharcustomization";
export const MOD_CCO = "xl\\pretty\\pretty_pwa.inkcharcustomization";
export const MOD_NAME = "Pretty Eyes and Rings";

export const vanillaCreator = () => creator([
  appearance("skin_color", null, [{ name: "tone_a", loc: "01", icon: "OptionsIcons.ToneA" }, { name: "tone_b", loc: "02" }, { name: "tone_c", loc: "03" }],
    { uiSlot: "skin_color", link: "skin color", controller: true, index: 5, loc: "UI-CharacterCreation-skin_color", category: "Skin", thumbs: true }),
  switcher("skin_type", [["01", ["skin_type_01"]], ["02", ["skin_type_02"]]], { uiSlot: "skin_type_switcher", slots: ["skin_type"], index: 10, loc: "UI-CharacterCreation-skin_type", category: "Skin" }),
  appearance("skin_type_01", "base\\h0_01.app", ["h0__tone_a", "h0__tone_b", "h0__tone_c"], { uiSlot: "skin_type", link: "skin color", index: 11, category: "Skin" }),
  appearance("skin_type_02", "base\\h0_02.app", ["h0__tone_a", "h0__tone_b", "h0__tone_c"], { uiSlot: "skin_type", link: "skin color", enabled: false, index: 11, category: "Skin" }),
  appearance("neck", "base\\neck.app", ["n_a", "n_b", "n_c"], { link: "skin color", hidden: true, index: 700 }),
  morph("eyes", ["h011", "h021"], { index: 170, loc: "UI-CharacterCreation-eyes", category: "Eyes" }),
  appearance("eyes_color", "base\\eyes.app", [{ name: "he__01_brown", color: [80, 50, 20, 255] }, { name: "he__02_blue", icon: "OptionsIcons.Blue" }],
    { uiSlot: "eyes_color", index: 180, loc: "LocKey#23130", category: "Eyes", thumbs: true }),
  switcher("piercings", [["Common-Off", ["piercings_00"]], ["01", ["piercings_01"]]],
    { uiSlot: "piercings", slots: ["piercings_color"], index: 290, loc: "UI-CharacterCreation-piercings", category: "FaceModification" }),
  appearance("piercings_00", null, ["None"], { uiSlot: "piercings_color", index: 291, category: "FaceModification" }),
  appearance("piercings_01", "base\\earring_01.app", ["silver", "gold"], { uiSlot: "piercings_color", enabled: false, index: 291, category: "FaceModification" }),
  appearance("teeth", "base\\teeth.app", ["t_default", "t_gold"], { uiSlot: "teeth", index: 310, loc: "UI-CharacterCreation-teeth", category: "FaceModification" }),
  appearance("scars", "base\\scars.app", [{ name: "None", loc: "Common-Off" }, { name: "scar_01", loc: "01" }], { uiSlot: "scars", index: 269, category: "Scars" }),
], { TPP: ["skin_type_01", "skin_type_02", "neck", "eyes", "eyes_color", "teeth", "scars"], face: ["piercings_00", "piercings_01"],
  character_customization: ["eyes", "eyes_color"] },
[
  morph("breast", ["small", "big"], { index: 1010, category: "Body", loc: "UI-CharacterCreation-breast", defaultIndex: 0 }),
  appearance("body_color", "base\\body.app", ["b_a", "b_b", "b_c"], { link: "skin color", hidden: true, index: 1000 }),
], { TPP_Body: ["breast", "body_color"] });

export const modCreator = () => creator([
  // A named option merges into vanilla `eyes_color` (definitions by name) from the mod's own `.app`.
  appearance("eyes_color", "xl\\pretty\\eyes.app", [{ name: "he__03_violet", color: [120, 40, 160, 255], icon: "OptionsIcons.ModViolet" }], { uiSlot: "eyes_color" }),
  // An anonymous overlay targets the same slot.
  appearance(null, "xl\\pretty\\eyes.app", ["he__04_green"], { uiSlot: "eyes_color" }),
  // A new switcher choice and the option it activates.
  switcher("piercings", [["XL-Pretty-Ring", ["xl_ring"]]]),
  appearance("xl_ring", "xl\\pretty\\ring.app", ["ring_silver", "ring_gold"], { uiSlot: "piercings_color", enabled: false, index: 291, loc: "XL-Pretty-Ring", category: "FaceModification" }),
], { face: ["xl_ring"] });

export const TEXTS = [
  { primaryKey: "23128", secondaryKey: "UI-CharacterCreation-skin_color", female: "Skin Tone", male: "" },
  { primaryKey: "23130", secondaryKey: "UI-CharacterCreation-eyes_color", female: "Eye Color", male: "" },
  { primaryKey: "23129", secondaryKey: "UI-CharacterCreation-eyes", female: "Eyes", male: "" },
  { primaryKey: "925", secondaryKey: "Common-Off", female: "OFF", male: "" },
  { primaryKey: "96178", secondaryKey: "UI-CharacterCreation-skin", female: "Skin", male: "" },
  { primaryKey: "96179", secondaryKey: "UI-CharacterCreation-eyesCategory", female: "Eyes", male: "" },
];
export const PRESENTATION: CreatorPresentation = {
  categories: [{ id: "Skin", labelKey: "UI-CharacterCreation-skin", order: 0 }, { id: "Eyes", labelKey: "UI-CharacterCreation-eyesCategory", order: 1 },
    { id: "Scars", labelKey: "UI-CharacterCreation-scars_all", order: 2 }, { id: "FaceModification", labelKey: "UI-CharacterCreation-faceModification", order: 3 },
    { id: "Body", labelKey: "UI-CharacterCreation-body", order: 4 }],
  icons: new Map([["OptionsIcons.ToneA", { record: "OptionsIcons.ToneA", atlas: { hash: "42", path: null }, part: "tone_a" }]]),
  gaps: [], source: "test",
};

/** The fixture installation, with or without the mod, merged and catalogued as the host does. */
export async function fixtureSource(withMod = true): Promise<CharacterSource> {
  const { graph } = fixtureInstallation([
    { virtualPath: "archive/pc/content/basegame_4_gamedata.archive", files: { [BASE_CCO]: vanillaCreator() } },
    ...(withMod ? [{ virtualPath: "archive/pc/mod/pretty.archive", provider: "mo2-mod" as const, providerName: MOD_NAME, priority: 1, files: { [MOD_CCO]: modCreator() } }] : []),
  ], withMod ? [{ id: "archive/pc/mod/pretty.archive.xl", document: { customizations: { female: MOD_CCO } } }] : []);
  const merged = await loadMergedCco(graph, "female", readCcoWithPresentation);
  const text = new TextTable("en-us").add(TEXTS, { id: "base", kind: "game", declaredBy: null });
  if (withMod) text.add([{ primaryKey: "0", secondaryKey: "XL-Pretty-Ring", female: "Pretty ring", male: "" }], { id: "xl\\pretty\\en.json", kind: "mod", declaredBy: "a.xl" });
  const catalogue = buildCatalogue({ bodyGender: "female", cco: merged.merged.cco, text, presentation: PRESENTATION,
    customs: merged.customs.map(custom => ({ path: custom.path, label: customLabel(custom.path, custom.provenance), mod: custom.provenance.provider })) });
  return { catalogue, cco: merged.merged.cco };
}
