import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCatalogue, readCcoWithPresentation } from "../src/cc-catalogue";
import { type CcoResource } from "../src/cco-model";
import { type CharacterChoice, type CharacterSource, deriveCharacter } from "../src/character-context";
import { detailSlotOf, piercingLabel } from "../src/character-detail-plan";
import { CharacterRequestVersionError, DEFAULT_CHARACTER, parseCharacterRequest, sameCharacter, savedOfRequest, type CharacterRequest } from "../src/character-detail-request";
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
/** The fixture's creator catalogue, as the host's catalogue service builds it (without texts or TweakDB). */
async function sourceOf(graph: ReturnType<ReturnType<typeof detailFixture>["installation"]>["graph"]): Promise<CharacterSource> {
  const merged = await loadMergedCco(graph, "female", readCcoWithPresentation);
  return { catalogue: buildCatalogue({ bodyGender: "female", cco: merged.merged.cco, customs: [], text: null, presentation: null }), cco: merged.merged.cco };
}
/** The host's derivation of a request's choices (cc-catalogue-service.ts `inputFor`), over a fixture source. */
const deriver = (source?: CharacterSource) => source ? async (request: CharacterRequest) => {
  const saved = savedOfRequest(request);
  const { request: derived } = deriveCharacter(source, saved ? { kind: "save", saved } : { kind: "default" }, request.choices ?? []);
  return { bodyGender: request.bodyGender, origin: "save" as const, appearances: derived.appearances.filter(a => a.part === "head"), morphs: derived.morphs.filter(m => m.part === "head") };
} : undefined;
const prepare = (request: CharacterRequest, fixture = detailFixture(), source?: CharacterSource) => prepareCharacterDetails({ request, route, storeRoot: join(root, "store"),
  resolverCache: join(root, "resolver"), exporter: exporter(), open: () => fixture.installation(), derive: deriver(source) }).then(result => result.record);

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

