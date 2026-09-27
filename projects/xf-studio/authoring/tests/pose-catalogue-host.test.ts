// The pose catalogue's host side over synthetic files (no game data): animation requests through the native decoders (in-process and the
// worker), the catalogue built from a synthetic installation (TweakDB blob, TweakXL file, puppet entity, ArchiveXL set, archive), its set
// index cache, a sampled pose, the endpoint and the typed actions.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArchiveXlConfig } from "../src/archivexl-config";
import { depotHash } from "../src/depot-path";
import { decodeAnimFromPool } from "../src/native/anim-decode";
import { NativeArchivePool } from "../src/native/archive-reader";
import { InProcessDecoder, WorkerDecoder } from "../src/native/native-decode";
import { PoseActions } from "../src/pose-actions";
import { loadPoseCatalogue, PoseCatalogueHost } from "../src/pose-catalogue-host";
import { createPoseHandler, isPoseId } from "../src/pose-catalogue-server";
import type { Installation } from "../src/resolver-host";
import { POSE_DESCRIPTORS } from "../src/studio-action-descriptors";
import { childId, tweakDbId } from "../src/tweakdb-flats";
import { animSet, rig } from "./fixtures/anim-set";
import { fakeDecompress, syntheticArchive } from "./fixtures/native-archive";
import { tweakDbBlob } from "./fixtures/tweakdb-blob";

