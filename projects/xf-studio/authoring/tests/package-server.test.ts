import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPackageHandler, localEyePlate, localPackageAdapter, localPackageTools, localPlateRouteKey, packageRequestSettings, SETUP_UNREADABLE_MESSAGE,
  type PackageTools } from "../src/package-server";
import type { BuilderRun, HostPrerequisite, PackageHostAdapter } from "../src/platform/export/product-host";
import type { PackageCheckResult } from "../src/platform/api";
import { STUDIO_EXPORTERS } from "../src/compose/exporters";
import { EYE_PLATE_PREREQUISITE } from "../src/features/eye-makeup";
import { LocalSettingsStore } from "../src/local-settings-store";
import { defaultLocalSettings } from "../src/local-settings";
import { contentFingerprint, EyePlateCache } from "../src/eye-plate-cache";
import { EYE_PLATE_MANIFEST_SCHEMA } from "../src/eye-plate-service";
import { EYE_PLATE_RECIPE } from "../src/eye-plate-recipe";
import { OFF_PLATE_REASON, PLATE_REACH_UNCHECKED_NOTE } from "../src/package-filter";
import { PLATE_UV_FILE, plateReachInput, plateUvManifestRecord } from "../src/plate-uv-footprint-io";
import { withGlitterKnob } from "./glitter-knob-fixture";
import { preparePackageCollection } from "./fixtures/eye-exporter";
import { FOOTPRINT } from "./fixtures/product-fixture";

