// The creator catalogue on the host (cc-catalogue-service.ts, cc-catalogue-server.ts), the text and TweakDB readers it relies on, and
// degraded preparations, over the asset-free fixtures (no game file, save or real mod name).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CreatorCatalogueHost } from "../src/cc-catalogue-service";
import { createCreatorHandler } from "../src/cc-catalogue-server";
import { gameSettingsPath } from "../src/cc-catalogue-host";
import { CC_PRESET_SCHEMA } from "../src/cc-preset";
import { CHARACTER_REQUEST_SCHEMA, DEFAULT_CHARACTER, type CharacterRequest } from "../src/character-detail-request";
import { CharacterDetailHost, type CharacterDetailSettings } from "../src/character-detail-host";
import { CharacterPreparationCache, prepareCharacterDetails } from "../src/character-detail-service";
import { depotHash, fnv1a64 } from "../src/depot-path";
import type { ExportedGeometry, ExportedMask, ExportedTexture, GameAssetExporter } from "../src/game-asset-export";
import { fnv1a32, gameLanguageOf, TextTable, textPlan } from "../src/game-text";
import { personalDataIn } from "../src/private-data";
import { encodePng } from "../src/png";
import { TweakDbBlob, TWEAKDB_MAGIC, tweakDbId } from "../src/tweakdb-flats";
import { fixtureSource, MOD_NAME } from "./cc-fixtures";
import { detailFixture, REQUEST_A } from "./character-detail-fixtures";
import PRIVATE from "../../../../tools/private-data.json";

