// Build local, offline-verified XF mod packages from an XF Studio collection. Never installs them.
//
// CLI over the export host's builder (src/platform/export/product-builder.ts) with the composed exporters
// (src/compose/exporters.ts): one private candidate per product of the collection's package plan (one merged
// mod by default). Only a successful independent verification is promoted into the ignored project dist
// directory. Both hosts run this entry (desktop runs its bundled copy) as a bounded child process.
//
//   bun tools/build_collection_package.ts --collection <file> [--check] [--machine-result] [--diagnostics]
//     [--prerequisites <json file>] [--plate <dir> [--plate-manifest <file>]] [--wolvenkit <WolvenKit.CLI.exe> --gamepath <game>]
//     [--app-root <dir>] [--build-root <dir>] [--dist-root <dir>] [--output-root <dir>]
//
// --prerequisites names a JSON file of host prerequisite values by ID (the hosts write it); --plate and
// --plate-manifest are a developer's shorthand for eye makeup's plate prerequisite. Check with a prepared plate's
// manifest also omits presets that never reach that plate; Build always plans on the plate it packages.
//
// --diagnostics honours a prepared collection's diagnostic export knobs (plate lifts, surface overrides, head UV, the
// Glitter route) to build an in-game test candidate; without it such a collection is refused. The hosts never pass it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runProductCommand } from "../src/platform/export/product-builder";
import { ExportRefusal, PrerequisiteStale } from "../src/platform/api";
import { STUDIO_EXPORTERS } from "../src/compose/exporters";
import { EYE_PLATE_PREREQUISITE } from "../src/features/eye-makeup";
import { createWolvenKitPackageTools } from "../src/package-build-wolvenkit";
import { createWolvenKitVerifierTools } from "../src/verifier-wolvenkit";

const app = resolve(import.meta.dir, "..");
const project = resolve(app, "..");
const valueOptions = ["--collection", "--prerequisites", "--plate", "--plate-manifest", "--wolvenkit", "--gamepath", "--app-root",
  "--build-root", "--dist-root", "--output-root"] as const;
const flagOptions = ["--check", "--machine-result", "--diagnostics"] as const;

function parseArgs(argv: string[]) {
  const values: Record<string, string> = {}, flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if ((flagOptions as readonly string[]).includes(name)) flags.add(name);
    else if ((valueOptions as readonly string[]).includes(name) && i + 1 < argv.length) values[name] = argv[++i]; // Last wins.
    else throw new ExportRefusal("usage", `Unsupported argument: ${name}`);
  }
  if (!values["--collection"]) throw new ExportRefusal("usage", "--collection is required.");
  return { values, flags };
}

/** Host prerequisite values: the hosts' JSON file, or the developer's plate shorthand. */
function prerequisites(values: Record<string, string>): Record<string, unknown> {
  const given: Record<string, unknown> = values["--prerequisites"]
    ? JSON.parse(readFileSync(values["--prerequisites"], "utf8").replace(/^﻿/, "")) : {};
  if (!given || typeof given !== "object" || Array.isArray(given)) throw new ExportRefusal("usage", "--prerequisites must name a JSON object.");
  if (values["--plate"] || values["--plate-manifest"])
    given[EYE_PLATE_PREREQUISITE] = { ...(values["--plate"] ? { directory: values["--plate"] } : {}),
      ...(values["--plate-manifest"] ? { manifest: values["--plate-manifest"] } : {}) };
  return given;
}

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => controller.abort());
let machine = process.argv.includes("--machine-result");
try {
  const { values, flags } = parseArgs(process.argv.slice(2));
  machine = flags.has("--machine-result");
  // In the source tree the code root is the authoring directory; the desktop bundle passes --app-root.
  // Build and dist default to the project's ignored folders.
  const result = await runProductCommand({
    exporters: STUDIO_EXPORTERS,
    collection: values["--collection"], check: flags.has("--check"), diagnostics: flags.has("--diagnostics"),
    prerequisites: prerequisites(values),
    wolvenkit: values["--wolvenkit"], gamepath: values["--gamepath"],
    appRoot: values["--app-root"] ?? app,
    buildRoot: values["--build-root"] ?? resolve(project, "build"),
    distRoot: values["--dist-root"] ?? resolve(project, "dist"),
    outputRoot: values["--output-root"],
    signal: controller.signal,
    log: line => console.log(line),
    tools: (wolvenkit, cwd, signal) => createWolvenKitPackageTools(wolvenkit, { cwd, signal }),
    verifierTools: createWolvenKitVerifierTools,
  });
  console.log(machine ? "XFS_PACKAGE_RESULT=" + JSON.stringify(result) : JSON.stringify(result, null, 2));
} catch (error) {
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "package_build_failed";
  const message = error instanceof Error ? error.message : String(error);
  if (machine) console.error("XFS_PACKAGE_ERROR=" + JSON.stringify({ code, message,
    ...(error instanceof PrerequisiteStale ? { prerequisite: error.prerequisite } : {}) }));
  console.error(`Package build failed: ${message}\nNo package was installed or promoted.`);
  process.exitCode = 1;
}
