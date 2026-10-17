/** Immutable scalar image payload for stream observations; typed GPU/worker buffers stay in adapters. */
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function encodeScalarBytes(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += 12288) {
    let part = "";
    for (let i = start; i < Math.min(bytes.length, start + 12288); i += 3) {
      const n = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
      part += alphabet[n >>> 18] + alphabet[n >>> 12 & 63] + (i + 1 < bytes.length ? alphabet[n >>> 6 & 63] : "=") + (i + 2 < bytes.length ? alphabet[n & 63] : "=");
    }
    parts.push(part);
  }
  return parts.join("");
}
export function scalarBytes(value: string | Uint8Array): Uint8Array {
  if (value instanceof Uint8Array) return value;
  const size = value.length / 4 * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0), bytes = new Uint8Array(size);
  for (let i = 0, at = 0; i < value.length; i += 4) {
    const n = alphabet.indexOf(value[i]) << 18 | alphabet.indexOf(value[i + 1]) << 12 | Math.max(0, alphabet.indexOf(value[i + 2])) << 6 | Math.max(0, alphabet.indexOf(value[i + 3]));
    for (const shift of [16, 8, 0]) if (at < size) bytes[at++] = n >>> shift & 255;
  }
  return bytes;
}
