/** The tests' decode worker: the shared loop with the fixture's stand-in codecs, chosen by name. */
import type { Decompress } from "../../src/native/kark";
import { serveDecodes } from "../../src/native/native-decode-serve";
import { fakeDecompress, slowDecompress } from "./native-archive";

declare const self: Worker;
const CODECS: Record<string, Decompress> = { fakeDecompress, slowDecompress };

serveDecodes(self, message => {
  const source = message.decompressor;
  const codec = "test" in source ? CODECS[source.test] : undefined;
  if (!codec) throw new Error("Unknown test codec.");
  return codec;
});
