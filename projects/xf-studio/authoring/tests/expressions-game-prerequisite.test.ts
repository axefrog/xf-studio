/**
 * The expressions exporter's host prerequisite (`expressions/game`): a Check's background read and a Build share one read per route and
 * installation, each read works in its own folder (PIPE-117), a prepared file belongs to one installation fingerprint (PIPE-118), the game's
 * own table and face rig come from the base archives only (PIPE-119), and damaged inputs refuse plainly. Synthetic documents only.
 */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refFromPath } from "../src/depot-path";
import { encodeStaticFace } from "../src/engines/facial-rig/clip";
import { EXPRESSION_TABLE, FACE_SETUP, PHOTO_MODE_FACE_RIG } from "../src/facial-catalogue";
import { expressionsGamePrerequisite } from "../src/expressions-game-prerequisite";
import type { FacialExtractor } from "../src/facial-host";
import type { MountedArchive } from "../src/archive-precedence";
import type { Installation } from "../src/resolver-host";
import { ExportRefusal, PrerequisiteStale } from "../src/platform/api";
import { EXPRESSIONS_EXPORTER } from "../src/features/expressions/export";
import { EXPRESSIONS_GAME_PREREQUISITE, readGameInputs } from "../src/features/expressions/export/game";

const TRACKS = ["env_a", "jaw_mid_open", "lips_l_corner_up"];
const JOINTS = new Uint8Array(2 * 16).fill(3);
const cname = (value: string) => ({ $type: "CName", $storage: "string", $value: value });
const doc = (rootChunk: unknown) => ({ Data: { RootChunk: rootChunk } });
const RIG_PATH = "base\\test\\face.rig";
function set(): unknown {
  const neutral = encodeStaticFace(JOINTS, new Float32Array(TRACKS.length));
  return doc({ rig: { DepotPath: { $value: RIG_PATH } }, animationDataChunks: [{ buffer: { Bytes: Buffer.from(neutral).toString("base64") } }],
    animations: [{ Data: { animation: { Data: { name: cname("facial_neutral"), animBuffer: { Data: { numAnimKeys: 0, numConstAnimKeys: 2, numJoints: 1,
      dataAddress: { fsetInBytes: 0, unkIndex: 0 } } } } } } }] });
}
const tableDoc = (prefix: string, count: number) => doc({ compiledHeaders: ["Index", "AnimationName", "streamingContext", "FallbackAnimationName"],
  compiledData: Array.from({ length: count }, (_, i) => [String(i), `${prefix}_${i}`, "photomode", `${prefix}_${i}`]) });

const archive = (name: string, group: MountedArchive["group"], rank: number) =>
  ({ id: name, name, virtualPath: name, group, provider: "game", providerName: group === "mod" ? `${name} (mod)` : "", rank, shadowed: [] }) as unknown as MountedArchive;
