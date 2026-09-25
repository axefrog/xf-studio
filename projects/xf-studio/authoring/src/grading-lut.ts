/**
 * The game's SDR display transform for the creator preset, and which grading LUT it uses. Pure: no
 * Three.js, DOM, filesystem or process. Spec: knowledge/creator-lighting.md §5 and §7.
 *
 *   display = sRGB_encode(clamp(LUT(LogC3(k · x))))
 *
 * `m_LUTGenerateLinear` encodes scene-linear colour with ARRI LogC3 (EI 800) for `CMF_ArriLogC` LUTs, samples
 * the 3D texture with (R, G, B) → (u, v, w), and applies no output decode for `CMF_Linear` [source]. The
 * environment's SDR tone-mapping mode is linear, so the LUT carries the whole tone curve [resource].
 *
 * Which LUT: the environment names a depot path (`ldrLut.LUT`); the effective resource is whichever mounted
 * archive wins that path by the generic archive precedence (archive-precedence.ts). No mod is named here.
 */
import type { DepotLookup, MountGroup, MountedArchive } from "./archive-precedence";
import { asArray, isObject, type JsonObject } from "./red-json";

/** Host transport shared by both hosts and the browser device. */
export const GRADING_LUT_ENDPOINT = "/api/preview-grading-lut";
export const GRADING_LUT_ASSET_PREFIX = "/assets/grading-lut/";
export const GRADING_LUT_STATE_SCHEMA = "xfs/grading-lut-state-1" as const;
export const GRADING_LUT_FILE = /^[a-f0-9]{64}\.bin$/;

/** The pre-game menu world's environment (`04_main_menu.streamingworld`); the Night City one names the same LUTs [resource]. */
export const CREATOR_ENVIRONMENT = "base\\weather\\24h_basic\\cp2077_master_env_nge_v002.env";
/** The vanilla SDR grading LUT the master environments name [resource]; used when the environment cannot be read. */
export const VANILLA_SDR_LUT = "base\\weather\\24h_basic\\luts\\cp2077_gen_lut_nge_v017.xbm";

export type GradingLut = {
  /** Edge length N of the N³ cube. */
  readonly size: number;
  /** RGBA float32, R fastest then G then B (a `Data3DTexture` with x = R, y = G, z = B). */
  readonly data: Float32Array;
};

export type ColourMapping = "CMF_ArriLogC" | "CMF_Linear" | "CMF_sRGB" | string;
export type LutSlot = { readonly path: string | null; readonly inputMapping: ColourMapping; readonly outputMapping: ColourMapping };
export type EnvironmentGrading = { readonly ldr: LutSlot | null; readonly hdr: LutSlot | null; readonly forceHdrLut: boolean | null };

function findTyped(value: unknown, type: string, depth = 0): JsonObject | null {
  if (depth > 64) return null;
  if (Array.isArray(value)) { for (const item of value) { const hit = findTyped(item, type, depth + 1); if (hit) return hit; } return null; }
  if (!isObject(value)) return null;
  if (value.$type === type) return value;
  for (const item of Object.values(value)) { const hit = findTyped(item, type, depth + 1); if (hit) return hit; }
  return null;
}
function lutSlot(value: unknown): LutSlot | null {
  if (!isObject(value)) return null;
  const lut = isObject(value.LUT) ? value.LUT : null, depot = lut && isObject(lut.DepotPath) ? lut.DepotPath : null;
  const path = depot && typeof depot.$value === "string" && depot.$value && depot.$storage !== "uint64" ? depot.$value : null;
  return { path, inputMapping: typeof value.inputMapping === "string" ? value.inputMapping : "CMF_ArriLogC",
    outputMapping: typeof value.outputMapping === "string" ? value.outputMapping : "CMF_Linear" };
}

/** The colour-grading LUTs a serialized `.env` (WolvenKit JSON) names: its first `ColorGradingAreaSettings`. */
export function readEnvironmentGrading(document: unknown): EnvironmentGrading | null {
  const settings = findTyped(document, "ColorGradingAreaSettings");
  if (!settings) return null;
  return { ldr: lutSlot(settings.ldrLut), hdr: lutSlot(settings.hdrLut),
    forceHdrLut: typeof settings.forceHdrLut === "number" ? settings.forceHdrLut !== 0 : typeof settings.forceHdrLut === "boolean" ? settings.forceHdrLut : null };
}

