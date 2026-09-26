/**
 * The decode worker's message loop, shared by the production worker (native-decode-worker.ts, the game's Oodle library) and
 * the tests' worker (tests/fixtures/native-decode-test-worker.ts, stand-in codecs). The caller supplies how a decompressor is
 * opened, so no worker loads code by a computed path (CORE-87). Nothing here throws to the parent: every failure is an outcome, and
 * every outcome carries the id of the decode message it answers, so the parent can drop an answer that is not for the resource it
 * is waiting on.
 */
import { depotHash } from "../depot-path";
import { NativeArchivePool } from "./archive-reader";
import type { Decompress } from "./kark";
import { decodeFromPool, type NativeDecodeOptions, type WorkerDecodeMessage, type WorkerInit, type WorkerReply } from "./native-decode";

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
  const reply = (message: WorkerReply) => scope.postMessage(message);
  scope.addEventListener("message", event => {
    const message = event.data as WorkerInit | WorkerDecodeMessage;
    if (message.type === "init") {
      init(message).then(() => reply({ type: "ready" }), error => reply({ type: "init-failed", message: (error as Error).message }));
      return;
    }
    if (message.type === "decode") {
      const outcome = state ? decodeFromPool(state.pool, state.decompress, message.request, state.options, depotHash)
        : { ok: false as const, kind: "internal" as const, message: "The native decoder worker was not initialised." };
      reply({ type: "outcome", id: message.id, outcome });
    }
  });
}
