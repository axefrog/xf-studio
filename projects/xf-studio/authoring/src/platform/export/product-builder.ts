/**
 * The export host's builder (feature-module platform §6 "Pipeline"): Check or Build of every product of one
 * collection file, never installing anything. It runs in a bounded child process that both hosts start
 * (localhost from the source tree, desktop from its bundled copy) and owns every gate between the request and
 * a private candidate: private-root containment, the stable source, each feature's eligibility, plan and
 * build into its product's one staging tree, the product's pre-pack gate, one WolvenKit pack, the product
 * verifier and each feature's independent verifier on its subset, and promotion only after all of that with an
 * `xfs/local-package-2` manifest. File and process mechanics come from the root (`tools`, `verifierTools`).
 */
import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join, parse, resolve, sep } from "node:path";
import {
  archiveXlText, ExportRefusal, PACKAGE_BUILD_2, type FeatureBuildContext, type FeatureExporterEntry, type FeatureVerification,
  type GeneratedFile, type PackageBuildResult, type PackageCheckResult, type ProductBuild, type ResourceTools, type VerifierTools,
} from "../api/export";
import { checkProducts, type ProductOutcome } from "./product-check";
import { listGeneratedFiles, verifyProductArchive } from "./product-verifier";
import { LOCAL_PACKAGE_2, type LocalPackageManifest2, type ManifestFile } from "./manifest";

export const MAX_COLLECTION_BYTES = 16_000_000;

export interface ProductCommandOptions {
  /** The collection file (either stored schema; its `packagePlan` groups features into mods). */
  readonly collection: string;
  /** Check only: eligibility, plans and preflight, no files. */
  readonly check?: boolean;
  /**
   * Honour the collection's diagnostic export knobs (a prepared in-game test candidate). Only a developer
   * passes it (CLI `--diagnostics`); neither host ever does, and both hosts drop the knobs before the builder
   * sees the file (PIPE-70).
   */
  readonly diagnostics?: boolean;
  /** Every exporting feature the host composition registers (`compose/exporters.ts`). */
  readonly exporters: readonly FeatureExporterEntry[];
  /** Builder-side prerequisite values by ID, from the host (eye makeup: the prepared plate's directory and manifest). */
  readonly prerequisites?: Readonly<Record<string, unknown>>;
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
  /** WolvenKit adapters from the root (the builder's conversions and pack, and the verifiers' own runs). */
  readonly tools: (wolvenkit: string, cwd: string, signal?: AbortSignal) => ResourceTools;
  readonly verifierTools: (wolvenkit: string, gamepath: string) => VerifierTools;
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
function fail(code: string, message: string): never { throw new ExportRefusal(code, message); }

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
/** Keep every write apart from the declared source, game, tool and prerequisite inputs. */
function guardPrivateRoots(options: ProductCommandOptions, protectedInputs: readonly (readonly [string, string])[], collection: string): Roots {
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

/** Wall-clock nanoseconds as a decimal string, for a unique, sortable build token. */
function timeToken(): string {
  const now = BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor((performance.now() % 1) * 1_000_000));
  return now.toString();
}

// The pre-pack gate's path rules (restated from WolvenKit's ArchiveWriter: a sanitized, FNV-1a 64 hashed depot path;
// unsupported extensions are skipped): the generated tree must already be canonical, so nothing is renamed or dropped.
const SEGMENT = /^[a-z0-9_][a-z0-9_.-]*$/;
const EXTENSIONS = [".app", ".inkcharcustomization", ".mesh", ".morphtarget", ".xbm"];
function depotPathHash(path: string): bigint {
  const parts = path.split("/"), name = parts[parts.length - 1], dot = name.lastIndexOf(".");
  if (!path || path.includes("\\") || path.startsWith("/") || parts.some(part => part === "." || part === ".." || !SEGMENT.test(part) || part.endsWith(".")) ||
      /^\d+\./.test(parts[0]) || dot <= 0 || !EXTENSIONS.includes(name.slice(dot)))
    fail("package_build_failed", `Noncanonical generated resource: ${JSON.stringify(path)}`);
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(path.replaceAll("/", "\\"))) hash = ((hash ^ BigInt(byte)) * 1099511628211n) & ((1n << 64n) - 1n);
  return hash;
}

