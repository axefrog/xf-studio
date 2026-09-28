/**
 * XF Finish Showroom's builder: from one collection, a separate test mod of mannequin heads, one per preset, each wearing that
 * preset's eye plate. It reuses the eye-makeup pipeline unchanged and adds only the showroom's own resources:
 *
 *   1. A package-only copy of the collection with the showroom's own collection ID (`showroomCollectionId`), so the plate and
 *      textures land under a depot the eye-makeup mod of the same collection never uses.
 *   2. The export host's builder (`runProductCommand`) with the eye-makeup exporter alone, into private folders: Check, compile,
 *      pack and both independent verifiers exactly as for the eye-makeup mod.
 *   3. The verified archive unbundled; its plate mesh and textures kept (the selector, `.app` and morph target are not).
 *   4. The showroom entity, its `.app`, and the light rigs (`resources.ts`) turned into resources by WolvenKit.
 *   5. One archive packed from exactly that tree, checked by the showroom's own verifier (`verify.ts`, which imports nothing
 *      from here), then promoted with an `xfs/showroom-package-1` manifest. Never installed.
 *
 * File and process mechanics come from the caller (`tools`, `verifierTools`), as for the export host.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ExportRefusal, type FeatureExporterEntry, type GeneratedFile, type PackageBuildResult, type ResourceTools, type VerifierTools } from "../platform/api";
import { runProductCommand } from "../platform/export/product-builder";
import { listGeneratedFiles } from "../platform/export/product-verifier";
import { EYE_MAKEUP_FEATURE } from "../recipe-schema";
import {
  DEFAULT_EYES, DEFAULT_SKIN, entityTemplate, EYES_PATTERN, HEAD_JOINT, PEDESTAL, resourceText, RIG_PROFILES, rigAppearance,
  rigAppearanceResource, rigLights, SHOWROOM_BUILDER_VERSION, SHOWROOM_MOD_NAME, SHOWROOM_SCHEMA, SHOWROOM_VANILLA, showroomAppearanceResource,
  showroomCollectionId, showroomPaths, SKIN_PATTERN, type RigLight, type RigProfile,
} from "./resources";
import { verifyShowroomArchive, type ShowroomVerification } from "./verify";

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const fileHash = (path: string) => sha256(readFileSync(path));
function fail(code: string, message: string): never { throw new ExportRefusal(code, message); }
const timeToken = () => `${Date.now()}${process.hrtime.bigint() % 1000000n}`;

export interface ShowroomBuildOptions {
  /** The collection file (either stored schema). */
  readonly collection: string;
  /** The host composition's exporters (the CLI passes `compose/exporters`); only the eye-makeup one is used. */
  readonly exporters: readonly FeatureExporterEntry[];
  /** Honour a prepared collection's diagnostic knobs (the finish board, the Glitter board). */
  readonly diagnostics?: boolean;
  /** Eye makeup's prerequisites by ID (the prepared plate), as for the package builder. */
  readonly prerequisites: Readonly<Record<string, unknown>>;
  readonly wolvenkit: string;
  readonly gamepath: string;
  readonly appRoot: string;
  /** Private work root; each build uses a fresh folder below it. */
  readonly buildRoot: string;
  /** Where the verified showroom is promoted (the project's ignored `dist/`). */
  readonly distRoot: string;
  /** The head mesh's skin appearance (tone and type) and the eye mesh's colour. */
  readonly skin?: string;
  readonly eyes?: string;
  readonly signal?: AbortSignal;
  readonly log?: (line: string) => void;
  readonly tools: (wolvenkit: string, cwd: string, signal?: AbortSignal) => ResourceTools;
  readonly verifierTools: (wolvenkit: string, gamepath: string) => VerifierTools;
}

