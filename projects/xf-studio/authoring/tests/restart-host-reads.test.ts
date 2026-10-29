import { expect, spyOn, test } from "bun:test";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import * as metadata from "node:fs";
import type { BigIntStats, PathLike, StatOptions } from "node:fs";
import * as files from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { savesFolderProbe, SAVES_FOLDER_DISPLAY } from "../src/saves/host/saves-host-sources";
import { servePreviewCoreAsset } from "../src/preview/host/preview-core-server";
import { tempDir } from "./temp-dir";
import { PreviewCoreHost } from "../src/preview/host/preview-core-host";
import * as core from "../src/preview/host/preview-core-service";
import { contentFingerprint } from "../src/host/derived-cache";
import { PREVIEW_CORE_DERIVER_VERSION, PREVIEW_CORE_FILES, PREVIEW_CORE_RECIPE, previewCoreRecipeSha256 } from "../src/preview/preview-core-recipe";

/** Synthetic cached bytes with the production recipe/manifest identity; validation and HTTP use the real host. */
function cachedCore() {
  const root = tempDir("xfs-core-generation-"), game = join(root, "game");
  mkdirSync(join(game, "archive", "pc", "content"), { recursive: true });
  const cache = new core.PreviewCoreCache(join(root, "cache"), PREVIEW_CORE_RECIPE, false), work = cache.createWork();
  mkdirSync(join(work, core.PREVIEW_CORE_ASSET_DIRECTORY));
  const manifest = { schema: core.PREVIEW_CORE_MANIFEST_SCHEMA, recipeId: PREVIEW_CORE_RECIPE.id,
    recipeRevision: PREVIEW_CORE_RECIPE.revision, deriverVersion: PREVIEW_CORE_DERIVER_VERSION,
    recipeSha256: previewCoreRecipeSha256(PREVIEW_CORE_RECIPE), cacheKey: "synthetic",
    files: PREVIEW_CORE_FILES.map(name => {
      const data = Buffer.from(`synthetic core ${name}`);
      writeFileSync(join(work, core.PREVIEW_CORE_ASSET_DIRECTORY, name), data);
      return { name, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
    }) };
  cache.writeJson(join(work, core.PREVIEW_CORE_MANIFEST_FILE), manifest);
  const entry = cache.publish(work, "synthetic");
  cache.writeStatus({ recipeId: PREVIEW_CORE_RECIPE.id, recipeRevision: PREVIEW_CORE_RECIPE.revision,
    deriverVersion: PREVIEW_CORE_DERIVER_VERSION, state: "ready", code: null, message: "Ready", gameRoot: game,
    contentFingerprint: contentFingerprint(game, "archive/pc/content"), cacheName: "synthetic" });
  const restart = () => new PreviewCoreHost({ cacheRoot: cache.root, settings: () => ({ gameRoot: game, wolvenKitCli: null }), now: () => 0 });
  const host = restart();
  const path = join(entry, core.PREVIEW_CORE_ASSET_DIRECTORY, "head.glb");
  return { root, host, restart, path, receipt: join(entry, "preview-verified.json"), asset: (name: string) => join(entry, core.PREVIEW_CORE_ASSET_DIRECTORY, name) };
}
const assetRequest = (tag?: string) => new Request("http://127.0.0.1/assets/head.glb", { headers: tag ? { "If-None-Match": tag } : {} });
const corrupt = (path: string) => { const data = readFileSync(path); data[0]! ^= 1; writeFileSync(path, data); };

const unreliableKinds = ["coarse", "milliseconds", "zero-change", "missing-change", "zero-inode", "missing-inode", "zero-device", "missing-nanoseconds"] as const;
/** A filesystem whose tuple survives a same-size edit. Keep real file reads, hashes, host and HTTP validation. */
function unreliableCoreMetadata(root: string, kind: typeof unreliableKinds[number]) {
  const actualStat = metadata.statSync, actualOpen = files.open, kept = new Map<string, BigIntStats>();
  const projected = (path: string, value: BigIntStats): BigIntStats => {
    if (!path.startsWith(root)) return value;
    const previous = kept.get(path);
    if (previous) return previous;
    const fixed: BigIntStats = Object.assign(Object.create(Object.getPrototypeOf(value)), value);
    if (kind === "coarse" || kind === "milliseconds") {
      const quantum = kind === "coarse" ? 1_000_000_000n : 1_000_000n;
      fixed.mtimeNs = value.mtimeNs / quantum * quantum;
      fixed.ctimeNs = value.ctimeNs / quantum * quantum;
      fixed.birthtimeNs = value.birthtimeNs / quantum * quantum;
    }
    if (kind === "zero-change") fixed.ctimeNs = 0n;
    if (kind === "missing-change") Reflect.deleteProperty(fixed, "ctimeNs");
    if (kind === "zero-inode") fixed.ino = 0n;
    if (kind === "missing-inode") Reflect.deleteProperty(fixed, "ino");
    if (kind === "zero-device") fixed.dev = 0n;
    if (kind === "missing-nanoseconds") for (const field of ["mtimeNs", "ctimeNs", "birthtimeNs"]) Reflect.deleteProperty(fixed, field);
    kept.set(path, fixed);
    return fixed;
  };
  const stats = spyOn(metadata, "statSync").mockImplementation(((path: PathLike, options?: StatOptions) => {
    if (options?.bigint) return projected(String(path), actualStat(path, { ...options, bigint: true }) as BigIntStats);
    return actualStat(path, options);
  }) as typeof metadata.statSync);
  const reads = spyOn(files, "open").mockImplementation(async (path, flags, mode) => {
    const file = await actualOpen(path, flags, mode), getStat = file.stat.bind(file);
    file.stat = (async (options?: StatOptions) => options?.bigint
      ? projected(String(path), await getStat({ bigint: true })) : getStat(options)) as typeof file.stat;
    return file;
  });
  return { reads, restore: () => { stats.mockRestore(); reads.mockRestore(); } };
}

test.each([...unreliableKinds])("unreliable core metadata (%s) rehashes across restart and refuses stale memo/304 after a restored-mtime edit", async (kind: typeof unreliableKinds[number]) => {
  const f = cachedCore(), fake = unreliableCoreMetadata(f.root, kind);
  try {
    expect((await f.host.readSnapshot()).phase).toBe("ready");
    expect(metadata.existsSync(f.receipt)).toBe(false);
    fake.reads.mockClear();
    const restarted = f.restart();
    expect((await restarted.readSnapshot()).phase).toBe("ready");
    expect(fake.reads.mock.calls.length).toBeGreaterThan(0);
    const asset = await restarted.asset("head.glb");
    expect(asset).not.toBeNull();
    expect((await servePreviewCoreAsset(restarted, "head.glb", assetRequest(asset!.etag))).status).toBe(304);
    const previous = statSync(f.path);
    corrupt(f.path); utimesSync(f.path, previous.atime, previous.mtime);
    expect(asset!.current()).toBe(false); // The HTTP boundary must not rely on the degenerate tuple either.
    expect((await servePreviewCoreAsset(restarted, "head.glb", assetRequest(asset!.etag))).status).toBe(404);
    expect((await f.restart().readSnapshot()).phase).not.toBe("ready");
  } finally { fake.restore(); rmSync(f.root, { recursive: true, force: true }); }
});

test("an existing legacy receipt cannot vouch for edited bytes on coarse metadata", async () => {
  const f = cachedCore(), fake = unreliableCoreMetadata(f.root, "coarse");
  try {
    const checked = core.previewCoreReadiness(join(f.root, "cache"), join(f.root, "game"));
    expect(checked.state).toBe("ready");
    if (checked.state !== "ready") throw Error("The synthetic core must verify before the edit.");
    // The prior release wrote the tuple alone, without testing its precision. The status file is not part of the receipt.
    writeFileSync(f.receipt, JSON.stringify({ schema: "xfs/preview-core-verified-1",
      generation: checked.generation.slice(1).map(({ path, identity }) => ({ path, identity })) }));
    const previous = statSync(f.path);
    corrupt(f.path); utimesSync(f.path, previous.atime, previous.mtime);
    expect((await f.restart().readSnapshot()).phase).not.toBe("ready");
    expect(fake.reads.mock.calls.length).toBeGreaterThan(0);
  } finally { fake.restore(); rmSync(f.root, { recursive: true, force: true }); }
});

test("a restarted real core host reuses full verification only for unchanged file generations", async () => {
  const f = cachedCore(), read = spyOn(files, "open");
  try {
    expect((await f.host.readSnapshot()).phase).toBe("ready");
    expect(read.mock.calls.length).toBeGreaterThan(0);
    read.mockClear();
    expect((await f.restart().readSnapshot()).phase).toBe("ready");
    expect(read).not.toHaveBeenCalled();
    const previous = statSync(f.path);
    corrupt(f.path); utimesSync(f.path, previous.atime, previous.mtime);
    expect((await f.restart().readSnapshot()).phase).not.toBe("ready");
    expect(read.mock.calls.length).toBeGreaterThan(0);
  } finally { read.mockRestore(); rmSync(f.root, { recursive: true, force: true }); }
});

test.each(["missing", "damaged"] as const)("a %s verification receipt falls back to full verification and is repaired", async change => {
  const f = cachedCore(), read = spyOn(files, "open");
  try {
    expect((await f.host.readSnapshot()).phase).toBe("ready");
    if (change === "missing") rmSync(f.receipt); else writeFileSync(f.receipt, "{damaged");
    read.mockClear();
    expect((await f.restart().readSnapshot()).phase).toBe("ready");
    expect(read.mock.calls.length).toBeGreaterThan(0);
    read.mockClear();
    expect((await f.restart().readSnapshot()).phase).toBe("ready");
    expect(read).not.toHaveBeenCalled();
  } finally { read.mockRestore(); rmSync(f.root, { recursive: true, force: true }); }
});

test.each(["overwrite", "replace"] as const)("real core host refuses an old ETag after same-size %s inside the readiness memo", async change => {
  const f = cachedCore();
  try {
    const first = await servePreviewCoreAsset(f.host, "head.glb", assetRequest());
    expect(first.status).toBe(200); await first.arrayBuffer();
    const tag = first.headers.get("ETag")!;
    expect((await servePreviewCoreAsset(f.host, "head.glb", assetRequest(tag))).status).toBe(304);
    const previous = statSync(f.path);
    if (change === "overwrite") corrupt(f.path);
    else {
      const replacement = `${f.path}.replacement`;
      writeFileSync(replacement, readFileSync(f.path)); corrupt(replacement);
      rmSync(f.path); renameSync(replacement, f.path);
    }
    utimesSync(f.path, previous.atime, previous.mtime); // Length and mtime alone cannot validate this generation.
    expect((await servePreviewCoreAsset(f.host, "head.glb", assetRequest(tag))).status).toBe(404);
    expect(f.host.ready()).toBe(false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("real core host rejects changes to bytes already hashed before verification publishes ready", async () => {
  const f = cachedCore(), open = files.open;
  let changed = false;
  const read = spyOn(files, "open").mockImplementation(async (path, flags, mode) => {
    const file = await open(path, flags, mode);
    if (!changed && String(path) === f.asset(PREVIEW_CORE_FILES[1]!)) { changed = true; corrupt(f.path); }
    return file;
  });
  try {
    expect((await f.host.readSnapshot()).phase).not.toBe("ready");
    expect(changed).toBe(true); expect(await f.host.asset("head.glb")).toBeNull();
  } finally { read.mockRestore(); rmSync(f.root, { recursive: true, force: true }); }
});

test("real core host checks the verified generation again at the HTTP boundary, before returning 304", async () => {
  const f = cachedCore();
  const verified = await f.host.asset("head.glb");
  expect(verified).not.toBeNull();
  const asset = f.host.asset.bind(f.host);
  let changed = false;
  const reads = spyOn(f.host, "asset").mockImplementation(async (...args) => {
    const result = await asset(...args);
    if (!changed) { changed = true; corrupt(f.path); }
    return result;
  });
  try {
    expect((await servePreviewCoreAsset(f.host, "head.glb", assetRequest(verified!.etag))).status).toBe(404);
    expect(changed).toBe(true);
  } finally { reads.mockRestore(); rmSync(f.root, { recursive: true, force: true }); }
});

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

test("a verification replaced by settings still aborts when its last reader leaves, without deleting its replacement", async () => {
  const root = tempDir("xfs-core-replaced-"), games = [join(root, "a"), join(root, "b")];
  for (const game of games) mkdirSync(join(game, "archive", "pc", "content"), { recursive: true });
  let gameRoot = games[0]!;
  const reads: { signal: AbortSignal; result: ReturnType<typeof Promise.withResolvers<core.PreviewCoreReadiness>> }[] = [];
  const check = spyOn(core, "previewCoreReadinessAsync").mockImplementation(async (_cache, _game, _recipe, _plate, signal) => {
    const result = Promise.withResolvers<core.PreviewCoreReadiness>(); reads.push({ signal: signal!, result });
    signal!.addEventListener("abort", () => result.reject(signal!.reason), { once: true });
    return result.promise;
  });
  const host = new PreviewCoreHost({ cacheRoot: root, settings: () => ({ gameRoot, wolvenKitCli: null }) });
  const a = new AbortController(), b = new AbortController();
  const first = host.readSnapshot("female", a.signal);
  gameRoot = games[1]!;
  const replacement = host.readSnapshot("female", b.signal);
  try {
    expect(reads).toHaveLength(2);
    a.abort(); await expect(first).rejects.toHaveProperty("name", "AbortError");
    expect(reads[0]!.signal.aborted).toBe(true); expect(reads[1]!.signal.aborted).toBe(false);
    const joined = host.readSnapshot("female");
    expect(reads).toHaveLength(2); // Cancelling the old owner did not remove the new check.
    reads[1]!.result.resolve({ state: "none" });
    expect((await replacement).phase).toBe("needs-setup"); await joined;
  } finally {
    a.abort(); b.abort(); for (const read of reads) read.result.resolve({ state: "none" });
    check.mockRestore(); rmSync(root, { recursive: true, force: true });
  }
});

test("a warm browser revalidates the head by content identity without retransferring its bytes, and stale/missing assets are refused", async () => {
  const root = tempDir("xfs-core-http-"), path = join(root, "head.glb");
  writeFileSync(path, "private head bytes");
  let valid = true, calls = 0;
  const host = { asset: async (_name: string) => { calls++; return valid ? { path, etag: '"content-one"', current: () => valid } : null; } };
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
