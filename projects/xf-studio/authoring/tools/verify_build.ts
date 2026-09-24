// CLI for the independent TypeScript package verifier (src/mod-verifier).
// Verifies one intermediate build and writes <build>/verification.json (or --report).
// Never installs anything. Exit code 1 on any failed check.
//
//   bun tools/verify_build.ts --build <dir> --wolvenkit <WolvenKit.CLI.exe> [--unpack-dir <dir>] [--report <file>]
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyBuild, VerificationError } from "../src/mod-verifier/verify-build";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const build = option("--build"), wolvenkit = option("--wolvenkit");
if (!build || !wolvenkit) {
  console.error("Usage: bun tools/verify_build.ts --build <dir> --wolvenkit <WolvenKit.CLI.exe> [--unpack-dir <dir>] [--report <file>]");
  process.exit(2);
}
try {
  const report = verifyBuild({ build, wolvenkit, unpackDir: option("--unpack-dir") });
  writeFileSync(resolve(option("--report") ?? join(build, "verification.json")), JSON.stringify(report, null, 2) + "\n", "utf8");
  const { resolvedDynamicPaths, decodedPixelChecks, limits, ...brief } = report;
  void resolvedDynamicPaths; void decodedPixelChecks; void limits;
  console.log(JSON.stringify(brief, null, 2));
} catch (error) {
  console.error(`Verification failed: ${error instanceof VerificationError || error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
