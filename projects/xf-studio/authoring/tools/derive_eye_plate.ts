// Derive (or reuse) the built-in expanded eye plate from an installed game into a private cache.
// Build does this automatically; this entry exists for developers, tests and diagnostics.
import { isAbsolute, resolve } from "node:path";
import { EyePlateError, ensureEyePlate } from "../src/eye-plate-service";
import { createWolvenKitEyePlateTools } from "../src/eye-plate-wolvenkit";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const [game, wolvenkit, cache] = ["--game", "--wolvenkit", "--cache"].map(name => args.get(name));
if (!game || !wolvenkit || !cache || !isAbsolute(cache))
  throw Error("Usage: bun tools/derive_eye_plate.ts --game PATH_TO_GAME --wolvenkit PATH_TO_WolvenKit.CLI.exe --cache ABSOLUTE_PRIVATE_DIR");
const started = performance.now();
try {
  const result = await ensureEyePlate({ gameRoot: resolve(game), cacheRoot: resolve(cache), tools: createWolvenKitEyePlateTools(resolve(wolvenkit)),
    progress: message => console.error(message) });
  console.log(JSON.stringify({ directory: result.directory, reused: result.reused, seconds: +((performance.now() - started) / 1000).toFixed(1),
    source: result.manifest.source, files: result.manifest.files, verification: result.manifest.verification }, null, 2));
} catch (error) {
  if (!(error instanceof EyePlateError)) throw error;
  console.error(`${error.code}: ${error.message}\n${error.detail}`);
  process.exit(1);
}