export type ShowroomPiece = { readonly id: string; readonly name: string; readonly appearance: string; readonly route: string };
export type ShowroomManifest = {
  readonly schema: typeof SHOWROOM_SCHEMA;
  readonly modName: string;
  readonly builderVersion: string;
  readonly archive: string;
  readonly collectionId: string;
  readonly collectionName: string;
  readonly collectionSha256: string;
  readonly showroomCollectionId: string;
  readonly diagnostics: boolean;
  readonly entity: string;
  readonly rigEntity: string;
  readonly look: { readonly skin: string; readonly eyes: string; readonly head: string; readonly eyesMesh: string; readonly faceRig: string };
  readonly headJoint: readonly number[];
  readonly pedestal: typeof PEDESTAL;
  readonly pieces: readonly ShowroomPiece[];
  readonly rigs: Readonly<Record<RigProfile, { readonly appearance: string; readonly lights: readonly RigLight[] }>>;
  readonly requirements: Readonly<Record<string, string>>;
  readonly eyeMakeup: { readonly archiveSha256: string; readonly manifestSha256: string; readonly verifiedUnpackedFiles: number;
    readonly experimental: readonly unknown[]; readonly omissions: readonly unknown[]; readonly warnings: readonly unknown[] };
  readonly files: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[];
  readonly verification: ShowroomVerification;
  readonly installed: false;
  readonly gameRenderingVerified: false;
};

/** A package-only copy of the collection under the showroom's own ID, without a package plan (one mod, the default). */
export function showroomCollection(value: unknown): { collection: Record<string, unknown>; sourceId: string; name: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_collection", "The collection file is not a collection.");
  const source = value as Record<string, unknown>;
  if (typeof source.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(source.id))
    fail("invalid_collection", "The collection has no valid ID.");
  const name = typeof source.name === "string" ? source.name : "Collection";
  const { packagePlan: _plan, ...rest } = source;
  const suffix = " · showroom";
  return { collection: { ...rest, id: showroomCollectionId(source.id), name: name.slice(0, 120 - suffix.length) + suffix }, sourceId: source.id, name };
}

/** The display name of each look, by preset ID, from either collection schema. */
function lookNames(collection: Record<string, unknown>): Map<string, string> {
  const names = new Map<string, string>();
  for (const key of ["presets", "looks"]) for (const item of Array.isArray(collection[key]) ? collection[key] as unknown[] : []) {
    const look = item as { id?: unknown; name?: unknown };
    if (typeof look?.id === "string" && typeof look.name === "string") names.set(look.id, look.name);
  }
  return names;
}