/** Only the mapping the game's SDR path uses is implemented: LogC3 in, linear out. */
export const supportedMapping = (slot: LutSlot) => slot.inputMapping === "CMF_ArriLogC" && slot.outputMapping === "CMF_Linear";

function base64Bytes(text: string): Uint8Array {
  if (typeof Buffer !== "undefined") { const b = Buffer.from(text, "base64"); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
  const raw = atob(text), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export class GradingLutError extends Error {}

/**
 * Decode an untrimmed WolvenKit JSON of a `CBitmapTexture` grading LUT: `TEXTYPE_3D`, `TRF_HDRFloat`, no
 * compression, one mip, N³ RGBA float32 texels in the blob in [B][G][R] order (the order the bake program's
 * (u, v, w) sampling implies; research/character-customization/creator-lighting/lut_axis.py).
 */
export function decodeGradingLut(document: unknown): GradingLut {
  const root = isObject(document) && isObject(document.Data) && isObject(document.Data.RootChunk) ? document.Data.RootChunk : null;
  if (!root || root.$type !== "CBitmapTexture") throw new GradingLutError("Not a bitmap texture.");
  const setup = isObject(root.setup) ? root.setup : {};
  if (setup.rawFormat !== "TRF_HDRFloat") throw new GradingLutError(`Unsupported LUT format ${String(setup.rawFormat)}.`);
  if (setup.compression !== undefined && setup.compression !== "TCM_None") throw new GradingLutError("Compressed LUTs are not supported.");
  const size = Number(root.width);
  if (!Number.isInteger(size) || size < 2 || size > 256 || Number(root.height) !== size || Number(root.depth) !== size)
    throw new GradingLutError("The LUT is not a cube.");
  const resource = isObject(root.renderTextureResource) ? root.renderTextureResource : null;
  const blob = resource && isObject(resource.renderResourceBlobPC) && isObject(resource.renderResourceBlobPC.Data) ? resource.renderResourceBlobPC.Data : null;
  const info = blob && isObject(blob.header) && isObject(blob.header.textureInfo) ? blob.header.textureInfo : null;
  if (info && info.type !== "TEXTYPE_3D") throw new GradingLutError("The LUT is not a 3D texture.");
  const payload = blob && isObject(blob.textureData) ? blob.textureData.Bytes : null;
  if (typeof payload !== "string") throw new GradingLutError("The LUT's texel data is missing (trimmed or not serialized).");
  const bytes = base64Bytes(payload), expected = size ** 3 * 16;
  if (bytes.byteLength < expected) throw new GradingLutError("The LUT's texel data is shorter than its size.");
  const data = new Float32Array(size ** 3 * 4), view = new DataView(bytes.buffer, bytes.byteOffset, expected);
  for (let i = 0; i < data.length; i++) {
    const value = view.getFloat32(i * 4, true);
    if (!Number.isFinite(value)) throw new GradingLutError("The LUT holds a non-finite value.");
    data[i] = value;
  }
  return { size, data };
}

// ARRI LogC3, EI 800, exactly as compiled in m_LUTGenerateLinear [source].
const LOGC = { a: 5.555556, b: 0.052272, c: 0.24719, d: 0.385537, e: 5.367655, f: 0.092809, cut: 0.010591 };
export function logC3Encode(x: number): number {
  return x > LOGC.cut ? LOGC.c * Math.log10(LOGC.a * x + LOGC.b) + LOGC.d : LOGC.e * x + LOGC.f;
}
export function logC3Decode(t: number): number {
  return t > LOGC.e * LOGC.cut + LOGC.f ? (10 ** ((t - LOGC.d) / LOGC.c) - LOGC.b) / LOGC.a : (t - LOGC.f) / LOGC.e;
}
/** Texture coordinate of a LogC value on an N-texel axis (texel centres): t·(N−1)/N + 0.5/N. */
export const lutCoordinate = (t: number, size: number) => t * (size - 1) / size + 0.5 / size;

/** A LUT whose output is its scene-linear input, so the display transform reduces to clamp and sRGB encode. */
export function neutralGradingLut(size = 32): GradingLut {
  const data = new Float32Array(size ** 3 * 4);
  const axis = Array.from({ length: size }, (_, i) => logC3Decode(i / (size - 1)));
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const i = ((b * size + g) * size + r) * 4;
    data[i] = axis[r]!; data[i + 1] = axis[g]!; data[i + 2] = axis[b]!; data[i + 3] = 1;
  }
  return { size, data };
}

/** Trilinear sample at LogC coordinates in [0, 1] (clamped), as the GPU samples texel centres. */
export function sampleGradingLut(lut: GradingLut, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size, max = n - 1;
  const p = [r, g, b].map(v => Math.min(max, Math.max(0, v * max)));
  const i0 = p.map(v => Math.min(max - 1, Math.floor(v))), f = p.map((v, i) => v - i0[i]!);
  const out: [number, number, number] = [0, 0, 0];
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const w = (dx ? f[0]! : 1 - f[0]!) * (dy ? f[1]! : 1 - f[1]!) * (dz ? f[2]! : 1 - f[2]!);
    if (!w) continue;
    const i = (((i0[2]! + dz) * n + i0[1]! + dy) * n + i0[0]! + dx) * 4;
    out[0] += w * lut.data[i]!; out[1] += w * lut.data[i + 1]!; out[2] += w * lut.data[i + 2]!;
  }
  return out;
}

