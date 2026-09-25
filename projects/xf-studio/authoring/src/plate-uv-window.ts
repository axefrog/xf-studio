// Plate-local UV window for exported decal textures. Pure: WolvenKit JSON in, numbers out; no IO.
//
// The eye plate keeps the head's UV0, so a head-UV texture spends about 94 % of its texels off the plate
// (the plate's UV rectangle is 0.453 × 0.145 of the atlas). `mesh_decal` transforms the UV of every
// texture it samples (decompiled pixel program 16098255505177109230, UVRotation 0):
//
//   t = UVScale · (uv − 0.5) + 0.5 + UVOffset, then sign(t)·frac(|t|) (TA_Wrap sampler)
//
// where `uv` is the vertex UV exactly as stored in the mesh (the vertex program passes TEXCOORD0
// through). So two constants per axis map just the plate's rectangle onto the whole texture.
//
// Conventions. The Studio authors in glTF UV0 (top-left, v down), which is 1 − the stored V
// (WolvenKit's glTF export flips V). The compiler writes image rows top to bottom in that authored v.
// WolvenKit's XBM import stores the rows bottom to top (and its export flips them back), so stored
// texture coordinate t_v = 1 − row/height. Both flips together make a head-UV texture sample
// authored v = 1 − V at stored V, which is why head-UV exports already land in place. For the window
// the same two facts give, in stored V, the window [1 − v1, 1 − v0] → t_v ∈ [0, 1] with image rows
// in natural (unmirrored) authored order. Probe evidence: experiments/019-uv-window/README.md.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A rectangle of authored (glTF, top-left) UV that one texture covers: texel (x, y) of a W×H map
 * samples u = u0 + (x + ½)/W · (u1 − u0), v = v0 + (y + ½)/H · (v1 − v0). */
export interface UvWindow { readonly u0: number; readonly u1: number; readonly v0: number; readonly v1: number }
/** The whole head atlas: head-UV textures are the identity window. */
export const HEAD_UV_WINDOW: UvWindow = Object.freeze({ u0: 0, u1: 1, v0: 0, v1: 1 });

/** Stored-convention UV0 bounds of a mesh (V as stored in the vertex buffer, not flipped). */
export interface StoredUvBounds { readonly uMin: number; readonly uMax: number; readonly vMin: number; readonly vMax: number }

/**
 * Share of the window's span added outside the plate's bounds on each side (so each axis keeps
 * 1 − 2/64 of its texels on the plate). At 2048 × 512 this is 32 texels across U and 8 down V, so
 * bilinear, trilinear and anisotropic taps of the finer levels never wrap onto the opposite edge.
 */
export const PLATE_UV_MARGIN = 1 / 64;

const ELEMENT_BYTES: Readonly<Record<string, number>> = {
  PT_Short4N: 8, PT_UByte4: 4, PT_UByte4N: 4, PT_Float16_4: 8, PT_Float16_2: 4, PT_Dec4: 4, PT_Color: 4,
  PT_Float1: 4, PT_Float2: 8, PT_Float3: 12, PT_Float4: 16, PT_UInt4: 16,
};

/** IEEE half to number. */
export function halfToNumber(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1, exponent = (bits >>> 10) & 0x1f, fraction = bits & 0x3ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

/** UV0 bounds over every render chunk of a mesh's render blob (WolvenKit JSON RootChunk). */
export function plateUvBounds(meshRoot: Json): StoredUvBounds {
  const blob = meshRoot?.renderResourceBlob?.Data, chunks = blob?.header?.renderChunkInfos;
  if (!Array.isArray(chunks) || !chunks.length) throw Error("The plate mesh has no render chunks.");
  const raw = Buffer.from(String(blob.renderBuffer?.Bytes ?? ""), "base64");
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const chunk of chunks) {
    const layout = chunk.chunkVertices.vertexLayout, cursor = new Map<number, number>();
    let found: { stream: number; offset: number } | undefined;
    for (const e of layout.elements.Elements) {
      if (e.streamType !== "ST_PerVertex") continue;
      const size = ELEMENT_BYTES[e.type];
      if (!size) throw Error(`Unsupported vertex element type ${e.type}.`);
      const offset = cursor.get(e.streamIndex) ?? 0;
      if (e.usage === "PS_TexCoord" && e.usageIndex === 0) {
        if (e.type !== "PT_Float16_2") throw Error(`The plate's UV0 is ${e.type}, not PT_Float16_2.`);
        found = { stream: e.streamIndex, offset };
      }
      cursor.set(e.streamIndex, offset + size);
    }
    if (!found) throw Error("The plate mesh has no UV0.");
    const stride: number = layout.slotStrides.Elements[found.stream], base: number = chunk.chunkVertices.byteOffsets.Elements[found.stream];
    for (let v = 0; v < chunk.numVertices; v++) {
      const at = base + v * stride + found.offset, u = halfToNumber(raw.readUInt16LE(at)), w = halfToNumber(raw.readUInt16LE(at + 2));
      if (!Number.isFinite(u) || !Number.isFinite(w)) throw Error("The plate mesh has a non-finite UV.");
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); vMin = Math.min(vMin, w); vMax = Math.max(vMax, w);
    }
  }
  if (!(uMax > uMin && vMax > vMin)) throw Error("The plate's UVs span no area.");
  return { uMin, uMax, vMin, vMax };
}

/** The export window for plate UV bounds: each axis widened by PLATE_UV_MARGIN of its window span per side and
 * clamped to the atlas, returned in the authored convention (v = 1 − stored V). */
export function plateUvWindow(bounds: StoredUvBounds): UvWindow {
  const widen = (lo: number, hi: number) => {
    const pad = (hi - lo) / (1 - 2 * PLATE_UV_MARGIN) * PLATE_UV_MARGIN;
    return [Math.max(0, lo - pad), Math.min(1, hi + pad)];
  };
  const [u0, u1] = widen(bounds.uMin, bounds.uMax), [v0, v1] = widen(1 - bounds.vMax, 1 - bounds.vMin);
  if (!(u1 > u0 && v1 > v0)) throw Error("The plate's UVs span no area inside the atlas.");
  return { u0, u1, v0, v1 };
}

/** `mesh_decal` UV constants that make the stored UVs of `window` sample the whole texture (see header). */
export function uvTransformConstants(window: UvWindow) {
  const scaleX = 1 / (window.u1 - window.u0), scaleY = 1 / (window.v1 - window.v0);
  return {
    UVScaleX: scaleX, UVOffsetX: -scaleX * ((window.u0 + window.u1) / 2 - 0.5),
    // Stored V = 1 − v, and the import flip reverses rows: the window's stored V centre goes to 0.5.
    UVScaleY: scaleY, UVOffsetY: scaleY * ((window.v0 + window.v1) / 2 - 0.5),
  };
}
export type UvTransformConstants = ReturnType<typeof uvTransformConstants>;

/** Authored UV units per texel of a width × height map over `window` (smaller is denser). */
export const texelSpan = (window: UvWindow, width: number, height: number) =>
  ({ u: (window.u1 - window.u0) / width, v: (window.v1 - window.v0) / height });
