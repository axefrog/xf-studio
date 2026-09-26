import { describe, expect, test } from "bun:test";
import { descriptorsFromUiState, type CcoResource } from "../src/cco-model";
import { buildCatalogue, CatalogueIndex } from "../src/cc-catalogue";
import { activeOptions, CHARACTER_CONTEXT_FAMILY, type CharacterChoice, type CharacterSource, choicesOfPreset, deriveCharacter, linkedChoice, presetOfChoices,
  recoverSave, savedDescriptorsOf } from "../src/character-context";
import { CharacterContextActions, type CreatorPort, storedCharacterOf } from "../src/character-context-actions";
import { CC_PRESET_LIMITS, CC_PRESET_SCHEMA, parseCcPreset, readCcPreset, readPresetJson, serializeCcPreset, writeCcPreset } from "../src/cc-preset";
import { catalogueCoverage } from "../src/cc-render-coverage";
import { panelProjection } from "../src/cc-panel";
import { Registry } from "../src/platform/core/registry";
import { STUDIO_OWNERS } from "../src/compose/studio-registry";
import type { SavedV } from "../src/save-reader";
import { fixtureSource, MOD_NAME } from "./cc-fixtures";

/** A decoded save holding what R5 derives for a creator state (the save stores resolved output, per group). */
function saveFor(derived: ReturnType<typeof descriptorsFromUiState>): SavedV {
  const groups = { head: [] as SavedV["groups"]["head"], body: [] as SavedV["groups"]["head"], arms: [] as SavedV["groups"]["head"] };
  const group = (part: "head" | "body" | "arms", name: string) => {
    let found = groups[part].find(g => g.name === name);
    if (!found) { found = { name, appearances: [], morphs: [] }; groups[part].push(found); }
    return found;
  };
  for (const a of derived.appearances) group(a.part, a.group).appearances.push({ resourceHash: a.app.hash, definition: a.definition, name: a.option, censorFlag: 0, censorAction: 0 });
  for (const m of derived.morphs) group(m.part, m.group).morphs.push({ region: m.region, target: m.target, censorFlag: 0, censorAction: 0 });
  return { schema: "eye-artistry/saved-v-1", saveVersion: 269, gameVersion: 2310, presetVersion: 12, isMale: false, brainIsMale: false, groups,
    perspectives: [], tags: [], evidence: { nodeName: "test", nodeBytes: 0, bytesRead: 0, trailingBytes: 0, chunks: 0, decompressedBytes: 0 } };
}
const pairs = (request: ReturnType<typeof deriveCharacter>["request"]) => request.appearances.map(a => `${a.part}/${a.group}/${a.option}=${a.definition}`);
const set = (option: string, choice: string, part: "head" | "body" = "head"): CharacterChoice => ({ part, option, choice });

