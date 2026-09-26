/**
 * The decode worker's message loop, shared by the production worker (native-decode-worker.ts, the game's Oodle library) and
 * the tests' worker (tests/fixtures/native-decode-test-worker.ts, stand-in codecs). The caller supplies how a decompressor is
 * opened, so no worker loads code by a computed path (CORE-87). Nothing here throws to the parent: every failure is an outcome.
 */
import { depotHash } from "../depot-path";
import { NativeArchivePool } from "./archive-reader";
import type { Decompress } from "./kark";
import { decodeFromPool, type NativeDecodeOptions, type NativeDecodeRequest, type WorkerInit } from "./native-decode";

export interface WorkerScope {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

export function serveDecodes(scope: WorkerScope, openDecompress: (init: WorkerInit) => Decompress | Promise<Decompress>): void {
  let state: { pool: NativeArchivePool; decompress: Decompress; options: NativeDecodeOptions } | null = null;
  const init = async (message: WorkerInit) => {
    const decompress = await openDecompress(message);
    if (typeof decompress !== "function") throw new Error("The worker has no decompressor.");
    state = { pool: new NativeArchivePool(decompress, 64, message.limits), decompress,
      options: { roots: new Set(message.roots), limits: message.limits, identity: message.identity } };
  };
  scope.addEventListener("message", event => {
    const message = event.data as WorkerInit | { type: "decode"; request: NativeDecodeRequest };
    if (message.type === "init") {
      init(message).then(() => scope.postMessage({ type: "ready" }), error => scope.postMessage({ type: "init-failed", message: (error as Error).message }));
      return;
    }
    if (message.type === "decode") {
      const outcome = state ? decodeFromPool(state.pool, state.decompress, message.request, state.options, depotHash)
        : { ok: false as const, kind: "internal" as const, message: "The native decoder worker was not initialised." };
      scope.postMessage({ type: "outcome", outcome });
    }
  });
}
