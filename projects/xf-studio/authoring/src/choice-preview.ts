/**
 * Choice previews (research/character-customization/choice-previews-design.md): the pure rules every side shares. DOM-free and file-free,
 * so the host, the page, the preview worker and the tests read the same definitions.
 *
 * - **Kinds** are chosen from data: the preview detail an option draws (cc-render-coverage.ts `detail`). Phase 1 builds `hair`.
 * - **A source** is what a preview is drawn from: the resolved winner's parts for that detail slot, as a prepared record lists them (their
 *   served geometry, visible chunks and, per chunk, where its coverage lives: render-templates.ts `coverage`). Nothing names a mod, an
 *   option or a resource.
 * - **The key** is the SHA-256 of the canonical source identity, the producer's style and the subject head: colour is not in it, so every
 *   colour of a hairstyle shares one preview, and another winning archive or reader gives another key.
 * - **Channel images** are theme-free: R = feature fraction × light, G = subject fraction × light, B = feature fraction, A = coverage
 *   (unpremultiplied). The page colours them with one SVG colour matrix per theme (`previewColourMatrix`), equal to the script composite
 *   (`compositeChannels`).
 * - **The camera** is one per row, from the subject head's bounds: the same frame for every choice, so length and volume compare.
 * - **The turntable** (design §7.1, phase 2) is the same picture at `TURNTABLE.frames` yaws, one full turn, drawn on request for the choice
 *   under the pointer or shown large and stored as one strip (frames side by side, frame 0 = the still). Its key is the still's key input
 *   plus the turntable's own style, so the still's key is unchanged.
 */
import { type RenderComponent } from "./render-detail";
import { renderTemplate } from "./render-templates";

export const CHOICE_PREVIEW_SCHEMA = "xfs/choice-preview-1" as const;
export type PreviewKind = "hair";
/** One producer's look. Every field is part of the key: changing one re-renders in the background. */
export type PreviewStyle = {
  readonly producer: "flat-render";
  readonly version: number;
  /** Output side in pixels, the supersampling factor over it and the MSAA samples of the supersampled target. */
  readonly size: number; readonly supersample: number; readonly msaa: number;
  /** Camera: yaw from the subject's front (degrees, negative turns to the subject's right), elevation, vertical field of view. */
  readonly yaw: number; readonly elevation: number; readonly fov: number;
  /** Target below the head's centre and vertical extent framed, in head heights. */
  readonly drop: number; readonly extent: number;
  /** The key light's direction in view space (towards the light), and the light range [shadow, lit]. */
  readonly light: readonly [number, number, number]; readonly range: readonly [number, number];
};
export const PREVIEW_STYLES: Readonly<Record<PreviewKind, PreviewStyle>> = Object.freeze({
  hair: Object.freeze({ producer: "flat-render", version: 4, size: 256, supersample: 2, msaa: 4, yaw: -28, elevation: 8, fov: 18, drop: 0.04, extent: 1.78,
    light: Object.freeze([-0.45, 0.6, 0.66]) as readonly [number, number, number], range: Object.freeze([0.18, 1]) as readonly [number, number] }),
});
/**
 * The turntable strip: `frames` pictures one full turn apart (frame k at the style's yaw + k × 360° / frames, so frame 0 is the still),
 * side by side in one WebP (frames × size wide). 24 frames is 15° a step, smooth enough to blend between at a slow spin; the strip
 * stays within WebP's 16383-pixel side at the 256 px size.
 */
export const TURNTABLE = Object.freeze({ version: 1, frames: 24, quality: 0.9 });
/** The yaw offset (degrees) of turntable frame `k`. */
export const turntableYaw = (k: number, frames: number = TURNTABLE.frames) => (k * 360) / frames;
/** The preview kind of an option, from the preview detail it draws (null: no preview yet; phase 1 draws the hair). */
export function previewKindOf(detail: string | null | undefined): PreviewKind | null {
  return detail === "hair" ? "hair" : null;
}

export type PreviewCoverage = { file: string; sha256: string; depotPath: string; channel: 0 | 1 | 2 | 3; cutoff: number | null; dither: boolean };
export type PreviewChunk = { chunk: number; coverage: PreviewCoverage | null };
export type PreviewPart = { file: string; sha256: string; depotPath: string; depotHash: string; archive: string | null; chunks: PreviewChunk[] };
export type ChoicePreviewSource = { schema: typeof CHOICE_PREVIEW_SCHEMA; kind: PreviewKind; parts: PreviewPart[] };
/** At most this many parts and chunks per source (a multi-part hairstyle has a handful). */
export const PREVIEW_SOURCE_LIMITS = Object.freeze({ parts: 16, chunks: 64 });

/**
 * A preview source from a prepared record's components: every component of the kind's detail slot, every chunk it draws, each chunk's
 * coverage where its template keeps one (else solid). Null when the slot draws nothing (the choice is "no preview").
 */