describe("the character context's interpretation (host side)", () => {
  test("the default V derives exactly what the host derives for its default; the view lists the active rows", async () => {
    const source = await fixtureSource();
    const { request, view } = deriveCharacter(source, { kind: "default" }, []);
    const expected = descriptorsFromUiState(source.cco, {});
    expect(request.appearances).toEqual(expected.appearances);
    expect(request.morphs).toEqual(expected.morphs);
    expect(view.values["head/piercings_00"]).toEqual({ choice: "", own: "", position: 0, set: false, active: true });
    expect(view.values["head/piercings_01"]).toBeUndefined();
    expect(view.values["head/skin_type_01"]).toBeUndefined();
  });

  test("a switcher choice activates its option; a link controller carries its choice to every follower, in every part", async () => {
    const source = await fixtureSource();
    const { request, view } = deriveCharacter(source, { kind: "default" }, [set("skin_type", "02"), set("skin_color", "tone_c"), set("piercings", "XL-Pretty-Ring"),
      set("xl_ring", "ring_gold"), set("eyes", "h021")]);
    const list = pairs(request);
    expect(list).toContain("head/TPP/skin_type_02=h0__tone_c");
    expect(list).toContain("head/TPP/neck=n_c");
    expect(list).toContain("body/TPP_Body/body_color=b_c");
    expect(list).toContain("head/face/xl_ring=ring_gold");
    expect(list.some(p => p.includes("skin_type_01") || p.includes("piercings_01"))).toBe(false);
    expect(request.morphs.map(m => `${m.region}=${m.target}`)).toContain("eyes=h021");
    // The activation the view reports is R5's own (CORE-57).
    const active = activeOptions(source.cco, { skin_type: "02", piercings: "XL-Pretty-Ring" });
    for (const a of request.appearances) expect(active.has(`${a.part}/${a.option}`)).toBe(true);
    expect(view.values["head/xl_ring"]).toEqual({ choice: "ring_gold", own: "ring_silver", position: 1, set: true, active: true });
  });

  test("followers are derived at request time: removing a controller's choice gives the family back its base (CORE-50)", async () => {
    const source = await fixtureSource();
    const state = { skin_type: "02", skin_color: "tone_b", skin_type_02: "h0__tone_b", neck: "n_b", body_color: "b_b" };
    const saved = savedDescriptorsOf(saveFor(descriptorsFromUiState(source.cco, state)));
    const changed = deriveCharacter(source, { kind: "save", saved }, [set("skin_color", "tone_c")]);
    expect(pairs(changed.request)).toEqual(expect.arrayContaining(["head/TPP/skin_type_02=h0__tone_c", "head/TPP/neck=n_c", "body/TPP_Body/body_color=b_c"]));
    const reset = deriveCharacter(source, { kind: "save", saved }, []);
    expect(pairs(reset.request)).toEqual(expect.arrayContaining(["head/TPP/skin_type_02=h0__tone_b", "head/TPP/neck=n_b", "body/TPP_Body/body_color=b_b"]));
    expect(reset.view.values["head/skin_color"]).toMatchObject({ choice: "tone_b", own: "tone_b", set: false });
  });

  test("a save's own descriptors are kept for everything a choice doesn't change", async () => {
    const source = await fixtureSource();
    const saved = savedDescriptorsOf(saveFor(descriptorsFromUiState(source.cco, { eyes_color: "he__02_blue", scars: "scar_01" })));
    // A saved option this installation doesn't know still draws as saved.
    const withUnknown = { ...saved, appearances: [...saved.appearances, { part: "head" as const, group: "face", option: "legacy_selector", app: "77", definition: "legacy_a" }] };
    const { request, view } = deriveCharacter(source, { kind: "save", saved: withUnknown }, [set("eyes_color", "he__03_violet")]);
    const list = pairs(request);
    expect(list).toContain("head/face/legacy_selector=legacy_a");
    expect(list).toContain("head/TPP/scars=scar_01");
    expect(list).toContain("head/TPP/eyes_color=he__03_violet");
    expect(list).not.toContain("head/TPP/eyes_color=he__02_blue");
    expect(view.missing.entries).toEqual([{ part: "head", option: "legacy_selector", choice: "legacy_a", mod: null, reason: "option-missing", from: "save" }]);
  });

  test("save → state → descriptors reproduces the save, recovering switcher and controller state the save doesn't store", async () => {
    const source = await fixtureSource(true);
    const state = { skin_type: "02", skin_color: "tone_b", skin_type_02: "h0__tone_b", neck: "n_b", body_color: "b_b",
      eyes_color: "he__04_green", piercings: "01", piercings_01: "gold", eyes: "h011", scars: "scar_01", breast: "big" };
    const recovered = recoverSave(source, savedDescriptorsOf(saveFor(descriptorsFromUiState(source.cco, state))));
    expect(recovered.saveCheck).toMatchObject({ savedOnly: [], derivedOnly: [] });
    expect(recovered.saveCheck.matched).toBe(recovered.saveCheck.saved);
    expect(recovered.state.get("head/skin_type")?.key).toBe("02");
    expect(recovered.state.get("head/skin_color")?.key).toBe("tone_b");
    expect(recovered.state.get("head/piercings")?.key).toBe("01");
    expect(recovered.missing).toEqual([]);
  });

  test("a save using a mod the user lacks reports it in one plain line and falls back to Off", async () => {
    const withMod = await fixtureSource(true);
    const saved = savedDescriptorsOf(saveFor(descriptorsFromUiState(withMod.cco, { eyes_color: "he__03_violet", piercings: "XL-Pretty-Ring", xl_ring: "ring_silver" })));
    const lacking = await fixtureSource(false);
    const { view } = deriveCharacter(lacking, { kind: "save", saved }, []);
    expect(view.missing.entries.map(e => [e.option, e.choice, e.reason])).toEqual([["eyes_color", "he__03_violet", "choice-missing"], ["xl_ring", "ring_silver", "option-missing"]]);
    expect(view.missing.summary).toHaveLength(1);
    expect(view.missing.summary[0]!.message).toContain("a mod it used may be missing");
    expect(view.values["head/piercings"]!.choice).toBe("Common-Off");
  });

  test("a malformed save is refused whole with a plain reason before anything changes (CORE-52)", () => {
    expect(() => savedDescriptorsOf(null)).toThrow("That isn't a save XF Studio can read: it has no appearance groups.");
    expect(() => savedDescriptorsOf({ groups: { head: [{ name: "TPP", appearances: [{ name: "a" }], morphs: [] }] } })).toThrow("an appearance is invalid");
    expect(() => savedDescriptorsOf({ groups: { head: "x" } })).toThrow("head groups are invalid");
  });

  test("a preset stores only the choices set: one hair colour or skin tone is one entry, not its whole family (CORE-51)", async () => {
    const source = await fixtureSource(true);
    const choices = [set("skin_color", "tone_c"), set("eyes_color", "he__03_violet"), set("piercings", "XL-Pretty-Ring"), set("xl_ring", "ring_gold"), set("eyes", "h011")];
    const { preset, leftOut } = presetOfChoices(source, choices, { name: "Violet" });
    expect(leftOut).toBe(0);
    const stored = JSON.parse(writeCcPreset(preset));
    expect(stored.values.map((v: { option: string }) => v.option)).toEqual(["skin_color", "eyes_color", "piercings", "xl_ring", "eyes"]);
    expect(writeCcPreset(preset)).not.toMatch(/[A-Za-z]:\\|Users|\.archive\b/);
    expect(stored.values).toContainEqual({ part: "head", option: "eyes_color", definition: "he__03_violet", app: expect.stringMatching(/^\d+$/),
      mod: MOD_NAME, resource: expect.stringMatching(/^\d+$/) });
    expect(stored.values).toContainEqual({ part: "head", option: "piercings", choice: "XL-Pretty-Ring", activates: ["xl_ring"], mod: MOD_NAME, resource: expect.any(String) });
    expect(stored.values).toContainEqual({ part: "head", option: "eyes", morph: "h011" });
    // Loaded again, the same V.
    const again = deriveCharacter(source, { kind: "default" }, choicesOfPreset(parseCcPreset(stored)));
    expect(again.request).toEqual(deriveCharacter(source, { kind: "default" }, choices).request);
    // A user without the mod gets one plain line per mod, and exporting again keeps what they couldn't use.
    const lacking = await fixtureSource(false);
    const missing = deriveCharacter(lacking, { kind: "default" }, choicesOfPreset(parseCcPreset(stored))).view.missing;
    expect(missing.entries.map(e => [e.option, e.reason, e.mod])).toEqual([["eyes_color", "choice-missing", MOD_NAME], ["piercings", "choice-missing", MOD_NAME],
      ["xl_ring", "option-missing", MOD_NAME]]);
    expect(missing.summary).toEqual([{ mod: MOD_NAME, count: 3, message: `“${MOD_NAME}” isn't installed or enabled here, so 3 choices keep the V's own look instead.` }]);
    const parsed = parseCcPreset(stored);
    const kept = serializeCcPreset(presetOfChoices(lacking, choicesOfPreset(parsed), { kept: { entries: [...parsed.values] } }).preset);
    expect((kept.values as { option: string }[]).map(v => v.option).sort()).toEqual(["eyes", "eyes_color", "piercings", "skin_color", "xl_ring"]);
    expect(kept.values).toContainEqual(stored.values.find((v: { option: string }) => v.option === "eyes_color"));
  });

  test("a switcher choice renumbered on another installation is found by the options it activates", async () => {
    const source = await fixtureSource(true);
    const { view } = deriveCharacter(source, { kind: "default" }, choicesOfPreset(parseCcPreset({ schema: CC_PRESET_SCHEMA, bodyGender: "female",
      values: [{ part: "head", option: "piercings", choice: "07", activates: ["xl_ring"] }] })));
    expect(view.values["head/piercings"]!.choice).toBe("XL-Pretty-Ring");
    expect(view.missing.entries).toEqual([]);
  });

  test("linked switchers take the choice activating the same options, not the same position (CORE-61, hypothesis)", () => {
    const option = (name: string, choices: [string, string[]][], controller: boolean) => ({ type: "switcher" as const, name, uiSlot: name, uiSlots: [name],
      link: "hairstyle", linkController: controller, hidden: false, enabled: name === "hairstyle", index: 0, defaultIndex: 0, localizedName: "", editTags: ["NewGame"],
      definedBy: "base game", options: choices.map(([localizedName, names], index) => ({ localizedName, names, index, providedBy: "base game" })) });
    const hair = (name: string) => ({ type: "appearance" as const, name, uiSlot: "hair_color", link: "", linkController: false, hidden: false, enabled: false, index: 0,
      defaultIndex: 0, localizedName: "", editTags: ["NewGame"], definedBy: "base game", resource: { hash: "9", path: `h\\${name}.app` },
      definitions: [{ name: `${name}_brown`, index: 0, localizedName: "", tags: [], providedBy: "base game" }] });
    const cco: CcoResource = { label: "t", version: 1, parts: { body: { options: [], groups: [] }, arms: { options: [], groups: [] }, head: {
      options: [option("hairstyle", [["01", ["hair_a"]], ["02", ["hair_b"]], ["03", ["hair_c"]]], true),
        // The cyberware variant lists the same styles in another order.
        option("hairstyle_cyberware", [["01", ["hair_c"]], ["02", ["hair_a"]], ["03", ["hair_b"]]], true), hair("hair_a"), hair("hair_b"), hair("hair_c")],
      groups: [{ name: "hairs", options: ["hair_a", "hair_b", "hair_c"] }] } } };
    const source: CharacterSource = { catalogue: buildCatalogue({ bodyGender: "female", cco, customs: [], text: null, presentation: null }), cco };
    const { view } = deriveCharacter(source, { kind: "default" }, [set("hairstyle", "02")]);
    expect(view.values["head/hairstyle"]!.choice).toBe("02");
    // Style "02" of the plain switcher turns on hair_b: the cyberware switcher's choice that does is its "03".
    const index = new CatalogueIndex(source.catalogue), plain = index.option("head", "hairstyle")!, cyber = index.option("head", "hairstyle_cyberware")!;
    expect(linkedChoice(index.choice(plain, "02")!, cyber, plain)!.key).toBe("03");
    expect(linkedChoice(index.choice(plain, "01")!, cyber, plain)!.key).toBe("02");
  });
});