describe("creator choices on the piercings", () => {
  test("a piercing reads as the creator's style and its colour; the record lists no choices to try (PIPE-82)", async () => {
    const cco = await loadMergedCco(detailFixture().installation().graph, "female");
    expect(piercingLabel(cco.merged.cco, "piercings_12", PIERCING.black)).toBe("style 12, black");
    const record = await prepare(DEFAULT_CHARACTER);
    expect("choices" in record).toBe(false);
  });

  test("a piercing chosen in the context replaces the V's own on its slot, in every group the creator lists it in; one not offered is reported", async () => {
    const fixture = detailFixture(), source = await sourceOf(fixture.installation().graph);
    const choices: CharacterChoice[] = [{ part: "head", option: "piercings", choice: "12" }, { part: "head", option: "piercings_12", choice: PIERCING.black }];
    const record = await prepare({ ...REQUEST_A, choices }, fixture, source);
    expect(record.slots.find(slot => slot.slot === "piercings")!.label).toBe("style 12, black");
    // The rest of the V is unchanged by the choice.
    const plain = await prepare(REQUEST_A, fixture);
    expect(record.components.filter(item => item.slot !== "piercings")).toEqual(plain.components.filter(item => item.slot !== "piercings"));
    // A style the installation doesn't offer changes nothing and is reported.
    const derived = deriveCharacter(source, { kind: "save", saved: savedOfRequest(REQUEST_A)! }, [{ part: "head", option: "piercings", choice: "77" }]);
    expect(derived.view.missing.entries.filter(entry => entry.from === "choice")).toEqual([{ part: "head", option: "piercings", choice: "77", mod: null, reason: "choice-missing", from: "choice" }]);
    const ignored = await prepare({ ...REQUEST_A, choices: [{ part: "head", option: "piercings", choice: "77" }] }, fixture, source);
    expect(ignored.components).toEqual(plain.components);
  });

  test("a switcher choice naming several options, with a linked follower, resolves through the shared R5 rules (PIPE-42, PIPE-65)", () => {
    const appearance = (name: string, uiSlot: string, link: string, linkController: boolean, resource: string, definitions: string[]) => ({ type: "appearance" as const,
      name, uiSlot, link, linkController, hidden: false, enabled: false, index: 0, defaultIndex: 0, localizedName: "", editTags: ["NewGame"], definedBy: "base game",
      resource: { path: resource, hash: String(depotHash(resource)) }, definitions: definitions.map((definition, index) => ({ name: definition, index, localizedName: "", tags: [], providedBy: "base game" })) });
    const cco: CcoResource = { label: "t", version: 1, parts: { body: { options: [], groups: [] }, arms: { options: [], groups: [] }, head: {
      options: [
        { type: "switcher" as const, name: "piercings", uiSlot: "piercings", uiSlots: ["piercings_color"], link: "", linkController: false, hidden: false, enabled: true,
          index: 0, defaultIndex: 0, localizedName: "", editTags: ["NewGame"], definedBy: "base game", options: [{ names: [], index: 0, localizedName: "Common-Off", providedBy: "base game" },
            // A same-named choice that drives nothing comes first: a match by name alone would take it (PIPE-65).
            { names: [], index: 1, localizedName: "01", providedBy: "base game" },
            { names: ["piercings_01", "piercings_01_nose", "piercings_01_lip"], index: 2, localizedName: "01", providedBy: "base game" }] },
        // The controller the colour control drives, a linked follower on a creator slot of its own, and a second target it names.
        appearance("piercings_01", "piercings_color", "p", true, "a\\ear.app", ["silver", "gold"]),
        appearance("piercings_01_nose", "piercings_nose", "p", false, "a\\nose.app", ["n_silver", "n_gold"]),
        appearance("piercings_01_lip", "piercings_lip", "", false, "a\\lip.app", ["lip_default"]),
      ], groups: [{ name: "face", options: ["piercings_01", "piercings_01_nose", "piercings_01_lip"] }, { name: "TPP", options: ["piercings_01_nose"] }] } } };
    const catalogue = buildCatalogue({ bodyGender: "female", cco, customs: [], text: null, presentation: null });
    const source: CharacterSource = { catalogue, cco };
    // The V wore the nose part in an old colour: the choice replaces it too, since the style switcher owns it.
    const saved = { appearances: [{ part: "head" as const, group: "face", option: "piercings_01_nose", app: "1", definition: "n_silver" }], morphs: [] };
    const { request } = deriveCharacter(source, { kind: "save", saved }, [{ part: "head", option: "piercings", choice: "01", activates: ["piercings_01", "piercings_01_nose", "piercings_01_lip"] },
      { part: "head", option: "piercings_01", choice: "gold" }]);
    // Every target of the choice, the follower with its controller's colour index, in every group that lists it; the saved nose part is gone.
    expect(request.appearances.map(entry => [entry.group, entry.option, entry.definition])).toEqual([["face", "piercings_01", "gold"], ["face", "piercings_01_nose", "n_gold"],
      ["face", "piercings_01_lip", "lip_default"], ["TPP", "piercings_01_nose", "n_gold"]]);
    // The follower's own creator slot belongs to the piercings, because the style switcher turns it on.
    expect(detailSlotOf(cco).get("piercings_01_nose")).toBe("piercings");
    expect(detailSlotOf(cco).get("piercings_01_lip")).toBe("piercings");
  });

  test("requests: v4 carries the creator choices, parsed strictly; v1–v3 requests without a tried choice still parse; the same V ignores choices", () => {
    const choices: CharacterChoice[] = [{ part: "head", option: "piercings", choice: "12" }, { part: "head", option: "piercings_12", choice: PIERCING.black }];
    const chosen: CharacterRequest = { ...REQUEST_A, choices };
    expect(parseCharacterRequest(JSON.parse(JSON.stringify(chosen)))).toEqual(chosen);
    expect(parseCharacterRequest({ ...DEFAULT_CHARACTER, choices })).toEqual({ ...DEFAULT_CHARACTER, choices });
    expect(() => parseCharacterRequest({ ...chosen, choices: [{ ...choices[0], extra: 1 }] })).toThrow("creator choice");
    // The shared name rule (PIPE-79): 255 characters pass, a longer name is refused.
    expect(parseCharacterRequest({ ...chosen, choices: [{ ...choices[0], option: "x".repeat(255) }] }).choices![0]!.option).toHaveLength(255);
    expect(() => parseCharacterRequest({ ...chosen, choices: [{ ...choices[0], option: "x".repeat(256) }] })).toThrow("creator choice");
    // A creator name with parentheses or spaces is an ordinary name.
    expect(parseCharacterRequest({ ...chosen, choices: [{ ...choices[0], choice: "piercings_(ccxl) 2" }] })).toMatchObject({ choices: [{ choice: "piercings_(ccxl) 2" }] });
    expect(parseCharacterRequest({ schema: "xfs/character-request-1", source: "default", bodyGender: "female" })).toEqual(DEFAULT_CHARACTER);
    expect(parseCharacterRequest({ schema: "xfs/character-request-3", source: "default", bodyGender: "female" })).toEqual(DEFAULT_CHARACTER);
    // A v3 page's tried choice, or choices on an earlier version, is a page built apart from this host.
    expect(() => parseCharacterRequest({ ...DEFAULT_CHARACTER, schema: "xfs/character-request-3", override: { slot: "piercings", choice: "12", definition: PIERCING.black } })).toThrow();
    expect(() => parseCharacterRequest({ ...chosen, schema: "xfs/character-request-2" })).toThrow();
    expect(() => parseCharacterRequest({ ...chosen, schema: "xfs/character-request-9" })).toThrow(CharacterRequestVersionError);
    expect(sameCharacter(REQUEST_A, chosen)).toBe(true);
    expect(sameCharacter(DEFAULT_CHARACTER, chosen)).toBe(false);
  });

  test("a changed choice on the same installation re-plans from the V it already resolved: only the changed slot is resolved and exported (PREV-68)", async () => {
    const cache = new CharacterPreparationCache();
    const calls: string[] = [], logs: string[] = [];
    // The registry hands out one long-lived installation while the mod setup is unchanged (installation-registry.ts).
    let acquired = 0;
    const installation = detailFixture().installation();
    const run = (request: CharacterRequest, source?: CharacterSource) => prepareCharacterDetails({ request, route, storeRoot: join(root, "store"), resolverCache: join(root, "resolver"),
      exporter: counting(calls), open: () => { acquired++; return { ...installation }; }, cache, log: line => logs.push(line), derive: deriver(source) }).then(result => result.record);
    const own = await run(REQUEST_A);
    const firstExports = calls.length;
    expect(firstExports).toBeGreaterThan(0);
    calls.length = 0;
    const source = await sourceOf(installation.graph);
    const tried = await run({ ...REQUEST_A, choices: [{ part: "head", option: "piercings", choice: "12" }, { part: "head", option: "piercings_12", choice: PIERCING.black }] }, source);
    // The tried style's part is the only thing exported, and the rest of the V is served as it was.
    expect(acquired).toBe(2);
    expect(cache.installation?.depot).toBe(installation.depot);
    expect(calls.every(call => /earring|black|plastic|mask|mltemplate|mlsetup|xbm/i.test(call))).toBe(true);
    expect(tried.components.filter(item => item.slot !== "piercings")).toEqual(own.components.filter(item => item.slot !== "piercings"));
    expect(logs.at(-1)).toMatch(/Prepared the V with 2 creator choice\(s\) in [0-9.]+ s: .*; \d+ appearance\(s\) and 7 of 8 part\(s\) reused\./);
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
