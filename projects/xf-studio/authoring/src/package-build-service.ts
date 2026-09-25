// Application service for Check and Build of one exported collection file. Never installs.
//
// TypeScript port of tools/build_collection_package.py (now retired). It owns every gate
// between the host and the private candidate: the shared preflight/partial filter and its
// identities, stable-source checks, private-root containment, plate provenance, the
// resource build, independent verification, and promotion only after verification with an
// `xfs/local-package-1` manifest. File and process mechanics live in the builder's
// WolvenKit adapter and the verifier; hosts supply paths and a cancellation signal.
import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join, parse, resolve, sep } from "node:path";
import type { PackageBuild, PackageCheck, PackagePlate } from "./package-action";
import { packagePresetIdentities } from "./package-filter";
import { preflightPackageCollection } from "./package-preflight";
import { buildPackageResources, plateStem, type BuildRecord } from "./package-resource-builder";
import { createWolvenKitPackageTools, PackageToolError, type PackageResourceTools } from "./package-build-wolvenkit";
import { verifyBuild, type VerificationReport, type VerifyBuildOptions } from "./mod-verifier/verify-build";
import { createWolvenKitVerifierTools } from "./verifier-wolvenkit";
import { EYE_PLATE_MANIFEST_SCHEMA, packagePlateRecord } from "./eye-plate-service";
import { plateReachInput, readManifestPlateReach } from "./plate-uv-footprint-io";
import { plateUvFootprint } from "./plate-uv-window";
import type { PlateReachInput } from "./plate-reach";

export const MAX_COLLECTION_BYTES = 16_000_000;

export class PackageBuildError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface PackageCommandOptions {
  /** Exported collection JSON file. */
  readonly collection: string;
  /** Validate the collection and finish support without building. */
  readonly check?: boolean;
  /** Eye plate directory prepared by the host (or a developer override). */
  readonly plate?: string;
  /** Verified built-in plate manifest from the host; absent for a developer override. */
  readonly plateManifest?: string;
  readonly wolvenkit?: string;
  readonly gamepath?: string;
  /** Read-only code root of the running builder; writable roots may not overlap it. */
  readonly appRoot: string;
  readonly buildRoot: string;
  readonly distRoot: string;
  /** Destination within `distRoot`; defaults to it. */
  readonly outputRoot?: string;
  readonly signal?: AbortSignal;
  readonly log?: (line: string) => void;
  /** Test seams. */
  readonly tools?: (wolvenkit: string, cwd: string, signal?: AbortSignal) => PackageResourceTools;
  readonly verify?: (options: VerifyBuildOptions) => VerificationReport;
}

const windows = process.platform === "win32";
const key = (path: string) => windows ? path.toLowerCase() : path;
const same = (a: string, b: string) => key(a) === key(b);
/** `ancestor` is `path` or one of its parents. */
const within = (path: string, ancestor: string) => same(path, ancestor) ||
  key(path).startsWith(key(ancestor).endsWith(sep) ? key(ancestor) : key(ancestor) + sep);
const overlaps = (a: string, b: string) => within(a, b) || within(b, a);
const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };
const isDirectory = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const fileHash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const textHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
function fail(code: string, message: string): never { throw new PackageBuildError(code, message); }

/** Canonical absolute path: the nearest existing ancestor's real path plus the not-yet-created remainder. */
function canonical(path: string): string {
  let current = resolve(path);
  const rest: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return resolve(path);
    rest.unshift(current.slice(parent.length).replace(/^[\\/]+/, ""));
    current = parent;
  }
  return resolve(realpathSync.native(current), ...rest);
}

/** Canonical path of an input that must exist. */
function existing(path: string, label: string): string {
  if (!existsSync(path)) fail("package_input_missing", `${label} is missing: ${resolve(path)}`);
  return realpathSync.native(resolve(path));
}

/** Reject symlinks and Windows junctions anywhere in a writable path before resolving it. */
function rejectLinkedPath(path: string, label: string): void {
  let current = resolve(path);
  for (;;) {
    let linked = false;
    try { linked = lstatSync(current).isSymbolicLink(); } catch { /* Not created yet. */ }
    if (linked) fail("package_root_unsafe", `${label} uses a linked directory: ${current}`);
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return;
    current = parent;
  }
}

/** A canonical destination beneath the host's private dist root. */
function destination(root: string, distRoot: string): string {
  rejectLinkedPath(root, "Output root");
  const base = canonical(distRoot), chosen = canonical(root);
  if (!within(chosen, base)) fail("package_root_unsafe", `Output must be inside ${base}; game/MO2 deployment is a separate action.`);
  if (existsSync(chosen) && !isDirectory(chosen)) fail("package_root_unsafe", `Output root is not a directory: ${chosen}`);
  return chosen;
}