const root = mkdtempSync(join(tmpdir(), "xfs-creator-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A catalogue service over the fixture creator, counting its builds. */
async function service(options: { fingerprint?: () => string; route?: boolean } = {}) {
  const source = await fixtureSource(true);
  let builds = 0;
  const host = new CreatorCatalogueHost({ route: () => options.route === false ? null : { gameRoot: root, launchRoute: "direct", wolvenKitCli: "wk" },
    fingerprint: options.fingerprint ?? (() => "one"), resolverCache: join(root, "resolver"), open: () => ({}) as never,
    load: async () => { builds++; return { source, catalogue: source.catalogue, evidence: { language: { code: "en-us", from: "default" }, texts: [], tweakDb: null, customResources: 1 } }; } });
  return { host, builds: () => builds, source };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

describe("the creator catalogue service", () => {
  test("built once per installation and body; the first paint arrives when ready; another installation builds again (UI-59)", async () => {
    let fingerprint = "one";
    const { host, builds } = await service({ fingerprint: () => fingerprint });
    expect(host.state("female")).toEqual({ phase: "preparing", message: "Reading your game's character-creator options…" });
    await settle();
    const ready = host.state("female");
    expect(ready.phase).toBe("ready");
    expect(ready.panel!.options.length).toBeGreaterThan(5);
    host.state("female"); await host.page("female", "head/eyes_color", 0);
    expect(builds()).toBe(1);
    fingerprint = "two";
    expect(host.state("female").phase).toBe("preparing");
    await settle();
    expect(builds()).toBe(2);
    const { host: unset } = await service({ route: false });
    expect(unset.state("female")).toMatchObject({ phase: "failed", message: expect.stringContaining("game folder and WolvenKit") });
  });

  test("the view names each row's current and own choice with labels; the input carries every part, the choices applied", async () => {
    const { host } = await service();
    const request: CharacterRequest = { ...DEFAULT_CHARACTER, choices: [{ part: "head", option: "eyes_color", choice: "he__03_violet" }] };
    const view = await host.view(request);
    expect(view.values["head/eyes_color"]).toEqual({ choice: "he__03_violet", own: "he__01_brown", position: 2, set: true, active: true, label: "Violet", color: "#7828a0", ownLabel: "Brown" });
    expect(view.missing.entries).toEqual([]);
    const input = await host.inputFor({ ...request, choices: [...request.choices!, { part: "head", option: "skin_color", choice: "tone_c" }] });
    // Every part: the preparation keeps what the preview draws (character-detail-plan.ts `previewInput`).
    expect(new Set(input.appearances.map(item => item.part))).toEqual(new Set(["head", "body"]));
    expect(input.appearances.map(item => `${item.option}=${item.definition}`)).toEqual(expect.arrayContaining(["eyes_color=he__03_violet", "skin_type_01=h0__tone_c"]));
  });

  test("a preset leaves out personal folders and addresses in its name and kept data, and counts them (CORE-56)", async () => {
    const { host } = await service();
    const request: CharacterRequest = { ...DEFAULT_CHARACTER, choices: [{ part: "head", option: "eyes_color", choice: "he__03_violet" }] };
    // Built at run time from the shared test vectors, so this file itself holds no personal-looking text.
    const vectors = (PRIVATE as { vectors: { userPath: string[]; email: string[] } }).vectors;
    const saved = await host.preset(request, vectors.userPath[0]!, {
      unknownEntries: [{ at: 0, entry: { part: "head", option: "future", note: `mail ${vectors.email[0]}` } }, { at: 1, entry: { part: "head", option: "kept" } }],
      extra: { from: vectors.userPath[1]!, fine: 1 } });
    expect(saved).toMatchObject({ values: 1, leftOut: 0, personal: 3 });
    expect(personalDataIn(saved.text)).toBeNull();
    const stored = JSON.parse(saved.text);
    expect(stored.name).toBeUndefined();
    expect(stored.fine).toBe(1);
    expect(stored.values).toEqual([expect.objectContaining({ option: "eyes_color", mod: MOD_NAME }), { part: "head", option: "kept" }]);
  });

  test("the shared personal-data patterns flag every vector the repository scan flags, and pass the clean ones", () => {
    const vectors = (PRIVATE as { vectors: { userPath: string[]; email: string[]; clean: string[] } }).vectors;
    for (const text of vectors.userPath) expect(personalDataIn(text), text).toBe("user-path");
    for (const text of vectors.email) expect(personalDataIn(text), text).toBe("email");
    for (const text of vectors.clean) expect(personalDataIn(text), text).toBeNull();
  });

  test("the endpoint: state, pages, views and presets; refusals are coded and plain", async () => {
    const { host } = await service();
    const handler = createCreatorHandler(host);
    const get = (query: string) => handler(new Request(`http://127.0.0.1/api/preview-character/creator?${query}`));
    const post = (body: unknown, origin = "http://127.0.0.1") => handler(new Request("http://127.0.0.1/api/preview-character/creator", { method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) }));
    await get("gender=female"); await settle();
    expect((await (await get("gender=female")).json()).phase).toBe("ready");
    expect((await (await get("gender=female&option=head%2Feyes_color&offset=0")).json()).total).toBe(4);
    expect((await get("gender=female&option=head%2Fneck&offset=0")).status).toBe(404);
    expect((await get("gender=female&option=..%5Cx&offset=0")).status).toBe(400);
    expect((await get("gender=other")).status).toBe(400);
    const view = await post({ kind: "view", request: { ...DEFAULT_CHARACTER, choices: [{ part: "head", option: "eyes_color", choice: "he__02_blue" }] } });
    expect((await view.json()).values["head/eyes_color"].choice).toBe("he__02_blue");
    const preset = await (await post({ kind: "preset", name: "Mine", request: { ...DEFAULT_CHARACTER, choices: [{ part: "head", option: "eyes_color", choice: "he__02_blue" }] },
      kept: { schema: CC_PRESET_SCHEMA, bodyGender: "female", values: [] } })).json();
    expect(JSON.parse(preset.text)).toMatchObject({ schema: CC_PRESET_SCHEMA, name: "Mine" });
    expect((await post({ kind: "view", request: { schema: "xfs/character-request-9", source: "default", bodyGender: "female" } })).status).toBe(409);
    expect((await post({ kind: "view", request: { ...DEFAULT_CHARACTER, choices: [{ part: "head" }] } })).status).toBe(400);
    expect((await post({ kind: "view", request: DEFAULT_CHARACTER }, "http://evil.example")).status).toBe(403);
    expect(CHARACTER_REQUEST_SCHEMA).toBe("xfs/character-request-5");
  });
});

describe("texts, language and TweakDB as the game and ArchiveXL read them", () => {
  const game = { id: "base", kind: "game" as const, declaredBy: null }, mod = { id: "mod.json", kind: "mod" as const, declaredBy: "a.xl" };
  const entry = (primaryKey: string, secondaryKey: string, female: string) => ({ primaryKey, secondaryKey, female, male: "" });

  test("entries are keyed by primary key alone; a secondary-keyed mod entry is added under FNV-1a 32 and 64 of its key (PIPE-47)", () => {
    expect(fnv1a32("a")).toBe(0xe40c292cn);
    const table = new TextTable("en-us").add([entry("100", "UI-Old", "Old"), entry("200", "UI-Kept", "Kept")], game);
    // Same primary key: replaces the whole entry, its secondary key with it.
    table.add([entry("100", "UI-New", "New")], mod);
    expect(table.resolve("LocKey#100")?.text).toBe("New");
    expect(table.resolve("UI-New")?.text).toBe("New");
    expect(table.resolve("UI-Old")).toBeNull();
    // A new entry holding an existing secondary key under another primary key doesn't replace that entry by ID.
    table.add([entry("300", "UI-Kept", "Other")], mod);
    expect(table.resolve("LocKey#200")?.text).toBe("Kept");
    // No primary key: keyed by its secondary key's hashes, and found by the key.
    table.add([entry("0", "XL-Ring", "Ring")], mod);
    expect(table.resolve("XL-Ring")?.text).toBe("Ring");
    expect(table.resolve(`LocKey#${fnv1a32("XL-Ring")}`)?.text).toBe("Ring");
    expect(table.resolve(`LocKey#${fnv1a64(new TextEncoder().encode("XL-Ring"))}`)?.text).toBe("Ring");
    // A unit's fallback language only fills keys that are missing.
    table.add([entry("200", "UI-Kept", "Fallback"), entry("400", "UI-Filled", "Filled")], mod, false);
    expect(table.resolve("LocKey#200")?.text).toBe("Kept");
    expect(table.resolve("UI-Filled")?.text).toBe("Filled");
  });

  test("the text plan: the game's files, then each unit's own language, then its fallback, which only fills in (PIPE-48)", () => {
    const units = [{ onscreens: new Map([["en-us", ["a_en.json"]], ["de-de", ["a_de.json"]]]), fallback: "en-us", declaredBy: "a.xl" },
      { onscreens: new Map([["en-us", ["b_en.json"]]]), fallback: "en-us", declaredBy: "b.xl" }];
    expect(textPlan("de-de", true, units).map(item => `${item.path}${item.replace ? "" : " (fill)"}`)).toEqual([
      "base\\localization\\de-de\\onscreens\\onscreens.json", "ep1\\localization\\de-de\\onscreens\\onscreens.json",
      "a_de.json", "a_en.json (fill)", "b_en.json (fill)"]);
    expect(textPlan("en-us", false, units).map(item => item.path)).toEqual(["base\\localization\\en-us\\onscreens\\onscreens.json", "a_en.json", "b_en.json"]);
    expect(gameLanguageOf({ data: [{ group_name: "/language", options: [{ name: "OnScreen", value: "pl-pl" }] }] })).toBe("pl-pl");
    expect(gameLanguageOf({ data: [{ group_name: "/language", options: [{ name: "OnScreen", value: "../x" }] }] })).toBeNull();
    expect(gameLanguageOf(null)).toBeNull();
  });

  test("an unset or relative LOCALAPPDATA reads no settings file instead of one beside the working folder (PIPE-51)", () => {
    expect(gameSettingsPath(null)).toBeNull();
    expect(gameSettingsPath("")).toBeNull();
    expect(gameSettingsPath("relative\\folder")).toBeNull();
    expect(gameSettingsPath("C:\\Users\\name\\AppData\\Local")).toContain("UserSettings.json");
  });

  test("a crafted TweakDB count is refused before anything is allocated (PIPE-49)", () => {
    const blob = new Uint8Array(64), view = new DataView(blob.buffer);
    view.setUint32(0, TWEAKDB_MAGIC, true); view.setInt32(4, 8, true); view.setInt32(8, 4, true); view.setInt32(16, 32, true);
    view.setUint32(32, 1, true);
    view.setBigUint64(36, fnv1a64(new TextEncoder().encode("CName")), true);
    view.setUint32(44, 0xfffffff0, true); view.setUint32(48, 0, true); view.setUint32(52, 56, true);
    view.setUint32(56, 0xfffffff0, true);
    const tweak = new TweakDbBlob(blob);
    expect(() => tweak.lookup([tweakDbId("A.b")])).toThrow("truncated");
    const table = new Uint8Array(40), tableView = new DataView(table.buffer);
    tableView.setUint32(0, TWEAKDB_MAGIC, true); tableView.setInt32(4, 8, true); tableView.setInt32(8, 4, true); tableView.setInt32(16, 32, true);
    tableView.setUint32(32, 4000, true);
    expect(() => new TweakDbBlob(table)).toThrow("implausibly large");
  });
});

describe("degraded preparations (PIPE-53)", () => {
  const png = encodePng({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) }, { alpha: true });
  function exporter(dir: string): GameAssetExporter {
    mkdirSync(dir, { recursive: true });
    const file = (path: string, ext: string) => { const f = join(dir, `${depotHash(path)}.${ext}`); Bun.write(f, ext === "png" ? png : `glb ${path}`); return f; };
    return { open: () => ({ tool: { key: "t", label: "Test" }, present: () => null, close() {},
      geometry: async paths => new Map(paths.map((p): [string, ExportedGeometry] => [p, { depotPath: p, hash: depotHash(p), raw: "", rawSha256: "", glb: file(p, "glb"),
        glbSha256: "", materials: null, materialsSha256: null, complete: true, cached: false }])),
      textures: async paths => new Map(paths.map((p): [string, ExportedTexture] => [p, { depotPath: p, hash: depotHash(p), png: file(p, "png"), pngSha256: "", cached: false }])),
      masks: async paths => new Map(paths.map((p): [string, ExportedMask] => [p, { depotPath: p, hash: depotHash(p), layers: [file(p, "png")], cached: false }])) }) };
  }

  test("a preparation during which the fetcher failed in a way that may not repeat is degraded, and forgets what it added", async () => {
    const cache = new CharacterPreparationCache(), installation = detailFixture().installation();
    let transient = 0;
    const flaky = { ...installation, fetcher: { ...installation.fetcher, get stats() { return { transient: transient++ }; } } } as typeof installation;
    const prepare = (open: () => typeof installation) => prepareCharacterDetails({ request: REQUEST_A, route: { gameRoot: root, launchRoute: "direct", wolvenKitCli: "wk" },
      storeRoot: join(root, "store"), resolverCache: join(root, "resolver"), exporter: exporter(join(root, "exports")), open, cache });
    const first = await prepare(() => flaky);
    expect(first.degraded).toBe(true);
    expect(cache.components.size).toBe(0);
    expect(cache.appearances.size).toBe(0);
    const second = await prepare(() => installation);
    expect(second.degraded).toBe(false);
    expect(cache.components.size).toBeGreaterThan(0);
  });

  test("the host serves a degraded answer once and prepares it again when asked again", async () => {
    const settings: CharacterDetailSettings = { gameRoot: root, launchRoute: "direct", mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: process.execPath };
    let calls = 0;
    const host = new CharacterDetailHost({ cacheRoot: join(root, "host"), settings: () => settings,
      prepare: async () => ({ record: {} as never, recordFile: `${"c".repeat(64)}.json`, degraded: ++calls === 1 }) });
    const first = host.request(REQUEST_A);
    await host.settled();
    expect(host.state(first.key).phase).toBe("ready");
    host.request(REQUEST_A);
    await host.settled();
    expect(calls).toBe(2);
    // Once a preparation is complete, it is final.
    host.request(REQUEST_A);
    await host.settled();
    expect(calls).toBe(2);
  });
});
