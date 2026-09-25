// Test-only ZIP writer: stored or deflated entries, with optional corruptions for the extractor's refusals.
import { crc32, deflateRawSync } from "node:zlib";

export type FixtureEntry = { name: string; data?: string | Uint8Array; method?: 0 | 8; flags?: number; madeBy?: number;
  external?: number; badCrc?: boolean };

export function makeZip(entries: readonly FixtureEntry[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? "");
    const method = entry.method ?? 8;
    const packed = method === 8 ? deflateRawSync(data) : data;
    const name = Buffer.from(entry.name, "utf8");
    const crc = (crc32(data) ^ (entry.badCrc ? 1 : 0)) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(entry.flags ?? 0x800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(((entry.madeBy ?? 0) << 8) | 20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0x800, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.external ?? 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
