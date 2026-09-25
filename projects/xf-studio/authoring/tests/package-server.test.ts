import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPackageHandler, localPackageTools } from "../src/package-server";
import { packagePresetIdentities, preparePackageCollection } from "../src/package-filter";
import { createHash } from "node:crypto";
import type { PackageAction, PackageCheck } from "../src/package-action";
import { LocalSettingsStore } from "../src/local-settings-store";
import { defaultLocalSettings } from "../src/local-settings";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { EyePlateCache } from "../src/eye-plate-cache";
import { EYE_PLATE_MANIFEST_SCHEMA } from "../src/eye-plate-service";
import { EYE_PLATE_RECIPE } from "../src/eye-plate-recipe";
import { derivePlateDocuments } from "../src/eye-plate-cut";
import { OFF_PLATE_REASON } from "../src/package-filter";
import { preflightPackageCollection } from "../src/package-preflight";
import { PLATE_UV_FILE, plateReachInput, plateUvManifestRecord } from "../src/plate-uv-footprint-io";
import { plateUvFootprint } from "../src/plate-uv-window";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe, plateLikeUv, withPlateUvs } from "./eye-plate-fixture";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const url = "http://127.0.0.1:4317/api/package";
const request = (body: unknown, origin = "http://127.0.0.1:4317") => new Request(url, {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const summary = (collection: unknown = fixture): PackageCheck => {
  const { source, packaged, plan, omissions } = preparePackageCollection(collection);
  return { ready: true, collectionId: plan.collectionId, namespace: plan.namespace,
    modName: plan.modName, selectorLabel: plan.selectorLabel, originalPresetCount: source.presets.length, omissions,
    packagedCollectionSha256: createHash("sha256").update(JSON.stringify(packaged)).digest("hex"),
    presets: packagePresetIdentities(plan), plateLiftsMm: plan.plate.liftsMm };
};

test("package boundary accepts only same-origin validated collection snapshots and ignores browser paths", async () => {
  let calls = 0;
  const handler = createPackageHandler(localPackageTools(), async (_action, file) => {
    calls++; return summary(JSON.parse(readFileSync(file, "utf8")));
  });
  expect((await handler(request({ action: "check", collection: fixture }, "https://other.example"))).status).toBe(403);
  expect((await handler(request({ action: "check", collection: fixture, outputRoot: "F:/Games/Cyberpunk 2077" }))).status).toBe(400);
  expect((await handler(request({ action: "check", collection: { ...fixture, presets: [] } }))).status).toBe(400);
  expect((await handler(new Request(url, { method: "POST", headers: { Origin: url.replace("/api/package", ""),
    "Content-Type": "application/json", "Content-Length": "16000001" }, body: "{}" }))).status).toBe(413);
  const valid = await handler(request({ action: "check", collection: fixture }));
  expect(valid.status).toBe(200);
  expect((await valid.json()).namespace).toBe(summary(fixture).namespace);
  expect(calls).toBe(1);
});

test("a running package build blocks a second build without blocking the HTTP event loop", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const handler = createPackageHandler(localPackageTools(), async (action: PackageAction) => {
    if (action === "build") await gate;
    throw Error("Simulated local tool failure");
  });
  const first = handler(request({ action: "build", collection: fixture }));
  const second = await handler(request({ action: "build", collection: fixture }));
  expect(second.status).toBe(409);
  release();
  const result = await first;
  expect(result.status).toBe(422);
  expect((await result.json()).error).toContain("Simulated local tool failure");
});

test("real local preflight omits unsupported active layers and identifies them", async () => {
  const handler = createPackageHandler();
  const accepted = await handler(request({ action: "check", collection: fixture }));
  expect(accepted.status).toBe(200);
  const unsupported = structuredClone(fixture);
  unsupported.presets[0].recipe.layers[0].finish = "glitter";
  unsupported.presets[0].recipe.layers.push({ ...structuredClone(unsupported.presets[2].recipe.layers[0]), id: "supported-extra" });
  const checked = await handler(request({ action: "check", collection: unsupported }));
  expect(checked.status).toBe(200);
  const response = await checked.json();
  expect(response.presets).toHaveLength(4);
  expect(response.omissions).toEqual([expect.objectContaining({ kind: "layer", presetName: "Verification — metallic copy",
    layerName: "Petal wash", finish: "glitter" })]);
});

test("check derives the filtered plan from an immutable original request snapshot", async () => {
  let calls = 0, captured: unknown;
  const handler = createPackageHandler(localPackageTools(), async (_action, file) => {
    calls++; captured = JSON.parse(readFileSync(file, "utf8")); return summary(captured);
  });
  const unsupported = structuredClone(fixture);
  unsupported.presets[0].recipe.layers[0].finish = "glitter";
  unsupported.presets[1].recipe.layers[0].finish = "shimmer";
  const response = await handler(request({ action: "check", collection: unsupported }));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.omissions).toHaveLength(4);
  expect(result.omissions.filter((item: {kind: string}) => item.kind === "layer")).toHaveLength(2);
  expect(result.omissions.filter((item: {kind: string}) => item.kind === "preset")).toHaveLength(2);
  expect(result.presets).toHaveLength(2);
  expect(result.presets.map((preset: {id: string}) => preset.id)).toEqual(unsupported.presets.slice(2).map((preset: {id: string}) => preset.id));
  expect(calls).toBe(1);
  expect((captured as typeof fixture).presets[0].recipe.layers[0].finish).toBe("glitter");
  expect(unsupported.presets[0].recipe.layers[0].finish).toBe("glitter");
});

