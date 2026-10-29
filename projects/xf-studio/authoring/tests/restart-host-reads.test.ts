import { expect, spyOn, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { savesFolderProbe, SAVES_FOLDER_DISPLAY } from "../src/saves/host/saves-host-sources";
import { servePreviewCoreAsset } from "../src/preview/host/preview-core-server";
import { tempDir } from "./temp-dir";
import { PreviewCoreHost } from "../src/preview/host/preview-core-host";
import * as core from "../src/preview/host/preview-core-service";

test("core HTTP checks single-flight; one cancelled reader cannot stop another, and the last cancellation abandons verification", async () => {
  const root = tempDir("xfs-core-check-"), game = join(root, "game");
  mkdirSync(join(game, "archive", "pc", "content"), { recursive: true });
  let now = 0;
  const reads: { signal: AbortSignal; result: ReturnType<typeof Promise.withResolvers<core.PreviewCoreReadiness>> }[] = [];
  const check = spyOn(core, "previewCoreReadinessAsync").mockImplementation(async (_cache, _game, _recipe, _plate, signal) => {
    const result = Promise.withResolvers<core.PreviewCoreReadiness>(); reads.push({ signal: signal!, result });
    signal!.addEventListener("abort", () => result.reject(signal!.reason), { once: true });
    return result.promise;
  });
  const host = new PreviewCoreHost({ cacheRoot: root, settings: () => ({ gameRoot: game, wolvenKitCli: null }), now: () => now });
  try {
    const a = new AbortController(), b = new AbortController();
    const one = host.readSnapshot("female", a.signal), two = host.readSnapshot("female", b.signal);
    expect(reads).toHaveLength(1);
    a.abort(); await expect(one).rejects.toHaveProperty("name", "AbortError");
    expect(reads[0]!.signal.aborted).toBe(false);
    reads[0]!.result.resolve({ state: "none" }); expect((await two).phase).toBe("needs-setup");
    now = 5001;
    const c = new AbortController(), last = host.readSnapshot("female", c.signal);
    expect(reads).toHaveLength(2);
    c.abort(); await expect(last).rejects.toHaveProperty("name", "AbortError");
    expect(reads[1]!.signal.aborted).toBe(true);
  } finally { for (const read of reads) read.result.resolve({ state: "none" }); check.mockRestore(); rmSync(root, { recursive: true, force: true }); }
});

test("settings prewarms and shares one bounded Saved Games registry read, then rechecks after expiry without a timer", async () => {
  let now = 0, calls = 0;
  const registry = Promise.withResolvers<string | null>();
  const probe = savesFolderProbe({ allowOverride: false, now: () => now, host: {
    platform: "win32", env: name => name === "USERPROFILE" ? "C:\\Player" : undefined,
    registry: () => { calls++; return registry.promise; },
  } });
  expect(calls).toBe(1); // Started with the host, before its first settings GET.
  const first = probe.detected(), second = probe.detected();
  expect(calls).toBe(1);
  registry.resolve(null);
  expect(await first).toEqual({ path: "C:\\Player\\Saved Games\\CD Projekt Red\\Cyberpunk 2077", display: SAVES_FOLDER_DISPLAY });
  expect(await second).toEqual(await first);
  now = 4999; await probe.detected(); expect(calls).toBe(1);
  now = 5000; await probe.detected(); expect(calls).toBe(2);
});

test("a warm browser revalidates the head by content identity without retransferring its bytes, and stale/missing assets are refused", async () => {
  const root = tempDir("xfs-core-http-"), path = join(root, "head.glb");
  writeFileSync(path, "private head bytes");
  let valid = true, calls = 0;
  const host = { asset: async (_name: string) => { calls++; return valid ? { path, etag: '"content-one"' } : null; } };
  const request = (tag?: string, method = "GET") => new Request("http://127.0.0.1/assets/head.glb", { method, headers: tag ? { "If-None-Match": tag } : {} });
  try {
    const first = await servePreviewCoreAsset(host, "head.glb", request());
    expect(first.status).toBe(200); expect(await first.text()).toBe("private head bytes");
    expect(first.headers.get("ETag")).toBe('"content-one"'); expect(first.headers.get("Cache-Control")).toBe("private, no-cache");
    const again = await servePreviewCoreAsset(host, "head.glb", request('"content-one"'));
    expect(again.status).toBe(304); expect(await again.text()).toBe(""); expect(calls).toBe(2);
    expect((await servePreviewCoreAsset(host, "head.glb", request('"old-content"'))).status).toBe(200);
    expect(await (await servePreviewCoreAsset(host, "head.glb", request(undefined, "HEAD"))).text()).toBe("");
    valid = false;
    expect((await servePreviewCoreAsset(host, "head.glb", request('"content-one"'))).status).toBe(404);
    valid = true; rmSync(path);
    expect((await servePreviewCoreAsset(host, "head.glb", request('"content-one"'))).status).toBe(404);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
