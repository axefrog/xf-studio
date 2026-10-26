// Private cache format, not a game format. Fixed-size typed tables make allocation bounds checkable before construction.
import { NativeBudgetError, NativeMalformedError } from "../../xf-studio/authoring/src/native/native-errors";
export const COLLIDER_STRIDE = 21;
export interface CachedSector { placements: Uint16Array; variantIndices: number[]; persistentNodeIndex: number; rows: Float64Array; hashes: string[] }
const MAGIC = 0x33534658, HEADER = 32, LIMIT = 64 * 1024 * 1024;
const align = (n: number) => Math.ceil(n / 8) * 8;
export function encodeSector(s: CachedSector): Uint8Array<ArrayBuffer> {
  const hashes = new TextEncoder().encode(JSON.stringify(s.hashes)), placementsAt = HEADER;
  const variantsAt = placementsAt + align(s.placements.byteLength), rowsAt = variantsAt + align(s.variantIndices.length * 4), hashesAt = rowsAt + s.rows.byteLength;
  if (hashesAt + hashes.byteLength > LIMIT) throw new NativeBudgetError("Sector cache entry exceeds 64 MiB.");
  const bytes = new Uint8Array(hashesAt + hashes.byteLength), view = new DataView(bytes.buffer);
  for (const [i, n] of [MAGIC, s.placements.length, s.variantIndices.length, s.persistentNodeIndex, s.rows.length, hashes.byteLength].entries()) view.setInt32(i * 4, n, true);
  new Uint16Array(bytes.buffer, placementsAt, s.placements.length).set(s.placements);
  new Int32Array(bytes.buffer, variantsAt, s.variantIndices.length).set(s.variantIndices);
  new Float64Array(bytes.buffer, rowsAt, s.rows.length).set(s.rows); bytes.set(hashes, hashesAt); return bytes;
}
export function decodeSector(input: Uint8Array): CachedSector {
  if (input.byteLength > LIMIT) throw new NativeBudgetError("Sector cache entry exceeds 64 MiB.");
  if (input.byteLength < HEADER) throw new NativeMalformedError("Truncated sector cache header.");
  const bytes = input.byteOffset % 8 ? input.slice() : input, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const placements = view.getUint32(4, true), variants = view.getUint32(8, true), rowValues = view.getUint32(16, true), hashBytes = view.getUint32(20, true);
  const variantsAt = HEADER + align(placements * 2), rowsAt = variantsAt + align(variants * 4), hashesAt = rowsAt + rowValues * 8;
  if (view.getUint32(0, true) !== MAGIC || placements > 1_000_000 || variants > 256 || rowValues % COLLIDER_STRIDE || hashesAt + hashBytes !== bytes.byteLength)
    throw new NativeMalformedError("Invalid sector cache table windows.");
  const hashes: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(hashesAt)));
  if (!Array.isArray(hashes) || hashes.length > rowValues / COLLIDER_STRIDE || hashes.some(h => typeof h !== "string" || h.length > 48)) throw new NativeMalformedError("Invalid sector geometry hashes.");
  return { placements: new Uint16Array(bytes.buffer, bytes.byteOffset + HEADER, placements),
    variantIndices: Array.from(new Int32Array(bytes.buffer, bytes.byteOffset + variantsAt, variants)), persistentNodeIndex: view.getInt32(12, true),
    rows: new Float64Array(bytes.buffer, bytes.byteOffset + rowsAt, rowValues), hashes };
}
