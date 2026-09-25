import { describe, expect, test } from "bun:test";
import { descriptorsFromUiState } from "../src/cco-model";
import { activeOptions, CHARACTER_CONTEXT_FAMILY, CharacterContext, previewRequestFor } from "../src/character-context";
import { DEFAULT_CHARACTER } from "../src/character-detail-request";
import { CC_PRESET_SCHEMA, parseCcPreset, readCcPreset, serializeCcPreset, writeCcPreset } from "../src/cc-preset";
import { Registry } from "../src/platform/core/registry";
import { STUDIO_OWNERS } from "../src/compose/studio-registry";
import type { SavedV } from "../src/save-reader";
import { fixtureSource, MOD_NAME } from "./cc-fixtures";

const context = async (withMod = true) => { const c = new CharacterContext(); c.setSource(await fixtureSource(withMod)); return c; };

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

describe("character context", () => {
  test("the default V derives exactly what the host derives for its default", async () => {
    const c = await context();
    const request = c.request();
    const expected = descriptorsFromUiState(c.source()!.cco, {});
    expect(request.appearances).toEqual(expected.appearances);
    expect(request.morphs).toEqual(expected.morphs);
    expect(request.isDefault).toBe(true);
    expect(previewRequestFor(request)).toBe(DEFAULT_CHARACTER);
    const snapshot = c.snapshot();
    expect(snapshot.ready).toBe(true);
    expect(snapshot.values["head/piercings_00"]).toEqual({ choice: "", explicit: false, active: true });
    expect(snapshot.values["head/piercings_01"]!.active).toBe(false);
    expect(snapshot.values["head/skin_type_01"]).toBeUndefined();
  });

  test("setOption validates against the catalogue with plain refusals", async () => {
    const c = await context();
    expect(c.capability({ kind: "character.setOption", part: "head", option: "nope", choice: "x" })).toMatchObject({ available: false, code: "missing_target" });
    expect(c.capability({ kind: "character.setOption", part: "head", option: "neck", choice: "n_b" })).toMatchObject({ available: false, code: "invalid_value" });
    expect(c.capability({ kind: "character.setOption", part: "head", option: "skin_type_02", choice: "h0__tone_b" }))
      .toMatchObject({ available: false, reason: "That option follows another one, so it can't be set on its own." });
    expect(c.capability({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__09_red" }))
      .toMatchObject({ available: false, code: "invalid_value", reason: "“he__09_red” isn't one of Eye Color's choices." });
    expect(() => c.dispatch({ kind: "character.setOption", part: "head", option: "nope", choice: "x" })).toThrow("isn't offered");
    const empty = new CharacterContext();
    expect(empty.capability({ kind: "character.useDefault", bodyGender: "male" })).toMatchObject({ available: false, code: "asset_unavailable" });
  });

  test("a switcher choice activates its option; a link controller carries its position to every follower", async () => {
    const c = await context();
    c.dispatch({ kind: "character.setOption", part: "head", option: "skin_type", choice: "02" });
    c.dispatch({ kind: "character.setOption", part: "head", option: "skin_color", choice: "tone_c" });
    c.dispatch({ kind: "character.setOption", part: "head", option: "piercings", choice: "XL-Pretty-Ring" });
    c.dispatch({ kind: "character.setOption", part: "head", option: "xl_ring", choice: "ring_gold" });
    c.dispatch({ kind: "character.setOption", part: "head", option: "eyes", choice: "h021" });
    const request = c.request();
    const pairs = request.appearances.map(a => `${a.part}/${a.group}/${a.option}=${a.definition}`);
    expect(pairs).toContain("head/TPP/skin_type_02=h0__tone_c");
    expect(pairs).toContain("head/TPP/neck=n_c");
    expect(pairs).toContain("body/TPP_Body/body_color=b_c");
    expect(pairs).toContain("head/face/xl_ring=ring_gold");
    expect(pairs.some(p => p.includes("skin_type_01") || p.includes("piercings_01"))).toBe(false);
    expect(request.morphs.map(m => `${m.region}=${m.target}`)).toContain("eyes=h021");
    const active = activeOptions(c.source()!.cco, { skin_type: "02", piercings: "XL-Pretty-Ring" });
    for (const a of request.appearances) expect(active.has(`${a.part}/${a.option}`)).toBe(true);
    const preview = previewRequestFor(request)!;
    expect(preview.source).toBe("save");
    expect(preview.source === "save" && preview.appearances.every(a => /^\d+$/.test(a.app))).toBe(true);
    c.dispatch({ kind: "character.reset" });
    expect(c.request().isDefault).toBe(true);
  });

  test("save → context → request reproduces the save", async () => {
    const source = await fixtureSource(true);
    const state = { skin_type: "02", skin_color: "tone_b", skin_type_02: "h0__tone_b", neck: "n_b", body_color: "b_b",
      eyes_color: "he__04_green", piercings: "01", piercings_01: "gold", eyes: "h011", scars: "scar_01", breast: "big" };
    const saved = saveFor(descriptorsFromUiState(source.cco, state));
    const c = new CharacterContext();
    c.setSource(source);
    c.dispatch({ kind: "character.loadSave", value: saved });
    const snapshot = c.snapshot();
    expect(snapshot.origin).toEqual({ kind: "save" });
    expect(snapshot.saveCheck).toMatchObject({ savedOnly: [], derivedOnly: [] });
    expect(snapshot.saveCheck!.matched).toBe(snapshot.saveCheck!.saved);
    // Switcher and controller state the save doesn't store is recovered.
    expect(snapshot.values["head/skin_type"]!.choice).toBe("02");
    expect(snapshot.values["head/skin_color"]!.choice).toBe("tone_b");
    expect(snapshot.values["head/piercings"]!.choice).toBe("01");
    expect(snapshot.missing.entries).toEqual([]);
    const request = previewRequestFor(c.request())!;
    expect(request.source === "save" && request.appearances.length).toBe(saved.groups.head.flatMap(g => g.appearances).length);
  });

  test("a save using a mod the user lacks loads with a missing-choice report", async () => {
    const withMod = await fixtureSource(true);
    const saved = saveFor(descriptorsFromUiState(withMod.cco, { eyes_color: "he__03_violet", piercings: "XL-Pretty-Ring", xl_ring: "ring_silver" }));
    const c = await context(false);
    c.dispatch({ kind: "character.loadSave", value: saved });
    const missing = c.snapshot().missing;
    expect(missing.entries.map(e => [e.option, e.choice, e.reason])).toEqual([["eyes_color", "he__03_violet", "choice-missing"], ["xl_ring", "ring_silver", "option-missing"]]);
    expect(missing.summary).toHaveLength(1);
    expect(missing.summary[0]!.message).toContain("a mod it used may be missing");
    // The piercing switcher falls back to its Off choice: none of its options is in the save any more.
    expect(c.snapshot().values["head/piercings"]!.choice).toBe("Common-Off");
  });

  test("context → preset → context, and a preset naming a missing mod reports it", async () => {
    const c = await context(true);
    c.dispatch({ kind: "character.setOption", part: "head", option: "eyes_color", choice: "he__03_violet" });
    c.dispatch({ kind: "character.setOption", part: "head", option: "piercings", choice: "XL-Pretty-Ring" });
    c.dispatch({ kind: "character.setOption", part: "head", option: "xl_ring", choice: "ring_gold" });
    c.dispatch({ kind: "character.setOption", part: "head", option: "eyes", choice: "h011" });
    const preset = c.toPreset("Violet");
    const text = writeCcPreset(preset);
    expect(text).not.toMatch(/[A-Za-z]:\\|Users|\.archive\b/);
    const stored = JSON.parse(text);
    expect(stored.values).toContainEqual({ part: "head", option: "eyes_color", definition: "he__03_violet", app: expect.stringMatching(/^\d+$/),
      mod: MOD_NAME, resource: expect.stringMatching(/^\d+$/) });
    expect(stored.values).toContainEqual({ part: "head", option: "piercings", choice: "XL-Pretty-Ring", activates: ["xl_ring"], mod: MOD_NAME, resource: expect.any(String) });
    expect(stored.values).toContainEqual({ part: "head", option: "eyes", morph: "h011" });

    const again = await context(true);
    again.dispatch({ kind: "character.loadPreset", value: stored });
    expect(again.request()).toEqual(c.request());
    expect(again.snapshot().origin).toEqual({ kind: "preset", name: "Violet" });

    const lacking = await context(false);
    lacking.dispatch({ kind: "character.loadPreset", value: stored });
    const missing = lacking.snapshot().missing;
    expect(missing.entries.map(e => [e.option, e.reason, e.mod])).toEqual([["eyes_color", "choice-missing", MOD_NAME],
      ["piercings", "choice-missing", MOD_NAME], ["xl_ring", "option-missing", MOD_NAME]]);
    expect(missing.summary).toEqual([{ mod: MOD_NAME, count: 3, message: `“${MOD_NAME}” isn't installed or enabled here, so 3 choices use the creator default instead.` }]);
    // What this installation can't use is kept, so exporting again doesn't lose the other user's choices.
    const kept = serializeCcPreset(lacking.toPreset());
    expect((kept.values as { option: string }[]).map(v => v.option).sort()).toEqual(["eyes", "eyes_color", "piercings", "xl_ring"]);
  });

  test("a switcher choice renumbered on another installation is found by the options it activates", async () => {
    const c = await context(true);
    c.dispatch({ kind: "character.loadPreset", value: { schema: CC_PRESET_SCHEMA, bodyGender: "female",
      values: [{ part: "head", option: "piercings", choice: "07", activates: ["xl_ring"] }] } });
    expect(c.snapshot().values["head/piercings"]!.choice).toBe("XL-Pretty-Ring");
    expect(c.snapshot().missing.entries).toEqual([]);
  });

  test("the action family has a descriptor per kind and no kind clashes with the Studio's registry", () => {
    expect(Object.keys(CHARACTER_CONTEXT_FAMILY.actions)).toEqual(["character.setOption", "character.reset", "character.useDefault", "character.loadSave", "character.loadPreset"]);
    for (const spec of Object.values(CHARACTER_CONTEXT_FAMILY.actions)) expect(spec.descriptor.undo).toBe("none");
    expect(() => new Registry([...STUDIO_OWNERS, CHARACTER_CONTEXT_FAMILY])).not.toThrow();
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
    expect(parsed.unknownEntries).toEqual([{ at: 1, entry: { part: "head", option: "hologram", glow: 0.5 } }]);
    expect(serializeCcPreset(parsed)).toEqual(sample);
    expect(readCcPreset(writeCcPreset(parsed))).toEqual(parsed);
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
});
