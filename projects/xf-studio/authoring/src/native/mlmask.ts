/**
 * A `.mlmask` (`Multilayer_Mask`) resource's layers: its `rendRenderMultilayerMaskBlobPC` header, BC4 tile atlas and tile table,
 * rebuilt into one greyscale image per layer, as WolvenKit 9.0.1's exporter writes them (knowledge/archive-format.md §10.4). Pure apart
 * from the injected decompressor (the document's buffers).
 *
 * - The atlas is a `atlasWidth`×`atlasHeight` BC4 image of padded tiles: each tile is `maskTileSize` texels with one texel of padding
 *   on every side (`maskTileSize + 2` apart).
 * - The tile table is little-endian 32-bit words. Its first part covers the full-size layer grid (`maskWidth`×`maskHeight` in tiles of
 *   `maskTileSize`), two words per grid tile: the offset of the tile's declarations, and a bit set of the layers the tile holds. Right
 *   after it (at the full grid's tile count) comes the same for a low-resolution grid (`maskWidthLow`×`maskHeightLow`, one grid tile per
 *   `maskWidth / maskWidthLow` full-size tiles). A layer's declaration is the word at the offset plus the number of lower layers the tile
 *   holds: its atlas tile (bits 0–9 across, 10–19 down) and how far its texels are scaled (bits 20–23 across, 24–27 down, as shifts).
 * - A texel reads the full-size grid first and the low-resolution one where the full-size grid has nothing for its layer; texels
 *   neither holds are 0. A layer with no full-size tile at all is written at the low-resolution size, sampled nearest from the full-size
 *   image; others at full size.
 * - BC4 is decoded as WolvenKit's own decoder does for masks (not DirectXTex, which its texture export uses): each level in single
 *   precision, `(e0·(7−i) + e1·i) / 7` (or `/ 5`, with 0 and 1 for the last two indices when e0 ≤ e1) of the endpoints over 255, then
 *   times 255 and truncated.
 */
import { NativeBudgetError, NativeMalformedError, NativeUnsupportedError } from "./native-errors";
import { RedBuffer, type RedDocument, RedHandle, RedObject } from "./red-model";

/**
 * Caps on what one mask may ask for (the engine's layer limit is 20; masks on the reference installation are at most 4096² with 20 layers).
 * `maxTexels` caps the layers' texels together, each counted at the full size (NATIVE-71: the side and layer caps alone let a 5 KB mask
 * ask for 8192²×32 texels, about 2 GiB, from a decode lane budgeted at about 300 MB); layers are decoded and handed on one at a time.
 */
export type MaskLimits = { maxSide: number; maxLayers: number; maxAtlasSide: number; maxTexels: number };
export const DEFAULT_MASK_LIMITS: MaskLimits = Object.freeze({ maxSide: 8192, maxLayers: 32, maxAtlasSide: 16384, maxTexels: 20 * 4096 * 4096 });

export interface MaskLayout {
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly layers: number;
  readonly width: number;
  readonly height: number;
  readonly widthLow: number;
  readonly heightLow: number;
  readonly tileSize: number;
  /** The BC4 atlas and the tile table, decompressed on first use. */
  atlas(): Uint8Array;
  tiles(): Uint32Array;
}
export interface MaskLayer { readonly width: number; readonly height: number; readonly pixels: Uint8Array }

const fieldsOf = (value: unknown): Record<string, unknown> => value instanceof RedObject ? value.fields : {};
const objectAt = (value: unknown): RedObject | null => value instanceof RedHandle ? value.target : value instanceof RedObject ? value : null;
const count = (value: unknown, what: string): number => {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new NativeMalformedError(`The mask's ${what} is not a count (${String(value)}).`);
  return value;
};
const ATLAS_PADDING = 2;

