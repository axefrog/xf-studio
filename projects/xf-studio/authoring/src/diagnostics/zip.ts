/**
 * A minimal ZIP writer for the problem report file (one archive the person saves and attaches): deflated entries with UTF-8 names,
 * no encryption, no ZIP64 (a report stays under `REPORT_LIMIT`). Windows, macOS and GitHub open it as a normal ZIP. Host-only.
 */
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array | string; modified?: Date };

function dosTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** The ZIP file's bytes. Names use forward slashes; a name may not climb out of the archive. */
export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!name || name.split("/").some(part => part === ".." || part === "")) throw Error(`Unsafe name in report archive: ${entry.name}`);
    const raw = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const packed = deflateRawSync(raw, { level: 6 });
    const useDeflate = packed.length < raw.length;
    const body = useDeflate ? new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength) : raw;
    const nameBytes = encoder.encode(name), crc = crc32(raw), { time, day } = dosTime(entry.modified ?? new Date());
    const local = new Uint8Array(30 + nameBytes.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, useDeflate ? 8 : 0, true);
    l.setUint16(10, time, true); l.setUint16(12, day, true); l.setUint32(14, crc, true);
    l.setUint32(18, body.length, true); l.setUint32(22, raw.length, true); l.setUint16(26, nameBytes.length, true); l.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, useDeflate ? 8 : 0, true); c.setUint16(12, time, true); c.setUint16(14, day, true); c.setUint32(16, crc, true);
    c.setUint32(20, body.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local, body); centrals.push(central);
    offset += local.length + body.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length; }
  return out;
}
