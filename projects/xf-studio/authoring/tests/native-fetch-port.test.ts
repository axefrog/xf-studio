import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MountedArchive } from "../src/archive-precedence";
import { refFromPath } from "../src/depot-path";
import { NativeArchivePool } from "../src/native/archive-reader";
import { NativeFirstFetcher, type NativeReader, nativeReaderIdentity } from "../src/native/native-fetch-port";
import type { FetchedResource, ResourceFetchPort } from "../src/resource-graph";
import { fakeDecompress, syntheticArchive } from "./fixtures/native-archive";
import { Cr2wBuilder, prop, v } from "./fixtures/native-cr2w";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function resource(className: string, props = [prop("sampleCount", "Uint32", v.u32(16))]) {
  const file = new Cr2wBuilder(); file.export(className, props); return file.build();
}

test("the native-first port answers verified types itself and hands everything else to the fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-native-port-")); roots.push(root);
  const profile = resource("CHairProfile"), other = resource("animRig", []);
  const path = join(root, "mod.archive");
  writeFileSync(path, syntheticArchive([
    { path: "mod\\hair.hp", segments: [{ bytes: profile }] },
    { path: "mod\\rig.rig", segments: [{ bytes: other }] },
    { path: "mod\\broken.mi", segments: [{ bytes: new Uint8Array([1, 2, 3]) }] },
  ], { names: true }));
  const archive = { id: path, name: "mod.archive" } as MountedArchive;
  const asked: string[] = [];
  const fallback: ResourceFetchPort & { transient(): boolean } = {
    fetch: async (_archive, ref) => { asked.push(ref.path ?? ref.hash); return { document: { from: "fallback" }, extractedSha256: null } as FetchedResource; },
    transient: () => true,
  };
  const pool = new NativeArchivePool(fakeDecompress);
  const reader: NativeReader = { pool, decompress: fakeDecompress, identity: nativeReaderIdentity("test"), close: () => pool.close() };
  const port = new NativeFirstFetcher(reader, fallback);
  try {
    const hair = await port.fetch(archive, refFromPath("mod\\hair.hp"), "hp");
    expect((hair!.document as any).Data.RootChunk).toMatchObject({ $type: "CHairProfile", sampleCount: 16 });
    expect((hair!.document as any).Header.XfsNativeReader).toBe(reader.identity);
    expect(hair!.extractedSha256).toBe(createHash("sha256").update(profile).digest("hex"));
    expect(hair!.fresh).toBe(false);
    expect(port.transient(archive, refFromPath("mod\\hair.hp"))).toBe(false);
    // A hash-only reference learns its path from the archive's own name list.
    const byHash = await port.fetch(archive, { hash: refFromPath("mod\\hair.hp").hash, path: null }, null);
    expect(byHash!.path).toBe("mod\\hair.hp");
    // Unverified root class, undecodable bytes and a missing hash all go to the fallback, whose transient rule then applies.
    for (const item of ["mod\\rig.rig", "mod\\broken.mi", "mod\\missing.mi"]) expect((await port.fetch(archive, refFromPath(item), null))!.document).toEqual({ from: "fallback" });
    expect(asked).toEqual(["mod\\rig.rig", "mod\\broken.mi", "mod\\missing.mi"]);
    expect(port.transient(archive, refFromPath("mod\\rig.rig"))).toBe(true);
    expect(port.stats).toMatchObject({ native: 2, fallback: 3, notVerified: 1 });
    expect(port.stats.errors).toHaveLength(1);
    expect(reader.identity).toMatch(/^xfs-native:\d+:[0-9a-f]{12}:test$/);
  } finally { reader.close(); }
});
