// The packaged app is one bundle, so the resolver's native decode worker (src/native/native-decode-worker.ts) can't start from its
// source URL there: prepare-static.ts builds it beside the Check worker, and the desktop entries hand its path to the installation
// registry. Built the same way here, the worker must start and answer. Without the game's Oodle library it reports why, and the decoder
// answers `unavailable`, so resources fall back to WolvenKit. With XFS_RESOLVER_GAME_ROOT set, it also decodes a real resource.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NATIVE_ROOTS, nativeReaderIdentity, openNativeDecoderAsync } from "../../src/native/native-fetch-port";
import { WorkerDecoder } from "../../src/native/native-decode";

const directory = mkdtempSync(resolve(tmpdir(), "xfs-native-worker-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const source = (name: string) => readFileSync(resolve(import.meta.dir, "..", name), "utf8");

async function builtWorker(): Promise<string> {
  const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, "../../src/native/native-decode-worker.ts")], target: "bun", outdir: directory });
  expect(built.success).toBe(true);
  expect(built.outputs.length).toBe(1);
  return built.outputs[0]!.path;
}

test("the built native decode worker starts and says why it can't decode without the game's Oodle library", async () => {
  const script = await builtWorker();
  const decoder = new WorkerDecoder({ decompressor: { gameRoot: directory }, roots: NATIVE_ROOTS, identity: nativeReaderIdentity("test"), script, restartDelayMs: 60_000 });
  try {
    const outcome = await decoder.decode({ archivePath: join(directory, "x.archive"), hash: "1", needName: false });
    expect(outcome).toMatchObject({ ok: false, kind: "unavailable" });
    // The worker's own reason (it loaded and ran), not a failure to load the script.
    expect((outcome as { message: string }).message).toMatch(/Oodle library|64-bit Windows/);
    expect(decoder.started).toBe(1);
  } finally { decoder.close(); }
}, 30_000);

test("the desktop build bundles the worker and both desktop entries hand its path to the host", () => {
  expect(source("prepare-static.ts")).toContain(`entrypoints: [resolve(authoring, "src", "native", "native-decode-worker.ts")], target: "bun"`);
  for (const entry of ["main.ts", "trial-main.ts"]) expect(source(entry)).toContain(`nativeDecodeWorker: resolve(viewRoot, "native-decode-worker.js")`);
  expect(source("server.ts")).toContain("installations.useNativeWorker(hostOptions.nativeDecodeWorker)");
  expect(source("verify-canary.ts")).toContain(`"native-decode-worker.js"`);
});

const gameRoot = process.env.XFS_RESOLVER_GAME_ROOT;
test.skipIf(!gameRoot)("opt-in: the built worker reads a real resource from the installed game", async () => {
  const script = await builtWorker();
  const opened = await openNativeDecoderAsync(gameRoot!, { script });
  if (!opened.decoder) throw new Error(opened.reason);
  try {
    // The creator's base resource for female V (every installation has it).
    const { depotHash } = await import("../../src/depot-path");
    const { ccoPath } = await import("../../src/character-resolver");
    const { readRdarIndexHashes } = await import("../../src/rdar-index-fs");
    const hash = depotHash(ccoPath("female", false)), content = join(gameRoot!, "archive", "pc", "content");
    const archive = readdirSync(content).filter(name => name.endsWith(".archive")).map(name => join(content, name))
      .find(path => readRdarIndexHashes(path).includes(BigInt(hash)));
    expect(archive).toBeDefined();
    const outcome = await opened.decoder.decode({ archivePath: archive!, hash, needName: false });
    expect(outcome).toMatchObject({ ok: true, root: "gameuiCharacterCustomizationInfoResource" });
  } finally { opened.decoder.close(); }
}, 60_000);
