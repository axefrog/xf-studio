/**
 * Host adapter: one `.xbm` read from an archive and turned into the PNG the preview is served, reported as data, never thrown, so the
 * same code runs in-process and in the decode worker (native-decode-serve.ts). Only the mip the preview takes is decoded: the largest at
 * or under `maxSide` on both sides (an 8192² body map is served from its 4096² mip, so mip 0 is never decoded and then halved).
 *
 * Budgets: the reader's caps (limits.ts), except that the texture data may decompress to more than the document decoders' 64 MiB
 * (an 8192² BC7 map with its mips is 85.3 MiB), and the texture's own caps (xbm-texture.ts `TextureLimits`). The decoded mip is at most
 * `maxSide`² texels, but it is never whole in memory: block rows are decoded straight into the PNG stream (png.ts `encodePngRows`), so a
 * decode holds the resource, its texture data and the compressed PNG (for a 4096² BC7 map about 16, 21 and 12 MB).
 */
import { createHash } from "node:crypto";
import { encodePngRows } from "../png";
import type { NativeArchivePool } from "./archive-reader";
import { readCr2w } from "./cr2w-reader";
import type { Decompress } from "./kark";
import { DecodeSession, DEFAULT_LIMITS, type NativeLimits } from "./limits";
import { classifyNativeFailure, type NativeFailureKind } from "./native-errors";
import { DEFAULT_TEXTURE_LIMITS, mipRows, servedMip, textureLayout, type TextureLimits } from "./xbm-texture";

/**
 * Version of the texture output rules; part of the texture reader's identity in cache keys. Bump it whenever what a texture decodes to
 * changes (channels, mip choice, PNG encoding).
 */
export const NATIVE_TEXTURE_VERSION = 1;

/** The reader's caps with room for a large texture's data buffer (decompressed bytes count against `maxDecodedBytes`). */
export const TEXTURE_READ_LIMITS: NativeLimits = Object.freeze({ ...DEFAULT_LIMITS, maxDecodedBytes: 160 * 2 ** 20 });

export interface NativeTextureRequest {
  readonly archivePath: string;
  /** Depot hash, decimal. */
  readonly hash: string;
  /** Largest side served (character-detail-service.ts `SERVED_TEXTURE_MAX`). */
  readonly maxSide: number;
  /** This request's time budget in a worker. */
  readonly timeoutMs?: number;
}

export interface NativeTexture {
  /** The PNG: RGB, or RGBA when any texel's alpha is below 255. */
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Mip 0's size in the game files and the mip served. */
  readonly gameWidth: number;
  readonly gameHeight: number;
  readonly mip: number;
  readonly format: string;
  readonly isGamma: boolean;
  /** SHA-256 of the extracted resource (as WolvenKit's `unbundle` writes it). */
  readonly extractedSha256: string;
}

export type NativeTextureOutcome =
  | { readonly ok: true; readonly texture: NativeTexture }
  | { readonly ok: false; readonly kind: NativeFailureKind; readonly message: string; readonly errorName?: string; readonly stack?: string; readonly lasting?: boolean };

/** Deflate level for served textures: level 3 compresses a 4096² map about 2.5× faster than level 6 and 6× faster than level 9, about 10% larger than level 6 (measured on the default V's 63 maps). */
const PNG_LEVEL = 3;

/** Read, check and decode one texture's served mip to PNG; every failure is returned with its kind. */
export async function decodeTextureFromPool(pool: NativeArchivePool, decompress: Decompress, request: NativeTextureRequest,
  limits: NativeLimits = TEXTURE_READ_LIMITS, textureLimits: TextureLimits = DEFAULT_TEXTURE_LIMITS): Promise<NativeTextureOutcome> {
  try {
    const bytes = pool.read(request.archivePath, request.hash);
    if (!bytes) return { ok: false, kind: "not-indexed", message: "The archive does not list the resource." };
    const layout = textureLayout(readCr2w(bytes, decompress, new DecodeSession(limits)), textureLimits);
    const mip = servedMip(layout, request.maxSide);
    // Decoded a block row at a time into the PNG stream: neither the texels nor the filtered rows are ever whole in memory.
    const rows = mipRows(layout, mip);
    const png = await encodePngRows(rows.width, rows.height, r => rows.row(r), { alpha: rows.alpha, level: PNG_LEVEL });
    return { ok: true, texture: { png, width: rows.width, height: rows.height, gameWidth: layout.width, gameHeight: layout.height, mip,
      format: layout.format, isGamma: layout.isGamma, extractedSha256: createHash("sha256").update(bytes).digest("hex") } };
  } catch (error) {
    const kind = classifyNativeFailure(error);
    const failure = error as { name?: unknown; message?: unknown; stack?: unknown } | null;
    return { ok: false, kind, message: String(failure?.message ?? error), errorName: typeof failure?.name === "string" ? failure.name : undefined,
      stack: kind === "internal" && typeof failure?.stack === "string" ? failure.stack : undefined };
  }
}
