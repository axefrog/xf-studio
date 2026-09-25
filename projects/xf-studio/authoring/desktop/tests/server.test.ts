import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createDesktopServer } from "../server";
import { desktopVersionFromMetadata } from "../host";
import { desktopPackageRequest } from "../package";
import { LocalSettingsStore } from "../../src/local-settings-store";
import { createPackageHandler } from "../../src/package-server";
import { collectionDraft } from "../../src/collection-workspace";
import { freshWorkspace, loadWorkspace, serializeWorkspace } from "../../src/workspace-state";
import { STUDIO_DOCUMENTS } from "../../src/compose/studio-registry";

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
  expect((await fetch(base + "/api/desktop/smoke", { method: "POST", headers: { ...headers,
    Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ schema: "xfs/desktop-smoke-1",
    state: "uv-only", webgl2: true, worker: true }) })).status).toBe(204);
  // Files placed by hand in the data folder are never served: only the derived preview is.
  const assetRoot = resolve(root, "data", "preview-assets");
  mkdirSync(assetRoot, { recursive: true });
  writeFileSync(resolve(assetRoot, "head.glb"), "local-only fixture");
  expect((await (await fetch(base + "/api/desktop/capabilities", { headers })).json()).previewAssets).toBe("missing");
  expect((await fetch(base + "/assets/head.glb", { headers })).status).toBe(404);
  expect((await fetch(base + "/assets/brows.glb", { headers })).status).toBe(404);
  // Resolved skin, face details, eyes, brows, lashes and hair: served only by content-addressed name from the host's own store.
  expect((await fetch(base + `/assets/character/${"a".repeat(64)}.json`, { headers })).status).toBe(404);
  expect((await fetch(base + "/assets/character/..%2f..%2fsettings.json", { headers })).status).toBe(404);
  expect((await fetch(base + `/api/preview-character?key=${"b".repeat(32)}`))).toHaveProperty("status", 403);
  const character = await fetch(base + "/api/preview-character", { method: "POST", headers: { ...headers, Origin: base,
    "Content-Type": "application/json" }, body: JSON.stringify({ schema: "xfs/character-request-1", source: "default", bodyGender: "female" }) });
  // No game folder is set up here: the host says what's needed instead of preparing.
  expect(await character.json()).toMatchObject({ phase: "failed", message: "Your V's own skin, face details, eyes, brows, lashes and hair appear once your game folder and WolvenKit are set up." });
  expect((await fetch(base + "/api/preview-character", { method: "POST", headers: { ...headers, Origin: base,
    "Content-Type": "application/json" }, body: JSON.stringify({ source: "save", path: "C:\\" }) })).status).toBe(400);
  expect((await fetch(base + "/api/desktop/assets/intake", { method: "POST", headers: { ...headers, Origin: base,
    "Content-Type": "application/json" }, body: JSON.stringify({ action: "inspect", folder: assetRoot }) })).status).toBe(405);
});

test("About version never falls back to source metadata when packaged metadata is invalid", () => {
  expect(desktopVersionFromMetadata({ version: "0.1.0", channel: "canary", hash: "abc12345" }))
    .toEqual({ version: "0.1.0", channel: "canary", buildHash: "abc12345", metadataStatus: "ready" });
  expect(desktopVersionFromMetadata({ version: "0.1.0", channel: "canary" }))
    .toMatchObject({ version: "unavailable", channel: "unavailable", metadataStatus: "unavailable" });
});

