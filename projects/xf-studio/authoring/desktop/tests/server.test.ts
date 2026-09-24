import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createDesktopServer } from "../server";
import { desktopVersionFromMetadata } from "../host";
import { LocalSettingsStore } from "../../src/local-settings-store";

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
    packageBuild: false, updater: false, previewAssets: "missing", version: "0.0.1", channel: "dev",
    buildHash: "dev", metadataStatus: "ready", userDataPath: dataRoot });
  const assetRoot = resolve(root, "data", "preview-assets");
  mkdirSync(assetRoot, { recursive: true });
  writeFileSync(resolve(assetRoot, "head.glb"), "local-only fixture");
  expect((await (await fetch(base + "/api/desktop/capabilities", { headers })).json()).previewAssets).toBe("user-provided");
  expect((await fetch(base + "/assets/head.glb", { headers })).status).toBe(200);
});

test("About version never falls back to source metadata when packaged metadata is invalid", () => {
  expect(desktopVersionFromMetadata({ version: "0.1.0", channel: "canary", hash: "abc12345" }))
    .toEqual({ version: "0.1.0", channel: "canary", buildHash: "abc12345", metadataStatus: "ready" });
  expect(desktopVersionFromMetadata({ version: "0.1.0", channel: "canary" }))
    .toMatchObject({ version: "unavailable", channel: "unavailable", metadataStatus: "unavailable" });
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

test("desktop first run saves local setup only in its own user data and reports unsupported package work", async () => {
  const base = `http://127.0.0.1:${app.port}`;
  const cookie = (await fetch(app.url)).headers.get("set-cookie")!.split(";")[0];
  const headers = { Cookie: cookie };
  const initial = await fetch(base + "/api/local-settings", { headers });
  expect(initial.status).toBe(200);
  const view = await initial.json();
  expect(view).toMatchObject({ revision: 0, source: "new", fields: { gameRoot: null, launchRoute: "direct" },
    readiness: { check: { ready: false }, build: { ready: false }, updates: { ready: false } }, overridden: [] });
  expect(view.readiness.check.issues[0].code).toBe("package_check_host_unavailable");
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
    readiness: { sourceDiscovery: { ready: true }, check: { ready: false }, build: { ready: false } } });
  const store = new LocalSettingsStore(dataRoot);
  expect(JSON.parse(readFileSync(store.file, "utf8")).gameRoot).toBe(game);
  expect((await fetch(base + "/api/local-settings", { method: "PATCH", headers: writeHeaders,
    body: JSON.stringify({ revision: 1, fields: { ...current.fields, settingsPath: resolve(root, "outside.json") } }) })).status).toBe(400);
  expect((await fetch(base + "/api/local-settings", { method: "PATCH", headers: { ...writeHeaders,
    Origin: "https://attacker.example" }, body })).status).toBe(403);
  expect((await fetch(base + "/api/local-settings", { method: "PATCH", headers,
    body })).status).toBe(403);
  expect((await fetch(base + "/api/package", { method: "POST", headers: writeHeaders,
    body: "{}" })).status).toBe(503);
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