/** The layout of a decoded `Multilayer_Mask` document, checked against itself before any texel is read. */
export function maskLayout(document: RedDocument, limits: MaskLimits = DEFAULT_MASK_LIMITS): MaskLayout {
  const root = document.root;
  if (root.type !== "Multilayer_Mask") throw new NativeUnsupportedError(`A ${root.type} is not a layer mask.`);
  const blob = objectAt(fieldsOf(root.fields.renderResourceBlob).renderResourceBlobPC);
  if (!blob || blob.type !== "rendRenderMultilayerMaskBlobPC") throw new NativeUnsupportedError("The mask has no PC mask blob.");
  const header = fieldsOf(blob.fields.header);
  const atlasWidth = count(header.atlasWidth, "atlas width"), atlasHeight = count(header.atlasHeight, "atlas height");
  const layers = count(header.numLayers, "layer count"), width = count(header.maskWidth, "width"), height = count(header.maskHeight, "height");
  const widthLow = count(header.maskWidthLow, "low width"), heightLow = count(header.maskHeightLow, "low height");
  const tileSize = count(header.maskTileSize, "tile size");
  if (!tileSize) throw new NativeMalformedError("The mask's tile size is 0.");
  if (atlasWidth % (tileSize + ATLAS_PADDING) || atlasHeight % (tileSize + ATLAS_PADDING))
    throw new NativeMalformedError(`The mask's ${atlasWidth}×${atlasHeight} atlas is not whole tiles of ${tileSize + ATLAS_PADDING}.`);
  if (atlasWidth % 4 || atlasHeight % 4) throw new NativeMalformedError(`A ${atlasWidth}×${atlasHeight} BC4 atlas is not whole blocks.`);
  if (!width || !height || width > limits.maxSide || height > limits.maxSide || widthLow > width || heightLow > height)
    throw new (width > limits.maxSide || height > limits.maxSide ? NativeBudgetError : NativeMalformedError)(`A ${width}×${height} mask is outside what is decoded.`);
  if (layers > limits.maxLayers) throw new NativeBudgetError(`A mask of ${layers} layers is more than ${limits.maxLayers}.`);
  if (layers * width * height > limits.maxTexels)
    throw new NativeBudgetError(`A mask of ${layers} layers of ${width}×${height} is more texels than ${limits.maxTexels} together.`);
  if (atlasWidth > limits.maxAtlasSide || atlasHeight > limits.maxAtlasSide) throw new NativeBudgetError(`A ${atlasWidth}×${atlasHeight} mask atlas is too large.`);
  const atlasBuffer = blob.fields.atlasData, tilesBuffer = blob.fields.tilesData;
  if (!(atlasBuffer instanceof RedBuffer) || !(tilesBuffer instanceof RedBuffer)) throw new NativeMalformedError("The mask blob has no atlas or tile data.");
  let atlas: Uint8Array | null = null, tiles: Uint32Array | null = null;
  return { atlasWidth, atlasHeight, layers, width, height, widthLow, heightLow, tileSize,
    atlas: () => {
      if (atlas) return atlas;
      const bytes = atlasBuffer.bytes();
      if (bytes.length < (atlasWidth / 4) * (atlasHeight / 4) * 8) throw new NativeMalformedError(`The mask atlas holds ${bytes.length} bytes; ${atlasWidth}×${atlasHeight} BC4 needs more.`);
      return (atlas = bytes);
    },
    tiles: () => {
      if (tiles) return tiles;
      const bytes = tilesBuffer.bytes(), words = new Uint32Array(Math.floor(bytes.length / 4)), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < words.length; i++) words[i] = view.getUint32(i * 4, true);
      return (tiles = words);
    } };
}

const f = Math.fround;
/** One BC4 block's eight levels, as WolvenKit's mask decoder computes them (see the module comment). */
function levels(e0: number, e1: number, out: Uint8Array): void {
  const a = f(e0 / 255), b = f(e1 / 255);
  const byte = (value: number) => Math.min(255, Math.max(0, Math.trunc(f(value * 255))));
  out[0] = byte(a); out[1] = byte(b);
  for (let index = 2; index < 8; index++) {
    let value: number;
    if (e0 > e1) { const i = index - 1; value = f(f(f(a * (7 - i)) + f(b * i)) / 7); }
    else if (index === 6) value = 0;
    else if (index === 7) value = 1;
    else { const i = index - 1; value = f(f(f(a * (5 - i)) + f(b * i)) / 5); }
    out[index] = byte(value);
  }
}

/** The BC4 atlas decoded to one byte per texel, row by row (blocks in rows, left to right). */
export function decodeMaskAtlas(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height), table = new Uint8Array(8), blocksPerRow = width / 4, blocks = blocksPerRow * (height / 4);
  for (let block = 0; block < blocks; block++) {
    const at = block * 8;
    levels(data[at]!, data[at + 1]!, table);
    // 48 bits of 3-bit indices, texel 0 in the lowest bits: texels 0-7 in bytes 2-4, 8-15 in bytes 5-7.
    const low = data[at + 2]! | (data[at + 3]! << 8) | (data[at + 4]! << 16), high = data[at + 5]! | (data[at + 6]! << 8) | (data[at + 7]! << 16);
    const x0 = (block % blocksPerRow) * 4, y0 = Math.floor(block / blocksPerRow) * 4;
    for (let texel = 0; texel < 16; texel++) {
      const index = texel < 8 ? (low >> (3 * texel)) & 7 : (high >> (3 * (texel - 8))) & 7;
      out[(y0 + (texel >> 2)) * width + x0 + (texel & 3)] = table[index]!;
    }
  }
  return out;
}

const popcount = (value: number) => { let v = value >>> 0, n = 0; while (v) { v &= v - 1; n++; } return n; };
const divCeil = (a: number, b: number) => Math.floor((a + b - 1) / b);

