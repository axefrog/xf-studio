/**
 * `runProductBuild`, the package host service both hosts run (PIPE-03): prerequisites prepared, the builder run
 * once (here in-process, with WolvenKit stand-ins), its answer gated against the host's own plan in the stage root,
 * candidates moved into the store and gated again; one retry after a stale prerequisite; deadlines, cancellation
 * and plain error codes.
 */
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PackageHostService, runProductBuild, builderError, type BuilderRun, type HostPrerequisite, type PackageHostAdapter } from "../src/platform/export/product-host";
import { runProductCommand } from "../src/platform/export/product-builder";
import { ExportRefusal, PACKAGE_PLAN_1, PrerequisiteStale, type FeatureExporterEntry, type PackageBuildResult } from "../src/platform/api";
import { EYE_PLATE_MASCULINE_PREREQUISITE, EYE_PLATE_PREREQUISITE } from "../src/features/eye-makeup";
import { packagePlateRecord, type EyePlateManifest } from "../src/legacy/eye-makeup/plate/host/eye-plate-service";
import { PLATE_UV_FILE, plateReachInput, plateUvManifestRecord } from "../src/legacy/eye-makeup/export/host/plate-uv-footprint-io";
import { requestIdentifiedBuild, PackageRequestError } from "../src/legacy/eye-makeup/export/package-action";
import { createPackageHandler, localCheckWorker } from "../src/host/package-server";
import { eyeEntry, fakeTools, fakeVerifierTools, FOOTPRINT, LIPS, LIPS_ENTRY, writePlate } from "./fixtures/product-fixture";
import { tempDir } from "./temp-dir";

