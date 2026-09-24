// Independent package verifier: filesystem/WolvenKit adapter over the pure checks.
//
// TypeScript port of experiments/005-preset-collection/verify.py. It verifies
// actual converted resources, decoded texture pixels and archive payloads of one
// intermediate build. It deliberately imports nothing from the compiler
// (flat-mip-chain.ts, archive-inventory*.ts, preset-*.ts): texture arithmetic,
// DDS reading and the resource inventory are reimplemented in this directory, and
// tests/mod-verifier.test.ts enforces that import boundary.
//
// Differences from verify.py, all deliberate:
// - Base-map inputs are the baked raw maps, checked against the build record's
//   SHA-256, instead of PNG copies written by the builder.
// - Decoded base levels come from WolvenKit's DDS export (level 0) instead of its
//   PNG export. verify.py asserted that both are byte-identical on every build it
//   passed, so the PNG round trip adds no evidence.
// - The unpack directory must start empty, so stale members cannot be counted.
// Dynamic expansion checks model inspected ArchiveXL rules; they do not run the game.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { readDdsChain } from "./dds-reader";
import { resourceRecords, type ResourceFile } from "./resource-inventory";
import { checkResources, ensure, sameJson, VerificationError, type Node, type VerifierPlan } from "./resource-checks";
import { contributionsOf, errorStats, expectedChain, halve, type ContributionPlanes, type ErrorStats } from "./texture-checks";

export { VerificationError } from "./resource-checks";

export interface UnbundleResult { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }

export interface VerifyBuildOptions {
  /** Intermediate build directory containing build.json. */
  readonly build: string;
  /** WolvenKit.CLI executable used to unbundle the packed archive. */
  readonly wolvenkit: string;
  /** Empty or absent directory for the unpacked archive; defaults to <build>/unpacked. */
  readonly unpackDir?: string;
  /** Serialized source plate, relative to the build; defaults to the Experiment 004 names. */
  readonly sourcePlate?: { readonly mesh: string; readonly morph: string };
  /** Test seam; defaults to `wolvenkit unbundle <archive> -o <dir>`. */
  readonly unbundle?: (archive: string, output: string) => UnbundleResult;
}

export const VERIFICATION_LIMITS: readonly string[] = [
  "Dynamic resolution is a source-derived model, not executed ArchiveXL.",
  "A/B/Off component clearing and save persistence need runtime evidence.",
  "Decoded XBM mip texel centres checked against coverage-space BOX reductions; bilinear/trilinear filtering between centres and game rendering remain unverified.",
  "Zero-offset plate control; outward clearance candidate still required.",
  "Flat matte/satin/metallic adapter only; other optical finishes remain required work.",
];

type MipRow = { level: number; size: number; partialTexels: number; coverage?: ErrorStats; premultipliedDestination?: ErrorStats };

export interface VerificationReport {
  build: string; presetCount: number; selectorCount: 1; selectorOptionCount: number; appDefinitions: 2;
  compiledComponentTemplates: 1; meshAppearances: number; materialTemplates: number; textureCount: number;
  archiveBytes: number; archiveSha256: string; unpackedFilesVerified: number; preservedMorphs: 105;
  modelBuffersUnchanged: true;
  resolvedDynamicPaths: ReturnType<typeof checkResources>["resolved"];
  decodedPixelChecks: {
    preset: string; coveredTexels: number; coverageError: ErrorStats; premultipliedEncodedColourError: ErrorStats;
    premultipliedSurfaceError: { roughness: ErrorStats; metalness: ErrorStats };
  }[];
  decodedMipChecks: { preset: string; levels: MipRow[] }[];
  installed: false; gameRenderingVerified: false; limits: string[];
}

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const readJson = (path: string): Node => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
const bytes = (path: string) => new Uint8Array(readFileSync(path));
const fileName = (depotPath: string) => depotPath.slice(depotPath.lastIndexOf("/") + 1);