type Roots = { build: string; dist: string; output: string };
/** Keep every write apart from the declared source, game and tool inputs. */
function guardPrivateRoots(options: PackageCommandOptions, protectedInputs: readonly (readonly [string, string])[], collection: string): Roots {
  const outputArg = options.outputRoot ?? options.distRoot;
  for (const [label, path] of [["Build root", options.buildRoot], ["Dist root", options.distRoot], ["Output root", outputArg]] as const)
    rejectLinkedPath(path, label);
  const build = canonical(options.buildRoot), dist = canonical(options.distRoot);
  const output = destination(outputArg, options.distRoot);
  if (overlaps(build, dist)) fail("package_root_unsafe", "Build and dist roots must be separate private directories.");
  for (const [label, path] of protectedInputs) {
    const source = canonical(path);
    for (const [rootLabel, root] of [["Build root", build], ["Dist root", dist]] as const)
      if (overlaps(root, source)) fail("package_root_unsafe", `${rootLabel} overlaps configured ${label}: ${source}`);
  }
  if (within(collection, build) || within(collection, dist))
    fail("package_root_unsafe", "Collection input cannot be inside a writable build or dist root.");
  return { build, dist, output };
}

/**
 * Which eye plate is packaged: the host-derived built-in plate or a developer override, and the
 * plate recipe's morph target count for the verifier (unknown for an override).
 */
function plateProvenance(manifestPath: string | undefined, mesh: string, morph: string): { plate: PackagePlate; morphTargets?: number } {
  const meshSha256 = fileHash(mesh), morphSha256 = fileHash(morph);
  if (!manifestPath) return { plate: { source: "override", meshSha256, morphSha256 } };
  const manifest = JSON.parse(readFileSync(existing(manifestPath, "Plate manifest"), "utf8"));
  const files = manifest?.files ?? {};
  if (manifest?.schema !== EYE_PLATE_MANIFEST_SCHEMA || files.mesh?.sha256 !== meshSha256 || files.morph?.sha256 !== morphSha256 ||
      !Number.isSafeInteger(manifest?.verification?.morphTargets))
    fail("package_plate_mismatch", "The eye plate manifest does not match the plate resources.");
  return { plate: packagePlateRecord(manifest), morphTargets: manifest.verification.morphTargets };
}

/** The UV footprint a plate manifest records; null when it records none (a plate cached before footprints were recorded). */
function manifestPlateReach(manifestPath: string): PlateReachInput | null {
  const path = existing(manifestPath, "Plate manifest");
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
    if (manifest?.schema !== EYE_PLATE_MANIFEST_SCHEMA) fail("package_plate_mismatch", "The eye plate manifest is not a valid plate manifest.");
    return readManifestPlateReach(path, manifest);
  } catch (error) {
    if (error instanceof PackageBuildError) throw error;
    return fail("package_plate_mismatch", "The eye plate's recorded UV footprint is damaged. Build again to prepare the plate afresh.");
  }
}

/**
 * The packaged plate's UV footprint: the one its manifest records (hash-bound to the mesh through
 * `plateProvenance`), or, for a developer override or a plate cached before footprints were recorded, read
 * from the plate mesh through one WolvenKit serialize into a private work folder.
 */
