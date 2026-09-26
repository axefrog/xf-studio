/**
 * Worker entry (host adapter) for `WorkerDecoder` (native-decode.ts): opens the game's Oodle library once, then decodes one
 * resource per message through the shared loop in native-decode-serve.ts.
 */
import { serveDecodes } from "./native-decode-serve";
import { loadGameOodle } from "./oodle";

declare const self: Worker;

serveDecodes(self, message => {
  const source = message.decompressor;
  if (!("gameRoot" in source)) throw new Error("This worker only decodes with the game's Oodle library.");
  const trusted = source.trustedSha256;
  // The parent already checked this library; the worker still holds and hashes the file itself, so a match is the same bytes.
  const oodle = loadGameOodle(source.gameRoot, trusted ? { verify: (_, sha256) => sha256 === trusted ? { trustedBy: "parent" } : { refused: "The Oodle library changed since it was checked." } } : {});
  // Released when the worker is told it has been idle, so the game's library isn't held while nothing is read (NATIVE-42).
  return { decompress: oodle.decompress, close: () => oodle.close() };
});
