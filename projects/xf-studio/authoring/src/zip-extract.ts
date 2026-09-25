import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

/**
 * File adapter: a small, strict ZIP reader for tool archives XF Studio downloads. It accepts only
 * plain stored or deflated entries with safe relative names, checks every entry's size and CRC,
 * never overwrites a file and never follows a path outside the destination. ZIP64, encryption,
 * symbolic links and duplicate names are refused. The caller verifies the archive's hash first.
 */
export class ZipError extends Error {}
export type ZipEntry = { name: string; bytes: number; sha256: string };
export type ZipLimits = { maxEntries: number; maxTotalBytes: number };

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

/** Pure: is this entry name a safe relative path? Returns the normalised name ("a/b.dll") or null. */
export function safeEntryName(raw: string): string | null {
  const name = raw.replace(/\\/g, "/");
  if (!name || name.startsWith("/") || /^[A-Za-z]:/.test(name) || /[\x00-\x1f<>:"|?*]/.test(name)) return null;
  const parts = name.replace(/\/$/, "").split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[. ]$/.test(part))) return null;
  return name;
}

type Central = { name: string; directory: boolean; method: number; crc: number; compressed: number; size: number; offset: number };

function centralDirectory(zip: Buffer, limits: ZipLimits): Central[] {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--)
    if (zip.readUInt32LE(i) === EOCD) { end = i; break; }
  if (end < 0) throw new ZipError("The archive has no ZIP directory.");
  const count = zip.readUInt16LE(end + 10), size = zip.readUInt32LE(end + 12), offset = zip.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw new ZipError("ZIP64 archives are not supported.");
  if (count > limits.maxEntries) throw new ZipError("The archive has too many entries.");
  if (offset + size > end) throw new ZipError("The ZIP directory lies outside the archive.");
  const entries: Central[] = [], seen = new Set<string>();
  let at = offset, total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || zip.readUInt32LE(at) !== CENTRAL) throw new ZipError("The ZIP directory is damaged.");
    const madeBy = zip.readUInt16LE(at + 4) >> 8, flags = zip.readUInt16LE(at + 8), method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16), compressed = zip.readUInt32LE(at + 20), uncompressed = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28), extraLength = zip.readUInt16LE(at + 30), commentLength = zip.readUInt16LE(at + 32);
    const external = zip.readUInt32LE(at + 38), local = zip.readUInt32LE(at + 42);
    const raw = zip.subarray(at + 46, at + 46 + nameLength).toString(flags & 0x800 ? "utf8" : "latin1");
    at += 46 + nameLength + extraLength + commentLength;
    if (flags & 0x1) throw new ZipError("Encrypted archives are not supported.");
    // Unix-made entries carry their file type in the high attribute bits; refuse symbolic links.
    if (madeBy === 3 && ((external >>> 16) & 0o170000) === 0o120000) throw new ZipError(`The archive contains a link (${raw}).`);
    const name = safeEntryName(raw);
    if (!name) throw new ZipError(`The archive contains an unsafe file name (${raw}).`);
    const key = name.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) throw new ZipError(`The archive names ${raw} twice.`);
    seen.add(key);
    const directory = name.endsWith("/");
    if (!directory && method !== 0 && method !== 8) throw new ZipError(`The archive uses an unsupported compression (${raw}).`);
    total += uncompressed;
    if (total > limits.maxTotalBytes) throw new ZipError("The archive expands beyond its allowed size.");
    entries.push({ name: name.replace(/\/$/, ""), directory, method, crc, compressed, size: uncompressed, offset: local });
  }
  return entries;
}

/** Pure: read and check every entry; returns the files' bytes in directory order. */
export function readZip(zip: Buffer, limits: ZipLimits): { name: string; data: Buffer }[] {
  const files: { name: string; data: Buffer }[] = [];
  for (const entry of centralDirectory(zip, limits)) {
    if (entry.directory) continue;
    if (entry.offset + 30 > zip.length || zip.readUInt32LE(entry.offset) !== LOCAL) throw new ZipError(`The entry ${entry.name} is damaged.`);
    const start = entry.offset + 30 + zip.readUInt16LE(entry.offset + 26) + zip.readUInt16LE(entry.offset + 28);
    if (start + entry.compressed > zip.length) throw new ZipError(`The entry ${entry.name} is truncated.`);
    const packed = zip.subarray(start, start + entry.compressed);
    let data: Buffer;
    try { data = entry.method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: Math.max(1, entry.size) }); }
    catch { throw new ZipError(`The entry ${entry.name} could not be decompressed.`); }
    if (data.length !== entry.size || (crc32(data) >>> 0) !== entry.crc) throw new ZipError(`The entry ${entry.name} failed its checksum.`);
    files.push({ name: entry.name, data });
  }
  return files;
}

/** Extract into an empty or new directory; never overwrites and never writes outside it. */
export function extractZip(zip: Buffer, destination: string, limits: ZipLimits): ZipEntry[] {
  const root = resolve(destination);
  const files = readZip(zip, limits);
  mkdirSync(root, { recursive: true });
  return files.map(({ name, data }) => {
    const target = resolve(join(root, ...name.split("/")));
    if (!target.startsWith(root + sep)) throw new ZipError(`The entry ${name} points outside the destination.`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data, { flag: "wx" });
    return { name, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  });
}