const root = mkdtempSync(join(tmpdir(), "xfs-poses-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const SET = "base\\animations\\ui\\photomode\\photomode__female__idle.anims", PACK_SET = "pack\\poses.anims";
const RIG = "base\\characters\\base_entities\\woman_base\\woman_base.rig", PUPPET = "ep1\\characters\\photo_mode\\player_wa_photomode_ep1.ent";
const archivePath = join(root, "poses.archive");
writeFileSync(archivePath, syntheticArchive([
  { path: SET, segments: [{ bytes: animSet({ names: ["held", "idle_stand_01", "keyless", "simd"] }) }] },
  { path: PACK_SET, segments: [{ bytes: animSet({ names: ["pack_moving", "pack_held", "pack_keyless", "pack_simd"] }) }] },
  { path: RIG, segments: [{ bytes: rig() }] },
]));

describe("animation requests through the native decoders", () => {
  test("a set's index, a clip and a rig, in-process and in the worker; a missing resource is not indexed", async () => {
    const pool = new NativeArchivePool(fakeDecompress);
    const index = decodeAnimFromPool(pool, fakeDecompress, { archivePath, hash: depotHash(SET), op: "index" });
    expect(index.ok && index.index!.clips.map(c => c.name)).toEqual(["held", "idle_stand_01", "keyless", "simd"]);
    const clip = decodeAnimFromPool(pool, fakeDecompress, { archivePath, hash: depotHash(SET), op: "clip", clip: "idle_stand_01" });
    expect(clip.ok && clip.clip!.counts.compressed).toBe(2);
    const refused = decodeAnimFromPool(pool, fakeDecompress, { archivePath, hash: depotHash(SET), op: "clip", clip: "simd" });
    expect(refused.ok ? "ok" : refused.kind).toBe("unsupported");
    const missing = decodeAnimFromPool(pool, fakeDecompress, { archivePath, hash: depotHash("none.anims"), op: "index" });
    expect(missing.ok ? "ok" : missing.kind).toBe("not-indexed");
    const inProcess = new InProcessDecoder(pool, fakeDecompress, { roots: new Set(), identity: "test" }, depotHash);
    const read = await inProcess.decodeAnim({ archivePath, hash: depotHash(RIG), op: "rig" });
    expect(read.ok && read.rig!.bones).toEqual(["Root", "Trajectory", "Hips"]);
    inProcess.close();
    expect((await inProcess.decodeAnim({ archivePath, hash: depotHash(RIG), op: "rig" })).ok).toBe(false);
    const worker = new WorkerDecoder({ decompressor: { test: "fakeDecompress" }, roots: new Set(), identity: "test", script: new URL("./fixtures/native-decode-test-worker.ts", import.meta.url) });
    try {
      const answered = await worker.decodeAnim({ archivePath, hash: depotHash(SET), op: "clip", clip: "held", priority: "background" });
      expect(answered.ok && answered.clip!.name).toBe("held");
    } finally { worker.close(); }
  });
});

/** A synthetic installation: the archive above, a TweakDB blob, one TweakXL file, the puppet entity and one ArchiveXL entry. */
function installation(options: { withPackSet?: boolean } = {}): { installation: Installation; gameRoot: string; cacheDir: string } {
  const gameRoot = join(root, "game"), cacheDir = join(root, "cache");
  mkdirSync(join(gameRoot, "r6", "cache"), { recursive: true });
  const inline = tweakDbId("Character.Player_Puppet_Photomode_inline0");
  writeFileSync(join(gameRoot, "r6", "cache", "tweakdb.bin"), tweakDbBlob([
    ["Character.Player_Puppet_Photomode.genders", { type: "array:TweakDBID", value: [inline] }],
    [childId(inline, ".gender"), { type: "TweakDBID", value: tweakDbId("Gender.Female") }],
    [childId(inline, ".entity"), { type: "raRef:CResource", value: BigInt(depotHash(PUPPET)) }],
    ["photo_mode.character.femalePoses", { type: "array:String", value: ["PhotoModePoses.idle_stand_01"] }],
    ["photo_mode.character.poseCategories", { type: "array:String", value: ["PhotoModePoseCategories.idleCategory"] }],
    ["PhotoModePoseCategories.idleCategory.categoryName", { type: "CName", value: "PhotoModePoseCategories.idleCategory" }],
    ["PhotoModePoses.idle_stand_01.animationName", { type: "CName", value: "idle_stand_01" }],
    ["PhotoModePoses.idle_stand_01.category", { type: "CName", value: "PhotoModePoseCategories.idleCategory" }],
    ["PhotoModePoses.idle_stand_01.displayName", { type: "CName", value: "Tabula Rasa" }],
  ]));
  const yaml = join(root, "pack.yaml");
  writeFileSync(yaml, ["PhotoModePoses.pack_01:", "  $base: PhotoModePoses.idle_stand_01", "  animationName: pack_moving", "  displayName: 01",
    "photo_mode.character.femalePoses:", "  - !append-once PhotoModePoses.pack_01"].join("\n"));
  const mounted = { id: archivePath, name: "poses.archive", virtualPath: "archive/pc/content/poses.archive", group: "content", provider: "game", providerName: "Installed game",
    rank: 0, shadowed: [] };
  const held = new Set([depotHash(SET), depotHash(RIG), ...(options.withPackSet === false ? [] : [depotHash(PACK_SET)])]);
  const decoder = new InProcessDecoder(new NativeArchivePool(fakeDecompress), fakeDecompress, { roots: new Set(), identity: "test" }, depotHash);
  const entity = { components: [{ $type: "entAnimatedComponent", name: { $value: "root" },
    animations: { gameplay: [{ $type: "animAnimSetupEntry", animSet: { DepotPath: { $storage: "string", $value: SET } }, priority: 128 }] } }] };
  const xl = readArchiveXlConfig([{ id: "archive/pc/mod/pack.xl", document: { animations: [{ entity: PUPPET, set: PACK_SET }] } }]);
  const fake = {
    plan: { ep1Installed: false },
    tweaks: [{ virtualPath: "r6/tweaks/pack.yaml", physicalPath: yaml, providerName: "A pose pack", sizeBytes: 1, modifiedMs: Date.now() }],
    xl,
    graph: {
      lookup: (hash: string) => ({ winner: held.has(hash) ? mounted : null, candidates: [], ambiguities: [] }),
      load: async (ref: { hash: string }) => ref.hash === depotHash(PUPPET) ? { root: entity, provenance: { ref: { hash: ref.hash, path: PUPPET } } } : null,
    },
    fetcher: { nativeDecoder: decoder, tool: "none", wolvenKit: { available: false } },
    native: { decoder },
  };
  return { installation: fake as unknown as Installation, gameRoot, cacheDir };
}

describe("the catalogue host", () => {
  test("builds from the installation's own files, caches set indexes by archive identity, and samples a pose on its rig", async () => {
    const { installation: inst, gameRoot, cacheDir } = installation();
    const first = await loadPoseCatalogue(inst, { gameRoot, cacheDir, bodyGender: "female", language: "en-us" });
    expect(first.catalogue.entries.map(e => [e.id, e.label, e.clip?.set, e.badges])).toEqual([
      ["PhotoModePoses.idle_stand_01", "Tabula Rasa", SET, []], ["PhotoModePoses.pack_01", "01", PACK_SET, ["moves"]]]);
    expect(first.evidence.puppet).toBe(PUPPET);
    expect(first.evidence.timings.setsRead).toBe(2);
    const again = await loadPoseCatalogue(inst, { gameRoot, cacheDir, bodyGender: "female", language: "en-us" });
    expect([again.evidence.timings.setsRead, again.evidence.timings.setsCached]).toEqual([0, 2]);
    // A set whose archive doesn't hold it isn't appended (ArchiveXL skips it): the pack's pose has no clip.
    const without = installation({ withPackSet: false });
    const partial = await loadPoseCatalogue(without.installation, { gameRoot, cacheDir, bodyGender: "female", language: "en-us" });
    expect(partial.catalogue.entries.find(e => e.id === "PhotoModePoses.pack_01")!.clip).toBeNull();

    const host = new PoseCatalogueHost({ route: () => ({ gameRoot, launchRoute: "direct", wolvenKitCli: null }), fingerprint: () => "one",
      resolverCache: cacheDir, open: () => inst, language: () => "en-us" });
    expect(host.state("female").phase).toBe("preparing");
    await host.ensure("female");
    const state = host.state("female");
    expect(state.phase === "ready" && state.catalogue.counts.listed).toBe(2);
    const sample = await host.sample("female", "PhotoModePoses.idle_stand_01");
    expect(sample?.clip).toEqual({ name: "idle_stand_01", set: SET, frames: 2, duration: 1 });
    expect(sample?.joints.map(j => [j.bone, j.parent, j.keyed])).toEqual([["Root", null, false], ["Trajectory", "Root", true], ["Hips", "Root", true]]);
    // Root keeps the rig's reference; Hips is keyed at t = 0 (position 1 on Z).
    expect(sample?.joints[0]!.translation).toEqual([0, 0, 0]);
    expect(sample?.joints[2]!.translation).toEqual([0, 0, 1]);
    expect(sample?.tracks).toEqual({ a: 0, b: 0.5 });
    expect(await host.sample("female", "PhotoModePoses.nowhere")).toBeNull();
    expect(new PoseCatalogueHost({ route: () => null, fingerprint: () => "", resolverCache: cacheDir }).state("female").phase).toBe("needs-setup");
  });
});

describe("the endpoint and the actions", () => {
  const ready = { schema: "xfs/pose-catalogue-state-1" as const, phase: "ready" as const, message: "", evidence: {} as never,
    catalogue: { entries: [{ id: "PhotoModePoses.a", clip: { decodable: true } }, { id: "PhotoModePoses.b", clip: null }] } as never };
  const sample = { schema: "xfs/pose-sample-1", id: "PhotoModePoses.a" };
  const host = { state: () => ready, retry: () => ready, sample: async (_: string, id: string) => id === "PhotoModePoses.a" ? sample as never : null };
  const handler = createPoseHandler(host);
  const base = "http://127.0.0.1:4999/api/poses";

  test("GET answers the state and a sample; POST retries; refusals have codes", async () => {
    expect((await (await handler(new Request(`${base}?gender=female`))).json()).phase).toBe("ready");
    expect((await handler(new Request(`${base}?gender=female&pose=PhotoModePoses.a`))).status).toBe(200);
    expect((await (await handler(new Request(`${base}?gender=female&pose=PhotoModePoses.b`))).json()).code).toBe("missing_target");
    expect((await handler(new Request(`${base}?gender=robot`))).status).toBe(400);
    expect((await handler(new Request(`${base}?gender=female&pose=${encodeURIComponent("a b<c>")}`))).status).toBe(400);
    expect((await handler(new Request(base.replace("127.0.0.1", "localhost") + "?gender=female"))).status).toBe(403);
    const post = (body: unknown, headers: Record<string, string> = { "Content-Type": "application/json", Origin: "http://127.0.0.1:4999" }) =>
      handler(new Request(base, { method: "POST", headers, body: JSON.stringify(body) }));
    expect((await post({ kind: "retry", bodyGender: "female" })).status).toBe(200);
    expect((await post({ kind: "other", bodyGender: "female" })).status).toBe(400);
    expect((await post({ kind: "retry", bodyGender: "female" }, { "Content-Type": "application/json", Origin: "http://evil.test" })).status).toBe(403);
    expect([isPoseId("PhotoModePoses.x_01"), isPoseId("x".repeat(513)), isPoseId("a/b")]).toEqual([true, false, false]);
  });

  test("the actions read through a transport, check capabilities first and keep detached snapshots", async () => {
    expect(Object.keys(POSE_DESCRIPTORS).sort()).toEqual(["poses.load", "poses.retry", "poses.sample"]);
    for (const descriptor of Object.values(POSE_DESCRIPTORS)) expect([descriptor.scope, descriptor.effect]).toEqual([["host"], "read"]);
    const calls: unknown[] = [];
    const actions = new PoseActions(async request => {
      calls.push(request);
      if (request.method === "GET" && request.query.pose) return { ok: true, status: 200, data: sample };
      return { ok: true, status: 200, data: ready };
    });
    expect(actions.descriptors()).toEqual(POSE_DESCRIPTORS);
    expect(actions.capability({ kind: "poses.sample", bodyGender: "female", id: "PhotoModePoses.a" }).available).toBe(false);
    expect(await actions.dispatch({ kind: "poses.load", bodyGender: "female" })).toEqual({ ok: true });
    expect(actions.capability({ kind: "poses.sample", bodyGender: "female", id: "PhotoModePoses.b" }).reason).toContain("isn't installed");
    expect(await actions.dispatch({ kind: "poses.sample", bodyGender: "female", id: "PhotoModePoses.a" })).toEqual({ ok: true });
    expect(actions.snapshot().sample).toEqual(sample as never);
    expect(await actions.dispatch({ kind: "poses.retry", bodyGender: "female" })).toEqual({ ok: true });
    expect(calls).toEqual([{ method: "GET", query: { gender: "female" } }, { method: "GET", query: { gender: "female", pose: "PhotoModePoses.a" } },
      { method: "POST", body: { kind: "retry", bodyGender: "female" } }]);
    const wrong = new PoseActions(async () => ({ ok: true, status: 200, data: { schema: "other" } }));
    expect((await wrong.dispatch({ kind: "poses.load", bodyGender: "male" })).ok).toBe(false);
    expect(new PoseActions(null).capability({ kind: "poses.load", bodyGender: "female" }).available).toBe(false);
  });
});
