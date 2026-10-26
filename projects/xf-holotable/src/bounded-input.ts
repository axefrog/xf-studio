import { LAYER_BOUNDS } from "./layers.ts";
/** Stop the source as soon as a chunk crosses the cap; never drain an oversized file or stdin. */
export async function readBatch(stream: ReadableStream<Uint8Array>, limit = LAYER_BOUNDS.bytes): Promise<string> {
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw Error("Batch exceeds 16 MB."); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
