import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createDesktopServer } from "../server";
import { desktopVersionFromMetadata } from "../host";
import { desktopPackageRequest } from "../package";
import { LocalSettingsStore } from "../../src/local-settings-store";
import { createPackageHandler } from "../../src/package-server";

const collectionFixture = JSON.parse(readFileSync(resolve(import.meta.dir,
  "../../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));

const root = mkdtempSync(resolve(tmpdir(), "xfs-desktop-test-"));
const staticRoot = resolve(root, "static");
mkdirSync(resolve(staticRoot, "build"), { recursive: true });
writeFileSync(resolve(staticRoot, "index.html"), "<!doctype html><title>Studio</title>");
writeFileSync(resolve(staticRoot, "build", "raster-worker.js"), "self.postMessage('ready')");
const dataRoot = resolve(root, "data");
const app = createDesktopServer(staticRoot, dataRoot, { version: "0.0.1", channel: "dev", buildHash: "dev", metadataStatus: "ready" });
afterAll(() => { app.stop(); rmSync(root, { recursive: true, force: true }); });

test("session gates static files and narrowly typed host facts", async () => {
  const base = `http://127.0.0.1:${app.port}`;
  expect((await fetch(base)).status).toBe(403);
  const first = await fetch(app.url);
  expect(first.status).toBe(200);
  const cookie = first.headers.get("set-cookie")!.split(";")[0];
  expect(cookie).toStartWith("xfs_session=");
  const headers = { Cookie: cookie };
  expect((await fetch(base + "/build/raster-worker.js", { headers })).status).toBe(200);
  expect((await fetch(base + "/assets/head.glb", { headers })).status).toBe(404);
  expect((await fetch(base + "/%2e%2e/%2e%2e/secret", { headers })).status).toBe(404);
  const response = await fetch(base + "/api/desktop/capabilities", { headers });
  expect(await response.json()).toMatchObject({ schema: "xfs/desktop-capabilities-1", library: true,
    packageCheck: true, packageBuild: false, updater: false, previewAssets: "missing", version: "0.0.1", channel: "dev",
    buildHash: "dev", metadataStatus: "ready", userDataPath: dataRoot });
  const assetRoot = resolve(root, "data", "preview-assets");
  mkdirSync(assetRoot, { recursive: true });
  writeFileSync(resolve(assetRoot, "head.glb"), "local-only fixture");
  expect((await (await fetch(base + "/api/desktop/capabilities", { headers })).json()).previewAssets).toBe("incomplete");
  expect((await fetch(base + "/assets/head.glb", { headers })).status).toBe(200);
});

test("About version never falls back to source metadata when packaged metadata is invalid", () => {
  expect(desktopVersionFromMetadata({ version: "0.1.0", channel: "canary", hash: "abc12345" }))
    .toEqual({ version: "0.1.0", channel: "canary", buildHash: "abc12345", metadataStatus: "ready" });
  expect(desktopVersionFromMetadata({ version: "0.1.0", channel: "canary" }))
    .toMatchObject({ version: "unavailable", channel: "unavailable", metadataStatus: "unavailable" });
});

test("asset intake requires the desktop session and accepts only a folder inspection command", async () => {
  const base = `http://127.0.0.1:${app.port}`;
  const cookie = (await fetch(app.url)).headers.get("set-cookie")!.split(";")[0];
  const body = JSON.stringify({ action: "inspect", folder: resolve(root, "absent") });
  const endpoint = base + "/api/desktop/assets/intake";
  expect((await fetch(endpoint, { method: "POST", headers: { Origin: base,
    "Content-Type": "application/json" }, body })).status).toBe(403);
  expect((await fetch(endpoint, { method: "POST", headers: { Cookie: cookie,
    Origin: "https://attacker.example", "Content-Type": "application/json" }, body })).status).toBe(403);
  expect((await fetch(endpoint, { method: "POST", headers: { Cookie: cookie, Origin: base,
    "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", folder: dataRoot }) })).status).toBe(400);
  const report = await fetch(endpoint, { method: "POST", headers: { Cookie: cookie, Origin: base,
    "Content-Type": "application/json" }, body });
  expect(report.status).toBe(422);
  const diagnostic = await report.json();
  expect(diagnostic).toMatchObject({ ready: false, provenance: "unverified" });
  expect(diagnostic.files).toHaveLength(5);
  expect(diagnostic.files[0]).toEqual({ name: "head.glb", status: "missing", matchesKnownOutput: null });
});

test("SQLite library initializes in the supplied user-data root", async () => {
  const base = `http://127.0.0.1:${app.port}`;
  const cookie = (await fetch(app.url)).headers.get("set-cookie")!.split(";")[0];
  const response = await fetch(base + "/api/collections", { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject([{ name: "Makeup collection", revision: 1, count: 0 }]);
  const denied = await fetch(base + "/api/collections", { method: "POST", headers: { Cookie: cookie,
    "Content-Type": "application/json", Origin: "http://attacker.example" }, body: "{}" });
  expect(denied.status).toBe(403);
  const webViewRequest = await fetch(base + "/api/looks", { method: "POST", headers: { Cookie: cookie,
    "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", Referer: base + "/" }, body: "{}" });
  expect(webViewRequest.status).toBe(400); // Domain validation reached; host auth passed.
  const unproven = await fetch(base + "/api/looks", { method: "POST", headers: { Cookie: cookie,
    "Content-Type": "application/json" }, body: "{}" });
  expect(unproven.status).toBe(403);
  const [summary] = await (await fetch(base + "/api/collections", { headers: { Cookie: cookie } })).json();
  const stored = await (await fetch(base + `/api/collections/${summary.id}`, { headers: { Cookie: cookie } })).json();
  const saved = await fetch(base + "/api/collections", { method: "POST", headers: { Cookie: cookie,
    "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", Referer: base + "/" },
    body: JSON.stringify({ collection: { ...stored.collection, name: "Desktop trial" }, revision: stored.revision }) });
  expect(saved.status).toBe(200);
  expect((await saved.json()).revision).toBe(2);
  expect((await (await fetch(base + `/api/collections/${summary.id}`, { headers: { Cookie: cookie } })).json()).collection.name)
    .toBe("Desktop trial");
});

test("desktop first run saves local setup only in its own user data and reports Check ready", async () => {
  const base = `http://127.0.0.1:${app.port}`;
  const cookie = (await fetch(app.url)).headers.get("set-cookie")!.split(";")[0];
  const headers = { Cookie: cookie };
  const initial = await fetch(base + "/api/local-settings", { headers });
  expect(initial.status).toBe(200);
  const view = await initial.json();
  expect(view).toMatchObject({ revision: 0, source: "new", fields: { gameRoot: null, launchRoute: "direct" },
    readiness: { check: { ready: true }, build: { ready: false }, updates: { ready: false } }, overridden: [] });
  const game = resolve(root, "sample-game");
  mkdirSync(resolve(game, "bin", "x64"), { recursive: true });
  mkdirSync(resolve(game, "archive", "pc"), { recursive: true });
  writeFileSync(resolve(game, "bin", "x64", "Cyberpunk2077.exe"), "fixture");
  const body = JSON.stringify({ revision: 0, fields: { ...view.fields, gameRoot: game } });
  const writeHeaders = { ...headers, Origin: base, "Content-Type": "application/json" };
  const saved = await fetch(base + "/api/local-settings", { method: "PATCH", headers: writeHeaders, body });
  expect(saved.status).toBe(200);
  const current = await saved.json();
  expect(current).toMatchObject({ revision: 1, source: "primary", fields: { gameRoot: game },
    readiness: { sourceDiscovery: { ready: true }, check: { ready: true }, build: { ready: false } } });
  const store = new LocalSettingsStore(dataRoot);
  expect(JSON.parse(readFileSync(store.file, "utf8")).gameRoot).toBe(game);
  expect((await fetch(base + "/api/local-settings", { method: "PATCH", headers: writeHeaders,
    body: JSON.stringify({ revision: 1, fields: { ...current.fields, settingsPath: resolve(root, "outside.json") } }) })).status).toBe(400);
  expect((await fetch(base + "/api/local-settings", { method: "PATCH", headers: { ...writeHeaders,
    Origin: "https://attacker.example" }, body })).status).toBe(403);
  expect((await fetch(base + "/api/local-settings", { method: "PATCH", headers,
    body })).status).toBe(403);
  expect((await fetch(base + "/api/package", { method: "POST", headers: writeHeaders,
    body: "{}" })).status).toBe(400);
});

test("desktop Check matches localhost preflight for a partial export and rejects unsafe requests", async () => {
  const base = `http://127.0.0.1:${app.port}`;
  const cookie = (await fetch(app.url)).headers.get("set-cookie")!.split(";")[0];
  const headers = { Cookie: cookie, Origin: base, "Content-Type": "application/json" };
  const collection = structuredClone(collectionFixture);
  collection.presets[0].recipe.layers[0].finish = "glitter";
  collection.presets[1].recipe.layers[0].finish = "shimmer";
  const body = JSON.stringify({ action: "check", collection });
  const desktop = await fetch(base + "/api/package", { method: "POST", headers, body });
  expect(desktop.status).toBe(200);
  const local = await createPackageHandler()(new Request(base + "/api/package", { method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" }, body }));
  expect(local.status).toBe(200);
  const checked = await desktop.json();
  expect(checked).toEqual(await local.json());
  expect(checked.omissions.map((item: { kind: string }) => item.kind)).toEqual(["layer", "preset", "layer", "preset"]);
  expect(checked.presets).toHaveLength(2);
  expect((await fetch(base + "/api/package", { method: "POST", headers: { ...headers,
    Origin: "https://attacker.example" }, body })).status).toBe(403);
  expect((await fetch(base + "/api/package", { method: "POST", headers: { Cookie: cookie,
    "Content-Type": "application/json" }, body })).status).toBe(403);
  expect((await fetch(base + "/api/package", { method: "POST", headers,
    body: JSON.stringify({ action: "check", collection, outputRoot: "F:/Games/Cyberpunk 2077" }) })).status).toBe(400);
  expect((await fetch(base + "/api/package", { method: "POST", headers,
    body: JSON.stringify({ action: "build", collection, outputRoot: "F:/Games/Cyberpunk 2077" }) })).status).toBe(400);
  expect((await desktopPackageRequest(new Request(base + "/api/package", { method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "16000001" }, body }))).status).toBe(413);
});

test("desktop Check refuses an empty filtered package; Build needs configured inputs", async () => {
  const base = `http://127.0.0.1:${app.port}`;
  const cookie = (await fetch(app.url)).headers.get("set-cookie")!.split(";")[0];
  const headers = { Cookie: cookie, Origin: base, "Content-Type": "application/json" };
  const collection = structuredClone(collectionFixture);
  for (const preset of collection.presets) for (const layer of preset.recipe.layers)
    if (layer.enabled && layer.opacity > 0) layer.finish = "glitter";
  const check = await fetch(base + "/api/package", { method: "POST", headers,
    body: JSON.stringify({ action: "check", collection }) });
  expect(check.status).toBe(422);
  expect((await check.json()).code).toBe("no_exportable_content");
  const build = await fetch(base + "/api/package", { method: "POST", headers,
    body: JSON.stringify({ action: "build", collection: collectionFixture }) });
  expect(build.status).toBe(503);
  expect((await build.json()).code).toBe("package_build_unavailable");
});

test("desktop settings recovery uses previous copy and blocks editing damaged primary", async () => {
  const base = `http://127.0.0.1:${app.port}`;
  const cookie = (await fetch(app.url)).headers.get("set-cookie")!.split(";")[0];
  const headers = { Cookie: cookie, Origin: base, "Content-Type": "application/json" };
  const initial = await (await fetch(base + "/api/local-settings", { headers })).json();
  const saved = await fetch(base + "/api/local-settings", { method: "PATCH", headers,
    body: JSON.stringify({ revision: initial.revision, fields: initial.fields }) });
  expect(saved.status).toBe(200);
  const store = new LocalSettingsStore(dataRoot);
  writeFileSync(store.file, "{damaged");
  const recovery = await (await fetch(base + "/api/local-settings", { headers })).json();
  expect(recovery).toMatchObject({ source: "backup", revision: initial.revision });
  expect((await fetch(base + "/api/local-settings", { method: "PATCH", headers,
    body: JSON.stringify({ revision: recovery.revision, fields: recovery.fields }) })).status).toBe(409);
  const restored = await fetch(base + "/api/local-settings", { method: "POST", headers,
    body: JSON.stringify({ action: "restorePrevious" }) });
  expect(restored.status).toBe(200);
  expect((await restored.json()).source).toBe("primary");
});