const fixture = JSON.parse(readFileSync(join(import.meta.dir, "../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const root = realpathSync.native(tempDir("xfs-product-host-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const arg = (args: readonly string[], name: string) => args[args.indexOf(name) + 1];

/** A host adapter whose builder runs `runProductCommand` in-process on the arguments the host passes, as the CLI does. */
function host(options: { exporters?: FeatureExporterEntry[]; plate?: HostPrerequisite; slow?: boolean } = {}) {
  const dir = join(root, crypto.randomUUID());
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "game"), { recursive: true });
  writeFileSync(join(dir, "tools", "WolvenKit.CLI.exe"), "fixture");
  const logs: string[] = [], runs: string[][] = [];
  const exporters = options.exporters ?? [eyeEntry()];
  const packed = new Map<string, string>();
  const { plate: plateDir, manifestFile, manifest } = writePlate(join(dir, "input"));
  const plate: HostPrerequisite = options.plate ?? { cached: () => null, discard() {},
    prepare: async () => ({ builder: { directory: plateDir, manifest: manifestFile },
      plan: { ...plateReachInput(FOOTPRINT), record: packagePlateRecord(manifest as unknown as EyePlateManifest) } }) };
  const adapter: PackageHostAdapter = {
    exporters, prerequisites: { [EYE_PLATE_PREREQUISITE]: plate }, checkWorker: localCheckWorker, buildIssue: () => null,
    buildSetup: () => { const id = crypto.randomUUID(); return { snapshot: join(dir, "snap", id), work: join(dir, "work", id), stage: join(dir, "stage", id),
      candidates: join(dir, "candidates"), wolvenkit: join(dir, "tools", "WolvenKit.CLI.exe"), gamepath: join(dir, "game") }; },
    async runBuilder(args, run): Promise<BuilderRun> {
      runs.push([...args]);
      if (options.slow) await new Promise((done, fail) => { const timer = setTimeout(done, 5_000);
        run.signal.addEventListener("abort", () => { clearTimeout(timer); fail(Error("stopped")); }); }).catch(() => undefined);
      if (run.signal.aborted) return { exitCode: null, stdout: "", stderr: "", stopped: "cancelled" };
      try {
        const result = await runProductCommand({ exporters, collection: arg(args, "--collection"),
          prerequisites: JSON.parse(readFileSync(arg(args, "--prerequisites"), "utf8")), wolvenkit: arg(args, "--wolvenkit"),
          gamepath: arg(args, "--gamepath"), appRoot: join(import.meta.dir, ".."), buildRoot: arg(args, "--build-root"), distRoot: arg(args, "--dist-root"),
          tools: () => fakeTools([], packed), verifierTools: () => fakeVerifierTools(packed) });
        return { exitCode: 0, stdout: "XFS_PACKAGE_RESULT=" + JSON.stringify(result), stderr: "", stopped: null };
      } catch (error) {
        const code = (error as { code?: string }).code ?? "package_build_failed";
        return { exitCode: 1, stdout: "", stopped: null, stderr: "XFS_PACKAGE_ERROR=" + JSON.stringify({ code, message: (error as Error).message,
          ...(error instanceof PrerequisiteStale ? { prerequisite: error.prerequisite } : {}) }) };
      }
    },
    log: (_scope, code, message) => logs.push(`${code}: ${message}`),
  };
  return { dir, adapter, logs, runs, manifestFile, manifest };
}

test("a Build is prepared, run once, gated in the stage root and moved into the candidate store", async () => {
  const { dir, adapter, runs } = host();
  const outcome = await runProductBuild(adapter, fixture, new AbortController().signal);
  if (!outcome.ok) throw Error(outcome.message);
  const result = outcome.result as PackageBuildResult;
  expect(result.products).toHaveLength(1);
  expect(result.products[0].package.startsWith(join(dir, "candidates"))).toBe(true);
  expect(readdirSync(join(dir, "candidates"))).toHaveLength(1);
  // The builder got only host-owned paths: the snapshot, the prerequisites file and private roots.
  expect(runs).toHaveLength(1);
  expect(Object.keys(JSON.parse(readFileSync(join(dir, "candidates", readdirSync(join(dir, "candidates"))[0], "manifest.json"), "utf8"))))
    .toContain("features");
  // Per-build snapshot, work and stage folders are gone afterwards.
  for (const folder of ["snap", "work", "stage"]) expect(existsSync(join(dir, folder)) ? readdirSync(join(dir, folder)) : []).toEqual([]);
}, 60_000);

test("a stale prerequisite is discarded and the Build runs once more on a fresh one (PIPE-37)", async () => {
  let prepared = 0, discarded = 0;
  const base = host();
  const inputs = join(base.dir, "input");
  const moved = { ...FOOTPRINT, uv: FOOTPRINT.uv.map((v, i) => i % 2 ? v : v + .001) };
  const plate: HostPrerequisite = { cached: () => null, discard() { discarded++; },
    async prepare() {
      prepared++;
      // The first preparation is a cached plate whose recorded footprint is another plate's; the second is fresh.
      const footprint = prepared === 1 ? moved : FOOTPRINT;
      writeFileSync(join(inputs, PLATE_UV_FILE), JSON.stringify(footprint));
      writeFileSync(base.manifestFile, JSON.stringify({ ...base.manifest, uv: plateUvManifestRecord(footprint) }));
      return { builder: { directory: join(inputs, "plate"), manifest: base.manifestFile },
        plan: { ...plateReachInput(footprint), record: packagePlateRecord(base.manifest as unknown as EyePlateManifest) } };
    } };
  const { adapter, runs, logs } = host({ plate });
  const outcome = await runProductBuild({ ...adapter, prerequisites: { [EYE_PLATE_PREREQUISITE]: plate } }, fixture, new AbortController().signal);
  expect(outcome.ok).toBe(true);
  expect([prepared, discarded, runs.length]).toEqual([2, 1, 2]);
  expect(logs.some(line => line.startsWith("package_prerequisite_stale"))).toBe(true);
}, 60_000);

test("deadlines, cancellation, refusals and prerequisite failures answer with plain codes and publish nothing", async () => {
  const slow = host({ slow: true });
  const timeout = await runProductBuild(slow.adapter, fixture, new AbortController().signal, 200);
  expect(timeout).toMatchObject({ ok: false, code: "package_build_timeout", status: 504 });
  const cancel = new AbortController();
  const pending = runProductBuild(host({ slow: true }).adapter, fixture, cancel.signal);
  setTimeout(() => cancel.abort(), 100);
  expect(await pending).toMatchObject({ ok: false, code: "package_build_cancelled", status: 499 });
  const refused = structuredClone(fixture);
  for (const preset of refused.presets) for (const layer of preset.recipe.layers) layer.finish = "glitter";
  expect(await runProductBuild(host().adapter, refused, new AbortController().signal)).toMatchObject({ ok: false, code: "no_exportable_content" });
  const missing: HostPrerequisite = { cached: () => null, discard() {},
    prepare: async () => { throw Object.assign(Error("The game's head resource is missing; verify the game files."), { code: "plate_source_missing" }); } };
  const failed = await runProductBuild({ ...host().adapter, prerequisites: { [EYE_PLATE_PREREQUISITE]: missing } }, fixture, new AbortController().signal);
  expect(failed).toEqual({ ok: false, code: "plate_source_missing", message: "The game's head resource is missing; verify the game files.", status: 422 });
  const unready = await runProductBuild({ ...host().adapter, buildIssue: () => "WolvenKit isn't set up yet." }, fixture, new AbortController().signal);
  expect(unready).toEqual({ ok: false, code: "package_build_unavailable", message: "WolvenKit isn't set up yet.", status: 503 });
}, 60_000);

test("a Build cancelled while its setup is probed, or before it starts, prepares and builds nothing (PIPE-140)", async () => {
  const cancelled = { ok: false, code: "package_build_cancelled", status: 499 };
  const prepared: string[] = [];
  const watched = (base: ReturnType<typeof host>, buildIssue: PackageHostAdapter["buildIssue"]): PackageHostAdapter => ({ ...base.adapter, buildIssue,
    prerequisites: { [EYE_PLATE_PREREQUISITE]: { ...base.adapter.prerequisites[EYE_PLATE_PREREQUISITE], prepare: async signal => {
      prepared.push("plate");
      return base.adapter.prerequisites[EYE_PLATE_PREREQUISITE].prepare(signal);
    } } } });
  // The page closes while the desktop host is still probing its tools; the probe then answers "ready".
  const during = host(), cancel = new AbortController();
  const probing = runProductBuild(watched(during, async () => { cancel.abort(); await Bun.sleep(20); return null; }), fixture, cancel.signal);
  expect(await probing).toMatchObject(cancelled);
  expect(prepared).toEqual([]);
  expect(during.runs).toEqual([]);
  // A request whose signal is already aborted does not even probe.
  const before = host(), aborted = new AbortController();
  aborted.abort();
  let probed = false;
  expect(await runProductBuild(watched(before, () => { probed = true; return null; }), fixture, aborted.signal)).toMatchObject(cancelled);
  expect(probed).toBe(false);
  expect(prepared).toEqual([]);
  expect(before.runs).toEqual([]);
}, 60_000);

test("cancelling during a slow readiness probe settles at once and frees the service; a cancel during one prerequisite starts no other (PIPE-140)", async () => {
  // The probe answers only after a minute; the cancelled Build must not wait for it.
  let answer = (_issue: string | null) => {};
  const probe = new Promise<string | null>(done => { answer = done; });
  const service = new PackageHostService(), cancel = new AbortController(), slow = host();
  const pending = service.run({ ...slow.adapter, buildIssue: () => probe }, "build", fixture, cancel.signal);
  await Bun.sleep(20);
  cancel.abort();
  const settled = await Promise.race([pending, Bun.sleep(2_000).then(() => "still waiting")]);
  expect(settled).toMatchObject({ ok: false, code: "package_build_cancelled", status: 499 });
  expect(service.busy("build")).toBe(false);
  expect(slow.runs).toEqual([]);
  answer(null);
  // Two prerequisites: the page closes while the first is prepared, which finishes without heeding the signal.
  const started: string[] = [], base = host(), during = new AbortController();
  const plate = base.adapter.prerequisites[EYE_PLATE_PREREQUISITE];
  const adapter: PackageHostAdapter = { ...base.adapter, prerequisites: {
    [EYE_PLATE_PREREQUISITE]: { ...plate, prepare: async signal => { started.push("plate"); during.abort(); return plate.prepare(signal); } },
    [EYE_PLATE_MASCULINE_PREREQUISITE]: { cached: () => null, discard() {}, prepare: async () => { started.push("masculine"); throw Error("not reached"); } } } };
  expect(await runProductBuild(adapter, fixture, during.signal)).toMatchObject({ ok: false, code: "package_build_cancelled" });
  expect(started).toEqual(["plate"]);
  expect(base.runs).toEqual([]);
}, 60_000);

test("a builder answer that differs from the host's own plan is refused", async () => {
  const { adapter } = host();
  const tampered: PackageHostAdapter = { ...adapter, async runBuilder(args, run) {
    const out = await adapter.runBuilder(args, run);
    return { ...out, stdout: out.stdout.replace(/"modName":"XF Eye Artistry"/, '"modName":"Other"') };
  } };
  expect(await runProductBuild(tampered, fixture, new AbortController().signal)).toMatchObject({ ok: false, code: "package_build_failed" });
}, 60_000);

test("the builder's machine error line is read back by code, message and stale prerequisite", () => {
  expect(builderError(`log\nXFS_PACKAGE_ERROR=${JSON.stringify({ code: "package_prerequisite_stale", message: "stale", prerequisite: "eye-makeup/plate" })}\nPackage build failed: stale`))
    .toEqual({ code: "package_prerequisite_stale", message: "stale", prerequisite: "eye-makeup/plate" });
  expect(builderError("Package build failed: no machine line")).toEqual({ code: null });
  expect(builderError("XFS_PACKAGE_ERROR={not json")).toEqual({ code: null });
  expect(new ExportRefusal("x", "y").code).toBe("x");
});

test("several products move into the store all or nothing (PIPE-92)", async () => {
  const collection = { schema: "xfs/collection-2", id: fixture.id, name: fixture.name,
    packagePlan: { schema: PACKAGE_PLAN_1, products: [{ id: "11111111-2222-4333-8444-555555555555", features: [LIPS] }] },
    presets: fixture.presets.map((preset: { id: string; name: string; revision: number; recipe: unknown }) => ({ id: preset.id, name: preset.name,
      revision: preset.revision, parts: { "eye-makeup": { schema: "xfs/eye-makeup-part-1", body: preset.recipe },
        [LIPS]: { schema: "xfs/lips-part-1", body: { shades: ["#aa3355"] } } } })) };
  // Both products build and move in together.
  const both = host({ exporters: [eyeEntry(), LIPS_ENTRY] });
  const built = await runProductBuild(both.adapter, collection, new AbortController().signal);
  if (!built.ok) throw Error(built.message);
  expect((built.result as PackageBuildResult).products).toHaveLength(2);
  expect(readdirSync(join(both.dir, "candidates"))).toHaveLength(2);
  // The second product can't move in (its folder name is taken): the first one is not left behind in the store either.
  const clash = host({ exporters: [eyeEntry(), LIPS_ENTRY] });
  const blocked: PackageHostAdapter = { ...clash.adapter, async runBuilder(args, run) {
    const out = await clash.adapter.runBuilder(args, run);
    const line = out.stdout.split(/\r?\n/).find(item => item.startsWith("XFS_PACKAGE_RESULT="))!;
    const result = JSON.parse(line.slice("XFS_PACKAGE_RESULT=".length)) as PackageBuildResult;
    mkdirSync(join(clash.dir, "candidates", basename(result.products[1].package)), { recursive: true });
    return out;
  } };
  expect(await runProductBuild(blocked, collection, new AbortController().signal)).toMatchObject({ ok: false, code: "package_build_failed" });
  expect(readdirSync(join(clash.dir, "candidates"))).toHaveLength(1);
}, 120_000);


const latch = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
/** The real shared host and localhost route, with only HTTP delivery under test control. */
function buildConnection(adapter: PackageHostAdapter) {
  const handler = createPackageHandler(() => adapter);
  return async (path: string, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers); headers.set("Origin", "http://127.0.0.1:4565");
    const request = new Request(`http://127.0.0.1:4565${path}`, { ...init, headers });
    return path.startsWith("/api/package/progress") ? handler.progress(request) : handler(request);
  };
}
const buildPost = (action: string, buildId: string, collection?: unknown): RequestInit => ({ method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, buildId, ...(collection ? { collection } : {}) }) });

