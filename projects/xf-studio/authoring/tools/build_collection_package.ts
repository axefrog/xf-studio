// Build a local, offline-verified eye-makeup mod package from XF Studio. Never installs it.
//
// CLI over src/package-build-service.ts. The mod and selector names come from the Studio's
// mod-branding module through the preflight summary and export plan. Only a successful
// independent verification is promoted into the ignored project dist directory. Both
// hosts run this entry (desktop runs its bundled copy) as a bounded child process.
//
//   bun tools/build_collection_package.ts --collection <file> [--check] [--machine-result]
//     [--plate <dir> [--plate-manifest <file>] --wolvenkit <WolvenKit.CLI.exe> --gamepath <game>]
//     [--app-root <dir>] [--build-root <dir>] [--dist-root <dir>] [--output-root <dir>]
import { resolve } from "node:path";
import { PackageBuildError, runPackageCommand } from "../src/package-build-service";

const app = resolve(import.meta.dir, "..");
const project = resolve(app, "..");
const valueOptions = ["--collection", "--plate", "--plate-manifest", "--wolvenkit", "--gamepath", "--app-root",
  "--build-root", "--dist-root", "--output-root"] as const;
const flagOptions = ["--check", "--machine-result"] as const;

function parseArgs(argv: string[]) {
  const values: Record<string, string> = {}, flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if ((flagOptions as readonly string[]).includes(name)) flags.add(name);
    else if ((valueOptions as readonly string[]).includes(name) && i + 1 < argv.length) values[name] = argv[++i]; // Last wins.
    else throw new PackageBuildError("usage", `Unsupported argument: ${name}`);
  }
  if (!values["--collection"]) throw new PackageBuildError("usage", "--collection is required.");
  return { values, flags };
}

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => controller.abort());
let machine = process.argv.includes("--machine-result");
try {
  const { values, flags } = parseArgs(process.argv.slice(2));
  machine = flags.has("--machine-result");
  // In the source tree the code root is the authoring directory; the desktop bundle passes --app-root.
  // Build and dist default to the project's ignored folders.
  const result = await runPackageCommand({
    collection: values["--collection"], check: flags.has("--check"),
    plate: values["--plate"], plateManifest: values["--plate-manifest"],
    wolvenkit: values["--wolvenkit"], gamepath: values["--gamepath"],
    appRoot: values["--app-root"] ?? app,
    buildRoot: values["--build-root"] ?? resolve(project, "build"),
    distRoot: values["--dist-root"] ?? resolve(project, "dist"),
    outputRoot: values["--output-root"],
    signal: controller.signal,
    log: line => console.log(line),
  });
  console.log(machine ? "XFS_PACKAGE_RESULT=" + JSON.stringify(result) : JSON.stringify(result, null, 2));
} catch (error) {
  const code = error instanceof PackageBuildError ? error.code : "package_build_failed";
  const message = error instanceof Error ? error.message : String(error);
  if (machine) console.error("XFS_PACKAGE_ERROR=" + JSON.stringify({ code, message }));
  console.error(`Package build failed: ${message}\nNo package was installed or promoted.`);
  process.exitCode = 1;
}
