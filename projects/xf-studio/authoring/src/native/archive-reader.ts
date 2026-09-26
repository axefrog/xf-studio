/**
 * Host adapter: reads resources out of `.archive` files in-process. Opening reads the header and index block once; a read
 * fetches a file's segments with one positioned read (they are contiguous in practice; otherwise one read each), decodes them
 * (kark.ts) and returns the file exactly as an extractor writes it: the CR2W body followed by its buffers. Read-only.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { basename } from "node:path";
import { decodeSegment, type Decompress } from "./kark";
import { parseLxrsNames, parseRdarHeader, RDAR_CUSTOM_DATA_OFFSET, RDAR_HEADER_SIZE, type RdarFileEntry, RdarIndex } from "./rdar-archive";

export class NativeArchive {
  private fd: number | null;
  private namesRead: string[] | null = null;
  /** Size and modification time when opened; `stale()` compares them. */
  readonly stamp: { size: number; mtimeMs: number };

  private constructor(readonly path: string, readonly index: RdarIndex, fd: number, private readonly decompress: Decompress) {
    this.fd = fd;
    const stat = fstatSync(fd);
    this.stamp = { size: stat.size, mtimeMs: stat.mtimeMs };
  }

  static open(path: string, decompress: Decompress): NativeArchive {
    const fd = openSync(path, "r");
    try {
      const head = new Uint8Array(RDAR_HEADER_SIZE + 4);
      const got = readSync(fd, head, 0, head.length, 0);
      const header = parseRdarHeader(head.subarray(0, got));
      const size = fstatSync(fd).size;
      if (header.indexOffset + header.indexSize > size) throw Error("RDAR index lies outside the file.");
      const block = new Uint8Array(header.indexSize);
      if (readSync(fd, block, 0, block.length, header.indexOffset) !== block.length) throw Error("Truncated RDAR index.");
      return new NativeArchive(path, new RdarIndex(header, block), fd, decompress);
    } catch (error) { closeSync(fd); throw error; }
  }

  get name(): string { return basename(this.path); }
  get size(): number { return this.index.fileCount; }
  has(hash: string): boolean { return this.index.find(BigInt(hash)) >= 0; }
  entry(hash: string): RdarFileEntry | null { return this.index.entry(hash); }
  dependencies(hash: string): readonly string[] { const entry = this.index.entry(hash); return entry ? this.index.dependencies(entry) : []; }

  private handle(): number {
    if (this.fd === null) throw Error(`${this.name} is closed.`);
    return this.fd;
  }

  private readInto(target: Uint8Array, at: number, offset: number, length: number): void {
    let done = 0;
    while (done < length) {
      const got = readSync(this.handle(), target, at + done, length - done, offset + done);
      if (got <= 0) throw Error(`${this.name}: unexpected end of file at ${offset + done}.`);
      done += got;
    }
  }

  private readAt(offset: number, length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    this.readInto(bytes, 0, offset, length);
    return bytes;
  }

  /** The resource file as an extractor writes it (body, then its buffers as stored), or null when this archive does not index the hash. */
  read(hash: string): Uint8Array | null {
    const entry = this.index.entry(hash);
    if (!entry) return null;
    const segments = this.index.segments(entry);
    // The body segment is decompressed; buffer segments are kept as stored, since the CR2W buffer table records them compressed
    // (disk size = stored size, memory size = size) and an extractor writes them that way (knowledge/archive-format.md §1.4).
    const body = segments[0]!;
    const total = body.size + segments.slice(1).reduce((sum, segment) => sum + segment.storedSize, 0);
    const out = new Uint8Array(total);
    out.set(decodeSegment(this.readAt(body.offset, body.storedSize), body.size, this.decompress), 0);
    // Buffers usually lie back to back (often far from the body): each contiguous run is read at once, straight into place.
    let at = body.size;
    for (let i = 1; i < segments.length;) {
      let end = i + 1;
      while (end < segments.length && segments[end]!.offset === segments[end - 1]!.offset + segments[end - 1]!.storedSize) end++;
      const length = segments[end - 1]!.offset + segments[end - 1]!.storedSize - segments[i]!.offset;
      this.readInto(out, at, segments[i]!.offset, length);
      at += length; i = end;
    }
    return out;
  }

  /** Depot paths from the archive's own `LXRS` name block (mod archives packed with names), or [] when it has none. */
  names(): readonly string[] {
    if (this.namesRead) return this.namesRead;
    const length = this.index.header.customDataLength;
    this.namesRead = length > 0 ? parseLxrsNames(this.readAt(RDAR_CUSTOM_DATA_OFFSET, length), this.decompress) : [];
    return this.namesRead;
  }

  /** Whether the file changed since it was opened (size or time). */
  stale(): boolean {
    try { const stat = fstatSync(this.handle()); return stat.size !== this.stamp.size || stat.mtimeMs !== this.stamp.mtimeMs; } catch { return true; }
  }

  close(): void { if (this.fd !== null) { closeSync(this.fd); this.fd = null; } }
}

/**
 * Open archives by path, at most `limit` at once (least recently used closed first), reopened when the file changed. A resolver
 * reads from a few dozen of a route's ~1,000 archives, so a small pool keeps file handles bounded.
 */
export class NativeArchivePool {
  private readonly open = new Map<string, NativeArchive>();
  constructor(private readonly decompress: Decompress, private readonly limit = 64) {}

  get(path: string): NativeArchive {
    let archive = this.open.get(path);
    if (archive && archive.stale()) { archive.close(); this.open.delete(path); archive = undefined; }
    if (archive) { this.open.delete(path); this.open.set(path, archive); return archive; }
    archive = NativeArchive.open(path, this.decompress);
    this.open.set(path, archive);
    while (this.open.size > this.limit) {
      const [oldest, value] = this.open.entries().next().value!;
      value.close(); this.open.delete(oldest);
    }
    return archive;
  }

  close(): void { for (const archive of this.open.values()) archive.close(); this.open.clear(); }
}
