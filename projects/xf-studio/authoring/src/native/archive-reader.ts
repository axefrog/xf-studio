/**
 * Host adapter: reads resources out of `.archive` files in-process. Opening reads the header and index block once; a read
 * fetches a file's segments (one positioned read per contiguous run), decodes them (kark.ts) and returns the file exactly as an
 * extractor writes it: the CR2W body followed by its buffers. Read-only.
 *
 * No file handle outlives a call. A read opens the archive, checks that it is still the file whose index was parsed (size,
 * modification time and file id from `fstat`), reads and closes. So an installer or mod manager can replace an archive by rename
 * at any time (Windows refuses to rename over a file another process holds open), and a replaced archive is re-indexed rather
 * than read through a stale index. Every size read from the file is checked against the real file size and the caps in
 * limits.ts before anything is allocated.
 */
import { closeSync, fstatSync, openSync, readSync, statSync, type Stats } from "node:fs";
import { basename } from "node:path";
import { decodeSegment, type Decompress } from "./kark";
import { DEFAULT_LIMITS, type NativeLimits } from "./limits";
import { NativeBudgetError, NativeMalformedError } from "./native-errors";
import { parseLxrsNames, parseRdarHeader, RDAR_CUSTOM_DATA_OFFSET, RDAR_HEADER_SIZE, type RdarFileEntry, RdarIndex } from "./rdar-archive";

/** Identity of one version of a file: a replaced or rewritten archive differs in at least one field. */
export interface ArchiveStamp { readonly size: number; readonly mtimeMs: number; readonly ino: number }
const stampOf = (stat: Stats): ArchiveStamp => ({ size: stat.size, mtimeMs: stat.mtimeMs, ino: Number(stat.ino) });
const sameStamp = (a: ArchiveStamp, b: ArchiveStamp) => a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;

/** The archive changed on disk after its index was read (an I/O condition: the caller reopens it or falls back). */
export class ArchiveChangedError extends Error {
  override name = "ArchiveChangedError";
  readonly code = "ESTALE";
}

function readFully(fd: number, target: Uint8Array, at: number, offset: number, length: number, name: string): void {
  let done = 0;
  while (done < length) {
    const got = readSync(fd, target, at + done, length - done, offset + done);
    if (got <= 0) throw new NativeMalformedError(`${name}: unexpected end of file at ${offset + done}.`);
    done += got;
  }
}

export class NativeArchive {
  private closed = false;
  private namesRead: string[] | null = null;

  private constructor(readonly path: string, readonly index: RdarIndex, readonly stamp: ArchiveStamp, private readonly decompress: Decompress,
    readonly limits: NativeLimits) {}

  /** Parse an archive's header and index (the file is open only during this call). */
  static open(path: string, decompress: Decompress, limits: NativeLimits = DEFAULT_LIMITS): NativeArchive {
    const fd = openSync(path, "r");
    try {
      const stamp = stampOf(fstatSync(fd));
      const head = new Uint8Array(RDAR_HEADER_SIZE + 4);
      const got = readSync(fd, head, 0, head.length, 0);
      const header = parseRdarHeader(head.subarray(0, got));
      if (header.indexOffset + header.indexSize > stamp.size) throw new NativeMalformedError("RDAR index lies outside the file.");
      const block = new Uint8Array(header.indexSize);
      readFully(fd, block, 0, header.indexOffset, block.length, basename(path));
      return new NativeArchive(path, new RdarIndex(header, block, stamp.size), stamp, decompress, limits);
    } finally { closeSync(fd); }
  }

  get name(): string { return basename(this.path); }
  get size(): number { return this.index.fileCount; }
  has(hash: string): boolean { return this.index.find(BigInt(hash)) >= 0; }
  entry(hash: string): RdarFileEntry | null { return this.index.entry(hash); }
  dependencies(hash: string): readonly string[] { const entry = this.index.entry(hash); return entry ? this.index.dependencies(entry) : []; }

  /** Open the file for one operation, checked to be the version whose index was parsed. */
  private withFile<T>(use: (fd: number) => T): T {
    if (this.closed) throw Error(`${this.name} is closed.`);
    const fd = openSync(this.path, "r");
    try {
      if (!sameStamp(stampOf(fstatSync(fd)), this.stamp)) throw new ArchiveChangedError(`${this.name} changed on disk since its index was read.`);
      return use(fd);
    } finally { closeSync(fd); }
  }

