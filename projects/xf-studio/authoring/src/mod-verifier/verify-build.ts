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
// Routes are re-derived, not trusted: each preset's route comes from its packaged recipe under the
// verifier's own restated finish rules (resource-checks.ts), and the builder's plan and compiled
// records must name that same route. When the host passes the packaged collection it prepared,
// every recipe in the build record must equal it.
//
// WolvenKit runs through injected tools: hosts supply the shared runner's adapter
// (src/verifier-wolvenkit.ts), which keeps process mechanics out of this directory.
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
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { chainDimensions, readDdsChain, type DdsKind } from "./dds-reader";
import { resourceRecords, type ResourceFile } from "./resource-inventory";
import { checkPlateGeometry, VERIFIER_PLATE_LIFT_MM, type PlateGeometryReport } from "./plate-geometry";
import { checkArchiveXl, checkResources, ensure, expectedPlateLifts, fresnelPigment, glitterOf, GRADIENT_SIDE, routeOf, sameJson, textureDims, uvSpaceOf,
  VerificationError, type Node, type VerifierPlan, type VerifierRoute, type VerifierUvSpace } from "./resource-checks";
import { contributionsOf, errorStats, expectedChain, facetedReference, halve, maskReference, normalInputOf, uniformReference,
  type ContributionPlanes, type ErrorStats } from "./texture-checks";
import { checkAccentChain, checkGlitterChains, splitChain, type AccentReport, type GlitterChainReport } from "./glitter-checks";
import { expectedUvConstants, expectedWindow, mappingOffset, mappingStats, plateUvSamples, sameWindow, storedBc4Level0,
  type MappingStats, type PlateUvSamples, type ReferenceCrop, type VerifierWindow } from "./uv-window";

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
  /** The verifier's WolvenKit operations (src/verifier-wolvenkit.ts, or a test fake). */
  readonly tools: VerifierTools;
  /** The packaged (filtered) collection the host prepared; every recipe in the build record must equal it. */
  readonly packagedCollection?: unknown;
  /** Empty or absent directory for the verifier's own files; defaults to <build>/verify. */
  readonly workDir?: string;
  /**
   * Plate input files given to the builder, with the hashes the caller prepared. Defaults to the
   * build record's `plateInputs`; either way the files must hash to the build record's values.
   */
  readonly plate?: { readonly mesh: string; readonly morph: string; readonly meshSha256?: string; readonly morphSha256?: string };
  /** Morph target count from the plate recipe; absent accepts the source plate's own count. */
  readonly morphTargets?: number;
}

export const VERIFICATION_LIMITS: readonly string[] = [
  "Dynamic resolution is a source-derived model, not executed ArchiveXL.",
  "A/B/Off component clearing and save persistence need runtime evidence.",
  "Decoded XBM mip texel centres checked against coverage-space BOX reductions; bilinear/trilinear filtering between centres and game rendering remain unverified.",
  "Plate lift checked against the vanilla face-decal offset (0.40 mm along the head's normals, morph-aware); depth behaviour, eyelid contact and deformation need in-game evidence.",
  "Flat, faceted and Fresnel decal routes are checked as resources and pixels; the faceted normal sign, the Fresnel colour-parameter encoding and every finish's lit appearance need in-game evidence.",
  "The plate-local UV window is re-derived from the packaged plate's UVs; window maps are compared with the authored head-UV coverage at plate sample points through the restated mesh_decal UV transform and WolvenKit's stored row order (checked on each build). The game's own sampling of the window is untested.",
  "The Glitter finish has no export route; only Matte, Satin, Metallic and the experimental game-matched Glossy, Shimmer and Colour-shifting finishes are packaged from authored layers.",
  "A diagnostic glitter knob's nested flake chains are checked for their published properties (coverage, resolved and nested flakes, tilt, density, BOX and sheen rules) and against the decoded XBMs, not re-drawn from the flake catalogue; the accent chunk's glow, and every glint in game, need in-game evidence.",
];

type MipRow = { level: number; width: number; height: number; partialTexels: number; coverage?: ErrorStats; premultipliedDestination?: ErrorStats; widenedRoughness?: ErrorStats };
/** The window the verifier derived from the packaged plate, its constants, and how many plate points it sampled. */
export type PlateUvWindowReport = { bounds: PlateUvSamples["bounds"]; window: VerifierWindow; constants: Record<string, number>; samples: number };
/** Per preset: texture space, stored row order (checked on a BC4 map) and, for window maps, the plate-sample mapping. */
type SpaceCheck = { uvSpace: VerifierUvSpace; width: number; height: number; storedRows: "reversed"; mapping?: MappingCheck };
/** Plate-sample statistics of a window map and its signed offset estimate (window texels; null: no edges on that axis). */
export type MappingCheck = MappingStats & { offsetTexels: { u: number | null; v: number | null } };