/** Every layer's image, in layer order, all at once (`maskLayers`; tests and oracles). */
export function decodeMaskLayers(layout: MaskLayout): MaskLayer[] { return [...maskLayers(layout)]; }

/**
 * Each layer's image, in layer order, one at a time (see the module comment for the rules): a layer is decoded when the next is asked for,
 * so a caller that encodes each before asking for the next holds one layer's texels at a time (NATIVE-71). Worked a tile at a time: which
 * declaration a texel reads depends only on its tile, so each tile is resolved once and only tiles that hold the layer are filled; a layer
 * written at the low-resolution size samples its nearest full-size texels directly (it has no full-size tile, so each reads the
 * low-resolution grid).
 */
export function* maskLayers(layout: MaskLayout): Generator<MaskLayer, void, undefined> {
  const { width, height, widthLow, heightLow, tileSize, atlasWidth } = layout;
  const atlas = decodeMaskAtlas(layout.atlas(), layout.atlasWidth, layout.atlasHeight), tiles = layout.tiles();
  const atlasTile = tileSize + ATLAS_PADDING;
  const widthInTiles = divCeil(width, tileSize), heightInTiles = divCeil(height, tileSize), lowOffset = widthInTiles * heightInTiles;
  const lowScale = widthLow === 0 || width < widthLow ? 1 : Math.floor(width / widthLow);
  const widthInTilesLow = divCeil(Math.floor(width / lowScale), tileSize);
  /** The declaration a grid tile gives a layer (its atlas tile and shifts), or -1 when it holds none. */
  const declaration = (tile: number, layer: number): number => {
    if (tile * 2 + 1 >= tiles.length) return -1;
    const offset = tiles[tile * 2]!, present = tiles[tile * 2 + 1]!;
    if (!(present & (1 << layer))) return -1;
    const at = offset + popcount(present & ((1 << layer) - 1));
    return at < tiles.length ? tiles[at]! : -1;
  };
  /** A texel of the tile `found` declares, or 0 when its atlas texel is outside the atlas (left unwritten, as WolvenKit does). */
  const texel = (found: number, x: number, y: number): number => {
    const dx = found & 0x3ff, dy = (found >>> 10) & 0x3ff, sx = (found >>> 20) & 0xf, sy = (found >>> 24) & 0xf;
    const localX = Math.min((x >>> sx) % tileSize, tileSize - 1), localY = Math.min((y >>> sy) % tileSize, tileSize - 1);
    const index = localX + 1 + dx * atlasTile + (localY + 1 + dy * atlasTile) * atlasWidth;
    return index < atlas.length ? atlas[index]! : 0;
  };
  /** The low-resolution grid's declaration for the full-size tile (tx, ty) (tile coordinates divided by the scale, in integers). */
  const lowDeclaration = (tx: number, ty: number, layer: number) =>
    declaration(widthInTilesLow * Math.floor(ty / lowScale) + Math.floor(tx / lowScale) + lowOffset, layer);
  for (let layer = 0; layer < layout.layers; layer++) {
    let highRes = false;
    for (let tile = 0; tile < widthInTiles * heightInTiles && !highRes; tile++) if (tile * 2 + 1 < tiles.length && (tiles[tile * 2 + 1]! & (1 << layer))) highRes = true;
    if (!highRes && widthLow !== 0 && heightLow !== 0 && widthLow !== width) {
      // Written at the low-resolution size: nearest full-size texel of each, read through the low-resolution grid.
      const small = new Uint8Array(widthLow * heightLow), fx = width / widthLow, fy = height / heightLow;
      for (let y = 0; y < heightLow; y++) {
        const sy = Math.min(height - 1, Math.trunc(y * fy)), ty = Math.floor(sy / tileSize);
        for (let x = 0; x < widthLow; x++) {
          const sx = Math.min(width - 1, Math.trunc(x * fx)), found = lowDeclaration(Math.floor(sx / tileSize), ty, layer);
          if (found >= 0) small[y * widthLow + x] = texel(found, sx, sy);
        }
      }
      yield { width: widthLow, height: heightLow, pixels: small };
      continue;
    }
    const pixels = new Uint8Array(width * height);
    for (let ty = 0; ty < heightInTiles; ty++) for (let tx = 0; tx < widthInTiles; tx++) {
      let found = declaration(ty * widthInTiles + tx, layer);
      if (found < 0) found = lowDeclaration(tx, ty, layer);
      if (found < 0) continue;
      const x1 = Math.min(width, (tx + 1) * tileSize), y1 = Math.min(height, (ty + 1) * tileSize);
      for (let y = ty * tileSize; y < y1; y++) for (let x = tx * tileSize; x < x1; x++) pixels[y * width + x] = texel(found, x, y);
    }
    yield { width, height, pixels };
  }
}