/** The product's pre-pack gate: the staging tree is exactly the union of its features' recorded files, with no path-hash collision. */
function prePackGate(staging: string, recorded: readonly GeneratedFile[]): void {
  const hashes = new Map<bigint, string>();
  for (const file of recorded) {
    const hash = depotPathHash(file.path), prior = hashes.get(hash);
    if (prior !== undefined) fail("package_build_failed", `Archive path hash collision: ${prior} and ${file.path}`);
    hashes.set(hash, file.path);
  }
  const actual = listGeneratedFiles(staging);
  const text = (files: readonly GeneratedFile[]) => JSON.stringify([...files].map(f => [f.path, f.bytes, f.sha256])
    .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (text(actual) !== text(recorded)) {
    const expected = new Set(recorded.map(f => f.path)), present = new Set(actual.map(f => f.path));
    fail("package_build_failed", `Generated archive resources differ from the features' records; missing=${JSON.stringify(
      [...expected].filter(p => !present.has(p)))}, extra=${JSON.stringify([...present].filter(p => !expected.has(p)))}`);
  }
}

/** One product built and verified in its intermediate folder, ready to promote. */
type Built = { outcome: ProductOutcome; intermediate: string; token: string; archive: string; xl: string; archiveSha256: string;
  xlSha256: string; unpacked: number; verifications: FeatureVerification[] };

/** Check (eligibility only) or Build (verified private candidates, one per product) for one exported collection file. */
export async function runProductCommand(options: ProductCommandOptions): Promise<PackageCheckResult | PackageBuildResult> {
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
  try { value = JSON.parse(readFileSync(collection, "utf8").replace(/^﻿/, "")); }
  catch { fail("invalid_collection", "Collection preflight rejected input: the file is not JSON."); }
  const stable = () => { if (fileHash(collection) !== sourceHash) fail("collection_changed", "Collection changed during preflight; export a stable snapshot and retry."); };
  const given = options.prerequisites ?? {};
  const check = (prerequisites: Readonly<Record<string, unknown>>, preflight: boolean) =>
    checkProducts({ collection: value, exporters: options.exporters, prerequisites, diagnostics: options.diagnostics === true, preflight,
      collectionSha256: sourceHash });

  if (options.check) {
    // Check plans on what the host last prepared, when it passes it (eye makeup: a cached plate's recorded footprint).
    const prerequisites: Record<string, unknown> = {};
    for (const { exporter } of options.exporters) Object.assign(prerequisites, exporter.checkInputs?.(given) ?? {});
    const result = check(prerequisites, true).result;
    stable();
    return result;
  }

  if (!options.wolvenkit || !options.gamepath) fail("package_input_missing", "Build requires --wolvenkit and --gamepath. --check only needs --collection.");
  const wolvenkit = existing(options.wolvenkit, "WolvenKit");
  const gamepath = existing(options.gamepath, "Game directory");
  if (!isFile(wolvenkit) || !isDirectory(gamepath)) fail("package_input_missing", "WolvenKit must be a file and gamepath must be a directory.");
  const present = options.exporters.filter(entry => entry.exporter.present(value));
  const protectedInputs = [["game root", gamepath], ["app source", app], ["WolvenKit tools", dirname(wolvenkit)],
    ["Bun tools", dirname(process.execPath)], ...present.flatMap(entry => entry.exporter.protectedInputs?.(given) ?? [])] as const;
  const roots = guardPrivateRoots(options, protectedInputs, collection);
  if (!same(roots.output, outputRoot)) fail("package_root_unsafe", "Private output roots changed during the build.");
  const tools = options.tools(wolvenkit, roots.build, options.signal);
  // One yield first, so an immediate cancel stops before any conversion.
  await new Promise(done => setImmediate(done));
  cancelled();
  // What each feature's plan needs from its prerequisites (eye makeup: the packaged plate and its UV footprint); a
  // WolvenKit read, when one is needed, works in its own folder below the build root.
  const prerequisites: Record<string, unknown> = { ...given };
  for (const { exporter } of present) {
    if (!exporter.buildInputs) continue;
    const work = join(roots.build, `inputs-${exporter.feature}-${timeToken()}`);
    try { Object.assign(prerequisites, (await exporter.buildInputs({ work, tools, prerequisites: given, signal: options.signal, log })).prerequisites); }
    finally { rmSync(work, { recursive: true, force: true }); }
    cancelled();
  }
  const planned = check(prerequisites, false);
  stable();
  // Nothing is written before the inputs are known good (a prerequisite's provenance, the plan).
  mkdirSync(roots.build, { recursive: true });

  const built: Built[] = [];
  try {
    for (const outcome of planned.products) {
      const token = `${outcome.product.archive}-${timeToken()}`;
      const intermediate = join(roots.build, token);
      if (existsSync(intermediate) || existsSync(join(roots.output, token))) fail("package_root_unsafe", "Build destination already exists.");
      mkdirSync(join(intermediate, "logs"), { recursive: true });
      const staging = join(intermediate, "archive");
      mkdirSync(staging);
      const files: GeneratedFile[] = [], byFeature = new Map<string, readonly GeneratedFile[]>();
      const context = (feature: string): FeatureBuildContext =>
        ({ staging, work: join(intermediate, "features", feature), tools, prerequisites, signal: options.signal, log });
      for (const { entry, outcome: feature } of outcome.features) {
        cancelled();
        mkdirSync(join(intermediate, "features"), { recursive: true });
        const record = await entry.exporter.build(feature, context(entry.exporter.feature));
        if (JSON.stringify(record.files.map(f => f.path).sort()) !== JSON.stringify([...feature.inventory]))
          fail("package_build_failed", `The ${entry.exporter.label} build wrote other resources than it planned.`);
        files.push(...record.files);
        byFeature.set(entry.exporter.feature, record.files);
      }
      cancelled();
      prePackGate(staging, files);
      const packageDir = join(intermediate, "package", "archive", "pc", "mod");
      mkdirSync(packageDir, { recursive: true });
      const packed = await tools.pack(staging, packageDir);
      writeFileSync(join(intermediate, "logs", "pack.log"), packed.log, "utf8");
      log("pack complete");
      const packedFile = join(packageDir, "archive.archive");
      if (!isFile(packedFile) || readdirSync(packageDir).length !== 1) fail("package_build_failed", "WolvenKit did not produce exactly one packed archive.");
      const archive = join(packageDir, outcome.product.archive + ".archive"), xl = archive + ".xl";
      renameSync(packedFile, archive);
      const declaration = archiveXlText(outcome.xl);
      writeFileSync(xl, declaration, "utf8");
      const archiveSha256 = fileHash(archive), xlSha256 = fileHash(xl);
      writeFileSync(join(intermediate, "build.json"), JSON.stringify({ productId: outcome.product.id, archive: outcome.product.archive,
        archiveSha256, xlSha256, features: outcome.features.map(({ entry }) => ({ feature: entry.exporter.feature, exporter: entry.exporter.id,
          files: byFeature.get(entry.exporter.feature) })),
        installed: false, gameRenderingVerified: false }) + "\n", "utf8");
      cancelled();
      // The product verifier, then each feature's own verifier on its subset (none imports its exporter).
      const verifierTools = options.verifierTools(wolvenkit, gamepath);
      const unpacked = verifyProductArchive({ archive, xl, archiveSha256, files, declaration, features: outcome.features.length,
        tools: verifierTools, work: join(intermediate, "verify") });
      const verifications: FeatureVerification[] = [];
      for (const { entry, outcome: feature } of outcome.features) {
        const ctx = context(entry.exporter.feature);
        let verification: FeatureVerification;
        try {
          verification = entry.verifier.verify({ unpacked, work: ctx.work, staging, verifyDir: join(ctx.work, "verify"), tools: verifierTools,
            packaged: JSON.parse(feature.packaged), prerequisites });
        } catch (error) {
          if (error instanceof ExportRefusal) throw error;
          return fail("package_verification_failed", `Independent verifier failed: ${(error as Error).message}`);
        }
        entry.exporter.accept?.(feature, verification, ctx);
        verifications.push(verification);
      }
      writeFileSync(join(intermediate, "verification.json"), JSON.stringify({ archiveSha256: unpacked.archiveSha256,
        xlSha256: unpacked.xlSha256, unpackedFiles: unpacked.files.length,
        features: outcome.features.map(({ entry }, i) => ({ feature: entry.exporter.feature, ...verifications[i].report })) }, null, 2) + "\n", "utf8");
      log(`independent verification complete: ${outcome.product.modName}`);
      if (unpacked.archiveSha256 !== archiveSha256 || unpacked.xlSha256 !== xlSha256)
        fail("package_verification_failed", "Independent verification does not match the build.");
      built.push({ outcome, intermediate, token, archive, xl, archiveSha256, xlSha256, unpacked: unpacked.files.length, verifications });
    }
  } catch (error) {
    if (error instanceof ExportRefusal || (error as { code?: unknown })?.code !== undefined) throw error;
    return fail("package_build_failed", `Package Build failed: ${(error as Error).message}`);
  }

  // Promote only after every product verified: stage each candidate, then move them all into place.
  cancelled();
  const checked = guardPrivateRoots(options, protectedInputs, collection);
  if (!same(checked.build, roots.build) || !same(checked.dist, roots.dist) || !same(checked.output, roots.output))
    fail("package_root_unsafe", "Private output roots changed during the build.");
  mkdirSync(roots.output, { recursive: true });
  const staged: { staging: string; final: string }[] = [];
  const products: ProductBuild[] = [];
  try {
    for (const item of built) {
      const { product, check: productCheck } = item.outcome;
      const staging = join(roots.output, ".staging-" + item.token), final = join(roots.output, item.token);
      if (existsSync(final)) fail("package_root_unsafe", "Build destination already exists.");
      mkdirSync(staging);
      staged.push({ staging, final });
      const target = join(staging, "archive", "pc", "mod");
      mkdirSync(target, { recursive: true });
      const names = [product.archive + ".archive", product.archive + ".archive.xl"];
      copyFileSync(item.archive, join(target, names[0]));
      copyFileSync(item.xl, join(target, names[1]));
      const files = names.map(name => ({ path: `archive/pc/mod/${name}`, sha256: fileHash(join(target, name)),
        bytes: statSync(join(target, name)).size })) as [ManifestFile, ManifestFile];
      if (files[0].sha256 !== item.archiveSha256 || files[1].sha256 !== item.xlSha256)
        fail("package_verification_failed", "Promoted archive or declaration differs from the verified files.");
      const manifest: LocalPackageManifest2 = {
        schema: LOCAL_PACKAGE_2, productId: product.id, modName: product.modName, nameSource: product.nameSource, archive: product.archive,
        collectionId: planned.result.collectionId, collectionSha256: sourceHash, originalPresetCount: planned.result.originalPresetCount,
        omissions: planned.result.omissions, requirements: productCheck.requirements,
        features: item.outcome.features.map(({ outcome: feature }, i) => ({
          feature: feature.check.feature, exporter: feature.check.exporter, exporterVersion: feature.check.exporterVersion,
          namespace: feature.check.namespace, brand: feature.check.brand, selectorLabel: feature.check.selectorLabel,
          selector: feature.check.selector, presets: feature.check.presets, omissions: feature.check.omissions,
          experimental: feature.check.experimental, requirements: feature.check.requirements, packagedSha256: feature.check.packagedSha256,
          planSha256: textHash(JSON.stringify(feature.plan)), details: feature.check.details,
          verification: { presetCount: item.verifications[i].presetCount, verifiedFiles: item.verifications[i].verifiedFiles,
            limits: item.verifications[i].limits } })),
        files, verifiedUnpackedFiles: item.unpacked, installed: false, gameRenderingVerified: false,
      };
      writeFileSync(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
      products.push({ ...productCheck, package: final, manifest: join(final, "manifest.json"), archiveSha256: item.archiveSha256,
        xlSha256: item.xlSha256, verifiedUnpackedFiles: item.unpacked, installed: false, gameRenderingVerified: false });
    }
    for (const { staging, final } of staged) renameSync(staging, final);
  } finally { for (const { staging } of staged) if (existsSync(staging)) rmSync(staging, { recursive: true, force: true }); }
  const { schema: _schema, ready: _ready, products: _products, ...common } = planned.result;
  return { ...common, schema: PACKAGE_BUILD_2, products, installed: false, gameRenderingVerified: false };
}