export interface VerificationReport {
  build: string; presetCount: number; selectorCount: 1; selectorOptionCount: number; appDefinitions: 2;
  compiledComponentTemplates: 1; meshAppearances: number; materialTemplates: number; textureCount: number;
  archiveBytes: number; archiveSha256: string; unpackedFilesVerified: number; preservedMorphs: number;
  /** The packaged plate against its input: lifted positions, all other bytes exact. */
  plateGeometry: PlateGeometryReport;
  resolvedDynamicPaths: ReturnType<typeof checkResources>["resolved"];
  /** The plate-local UV window re-derived from the packaged plate. */
  plateUvWindow: PlateUvWindowReport;
  decodedPixelChecks: ((SpaceCheck & {
    preset: string; coveredTexels: number; coverageError: ErrorStats; premultipliedEncodedColourError: ErrorStats;
    premultipliedSurfaceError: { roughness: ErrorStats; metalness: ErrorStats }; route?: "faceted"; normalError?: ErrorStats;
  }) | (SpaceCheck & { preset: string; route: "fresnel"; coveredTexels: number; coverageError: ErrorStats; outsideCoverageMax: number; gradientError: ErrorStats })
    | (SpaceCheck & { preset: string; route: "glitter"; coveredTexels: number; coverageError: ErrorStats; decoded: GlitterDecodedReport; chains: GlitterChainReport; accent?: AccentReport & { decodedError: ErrorStats } }))[];
  decodedMipChecks: { preset: string; levels: MipRow[] }[];
  /** Each preset's route, re-derived from its recipe and matched by the plan, the compiled record and the resources. */
  presetRoutes: { id: string; route: VerifierRoute }[];
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

function readBaked(build: string, record: Node): Record<string, Uint8Array> {
  const raw: Record<string, Uint8Array> = {};
  for (const map of record.maps as Node[]) {
    const data = bytes(join(build, "baked", map.file));
    ensure(sha256(data) === map.sha256 && data.length === map.bytes, `Baked ${map.channel} map differs from the build record: ${map.file}`);
    raw[map.channel] = data;
  }
  return raw;
}

/** The context each preset's texture check needs: its space, the plate samples and window, and converted XBMs. */
type TextureContext = { exported: Exported; xbm: (depotPath: string) => Node; samples: PlateUvSamples; window: VerifierWindow; uv: Record<string, number> };

/**
 * Texture space of one preset. Its compiled record must name the re-derived space and grid (and the verifier's window
 * for window maps). A BC4 map's stored level 0, decoded here, must be the decoded export with its rows reversed: the
 * import flip every UV mapping below relies on. Window maps are then compared with the authored head-UV coverage at
 * the plate's own sample points.
 */
function checkSpace(build: string, record: Node, preset: VerifierPlan["presets"][number], scalar: "roughness" | "mask",
  decodedScalar: Uint8Array, coverage: Float64Array, context: TextureContext): SpaceCheck {
  const uvSpace = uvSpaceOf(preset), name = preset.appearance, dims = textureDims(preset, scalar);
  ensure(record.uvSpace === uvSpace, `Compiled record for ${name} is on ${String(record.uvSpace)} UV, but its route and diagnostics need ${uvSpace}`);
  ensure(record.width === dims.width && record.height === dims.height, `Compiled record for ${name} is ${record.width}x${record.height}, expected ${dims.width}x${dims.height}`);
  if (uvSpace === "plate-window") ensure(sameWindow(record.window, context.window), `Compiled record for ${name} uses another UV window than the packaged plate's`);
  else ensure(record.window === undefined, `Head-UV record for ${name} names a UV window`);
  const stored = storedBc4Level0(context.xbm(preset.textures[scalar]!), `${name} ${scalar}`);
  ensure(stored.width === dims.width && stored.height === dims.height, `${name} ${scalar} stored level 0 has unexpected dimensions`);
  let worst = 0;
  for (let y = 0; y < dims.height; y++) for (let x = 0; x < dims.width; x++)
    worst = Math.max(worst, Math.abs(stored.data[(dims.height - 1 - y) * dims.width + x] - decodedScalar[y * dims.width + x]));
  ensure(worst <= 1, `${name} ${scalar} is not stored with reversed rows (largest difference ${worst}); the UV mapping assumes WolvenKit's import flip`);
  const check: SpaceCheck = { uvSpace, width: dims.width, height: dims.height, storedRows: "reversed" };
  if (uvSpace !== "plate-window") return check;
  const reference = record.reference;
  ensure(reference && [reference.grid, reference.x0, reference.y0, reference.width, reference.height].every(Number.isInteger) &&
    reference.grid >= VERIFIER_REFERENCE_GRID, `Window preset ${name} has no head-UV coverage reference at least ${VERIFIER_REFERENCE_GRID} texels across`);
  const data = bytes(join(build, "baked", reference.file));
  ensure(sha256(data) === reference.sha256 && data.length === reference.width * reference.height, `Coverage reference for ${name} differs from the build record`);
  return { ...check, mapping: checkMapping(name, coverage, dims, context.uv, data, reference, context.samples) };
}
/**
 * Plate-sample agreement a window map needs with its head-UV reference: mean and far-off share in coverage
 * units, and the signed offset estimate in window texels on each axis.
 */
export const MAPPING_LIMITS = Object.freeze({ mean: .03, farShare: .01, offsetTexels: 1 });

/**
 * The mapping gate of one window map (decoded level-0 coverage in image row order) against its head-UV
 * reference at the plate samples. A wrong window, axis flip or large offset misplaces whole shapes, so many
 * points disagree by more than half; a small shift passes those limits, so its signed estimate is bounded too.
 */
export function checkMapping(name: string, coverage: Float64Array, dims: { width: number; height: number }, uv: Record<string, number>,
  reference: Uint8Array, crop: ReferenceCrop, samples: PlateUvSamples): MappingCheck {
  const stats = mappingStats(coverage, dims.width, dims.height, uv, reference, crop, samples);
  ensure(stats.covered > 0, `Window map for ${name} has no content at the plate's UVs`);
  // Faint makeup can pass the mean limit with an empty map; the makeup reaches the plate, so the map must draw it (PIPE-38).
  ensure(stats.authored === 0 || stats.drawn > 0, `Window map for ${name} is empty at the plate's UVs, where its authored makeup reaches`);
  ensure(stats.mean < MAPPING_LIMITS.mean && stats.farShare < MAPPING_LIMITS.farShare,
    `Window map for ${name} does not match its authored head-UV content at the plate's UVs: ${JSON.stringify(stats)}`);
  const offsetTexels = mappingOffset(coverage, dims.width, dims.height, uv, reference, crop, samples);
  ensure([offsetTexels.u, offsetTexels.v].every(o => o === null || Math.abs(o) <= MAPPING_LIMITS.offsetTexels),
    `Window map for ${name} is shifted from its authored head-UV content by ${JSON.stringify(offsetTexels)} texels (limit ${MAPPING_LIMITS.offsetTexels})`);
  return { ...stats, offsetTexels };
}
/** The reference must sample the head atlas at least this finely, so it is as sharp as the window map. */
export const VERIFIER_REFERENCE_GRID = 4096;

const GROUP: Record<string, string> = { diffuse: "dds-colour", gradient: "dds-colour", roughness: "dds-scalar", metalness: "dds-scalar",
  mask: "dds-scalar", normal: "dds-normal", flakes: "dds-scalar", accent: "dds-scalar" };
type Exported = (depotPath: string) => string;

/**
 * The builder's supplied import chain must equal the independent reference byte for byte; returns the
 * chain decoded from the verifier's own WolvenKit export of the unbundled member.
 */
function suppliedAndDecoded(build: string, preset: VerifierPlan["presets"][number], channel: string, dims: { width: number; height: number },
  expected: readonly Uint8Array[], what: string, exported: Exported) {
  const name = preset.appearance, depotPath = preset.textures[channel as keyof typeof preset.textures];
  ensure(typeof depotPath === "string", `Preset ${preset.name} plans no ${channel} texture`);
  const suppliedPath = join(build, "input", GROUP[channel], `${name}_${channel}.dds`), decodedPath = exported(depotPath);
  const supplied = readDdsChain(bytes(suppliedPath), channel === "normal" ? "normal-input" : channel as DdsKind, suppliedPath);
  const decoded = readDdsChain(bytes(decodedPath), channel as DdsKind, decodedPath);
  ensure([supplied, decoded].every(chain => chain.width === dims.width && chain.height === dims.height),
    `${name} ${channel} DDS size differs from ${dims.width}x${dims.height}`);
  ensure(supplied.levels.length === expected.length && supplied.levels.every((level, i) => Buffer.compare(level, expected[i]) === 0),
    `Supplied ${channel} mip chain for ${name} differs from the independent ${what} reference`);
  ensure(decoded.levels.length === chainDimensions(dims.width, dims.height).length, `Decoded ${channel} chain for ${name} is incomplete`);
  return decoded.levels;
}

const byteErrors = (a: Uint8Array, b: Uint8Array, stride: number, mask: Uint8Array | null, scale = 255) => {
  const out: number[] = [];
  for (let t = 0; t < a.length / stride; t++) if (!mask || mask[t]) for (let k = 0; k < stride; k++) out.push(Math.abs(a[t * stride + k] - b[t * stride + k]) / scale);
  return Float64Array.from(out);
};

function checkFresnelTextures(build: string, record: Node, preset: VerifierPlan["presets"][number], context: TextureContext) {
  const exported = context.exported, dims = textureDims(preset, "mask"), name = preset.appearance, raw = readBaked(build, record);
  ensure(raw.mask && raw.gradient, `Build record for ${name} lacks a Fresnel map`);
  ensure(raw.mask.length === dims.width * dims.height, `Baked mask for ${name} is not ${dims.width}x${dims.height}`);
  const { color } = fresnelPigment(preset), rgba = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)).concat(255);
  const gradientExpected = uniformReference(rgba, GRADIENT_SIDE);
  ensure(Buffer.compare(raw.gradient, gradientExpected[0]) === 0, `Baked gradient for ${name} is not the preset base colour`);
  const maskChain = maskReference(raw.mask, dims.width, dims.height);
  const mask = suppliedAndDecoded(build, preset, "mask", dims, maskChain, "linear coverage", exported);
  const gradient = suppliedAndDecoded(build, preset, "gradient", textureDims(preset, "gradient"), gradientExpected, "uniform colour", exported);
  const space = checkSpace(build, record, preset, "mask", mask[0], Float64Array.from(mask[0], v => v / 255), context);
  const covered = Uint8Array.from(raw.mask, v => (v ? 1 : 0)), count = covered.reduce((n, v) => n + v, 0);
  ensure(count > 0, `Fresnel preset ${name} covers no texels`);
  const coverageError = errorStats(byteErrors(mask[0], raw.mask, 1, covered));
  ensure(coverageError.mean < .01 && coverageError.p95 < .03, `Decoded mask error too large for ${name}: ${JSON.stringify(coverageError)}`);
  let outsideCoverageMax = 0;
  for (let t = 0; t < raw.mask.length; t++) if (!covered[t]) outsideCoverageMax = Math.max(outsideCoverageMax, mask[0][t] / 255);
  ensure(outsideCoverageMax <= 2 / 255, `Decoded mask spills outside coverage for ${name}: ${outsideCoverageMax}`);
  const gradientError = errorStats(byteErrors(gradient[0], gradientExpected[0], 4, null));
  ensure(gradientError.max <= 3 / 255, `Decoded base colour differs for ${name}: ${JSON.stringify(gradientError)}`);
  const levels: MipRow[] = [];
  const mipDims = chainDimensions(dims.width, dims.height);
  for (let mip = 0; mip < mask.length; mip++) {
    const { width, height } = mipDims[mip], ideal = maskChain[mip], edge = Uint8Array.from(ideal, v => (v > 0 && v < 255 ? 1 : 0));
    const partial = edge.reduce((n, v) => n + v, 0);
    if (!partial) { levels.push({ level: mip, width, height, partialTexels: 0 }); continue; }
    const row: MipRow = { level: mip, width, height, partialTexels: partial, coverage: errorStats(byteErrors(mask[mip], ideal, 1, edge)) };
    if (mip >= 1 && mip <= 5) ensure(row.coverage!.mean < .05, `Decoded mip ${mip} error too large for ${name}: ${JSON.stringify(row)}`);
    levels.push(row);
  }
  return { pixel: { preset: preset.name, route: "fresnel" as const, ...space, coveredTexels: count, coverageError, outsideCoverageMax, gradientError },
    mips: { preset: preset.name, levels } };
}

