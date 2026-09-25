// Independent package verifier: filesystem/WolvenKit adapter over the pure checks.
//
// TypeScript port of experiments/005-preset-collection/verify.py. It verifies
// actual converted resources, decoded texture pixels and archive payloads of one
// intermediate build. It deliberately imports nothing from the compiler
// (flat-mip-chain.ts, archive-inventory*.ts, preset-*.ts): texture arithmetic,
// DDS reading and the resource inventory are reimplemented in this directory, and
// tests/mod-verifier.test.ts enforces that import boundary.
//
// Self-sourcing: the verifier reads none of the builder's conversions. It copies the
// packed archive and the plate inputs into its own empty work directory, unbundles
// that archive copy, requires every member's SHA-256 to equal the build record, and
// only then runs its own WolvenKit `convert serialize` (resources and plate inputs)
// and `export` (textures) on those files. Every structural and pixel check therefore
// reads data derived from hash-checked archive members. The `.archive.xl` is parsed
// as YAML from the same bytes it hashes, and the plate inputs are re-hashed at the
// end against the provenance recorded at the start.
//
// Differences from verify.py, all deliberate:
// - Base-map inputs are the baked raw maps, checked against the build record's
//   SHA-256, instead of PNG copies written by the builder.
// - Decoded base levels come from WolvenKit's DDS export (level 0) instead of its
//   PNG export. verify.py asserted that both are byte-identical on every build it
//   passed, so the PNG round trip adds no evidence.
// - verify.py read the builder's own round trip and texture export; this verifier
//   converts the unbundled members itself (above).
// - The work directory must start empty, so stale files cannot be counted.
// Dynamic expansion checks model inspected ArchiveXL rules; they do not run the game.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { readDdsChain } from "./dds-reader";
import { resourceRecords, type ResourceFile } from "./resource-inventory";
import { checkArchiveXl, checkResources, ensure, sameJson, VerificationError, type Node, type VerifierPlan } from "./resource-checks";
import { contributionsOf, errorStats, expectedChain, halve, type ContributionPlanes, type ErrorStats } from "./texture-checks";

export { VerificationError } from "./resource-checks";

export interface ToolResult { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }

/** The three WolvenKit operations the verifier runs itself. Each writes only into `output`. */
export interface VerifierTools {
  unbundle(archive: string, output: string): ToolResult;
  serialize(input: string, output: string): ToolResult;
  exportTextures(input: string, output: string): ToolResult;
}

export interface VerifyBuildOptions {
  /** Intermediate build directory containing build.json. */
  readonly build: string;
  /** WolvenKit.CLI executable the verifier runs itself. */
  readonly wolvenkit: string;
  /** Game folder that WolvenKit's `export` command requires; read only. */
  readonly gamepath?: string;
  /** Empty or absent directory for the verifier's own files; defaults to <build>/verify. */
  readonly workDir?: string;
  /**
   * Plate input files given to the builder, with the hashes the caller prepared. Defaults to the
   * build record's `plateInputs`; either way the files must hash to the build record's values.
   */
  readonly plate?: { readonly mesh: string; readonly morph: string; readonly meshSha256?: string; readonly morphSha256?: string };
  /** Morph target count from the plate recipe; absent accepts the source plate's own count. */
  readonly morphTargets?: number;
  /** Test seam for the WolvenKit operations. */
  readonly tools?: Partial<VerifierTools>;
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
  archiveBytes: number; archiveSha256: string; unpackedFilesVerified: number; preservedMorphs: number;
  modelBuffersUnchanged: true;
  resolvedDynamicPaths: ReturnType<typeof checkResources>["resolved"];
  decodedPixelChecks: {
    preset: string; coveredTexels: number; coverageError: ErrorStats; premultipliedEncodedColourError: ErrorStats;
    premultipliedSurfaceError: { roughness: ErrorStats; metalness: ErrorStats };
  }[];
  decodedMipChecks: { preset: string; levels: MipRow[] }[];
  /** SHA-256 of the `.archive.xl` bytes that were parsed and checked. */
  archiveXlSha256: string;
  /** Plate input hashes, equal at the start and the end of verification. */
  plateInputs: { mesh: string; morph: string };
  installed: false; gameRenderingVerified: false; limits: string[];
}

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const readJson = (path: string): Node => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
const bytes = (path: string) => new Uint8Array(readFileSync(path));
const fileName = (depotPath: string) => depotPath.slice(depotPath.lastIndexOf("/") + 1);
const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };

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