describe("xfs/cc-preset-1 codec", () => {
  const sample = { schema: CC_PRESET_SCHEMA, bodyGender: "female", name: "Test", futureField: { a: 1 },
    values: [
      { part: "head", option: "eyes_color", definition: "he__01_brown", app: "123", futureHint: true },
      { part: "head", option: "hologram", glow: 0.5 },
      { part: "head", option: "nose", morph: "" },
      { part: "head", option: "hairstyle", choice: "05", activates: ["hair_color5"], mod: "Some Hair", resource: "42" },
    ] };

  test("round trip keeps unknown fields and entries in place", () => {
    const parsed = parseCcPreset(structuredClone(sample));
    expect(parsed.values).toHaveLength(3);
    expect(JSON.parse(JSON.stringify(parsed.unknownEntries))).toEqual([{ at: 1, entry: { part: "head", option: "hologram", glow: 0.5 } }]);
    expect(serializeCcPreset(parsed)).toEqual(sample);
    expect(JSON.parse(JSON.stringify(readCcPreset(writeCcPreset(parsed))))).toEqual(JSON.parse(JSON.stringify(parsed)));
  });

  test("refusals are plain", () => {
    expect(() => parseCcPreset({ ...sample, schema: "xfs/cc-preset-2" })).toThrow("newer XF Studio");
    expect(() => parseCcPreset({ ...sample, schema: "other" })).toThrow("not a character preset");
    expect(() => parseCcPreset({ ...sample, bodyGender: "x" })).toThrow("body type");
    expect(() => parseCcPreset({ ...sample, values: [{ part: "head", option: "a", definition: "x", mod: "C:\\Users\\me" }] })).toThrow("mod name");
    expect(() => parseCcPreset({ ...sample, values: [{ part: "head", option: "a\\b", definition: "x" }] })).toThrow("creator name");
    expect(() => parseCcPreset({ ...sample, values: [{ part: "head", option: "a", definition: "x", morph: "y" }] })).toThrow("more than one kind");
    expect(() => parseCcPreset({ ...sample, values: [{ part: "head", option: "a", morph: "x" }, { part: "head", option: "a", morph: "y" }] })).toThrow("twice");
    expect(() => readCcPreset("{")).toThrow("not valid JSON");
  });

  test("a CName with a slash round-trips; a name over the shared limit is kept verbatim, not the file refused; what the reader would refuse is left out on writing (CORE-53, PIPE-79)", async () => {
    expect(parseCcPreset({ ...sample, values: [{ part: "head", option: "folder/option", definition: "x".repeat(255) }] }).values[0]!.option).toBe("folder/option");
    const long = parseCcPreset({ ...sample, values: [{ part: "head", option: "folder/option", definition: "x".repeat(300) }] });
    expect(long.values).toEqual([]);
    expect(long.unknownEntries).toMatchObject([{ at: 0, unusable: true }]);
    expect(serializeCcPreset(long).values).toEqual([{ part: "head", option: "folder/option", definition: "x".repeat(300) }]);
    const source = await fixtureSource(true);
    const { preset, leftOut } = presetOfChoices(source, [set("eyes_color", "he__03_violet"), set("y".repeat(600), "z")]);
    expect(leftOut).toBe(1);
    expect(readCcPreset(writeCcPreset(preset)).values.map(v => v.option)).toEqual(["eyes_color"]);
  });

  test("unknown fields go into prototype-free objects: a __proto__ key is kept, not dropped or applied (CORE-54)", () => {
    const parsed = parseCcPreset(JSON.parse(`{"schema":"${CC_PRESET_SCHEMA}","bodyGender":"female","values":[],"__proto__":{"polluted":1}}`));
    expect(Object.getPrototypeOf(parsed.extra)).toBeNull();
    expect(Object.keys(parsed.extra)).toEqual(["__proto__"]);
    expect(({} as { polluted?: number }).polluted).toBeUndefined();
    expect(writeCcPreset(parsed)).toContain(`"__proto__"`);
  });

  test("the size limit counts UTF-8 bytes; depth and size of unknown data are bounded with plain reasons; the file is read once (CORE-55)", () => {
    // 600,000 two-byte characters: 1.2 MB of UTF-8, under a million UTF-16 units.
    const wide = JSON.stringify({ ...sample, futureField: "é".repeat(600_000) });
    expect(wide.length).toBeLessThan(CC_PRESET_LIMITS.bytes);
    expect(() => readCcPreset(wide)).toThrow("larger than 1 MB");
    expect(() => readPresetJson(new TextEncoder().encode(wide))).toThrow("larger than 1 MB");
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = { deeper: deep };
    expect(() => parseCcPreset({ ...sample, futureField: deep })).toThrow("nested too deeply");
    expect(() => parseCcPreset({ ...sample, futureField: Array.from({ length: 30_000 }, (_, i) => i) })).toThrow("too much data");
    expect(readPresetJson(new TextEncoder().encode(JSON.stringify(sample)))).toEqual(sample);
  });
});

