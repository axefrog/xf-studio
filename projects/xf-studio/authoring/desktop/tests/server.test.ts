import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createDesktopServer } from "../server";

const root = mkdtempSync(resolve(tmpdir(), "xfs-desktop-test-"));
const staticRoot = resolve(root, "static");
mkdirSync(resolve(staticRoot, "build"), { recursive: true });
writeFileSync(resolve(staticRoot, "index.html"), "<!doctype html><title>Studio</title>");
writeFileSync(resolve(staticRoot, "build", "raster-worker.js"), "self.postMessage('ready')");
const app = createDesktopServer(staticRoot, resolve(root, "data"), { version: "0.0.1", channel: "dev" });
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
    packageBuild: false, updater: false, previewAssets: "missing", version: "0.0.1", channel: "dev" });
  const assetRoot = resolve(root, "data", "preview-assets");
  mkdirSync(assetRoot, { recursive: true });
  writeFileSync(resolve(assetRoot, "head.glb"), "local-only fixture");
  expect((await (await fetch(base + "/api/desktop/capabilities", { headers })).json()).previewAssets).toBe("user-provided");
  expect((await fetch(base + "/assets/head.glb", { headers })).status).toBe(200);
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