test("identified Build forwards its host stages and stops forwarding on abort (UI-142)", async () => {
  const abort = new AbortController(), stages = ["prepare", "compose", "convert", "pack", "verify"] as const;
  const seen: string[] = [];
  let reads = 0;
  const client = requestIdentifiedBuild({}, abort.signal, {
    id: () => "expression-build", pause: () => Bun.sleep(1),
    onProgress: progress => { seen.push(progress.stage); if (progress.stage === "convert") abort.abort(); },
    send: async (path, init) => {
      if (path === "/api/package") {
        if (JSON.parse(init.body as string).action === "build") return new Promise<Response>(() => {});
        return Response.json({ phase: "finished", outcome: { ok: false, code: "package_build_cancelled", message: "Stopped", status: 499 } });
      }
      expect(path).toContain("buildId=expression-build");
      const index = Math.min(reads++, 4);
      return Response.json({ status: { phase: "running" }, build: { stage: stages[index], step: index + 1, steps: 5 } });
    },
  });
  await expect(client).rejects.toMatchObject({ code: "package_build_cancelled" });
  expect(seen).toEqual(["prepare", "compose", "convert"]);
  expect(reads).toBe(3);
});

test("a set's identified Build keeps omission reasons on refusal, including a reconciled refusal (UI-142)", async () => {
  const omissions = [{ kind: "preset", presetId: "p", presetName: "Blank", reason: "No face movements." }];
  for (const lost of [false, true]) {
    const result = requestIdentifiedBuild({}, undefined, { pause: () => Bun.sleep(1), send: async path => {
      if (path === "/api/package") {
        if (lost) throw Error("Lost response");
        return Response.json({ code: "no_exportable_content", error: "Nothing to build.", omissions }, { status: 422 });
      }
      return Response.json({ status: { phase: "finished", outcome: { ok: false, code: "no_exportable_content", message: "Nothing to build.", status: 422, omissions } } });
    } });
    await expect(result).rejects.toMatchObject({ code: "no_exportable_content", omissions });
  }
});