function listFiles(root: string): ResourceFile[] {
  const files: ResourceFile[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry), info = lstatSync(path);
      ensure(!info.isSymbolicLink(), `Linked path in verified tree: ${path}`);
      if (info.isDirectory()) walk(path);
      else if (info.isFile()) files.push({ path: relative(root, path).split(sep).join("/"), bytes: info.size, sha256: sha256(readFileSync(path)) });
    }
  };
  walk(root);
  return files;
}

/** abs(a - b) at selected texels, interleaving planes per texel as NumPy's [mask] indexing does. */
function absoluteErrors(a: readonly Float64Array[], b: readonly Float64Array[], mask: Uint8Array | null, count: number): Float64Array {
  const planes = a.length, out = new Float64Array(count * planes);
  let o = 0;
  for (let t = 0; t < a[0].length; t++) {
    if (mask && !mask[t]) continue;
    for (let k = 0; k < planes; k++) out[o++] = Math.abs(a[k][t] - b[k][t]);
  }
  return out;
}

function mean(values: Float64Array) { return errorStats(values).mean; }

function checkTextures(build: string, plan: VerifierPlan, record: Node, preset: VerifierPlan["presets"][number]) {
  const size: number = record.size, name = preset.appearance;
  const raw: Record<string, Uint8Array> = {};
  for (const map of record.maps as Node[]) {
    const data = bytes(join(build, "baked", map.file));
    ensure(sha256(data) === map.sha256 && data.length === map.bytes, `Baked ${map.channel} map differs from the build record: ${map.file}`);
    raw[map.channel] = data;
  }
  ensure(raw.diffuse && raw.roughness && raw.metalness, `Build record for ${name} lacks a base map`);
  const { chain: expected, ideal: idealChain } = expectedChain(raw.diffuse, raw.roughness, raw.metalness, size);
  const decoded: Record<string, readonly Uint8Array[]> = {};
  for (const channel of ["diffuse", "roughness", "metalness"] as const) {
    const group = channel === "diffuse" ? "dds-colour" : "dds-scalar";
    const suppliedPath = join(build, "input", group, `${name}_${channel}.dds`), decodedPath = join(build, "export-dds", `${name}_${channel}.dds`);
    const supplied = readDdsChain(bytes(suppliedPath), channel, suppliedPath), exported = readDdsChain(bytes(decodedPath), channel, decodedPath);
    ensure(supplied.side === size && exported.side === size, `${name} ${channel} DDS size differs from ${size}`);
    ensure(supplied.levels.length === expected[channel].length &&
      supplied.levels.every((level, i) => Buffer.compare(level, expected[channel][i]) === 0),
    `Supplied ${channel} mip chain for ${name} differs from the independent coverage-space reference`);
    ensure(exported.levels.length === Math.log2(size) + 1, `Decoded ${channel} chain for ${name} is incomplete`);
    decoded[channel] = exported.levels;
  }

  // Base level: decoded XBM against the compiler's exact base pixels.
  const source = idealChain[0], actual = contributionsOf(decoded.diffuse[0], decoded.roughness[0], decoded.metalness[0], size);
  const texels = size * size, active = new Uint8Array(texels);
  let covered = 0;
  for (let t = 0; t < texels; t++) if (source.planes[5][t] > 1e-5) { active[t] = 1; covered++; }
  const colourPlanes = (level: ContributionPlanes) => level.planes.slice(0, 3);
  const colour = errorStats(absoluteErrors(colourPlanes(source), colourPlanes(actual), active, covered));
  const alpha = errorStats(absoluteErrors([source.planes[5]], [actual.planes[5]], active, covered));
  ensure(colour.mean < .015 && colour.p95 < .05 && alpha.p95 < .05,
    `Decoded base colour/coverage error too large for ${name}: ${JSON.stringify({ colour, alpha })}`);
  const flipped = actual.planes.slice(0, 3).map(plane => {
    const out = new Float64Array(texels);
    for (let row = 0; row < size; row++) out.set(plane.subarray((size - 1 - row) * size, (size - row) * size), row * size);
    return out;
  });
  ensure(mean(absoluteErrors(colourPlanes(source), colourPlanes(actual), null, texels)) <
    mean(absoluteErrors(colourPlanes(source), flipped, null, texels)), `Unexpected texture row orientation for ${name}`);
  const scalar = {} as { roughness: ErrorStats; metalness: ErrorStats };
  for (const [channel, plane] of [["roughness", 3], ["metalness", 4]] as const) {
    const error = errorStats(absoluteErrors([source.planes[plane]], [actual.planes[plane]], active, covered));
    ensure(error.p95 < .05, `Decoded ${channel} error too large for ${name}: ${JSON.stringify(error)}`);
    scalar[channel] = error;
  }
  const pixel = { preset: preset.name, coveredTexels: covered, coverageError: alpha, premultipliedEncodedColourError: colour,
    premultipliedSurfaceError: scalar };

  // Full decoded chain against coverage-space reductions of the original base pixels.
  const levels: MipRow[] = [];
  let ideal = source;
  for (let mip = 0; mip < decoded.diffuse.length; mip++) {
    if (mip) ideal = halve(ideal);
    const side = ideal.side, level = contributionsOf(decoded.diffuse[mip], decoded.roughness[mip], decoded.metalness[mip], side);
    const edge = new Uint8Array(side * side);
    let partial = 0;
    for (let t = 0; t < edge.length; t++) if (ideal.planes[5][t] > .002 && ideal.planes[5][t] < .998) { edge[t] = 1; partial++; }
    if (!partial) { levels.push({ level: mip, size: side, partialTexels: 0 }); continue; }
    const row: MipRow = { level: mip, size: side, partialTexels: partial,
      coverage: errorStats(absoluteErrors([level.planes[5]], [ideal.planes[5]], edge, partial)),
      premultipliedDestination: errorStats(absoluteErrors(level.planes.slice(0, 5), ideal.planes.slice(0, 5), edge, partial)) };
    if (mip >= 1 && mip <= 5)
      ensure(row.coverage!.mean < .05 && row.premultipliedDestination!.mean < .035, `Decoded mip ${mip} error too large for ${name}: ${JSON.stringify(row)}`);
    levels.push(row);
  }
  return { pixel, mips: { preset: preset.name, levels } };
}