test("update snapshot is read-only and disabled operations cannot reach a feed", async () => {
  const base = `http://127.0.0.1:${app.port}`;
  const endpoint = base + "/api/desktop/update";
  expect((await fetch(endpoint)).status).toBe(403);
  const cookie = (await fetch(app.url)).headers.get("set-cookie")!.split(";")[0];
  const headers = { Cookie: cookie };
  expect(await (await fetch(endpoint, { headers })).json()).toMatchObject({
    schema: "xfs/desktop-update-1", installed: { version: "0.0.1", channel: "dev", buildHash: "dev" },
    available: null, phase: "unavailable", canCheck: false, canDownload: false, canApplyAndRestart: false,
  });
  const post = (body: unknown, extra: Record<string, string> = {}) => fetch(endpoint, { method: "POST",
    headers: { ...headers, Origin: base, "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) });
  expect((await post({ schema: "xfs/desktop-update-action-1", action: "check", url: "https://attacker.example" })).status).toBe(400);
  expect((await post({ schema: "xfs/desktop-update-action-1", action: "check" },
    { Origin: "https://attacker.example" })).status).toBe(403);
  expect(await (await post({ schema: "xfs/desktop-update-action-1", action: "check" })).json())
    .toMatchObject({ phase: "unavailable", available: null });
});

test("injected updater cannot apply until authenticated workspace acknowledgement and idle host", async () => {
  const trialRoot = resolve(root, "update-trial");
  const requested: string[] = [];
  let nativeApplies = 0, ready = false;
  const trial = createDesktopServer(staticRoot, trialRoot,
    { version: "0.1.0", channel: "canary", buildHash: "aaaaaaaa", metadataStatus: "ready" },
    undefined, undefined, undefined, {
      native: {
        async checkForUpdate() { return { version: "0.2.0", hash: "bbbbbbbb", updateAvailable: true, updateReady: false }; },
        async downloadUpdate() { ready = true; },
        updateInfo() { return { version: "0.2.0", hash: "bbbbbbbb", updateAvailable: true, updateReady: ready }; },
        async applyUpdate() { nativeApplies++; },
      },
      trust: { verifiedPrivateFeed: true, signedRelease: true, twoVersionTrialAccepted: true },
      requestWorkspaceFlush(nonce) { requested.push(nonce); }, flushTimeoutMs: 1000,
    });
  try {
    const base = `http://127.0.0.1:${trial.port}`;
    const cookie = (await fetch(trial.url)).headers.get("set-cookie")!.split(";")[0];
    const headers = { Cookie: cookie, Origin: base, "Content-Type": "application/json" };
    const post = (path: string, body: unknown, withCookie = true) => fetch(base + path, { method: "POST",
      headers: { ...headers, ...(withCookie ? {} : { Cookie: "" }) }, body: JSON.stringify(body) });
    const action = async (value: string) => (await post("/api/desktop/update",
      { schema: "xfs/desktop-update-action-1", action: value })).json();
    await action("check"); await action("download");
    const endInstall = trial.beginInstallTransaction()!;
    expect((await action("applyAndRestart")).reason).toContain("Finish active package or install work");
    expect(requested).toEqual([]);
    expect(nativeApplies).toBe(0);
    endInstall();
    await action("check"); await action("download");
    const applying = action("applyAndRestart");
    await Bun.sleep(10);
    expect(requested).toHaveLength(1);
    expect(nativeApplies).toBe(0);
    expect((await post("/api/package", { action: "check", collection: {} })).status).toBe(409);
    expect((await post("/api/desktop/workspace/close-ack",
      { schema: "xfs/desktop-close-ack-1", nonce: requested[0], status: "saved" }, false)).status).toBe(403);
    expect(nativeApplies).toBe(0);
    expect((await post("/api/desktop/workspace/close-ack",
      { schema: "xfs/desktop-close-ack-1", nonce: "wrong", status: "saved" })).status).toBe(409);
    expect((await post("/api/desktop/workspace/close-ack",
      { schema: "xfs/desktop-close-ack-1", nonce: requested[0], status: "failed" })).status).toBe(204);
    expect((await applying).phase).toBe("error");
    expect(nativeApplies).toBe(0);
    await action("check"); await action("download");
    const retry = action("applyAndRestart");
    await Bun.sleep(10);
    expect((await post("/api/desktop/workspace", { workspace: JSON.stringify(serializeWorkspace(freshWorkspace(), STUDIO_DOCUMENTS)) },
      true)).status).toBe(204);
    expect((await post("/api/desktop/workspace/close-ack",
      { schema: "xfs/desktop-close-ack-1", nonce: requested[1], status: "saved" })).status).toBe(409);
    expect((await retry).phase).toBe("error");
    expect(nativeApplies).toBe(0);
    await action("check"); await action("download");
    const savedRetry = action("applyAndRestart");
    await Bun.sleep(10);
    const saved = await fetch(base + "/api/desktop/workspace", { method: "POST",
      headers: { ...headers, "X-XFS-Update-Flush": requested[2] },
      body: JSON.stringify({ workspace: JSON.stringify(serializeWorkspace(freshWorkspace(), STUDIO_DOCUMENTS)) }) });
    expect(saved.status).toBe(204);
    expect((await post("/api/desktop/workspace/close-ack",
      { schema: "xfs/desktop-close-ack-1", nonce: requested[2], status: "saved" })).status).toBe(204);
    expect((await savedRetry).phase).toBe("applying");
    expect(nativeApplies).toBe(1);
    expect((await post("/api/package", { action: "check", collection: {} })).status).toBe(409);
    const quitting: { response?: { allow: boolean } } = {};
    trial.beforeQuit(quitting);
    expect(quitting.response).toBeUndefined();
    expect((await post("/api/desktop/workspace", { workspace: JSON.stringify(serializeWorkspace(freshWorkspace(), STUDIO_DOCUMENTS)) })).status).toBe(204);
    const stale: { response?: { allow: boolean } } = {};
    trial.beforeQuit(stale);
    expect(stale.response).toEqual({ allow: false });
  } finally { trial.stop(); }
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

test("desktop workspace survives a changed loopback port without mixing verification and normal drafts", async () => {
  const shared = resolve(root, "workspace-across-ports");
  const first = createDesktopServer(staticRoot, shared,
    { version: "0.0.1", channel: "dev", buildHash: "dev", metadataStatus: "ready" });
  const firstOrigin = `http://127.0.0.1:${first.port}`;
  const firstCookie = (await fetch(first.url)).headers.get("set-cookie")!.split(";")[0];
  const workspace = freshWorkspace();
  workspace.collections = collectionDraft(collectionFixture, STUDIO_DOCUMENTS, 3);
  workspace.collections.selected = collectionFixture.presets[1].id;
  workspace.recipe = structuredClone(collectionFixture.presets[1].recipe);
  workspace.preview.eyeShape = 12;
  const endpoint = firstOrigin + "/api/desktop/workspace?verify=1";
  const headers = { Cookie: firstCookie, Origin: firstOrigin, "Content-Type": "application/json" };
  try {
    expect((await fetch(endpoint, { method: "POST", headers: { Origin: firstOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: JSON.stringify(serializeWorkspace(workspace, STUDIO_DOCUMENTS)) }) })).status).toBe(403);
    expect((await fetch(endpoint, { method: "POST", headers: { ...headers, Origin: "https://attacker.example" },
      body: JSON.stringify({ workspace: JSON.stringify(serializeWorkspace(workspace, STUDIO_DOCUMENTS)) }) })).status).toBe(403);
    expect((await fetch(endpoint, { method: "POST", headers,
      body: JSON.stringify({ workspace: JSON.stringify(serializeWorkspace(workspace, STUDIO_DOCUMENTS)) }) })).status).toBe(204);
    expect(await (await fetch(firstOrigin + "/api/desktop/workspace", { headers: { Cookie: firstCookie } })).json())
      .toMatchObject({ workspace: null });
    expect((await fetch(endpoint, { method: "POST", headers,
      body: JSON.stringify({ workspace: "invalid" }) })).status).toBe(422);
  } finally { first.stop(); }
  const second = createDesktopServer(staticRoot, shared,
    { version: "0.0.1", channel: "dev", buildHash: "dev", metadataStatus: "ready" });
  try {
    const secondOrigin = `http://127.0.0.1:${second.port}`;
    const cookie = (await fetch(second.url)).headers.get("set-cookie")!.split(";")[0];
    const response = await fetch(secondOrigin + "/api/desktop/workspace?verify=1", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    const value = await response.json();
    const restored = loadWorkspace({ getItem: key => key === "xfas.workspace.verification.v1" ? value.workspace : null }, true, STUDIO_DOCUMENTS).state;
    expect(restored.collections?.collection.presets).toHaveLength(collectionFixture.presets.length);
    expect(restored.collections?.selected).toBe(collectionFixture.presets[1].id);
    expect(restored.preview.eyeShape).toBe(12);
  } finally { second.stop(); }
});

test("an unreadable desktop workspace is preserved and cannot be silently replaced", async () => {
  const data = resolve(root, "damaged-workspace");
  mkdirSync(data, { recursive: true });
  const file = resolve(data, "verification-workspace.json");
  writeFileSync(file, "damaged draft");
  const desktop = createDesktopServer(staticRoot, data,
    { version: "0.0.1", channel: "dev", buildHash: "dev", metadataStatus: "ready" });
  try {
    const origin = `http://127.0.0.1:${desktop.port}`;
    const cookie = (await fetch(desktop.url)).headers.get("set-cookie")!.split(";")[0];
    const endpoint = origin + "/api/desktop/workspace?verify=1";
    expect((await fetch(endpoint, { headers: { Cookie: cookie } })).status).toBe(409);
    expect((await fetch(endpoint, { method: "POST", headers: { Cookie: cookie, Origin: origin,
      "Content-Type": "application/json" }, body: JSON.stringify({ workspace: JSON.stringify(serializeWorkspace(freshWorkspace(), STUDIO_DOCUMENTS)) }) })).status)
      .toBe(422);
    expect(readFileSync(file, "utf8")).toBe("damaged draft");
  } finally { desktop.stop(); }
});

test("close acknowledgement requires a live nonce and authenticated same-origin write", async () => {
  const data = resolve(root, "close-ack");
  const desktop = createDesktopServer(staticRoot, data,
    { version: "0.0.1", channel: "dev", buildHash: "dev", metadataStatus: "ready" });
  const accepted: string[] = [];
  desktop.onWorkspaceCloseAck((nonce, status) => {
    if (nonce !== "pending-nonce") return false;
    accepted.push(status);
    return true;
  });
  try {
    const origin = `http://127.0.0.1:${desktop.port}`;
    const cookie = (await fetch(desktop.url)).headers.get("set-cookie")!.split(";")[0];
    const url = origin + "/api/desktop/workspace/close-ack";
    const body = JSON.stringify({ schema: "xfs/desktop-close-ack-1", nonce: "pending-nonce", status: "saved" });
    const headers = { Cookie: cookie, Origin: origin, "Content-Type": "application/json" };
    expect((await fetch(url, { method: "POST", headers: { Origin: origin }, body })).status).toBe(403);
    expect((await fetch(url, { method: "POST", headers: { ...headers, Origin: "https://other.example" }, body })).status).toBe(403);
    expect((await fetch(url, { method: "POST", headers,
      body: JSON.stringify({ schema: "xfs/desktop-close-ack-1", nonce: "stale", status: "saved" }) })).status).toBe(409);
    expect((await fetch(url, { method: "POST", headers, body })).status).toBe(204);
    expect(accepted).toEqual(["saved"]);
  } finally { desktop.stop(); }
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

test("the desktop reports and prepares the derived 3D preview through its session-gated endpoint", async () => {
  const previewRoot = resolve(root, "preview-trial");
  const game = resolve(previewRoot, "game"), cli = resolve(previewRoot, "WolvenKit.CLI.exe");
  mkdirSync(resolve(game, "archive", "pc", "content"), { recursive: true });
  writeFileSync(cli, "");
  const { createGameAssetExporter } = await import("../../src/game-asset-export");
  const exports: string[][] = [];
  const trial = createDesktopServer(staticRoot, resolve(previewRoot, "data"),
    { version: "0.0.1", channel: "dev", buildHash: "dev", metadataStatus: "ready" }, undefined, undefined, undefined, undefined,
    () => createGameAssetExporter(resolve(previewRoot, "data", "preview-cache", "exports"), async ({ depotPaths }) => { exports.push(depotPaths); }, { contains: () => new Set() }));
  try {
    const base = `http://127.0.0.1:${trial.port}`;
    const cookie = (await fetch(trial.url)).headers.get("set-cookie")!.split(";")[0]!;
    const headers = { Cookie: cookie };
    expect((await fetch(base + "/api/desktop/preview")).status).toBe(403);
    expect(await (await fetch(base + "/api/desktop/preview", { headers })).json()).toMatchObject({ phase: "needs-setup", needs: ["game", "wolvenkit"] });
    expect(await (await fetch(base + "/api/desktop/capabilities", { headers })).json()).toMatchObject({ previewAssets: "missing" });
    new LocalSettingsStore(resolve(previewRoot, "data")).save({ ...(await import("../../src/local-settings")).defaultLocalSettings(),
      gameRoot: game, wolvenKitCli: cli }, 0);
    const post = (body: unknown, origin = base) => fetch(base + "/api/desktop/preview", { method: "POST",
      headers: { ...headers, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ action: "prepare" }, "https://attacker.example")).status).toBe(403);
    expect(await (await post({ action: "prepare" })).json()).toMatchObject({ phase: "preparing", canCancel: true });
    await trial.previewCore.settled();
    // The stand-in exporter found nothing and its archive index lacks the head, so it is reported missing in plain language.
    expect(await (await fetch(base + "/api/desktop/preview", { headers })).json()).toMatchObject({ phase: "blocked", code: "preview_source_missing" });
    expect(exports).toHaveLength(1);
    expect((await fetch(base + "/assets/head.glb", { headers })).status).toBe(404);
  } finally { trial.stop(); }
});
