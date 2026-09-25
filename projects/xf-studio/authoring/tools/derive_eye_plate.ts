// Derive (or reuse) the built-in expanded eye plate from an installed game into a private cache.
// Build does this automatically; this entry exists for developers, tests and diagnostics.
//
//   bun tools/derive_eye_plate.ts --game PATH_TO_GAME --wolvenkit PATH_TO_WolvenKit.CLI.exe --cache ABSOLUTE_PRIVATE_DIR
//     [--route direct|mo2 [--mo2 PATH_TO_MO2 --profile NAME] [--manual PATH_TO_MOD_ROOT]] [--head base-game]
//
// Without --route the plate is cut from the base game's content archives. With --route the head the game is
// expected to load for that route is resolved first (read-only towards the game and MO2), as Build does.
import { isAbsolute, join, resolve } from "node:path";
import { createInstalledHeadSource } from "../src/eye-plate-head-resolver";
import { EyePlateError, ensureEyePlate } from "../src/eye-plate-service";
import { createWolvenKitEyePlateTools } from "../src/eye-plate-wolvenkit";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const [game, wolvenkit, cache, route] = ["--game", "--wolvenkit", "--cache", "--route"].map(name => args.get(name));
if (!game || !wolvenkit || !cache || !isAbsolute(cache) || (route && route !== "direct" && route !== "mo2") ||
    (args.has("--head") && args.get("--head") !== "base-game"))
  throw Error("Usage: bun tools/derive_eye_plate.ts --game PATH_TO_GAME --wolvenkit PATH_TO_WolvenKit.CLI.exe --cache ABSOLUTE_PRIVATE_DIR " +
    "[--route direct|mo2 [--mo2 PATH_TO_MO2 --profile NAME] [--manual PATH_TO_MOD_ROOT]] [--head base-game]");
const started = performance.now();
try {
  const headSource = route ? createInstalledHeadSource({ gameRoot: resolve(game), launchRoute: route as "direct" | "mo2",
    mo2Root: args.has("--mo2") ? resolve(args.get("--mo2")!) : null, mo2ProfileId: args.get("--profile") ?? null,
    manualModRoot: args.has("--manual") ? resolve(args.get("--manual")!) : null, wolvenKitCli: resolve(wolvenkit) },
  join(resolve(cache), "resolver")) : undefined;
  const result = await ensureEyePlate({ gameRoot: resolve(game), cacheRoot: resolve(cache), tools: createWolvenKitEyePlateTools(resolve(wolvenkit)),
    headSource, headOverride: args.get("--head") === "base-game" ? "base-game" : undefined, progress: message => console.error(message) });
  console.log(JSON.stringify({ directory: result.directory, reused: result.reused, seconds: +((performance.now() - started) / 1000).toFixed(1),
    source: result.manifest.source, head: result.manifest.head, files: result.manifest.files, verification: result.manifest.verification,
    limits: result.manifest.limits }, null, 2));
} catch (error) {
  if (!(error instanceof EyePlateError)) throw error;
  console.error(`${error.code}: ${error.message}\n${error.detail}`);
  process.exit(1);
}