function defaultUnbundle(wolvenkit: string): NonNullable<VerifyBuildOptions["unbundle"]> {
  return (archive, output) => {
    const result = spawnSync(wolvenkit, ["unbundle", archive, "-o", output], { encoding: "utf8", timeout: 180_000, windowsHide: true, maxBuffer: 64 << 20 });
    if (result.error) throw new VerificationError(`WolvenKit unbundle could not run: ${result.error.message}`);
    return { exitCode: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
}

/** Verify one intermediate build; throws VerificationError on the first failed check. */
export function verifyBuild(options: VerifyBuildOptions): VerificationReport {
  const out = resolve(options.build), wolvenkit = resolve(options.wolvenkit);
  ensure(options.unbundle || (existsSync(wolvenkit) && statSync(wolvenkit).isFile()), `WolvenKit is missing: ${wolvenkit}`);
  ensure(existsSync(join(out, "build.json")), `Build manifest is missing: ${out}`);
  ensure(existsSync(join(out, "export-dds")), "The selected build predates supplied mip chains; rebuild before verifying");
  const build = readJson(join(out, "build.json")), plan: VerifierPlan = build.plan;
  const archive = join(out, "archive"), roundtrip = join(out, "roundtrip");
  ensure(sameJson(resourceRecords(listFiles(archive), plan), build.artifacts), "Generated resource inventory changed after pack");
  const root = (file: string) => readJson(join(roundtrip, file)).Data.RootChunk;
  const plate = options.sourcePlate ?? { mesh: "source-json/xfas_eye_plate.mesh.json", morph: "source-json/xfas_eye_plate.morphtarget.json" };
  const records: Node[] = build.compiled;
  ensure(Array.isArray(records) && records.length === plan.presets.length, "Build record does not list one compiled record per preset");
  records.forEach((record, i) => ensure(record.id === plan.presets[i].id, `Compiled record ${i} does not match preset ${plan.presets[i].id}`));
  const summary = checkResources(plan, {
    mesh: root(fileName(plan.mesh) + ".json"), morph: root(fileName(plan.morph) + ".json"),
    app: root(fileName(plan.app) + ".json"), customization: root(fileName(plan.customization) + ".json"),
    sourceMesh: readJson(join(out, plate.mesh)).Data.RootChunk, sourceMorph: readJson(join(out, plate.morph)).Data.RootChunk,
    texture: path => root(fileName(path) + ".json"),
    archiveHas: path => existsSync(join(archive, ...path.split("/"))) && statSync(join(archive, ...path.split("/"))).isFile(),
  }, build.artifacts.map((a: Node) => a.path), records.map(r => r.size));

  const pixelResults: VerificationReport["decodedPixelChecks"] = [], mipResults: VerificationReport["decodedMipChecks"] = [];
  plan.presets.forEach((preset, i) => {
    const { pixel, mips } = checkTextures(out, plan, records[i], preset);
    pixelResults.push(pixel);
    mipResults.push(mips);
  });

  const packed = join(out, "package", "archive", "pc", "mod", plan.namespace + ".archive");
  const archiveData = bytes(packed), archiveSha256 = sha256(archiveData);
  ensure(archiveSha256 === build.archiveSha256, "Packed archive differs from the build record");
  const xl = readFileSync(join(out, "package", "archive", "pc", "mod", plan.namespace + ".archive.xl"), "utf8");
  ensure(xl.includes(plan.customization.replaceAll("/", "\\")) && xl.includes(plan.app.replaceAll("/", "\\")),
    "ArchiveXL declaration does not register the customization and app");
  const unpacked = resolve(options.unpackDir ?? join(out, "unpacked"));
  ensure(!existsSync(unpacked) || readdirSync(unpacked).length === 0, `Unpack directory is not empty: ${unpacked}`);
  mkdirSync(unpacked, { recursive: true });
  const result = (options.unbundle ?? defaultUnbundle(wolvenkit))(packed, unpacked);
  mkdirSync(join(out, "logs"), { recursive: true });
  writeFileSync(join(out, "logs", "unpack-verify.log"), result.stdout + result.stderr, "utf8");
  ensure(result.exitCode === 0 && !result.stdout.includes("Error"), `WolvenKit unbundle failed: ${result.stdout.slice(-2000)}`);
  const files = listFiles(unpacked);
  ensure(files.length === build.artifacts.length, `Unpacked ${files.length} files; expected ${build.artifacts.length}`);
  ensure(sameJson(files.map(f => f.path).sort(), build.artifacts.map((a: Node) => a.path).sort()), "Unpacked member paths differ from the generated resources");
  const unpackedHashes = new Map(files.map(f => [f.path, f.sha256]));
  for (const artifact of build.artifacts) ensure(unpackedHashes.get(artifact.path) === artifact.sha256, `Unpacked ${artifact.path} differs from its generated payload`);

  return {
    build: out, presetCount: plan.presets.length, selectorCount: 1, selectorOptionCount: summary.selectorOptionCount,
    appDefinitions: 2, compiledComponentTemplates: 1, meshAppearances: summary.meshAppearances,
    materialTemplates: summary.materialTemplates, textureCount: plan.presets.length * 3,
    archiveBytes: archiveData.length, archiveSha256, unpackedFilesVerified: files.length, preservedMorphs: 105,
    modelBuffersUnchanged: true, resolvedDynamicPaths: summary.resolved, decodedPixelChecks: pixelResults,
    decodedMipChecks: mipResults, installed: false, gameRenderingVerified: false, limits: [...VERIFICATION_LIMITS],
  };
}
