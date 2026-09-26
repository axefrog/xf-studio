/**
 * Integration seam (prototype, not wired in): a resource fetch port that reads natively first and falls back to another port
 * (WolvenKit, resolver-host.ts `WolvenKitFetcher`) per resource. See research/backlog/native-archive-reader.md for the plan.
 *
 * - A resource is served natively when its archive indexes it, its root class is one the native reader has been verified on
 *   (`NATIVE_ROOTS`, from the differential harness tools/native-cr2w-diff.ts) and decoding succeeds. Anything else (an unverified
 *   type, an unsupported value, a malformed file, a missing hash) goes to the fallback port, which keeps its own cache and rules.
 * - The answer carries the same `extractedSha256` the fallback would (the native bytes are identical to WolvenKit's extraction),
 *   so provenance and render records do not depend on which reader answered.
 * - Native answers are not cached on disk: a read and decode takes well under 10 ms for all but the largest morph targets. If a
 *   cache is added, its key is (depot hash, archive fingerprint, `NativeReader.identity`), never the WolvenKit identity, so a
 *   WolvenKit update does not invalidate native answers and a reader change does not reuse old ones.
 * - Native answers are not `fresh`: the resource graph's prefetch exists to batch WolvenKit launches, which native reads don't need.
 */
import { createHash } from "node:crypto";
import type { MountedArchive } from "../archive-precedence";
import { depotHash, type DepotRef } from "../depot-path";
import type { FetchedResource, ResourceFetchPort } from "../resource-graph";
import { NativeArchivePool } from "./archive-reader";
import { Cr2wFile } from "./cr2w-file";
import type { Decompress } from "./kark";
import { loadGameOodle } from "./oodle";
import { NATIVE_READER_VERSION, readResourceJson } from "./resource-document";
import rttiSubset from "./rtti-subset.json";
import rttiDefaults from "./rtti-defaults.json";

/** Root classes whose documents matched the reference JSON on every resolver field in the differential harness. */
export const NATIVE_ROOTS: ReadonlySet<string> = new Set(["gameuiCharacterCustomizationInfoResource", "CMaterialInstance", "appearanceAppearanceResource",
  "CMesh", "MorphTargetMesh", "CBitmapTexture", "entEntityTemplate", "CMaterialTemplate", "CHairProfile", "CSkinProfile", "CGradient",
  "Multilayer_Setup", "Multilayer_LayerTemplate"]);

export interface NativeReader {
  readonly pool: NativeArchivePool;
  readonly decompress: Decompress;
  /** Reader identity for cache keys: output rules version, RTTI slice and learned defaults, and the Oodle library. */
  readonly identity: string;
  close(): void;
}

const dataHash = createHash("sha256").update(JSON.stringify(rttiSubset)).update(JSON.stringify(rttiDefaults)).digest("hex").slice(0, 12);
export const nativeReaderIdentity = (decompressor: string) => `xfs-native:${NATIVE_READER_VERSION}:${dataHash}:${decompressor}`;

/** The native reader over a game installation, or the reason it can't be used (then every read goes to the fallback). */
export function openNativeReader(gameRoot: string): { reader: NativeReader } | { reader: null; reason: string } {
  try {
    const oodle = loadGameOodle(gameRoot);
    const pool = new NativeArchivePool(oodle.decompress);
    return { reader: { pool, decompress: oodle.decompress, identity: nativeReaderIdentity(oodle.identity), close: () => { pool.close(); oodle.close(); } } };
  } catch (error) { return { reader: null, reason: (error as Error).message }; }
}

export class NativeFirstFetcher implements ResourceFetchPort {
  readonly stats = { native: 0, fallback: 0, notVerified: 0, errors: [] as string[] };
  /** Resources the last answer for came from the fallback (so its `transient` rule applies). */
  private readonly fellBack = new Set<string>();
  /** Paths from mod archives' own name lists, by archive and hash. */
  private readonly names = new Map<string, Map<string, string>>();

  constructor(private readonly reader: NativeReader, private readonly fallback: ResourceFetchPort, private readonly roots: ReadonlySet<string> = NATIVE_ROOTS) {}

  private key(archive: MountedArchive, ref: DepotRef) { return `${archive.id}|${ref.hash}`; }

  private pathOf(archive: MountedArchive, hash: string): string | null {
    let byHash = this.names.get(archive.id);
    if (!byHash) {
      byHash = new Map();
      try { for (const name of this.reader.pool.get(archive.id).names()) byHash.set(depotHash(name), name); } catch { /* no name list */ }
      this.names.set(archive.id, byHash);
    }
    return byHash.get(hash) ?? null;
  }

  /** The native answer, or null when this resource should go to the fallback. */
  private native(archive: MountedArchive, ref: DepotRef): FetchedResource | null {
    let bytes: Uint8Array | null;
    try { bytes = this.reader.pool.get(archive.id).read(ref.hash); }
    catch (error) { this.stats.errors.push(`${archive.name}: ${ref.path ?? ref.hash}: ${(error as Error).message}`); return null; }
    if (!bytes) return null;
    try {
      const root = new Cr2wFile(bytes).exports[0]?.className;
      if (!root || !this.roots.has(root)) { this.stats.notVerified++; return null; }
      const document = readResourceJson(bytes, this.reader.decompress, { buffers: "trim", header: { XfsNativeReader: this.reader.identity } });
      return { document, extractedSha256: createHash("sha256").update(bytes).digest("hex"), path: ref.path ?? this.pathOf(archive, ref.hash), fresh: false };
    } catch (error) {
      this.stats.errors.push(`${archive.name}: ${ref.path ?? ref.hash}: ${(error as Error).message}`);
      return null;
    }
  }

  async fetch(archive: MountedArchive, ref: DepotRef, extension: string | null): Promise<FetchedResource | null> {
    const key = this.key(archive, ref);
    const answer = this.native(archive, ref);
    if (answer) { this.stats.native++; this.fellBack.delete(key); return answer; }
    this.stats.fallback++;
    this.fellBack.add(key);
    return this.fallback.fetch(archive, ref, extension);
  }

  transient(archive: MountedArchive, ref: DepotRef): boolean {
    return this.fellBack.has(this.key(archive, ref)) ? this.fallback.transient?.(archive, ref) ?? true : false;
  }
}
