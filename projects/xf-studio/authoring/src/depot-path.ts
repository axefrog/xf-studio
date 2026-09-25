/**
 * Depot path identity for game resources. Pure: no IO.
 *
 * A resource is identified by the FNV-1a 64 hash of its *sanitized* depot path. The sanitation follows
 * RED4ext.SDK `ResourcePath::HashSanitized` [source]: drop one opening quote, leading slashes and
 * repeated separators, turn `/` into `\`, lower-case ASCII letters, stop at a closing quote and at 216
 * characters. Hashes are unsigned 64-bit, so they are carried as decimal strings, never JS numbers.
 */

const FNV_OFFSET = 14695981039346656037n, FNV_PRIME = 1099511628211n, MASK64 = (1n << 64n) - 1n;
const MAX_PATH = 216;

export function fnv1a64(bytes: Uint8Array, seed = FNV_OFFSET): bigint {
  let hash = seed;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK64;
  return hash;
}

/** The sanitized form the engine hashes, or "" for an empty path. */
export function sanitizeDepotPath(path: string): string {
  let i = 0, out = "";
  if (path[i] === "\"" || path[i] === "'") i++;
  while (path[i] === "/" || path[i] === "\\") i++;
  while (i < path.length && path[i] !== "\"" && path[i] !== "'") {
    const ch = path[i]!;
    if (ch === "/" || ch === "\\") {
      out += "\\"; i++;
      while (path[i] === "/" || path[i] === "\\") i++;
    } else { out += ch >= "A" && ch <= "Z" ? ch.toLowerCase() : ch; i++; }
    if (out.length === MAX_PATH) break;
  }
  return out;
}

/** Decimal FNV-1a 64 of a depot path, "0" for an empty one (the engine's null path). */
export function depotHash(path: string): string {
  const clean = sanitizeDepotPath(path);
  return clean ? fnv1a64(new TextEncoder().encode(clean)).toString() : "0";
}

/** Decimal uint64 validation; resource hashes must never pass through Number. */
export function isDecimalHash(value: string): boolean {
  return /^\d{1,20}$/.test(value) && BigInt(value) <= MASK64;
}

/** A resource reference: always a hash, a path when the source stored or we know one. */
export interface DepotRef {
  readonly hash: string;
  readonly path: string | null;
}

export const refFromPath = (path: string): DepotRef => ({ hash: depotHash(path), path: path });
export function refFromHash(hash: string, path: string | null = null): DepotRef {
  if (!isDecimalHash(hash)) throw Error(`Invalid resource hash: ${hash}`);
  return { hash: BigInt(hash).toString(), path };
}
export const isNullRef = (ref: DepotRef | null | undefined): boolean => !ref || ref.hash === "0";
export const refLabel = (ref: DepotRef): string => ref.path ?? `#${ref.hash}`;
export const extensionOf = (ref: DepotRef): string | null => {
  const match = ref.path ? /\.([a-z0-9]+)$/i.exec(ref.path) : null;
  return match ? match[1]!.toLowerCase() : null;
};