test("inactive and transparent experimental layers keep the current compiler eligibility", async () => {
  const handler = createPackageHandler(localPackageTools(), async (_action, file) => summary(JSON.parse(readFileSync(file, "utf8"))));
  const collection = structuredClone(fixture);
  collection.presets[0].recipe.layers[0].finish = "glitter";
  collection.presets[0].recipe.layers[0].enabled = false;
  collection.presets[1].recipe.layers[0].finish = "shimmer";
  collection.presets[1].recipe.layers[0].opacity = 0;
  const response = await handler(request({ action: "check", collection }));
  expect(response.status).toBe(200);
  expect((await response.json()).omissions.every((item: {kind: string}) => item.kind === "preset")).toBe(true);
});

test("check and build both refuse a wholly unsupported collection before invoking tools", async () => {
  let calls = 0;
  const handler = createPackageHandler(localPackageTools(), async () => { calls++; return summary(); });
  const collection = structuredClone(fixture);
  for (const preset of collection.presets) for (const layer of preset.recipe.layers)
    if (layer.enabled && layer.opacity > 0) layer.finish = "glitter";
  for (const action of ["check", "build"] as const) {
    const response = await handler(request({ action, collection }));
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("no_exportable_content");
  }
  expect(calls).toBe(0);
});

test("the package server resolves local settings for each build and leaves Check independent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "xfs-package-settings-"));
  try {
    const store = new LocalSettingsStore(directory);
    let selected = "";
    const handler = createPackageHandler(action => action === "check" ? localPackageTools() :
      localPackageTools(store.load().settings, {}), async (action, file, tools) => {
      if (action === "check") return summary(JSON.parse(readFileSync(file, "utf8")));
      selected = tools.gamepath;
      throw Error("Captured configured build input");
    });
    expect((await handler(request({ action: "check", collection: fixture }))).status).toBe(200);
    const first = store.save({ ...defaultLocalSettings(), gameRoot: join(directory, "game-a") }, 0);
    expect((await handler(request({ action: "build", collection: fixture }))).status).toBe(422);
    expect(selected).toBe(first.gameRoot!);
    const second = store.save({ ...first, gameRoot: join(directory, "game-b") }, 1);
    expect((await handler(request({ action: "build", collection: fixture }))).status).toBe(422);
    expect(selected).toBe(second.gameRoot!);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("PIPE-33: Check plans on the plate the cache last prepared for this game, and the host holds the tool to it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "xfs-package-plate-reach-"));
  try {
    // A prepared plate in the private cache: its status, manifest and UV footprint (a synthetic plate over the lids).
    const cacheRoot = join(directory, "cache"), game = join(directory, "game"), name = "xfs-expanded-eye-plate-r1-fixture";
    const footprint = plateUvFootprint(withPlateUvs(derivePlateDocuments(fixtureHeadMesh(), fixtureHeadMorph(), fixtureRecipe(),
      "a\b.mesh"), plateLikeUv).mesh.Data.RootChunk);
    mkdirSync(join(cacheRoot, name), { recursive: true });
    const manifestFile = join(cacheRoot, name, "plate-manifest.json");
    writeFileSync(manifestFile, JSON.stringify({ schema: EYE_PLATE_MANIFEST_SCHEMA, recipeId: EYE_PLATE_RECIPE.id,
      recipeRevision: EYE_PLATE_RECIPE.revision, uv: plateUvManifestRecord(footprint) }));
    writeFileSync(join(cacheRoot, name, PLATE_UV_FILE), JSON.stringify(footprint));
    new EyePlateCache(cacheRoot).writeStatus({ recipeId: EYE_PLATE_RECIPE.id, recipeRevision: EYE_PLATE_RECIPE.revision, state: "ready",
      code: null, message: "ready", gameRoot: game, contentFingerprint: "", cacheName: name });
    const collection = structuredClone(fixture);
    for (const layer of collection.presets[1].recipe.layers) layer.points = layer.points.map((p: { v: number }) => ({ ...p, v: p.v + .4 }));
    const plate = plateReachInput(footprint);
    let passed: string | undefined;
    const planned = (value: unknown, reach: typeof plate | null) => {
      const { packagedCollectionJson: _json, ...check } = preflightPackageCollection(value, reach);
      return check;
    };
    const tools = { ...localPackageTools(), plateCache: cacheRoot, gamepath: game };
    const handler = createPackageHandler(tools, async (_action, file, actionTools) => {
      passed = actionTools.checkPlateManifest;
      return planned(JSON.parse(readFileSync(file, "utf8")), plate);
    });
    const response = await handler(request({ action: "check", collection }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(passed).toBe(manifestFile);
    expect(result.omissions).toEqual([{ kind: "preset", presetId: collection.presets[1].id, presetName: collection.presets[1].name,
      reason: OFF_PLATE_REASON }]);
    expect(result.plateUv.footprintSha256).toBe(plate.sha256);
    // A tool answer planned on no plate (or another one) is not accepted.
    const blind = createPackageHandler(tools, async (_action, file) => planned(JSON.parse(readFileSync(file, "utf8")), null));
    expect((await blind(request({ action: "check", collection }))).status).toBe(422);
    // Another game folder has no prepared plate yet: Check plans on none.
    const other = createPackageHandler({ ...tools, gamepath: join(directory, "other") }, async (_action, file, actionTools) => {
      passed = actionTools.checkPlateManifest;
      return planned(JSON.parse(readFileSync(file, "utf8")), null);
    });
    const unplanned = await other(request({ action: "check", collection }));
    expect(unplanned.status).toBe(200);
    expect(passed).toBeUndefined();
    expect((await unplanned.json()).omissions).toEqual([]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
