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
import { decodeFromPool, type NativeDecodeOptions, type WorkerCloseMessage, type WorkerDecodeMessage, type WorkerInit, type WorkerReply, type WorkerTextureMessage } from "./native-decode";
import { decodeTextureFromPool } from "./texture-decode";

export interface WorkerScope {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  /** Ends the worker (a worker's global `close`). */
  close?(): void;
}

/** A decompressor, with how to release what it loaded (the game's library) when the worker is told to close. */
export type OpenedDecompress = Decompress | { readonly decompress: Decompress; readonly close: () => void };

export function serveDecodes(scope: WorkerScope, openDecompress: (init: WorkerInit) => OpenedDecompress | Promise<OpenedDecompress>): void {
  let state: { pool: NativeArchivePool; decompress: Decompress; options: NativeDecodeOptions; release: () => void } | null = null;
  const init = async (message: WorkerInit) => {
    const opened = await openDecompress(message);
    const decompress = typeof opened === "function" ? opened : opened?.decompress;
    if (typeof decompress !== "function") throw new Error("The worker has no decompressor.");
    state = { pool: new NativeArchivePool(decompress, 64, message.limits), decompress, release: typeof opened === "function" ? () => {} : opened.close,
      options: { roots: new Set(message.roots), limits: message.limits, identity: message.identity } };
  };
  const reply = (message: WorkerReply, transfer?: Transferable[]) => transfer ? scope.postMessage(message, transfer) : scope.postMessage(message);
  scope.addEventListener("message", event => {
    const message = event.data as WorkerInit | WorkerDecodeMessage | WorkerTextureMessage | WorkerCloseMessage;
    if (message.type === "close") {
      // Idle: release the library (so a game update can replace it) and exit (NATIVE-42).
      const current = state;
      state = null;
      try { current?.pool.close(); current?.release(); } finally { scope.close?.(); }
      return;
    }
    if (message.type === "init") {
      init(message).then(() => reply({ type: "ready" }), error => reply({ type: "init-failed", message: (error as Error).message }));
      return;
    }
    if (message.type === "decode") {
      const outcome = state ? decodeFromPool(state.pool, state.decompress, message.request, state.options, depotHash)
        : { ok: false as const, kind: "internal" as const, message: "The native decoder worker was not initialised." };
      reply({ type: "outcome", id: message.id, outcome });
    }
    if (message.type === "texture") {
      const current = state;
      const decoding = current ? decodeTextureFromPool(current.pool, current.decompress, message.request)
        : Promise.resolve({ ok: false as const, kind: "internal" as const, message: "The native decoder worker was not initialised." });
      void decoding.then(outcome => {
        // The PNG's buffer moves to the host instead of being copied (a 4096² map's PNG is ten MB or more).
        const png = outcome.ok ? outcome.texture.png : null;
        reply({ type: "outcome", id: message.id, outcome }, png && png.byteOffset === 0 && png.byteLength === png.buffer.byteLength ? [png.buffer as ArrayBuffer] : undefined);
        // A texture leaves tens of MB of garbage (the resource and its texture data): ask for a collection before the next one.
        (globalThis as { Bun?: { gc?: (force: boolean) => void } }).Bun?.gc?.(false);
      });
    }
  });
}