export async function buildShowroom(options: ShowroomBuildOptions): Promise<{ manifest: ShowroomManifest; package: string }> {
  const log = options.log ?? (() => {});
  const cancelled = () => { if (options.signal?.aborted) fail("package_build_cancelled", "The showroom build was cancelled."); };
  const skin = options.skin ?? DEFAULT_SKIN, eyes = options.eyes ?? DEFAULT_EYES;
  if (!SKIN_PATTERN.test(skin)) fail("usage", `"${skin}" is not a head skin appearance (for example 01_ca_pale or 03_ca_senna_d03).`);
  if (!EYES_PATTERN.test(eyes)) fail("usage", `"${eyes}" is not an eye colour appearance (for example gradient_brown).`);
  const text = readFileSync(options.collection, "utf8").replace(/^﻿/, "");
  const collectionSha256 = sha256(text);
  const derived = showroomCollection(JSON.parse(text));
  const names = lookNames(JSON.parse(text));

  const work = resolve(options.buildRoot, `showroom-${timeToken()}`);
  if (existsSync(work)) fail("package_root_unsafe", "The showroom's work folder already exists.");
  mkdirSync(join(work, "logs"), { recursive: true });
  const derivedFile = join(work, "collection.json");
  writeFileSync(derivedFile, JSON.stringify(derived.collection, null, 2) + "\n", "utf8");

  // 1–2. The eye-makeup pipeline, unchanged, on the showroom's copy.
  log(`Building the presets' plates and textures through the eye-makeup pipeline (${derived.collection.id as string})`);
  const eyeExporters = options.exporters.filter(entry => entry.exporter.feature === EYE_MAKEUP_FEATURE);
  if (eyeExporters.length !== 1) fail("package_build_failed", "The host composition has no eye-makeup exporter.");
  const eye: PackageBuildResult = await runProductCommand({ exporters: eyeExporters, collection: derivedFile,
    diagnostics: options.diagnostics === true, prerequisites: options.prerequisites, wolvenkit: options.wolvenkit, gamepath: options.gamepath,
    appRoot: options.appRoot, buildRoot: join(work, "eye-build"), distRoot: join(work, "eye-dist"), signal: options.signal, log,
    tools: options.tools, verifierTools: options.verifierTools }) as PackageBuildResult;
  if (eye.products.length !== 1) fail("package_build_failed", "The eye-makeup build made more than one mod.");
  const product = eye.products[0]!;
  const feature = product.features.find(f => f.feature === EYE_MAKEUP_FEATURE);
  if (!feature || product.features.length !== 1) fail("package_build_failed", "The eye-makeup build holds other features.");
  const eyeManifestPath = product.manifest, eyeManifestText = readFileSync(eyeManifestPath, "utf8");
  const eyeManifest = JSON.parse(eyeManifestText) as { archive: string; files: { path: string; sha256: string }[];
    verifiedUnpackedFiles: number; features: { presets: { id: string; appearance: string; route: string }[]; experimental?: unknown[];
      omissions?: unknown[]; warnings?: unknown[]; requirements?: Record<string, string> }[] };
  const eyeArchive = join(product.package, "archive", "pc", "mod", eyeManifest.archive + ".archive");
  const eyeArchiveSha = fileHash(eyeArchive);
  if (eyeArchiveSha !== product.archiveSha256) fail("package_verification_failed", "The eye-makeup archive changed after verification.");

  // 3. Its plate mesh and textures.
  cancelled();
  const verifier = options.verifierTools(options.wolvenkit, options.gamepath);
  const unbundled = join(work, "eye-unbundled");
  mkdirSync(unbundled);
  const run = verifier.unbundle(eyeArchive, unbundled);
  if (run.exitCode !== 0 || /\bError\s*\]|Unhandled exception/.test(run.stdout + run.stderr))
    fail("package_tool_failed", `WolvenKit couldn't unpack the verified eye-makeup archive: ${(run.stdout + run.stderr).slice(-2000)}`);
  const eyeFiles = listGeneratedFiles(unbundled);
  const depot = `axefrog/appearance_studio/collections/${(derived.collection.id as string).replaceAll("-", "")}`;
  const paths = showroomPaths(depot);
  const plateMesh = `${depot}/models/xfs_eye_plate.mesh`;
  const kept = keptFromEyeMakeup(depot, eyeFiles);
  if (!kept.some(f => f.path === plateMesh)) fail("package_build_failed", "The eye-makeup build has no plate mesh at the planned path.");

  // 4. The showroom's own resources.
  const presets = eyeManifest.features[0]!.presets;
  const pieces: ShowroomPiece[] = presets.map(p => ({ id: p.id, name: names.get(p.id) ?? p.appearance, appearance: p.appearance, route: p.route }));
  const staging = join(work, "archive");
  for (const file of kept) {
    const target = join(staging, ...file.path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(unbundled, ...file.path.split("/")), target);
  }
  const json = join(work, "showroom-json"), resources = join(staging, ...`${depot}/showroom`.split("/"));
  mkdirSync(json, { recursive: true });
  mkdirSync(resources, { recursive: true });
  const leaf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  writeFileSync(join(json, leaf(paths.app) + ".json"), resourceText(showroomAppearanceResource(pieces, plateMesh, { skin, eyes })), "utf8");
  writeFileSync(join(json, leaf(paths.entity) + ".json"), resourceText(entityTemplate(paths.app, pieces.map(p => p.appearance))), "utf8");
  writeFileSync(join(json, leaf(paths.rigApp) + ".json"), resourceText(rigAppearanceResource()), "utf8");
  writeFileSync(join(json, leaf(paths.rigEntity) + ".json"), resourceText(entityTemplate(paths.rigApp, RIG_PROFILES.map(rigAppearance))), "utf8");
  cancelled();
  const tools = options.tools(options.wolvenkit, work, options.signal);
  const converted = await tools.deserialize(json, resources);
  writeFileSync(join(work, "logs", "deserialize.log"), converted.log, "utf8");
  if (converted.exitCode !== 0) fail("package_tool_failed", "WolvenKit couldn't write the showroom's resources.");

  // Pre-pack gate: exactly the kept files and the four showroom resources.
  const planned = showroomInventory(depot, kept);
  const staged = listGeneratedFiles(staging);
  if (JSON.stringify(staged.map(f => f.path)) !== JSON.stringify(planned)) fail("package_build_failed", "The showroom's staging tree differs from its plan.");
  for (const file of kept) if (staged.find(f => f.path === file.path)?.sha256 !== file.sha256)
    fail("package_build_failed", "A copied plate or texture differs from the verified eye-makeup build.");

  // 5. Pack, verify, promote.
  cancelled();
  const packDir = join(work, "packed");
  mkdirSync(packDir);
  const packed = await tools.pack(staging, packDir);
  writeFileSync(join(work, "logs", "pack.log"), packed.log, "utf8");
  if (!existsSync(join(packDir, "archive.archive")) || readdirSync(packDir).length !== 1) fail("package_build_failed", "WolvenKit did not produce exactly one archive.");
  const archive = join(packDir, `${paths.archive}.archive`);
  renameSync(join(packDir, "archive.archive"), archive);
  const archiveSha = fileHash(archive);
  const verification = verifyShowroomArchive({ archive, archiveSha256: archiveSha, files: staged, tools: verifier, work: join(work, "verify"),
    expected: { depot, pieces: pieces.map(p => p.appearance), skin, eyes, eyeUnbundled: unbundled, eyeFiles } });
  log("independent showroom verification complete");

  cancelled();
  const token = `${paths.archive}-${timeToken()}`;
  const final = join(resolve(options.distRoot), token), stage = join(resolve(options.distRoot), `.staging-${token}`);
  if (existsSync(final) || existsSync(stage)) fail("package_root_unsafe", "The showroom's destination already exists.");
  const target = join(stage, "archive", "pc", "mod");
  mkdirSync(target, { recursive: true });
  copyFileSync(archive, join(target, `${paths.archive}.archive`));
  if (fileHash(join(target, `${paths.archive}.archive`)) !== archiveSha) fail("package_verification_failed", "The promoted archive differs from the verified one.");
  const feature0 = eyeManifest.features[0]!;
  const manifest: ShowroomManifest = {
    schema: SHOWROOM_SCHEMA, modName: SHOWROOM_MOD_NAME, builderVersion: SHOWROOM_BUILDER_VERSION, archive: paths.archive,
    collectionId: derived.sourceId, collectionName: derived.name, collectionSha256, showroomCollectionId: derived.collection.id as string,
    diagnostics: options.diagnostics === true, entity: paths.entity, rigEntity: paths.rigEntity,
    look: { skin, eyes, head: SHOWROOM_VANILLA.head, eyesMesh: SHOWROOM_VANILLA.eyes, faceRig: SHOWROOM_VANILLA.faceRig },
    headJoint: [...HEAD_JOINT], pedestal: PEDESTAL, pieces,
    rigs: Object.fromEntries(RIG_PROFILES.map(profile => [profile, { appearance: rigAppearance(profile), lights: rigLights(profile) }])) as unknown as ShowroomManifest["rigs"],
    // The bridge spawns the showroom through Codeware (detected, never installed); ArchiveXL expands the plate's material paths.
    requirements: { ...(feature0.requirements ?? {}), Codeware: "1.20.4" },
    eyeMakeup: { archiveSha256: eyeArchiveSha, manifestSha256: sha256(eyeManifestText), verifiedUnpackedFiles: eyeManifest.verifiedUnpackedFiles,
      experimental: feature0.experimental ?? [], omissions: feature0.omissions ?? [], warnings: feature0.warnings ?? [] },
    files: [{ path: `archive/pc/mod/${paths.archive}.archive`, sha256: archiveSha, bytes: statSync(archive).size }],
    verification, installed: false, gameRenderingVerified: false,
  };
  writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  try { renameSync(stage, final); } finally { if (existsSync(stage)) rmSync(stage, { recursive: true, force: true }); }
  log(`Promoted ${final}`);
  return { manifest, package: final };
}

/** The planned inventory of a showroom archive, for tests: the kept eye-makeup files plus the four showroom resources. */
export function showroomInventory(depot: string, kept: readonly GeneratedFile[]): string[] {
  const paths = showroomPaths(depot);
  return [...kept.map(f => f.path), paths.app, paths.entity, paths.rigApp, paths.rigEntity].sort();
}

/** Resources the showroom keeps from an eye-makeup build: its plate mesh and every texture. */
export function keptFromEyeMakeup(depot: string, files: readonly GeneratedFile[]): GeneratedFile[] {
  return files.filter(f => f.path === `${depot}/models/xfs_eye_plate.mesh` || (f.path.startsWith(`${depot}/textures/`) && f.path.endsWith(".xbm")));
}
