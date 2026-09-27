/**
 * The character creator's choice icons (research/character-customization/choice-icons-design.md): an `.inkatlas` read into its parts'
 * rectangles and texture, and the compact icon sheets the Character panel draws from. Pure; the host (cc-icon-host.ts) reads the atlas
 * and its texture through the resolver and the native texture reader.
 *
 * - **Atlas** (`inkTextureAtlas`) [source: RTTI; resource: the 2.31 creator atlas]: `parts` and `texture` at the top, and `slots`, one per
 *   texture resolution, each with its own `parts` and `texture`. Parts give `clippingRectInUVCoords` as fractions of the texture from the
 *   top-left corner. The texture used: slot 0's when it has one, else the top-level one, else the first slot's that has one
 *   [hypothesis: the game picks the slot by the player's texture-resolution setting; recorded per atlas]. The 2.31 creator atlas keeps
 *   every part in slot 0 and none at the top.
 * - **Sheet**: only the parts the catalogue uses, each scaled into a square cell (`ICON_CELL` pixels, twice the panel's largest swatch),
 *   packed row by row.
 */
import { refFromHash, type DepotRef } from "./depot-path";
import { asArray, cname, depotRef, isObject, type JsonObject } from "./red-json";

export const ICON_CELL = 64;
export const ICON_SHEET_COLUMNS = 32;
/** Version of the sheet rules; part of each sheet's key. */
export const ICON_SHEET_VERSION = 1;

export interface AtlasPart { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface ReadAtlas {
  readonly texture: DepotRef | null;
  /** Where the texture and parts came from. */
  readonly from: "slot0" | "top" | `slot${number}` | "none";
  readonly parts: ReadonlyMap<string, AtlasPart>;
}

const partsOf = (list: unknown): Map<string, AtlasPart> => {
  const parts = new Map<string, AtlasPart>();
  for (const entry of asArray(list)) {
    if (!isObject(entry)) continue;
    const name = cname(entry.partName);
    const rect = isObject(entry.clippingRectInUVCoords) ? entry.clippingRectInUVCoords : null;
    if (!name || !rect) continue;
    const n = (key: string) => { const value = Number(rect[key]); return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : NaN; };
    const part = { left: n("Left"), top: n("Top"), right: n("Right"), bottom: n("Bottom") };
    if (Object.values(part).some(Number.isNaN) || part.right <= part.left || part.bottom <= part.top) continue;
    if (!parts.has(name)) parts.set(name, part);
  }
  return parts;
};
const textureOf = (value: unknown): DepotRef | null => {
  const ref = isObject(value) ? depotRef(value) : null;
  return ref && ref.hash !== "0" ? ref : null;
};

/** An `inkTextureAtlas` document's parts and the texture they cut from (see the module note for the choice). */
export function readAtlas(root: JsonObject | null | undefined): ReadAtlas {
  if (!root || root.$type !== "inkTextureAtlas") return { texture: null, from: "none", parts: new Map() };
  const slots = asArray(isObject(root.slots) ? root.slots.Elements : root.slots).filter(isObject);
  const slot0 = slots[0], slot0Texture = slot0 ? textureOf(slot0.texture) : null;
  if (slot0 && slot0Texture) return { texture: slot0Texture, from: "slot0", parts: partsOf(slot0.parts) };
  const top = textureOf(root.texture);
  if (top) return { texture: top, from: "top", parts: partsOf(root.parts) };
  const at = slots.findIndex(slot => textureOf(slot.texture));
  if (at >= 0) return { texture: textureOf(slots[at]!.texture), from: `slot${at}`, parts: partsOf(slots[at]!.parts) };
  return { texture: null, from: "none", parts: new Map() };
}

/** The icon a choice names: its atlas (hash, and path when known) and part. */
export interface IconTarget { readonly atlas: DepotRef; readonly part: string }
export const iconTarget = (icon: { atlas: { hash: string; path: string | null } | null; part: string | null } | null | undefined): IconTarget | null =>
  icon?.atlas && icon.part ? { atlas: refFromHash(icon.atlas.hash, icon.atlas.path), part: icon.part } : null;

export interface RgbaImage { readonly width: number; readonly height: number; readonly data: Uint8Array }

/**
 * Cut `parts` (in order) out of an atlas texture into one sheet of square cells, each part scaled to fit its cell (box filter,
 * centred, transparent around). `flipped`: the texture's rows are stored bottom-up (the exporter's orientation), so a part's
 * top-left UV maps to the last rows.
 */
export function buildSheet(texture: RgbaImage, parts: readonly AtlasPart[], options: { cell?: number; columns?: number; flipped?: boolean } = {}): RgbaImage {
  const cell = options.cell ?? ICON_CELL, columns = Math.max(1, Math.min(options.columns ?? ICON_SHEET_COLUMNS, parts.length || 1));
  const rows = Math.max(1, Math.ceil(parts.length / columns));
  const width = columns * cell, height = rows * cell, data = new Uint8Array(width * height * 4);
  parts.forEach((part, index) => {
    const x0 = part.left * texture.width, x1 = part.right * texture.width;
    const yTop = part.top * texture.height, yBottom = part.bottom * texture.height;
    const w = x1 - x0, h = yBottom - yTop, scale = Math.max(w, h) / cell;
    const drawnW = w / scale, drawnH = h / scale, offX = (cell - drawnW) / 2, offY = (cell - drawnH) / 2;
    const cx = (index % columns) * cell, cy = Math.floor(index / columns) * cell;
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      if (x < offX - 0.5 || x >= offX + drawnW || y < offY - 0.5 || y >= offY + drawnH) continue;
      // The texels under this cell pixel (a box of `scale` texels), averaged with premultiplied alpha.
      const sx0 = x0 + (x - offX) * scale, sy0 = yTop + (y - offY) * scale;
      const steps = Math.max(1, Math.min(8, Math.round(scale)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let j = 0; j < steps; j++) for (let i = 0; i < steps; i++) {
        const tx = Math.min(texture.width - 1, Math.max(0, Math.floor(sx0 + (i + 0.5) * scale / steps)));
        let ty = Math.min(texture.height - 1, Math.max(0, Math.floor(sy0 + (j + 0.5) * scale / steps)));
        if (options.flipped) ty = texture.height - 1 - ty;
        const at = (ty * texture.width + tx) * 4, alpha = texture.data[at + 3]! / 255;
        r += texture.data[at]! * alpha; g += texture.data[at + 1]! * alpha; b += texture.data[at + 2]! * alpha; a += alpha; n++;
      }
      const out = ((cy + y) * width + cx + x) * 4;
      if (a > 0) { data[out] = Math.round(r / a); data[out + 1] = Math.round(g / a); data[out + 2] = Math.round(b / a); }
      data[out + 3] = Math.round(a / n * 255);
    }
  });
  return { width, height, data };
}