export const srgbEncode = (v: number) => { const x = Math.min(1, Math.max(0, v)); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; };
export const srgbDecode = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;

/** The creator preset's display transform for one scene-linear colour; returns display sRGB in [0, 1]. */
export function displayTransform(rgb: readonly number[], exposure: number, lut: GradingLut): [number, number, number] {
  const graded = sampleGradingLut(lut, logC3Encode(exposure * rgb[0]!), logC3Encode(exposure * rgb[1]!), logC3Encode(exposure * rgb[2]!));
  return [srgbEncode(graded[0]), srgbEncode(graded[1]), srgbEncode(graded[2])];
}

/**
 * Scene value on the neutral axis whose display luminance (display-linear, Rec. 709) equals `target`: the
 * inverse of the LUT's grey response, by bisection in LogC space (the response is monotonic for the LUTs
 * read so far). Used to fit the exposure scalar.
 */
export function invertNeutralAxis(lut: GradingLut, target: number): number {
  const lum = (t: number) => { const c = sampleGradingLut(lut, t, t, t).map(v => Math.min(1, Math.max(0, v))); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
  let low = 0, high = 1;
  if (target <= lum(low)) return logC3Decode(low);
  if (target >= lum(high)) return logC3Decode(high);
  for (let i = 0; i < 60; i++) { const mid = (low + high) / 2; if (lum(mid) < target) low = mid; else high = mid; }
  return logC3Decode((low + high) / 2);
}

// Binary transport between the host and the browser: "XLUT", version, size, then RGBA float32 little-endian.
const MAGIC = 0x54554c58;
export function encodeGradingLut(lut: GradingLut): Uint8Array {
  const out = new Uint8Array(16 + lut.data.byteLength), view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true); view.setUint32(4, 1, true); view.setUint32(8, lut.size, true); view.setUint32(12, 4, true);
  new Float32Array(out.buffer, 16).set(lut.data);
  return out;
}
export function decodeGradingLutBinary(bytes: Uint8Array): GradingLut {
  if (bytes.byteLength < 16) throw new GradingLutError("The LUT file is too short.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(8, true);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 1 || view.getUint32(12, true) !== 4 || size < 2 || size > 256 ||
    bytes.byteLength !== 16 + size ** 3 * 16) throw new GradingLutError("The LUT file is not in the expected format.");
  const data = new Float32Array(size ** 3 * 4);
  for (let i = 0; i < data.length; i++) data[i] = view.getFloat32(16 + i * 4, true);
  return { size, data };
}

/** Where the preset's LUT came from, in plain terms plus provenance. Contains no physical paths. */
export type GradingLutSource = {
  readonly kind: "installed" | "vanilla-fallback" | "neutral";
  readonly depotPath: string | null;
  readonly archive: string | null;
  readonly group: MountGroup | null;
  readonly provider: string | null;
  /** Mounted archives that also provide the path and lost, in lookup order. */
  readonly alternatives: readonly string[];
  readonly rule: string | null;
  readonly size: number | null;
  /** One plain line for the person using the app. */
  readonly note: string;
  /** Why earlier choices were skipped (for the log and evidence). */
  readonly skipped: readonly string[];
};

