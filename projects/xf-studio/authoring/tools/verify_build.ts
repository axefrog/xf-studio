// CLI for the independent TypeScript package verifier (src/mod-verifier).
// Verifies one intermediate build and writes <build>/verification.json (or --report).
// The verifier unbundles, serializes and exports with its own WolvenKit calls in an empty
// work directory (default <build>/verify); the game folder is only passed to WolvenKit's
// export command. Plate inputs default to the build record's; --morph-targets is the
// plate recipe's count. Never installs anything. Exit code 1 on any failed check.
//
//   bun tools/verify_build.ts --build <dir> --wolvenkit <WolvenKit.CLI.exe> --gamepath <game>
//     [--work-dir <dir>] [--morph-targets <n>] [--report <file>]
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyBuild, VerificationError } from "../src/mod-verifier/verify-build";
import { createWolvenKitVerifierTools } from "../src/verifier-wolvenkit";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const build = option("--build"), wolvenkit = option("--wolvenkit"), gamepath = option("--gamepath");
const morphTargets = option("--morph-targets");
if (!build || !wolvenkit || !gamepath || (morphTargets !== undefined && !/^\d+$/.test(morphTargets))) {
  console.error("Usage: bun tools/verify_build.ts --build <dir> --wolvenkit <WolvenKit.CLI.exe> --gamepath <game> [--work-dir <dir>] [--morph-targets <n>] [--report <file>]");
  process.exit(2);
}
try {
  const report = verifyBuild({ build, tools: createWolvenKitVerifierTools(resolve(wolvenkit), resolve(gamepath)), workDir: option("--work-dir"),
    morphTargets: morphTargets === undefined ? undefined : Number(morphTargets) });
  writeFileSync(resolve(option("--report") ?? join(build, "verification.json")), JSON.stringify(report, null, 2) + "\n", "utf8");
  const { resolvedDynamicPaths, decodedPixelChecks, limits, ...brief } = report;
  void resolvedDynamicPaths; void decodedPixelChecks; void limits;
  console.log(JSON.stringify(brief, null, 2));
} catch (error) {
  console.error(`Verification failed: ${error instanceof VerificationError || error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