function checkTextures(build: string, record: Node, preset: VerifierPlan["presets"][number], exported: (depotPath: string) => string) {
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
    const suppliedPath = join(build, "input", group, `${name}_${channel}.dds`), decodedPath = exported(preset.textures[channel]);
    const supplied = readDdsChain(bytes(suppliedPath), channel, suppliedPath), exportedChain = readDdsChain(bytes(decodedPath), channel, decodedPath);
    ensure(supplied.side === size && exportedChain.side === size, `${name} ${channel} DDS size differs from ${size}`);
    ensure(supplied.levels.length === expected[channel].length &&
      supplied.levels.every((level, i) => Buffer.compare(level, expected[channel][i]) === 0),
    `Supplied ${channel} mip chain for ${name} differs from the independent coverage-space reference`);
    ensure(exportedChain.levels.length === Math.log2(size) + 1, `Decoded ${channel} chain for ${name} is incomplete`);
    decoded[channel] = exportedChain.levels;
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

function defaultTools(wolvenkit: string, gamepath: string | undefined): VerifierTools {
  const run = (label: string, args: string[]): ToolResult => {
    const result = spawnSync(wolvenkit, args, { encoding: "utf8", timeout: 240_000, windowsHide: true, maxBuffer: 64 << 20 });
    if (result.error) throw new VerificationError(`WolvenKit ${label} could not run: ${result.error.message}`);
    return { exitCode: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  return {
    unbundle: (archive, output) => run("unbundle", ["unbundle", archive, "-o", output]),
    serialize: (input, output) => run("serialize", ["convert", "serialize", input, "-o", output]),
    exportTextures: (input, output) => {
      ensure(gamepath && existsSync(gamepath) && statSync(gamepath).isDirectory(), "WolvenKit texture export needs the game folder (--gamepath).");
      return run("export", ["export", input, "-o", output, "--uext", "dds", "--gamepath", gamepath!]);
    },
  };
}

/** Plate input files and their hashes: the caller's, else the build record's; both must agree. */
function plateInputs(build: Node, options: VerifyBuildOptions) {
  const recorded: Node[] = Array.isArray(build.plateInputs) ? build.plateInputs : [];
  const byExtension = (extension: string) => recorded.filter(entry => typeof entry?.path === "string" &&
    entry.path.toLowerCase().endsWith(extension));
  const mesh = byExtension(".mesh"), morph = byExtension(".morphtarget");
  ensure(recorded.length === 2 && mesh.length === 1 && morph.length === 1, "Build record must name exactly one plate mesh and morph target input");
  const files = { mesh: resolve(options.plate?.mesh ?? mesh[0].path), morph: resolve(options.plate?.morph ?? morph[0].path) };
  const start = { mesh: "", morph: "" };
  for (const role of ["mesh", "morph"] as const) {
    ensure(isFile(files[role]), `Plate ${role} input is missing: ${files[role]}`);
    start[role] = sha256(readFileSync(files[role]));
    const record = role === "mesh" ? mesh[0] : morph[0];
    ensure(start[role] === record.sha256, `Plate ${role} input differs from the build record`);
    const expected = role === "mesh" ? options.plate?.meshSha256 : options.plate?.morphSha256;
    ensure(expected === undefined || start[role] === expected, `Plate ${role} input differs from the plate the host prepared`);
  }
  return { files, start };
}

/** Verify one intermediate build; throws VerificationError on the first failed check. */
export function verifyBuild(options: VerifyBuildOptions): VerificationReport {
  const out = resolve(options.build), wolvenkit = resolve(options.wolvenkit);
  const injected = options.tools ?? {};
  ensure((injected.unbundle && injected.serialize && injected.exportTextures) || isFile(wolvenkit), `WolvenKit is missing: ${wolvenkit}`);
  const tools: VerifierTools = { ...defaultTools(wolvenkit, options.gamepath && resolve(options.gamepath)), ...injected };
  ensure(existsSync(join(out, "build.json")), `Build manifest is missing: ${out}`);
  const build = readJson(join(out, "build.json")), plan: VerifierPlan = build.plan;
  const work = resolve(options.workDir ?? join(out, "verify"));
  ensure(!existsSync(work) || readdirSync(work).length === 0, `Verifier work directory is not empty: ${work}`);
  const dirs = Object.fromEntries(["archive", "unpacked", "json", "plate", "plate-json", "dds", "logs"]
    .map(name => [name, join(work, name)])) as Record<"archive" | "unpacked" | "json" | "plate" | "plate-json" | "dds" | "logs", string>;
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  const runTool = (label: string, call: () => ToolResult) => {
    const result = call();
    writeFileSync(join(dirs.logs, `${label}.log`), result.stdout + result.stderr, "utf8");
    ensure(result.exitCode === 0 && !/\bError\s*\]|Unhandled exception/.test(result.stdout + result.stderr),
      `WolvenKit ${label} failed: ${(result.stdout + result.stderr).slice(-2000)}`);
  };

  // Plate provenance at the start: the host's plate files, hashed and copied before anything else.
  const plate = plateInputs(build, options);
  const plateCopy = { mesh: join(dirs.plate, basename(plate.files.mesh)), morph: join(dirs.plate, basename(plate.files.morph)) };
  for (const role of ["mesh", "morph"] as const) {
    copyFileSync(plate.files[role], plateCopy[role]);
    ensure(sha256(readFileSync(plateCopy[role])) === plate.start[role], `Plate ${role} input changed while it was copied`);
  }

  // The generated tree before packing must still equal the recorded inventory.
  ensure(sameJson(resourceRecords(listFiles(join(out, "archive")), plan), build.artifacts), "Generated resource inventory changed after pack");
  const records: Node[] = build.compiled;
  ensure(Array.isArray(records) && records.length === plan.presets.length, "Build record does not list one compiled record per preset");
  records.forEach((record, i) => ensure(record.id === plan.presets[i].id, `Compiled record ${i} does not match preset ${plan.presets[i].id}`));

  // Archive and declaration: hash exactly the bytes that are unbundled and parsed.
  const packageDir = join(out, "package", "archive", "pc", "mod");
  const archiveCopy = join(dirs.archive, plan.namespace + ".archive");
  copyFileSync(join(packageDir, plan.namespace + ".archive"), archiveCopy);
  const archiveData = bytes(archiveCopy), archiveSha256 = sha256(archiveData);
  ensure(archiveSha256 === build.archiveSha256, "Packed archive differs from the build record");
  const xlBytes = readFileSync(join(packageDir, plan.namespace + ".archive.xl"));
  let declaration: Node;
  try { declaration = Bun.YAML.parse(xlBytes.toString("utf8").replace(/^﻿/, "")); }
  catch (error) { throw new VerificationError(`ArchiveXL declaration is not valid YAML: ${(error as Error).message}`); }
  checkArchiveXl(plan, declaration);

  // Unbundle the verified archive copy; every member must match the build record byte for byte.
  runTool("unbundle", () => tools.unbundle(archiveCopy, dirs.unpacked));
  const files = listFiles(dirs.unpacked);
  ensure(files.length === build.artifacts.length, `Unpacked ${files.length} files; expected ${build.artifacts.length}`);
  ensure(sameJson(files.map(f => f.path).sort(), build.artifacts.map((a: Node) => a.path).sort()), "Unpacked member paths differ from the generated resources");
  const unpackedHashes = new Map(files.map(f => [f.path, f.sha256]));
  for (const artifact of build.artifacts) ensure(unpackedHashes.get(artifact.path) === artifact.sha256, `Unpacked ${artifact.path} differs from its generated payload`);
  const names = files.map(f => fileName(f.path));
  ensure(new Set(names).size === names.length, "Unpacked members must have distinct file names for conversion");

  // The verifier's own conversions of the hash-checked members and plate inputs.
  runTool("serialize-members", () => tools.serialize(dirs.unpacked, dirs.json));
  runTool("serialize-plate", () => tools.serialize(dirs.plate, dirs["plate-json"]));
  const converted = (dir: string, name: string) => {
    const path = join(dir, name + ".json");
    ensure(isFile(path), `WolvenKit did not serialize ${name}`);
    return readJson(path);
  };
  const root = (depotPath: string) => converted(dirs.json, fileName(depotPath)).Data.RootChunk;
  const textureDirs = [...new Set(plan.presets.flatMap(p => Object.values(p.textures)).map(path => path.slice(0, path.lastIndexOf("/"))))];
  const exportDirs = new Map<string, string>();
  textureDirs.forEach((dir, i) => {
    const target = join(dirs.dds, String(i));
    mkdirSync(target);
    runTool(`export-textures-${i}`, () => tools.exportTextures(join(dirs.unpacked, ...dir.split("/")), target));
    exportDirs.set(dir, target);
  });
  const exported = (depotPath: string) => {
    const path = join(exportDirs.get(depotPath.slice(0, depotPath.lastIndexOf("/")))!, fileName(depotPath).replace(/\.xbm$/, ".dds"));
    ensure(isFile(path), `WolvenKit did not export ${depotPath}`);
    return path;
  };

  const members = new Set(files.map(f => f.path));
  const summary = checkResources(plan, {
    mesh: root(plan.mesh), morph: root(plan.morph), app: root(plan.app), customization: root(plan.customization),
    sourceMesh: converted(dirs["plate-json"], basename(plateCopy.mesh)).Data.RootChunk,
    sourceMorph: converted(dirs["plate-json"], basename(plateCopy.morph)).Data.RootChunk,
    texture: path => root(path),
    archiveHas: path => members.has(path),
  }, build.artifacts.map((a: Node) => a.path), records.map(r => r.size), options.morphTargets ?? null);

  const pixelResults: VerificationReport["decodedPixelChecks"] = [], mipResults: VerificationReport["decodedMipChecks"] = [];
  plan.presets.forEach((preset, i) => {
    const { pixel, mips } = checkTextures(out, records[i], preset, exported);
    pixelResults.push(pixel);
    mipResults.push(mips);
  });

  // Plate provenance at the end must equal the start.
  for (const role of ["mesh", "morph"] as const)
    ensure(isFile(plate.files[role]) && sha256(readFileSync(plate.files[role])) === plate.start[role],
      `Plate ${role} input changed during verification`);

  return {
    build: out, presetCount: plan.presets.length, selectorCount: 1, selectorOptionCount: summary.selectorOptionCount,
    appDefinitions: 2, compiledComponentTemplates: 1, meshAppearances: summary.meshAppearances,
    materialTemplates: summary.materialTemplates, textureCount: plan.presets.length * 3,
    archiveBytes: archiveData.length, archiveSha256, unpackedFilesVerified: files.length, preservedMorphs: summary.morphTargets,
    modelBuffersUnchanged: true, resolvedDynamicPaths: summary.resolved, decodedPixelChecks: pixelResults,
    decodedMipChecks: mipResults, archiveXlSha256: sha256(xlBytes), plateInputs: { ...plate.start },
    installed: false, gameRenderingVerified: false, limits: [...VERIFICATION_LIMITS],
  };
}
