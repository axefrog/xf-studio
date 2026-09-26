/**
 * Worker entry (host adapter) for `WorkerDecoder` (native-decode.ts): opens the decompressor and an archive pool once, then
 * decodes one resource per message and posts the outcome. Nothing here throws to the parent: every failure is an outcome.
 */
import { depotHash } from "../depot-path";
import { NativeArchivePool } from "./archive-reader";
import type { Decompress } from "./kark";
import { decodeFromPool, type NativeDecodeOptions, type NativeDecodeRequest, type WorkerInit } from "./native-decode";
import { loadGameOodle } from "./oodle";

declare const self: Worker;

let state: { pool: NativeArchivePool; decompress: Decompress; options: NativeDecodeOptions } | null = null;

async function init(message: WorkerInit): Promise<void> {
  let decompress: Decompress;
  const source = message.decompressor;
  if ("gameRoot" in source) {
    const trusted = source.trustedSha256;
    // The parent already checked this library; the worker still holds and hashes the file itself, so a match is the same bytes.
    decompress = loadGameOodle(source.gameRoot, trusted ? { verify: (_, sha256) => sha256 === trusted ? { trustedBy: "parent" } : { refused: "The Oodle library changed since it was checked." } } : {}).decompress;
  } else {
    const module = await import(source.module) as Record<string, unknown>;
    decompress = module[source.export] as Decompress;
    if (typeof decompress !== "function") throw new Error(`${source.export} is not a decompressor.`);
  }
  state = { pool: new NativeArchivePool(decompress, 64, message.limits), decompress, options: { roots: new Set(message.roots), limits: message.limits, identity: message.identity } };
}

self.addEventListener("message", event => {
  const message = event.data as WorkerInit | { type: "decode"; request: NativeDecodeRequest };
  if (message.type === "init") {
    init(message).then(() => self.postMessage({ type: "ready" }), error => self.postMessage({ type: "init-failed", message: (error as Error).message }));
    return;
  }
  if (message.type === "decode") {
    const outcome = state ? decodeFromPool(state.pool, state.decompress, message.request, state.options, depotHash)
      : { ok: false as const, kind: "internal" as const, message: "The native decoder worker was not initialised." };
    self.postMessage({ type: "outcome", outcome });
  }
});
