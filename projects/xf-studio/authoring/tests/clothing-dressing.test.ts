// The Clothing setting (clothing-dressing.ts), its actions and Undo in the character context, the request's clothing (v5) and the record's
// clothing slot (v9, planClothing). Asset-free: loadouts and resolved clothing are built here.
import { describe, expect, test } from "bun:test";
import { CharacterContextActions, type CreatorPort, storedCharacterOf } from "../src/character-context-actions";
import { planClothing } from "../src/character-detail-plan";
import { CHARACTER_REQUEST_SCHEMA, parseCharacterRequest, sameCharacter } from "../src/character-detail-request";
import { NO_OVERRIDES, type ResolvedComponent } from "../src/character-resolver";
import { BASIC_UNDERWEAR, clothingSettingOf, DEFAULT_CLOTHING, dressingFor, hairTypeOf } from "../src/clothing-dressing";
import type { ResolvedClothing, ResolvedGarment } from "../src/clothing-resolver";
import { DETAIL_SLOTS, parseCharacterDetail } from "../src/render-detail";
import type { SavedLoadout } from "../src/save-loadout";
import type { SavedV } from "../src/save-reader";
import { tweakDbId } from "../src/tweakdb-flats";

const loadout: SavedLoadout = { schema: "xfs/saved-loadout-1", wardrobeSet: null, evidence: { owner: "1", owners: 1, skipped: [] },
  equipped: [{ area: "Head", item: "100" }, { area: "InnerChest", item: "101" }, { area: "Legs", item: "102" }, { area: "UnderwearBottom", item: "103" }],
  visuals: [{ area: "UnderwearBottom", hidden: true, item: null }] };
const save = (withLoadout: SavedLoadout | null | undefined = loadout): SavedV => ({ schema: "eye-artistry/saved-v-1", saveVersion: 269, gameVersion: 2310,
  presetVersion: 12, isMale: false, brainIsMale: false, groups: { head: [], arms: [], body: [] }, perspectives: [], tags: ["Long"],
  ...(withLoadout === undefined ? {} : { loadout: withLoadout }),
  evidence: { nodeName: "CharacetrCustomization_Appearances", nodeBytes: 1, bytesRead: 1, trailingBytes: 0, chunks: 1, decompressedBytes: 1 } });