export function previewSourceOf(components: readonly RenderComponent[], kind: PreviewKind): ChoicePreviewSource | null {
  const parts: PreviewPart[] = [];
  for (const component of components) {
    if (component.slot !== kind || parts.length >= PREVIEW_SOURCE_LIMITS.parts) continue;
    const chunks: PreviewChunk[] = component.materials.slice(0, PREVIEW_SOURCE_LIMITS.chunks).map(material => {
      const spec = renderTemplate(material.template, material.templateName)?.coverage;
      const texture = spec ? material.textures[spec.texture] : undefined;
      if (!spec || !texture) return { chunk: material.chunk, coverage: null };
      const cutoff = spec.cutoff !== undefined ? material.scalars[spec.cutoff] ?? 0 : null;
      return { chunk: material.chunk, coverage: { file: texture.file, sha256: texture.sha256, depotPath: texture.depotPath, channel: spec.channel,
        cutoff, dither: !!spec.dither } };
    });
    if (!chunks.length) continue;
    const source = component.geometry.sources[0];
    parts.push({ file: component.geometry.file, sha256: component.geometry.sha256, depotPath: component.geometry.depotPath,
      depotHash: component.geometry.depotHash, archive: source?.archive ?? null, chunks });
  }
  return parts.length ? { schema: CHOICE_PREVIEW_SCHEMA, kind, parts } : null;
}

const FILE = /^[a-f0-9]{64}\.(glb|png)$/, SHA = /^[a-f0-9]{64}$/;
const shortText = (value: unknown) => typeof value === "string" && value.length > 0 && value.length < 1024;
/** Strict parse of a source from the host (the page and the worker read nothing else). */
export function parsePreviewSource(value: unknown): ChoicePreviewSource {
  const fail = (what: string): never => { throw Error(`Choice preview source: ${what} is invalid.`); };
  const doc = value as ChoicePreviewSource;
  if (!doc || doc.schema !== CHOICE_PREVIEW_SCHEMA || !(doc.kind in PREVIEW_STYLES) || !Array.isArray(doc.parts) || !doc.parts.length
    || doc.parts.length > PREVIEW_SOURCE_LIMITS.parts) fail("source");
  return { schema: CHOICE_PREVIEW_SCHEMA, kind: doc.kind, parts: doc.parts.map(part => {
    if (!FILE.test(String(part?.file)) || !SHA.test(String(part.sha256)) || !shortText(part.depotPath) || !/^\d{1,20}$/.test(String(part.depotHash))
      || (part.archive !== null && !shortText(part.archive)) || !Array.isArray(part.chunks) || !part.chunks.length || part.chunks.length > PREVIEW_SOURCE_LIMITS.chunks) fail("part");
    return { file: part.file, sha256: part.sha256, depotPath: part.depotPath, depotHash: part.depotHash, archive: part.archive, chunks: part.chunks.map(chunk => {
      if (!Number.isInteger(chunk?.chunk) || chunk.chunk < 0 || chunk.chunk > 4096) fail("chunk");
      const c = chunk.coverage;
      if (c === null) return { chunk: chunk.chunk, coverage: null };
      if (!c || !FILE.test(String(c.file)) || !SHA.test(String(c.sha256)) || !shortText(c.depotPath) || ![0, 1, 2, 3].includes(c.channel)
        || (c.cutoff !== null && !Number.isFinite(c.cutoff)) || typeof c.dither !== "boolean") fail("coverage");
      return { chunk: chunk.chunk, coverage: { file: c.file, sha256: c.sha256, depotPath: c.depotPath, channel: c.channel, cutoff: c.cutoff, dither: c.dither } };
    }) };
  }) };
}

/** A still (one picture) or the turntable strip of the same source. */
export type PreviewVariant = "still" | "turntable";
/** What a key covers: the schema, the producer and its style, the subject head's identity and each part's resolved identity. */
export function previewKeyInput(source: ChoicePreviewSource, subject: string, variant: PreviewVariant = "still") {
  return { schema: CHOICE_PREVIEW_SCHEMA, kind: source.kind, style: PREVIEW_STYLES[source.kind], subject, ...(variant === "turntable" ? { turntable: TURNTABLE } : {}),
    parts: source.parts.map(part => ({ geometry: [part.depotHash, part.archive, part.sha256], chunks: part.chunks.map(chunk => [chunk.chunk,
      chunk.coverage ? [chunk.coverage.depotPath.toLowerCase(), chunk.coverage.sha256, chunk.coverage.channel, chunk.coverage.cutoff, chunk.coverage.dither] : null]) })) };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
/** The preview key (lowercase hex SHA-256), with the platform's digest (browser, worker and Bun alike). */
export async function previewKey(source: ChoicePreviewSource, subject: string, variant: PreviewVariant = "still"): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(previewKeyInput(source, subject, variant))));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export const isPreviewKey = (value: unknown): value is string => typeof value === "string" && SHA.test(value);

// ---- Theming: the colour matrix and the script composite it equals ----