const PACK = archive("pack.archive", "mod", 0), BUNDLE = archive("bundle.archive", "archivexl-bundle", 1), BASE = archive("basegame_4_animation.archive", "content", 2);
const hash = (path: string) => refFromPath(path.replaceAll("/", "\\")).hash;
/** What each archive holds, by depot hash. */
const CONTENT = new Map<MountedArchive, Map<string, unknown>>([
  [PACK, new Map([[hash(EXPRESSION_TABLE), tableDoc("pack", 20)]])],
  [BUNDLE, new Map<string, unknown>([[hash(EXPRESSION_TABLE), tableDoc("bundle", 17)], [hash(PHOTO_MODE_FACE_RIG), { bundle: true }]])],
  [BASE, new Map<string, unknown>([[hash(EXPRESSION_TABLE), tableDoc("facial", 15)], [hash(PHOTO_MODE_FACE_RIG), { base: true }],
    [hash(FACE_SETUP), doc({ info: { tracksMapping: { numEnvelopes: 1, numMainPoses: 2 } } })],
    [hash("base/animations/ui/photomode/photomode_female_facial.anims"), set()], [hash("base/animations/ui/photomode/photomode_male_facial.anims"), set()],
    [hash(RIG_PATH), doc({ trackNames: TRACKS.map(cname) })]])],
]);
const installation = { plan: { modOrder: "alphabetical" }, graph: { locate(ref: { hash: string }) {
  const candidates = [PACK, BUNDLE, BASE].filter(item => CONTENT.get(item)!.has(ref.hash));
  return { entry: ref, lookup: { winner: candidates[0] ?? null, candidates } };
} } } as unknown as Installation;

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A prerequisite over the synthetic game, with a gate each extraction waits on and a record of every extraction and work folder. */
function harness(fingerprint = { value: "install-A" }) {
  const cacheRoot = mkdtempSync(join(tmpdir(), "xfs-expr-game-"));
  roots.push(cacheRoot);
  const calls: { archive: string; work: string }[] = [];
  let open: () => void = () => {}, gate = Promise.resolve();
  const hold = () => { gate = new Promise<void>(resolve => { open = resolve; }); };
  const extract: FacialExtractor = async (_cli, from, resources, work, take, signal) => {
    calls.push({ archive: from.name, work });
    // Each read writes into its work folder, as WolvenKit does; another read's cleanup must never remove it underneath.
    const marker = join(work, `${from.name}-${calls.length}.json`);
    writeFileSync(marker, "{}");
    await gate;
    if (signal?.aborted) throw Error("aborted");
    if (!existsSync(marker)) throw Error("the work folder was removed underneath this read");
    for (const resource of resources) {
      const value = CONTENT.get(from)!.get(resource.hash);
      if (value !== undefined) take(resource.hash, JSON.stringify(value));
    }
  };
  const prerequisite = expressionsGamePrerequisite({ route: { gameRoot: "C:\\Game", launchRoute: "direct" }, wolvenKitCli: "wk.exe", cacheRoot,
    resolverCache: join(cacheRoot, "resolver"), extract, acquire: async () => installation, fingerprint: () => fingerprint.value });
  return { prerequisite, calls, hold, release: () => open(), fingerprint, folder: join(cacheRoot, "expressions-game") };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(condition: () => boolean) { for (let i = 0; i < 400 && !condition(); i++) await flush(); expect(condition()).toBe(true); }
/** Extractions in one read: the two tables, the face rig, the setup, and each gender's set and skeleton. */
const READS = 8;

test("a Build joins the read a Check started, and each read works in a folder of its own (PIPE-117)", async () => {
  const { prerequisite, calls, hold, release, folder } = harness();
  hold();
  expect(prerequisite.cached()).toBeNull();
  await flush();
  const readsOfOne = calls.length;
  expect(readsOfOne).toBeGreaterThan(0);
  const build = prerequisite.prepare(new AbortController().signal);
  await flush();
  // The Build asked for nothing of its own: it waits on the Check's read.
  expect(calls.length).toBe(readsOfOne);
  release();
  const prepared = await build;
  expect(existsSync((prepared.builder as { file: string }).file)).toBe(true);
  // The read's work folder is its own (not the shared `tmp`), and it is gone once the read is done.
  const works = new Set(calls.map(call => call.work));
  expect(works.size).toBe(1);
  const [work] = [...works];
  expect(work).not.toBe(join(folder, "tmp"));
  expect(existsSync(work!)).toBe(false);
  // The next Check plans on it without reading again.
  expect(prerequisite.cached()).toEqual(prepared.plan);
  expect(calls.length).toBe(READS);
});

test("a Build for a changed installation stops the older background read and reads for its own (PIPE-117, PIPE-118)", async () => {
  const { prerequisite, calls, hold, release, fingerprint } = harness();
  hold();
  expect(prerequisite.cached()).toBeNull();
  await flush();
  const first = calls[0]!.work;
  fingerprint.value = "install-B";
  const build = prerequisite.prepare(new AbortController().signal);
  await flush();
  release();
  const prepared = await build;
  expect(calls.some(call => call.work !== first)).toBe(true);
  expect(prerequisite.cached()).toEqual(prepared.plan);
  // Only the current installation's file is planned on.
  fingerprint.value = "install-A";
  expect(prerequisite.cached()).toBeNull();
});

test("a prepared file of another installation or reader is provisional: Check says so and reads afresh (PIPE-118)", async () => {
  const { prerequisite, calls, fingerprint } = harness();
  const prepared = await prerequisite.prepare(new AbortController().signal);
  expect(calls.length).toBe(READS);
  expect(prerequisite.cached()).toEqual(prepared.plan);
  expect(calls.length).toBe(READS);
  // The mods changed (for example an expression pack removed): the old read isn't planned on, and the files are read again.
  fingerprint.value = "install-B";
  expect(prerequisite.cached()).toBeNull();
  await until(() => prerequisite.cached() !== null);
  expect(calls.length).toBe(READS * 2);
  expect(prerequisite.cached()).toEqual(prepared.plan);
  // A Build cancelled while it waits stops with a cancellation, not a hang.
  fingerprint.value = "install-C";
  const cancel = new AbortController();
  const waiting = prerequisite.prepare(cancel.signal);
  cancel.abort();
  await expect(waiting).rejects.toMatchObject({ code: "package_build_cancelled" });
  // Old prepared files are pruned to a few per route.
  await flush();
  fingerprint.value = "install-D";
  await prerequisite.prepare(new AbortController().signal);
  fingerprint.value = "install-E";
  await prerequisite.prepare(new AbortController().signal);
  expect(readdirSync(join((prepared.builder as { file: string }).file, "..")).filter(name => name.endsWith(".json")).length).toBeLessThanOrEqual(3);
});

test("the game's own table and face rig come from the base archives, never ArchiveXL's bundle (PIPE-119)", async () => {
  const { prerequisite } = harness();
  const prepared = await prerequisite.prepare(new AbortController().signal);
  const plan = prepared.plan as { table: { archive: string; provider: string; rows: unknown[] }; base: { archive: string; provider: string; rows: unknown[] } };
  expect([plan.table.archive, plan.table.provider, plan.table.rows.length]).toEqual(["pack.archive", "pack.archive (mod)", 20]);
  expect([plan.base.archive, plan.base.provider, plan.base.rows.length]).toEqual(["basegame_4_animation.archive", "Base game", 15]);
  const file = JSON.parse(await Bun.file((prepared.builder as { file: string }).file).text()) as { faceRig: unknown };
  expect(file.faceRig).toEqual({ base: true });
});

test("damaged game inputs refuse plainly, and a damaged prepared file is stale for the builder (PIPE-118)", async () => {
  expect(() => readGameInputs({ schema: "nope" })).toThrow(ExportRefusal);
  const cacheRoot = mkdtempSync(join(tmpdir(), "xfs-expr-damaged-"));
  roots.push(cacheRoot);
  const file = join(cacheRoot, "prepared.json");
  writeFileSync(file, JSON.stringify({ plan: { schema: "xfs/expressions-game-1" } }));
  const buildInputs = EXPRESSIONS_EXPORTER.buildInputs!;
  const error = await (buildInputs as (context: unknown) => Promise<unknown>)({ prerequisites: { [EXPRESSIONS_GAME_PREREQUISITE]: { file } } })
    .then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(PrerequisiteStale);
  expect((error as PrerequisiteStale).prerequisite).toBe(EXPRESSIONS_GAME_PREREQUISITE);
});