const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const url = "http://127.0.0.1:4317/api/package";
const request = (body: unknown, origin = "http://127.0.0.1:4317") => new Request(url, {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
/** Localhost's real adapter (real Check worker and exporters) with a stand-in builder and no Build issue unless asked. */
function adapter(options: { tools?: PackageTools; run?: (args: readonly string[]) => Promise<BuilderRun>; issue?: string | null;
  prerequisites?: (tools: PackageTools) => Record<string, HostPrerequisite> } = {}): PackageHostAdapter {
  const base = localPackageAdapter({ exporters: STUDIO_EXPORTERS, tools: options.tools ?? localPackageTools(defaultLocalSettings(), {}),
    prerequisites: options.prerequisites ?? (() => ({})) });
  return { ...base, buildIssue: () => options.issue ?? null,
    runBuilder: args => options.run?.(args) ?? Promise.resolve({ exitCode: 1, stdout: "", stderr: "no builder", stopped: null }) };
}
const eyes = (result: PackageCheckResult) => result.products[0].features[0];

test("package boundary accepts only same-origin validated collection snapshots and ignores browser paths", async () => {
  const handler = createPackageHandler(() => adapter());
  expect((await handler(request({ action: "check", collection: fixture }, "https://other.example"))).status).toBe(403);
  expect((await handler(request({ action: "check", collection: fixture, outputRoot: "F:/Games/Cyberpunk 2077" }))).status).toBe(400);
  expect((await handler(request({ action: "check", collection: { ...fixture, presets: [] } }))).status).toBe(422);
  expect((await handler(new Request(url, { method: "POST", headers: { Origin: url.replace("/api/package", ""),
    "Content-Type": "application/json", "Content-Length": "16000001" }, body: "{}" }))).status).toBe(413);
  const valid = await handler(request({ action: "check", collection: fixture }));
  expect(valid.status).toBe(200);
  const result = await valid.json() as PackageCheckResult;
  expect(result.products.map(product => [product.modName, product.archive])).toEqual([["XF Eye Artistry", preparePackageCollection(fixture).plan.namespace]]);
});

test("a running package build blocks a second build without blocking the HTTP event loop", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const prerequisite: HostPrerequisite = { cached: () => null, async prepare() { await gate; throw Object.assign(Error("Simulated plate failure"), { code: "plate_source_missing" }); },
    discard() {} };
  const handler = createPackageHandler(() => adapter({ prerequisites: () => ({ [EYE_PLATE_PREREQUISITE]: prerequisite }) }));
  const first = handler(request({ action: "build", collection: fixture }));
  await new Promise(done => setTimeout(done, 20));
  const second = await handler(request({ action: "build", collection: fixture }));
  expect(second.status).toBe(409);
  // Check still runs while a Build waits.
  expect((await handler(request({ action: "check", collection: fixture }))).status).toBe(200);
  release();
  const result = await first;
  expect(result.status).toBe(422);
  expect(await result.json()).toEqual({ code: "plate_source_missing", error: "Simulated plate failure" });
});

test("real local Check omits unsupported active layers and identifies them, from an immutable request snapshot", async () => {
  const handler = createPackageHandler(() => adapter());
  const unsupported = structuredClone(fixture);
  unsupported.presets[0].recipe.layers[0].finish = "glitter";
  unsupported.presets[0].recipe.layers.push({ ...structuredClone(unsupported.presets[2].recipe.layers[0]), id: "supported-extra" });
  const checked = await handler(request({ action: "check", collection: unsupported }));
  expect(checked.status).toBe(200);
  const response = eyes(await checked.json());
  expect(response.presets).toHaveLength(4);
  expect(response.omissions).toEqual([expect.objectContaining({ kind: "layer", presetName: "Verification — metallic copy",
    layerName: "Petal wash", finish: "glitter" })]);
  const partial = structuredClone(fixture);
  partial.presets[0].recipe.layers[0].finish = "glitter";
  partial.presets[1].recipe.layers[0].finish = "shimmer";
  const whole = await (await handler(request({ action: "check", collection: partial }))).json() as PackageCheckResult, result = eyes(whole);
  expect(result.omissions.filter(item => item.kind === "layer")).toHaveLength(2);
  // Looks nothing is packaged of are left out whole, in the result (PIPE-88).
  expect(whole.omissions.filter(item => item.kind === "preset")).toHaveLength(2);
  expect(result.presets.map(preset => preset.id)).toEqual(partial.presets.slice(2).map((preset: { id: string }) => preset.id));
  expect(partial.presets[0].recipe.layers[0].finish).toBe("glitter");
});

test("inactive and transparent experimental layers keep the current compiler eligibility", async () => {
  const collection = structuredClone(fixture);
  collection.presets[0].recipe.layers[0].finish = "glitter";
  collection.presets[0].recipe.layers[0].enabled = false;
  collection.presets[1].recipe.layers[0].finish = "shimmer";
  collection.presets[1].recipe.layers[0].opacity = 0;
  const response = await createPackageHandler(() => adapter())(request({ action: "check", collection }));
  expect(response.status).toBe(200);
  expect(eyes(await response.json()).omissions.every(item => item.kind === "preset")).toBe(true);
});

test("check and build both refuse a wholly unsupported collection before any builder runs", async () => {
  let runs = 0;
  const handler = createPackageHandler(() => adapter({ run: async () => { runs++; return { exitCode: 0, stdout: "", stderr: "", stopped: null }; } }));
  const collection = structuredClone(fixture);
  for (const preset of collection.presets) for (const layer of preset.recipe.layers)
    if (layer.enabled && layer.opacity > 0) layer.finish = "glitter";
  for (const action of ["check", "build"] as const) {
    const response = await handler(request({ action, collection }));
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("no_exportable_content");
  }
  expect(runs).toBe(0);
});

test("the package server resolves local settings for each request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "xfs-package-settings-"));
  try {
    const store = new LocalSettingsStore(directory);
    const seen: string[] = [];
    const handler = createPackageHandler(() => {
      const tools = localPackageTools(store.load().settings, {});
      seen.push(tools.gamepath);
      return localPackageAdapter({ exporters: STUDIO_EXPORTERS, tools, prerequisites: () => ({}) });
    });
    const first = store.save({ ...defaultLocalSettings(), gameRoot: join(directory, "game-a") }, 0);
    const refused = await handler(request({ action: "build", collection: fixture }));
    expect(refused.status).toBe(503);
    expect((await refused.json()).error).toContain("WolvenKit isn't set up yet");
    expect(seen.at(-1)).toBe(first.gameRoot!);
    const second = store.save({ ...first, gameRoot: join(directory, "game-b") }, 1);
    await handler(request({ action: "build", collection: fixture }));
    expect(seen.at(-1)).toBe(second.gameRoot!);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("PIPE-33: Check plans on the plate the cache last prepared for this game, route and head choice", async () => {
  const directory = mkdtempSync(join(tmpdir(), "xfs-package-plate-reach-"));
  try {
    // A prepared plate in the private cache: its status, manifest and UV footprint (a synthetic plate over the lids).
    const cacheRoot = join(directory, "cache"), game = join(directory, "game"), name = "xfs-expanded-eye-plate-r1-fixture";
    mkdirSync(join(cacheRoot, name), { recursive: true });
    writeFileSync(join(cacheRoot, name, "plate-manifest.json"), JSON.stringify({ schema: EYE_PLATE_MANIFEST_SCHEMA, recipeId: EYE_PLATE_RECIPE.id,
      recipeRevision: EYE_PLATE_RECIPE.revision, uv: plateUvManifestRecord(FOOTPRINT) }));
    writeFileSync(join(cacheRoot, name, PLATE_UV_FILE), JSON.stringify(FOOTPRINT));
    const tools = { ...localPackageTools(defaultLocalSettings(), {}), plateCache: cacheRoot, gamepath: game };
    new EyePlateCache(cacheRoot).writeStatus({ recipeId: EYE_PLATE_RECIPE.id, recipeRevision: EYE_PLATE_RECIPE.revision, state: "ready",
      code: null, message: "ready", gameRoot: game, contentFingerprint: contentFingerprint(game, EYE_PLATE_RECIPE.source.archiveDirectory),
      cacheName: name, routeKey: localPlateRouteKey(tools) });
    const collection = structuredClone(fixture);
    for (const layer of collection.presets[1].recipe.layers) layer.points = layer.points.map((p: { v: number }) => ({ ...p, v: p.v + .4 }));
    const checked = async (current: PackageTools) => await (await createPackageHandler(() =>
      adapter({ tools: current, prerequisites: t => ({ [EYE_PLATE_PREREQUISITE]: localEyePlate(t) }) }))(request({ action: "check", collection }))).json() as PackageCheckResult;
    const check = async (current: PackageTools) => eyes(await checked(current));
    // The look that misses the plate is left out whole, in the result (PIPE-88).
    expect((await checked(tools)).omissions).toEqual([{ kind: "preset", presetId: collection.presets[1].id, presetName: collection.presets[1].name,
      reason: OFF_PLATE_REASON }]);
    const result = await check(tools);
    expect(result.omissions).toEqual([]);
    expect((result.details.plateUv as { footprintSha256: string }).footprintSha256).toBe(plateReachInput(FOOTPRINT).sha256);
    expect(result.notes).toEqual([]);
    // Another game folder, an MO2 route or the other head choice has no prepared plate yet: Check plans on none and says so.
    for (const changed of [{ ...tools, gamepath: join(directory, "other") },
      { ...tools, route: { launchRoute: "mo2" as const, mo2Root: join(directory, "mo2"), mo2ProfileId: "Default", manualModRoot: null } },
      { ...tools, headOverride: "base-game" as const }]) {
      const blind = await check(changed);
      expect(blind.omissions).toEqual([]);
      expect(blind.details.plateUv).toBeNull();
      expect(blind.notes).toEqual([PLATE_REACH_UNCHECKED_NOTE]); // the Studio says so plainly
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("PIPE-70: a posted collection's glitter knob gives no glitter route and no diagnostics on localhost", async () => {
  const knob = withGlitterKnob(fixture);
  // Precondition: the knob is valid, so only the host's own handling keeps it from the route.
  expect(preparePackageCollection(knob).plan.presets.some(p => p.route === "glitter")).toBe(true);
  const checked = await createPackageHandler(() => adapter())(request({ action: "check", collection: knob }));
  expect(checked.status).toBe(200);
  const summary = eyes(await checked.json());
  expect(summary.presets.map(p => p.route)).not.toContain("glitter");
  expect(summary.presets.every(p => !("diagnostics" in p))).toBe(true);
  expect(summary.details.plateLiftsMm).toEqual([.4]);
  // Build: the snapshot handed to the builder carries no knob, and the host adds no --diagnostics.
  let snapshot: Record<string, unknown> | undefined, args: readonly string[] = [];
  const plate: HostPrerequisite = { cached: () => null, discard() {},
    prepare: async () => ({ builder: { directory: "unused" }, plan: plateReachInput(FOOTPRINT) }) };
  const building = createPackageHandler(() => adapter({ prerequisites: () => ({ [EYE_PLATE_PREREQUISITE]: plate }), run: async given => {
    args = given; snapshot = JSON.parse(readFileSync(given[given.indexOf("--collection") + 1], "utf8"));
    return { exitCode: 1, stdout: "", stderr: "stop after reading the snapshot", stopped: null };
  } }));
  expect((await building(request({ action: "build", collection: knob }))).status).toBe(422);
  expect(snapshot && Object.keys(snapshot)).not.toContain("diagnostics");
  expect(args).not.toContain("--diagnostics");
  expect(readFileSync(resolve(import.meta.dir, "../src/package-server.ts"), "utf8")).not.toContain("--diagnostics");
});

test("unreadable Local setup: Check still answers with the defaults, Build answers a plain JSON refusal (PIPE-94)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-package-settings-"));
  try {
    const store = new LocalSettingsStore(dir);
    writeFileSync(store.file, "{ damaged");
    writeFileSync(store.backup, "{ damaged too");
    expect(() => store.load()).toThrow("unreadable");
    // As server.ts makes it: the adapter reads the settings for each request.
    const handler = createPackageHandler(action => adapter({ tools: localPackageTools(packageRequestSettings(() => store.load().settings, action), {}) }));
    const check = await handler(request({ action: "check", collection: fixture }));
    expect(check.status).toBe(200);
    expect((await check.json() as PackageCheckResult).products[0].modName).toBe("XF Eye Artistry");
    const build = await handler(request({ action: "build", collection: fixture }));
    expect(build.status).toBe(503);
    expect(build.headers.get("Content-Type")).toContain("application/json");
    expect(await build.json()).toEqual({ code: "package_setup_unreadable", error: SETUP_UNREADABLE_MESSAGE });
    // Any other failure to make the adapter is a JSON refusal too, never a bare server error.
    const broken = await createPackageHandler(() => { throw Error("boom"); })(request({ action: "check", collection: fixture }));
    expect(broken.status).toBe(503);
    expect(await broken.json()).toMatchObject({ code: "package_setup_unavailable" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
