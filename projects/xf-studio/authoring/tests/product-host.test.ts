/**
 * `runProductBuild`, the package host service both hosts run (PIPE-03): prerequisites prepared, the builder run
 * once (here in-process, with WolvenKit stand-ins), its answer gated against the host's own plan in the stage root,
 * candidates moved into the store and gated again; one retry after a stale prerequisite; deadlines, cancellation
 * and plain error codes.
 */
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProductBuild, builderError, type BuilderRun, type HostPrerequisite, type PackageHostAdapter } from "../src/platform/export/product-host";
import { runProductCommand } from "../src/platform/export/product-builder";
import { ExportRefusal, PrerequisiteStale, type FeatureExporterEntry, type PackageBuildResult } from "../src/platform/api";
import { EYE_PLATE_PREREQUISITE } from "../src/features/eye-makeup";
import { packagePlateRecord, type EyePlateManifest } from "../src/eye-plate-service";
import { PLATE_UV_FILE, plateReachInput, plateUvManifestRecord } from "../src/plate-uv-footprint-io";
import { localCheckWorker } from "../src/package-server";
import { eyeEntry, fakeTools, fakeVerifierTools, FOOTPRINT, writePlate } from "./fixtures/product-fixture";

const fixture = JSON.parse(readFileSync(join(import.meta.dir, "../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-product-host-")));
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
