/** Pure reader for a Windows PE file's fixed version (VS_FIXEDFILEINFO), over a bounded byte port.
 *
 * Reads only the headers and the `.rsrc` section, never the whole binary. Layout follows the
 * Microsoft PE/COFF specification: DOS header `e_lfanew` at 0x3C, `PE\0\0`, the COFF file header
 * (section count at +2, optional-header size at +16) and 40-byte section headers. Inside `.rsrc`
 * the VS_VERSIONINFO block names itself `VS_VERSION_INFO` (UTF-16LE) and is followed, 32-bit
 * aligned, by VS_FIXEDFILEINFO whose signature is 0xFEEF04BD.
 */

/** Read `length` bytes at `offset`, or null when the file is missing, linked or too short. */
export type ByteReader = (offset: number, length: number) => Uint8Array | null;

const MAX_RESOURCE_BYTES = 16 * 1024 * 1024;
const FIXED_SIGNATURE = 0xfeef04bd;
const KEY = new Uint8Array([..."VS_VERSION_INFO"].flatMap(ch => [ch.charCodeAt(0), 0]));

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Find VS_FIXEDFILEINFO in a resource section and return its four-part file version. */
export function fixedFileVersion(resources: Uint8Array): string | null {
  const data = view(resources);
  for (let key = indexOf(resources, KEY); key >= 0; key = indexOf(resources, KEY, key + 2)) {
    // The key is NUL-terminated and the fixed block starts at the next 32-bit boundary.
    let at = key + KEY.length + 2;
    at += (4 - (at % 4)) % 4;
    for (let probe = at; probe <= at + 8 && probe + 16 <= resources.length; probe += 4) {
      if (data.getUint32(probe, true) !== FIXED_SIGNATURE) continue;
      if (data.getUint32(probe + 4, true) >>> 16 !== 1) continue;
      const ms = data.getUint32(probe + 8, true), ls = data.getUint32(probe + 12, true);
      return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`;
    }
  }
  return null;
}

/** The fixed file version of a PE image, or null when it has none or is not a PE file. */
export function readPeFileVersion(read: ByteReader): string | null {
  const dos = read(0, 64);
  if (!dos || dos.length < 64 || dos[0] !== 0x4d || dos[1] !== 0x5a) return null;
  const peOffset = view(dos).getUint32(0x3c, true);
  if (peOffset > 1024 * 1024) return null;
  const coff = read(peOffset, 24);
  if (!coff || coff.length < 24 || view(coff).getUint32(0, true) !== 0x00004550) return null;
  const sections = view(coff).getUint16(6, true), optionalSize = view(coff).getUint16(20, true);
  if (sections === 0 || sections > 96) return null;
  const table = read(peOffset + 24 + optionalSize, sections * 40);
  if (!table || table.length < sections * 40) return null;
  const rows = view(table);
  for (let i = 0; i < sections; i++) {
    const name = String.fromCharCode(...table.subarray(i * 40, i * 40 + 8)).replace(/\0+$/, "");
    if (name !== ".rsrc") continue;
    const size = rows.getUint32(i * 40 + 16, true), pointer = rows.getUint32(i * 40 + 20, true);
    if (size === 0 || size > MAX_RESOURCE_BYTES) return null;
    const resources = read(pointer, size);
    return resources ? fixedFileVersion(resources) : null;
  }
  return null;
}
