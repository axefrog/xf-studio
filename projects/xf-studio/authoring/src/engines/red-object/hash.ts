/**
 * The name hashes a save's schema and persistency data use (knowledge/save-files.md §3): FNV-1a 64 over a name's UTF-8 bytes, and
 * FNV-1a 32 for fact names. Pure. The 64-bit hash is computed in two 32-bit halves (exact in doubles) and returned as a `bigint`,
 * the form `DataView.getBigUint64` reads, so hashes from a file and from a name compare directly.
 */
const encoder = new TextEncoder();

/** FNV-1a 64 of `name` (offset basis 0xcbf29ce484222325, prime 0x100000001b3 = 2^40 + 0x1b3). */
export function fnv1a64(name: string): bigint {
  const bytes = encoder.encode(name);
  let hi = 0xcbf29ce4, lo = 0x84222325;
  for (let i = 0; i < bytes.length; i++) {
    lo = (lo ^ bytes[i]!) >>> 0;
    // (hi:lo) * (2^40 + 0x1b3) mod 2^64: lo*0x1b3 and hi*0x1b3 stay below 2^41, and the 2^40 term moves lo's low byte into hi.
    const low = lo * 0x1b3, carry = Math.floor(low / 0x1_0000_0000);
    hi = ((hi * 0x1b3 + carry) % 0x1_0000_0000 + ((lo << 8) >>> 0)) % 0x1_0000_0000;
    lo = low % 0x1_0000_0000;
  }
  return (BigInt(hi) << 32n) | BigInt(lo);
}

/** FNV-1a 32 of `name` (the hash a `FactsTable` stores in place of a fact's name). */
export function fnv1a32(name: string): number {
  const bytes = encoder.encode(name);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { hash ^= bytes[i]!; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}

/** A 64-bit hash as 16 hex digits, for display. */
export const hashText = (hash: bigint) => hash.toString(16).padStart(16, "0");
