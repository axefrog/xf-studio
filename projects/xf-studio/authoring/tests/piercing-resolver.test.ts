import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChoiceOverride, detailSlotOf, piercingLabel, slotChoices } from "../src/character-detail-plan";
import { CharacterRequestVersionError, DEFAULT_CHARACTER, parseCharacterRequest, sameCharacter, type CharacterRequest } from "../src/character-detail-request";
import { CharacterPreparationCache, prepareCharacterDetails } from "../src/character-detail-service";
import { loadMergedCco } from "../src/character-resolver";
import { depotHash } from "../src/depot-path";
import type { ExportedGeometry, ExportedMask, ExportedTexture, GameAssetExporter } from "../src/game-asset-export";
import { encodePng } from "../src/png";
import { parseCharacterDetail } from "../src/render-detail";
import { detailFixture, EARRING_MASK, P, PIERCING, piercingRequest, REQUEST_A } from "./character-detail-fixtures";

// Piercings through the generic resolver, from an asset-free synthetic installation (character-detail-fixtures.ts): the creator's
// piercing slot and groups select the parts, their chunk masks select the chunks, and a jewellery framework that replaces a style's
// `.app` at its vanilla path resolves by archive precedence alone. No private save, game file or real mod name is used.

const root = mkdtempSync(join(tmpdir(), "xfs-piercings-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const png = (value: number) => encodePng({ width: 4, height: 4, data: new Uint8Array(64).fill(value) }, { alpha: true });
function exporter(): GameAssetExporter {
  let n = 0;
  return { open() {
    const dir = join(root, `e${n++}`); mkdirSync(dir, { recursive: true });
    const file = (path: string, ext: string, bytes: Uint8Array | string) => { const f = join(dir, `${depotHash(path)}.${ext}`); writeFileSync(f, bytes); return f; };
    return { tool: { key: "t", label: "Test" }, present: () => null, close() {},
      geometry: async paths => new Map(paths.map((p): [string, ExportedGeometry] => [p, { depotPath: p, hash: depotHash(p), raw: "", rawSha256: "",
        glb: file(p, "glb", `glb ${p}`), glbSha256: "", materials: null, materialsSha256: null, complete: true, cached: false }])),
      textures: async paths => new Map(paths.map((p): [string, ExportedTexture] => [p, { depotPath: p, hash: depotHash(p), png: file(p, "png", png(128)), pngSha256: "", cached: false }])),
      // Three mask layers, each its own image.
      masks: async paths => new Map(paths.map((p): [string, ExportedMask] => [p, { depotPath: p, hash: depotHash(p), cached: false,
        layers: [0, 1, 2].map(index => { const f = join(dir, `${depotHash(p)}_${index}.png`); writeFileSync(f, png(40 * index)); return f; }) }])) };
  } };
}
const route = { gameRoot: join(root, "game"), launchRoute: "mo2" as const, wolvenKitCli: "wk.exe" };
/** The fixture exporter, recording each depot path it is asked to export. */
function counting(calls: string[]): GameAssetExporter {
  const inner = exporter();
  return { open(source, signal) {
    const session = inner.open(source, signal);
    return { ...session, geometry: paths => { calls.push(...paths); return session.geometry(paths); },
      textures: paths => { calls.push(...paths); return session.textures(paths); }, masks: paths => { calls.push(...paths); return session.masks(paths); } };
  } };
}
const prepare = (request: CharacterRequest, fixture = detailFixture()) => prepareCharacterDetails({ request, route, storeRoot: join(root, "store"),
  resolverCache: join(root, "resolver"), exporter: exporter(), open: () => fixture.installation() }).then(result => result.record);

describe("piercings from the creator's slot, groups and chunk masks", () => {
  test("a vanilla style: its part, the chunks its mask leaves visible, and each chunk's layer stack", async () => {
    const record = await prepare(piercingRequest("piercings_01", PIERCING.silver));
    expect(parseCharacterDetail(JSON.parse(JSON.stringify(record)))).toEqual(record);
    const parts = record.components.filter(item => item.slot === "piercings");
    expect(parts.map(item => [item.option, item.component, item.chunks])).toEqual([["piercings_01", "earring_01", [0, 2]]]);
    expect(BigInt(EARRING_MASK) & 2n).toBe(0n);
    expect(record.slots.find(slot => slot.slot === "piercings")).toEqual({ slot: "piercings", state: "shown", label: "style 01, silver" });
    const stack = parts[0]!.materials[0]!.layered!;
    expect(parts[0]!.materials[0]!.templateName ?? parts[0]!.materials[0]!.template).toMatch(/multilayered/);
    expect(stack.setup.depotPath).toBe(P.silverSetup);
    expect(stack.mask).toMatchObject({ depotPath: P.earringMask, layers: 3 });
    expect(stack.layers).toHaveLength(3);
    const [metal, hidden, paint] = stack.layers;
    // Values come from each template's own tables, selected by the layer's names; tiling multiplies the template's multiplier.
    expect(metal).toMatchObject({ opacity: 1, matTile: 0.5, tilingMultiplier: 2, colorScale: [0.97, 0.96, 0.92], normalStrength: 0.15,
      roughLevelsOut: [1, 0], names: { colorScale: "silver", roughLevelsOut: "null" } });
    expect(metal!.template!.depotPath).toBe(P.metalTpl);
    // Maps, microblend and the layer's own mask layer, raw (masks are never colour-decoded).
    expect(Object.keys(metal!.textures).sort()).toEqual(["color", "mask", "microblend", "normal", "roughness", "metalness"].sort());
    expect(metal!.textures.color!.isGamma).toBe(true);
    expect(metal!.textures.mask).toMatchObject({ depotPath: P.earringMask, isGamma: false });
    expect(paint!.textures.mask!.file).not.toBe(metal!.textures.mask!.file);
    // A layer at zero opacity changes nothing: its values are recorded, its textures are not served.
    expect(hidden!.opacity).toBe(0);
    expect(hidden!.textures).toEqual({});
    expect(paint).toMatchObject({ opacity: 0.07, colorScale: [1, 1, 1], names: { colorScale: "white" } });
  });

  test("a name the template lacks falls back to the template's own default selection, and says so by name", async () => {
    const record = await prepare(piercingRequest("piercings_01", PIERCING.black));
    const [paint, missing] = record.components.find(item => item.slot === "piercings")!.materials[0]!.layered!.layers;
    expect(paint).toMatchObject({ colorScale: [0.02, 0.02, 0.02], roughLevelsOut: [0.3, 0.2], names: { colorScale: "black", roughLevelsOut: "shiny" } });
    expect(missing).toMatchObject({ colorScale: [1, 1, 1], names: { colorScale: "white" } });
    expect(record.slots.find(slot => slot.slot === "piercings")!.label).toBe("style 01, black");
  });

  test("Off: the creator's None choice emits nothing, so the default V has no piercings", async () => {
    const record = await prepare(DEFAULT_CHARACTER);
    expect(record.components.filter(item => item.slot === "piercings")).toEqual([]);
    expect(record.slots.find(slot => slot.slot === "piercings")).toEqual({ slot: "piercings", state: "none", label: "None" });
  });

  test("a framework that replaces a style's .app at its vanilla path: its filled slot and the kept part draw; placeholders draw nothing", async () => {
    const vanilla = await prepare(piercingRequest("piercings_12", PIERCING.silver));
    expect(vanilla.components.filter(item => item.slot === "piercings").map(item => [item.component, item.chunks])).toEqual([["earring_04", [1, 2]]]);
    const modded = await prepare(piercingRequest("piercings_12", PIERCING.silver), detailFixture({ jewellery: true }));
    const parts = modded.components.filter(item => item.slot === "piercings");
    // The framework's chunk mask on the kept part, and the one filled slot from the item archive, over its own linked mesh.
    expect(parts.map(item => [item.component, item.chunks])).toEqual([["earring_04", [0, 2]], ["slot2", [0]]]);
    const slot = parts.find(item => item.component === "slot2")!;
    expect(slot.geometry.sources[0]!.archive).toBe("fixture_jewellery_a_item.archive");
    // Its chunk takes the shared colour's material from its own mesh: the same layered silver stack as the vanilla part.
    expect(slot.materials[0]!.layered!.setup.depotPath).toBe(P.silverSetup);
    // Switching the colour switches every part together (one mesh appearance for all).
    const black = await prepare(piercingRequest("piercings_12", PIERCING.black), detailFixture({ jewellery: true }));
    expect(black.components.filter(item => item.slot === "piercings").map(item => item.materials[0]!.layered!.setup.depotPath))
      .toEqual([P.blackSetup, P.blackSetup]);
  });
});

describe("creator choices a viewer may try", () => {
  test("the piercing styles are the creator's switcher choices with the colours they drive, in switcher order, without Off; one label each", async () => {
    const cco = await loadMergedCco(detailFixture().installation().graph, "female");
    const { options: choices, notes } = slotChoices(cco.merged.cco, "piercings");
    expect(notes).toEqual([]);
    expect(choices.map(entry => [entry.choice, entry.label])).toEqual([["01", "Style 01"], ["12", "Style 12"]]);
    expect(choices[0]!.definitions).toEqual([{ name: PIERCING.silver, label: "Silver" }, { name: PIERCING.black, label: "Black" }]);
    expect(piercingLabel(cco.merged.cco, "piercings_12", PIERCING.black)).toBe("style 12, black");
    // The record carries them.
    const record = await prepare(DEFAULT_CHARACTER);
    expect(record.choices).toEqual([{ slot: "piercings", options: choices }]);
  });

  test("a tried choice replaces the V's own on its slot, in every group the creator lists it in; one not offered is ignored", async () => {
    const cco = (await loadMergedCco(detailFixture().installation().graph, "female")).merged.cco;
    const own = [{ part: "head" as const, group: "face", option: "piercings_01", app: { hash: depotHash(P.earringApp1), path: P.earringApp1 }, definition: PIERCING.silver },
      { part: "head" as const, group: "TPP", option: "eyes_color", app: { hash: depotHash(P.eyeApp), path: P.eyeApp }, definition: "gradient_blue" }];
    const tried = applyChoiceOverride(own, cco, { slot: "piercings", choice: "12", definition: PIERCING.black })!;
    expect(tried.map(entry => [entry.group, entry.option, entry.definition])).toEqual([["TPP", "eyes_color", "gradient_blue"],
      ["face", "piercings_12", PIERCING.black]]);
    expect(applyChoiceOverride(own, cco, { slot: "piercings", choice: "12", definition: "no_such_colour" })).toBeNull();
    expect(applyChoiceOverride(own, cco, { slot: "piercings", choice: "Common-Off", definition: "None" })).toBeNull();

    const record = await prepare({ ...REQUEST_A, override: { slot: "piercings", choice: "12", definition: PIERCING.black } });
    expect(record.character.override).toEqual({ slot: "piercings", choice: "12", definition: PIERCING.black });
    expect(record.slots.find(slot => slot.slot === "piercings")!.label).toBe("style 12, black");
    // The rest of the V is unchanged by the tried choice.
    const plain = await prepare(REQUEST_A);
    expect(record.components.filter(item => item.slot !== "piercings")).toEqual(plain.components.filter(item => item.slot !== "piercings"));
    const ignored = await prepare({ ...REQUEST_A, override: { slot: "piercings", choice: "77", definition: PIERCING.black } });
    expect(ignored.character.override).toBeUndefined();
    expect(ignored.components).toEqual(plain.components);
  });

  test("a switcher choice naming several options, with a linked follower, resolves through the shared R5 rules (PIPE-42)", () => {
    const appearance = (name: string, uiSlot: string, link: string, linkController: boolean, resource: string, definitions: string[]) => ({ type: "appearance" as const,
      name, uiSlot, link, linkController, hidden: false, enabled: false, index: 0, defaultIndex: 0, localizedName: "", editTags: [], definedBy: "",
      resource: { path: resource, hash: String(depotHash(resource)) }, definitions: definitions.map((definition, index) => ({ name: definition, index, localizedName: "", tags: [], providedBy: "" })) });
    const cco = { label: "t", version: 1, parts: { body: { options: [], groups: [] }, arms: { options: [], groups: [] }, head: {
      options: [
        { type: "switcher" as const, name: "piercings", uiSlot: "piercings", uiSlots: ["piercings_color"], link: "", linkController: false, hidden: false, enabled: true,
          index: 0, defaultIndex: 0, localizedName: "", editTags: [], definedBy: "", options: [{ names: [], index: 0, localizedName: "Common-Off", providedBy: "" },
            { names: ["piercings_01", "piercings_01_nose", "piercings_01_lip"], index: 1, localizedName: "01", providedBy: "" }] },
        // The controller the colour control drives, a linked follower on a creator slot of its own, and a second target it names.
        appearance("piercings_01", "piercings_color", "p", true, "a\\ear.app", ["silver", "gold"]),
        appearance("piercings_01_nose", "piercings_nose", "p", false, "a\\nose.app", ["n_silver", "n_gold"]),
        appearance("piercings_01_lip", "piercings_lip", "", false, "a\\lip.app", ["lip_default"]),
      ], groups: [{ name: "face", options: ["piercings_01", "piercings_01_nose", "piercings_01_lip"] }, { name: "TPP", options: ["piercings_01_nose"] }] } } };
    const { options } = slotChoices(cco, "piercings");
    expect(options).toEqual([{ choice: "01", label: "Style 01", definitions: [{ name: "silver", label: "Silver" }, { name: "gold", label: "Gold" }] }]);
    // The V wore the nose part in an old colour: it is replaced too, since the style switcher owns it.
    const own = [{ part: "head" as const, group: "face", option: "piercings_01_nose", app: { hash: "1", path: null }, definition: "n_silver" }];
    const tried = applyChoiceOverride(own, cco, { slot: "piercings", choice: "01", definition: "gold" })!;
    // Every target of the choice, the follower with its controller's colour index, in every group that lists it.
    expect(tried.map(entry => [entry.group, entry.option, entry.definition])).toEqual([["face", "piercings_01", "gold"], ["face", "piercings_01_nose", "n_gold"],
      ["face", "piercings_01_lip", "lip_default"], ["TPP", "piercings_01_nose", "n_gold"]]);
    // The follower's own creator slot belongs to the piercings, because the style switcher turns it on.
    expect(detailSlotOf(cco).get("piercings_01_nose")).toBe("piercings");
    expect(detailSlotOf(cco).get("piercings_01_lip")).toBe("piercings");
  });

  test("creator names that break the record's rule are left out with a note, never sent to the page (PIPE-40)", () => {
    const cco = { label: "t", version: 1, parts: { body: { options: [], groups: [] }, arms: { options: [], groups: [] }, head: {
      options: [
        { type: "switcher" as const, name: "piercings", uiSlot: "piercings", uiSlots: ["piercings_color"], link: "", linkController: false, hidden: false, enabled: true,
          index: 0, defaultIndex: 0, localizedName: "", editTags: [], definedBy: "", options: [
            { names: ["piercings_(ccxl)"], index: 0, localizedName: "piercings_(ccxl)", providedBy: "" },
            { names: ["long"], index: 1, localizedName: "x".repeat(200), providedBy: "" },
            { names: ["unnamed"], index: 2, localizedName: "", providedBy: "" }] },
        ...[["piercings_(ccxl)", ["a colour with spaces", "y".repeat(200)]], ["long", ["c"]], ["unnamed", ["d"]]].map(([name, definitions]) => ({ type: "appearance" as const,
          name: name as string, uiSlot: "piercings_color", link: "", linkController: false, hidden: false, enabled: false, index: 0, defaultIndex: 0, localizedName: "",
          editTags: [], definedBy: "", resource: { path: "a.app", hash: "1" }, definitions: (definitions as string[]).map((definition, index) =>
            ({ name: definition, index, localizedName: "", tags: [], providedBy: "" })) })),
      ], groups: [{ name: "face", options: ["piercings_(ccxl)", "long", "unnamed"] }] } } };
    const { options, notes } = slotChoices(cco, "piercings");
    expect(options).toEqual([{ choice: "piercings_(ccxl)", label: "Piercings (ccxl)", definitions: [{ name: "a colour with spaces", label: "A colour with spaces" }] }]);
    expect(notes).toHaveLength(3);
    expect(notes.join(" ")).toMatch(/can't offer to try/);
  });

  test("requests: a v3 request may carry a tried choice, parsed strictly with the record's rule; v1 and v2 requests still parse; the same V ignores it", () => {
    const tried = { ...REQUEST_A, override: { slot: "piercings", choice: "12", definition: PIERCING.black } } as CharacterRequest;
    expect(parseCharacterRequest(JSON.parse(JSON.stringify(tried)))).toEqual(tried);
    expect(parseCharacterRequest({ ...DEFAULT_CHARACTER, override: tried.override })).toEqual({ ...DEFAULT_CHARACTER, override: tried.override });
    expect(() => parseCharacterRequest({ ...tried, override: { ...tried.override, slot: "hair" } })).toThrow("tried choice");
    expect(() => parseCharacterRequest({ ...tried, override: { ...tried.override, choice: "../x" } })).toThrow("tried choice");
    expect(() => parseCharacterRequest({ ...tried, override: { ...tried.override, choice: "x".repeat(200) } })).toThrow("tried choice");
    expect(() => parseCharacterRequest({ ...tried, override: { ...tried.override, extra: 1 } })).toThrow("tried choice");
    // A creator name with parentheses or spaces is an ordinary name.
    expect(parseCharacterRequest({ ...tried, override: { ...tried.override, choice: "piercings_(ccxl)" } })).toMatchObject({ override: { choice: "piercings_(ccxl)" } });
    expect(parseCharacterRequest({ schema: "xfs/character-request-1", source: "default", bodyGender: "female" })).toEqual(DEFAULT_CHARACTER);
    expect(parseCharacterRequest({ schema: "xfs/character-request-2", source: "default", bodyGender: "female" })).toEqual(DEFAULT_CHARACTER);
    expect(() => parseCharacterRequest({ ...tried, schema: "xfs/character-request-2" })).toThrow();
    expect(() => parseCharacterRequest({ ...tried, schema: "xfs/character-request-9" })).toThrow(CharacterRequestVersionError);
    expect(sameCharacter(REQUEST_A, tried)).toBe(true);
    expect(sameCharacter(DEFAULT_CHARACTER, tried)).toBe(false);
  });

  test("a try on the same installation re-plans from the V it already resolved: only the tried slot is resolved and exported (PREV-68)", async () => {
    const cache = new CharacterPreparationCache();
    const calls: string[] = [], logs: string[] = [];
    // The registry hands out one long-lived installation while the mod setup is unchanged (installation-registry.ts).
    let acquired = 0;
    const installation = detailFixture().installation();
    const run = (request: CharacterRequest) => prepareCharacterDetails({ request, route, storeRoot: join(root, "store"), resolverCache: join(root, "resolver"),
      exporter: counting(calls), open: () => { acquired++; return { ...installation }; }, cache, log: line => logs.push(line) }).then(result => result.record);
    const own = await run(REQUEST_A);
    const firstExports = calls.length;
    expect(firstExports).toBeGreaterThan(0);
    calls.length = 0;
    const tried = await run({ ...REQUEST_A, override: { slot: "piercings", choice: "12", definition: PIERCING.black } });
    // The tried style's part is the only thing exported, and the rest of the V is served as it was.
    expect(acquired).toBe(2);
    expect(cache.installation?.depot).toBe(installation.depot);
    expect(calls.every(call => /earring|black|plastic|mask|mltemplate|mlsetup|xbm/i.test(call))).toBe(true);
    expect(tried.components.filter(item => item.slot !== "piercings")).toEqual(own.components.filter(item => item.slot !== "piercings"));
    expect(logs.at(-1)).toMatch(/Prepared a tried choice in [0-9.]+ s: .*; \d+ appearance\(s\) and 7 of 8 part\(s\) reused\./);
    // Back to the V's own: nothing to export, and the same record as before.
    calls.length = 0;
    const again = await run(REQUEST_A);
    expect(calls).toEqual([]);
    expect(again).toEqual(own);
    // Another installation (the mod setup changed, so the registry opened it again) starts the derived cache afresh.
    const changed = detailFixture().installation();
    await prepareCharacterDetails({ request: REQUEST_A, route, storeRoot: join(root, "store"), resolverCache: join(root, "resolver"),
      exporter: counting(calls), open: () => changed, cache });
    expect(cache.installation?.depot).toBe(changed.depot);
    expect(calls.length).toBeGreaterThan(0);
  });
});