/** The mod manager's name for a mod archive when it has one, else the archive's file name. */
const modLabel = (archive: MountedArchive) => archive.provider === "mo2-mod" && archive.providerName ? archive.providerName : archive.name;
const BASE_GROUPS: readonly MountGroup[] = ["content", "ep1"];
const isBase = (archive: MountedArchive) => BASE_GROUPS.includes(archive.group);

export type LutCandidateReader = (archive: MountedArchive, depotPath: string) => Promise<GradingLut>;

/**
 * Choose the preset's LUT: the winner of the environment's LUT path by archive precedence; if it cannot be
 * read, the base game's copy of that path (then of the vanilla path); if none can be read, the neutral LUT.
 * `lookup` is the resolver's answer for a depot path (archive-precedence.ts `DepotIndex.lookup`).
 */
export async function selectGradingLut(options: {
  environmentPath: string | null;
  lookup: (depotPath: string) => DepotLookup;
  read: LutCandidateReader;
  environmentNote?: string;
}): Promise<{ lut: GradingLut | null; source: GradingLutSource }> {
  const skipped: string[] = options.environmentNote ? [options.environmentNote] : [];
  const primaryPath = options.environmentPath ?? VANILLA_SDR_LUT;
  const primary = options.lookup(primaryPath);
  const attempt = async (archive: MountedArchive, path: string) => {
    try { return await options.read(archive, path); }
    catch (error) { skipped.push(`${archive.name}: ${(error as Error).message}`); return null; }
  };
  if (primary.winner) {
    const lut = await attempt(primary.winner, primaryPath);
    if (lut) return { lut, source: { kind: "installed", depotPath: primaryPath, archive: primary.winner.name, group: primary.winner.group,
      provider: primary.winner.providerName, alternatives: primary.candidates.slice(1).map(c => c.name), rule: primary.rule.basis, size: lut.size,
      note: isBase(primary.winner) ? "Colour grading: the game's own LUT." : `Colour grading: the LUT your installed mods provide (${modLabel(primary.winner)}).`, skipped } };
  } else skipped.push(`${primaryPath}: no mounted archive provides it.`);
  const fallbacks: { archive: MountedArchive; path: string }[] = [];
  for (const path of primaryPath.toLowerCase() === VANILLA_SDR_LUT ? [primaryPath] : [primaryPath, VANILLA_SDR_LUT]) {
    const lookup = path === primaryPath ? primary : options.lookup(path);
    for (const archive of lookup.candidates) if (isBase(archive) && archive !== primary.winner) fallbacks.push({ archive, path });
  }
  for (const { archive, path } of fallbacks) {
    const lut = await attempt(archive, path);
    if (lut) return { lut, source: { kind: "vanilla-fallback", depotPath: path, archive: archive.name, group: archive.group, provider: archive.providerName,
      alternatives: [], rule: "Base-game copy used because the effective LUT could not be read.", size: lut.size,
      note: "Colour grading: your installed LUT couldn't be read, so the game's own LUT is used instead.", skipped } };
  }
  return { lut: null, source: { kind: "neutral", depotPath: null, archive: null, group: null, provider: null, alternatives: [], rule: null, size: null,
    note: "Colour grading: the game's LUT isn't available, so a neutral grade is shown. Colours will look less like the game.", skipped } };
}

/** Parse a host LUT source from JSON (for the browser); returns null when malformed. */
export function parseGradingLutSource(value: unknown): GradingLutSource | null {
  const v = value as GradingLutSource;
  if (!v || typeof v !== "object" || !["installed", "vanilla-fallback", "neutral"].includes(v.kind) || typeof v.note !== "string") return null;
  const text = (x: unknown) => typeof x === "string" ? x : null;
  return { kind: v.kind, depotPath: text(v.depotPath), archive: text(v.archive), group: text(v.group) as MountGroup | null, provider: text(v.provider),
    alternatives: asArray(v.alternatives).filter((x): x is string => typeof x === "string"), rule: text(v.rule),
    size: Number.isInteger(v.size) ? v.size : null, note: v.note, skipped: asArray(v.skipped).filter((x): x is string => typeof x === "string") };
}