describe("the character context in the Studio (CharacterContextActions)", () => {
  /** A port over the fixture catalogue, interpreting requests as the host does. */
  async function port(withMod = true): Promise<CreatorPort & { views: number }> {
    const source = await fixtureSource(withMod);
    const { panel, mods } = panelProjection(source.catalogue, catalogueCoverage(source.catalogue), "fixture");
    const { choicePage } = await import("../src/cc-panel");
    const index = new CatalogueIndex(source.catalogue);
    const counter = { views: 0 };
    return Object.assign(counter, {
      panel: async () => ({ phase: "ready" as const, message: "", panel: structuredClone(panel) }),
      page: async (_gender: string, option: string, offset: number) => choicePage(index, mods, option, offset)!,
      view: async (request: Parameters<CreatorPort["view"]>[0]) => {
        counter.views++;
        const saved = request.source === "save" ? { appearances: request.appearances, morphs: request.morphs } : null;
        const { view } = deriveCharacter(source, saved ? { kind: "save", saved } : { kind: "default" }, request.choices ?? []);
        const values = Object.fromEntries(Object.entries(view.values).map(([id, value]) => [id, { ...value, label: value.choice, color: null, ownLabel: value.own }]));
        return { ...view, identity: "fixture", values, faceMorphs: [] };
      },
      preset: async (request: Parameters<CreatorPort["preset"]>[0], name: string | null) =>
        ({ text: writeCcPreset(presetOfChoices(source, request.choices ?? [], { name }).preset), values: request.choices?.length ?? 0, leftOut: 0, personal: 0 }),
      wait: async () => {},
    });
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 10));

  test("refuses changes as not_ready until the catalogue arrives (CORE-64); a change is one step with its own Undo and Redo (CORE-59)", async () => {
    const shown: (SavedV | null)[] = [];
    const context = new CharacterContextActions({ creator: await port(), showSave: save => shown.push(save) });
    expect(context.capability({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__02_blue" })).toMatchObject({ available: false, code: "not_ready" });
    context.start();
    await settle();
    expect(context.snapshot().phase).toBe("ready");
    expect(context.capability({ kind: "character.setOption", part: "head", option: "nope", choice: "x" })).toMatchObject({ code: "missing_target" });
    context.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__02_blue" });
    context.dispatch({ kind: "character.setOptions", changes: [set("scars", ""), set("piercings", "Common-Off")], label: "Hide my V's own makeup" });
    expect(context.snapshot()).toMatchObject({ set: 3, undo: "Hide my V's own makeup", redo: null });
    context.dispatch({ kind: "character.undo" });
    expect(context.snapshot()).toMatchObject({ set: 1, undo: "Change Eye Color", redo: "Hide my V's own makeup" });
    context.dispatch({ kind: "character.redo" });
    expect(context.request().choices).toHaveLength(3);
    // Reset needs the option, and resets its family.
    expect(context.capability({ kind: "character.reset", part: "head", option: "teeth" })).toMatchObject({ available: false });
    context.dispatch({ kind: "character.reset", part: "head", option: "scars" });
    expect(context.request().choices?.map(c => c.option)).toEqual(["eyes_color", "piercings"]);
    expect(shown).toEqual([]);
  });

  test("a link family keeps one choice: the latest (CORE-51)", async () => {
    const context = new CharacterContextActions({ creator: await port(), showSave: () => {} });
    context.start(); await settle();
    context.dispatch({ kind: "character.setOption", part: "head", option: "skin_color", choice: "tone_b" });
    context.dispatch({ kind: "character.setOption", part: "head", option: "skin_color", choice: "tone_c" });
    expect(context.request().choices).toEqual([set("skin_color", "tone_c")]);
    expect(context.stored()).toEqual({ origin: "default", bodyGender: "female", choices: [set("skin_color", "tone_c")] });
  });

  test("loading a save is one undoable step that clears the previous V's choices; Keep my changes brings them back; Undo shows the earlier V", async () => {
    const source = await fixtureSource();
    const saveA = saveFor(descriptorsFromUiState(source.cco, { eyes_color: "he__02_blue" }));
    const saveB = saveFor(descriptorsFromUiState(source.cco, { scars: "scar_01" }));
    const shown: (SavedV | null)[] = [];
    const context = new CharacterContextActions({ creator: await port(), showSave: save => shown.push(save) }, { save: saveA });
    context.start(); await settle();
    context.dispatch({ kind: "character.setOption", part: "head", option: "teeth", choice: "t_gold" });
    // The saved-V service shows another save (a file was loaded): the context follows as one step.
    context.followSave(structuredClone(saveB));
    expect(context.snapshot()).toMatchObject({ origin: { kind: "save" }, set: 0, keepable: 1, undo: "Load a save" });
    // The same save again (a copy) is not a new V.
    context.followSave(structuredClone(saveB));
    expect(context.snapshot().undo).toBe("Load a save");
    context.dispatch({ kind: "character.keepChanges" });
    expect(context.snapshot()).toMatchObject({ set: 1, keepable: 0, undo: "Keep my changes" });
    context.dispatch({ kind: "character.undo" });
    context.dispatch({ kind: "character.undo" });
    expect(shown.map(save => save?.groups.head.flatMap(g => g.appearances.map(a => a.definition)))).toEqual([saveA.groups.head.flatMap(g => g.appearances.map(a => a.definition))]);
    expect(context.request().choices).toEqual([set("teeth", "t_gold")]);
    // A malformed save is refused whole (CORE-52).
    expect(context.capability({ kind: "character.loadSave", value: { groups: { head: [{}] } } })).toMatchObject({ available: false, code: "invalid_value" });
  });

  test("a preset is parsed once, loaded as one step over the default V, and stored with its source", async () => {
    const context = new CharacterContextActions({ creator: await port(), showSave: () => {} });
    context.start(); await settle();
    const value = { schema: CC_PRESET_SCHEMA, bodyGender: "female", name: "Violet", values: [{ part: "head", option: "eyes_color", definition: "he__03_violet" }] };
    expect(context.capability({ kind: "character.loadPreset", value })).toEqual({ available: true });
    context.dispatch({ kind: "character.loadPreset", value });
    expect(context.snapshot()).toMatchObject({ origin: { kind: "preset", name: "Violet" }, set: 1, undo: "Load “Violet”" });
    expect(storedCharacterOf(JSON.parse(JSON.stringify(context.stored())))).toMatchObject({ origin: "preset", name: "Violet", choices: [set("eyes_color", "he__03_violet")] });
    expect(context.capability({ kind: "character.loadPreset", value: { schema: "nope" } })).toMatchObject({ available: false, reason: expect.stringContaining("not a character preset") });
    const exported = await context.exportPreset("Violet");
    expect(JSON.parse(exported.text).values).toEqual([expect.objectContaining({ option: "eyes_color", definition: "he__03_violet" })]);
  });

  test("the view follows the state; nothing is stored until something is set", async () => {
    const creator = await port();
    const context = new CharacterContextActions({ creator, showSave: () => {} });
    expect(context.stored()).toBeUndefined();
    context.start(); await settle();
    expect(context.view()?.values["head/eyes_color"]?.choice).toBe("he__01_brown");
    context.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__02_blue" });
    await settle();
    expect(context.view()?.values["head/eyes_color"]).toMatchObject({ choice: "he__02_blue", own: "he__01_brown", set: true });
    expect(Object.isFrozen(context.view())).toBe(true);
    expect(storedCharacterOf({ origin: "save", choices: [{ part: "head", option: "a", choice: "b", extra: 1 }] })).toEqual({ origin: "save", choices: [] });
  });

  test("the action family has a descriptor per kind, records nothing in a look's history and is registered in the Studio", () => {
    expect(Object.keys(CHARACTER_CONTEXT_FAMILY.actions)).toEqual(["character.setOption", "character.setOptions", "character.hideOwnMakeup", "character.reset",
      "character.resetAll", "character.useDefault", "character.loadSave", "character.loadPreset", "character.keepChanges", "character.retry", "character.clearPreparedFiles", "character.undo", "character.redo",
      "character.setClothing", "character.setClothingArea", "character.undoClothing", "character.redoClothing"]);
    for (const spec of Object.values(CHARACTER_CONTEXT_FAMILY.actions)) expect(spec.descriptor.undo).toBe("none");
    expect(STUDIO_OWNERS).toContain(CHARACTER_CONTEXT_FAMILY);
    expect(() => new Registry([...STUDIO_OWNERS])).not.toThrow();
    // Reset needs its part (CORE-59).
    expect(CHARACTER_CONTEXT_FAMILY.actions["character.reset"].descriptor.payload.part!.required).toBe(true);
  });
});