/** Decoded XBM levels of a glitter preset against its supplied chain, and the flake normals' BC5 error at level 0. */
type GlitterDecodedReport = {
  levels: { level: number; diffuse: number; alpha: number; roughness: number; metalness: number; flakes: number; normal: number }[];
  /** Angle (degrees) between supplied and decoded normals on level-0 flake texels (mask ≥ ½). */
  flakeNormalDegrees: ErrorStats;
  /** Level 0 flake mask error on flake edges (0 < mask < 255). */
  flakeEdgeError: ErrorStats;
  /** Levels 1–3: decoded flakes' mean error to the supplied nested level and to a BOX chain of level 0 (WolvenKit kept the supplied chain). */
  keptChain: { level: number; toSupplied: number; toBox: number }[];
};
const GLITTER_TEXEL_BYTES: Record<string, number> = { diffuse: 4, normal: 2, roughness: 1, metalness: 1, flakes: 1, accent: 1 };

function checkGlitterTextures(build: string, record: Node, preset: VerifierPlan["presets"][number], context: TextureContext) {
  const glitter = glitterOf(preset)!, name = preset.appearance, dims = textureDims(preset, "diffuse"), { width, height } = dims;
  const raw = readBaked(build, record), chains: Record<string, Uint8Array[]> = {};
  for (const map of record.maps as Node[]) {
    const channelDims = textureDims(preset, map.channel);
    ensure(map.width === channelDims.width && map.height === channelDims.height, `Glitter ${map.channel} map of ${name} is ${map.width}x${map.height}`);
    chains[map.channel] = splitChain(raw[map.channel], map.width, map.height, GLITTER_TEXEL_BYTES[map.channel], map.levels, `Glitter ${map.channel} map of ${name}`);
  }
  const wanted = ["diffuse", "roughness", "metalness", "normal", "flakes", ...(glitter.accent ? ["accent"] : [])];
  ensure(sameJson(Object.keys(chains).sort(), wanted.sort()), `Build record for ${name} lacks a glitter map`);
  // Published properties of the chains, restated.
  const alpha = expectedChain(chains.diffuse[0], chains.roughness[0], chains.metalness[0], width, height).chain.diffuse
    .map(level => Uint8Array.from({ length: level.length / 4 }, (_, t) => level[4 * t + 3]));
  const report = checkGlitterChains(preset.name, preset.recipe, glitter, context.window, dims, chains as never, alpha);
  // Supplied import chains are the baked chains byte for byte (normals as their RGBA import rows).
  const decoded: Record<string, readonly Uint8Array[]> = {};
  for (const channel of wanted)
    decoded[channel] = suppliedAndDecoded(build, preset, channel, textureDims(preset, channel as "diffuse"),
      channel === "normal" ? normalInputOf(chains.normal) : chains[channel], "baked glitter", context.exported);

  // Decoded against supplied, every level.
  const levels: GlitterDecodedReport["levels"] = [];
  const meanOf = (a: Uint8Array, b: Uint8Array, stride: number, pick: (k: number) => boolean) => {
    let sum = 0, n = 0;
    for (let i = 0; i < a.length; i++) if (pick(i % stride)) { sum += Math.abs(a[i] - b[i]); n++; }
    return n ? sum / n / 255 : 0;
  };
  chains.diffuse.forEach((_, L) => {
    const row = { level: L, diffuse: meanOf(decoded.diffuse[L], chains.diffuse[L], 4, k => k < 3), alpha: meanOf(decoded.diffuse[L], chains.diffuse[L], 4, k => k === 3),
      roughness: meanOf(decoded.roughness[L], chains.roughness[L], 1, () => true), metalness: meanOf(decoded.metalness[L], chains.metalness[L], 1, () => true),
      flakes: meanOf(decoded.flakes[L], chains.flakes[L], 1, () => true), normal: meanOf(decoded.normal[L], chains.normal[L], 2, () => true) };
    if (L <= 5) ensure(Object.entries(row).every(([key, value]) => key === "level" || value < .02),
      `Decoded glitter level ${L} of ${name} differs from its supplied chain: ${JSON.stringify(row)}`);
    levels.push(row);
  });
  // BC5 on flakes: the angle between supplied and decoded normals on level-0 flake texels.
  const angles: number[] = [], edges: number[] = [];
  const toVector = (x: number, y: number) => { const a = x / 255 * 2 - 1, b = y / 255 * 2 - 1; return [a, b, Math.sqrt(Math.max(0, 1 - a * a - b * b))]; };
  for (let t = 0; t < width * height; t++) {
    const m = chains.flakes[0][t];
    if (m > 0 && m < 255) edges.push(Math.abs(decoded.flakes[0][t] - m) / 255);
    if (m < 128) continue;
    const p = toVector(chains.normal[0][2 * t], chains.normal[0][2 * t + 1]), q = toVector(decoded.normal[0][2 * t], decoded.normal[0][2 * t + 1]);
    const dot = (p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / (Math.hypot(...p) * Math.hypot(...q));
    angles.push(Math.acos(Math.min(1, dot)) * 180 / Math.PI);
  }
  const flakeNormalDegrees = errorStats(Float64Array.from(angles)), flakeEdgeError = errorStats(Float64Array.from(edges));
  ensure(flakeNormalDegrees.mean < 3 && flakeNormalDegrees.p95 < 8, `Decoded flake normals of ${name} lose their tilt: ${JSON.stringify(flakeNormalDegrees)}`);
  // WolvenKit kept the supplied nested levels rather than regenerating them: decoded flakes sit closer to the supplied level than to a BOX chain.
  const keptChain: GlitterDecodedReport["keptChain"] = [];
  let box = Float64Array.from(chains.flakes[0], b => b / 255), bw = width, bh = height;
  for (let L = 1; L <= 3; L++) {
    const w = bw / 2, h = bh / 2, next = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = 2 * y * bw + 2 * x; next[y * w + x] = (((box[a] + box[a + 1]) + box[a + bw]) + box[a + bw + 1]) / 4; }
    box = next; bw = w; bh = h;
    let toSupplied = 0, toBox = 0, n = 0;
    for (let t = 0; t < w * h; t++) {
      const s = chains.flakes[L][t] / 255, b = box[t], d = decoded.flakes[L][t] / 255;
      if (!s && !b) continue;
      toSupplied += Math.abs(d - s); toBox += Math.abs(d - b); n++;
    }
    const row = { level: L, toSupplied: n ? toSupplied / n : 0, toBox: n ? toBox / n : 0 };
    ensure(row.toSupplied < row.toBox, `Decoded flake level ${L} of ${name} looks regenerated rather than the supplied nested chain: ${JSON.stringify(row)}`);
    keptChain.push(row);
  }
  let accent: (AccentReport & { decodedError: ErrorStats }) | undefined;
  if (glitter.accent) {
    const side = textureDims(preset, "accent").width;
    const accentReport = checkAccentChain(preset.name, preset.recipe, glitter, context.window, chains.accent, side, chains.flakes[0], dims);
    const decodedError = errorStats(byteErrors(decoded.accent[0], chains.accent[0], 1, Uint8Array.from(chains.accent[0], v => (v ? 1 : 0))));
    ensure(decodedError.mean < .03, `Decoded accent mask of ${name} differs from its supplied chain: ${JSON.stringify(decodedError)}`);
    accent = { ...accentReport, decodedError };
  }
  // Placement: the stored rows and the window mapping, as for every window preset.
  const coverage = Float64Array.from({ length: width * height }, (_, t) => (decoded.diffuse[0][4 * t + 3] / 255) ** 2);
  const space = checkSpace(build, record, preset, "roughness", decoded.roughness[0], coverage, context);
  const active = Uint8Array.from({ length: width * height }, (_, t) => (chains.diffuse[0][4 * t + 3] ? 1 : 0)), covered = active.reduce((n, v) => n + v, 0);
  ensure(covered > 0, `Preset ${preset.name} has no makeup in its glitter texture`);
  const coverageError = errorStats(Float64Array.from({ length: width * height }, (_, t) => t).filter(t => active[t])
    .map(t => Math.abs((decoded.diffuse[0][4 * t + 3] / 255) ** 2 - (chains.diffuse[0][4 * t + 3] / 255) ** 2)));
  ensure(coverageError.p95 < .05, `Decoded glitter coverage of ${name} differs from its supplied map: ${JSON.stringify(coverageError)}`);
  return { pixel: { preset: preset.name, route: "glitter" as const, ...space, coveredTexels: covered, coverageError,
    decoded: { levels, flakeNormalDegrees, flakeEdgeError, keptChain }, chains: report, ...(accent ? { accent } : {}) },
    mips: { preset: preset.name, levels: levels.map(row => ({ level: row.level, width: Math.max(1, width >> row.level), height: Math.max(1, height >> row.level), partialTexels: 0 })) } };
}