for (const loseReplies of [false, true]) test(`Stop waits for real host cleanup, double Stop is idempotent, and rebuild waits${loseReplies ? "; lost replies reconcile" : ""}`, async () => {
  const h = host(), staged = latch(), cleanup = latch();
  const run = h.adapter.runBuilder;
  let first = true;
  h.adapter.runBuilder = async (args, options) => {
    const built = await run(args, options);
    if (first) { first = false; staged.release(); await cleanup.promise; }
    return built;
  };
  const send = buildConnection(h.adapter), id = crypto.randomUUID(), abort = new AbortController();
  let settled = false, statusReads = 0;
  const client = requestIdentifiedBuild(fixture, abort.signal, { id: () => id, pause: () => Bun.sleep(2), send: async (path, init) => {
    const response = await send(path, init);
    if (loseReplies && path === "/api/package") throw Error("Response lost after host processed it");
    if (path.includes("progress")) { statusReads++; if (loseReplies && statusReads === 1) throw Error("Connection lost"); }
    return response;
  } }).then(result => { settled = true; return result; }, error => { settled = true; return error; });
  await staged.promise;
  abort.abort();
  expect((await (await send("/api/package", buildPost("stop", id))).json()).phase).toBe("stopping");
  expect((await (await send("/api/package", buildPost("stop", id))).json()).phase).toBe("stopping");
  expect(settled).toBe(false);
  const during = await send("/api/package", buildPost("build", crypto.randomUUID(), fixture));
  expect(during.status).toBe(409);
  expect((await during.json()).error).toContain("Wait for it to finish");
  expect(readdirSync(join(h.dir, "stage"))).toHaveLength(1);
  cleanup.release();
  const result = await client;
  expect(result).toBeInstanceOf(PackageRequestError);
  expect(result.code).toBe("package_build_cancelled");
  for (const folder of ["snap", "work", "stage", "candidates"])
    expect(existsSync(join(h.dir, folder)) ? readdirSync(join(h.dir, folder)) : []).toEqual([]);
  expect((await (await send(`/api/package/progress?buildId=${id}`, { method: "GET" })).json()).status)
    .toMatchObject({ phase: "finished", outcome: { ok: false, code: "package_build_cancelled" } });
  expect((await send("/api/package", buildPost("build", crypto.randomUUID(), fixture))).status).toBe(200);
  if (loseReplies) expect(statusReads).toBeGreaterThan(1);
}, 60_000);