  /** The resource file as an extractor writes it (body, then its buffers as stored), or null when this archive does not index the hash. */
  read(hash: string): Uint8Array | null {
    const entry = this.index.entry(hash);
    if (!entry) return null;
    const segments = this.index.segments(entry);
    // The body segment is decompressed; buffer segments are kept as stored, since the CR2W buffer table records them compressed
    // (disk size = stored size, memory size = size) and an extractor writes them that way (knowledge/archive-format.md §1.4).
    const body = segments[0]!;
    const limits = this.limits;
    if (body.size > limits.maxBodyBytes || body.storedSize > limits.maxBodyBytes)
      throw new NativeBudgetError(`${this.name}: a ${Math.max(body.size, body.storedSize)}-byte body passes the ${limits.maxBodyBytes}-byte cap.`);
    let total = body.size;
    for (let i = 1; i < segments.length; i++) {
      const segment = segments[i]!;
      if (segment.storedSize > limits.maxBufferBytes || segment.size > limits.maxBufferBytes)
        throw new NativeBudgetError(`${this.name}: a ${Math.max(segment.size, segment.storedSize)}-byte buffer passes the ${limits.maxBufferBytes}-byte cap.`);
      total += segment.storedSize;
    }
    if (total > limits.maxResourceBytes) throw new NativeBudgetError(`${this.name}: a ${total}-byte resource passes the ${limits.maxResourceBytes}-byte cap.`);
    return this.withFile(fd => {
      const out = new Uint8Array(total);
      const stored = new Uint8Array(body.storedSize);
      readFully(fd, stored, 0, body.offset, body.storedSize, this.name);
      out.set(decodeSegment(stored, body.size, this.decompress, limits.maxBodyBytes), 0);
      // Buffers usually lie back to back (often far from the body): each contiguous run is read at once, straight into place.
      let at = body.size;
      for (let i = 1; i < segments.length;) {
        let end = i + 1;
        while (end < segments.length && segments[end]!.offset === segments[end - 1]!.offset + segments[end - 1]!.storedSize) end++;
        const length = segments[end - 1]!.offset + segments[end - 1]!.storedSize - segments[i]!.offset;
        readFully(fd, out, at, segments[i]!.offset, length, this.name);
        at += length; i = end;
      }
      return out;
    });
  }

  /** Depot paths from the archive's own `LXRS` name block (mod archives packed with names), or [] when it has none. */
  names(): readonly string[] {
    if (this.namesRead) return this.namesRead;
    const length = this.index.header.customDataLength;
    if (length > 0) {
      if (length > this.limits.maxNameListBytes) throw new NativeBudgetError(`${this.name}: a ${length}-byte name block passes the ${this.limits.maxNameListBytes}-byte cap.`);
      if (RDAR_CUSTOM_DATA_OFFSET + length > this.stamp.size) throw new NativeMalformedError(`${this.name}: the name block lies outside the file.`);
    }
    this.namesRead = length > 0 ? this.withFile(fd => {
      const block = new Uint8Array(length);
      readFully(fd, block, 0, RDAR_CUSTOM_DATA_OFFSET, length, this.name);
      return parseLxrsNames(block, this.decompress, this.limits.maxNameListBytes);
    }) : [];
    return this.namesRead;
  }

  /** Whether the file at the path is no longer the one indexed (size, time or file id differ, or it is gone). */
  stale(): boolean {
    try { return !sameStamp(stampOf(statSync(this.path)), this.stamp); } catch { return true; }
  }

  /** Forget the archive: later reads through this object throw. */
  close(): void { this.closed = true; }
}

/**
 * Parsed archive indexes by path, at most `limit` at once (least recently used dropped first), re-parsed when the file at the path
 * changed. A resolver reads from a few dozen of a route's ~1,000 archives, so a small pool keeps memory bounded. The pool holds no
 * file handles.
 */
export class NativeArchivePool {
  private readonly open = new Map<string, NativeArchive>();
  constructor(private readonly decompress: Decompress, private readonly limit = 64, private readonly limits: NativeLimits = DEFAULT_LIMITS) {}

  /** The archive at `path`, re-indexed first if the file changed (one `stat`). */
  get(path: string): NativeArchive {
    const archive = this.open.get(path);
    if (archive && archive.stale()) this.drop(path);
    return this.indexed(path);
  }

  /**
   * One resource (see `NativeArchive.read`). Skips `get`'s `stat` on the common path: the read's own `fstat` check notices a
   * replaced file, which is then re-indexed and read once more. A hash the cached index lacks costs a `stat`, since a replaced
   * file may list it.
   */
  read(path: string, hash: string): Uint8Array | null {
    try {
      const archive = this.indexed(path), found = archive.read(hash);
      if (found !== null || !archive.stale()) return found;
    } catch (error) { if (!(error instanceof ArchiveChangedError)) throw error; }
    this.drop(path);
    return this.indexed(path).read(hash);
  }

  private drop(path: string): void { this.open.get(path)?.close(); this.open.delete(path); }

  /** The cached index for `path` (most recently used), or a freshly parsed one. */
  private indexed(path: string): NativeArchive {
    let archive = this.open.get(path);
    if (archive) { this.open.delete(path); this.open.set(path, archive); return archive; }
    archive = NativeArchive.open(path, this.decompress, this.limits);
    this.open.set(path, archive);
    while (this.open.size > this.limit) {
      const [oldest, value] = this.open.entries().next().value!;
      value.close(); this.open.delete(oldest);
    }
    return archive;
  }

  close(): void { for (const archive of this.open.values()) archive.close(); this.open.clear(); }
}
