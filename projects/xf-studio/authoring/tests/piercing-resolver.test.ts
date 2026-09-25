import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChoiceOverride, piercingLabel, slotChoices } from "../src/character-detail-plan";
import { DEFAULT_CHARACTER, parseCharacterRequest, sameCharacter, type CharacterRequest } from "../src/character-detail-request";
import { prepareCharacterDetails } from "../src/character-detail-service";
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
  test("the piercing styles are the creator's options on the slot, in switcher order, without Off", async () => {
    const cco = await loadMergedCco(detailFixture().installation().graph, "female");
    const choices = slotChoices(cco.merged.cco, "piercings");
    expect(choices.map(entry => [entry.option, entry.index])).toEqual([["piercings_01", 1], ["piercings_12", 2]]);
    expect(choices[0]!.definitions.map(entry => entry.name)).toEqual([PIERCING.silver, PIERCING.black]);
    expect(piercingLabel(cco.merged.cco, "piercings_12", PIERCING.black)).toBe("style 12, black");
    // The record carries them.
    const record = await prepare(DEFAULT_CHARACTER);
    expect(record.choices).toEqual([{ slot: "piercings", options: choices }]);
  });

  test("a tried choice replaces the V's own on its slot, in every group the creator lists it in; one not offered is ignored", async () => {
    const cco = (await loadMergedCco(detailFixture().installation().graph, "female")).merged.cco;
    const own = [{ part: "head" as const, group: "face", option: "piercings_01", app: { hash: depotHash(P.earringApp1), path: P.earringApp1 }, definition: PIERCING.silver },
      { part: "head" as const, group: "TPP", option: "eyes_color", app: { hash: depotHash(P.eyeApp), path: P.eyeApp }, definition: "gradient_blue" }];
    const tried = applyChoiceOverride(own, cco, { slot: "piercings", option: "piercings_12", definition: PIERCING.black })!;
    expect(tried.map(entry => [entry.group, entry.option, entry.definition])).toEqual([["TPP", "eyes_color", "gradient_blue"],
      ["face", "piercings_12", PIERCING.black]]);
    expect(applyChoiceOverride(own, cco, { slot: "piercings", option: "piercings_12", definition: "no_such_colour" })).toBeNull();
    expect(applyChoiceOverride(own, cco, { slot: "piercings", option: "piercings_00", definition: "None" })).toBeNull();

    const record = await prepare({ ...REQUEST_A, override: { slot: "piercings", option: "piercings_12", definition: PIERCING.black } });
    expect(record.character.override).toEqual({ slot: "piercings", option: "piercings_12", definition: PIERCING.black });
    expect(record.slots.find(slot => slot.slot === "piercings")!.label).toBe("style 12, black");
    // The rest of the V is unchanged by the tried choice.
    const plain = await prepare(REQUEST_A);
    expect(record.components.filter(item => item.slot !== "piercings")).toEqual(plain.components.filter(item => item.slot !== "piercings"));
    const ignored = await prepare({ ...REQUEST_A, override: { slot: "piercings", option: "piercings_77", definition: PIERCING.black } });
    expect(ignored.character.override).toBeUndefined();
    expect(ignored.components).toEqual(plain.components);
  });

  test("requests: a v2 request may carry a tried choice, parsed strictly; a v1 request still parses; the same V ignores the tried choice", () => {
    const tried = { ...REQUEST_A, override: { slot: "piercings", option: "piercings_12", definition: PIERCING.black } } as CharacterRequest;
    expect(parseCharacterRequest(JSON.parse(JSON.stringify(tried)))).toEqual(tried);
    expect(parseCharacterRequest({ ...DEFAULT_CHARACTER, override: tried.override })).toEqual({ ...DEFAULT_CHARACTER, override: tried.override });
    expect(() => parseCharacterRequest({ ...tried, override: { ...tried.override, slot: "hair" } })).toThrow("tried choice");
    expect(() => parseCharacterRequest({ ...tried, override: { ...tried.override, option: "../x" } })).toThrow("tried option");
    expect(() => parseCharacterRequest({ ...tried, override: { ...tried.override, extra: 1 } })).toThrow("tried choice");
    expect(parseCharacterRequest({ schema: "xfs/character-request-1", source: "default", bodyGender: "female" })).toEqual(DEFAULT_CHARACTER);
    expect(() => parseCharacterRequest({ ...tried, schema: "xfs/character-request-1" })).toThrow();
    expect(sameCharacter(REQUEST_A, tried)).toBe(true);
    expect(sameCharacter(DEFAULT_CHARACTER, tried)).toBe(false);
  });
});