for (const stopLate of [true, false]) test(stopLate ? "Stop after host promotion wins completion despite delayed POST delivery" : "a lost completed response reconciles without building twice", async () => {
  const h = host(), send = buildConnection(h.adapter), promoted = latch(), deliver = latch(), abort = new AbortController(), id = crypto.randomUUID();
  let posts = 0;
  const client = requestIdentifiedBuild(fixture, abort.signal, { id: () => id, pause: () => Bun.sleep(2), send: async (path, init) => {
    const response = await send(path, init);
    if (path === "/api/package" && JSON.parse(init.body as string).action === "build") {
      posts++; promoted.release();
      if (stopLate) await deliver.promise; else throw Error("Completed response lost");
    }
    return response;
  } });
  await promoted.promise;
  expect(readdirSync(join(h.dir, "candidates"))).toHaveLength(1);
  if (stopLate) abort.abort();
  const result = await client;
  expect(result.schema).toBe("xfs/package-build-2");
  expect(existsSync(result.products[0].package)).toBe(true);
  expect(posts).toBe(1);
  expect((await (await send("/api/package", buildPost("stop", id))).json()).outcome.ok).toBe(true);
  deliver.release();
}, 60_000);


test("an unknown or evicted Build ID never claims stopped and cannot start work later", async () => {
  const service = new PackageHostService(), h = host(), id = crypto.randomUUID();
  const answer = service.stopBuild(id);
  expect(answer).toMatchObject({ phase: "finished", outcome: { ok: false, code: "package_build_unknown" } });
  expect(JSON.stringify(answer)).not.toContain("Build stopped.");
  expect(await service.run(h.adapter, "build", fixture, new AbortController().signal, undefined, id))
    .toMatchObject({ ok: false, code: "package_build_unknown" });
  expect(h.runs).toHaveLength(0);
  const complete = crypto.randomUUID();
  expect(await service.run(h.adapter, "build", fixture, new AbortController().signal, undefined, complete)).toMatchObject({ ok: true });
  for (let i = 0; i < 65; i++) service.stopBuild(crypto.randomUUID());
  expect(service.buildStatus(complete).phase).toBe("unknown");
  expect(service.stopBuild(complete)).toMatchObject({ phase: "finished", outcome: { ok: false, code: "package_build_unknown" } });
  expect(readdirSync(join(h.dir, "candidates"))).toHaveLength(1); // the completed candidate is never labelled as removed
}, 60_000);