async function packagedPlateReach(manifestPath: string | undefined, plate: string, stem: string, work: string,
  tools: PackageResourceTools): Promise<PlateReachInput> {
  const recorded = manifestPath ? manifestPlateReach(manifestPath) : null;
  if (recorded) return recorded;
  const input = join(work, "in"), output = join(work, "out");
  mkdirSync(input, { recursive: true });
  mkdirSync(output);
  try {
    // A copy of the mesh alone: the morph target is large, and only the mesh holds the UVs.
    copyFileSync(join(plate, stem + ".mesh"), join(input, stem + ".mesh"));
    try { await tools.serialize(input, output); }
    catch (error) {
      if (error instanceof PackageToolError && error.code !== "package_tool_failed") return fail(error.code, error.message);
      return fail("package_tool_failed", `WolvenKit failed while reading the eye plate: ${(error as Error).message}`);
    }
    const json = join(output, stem + ".mesh.json");
    if (!isFile(json)) fail("package_tool_failed", "WolvenKit failed while reading the eye plate: it wrote no mesh document.");
    try { return plateReachInput(plateUvFootprint(JSON.parse(readFileSync(json, "utf8").replace(/^﻿/, "")).Data.RootChunk)); }
    catch (error) { return fail("package_plate_invalid", `The eye plate mesh has no usable UVs: ${(error as Error).message}`); }
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** Wall-clock nanoseconds as a decimal string, for a unique, sortable build token. */
function timeToken(): string {
  const now = BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor((performance.now() % 1) * 1_000_000));
  return now.toString();
}

/** Check (eligibility only) or Build (verified private candidate) for one exported collection file. */
export async function runPackageCommand(options: PackageCommandOptions): Promise<PackageCheck | PackageBuild> {
  const log = options.log ?? (() => {});
  const cancelled = () => { if (options.signal?.aborted) fail("package_build_cancelled", "Package Build was cancelled."); };
  const app = existing(options.appRoot, "App root");
  if (!isDirectory(app)) fail("package_input_missing", "App root must be a directory.");
  const outputRoot = destination(options.outputRoot ?? options.distRoot, options.distRoot);
  const collection = existing(options.collection, "Collection");
  if (!isFile(collection) || statSync(collection).size > MAX_COLLECTION_BYTES)
    fail("invalid_collection", "Collection must be a file of at most 16 MB.");
  const sourceHash = fileHash(collection);
  let value: unknown;
  const preflight = (plate: PlateReachInput | null) => {
    try {
      value ??= JSON.parse(readFileSync(collection, "utf8").replace(/^﻿/, ""));
      return preflightPackageCollection(value, plate);
    } catch (error) {
      const message = (error as Error).message;
      return fail(message.startsWith("No mod files can be made") ? "no_exportable_content" : "invalid_collection",
        "Collection preflight rejected input: " + message);
    }
  };
  // Check plans on the plate the host last prepared, when it passes that plate's manifest; Build (below) on the
  // plate it packages. Presets that never reach the plate are omitted either way (PIPE-33).
  let summary = preflight(options.check && options.plateManifest ? manifestPlateReach(options.plateManifest) : null);
  if (fileHash(collection) !== sourceHash) fail("collection_changed", "Collection changed during preflight; export a stable snapshot and retry.");
  if (options.check) { const { packagedCollectionJson: _json, ...check } = summary; return check; }

  if (!options.plate || !options.wolvenkit || !options.gamepath)
    fail("package_input_missing", "Build requires --plate, --wolvenkit and --gamepath. --check only needs --collection.");
  const plate = existing(options.plate!, "Plate directory");
  const wolvenkit = existing(options.wolvenkit!, "WolvenKit");
  const gamepath = existing(options.gamepath!, "Game directory");
  const stem = (() => {
    try { return plateStem(plate); }
    catch { return fail("package_plate_invalid", `Plate directory must hold exactly one mesh/morphtarget pair: ${plate}`); }
  })();
  const { plate: plateRecord, morphTargets: plateMorphTargets } =
    plateProvenance(options.plateManifest, join(plate, stem + ".mesh"), join(plate, stem + ".morphtarget"));
  if (!isFile(wolvenkit) || !isDirectory(gamepath)) fail("package_input_missing", "WolvenKit must be a file and gamepath must be a directory.");
  const protectedInputs = [["game root", gamepath], ["plate source", plate], ["app source", app],
    ["WolvenKit tools", dirname(wolvenkit)], ["Bun tools", dirname(process.execPath)]] as const;
  const roots = guardPrivateRoots(options, protectedInputs, collection);
  if (!same(roots.output, outputRoot)) fail("package_root_unsafe", "Private output roots changed during the build.");
  const token = `${summary.namespace}-${timeToken()}`;
  const intermediate = join(roots.build, token), final = join(roots.output, token);
  if (existsSync(intermediate) || existsSync(final)) fail("package_root_unsafe", "Build destination already exists.");
  mkdirSync(roots.build, { recursive: true });
  const tools = (options.tools ?? ((cli, cwd, signal) => createWolvenKitPackageTools(cli, { cwd, signal })))(wolvenkit, roots.build, options.signal);
  // One yield first, so an immediate cancel stops before any conversion.
  await new Promise(done => setImmediate(done));
  cancelled();
  // The plate's UV footprint: recorded in the built-in plate's manifest, else read from the plate itself. The
  // resource builder requires the plate it serializes to give the same footprint.
  const plateReach = await packagedPlateReach(options.plateManifest, plate, stem, join(roots.build, `plate-uv-${token}`), tools);
  cancelled();
  summary = preflight(plateReach);
  const { packagedCollectionJson, ...check } = summary;
  const packagedHash = check.packagedCollectionSha256;
  const snapshot = join(roots.build, `source-${token}.json`);
  if (fileHash(collection) !== sourceHash) fail("collection_changed", "Collection changed during preflight; export a stable snapshot and retry.");
  writeFileSync(snapshot, packagedCollectionJson, { encoding: "utf8", flag: "wx" });
  let record: BuildRecord;
  try {
    const written = readFileSync(snapshot, "utf8");
    if (textHash(written) !== packagedHash) fail("collection_changed", "Filtered collection snapshot changed while writing; retry.");
    log(`Building ${check.presets.length} preset(s) in ignored local intermediates: ${intermediate}`);
    cancelled();
    record = await buildPackageResources({ collection: JSON.parse(written), output: intermediate, plate,
      plateUv: plateReach.footprint, tools, signal: options.signal, log });
  } catch (error) {
    if (error instanceof PackageToolError) fail(error.code, error.code === "package_tool_failed"
      ? `WolvenKit failed while building resources: ${error.message}` : error.message);
    if (error instanceof PackageBuildError) throw error;
    return fail("package_build_failed", `Resource build failed: ${(error as Error).message}`);
  } finally { rmSync(snapshot, { force: true }); }

  cancelled();
  let verification: VerificationReport;
  try {
    verification = (options.verify ?? verifyBuild)({ build: intermediate, tools: createWolvenKitVerifierTools(wolvenkit, gamepath),
      packagedCollection: JSON.parse(packagedCollectionJson), plate: { mesh: join(plate, stem + ".mesh"), morph: join(plate, stem + ".morphtarget"),
        meshSha256: plateRecord.meshSha256, morphSha256: plateRecord.morphSha256 },
      morphTargets: plateMorphTargets });
  }
  catch (error) { return fail("package_verification_failed", `Independent verifier failed: ${(error as Error).message}`); }
  writeFileSync(join(intermediate, "verification.json"), JSON.stringify(verification, null, 2) + "\n", "utf8");
  log("independent verification complete");
  if (verification.archiveSha256 !== record.archiveSha256 || verification.presetCount !== check.presets.length ||
      verification.plateInputs?.mesh !== plateRecord.meshSha256 || verification.plateInputs?.morph !== plateRecord.morphSha256 ||
      JSON.stringify(verification.presetRoutes) !== JSON.stringify(check.presets.map(p => ({ id: p.id, route: p.route }))) ||
      JSON.stringify(verification.plateGeometry?.liftsMm) !== JSON.stringify(check.plateLiftsMm))
    fail("package_verification_failed", "Independent verification does not match the build.");
  const built = record.plan;
  if (built.collectionId !== check.collectionId || built.namespace !== check.namespace ||
      built.modName !== check.modName || built.selectorLabel !== check.selectorLabel ||
      JSON.stringify(packagePresetIdentities(built)) !== JSON.stringify(check.presets) ||
      JSON.stringify(built.plate.liftsMm) !== JSON.stringify(check.plateLiftsMm))
    fail("package_identity_mismatch", "Compiled collection identities differ from preflight.");

  cancelled();
  const checked = guardPrivateRoots(options, protectedInputs, collection);
  if (!same(checked.build, roots.build) || !same(checked.dist, roots.dist) || !same(checked.output, roots.output))
    fail("package_root_unsafe", "Private output roots changed during the build.");
  const source = join(intermediate, "package", "archive", "pc", "mod");
  const names = [check.namespace + ".archive", check.namespace + ".archive.xl"];
  mkdirSync(roots.output, { recursive: true });
  const staging = join(roots.output, ".staging-" + token);
  mkdirSync(staging);
  try {
    const target = join(staging, "archive", "pc", "mod");
    mkdirSync(target, { recursive: true });
    for (const name of names) copyFileSync(join(source, name), join(target, name));
    const manifest = {
      schema: "xfs/local-package-1", collectionId: check.collectionId,
      collectionSha256: sourceHash, namespace: check.namespace,
      modName: check.modName, selectorLabel: check.selectorLabel,
      packagedCollectionSha256: packagedHash,
      originalPresetCount: check.originalPresetCount, omissions: check.omissions, experimental: check.experimental,
      presets: check.presets, plateLiftsMm: check.plateLiftsMm, plateUv: check.plateUv, verifiedPresetCount: verification.presetCount,
      verifiedUnpackedFiles: verification.unpackedFilesVerified,
      files: names.map(name => ({ path: `archive/pc/mod/${name}`, sha256: fileHash(join(target, name)),
        bytes: statSync(join(target, name)).size })),
      plate: plateRecord,
      installed: false, gameRenderingVerified: false,
      limits: verification.limits,
    };
    if (manifest.files[0].sha256 !== verification.archiveSha256 || manifest.files[1].sha256 !== verification.archiveXlSha256)
      fail("package_verification_failed", "Promoted archive or declaration differs from the verified files.");
    writeFileSync(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
    renameSync(staging, final);
  } finally { if (existsSync(staging)) rmSync(staging, { recursive: true, force: true }); }
  return { package: final, manifest: join(final, "manifest.json"),
    modName: check.modName, selectorLabel: check.selectorLabel, archiveSha256: verification.archiveSha256,
    presetCount: verification.presetCount, originalPresetCount: check.originalPresetCount,
    omissions: check.omissions, experimental: check.experimental, packagedCollectionSha256: packagedHash, plate: plateRecord,
    plateLiftsMm: check.plateLiftsMm, plateUv: check.plateUv!, installed: false,
    gameRenderingVerified: false };
}