/** sRGB colours in 0–1 and the shade factor (`--pv-subject`, `--pv-ink`, `--pv-shade`). */
export type PreviewTokens = { subject: readonly [number, number, number]; ink: readonly [number, number, number]; shade: number };
/**
 * The `feColorMatrix` values (20, row-major) that colour a channel image: with f = B, the subject fraction s = 1 − f and light l,
 * colour = ink_dark·f + (ink_lit − ink_dark)·f·l + subject_dark·s + (subject_lit − subject_dark)·s·l, where dark = lit × shade. Since
 * R = f·l and G = s·l, that is subject_dark + (ink_dark − subject_dark)·B + (ink_lit − ink_dark)·R + (subject_lit − subject_dark)·G.
 */
export function previewColourMatrix(tokens: PreviewTokens): number[] {
  const rows: number[] = [];
  for (let c = 0; c < 3; c++) {
    const inkLit = tokens.ink[c]!, inkDark = inkLit * tokens.shade, subjectLit = tokens.subject[c]!, subjectDark = subjectLit * tokens.shade;
    rows.push(inkLit - inkDark, subjectLit - subjectDark, inkDark - subjectDark, 0, subjectDark);
  }
  rows.push(0, 0, 0, 1, 0);
  return rows;
}
/** The same colour computed directly per pixel (the fallback where SVG filters on images are missing), from unpremultiplied bytes. */
export function compositeChannels(rgba: readonly number[], tokens: PreviewTokens): [number, number, number] {
  const f = rgba[2]! / 255, s = 1 - f, l = f > 0 ? Math.min(1, rgba[0]! / 255 / f) : s > 0 ? Math.min(1, rgba[1]! / 255 / s) : 0;
  const out = [0, 0, 0] as [number, number, number];
  for (let c = 0; c < 3; c++) {
    const inkLit = tokens.ink[c]!, inkDark = inkLit * tokens.shade, subjectLit = tokens.subject[c]!, subjectDark = subjectLit * tokens.shade;
    const value = inkDark * f + (inkLit - inkDark) * f * l + subjectDark * s + (subjectLit - subjectDark) * s * l;
    out[c] = Math.round(255 * Math.max(0, Math.min(1, value)));
  }
  return out;
}
/** Apply a colour matrix to unpremultiplied bytes, as `feColorMatrix` does (sRGB interpolation, clamped). */
export function applyColourMatrix(matrix: readonly number[], rgba: readonly number[]): [number, number, number] {
  const v = rgba.map(value => value / 255);
  return [0, 1, 2].map(row => Math.round(255 * Math.max(0, Math.min(1,
    matrix[row * 5]! * v[0]! + matrix[row * 5 + 1]! * v[1]! + matrix[row * 5 + 2]! * v[2]! + matrix[row * 5 + 3]! * v[3]! + matrix[row * 5 + 4]!)))) as [number, number, number];
}

// ---- The camera: one frame per row, from the subject's bounds ----

export type Bounds = { min: [number, number, number]; max: [number, number, number] };
type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => { const length = Math.hypot(...a) || 1; return [a[0] / length, a[1] / length, a[2] / length]; };
const centre = (bounds: Bounds): Vec3 => [0, 1, 2].map(k => (bounds.min[k]! + bounds.max[k]!) / 2) as Vec3;
/** Column-major look-at view matrix. */
export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Float32Array {
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
/** Column-major perspective projection (vertical field of view in degrees, square aspect). */
export function perspective(fov: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fov * Math.PI) / 360);
  return new Float32Array([f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}
/**
 * The row's camera from the subject head's bounds and its eyes' bounds (which way the face looks, from the data: the eyes sit in front of
 * the head's centre). Y is up, as the exported geometry is. `turn` adds degrees of yaw about the head's vertical axis (a turntable frame).
 */
export function previewCamera(head: Bounds, eyes: Bounds | null, style: PreviewStyle, turn = 0): { view: Float32Array; projection: Float32Array; eye: Vec3; target: Vec3 } {
  const c = centre(head), height = head.max[1] - head.min[1];
  const toEyes = eyes ? sub(centre(eyes), c) : [0, 0, 1] as Vec3;
  const front = norm([toEyes[0], 0, toEyes[2]].some(Boolean) ? [toEyes[0], 0, toEyes[2]] : [0, 0, 1]);
  const yaw = ((style.yaw + turn) * Math.PI) / 180, elevation = (style.elevation * Math.PI) / 180;
  const turned: Vec3 = [front[0] * Math.cos(yaw) + front[2] * Math.sin(yaw), 0, -front[0] * Math.sin(yaw) + front[2] * Math.cos(yaw)];
  const direction: Vec3 = [turned[0] * Math.cos(elevation), Math.sin(elevation), turned[2] * Math.cos(elevation)];
  const target: Vec3 = [c[0], c[1] - style.drop * height, c[2]];
  const distance = (style.extent * height) / 2 / Math.tan((style.fov * Math.PI) / 360);
  const eye: Vec3 = [target[0] + direction[0] * distance, target[1] + direction[1] * distance, target[2] + direction[2] * distance];
  return { view: lookAt(eye, target, [0, 1, 0]), projection: perspective(style.fov, Math.max(1e-3, distance - 3 * height), distance + 3 * height), eye, target };
}