function checkTextures(build: string, record: Node, preset: VerifierPlan["presets"][number], context: TextureContext) {
  const route = routeOf(preset);
  ensure(record.route === route, `Compiled record for ${preset.appearance} is ${record.route ?? "missing its route"}, but its recipe needs the ${route} route`);
  if (route === "fresnel") return checkFresnelTextures(build, record, preset, context);
  if (route === "glitter") return checkGlitterTextures(build, record, preset, context);
  const exported = context.exported, dims = textureDims(preset, "diffuse"), { width, height } = dims;
  const name = preset.appearance, raw = readBaked(build, record);
  ensure(raw.diffuse && raw.roughness && raw.metalness, `Build record for ${name} lacks a base map`);
  ensure(raw.roughness.length === width * height, `Baked maps for ${name} are not ${width}x${height}`);
  const faceted = route === "faceted";
  if (faceted) ensure(raw.normal, `Build record for ${name} lacks a normal map`);
  const { chain, ideal: idealChain } = expectedChain(raw.diffuse, raw.roughness, raw.metalness, width, height);
  const facets = faceted ? facetedReference(raw.diffuse, raw.roughness, raw.metalness, raw.normal, width, height) : undefined;
  const expected: Record<string, readonly Uint8Array[]> = { ...chain, ...(facets ? { roughness: facets.roughness } : {}) };
  const decoded: Record<string, readonly Uint8Array[]> = {};
  for (const channel of ["diffuse", "roughness", "metalness"] as const)
    decoded[channel] = suppliedAndDecoded(build, preset, channel, dims, expected[channel],
      facets && channel === "roughness" ? "variance-widened" : "coverage-space", exported);

  // Base level: decoded XBM against the compiler's exact base pixels.
  const source = idealChain[0], actual = contributionsOf(decoded.diffuse[0], decoded.roughness[0], decoded.metalness[0], width, height);
  const texels = width * height, active = new Uint8Array(texels);
  let covered = 0;
  for (let t = 0; t < texels; t++) if (source.planes[5][t] > 1e-5) { active[t] = 1; covered++; }
  // Check omits presets that do not reach the plate; one that still arrives empty is refused plainly (PIPE-33).
  ensure(covered > 0, `Preset ${preset.name} has no makeup in its ${width}x${height} texture, so nothing of it would show on the eye plate`);
  const colourPlanes = (level: ContributionPlanes) => level.planes.slice(0, 3);
  const colour = errorStats(absoluteErrors(colourPlanes(source), colourPlanes(actual), active, covered));
  const alpha = errorStats(absoluteErrors([source.planes[5]], [actual.planes[5]], active, covered));
  ensure(colour.mean < .015 && colour.p95 < .05 && alpha.p95 < .05,
    `Decoded base colour/coverage error too large for ${name}: ${JSON.stringify({ colour, alpha })}`);
  // Coverage joins the colour planes: an all-black preset has zero premultiplied colour everywhere,
  // so colour alone cannot tell the rows from their mirror.
  const oriented = (level: ContributionPlanes) => [...level.planes.slice(0, 3), level.planes[5]];
  const flipped = oriented(actual).map(plane => {
    const out = new Float64Array(texels);
    for (let row = 0; row < height; row++) out.set(plane.subarray((height - 1 - row) * width, (height - row) * width), row * width);
    return out;
  });
  ensure(mean(absoluteErrors(oriented(source), oriented(actual), null, texels)) <
    mean(absoluteErrors(oriented(source), flipped, null, texels)), `Unexpected texture row orientation for ${name}`);
  const scalar = {} as { roughness: ErrorStats; metalness: ErrorStats };
  for (const [channel, plane] of [["roughness", 3], ["metalness", 4]] as const) {
    const error = errorStats(absoluteErrors([source.planes[plane]], [actual.planes[plane]], active, covered));
    ensure(error.p95 < .05, `Decoded ${channel} error too large for ${name}: ${JSON.stringify(error)}`);
    scalar[channel] = error;
  }
  let normalError: ErrorStats | undefined;
  if (facets) {
    const normal = suppliedAndDecoded(build, preset, "normal", dims, facets.normalInput, "facet normal", exported);
    normalError = errorStats(byteErrors(normal[0], raw.normal, 2, active, 127.5));
    ensure(normalError.mean < .03 && normalError.p95 < .1, `Decoded normal error too large for ${name}: ${JSON.stringify(normalError)}`);
  }
  const space = checkSpace(build, record, preset, "roughness", decoded.roughness[0], actual.planes[5], context);
  const pixel = { preset: preset.name, ...space, coveredTexels: covered, coverageError: alpha, premultipliedEncodedColourError: colour,
    premultipliedSurfaceError: scalar, ...(facets ? { route: "faceted" as const, normalError } : {}) };

  // Full decoded chain against coverage-space reductions of the original base pixels. Faceted
  // roughness is widened by design, so it is compared with its own reference chain instead.
  const surfacePlanes = facets ? [0, 1, 2, 4] : [0, 1, 2, 3, 4];
  const levels: MipRow[] = [];
  let ideal = source;
  for (let mip = 0; mip < decoded.diffuse.length; mip++) {
    if (mip) ideal = halve(ideal);
    const { width: w, height: h } = ideal, level = contributionsOf(decoded.diffuse[mip], decoded.roughness[mip], decoded.metalness[mip], w, h);
    const edge = new Uint8Array(w * h);
    let partial = 0;
    for (let t = 0; t < edge.length; t++) if (ideal.planes[5][t] > .002 && ideal.planes[5][t] < .998) { edge[t] = 1; partial++; }
    if (!partial) { levels.push({ level: mip, width: w, height: h, partialTexels: 0 }); continue; }
    const row: MipRow = { level: mip, width: w, height: h, partialTexels: partial,
      coverage: errorStats(absoluteErrors([level.planes[5]], [ideal.planes[5]], edge, partial)),
      premultipliedDestination: errorStats(absoluteErrors(surfacePlanes.map(k => level.planes[k]), surfacePlanes.map(k => ideal.planes[k]), edge, partial)) };
    if (facets) row.widenedRoughness = errorStats(byteErrors(decoded.roughness[mip], facets.roughness[mip], 1, edge));
    if (mip >= 1 && mip <= 5)
      ensure(row.coverage!.mean < .05 && row.premultipliedDestination!.mean < .035 && (!row.widenedRoughness || row.widenedRoughness.mean < .035),
        `Decoded mip ${mip} error too large for ${name}: ${JSON.stringify(row)}`);
    levels.push(row);
  }
  return { pixel, mips: { preset: preset.name, levels } };
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
  const out = resolve(options.build), tools = options.tools;
  ensure(tools && typeof tools.unbundle === "function" && typeof tools.serialize === "function" && typeof tools.exportTextures === "function",
    "The verifier needs its WolvenKit tools");
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
  // Routes before any conversion: the recipe decides, and the plan and compiled record must agree.
  if (options.packagedCollection !== undefined) {
    const source = options.packagedCollection as Node;
    ensure(Array.isArray(source?.presets) && source.presets.length === plan.presets.length,
      "Build record does not list the presets of the packaged collection");
    plan.presets.forEach((preset, i) => ensure(source.presets[i]?.id === preset.id && sameJson(source.presets[i].recipe, preset.recipe),
      `Build record's recipe for preset ${preset.name} differs from the packaged collection`));
  }
  // Diagnostic knobs (a prepared test candidate) must be exactly the packaged collection's, preset by preset.
  if (options.packagedCollection !== undefined) {
    const diagnostics = (options.packagedCollection as Node)?.diagnostics;
    plan.presets.forEach(preset => ensure(sameJson(preset.diagnostics, diagnostics?.presets?.[preset.id]),
      `Build record's diagnostics for preset ${preset.name} differ from the packaged collection`));
    ensure(diagnostics === undefined || Object.keys(diagnostics.presets ?? {}).every(id => plan.presets.some(p => p.id === id)),
      "Packaged collection diagnostics name a preset the build does not contain");
  }
  const liftsMm = expectedPlateLifts(plan, VERIFIER_PLATE_LIFT_MM);
  const presetRoutes = plan.presets.map((preset, i) => {
    const route = routeOf(preset);
    ensure(records[i].route === route, `Compiled record for ${preset.appearance} is ${records[i].route ?? "missing its route"}, but its recipe needs the ${route} route`);
    return { id: preset.id, route };
  });

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
  const textureDirs = [...new Set(plan.presets.flatMap(p => Object.values(p.textures) as string[]).map(path => path.slice(0, path.lastIndexOf("/"))))];
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

  // The plate-local window, re-derived from the packaged plate's own UVs (the builder's record must agree).
  const samples = plateUvSamples(root(plan.mesh)), window = expectedWindow(samples.bounds), uv = expectedUvConstants(window);
  if (plan.presets.some(preset => uvSpaceOf(preset) === "plate-window"))
    ensure(sameWindow(build.plateUv?.window, window, 1e-12), "Build record's plate UV window differs from the one the packaged plate's UVs give");
  const members = new Set(files.map(f => f.path));
  const summary = checkResources(plan, {
    mesh: root(plan.mesh), morph: root(plan.morph), app: root(plan.app), customization: root(plan.customization),
    sourceMesh: converted(dirs["plate-json"], basename(plateCopy.mesh)).Data.RootChunk,
    sourceMorph: converted(dirs["plate-json"], basename(plateCopy.morph)).Data.RootChunk,
    texture: path => root(path),
    archiveHas: path => members.has(path),
  }, build.artifacts.map((a: Node) => a.path), uv, options.morphTargets ?? null);

  const plateGeometry = checkPlateGeometry(converted(dirs["plate-json"], basename(plateCopy.mesh)).Data.RootChunk,
    converted(dirs["plate-json"], basename(plateCopy.morph)).Data.RootChunk, root(plan.mesh), root(plan.morph), liftsMm);

  const pixelResults: VerificationReport["decodedPixelChecks"] = [], mipResults: VerificationReport["decodedMipChecks"] = [];
  const context: TextureContext = { exported, xbm: path => root(path), samples, window, uv };
  plan.presets.forEach((preset, i) => {
    const { pixel, mips } = checkTextures(out, records[i], preset, context);
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
    materialTemplates: summary.materialTemplates, textureCount: plan.presets.reduce((n, p) => n + Object.keys(p.textures).length, 0),
    archiveBytes: archiveData.length, archiveSha256, unpackedFilesVerified: files.length, preservedMorphs: summary.morphTargets,
    plateGeometry, plateUvWindow: { bounds: samples.bounds, window, constants: uv, samples: samples.uv.length / 2 },
    resolvedDynamicPaths: summary.resolved, decodedPixelChecks: pixelResults,
    decodedMipChecks: mipResults, presetRoutes, archiveXlSha256: sha256(xlBytes), plateInputs: { ...plate.start },
    installed: false, gameRenderingVerified: false, limits: [...VERIFICATION_LIMITS],
  };
}