describe("Clothing setting", () => {
  test("each state dresses V from the save's areas; underwear fills missing pieces with the game's basic underwear", () => {
    expect(BASIC_UNDERWEAR.UnderwearBottom).toBe(String(tweakDbId("Items.Underwear_Basic_01_Bottom")));
    expect(hairTypeOf(["Long", "x"])).toBe("Long");
    expect(hairTypeOf([])).toBe("Bald");
    const saved = dressingFor({ state: "saved", custom: [] }, loadout, "female", ["Short"])!;
    expect(saved.hairType).toBe("Short");
    expect(saved.worn.map(entry => entry.area)).toEqual(["InnerChest", "Legs", "Head", "UnderwearBottom"]);
    expect(saved.shown).toContain("Head");
    const bare = dressingFor(DEFAULT_CLOTHING, loadout, "female", [])!;
    expect(bare.shown).not.toContain("Head");
    expect(bare.shown).not.toContain("Face");
    const underwear = dressingFor({ state: "underwear", custom: [] }, loadout, "female", [])!;
    expect(underwear.worn).toEqual([{ area: "UnderwearTop", item: BASIC_UNDERWEAR.UnderwearTop, hidden: false }, { area: "UnderwearBottom", item: "103", hidden: false }]);
    expect(dressingFor({ state: "underwear", custom: [] }, null, "male", [])!.worn.map(entry => entry.area)).toEqual(["UnderwearBottom"]);
    expect(dressingFor({ state: "custom", custom: ["Legs"] }, loadout, "female", [])!.shown).toEqual(["Legs"]);
    // Nothing worn: no clothing in the request (the V is prepared as without clothes).
    expect(dressingFor(DEFAULT_CLOTHING, undefined, "female", [])).toBeNull();
    expect(dressingFor({ state: "custom", custom: ["Face"] }, loadout, "female", [])).toBeNull();
    expect(clothingSettingOf({ state: "custom", custom: ["Legs", "Nowhere", "Legs"] })).toEqual({ state: "custom", custom: ["Legs"] });
    expect(clothingSettingOf({ state: "naked" })).toBe(DEFAULT_CLOTHING);
  });

  test("the context's clothing actions change the request, share the panel's one Undo and survive storage", () => {
    const context = new CharacterContextActions({ creator: {} as CreatorPort, showSave: () => {} }, { save: save(), stored: { origin: "save", choices: [] } });
    const first = context.detailRequest();
    expect(first.clothing?.shown).not.toContain("Head");
    expect(context.snapshot().clothing).toMatchObject({ state: "no-headwear", source: "save", worn: ["InnerChest", "Legs", "Head", "UnderwearBottom"], undo: null });
    expect(context.stored()).toBeUndefined();
    expect(context.capability({ kind: "character.setClothing", state: "no-headwear" })).toMatchObject({ available: false, code: "invalid_value" });
    context.dispatch({ kind: "character.setClothing", state: "saved" });
    expect(context.detailRequest().clothing?.shown).toContain("Head");
    // A clothing change is the same V: it updates in place.
    expect(sameCharacter(first, context.detailRequest())).toBe(true);
    context.dispatch({ kind: "character.setClothingArea", area: "Legs", shown: false });
    expect(context.snapshot().clothing.state).toBe("custom");
    expect(context.detailRequest().clothing?.shown).not.toContain("Legs");
    // The panel's one Undo (UI-81) covers Clothing too: it names the newest change.
    expect(context.snapshot().undo).toBe("Hide legs");
    const stored = context.stored()!;
    expect(stored.clothing?.state).toBe("custom");
    expect(storedCharacterOf(JSON.parse(JSON.stringify(stored)))?.clothing).toEqual(stored.clothing);
    context.dispatch({ kind: "character.undoClothing" });
    expect(context.snapshot().clothing.state).toBe("saved");
    context.dispatch({ kind: "character.undoClothing" });
    expect(context.snapshot().clothing).toMatchObject({ state: "no-headwear", undo: null, redo: "Clothing: As saved" });
    context.dispatch({ kind: "character.redoClothing" });
    expect(context.snapshot().clothing.state).toBe("saved");
    // The panel's Undo and Redo step creator choices and Clothing in the order they were made.
    context.dispatch({ kind: "character.undo" });
    expect(context.snapshot().clothing.state).toBe("no-headwear");
    expect(context.snapshot()).toMatchObject({ undo: null, redo: "Clothing: As saved" });
    context.dispatch({ kind: "character.redo" });
    expect(context.snapshot().clothing.state).toBe("saved");
    context.dispatch({ kind: "character.redo" });
    expect(context.snapshot().clothing.state).toBe("custom");
    expect(context.capability({ kind: "character.redo" })).toMatchObject({ available: false });
    // A V read before clothes were read, or whose clothes couldn't be read, says so.
    const { loadout: _none, ...before } = save();
    const older = new CharacterContextActions({ creator: {} as CreatorPort, showSave: () => {} }, { save: before as SavedV, stored: { origin: "save", choices: [] } });
    expect(older.snapshot().clothing.source).toBe("older");
    expect(older.detailRequest().clothing).toBeUndefined();
  });

  test("UI-78: an area's Undo label uses its plain name", () => {
    const context = new CharacterContextActions({ creator: {} as CreatorPort, showSave: () => {} }, { save: save(), stored: { origin: "save", choices: [] } });
    context.dispatch({ kind: "character.setClothingArea", area: "InnerChest", shown: false });
    expect(context.snapshot().clothing.undo).toBe("Hide inner torso");
    context.dispatch({ kind: "character.setClothingArea", area: "UnderwearBottom", shown: false });
    expect(context.snapshot().clothing.undo).toBe("Hide underwear bottom");
  });

  test("UI-79: only the Clothing states that change what V wears are offered, and the others are refused with the reason", () => {
    const states = (context: CharacterContextActions) => context.snapshot().clothing.states.map(state => state.value);
    // The save dresses the head: every state differs.
    const dressed = new CharacterContextActions({ creator: {} as CreatorPort, showSave: () => {} }, { save: save(), stored: { origin: "save", choices: [] } });
    expect(states(dressed)).toEqual(["saved", "no-headwear", "underwear", "custom"]);
    // No head or face item: "As saved" is the current state's look, so only the current one of the two is offered.
    const bareHead: SavedLoadout = { ...loadout, equipped: loadout.equipped.filter(entry => entry.area !== "Head") };
    const noHat = new CharacterContextActions({ creator: {} as CreatorPort, showSave: () => {} }, { save: save(bareHead), stored: { origin: "save", choices: [] } });
    expect(states(noHat)).toEqual(["no-headwear", "underwear", "custom"]);
    expect(noHat.capability({ kind: "character.setClothing", state: "saved" })).toMatchObject({ available: false, code: "invalid_value",
      reason: "As saved wouldn't change what your V wears." });
    // The default V wears nothing of her own: only the underwear state changes anything, and there are no areas to choose.
    const plain = new CharacterContextActions({ creator: {} as CreatorPort, showSave: () => {} }, { save: undefined, stored: undefined });
    expect(states(plain)).toEqual(["no-headwear", "underwear"]);
    expect(plain.capability({ kind: "character.setClothing", state: "custom" }).available).toBe(false);
    expect(plain.capability({ kind: "character.setClothing", state: "underwear" }).available).toBe(true);
  });

  test("PREV-108: with the body off the request asks for the head alone, without clothes, and asks again when it comes back", () => {
    const context = new CharacterContextActions({ creator: {} as CreatorPort, showSave: () => {} }, { save: save(), stored: { origin: "save", choices: [] } });
    let published = 0;
    context.subscribe(() => published++);
    const shown = context.detailRequest();
    context.setBodyShown(false);
    const hidden = context.detailRequest();
    expect(hidden).toMatchObject({ body: false });
    expect(hidden.clothing).toBeUndefined();
    expect(sameCharacter(shown, hidden)).toBe(true);
    expect(published).toBe(1);
    context.setBodyShown(false);
    expect(published).toBe(1);
    context.setBodyShown(true);
    expect(context.detailRequest()).toEqual(shown);
    // The host reads it strictly: a body switch is only ever `false`, and never with clothes.
    expect(parseCharacterRequest(JSON.parse(JSON.stringify(hidden)))).toEqual(hidden);
    expect(() => parseCharacterRequest({ ...hidden, body: true })).toThrow("body switch is invalid");
    expect(() => parseCharacterRequest({ ...hidden, clothing: shown.clothing })).toThrow("wears no clothes");
    expect(() => parseCharacterRequest({ ...hidden, schema: "xfs/character-request-5" })).toThrow();
  });

  test("the request carries clothing (v5), strictly; a v4 request is a V without clothes", () => {
    const request = { schema: CHARACTER_REQUEST_SCHEMA, source: "default", bodyGender: "female",
      clothing: { hairType: "Long", worn: [{ area: "Legs", item: "102", hidden: false }], shown: ["Legs"] } };
    expect(parseCharacterRequest(request)).toEqual(request as never);
    expect(() => parseCharacterRequest({ ...request, clothing: { ...request.clothing, worn: [...request.clothing.worn, ...request.clothing.worn] } })).toThrow(/twice/);
    expect(() => parseCharacterRequest({ ...request, clothing: { ...request.clothing, hairType: "Mohawk" } })).toThrow();
    expect(() => parseCharacterRequest({ ...request, clothing: { ...request.clothing, worn: [{ area: "Legs", item: "0x1", hidden: false }] } })).toThrow();
    expect(parseCharacterRequest({ schema: "xfs/character-request-4", source: "default", bodyGender: "male" })).toMatchObject({ schema: CHARACTER_REQUEST_SCHEMA });
    expect(() => parseCharacterRequest({ ...request, schema: "xfs/character-request-4" })).toThrow();
  });

  test("the clothing slot plans drawn garments lowest layer first and says what isn't shown", () => {
    const component = (name: string): ResolvedComponent => ({ name, type: "entGarmentSkinnedMeshComponent", origin: { kind: "part", source: "x.ent" }, meshAppearance: "default",
      chunkMask: "1", overriddenBy: [], morphRegions: {}, appliedMorphs: [], meshAppearanceResolved: null, notes: [],
      geometry: { morphTarget: null, mesh: null, renderChunks: 1, chunkLods: [1], chunkInScene: [true], visibleChunks: [0], drawsNothing: false, patchedFrom: [],
        drawnFrom: { ref: { hash: "1", path: "x.mesh" }, status: "archive", archive: "a.archive", group: "content", provider: "game", provider2: null, alternatives: [],
          rule: { rule: "x", grade: "source", basis: "" }, via: [], extractedSha256: null, ambiguities: [] } as never, morphTexture: null },
      materials: [{ chunk: 0, name: "ml", route: "entry", entry: null, dynamic: null, chain: [], gaps: [], params: [],
        template: { ref: { hash: "2", path: "engine\\materials\\multilayered.mt" } } as never }] });
    const garment = (area: ResolvedGarment["area"], label: string, names: string[], layers: Record<string, number>, status: ResolvedGarment["status"] = "drawn"): ResolvedGarment =>
      ({ area, item: "5", status, hiddenBy: null, gap: status === "unresolved" ? { code: "item-unknown", detail: "" } : null, label, record: null, rootEntity: null,
        rootAppearance: null, app: null, definition: "d", tags: [], components: names.map(component), layers });
    const clothing: ResolvedClothing = { overrides: NO_OVERRIDES, feet: "lifted", feetState: "Lifted", bodyType: "base_body", gaps: [], ambiguities: [],
      garments: [garment("OuterChest", "coat", ["t2_coat"], { t2_coat: 1120 }), garment("InnerChest", "shirt", ["t1_shirt"], { t1_shirt: -930 }),
        garment("Face", "glasses", [], {}, "unresolved")] };
    const plan = planClothing(clothing, new Map(), new Map());
    expect(plan.components.map(item => [item.component, item.garment?.layer])).toEqual([["t1_shirt", -930], ["t2_coat", 1120]]);
    expect(plan.state).toMatchObject({ slot: "clothing", state: "shown", label: "coat, shirt" });
    expect(plan.state.message).toContain("glasses");
    expect(plan.state.message).toContain("items a mod adds");
    expect(planClothing(null, new Map(), new Map()).state).toEqual({ slot: "clothing", state: "none", label: "None" });
    const hidden = planClothing({ ...clothing, garments: [{ ...garment("Head", "cap", [], {}), status: "hidden", hiddenBy: { kind: "saved" } }] }, new Map(), new Map());
    expect(hidden.state.message).toContain("hides every clothing area");
  });

  test("the record keeps a garment's area, item and layer, on the clothing slot only", () => {
    const resource = (file: string) => ({ file, sha256: "a".repeat(64), sources: [{ depotPath: "x" }] });
    const component = (slot: string, garment?: object) => ({ id: `${slot}:x`, slot, option: "Legs", definition: "d", component: "l1_pants",
      geometry: { ...resource("g.glb"), depotPath: "x.mesh", depotHash: "1", morphTargets: false }, renderChunks: 1, chunks: [0],
      materials: [{ chunk: 0, name: "m", template: null, templateName: null, materialPriority: null, scalars: {}, colours: {}, textures: {}, profiles: {}, skinProfiles: {}, gradients: {} }],
      ...(garment ? { garment } : {}) });
    const record = (components: object[]) => ({ schema: "xfs/render-detail-11", detail: "character", identity: "i", origin: "game-files",
      character: { source: "save", bodyGender: "female" }, provenance: { label: "l", notes: [] }, components,
      slots: DETAIL_SLOTS.map(slot => ({ slot, state: "none", label: "None" })) });
    const parsed = parseCharacterDetail(record([component("clothing", { area: "Legs", item: "102", layer: 60 })]));
    expect(parsed.components[0]!.garment).toEqual({ area: "Legs", item: "102", layer: 60 });
    expect(parseCharacterDetail(record([component("body", { area: "Legs", item: "102", layer: 60 })])).components).toEqual([]);
    expect(parseCharacterDetail(record([component("clothing", { area: "Legs", item: "abc", layer: 60 })])).components).toEqual([]);
  });
});
