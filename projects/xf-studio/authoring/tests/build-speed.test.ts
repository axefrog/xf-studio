// PIPE-130 and PIPE-131: the plate's kept WolvenKit JSON (and when it is not read), the Build's bounded WolvenKit
// concurrency, the batched conversions, stdout progress lines and the host's stage snapshot.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { keptJsonDirectory, publishKeptJson, readKeptJson } from "../src/derived-cache";
import { concurrencyGate } from "../src/package-build-wolvenkit";
import { runProcessTree } from "../src/process-tree";
import { builderStage, PackageHostService, type PackageHostAdapter } from "../src/platform/export/product-host";
import { runProductCommand, type ProductCommandOptions } from "../src/platform/export/product-builder";
import { PACKAGE_PROGRESS_PREFIX, type PackageBuildProgress, type PackageBuildResult, type PackageBuildStage } from "../src/platform/api";
import { packageBuildStageLine } from "../src/package-action";
import { EYE_PLATE_PREREQUISITE } from "../src/features/eye-makeup";
import { eyeEntry, fakeEyeVerifier, fakeTools, fakeVerifierTools, PLATE, writePlate } from "./fixtures/product-fixture";

const root = realpathSync.native(mkdtempSync(join(tmpdir(), "xfs-build-speed-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const app = resolve(import.meta.dir, "..");
const fixture = JSON.parse(readFileSync(resolve(app, "../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));

/** A plate entry with resources and WolvenKit-like JSON for them, kept for `identity`. */
function keptPlate(identity = "wolvenkit:9.0.1:test") {
  const dir = resolve(root, crypto.randomUUID()), work = join(dir, "work");
  const { plate, manifestFile } = writePlate(dir);
  mkdirSync(work, { recursive: true });
  const mesh = join(plate, "xfs_eye_plate.mesh"), morph = join(plate, "xfs_eye_plate.morphtarget");
  writeFileSync(join(work, "xfs_eye_plate.mesh.json"), JSON.stringify(PLATE.mesh));
  writeFileSync(join(work, "xfs_eye_plate.morphtarget.json"), JSON.stringify(PLATE.morph));
  const json = publishKeptJson(keptJsonDirectory(dir, identity), identity,
    new Map([[mesh, join(work, "xfs_eye_plate.mesh.json")], [morph, join(work, "xfs_eye_plate.morphtarget.json")]]));
  return { dir, plate, manifestFile, mesh, morph, json, identity };
}

test("the plate's kept JSON is read only for the same resource bytes, the same WolvenKit and undamaged documents", () => {
  const kept = keptPlate();
  const read = () => readKeptJson(kept.json, kept.identity, [kept.mesh, kept.morph]);
  expect(Object.keys(read()!).sort()).toEqual(["xfs_eye_plate.mesh", "xfs_eye_plate.morphtarget"]);
  expect(JSON.parse(readFileSync(read()!["xfs_eye_plate.mesh"]!, "utf8"))).toEqual(PLATE.mesh);
  // Another WolvenKit, or a set of resources the record doesn't name exactly.
  expect(readKeptJson(kept.json, "wolvenkit:9.1.0:other", [kept.mesh, kept.morph])).toBeNull();
  expect(readKeptJson(kept.json, kept.identity, [kept.mesh])).toBeNull();
  // A document changed in place (same length): the host's length check passes it, the builder's hash check doesn't.
  const document = join(kept.json, "xfs_eye_plate.mesh.json"), original = readFileSync(document, "utf8");
  writeFileSync(document, original.replace(/\d(?!.*\d)/s, digit => String((Number(digit) + 1) % 10)));
  expect(readKeptJson(kept.json, kept.identity, [kept.mesh, kept.morph], {}, false)).not.toBeNull();
  expect(read()).toBeNull();
  writeFileSync(document, original);
  expect(read()).not.toBeNull();
  // The plate itself changed (another head, a game patch or a mod changed the cut): its JSON is never read for it.
  writeFileSync(kept.morph, "morph fixture, changed");
  expect(read()).toBeNull();
  // Republishing replaces the folder atomically, and each WolvenKit gets a folder of its own.
  expect(keptJsonDirectory(kept.dir, "a")).not.toBe(keptJsonDirectory(kept.dir, "b"));
});

test("at most the gate's limit of WolvenKit steps run at once, in the order they were queued", async () => {
  const gate = concurrencyGate(2), started: number[] = [];
  let running = 0, most = 0;
  const task = (id: number) => gate(async () => {
    started.push(id); running++; most = Math.max(most, running);
    await new Promise(done => setTimeout(done, 15));
    running--;
    return id;
  });
  expect(await Promise.all([1, 2, 3, 4, 5].map(task))).toEqual([1, 2, 3, 4, 5]);
  expect(most).toBe(2);
  expect(started).toEqual([1, 2, 3, 4, 5]);
  // A failure frees its place.
  await expect(gate(async () => { throw Error("boom"); })).rejects.toThrow("boom");
  expect(await task(6)).toBe(6);
});

test("a finishing task hands its slot to the first waiter: a caller arriving in between waits (deep review 9, PIPE-Low)", async () => {
  const gate = concurrencyGate(1);
  let running = 0, most = 0, releaseA!: () => void;
  const order: string[] = [];
  const tracked = (name: string) => gate(async () => {
    order.push(name); running++; most = Math.max(most, running);
    await new Promise(done => setTimeout(done, 5));
    running--;
  });
  const a = gate(() => { order.push("a"); running++; most = Math.max(most, running);
    return new Promise<void>(done => { releaseA = () => { running--; done(); }; }); });
  const b = tracked("b");
  await Bun.sleep(1);
  let c: Promise<void> | undefined;
  // Released, then a new caller one microtask later: before the woken waiter has resumed.
  releaseA();
  queueMicrotask(() => { c = tracked("c"); });
  await a; await b; await Bun.sleep(1); await c;
  expect(most).toBe(1);
  expect(order).toEqual(["a", "b", "c"]);
});

function build(identity: string | undefined, prepare?: (kept: ReturnType<typeof keptPlate>) => void) {
  const kept = keptPlate();
  prepare?.(kept);
  const dir = kept.dir, game = join(dir, "game"), wk = join(dir, "tools");
  for (const path of [game, wk]) mkdirSync(path, { recursive: true });
  writeFileSync(join(wk, "WolvenKit.CLI.exe"), "fixture");
  writeFileSync(join(dir, "collection.json"), JSON.stringify(fixture));
  const calls: string[] = [], packed = new Map<string, string>(), stages: PackageBuildStage[] = [];
  const options: ProductCommandOptions = { exporters: [eyeEntry(fakeEyeVerifier())], collection: join(dir, "collection.json"),
    prerequisites: { [EYE_PLATE_PREREQUISITE]: { directory: kept.plate, manifest: kept.manifestFile, json: kept.json } },
    wolvenkit: join(wk, "WolvenKit.CLI.exe"), gamepath: game, appRoot: app, buildRoot: join(dir, "build"), distRoot: join(dir, "dist"),
    tools: () => ({ ...fakeTools(calls, packed), ...identity ? { identity } : {} }), verifierTools: () => fakeVerifierTools(packed),
    progress: stage => stages.push(stage) };
  return { run: () => runProductCommand(options) as Promise<PackageBuildResult>, calls, stages, kept };
}

test("Build reads the plate from its kept JSON instead of starting WolvenKit, and converts every resource in one launch", async () => {
  const kept = build("wolvenkit:9.0.1:test");
  const result = await kept.run();
  expect(result.products).toHaveLength(1);
  // No serialize: the plate's JSON was kept beside it. The imports and one deserialize, then the host packs once.
  expect(kept.calls).toEqual(["import", "import", "deserialize", "pack"]);
  // The stages it passed through, in order (the host reports `prepare` itself).
  expect(kept.stages).toEqual(["compose", "convert", "pack", "verify"]);
}, 30_000);

test("Build serializes the plate itself when the kept JSON is another WolvenKit's, damaged, or its tools can't say which they are", async () => {
  for (const [identity, damage] of [["wolvenkit:9.1.0:other", false], [undefined, false], ["wolvenkit:9.0.1:test", true]] as const) {
    const case_ = build(identity, damage ? kept => writeFileSync(join(kept.json, "xfs_eye_plate.morphtarget.json"), "{}") : undefined);
    await case_.run();
    expect(case_.calls[0]).toBe("serialize");
  }
}, 60_000);

test("a child's stdout lines reach the listener as they arrive, split across chunks and line endings", async () => {
  const lines: string[] = [];
  const script = "process.stdout.write('a\\r\\nb'); await Bun.sleep(30); process.stdout.write('c\\nd\\n'); process.stdout.write('tail');";
  const result = await runProcessTree(process.execPath, ["-e", script], { timeoutMs: 20_000, onStdoutLine: line => lines.push(line) });
  expect(result.exitCode).toBe(0);
  expect(lines).toEqual(["a", "bc", "d"]);
});

test("the builder's stage lines become the host's progress snapshot while the Build runs, and none after it", async () => {
  expect(builderStage(`${PACKAGE_PROGRESS_PREFIX}{"stage":"pack"}`)).toBe("pack");
  expect(builderStage(`${PACKAGE_PROGRESS_PREFIX}{"stage":"install"}`)).toBeNull();
  expect(builderStage(`${PACKAGE_PROGRESS_PREFIX}not json`)).toBeNull();
  expect(builderStage("pack complete")).toBeNull();
  const service = new PackageHostService(), seen: (PackageBuildProgress | null)[] = [];
  const adapter: PackageHostAdapter = {
    exporters: [eyeEntry()], prerequisites: {}, checkWorker: "", buildIssue: () => null, log: () => {},
    buildSetup: () => { throw Error("not reached"); },
    runBuilder: async () => { throw Error("not reached"); },
  };
  // Without the plate prerequisite this host refuses before preparing anything; the snapshot is empty throughout.
  const refused = await service.run(adapter, "build", fixture, new AbortController().signal);
  expect(refused.ok).toBe(false);
  expect(service.buildProgress()).toBeNull();
  // A host that prepares the plate: `prepare` first, then each stage line the builder prints.
  const kept = keptPlate(), dir = kept.dir;
  const prepared = { builder: { directory: kept.plate, manifest: kept.manifestFile }, plan: null as unknown };
  const { manifestPlateReach } = await import("../src/features/eye-makeup/export/plate-input");
  const { packagePlateRecord } = await import("../src/eye-plate-service");
  prepared.plan = { ...manifestPlateReach(kept.manifestFile)!, record: packagePlateRecord(JSON.parse(readFileSync(kept.manifestFile, "utf8"))) };
  const staged: PackageHostAdapter = { ...adapter,
    prerequisites: { [EYE_PLATE_PREREQUISITE]: { cached: () => null, discard: () => {},
      prepare: async () => { seen.push(service.buildProgress()); return prepared; } } },
    buildSetup: () => ({ snapshot: join(dir, "s"), work: join(dir, "w"), stage: join(dir, "t"), candidates: join(dir, "c"), wolvenkit: "", gamepath: "" }),
    runBuilder: async (_args, run) => {
      for (const stage of ["compose", "convert", "pack", "verify"]) { run.onLine?.(`${PACKAGE_PROGRESS_PREFIX}{"stage":"${stage}"}`); seen.push(service.buildProgress()); }
      run.onLine?.("independent verification complete");
      return { exitCode: 1, stdout: "", stderr: "", stopped: null };
    } };
  const failed = await service.run(staged, "build", fixture, new AbortController().signal);
  expect(failed.ok).toBe(false);
  expect(seen.map(item => item && [item.stage, item.step, item.steps])).toEqual([["prepare", 1, 5], ["compose", 2, 5], ["convert", 3, 5],
    ["pack", 4, 5], ["verify", 5, 5]]);
  expect(seen[1]!.looks).toBeGreaterThan(0);
  expect(service.buildProgress()).toBeNull();
});

test("each stage reads as its step and plain words", () => {
  expect(packageBuildStageLine({ stage: "prepare", step: 1, steps: 5 })).toBe("Step 1 of 5: Reading your game files…");
  expect(packageBuildStageLine({ stage: "compose", step: 2, steps: 5, looks: 2 })).toBe("Step 2 of 5: Painting 2 looks…");
  expect(packageBuildStageLine({ stage: "convert", step: 3, steps: 5, looks: 1 })).toBe("Step 3 of 5: Converting 1 look…");
  expect(packageBuildStageLine({ stage: "verify", step: 5, steps: 5 })).toBe("Step 5 of 5: Checking the mod files…");
  expect(packageBuildStageLine({ stage: "pack", step: 4, steps: 5 })).toBe("Step 4 of 5: Packing the mod files…");
  // Every line fits the panel's one line at its narrowest (UI gate: about 37 characters), up to 99 looks.
  for (const stage of ["prepare", "compose", "convert", "pack", "verify"] as const)
    expect(packageBuildStageLine({ stage, step: 5, steps: 5, looks: 99 }).length).toBeLessThanOrEqual(37);
});
