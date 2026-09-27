/**
 * Host adapter: an animation set's clip index, one decoded clip, or a rig, read from an archive (anim-set.ts) and reported as data, never
 * thrown, so the same code runs in-process and in the decode worker (native-decode-serve.ts), where the game's Oodle library lives.
 */
import { createHash } from "node:crypto";
import type { NativeArchivePool } from "./archive-reader";
import type { Decompress } from "./kark";
import { DecodeSession, DEFAULT_LIMITS, type NativeLimits } from "./limits";
import { classifyNativeFailure, type NativeFailureKind } from "./native-errors";
import { type AnimClip, type AnimRig, type AnimSetIndex, decodeAnimClip, readAnimRig, readAnimSetIndex } from "./anim-set";

export type NativeAnimRequest = {
  readonly archivePath: string;
  /** Depot hash, decimal. */
  readonly hash: string;
  /** This request's time budget in a worker. */
  readonly timeoutMs?: number;
  /** `background`: decoded only when no other request waits (the pose catalogue's set index). */
  readonly priority?: "background";
} & ({ readonly op: "index" } | { readonly op: "clip"; readonly clip: string } | { readonly op: "rig" });

export type NativeAnimOutcome =
  | { readonly ok: true; readonly extractedSha256: string; readonly index?: AnimSetIndex; readonly clip?: AnimClip | null; readonly rig?: AnimRig }
  | { readonly ok: false; readonly kind: NativeFailureKind; readonly message: string; readonly errorName?: string; readonly stack?: string; readonly lasting?: boolean };

/** Read one set or rig and answer the request; every failure is returned with its kind. */
export function decodeAnimFromPool(pool: NativeArchivePool, decompress: Decompress, request: NativeAnimRequest, limits: NativeLimits = DEFAULT_LIMITS): NativeAnimOutcome {
  try {
    const bytes = pool.read(request.archivePath, request.hash);
    if (!bytes) return { ok: false, kind: "not-indexed", message: "The archive does not list the resource." };
    const extractedSha256 = createHash("sha256").update(bytes).digest("hex");
    const session = new DecodeSession(limits);
    if (request.op === "index") return { ok: true, extractedSha256, index: readAnimSetIndex(bytes, session) };
    if (request.op === "rig") return { ok: true, extractedSha256, rig: readAnimRig(bytes, session) };
    return { ok: true, extractedSha256, clip: decodeAnimClip(bytes, request.clip, decompress, session) };
  } catch (error) {
    const kind = classifyNativeFailure(error);
    const failure = error as { name?: unknown; message?: unknown; stack?: unknown } | null;
    return { ok: false, kind, message: String(failure?.message ?? error), errorName: typeof failure?.name === "string" ? failure.name : undefined,
      stack: kind === "internal" && typeof failure?.stack === "string" ? failure.stack : undefined };
  }
}
