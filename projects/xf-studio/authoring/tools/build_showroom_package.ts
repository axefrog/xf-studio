// Build XF Finish Showroom from an XF Studio collection: a separate test mod of mannequin heads, one per preset, each wearing
// that preset's eye plate on a pedestal, plus creator-style light rigs, for the runtime bridge's showroom.* commands. The
// presets' plates and textures come from the eye-makeup pipeline unchanged (its Check, compile and independent verifiers);
// the showroom's own verifier then checks the archive. Never installs anything: the verified folder goes to the ignored dist/.
//
//   bun tools/build_showroom_package.ts --collection <file> --plate <dir> [--plate-manifest <file>] [--diagnostics]
//     [--wolvenkit <WolvenKit.CLI.exe>] [--gamepath <game>] [--skin 01_ca_pale] [--eyes gradient_brown]
//     [--build-root <dir>] [--dist-root <dir>]
//
// --plate/--plate-manifest: the prepared eye plate (the eye-plate cache's resources folder and its plate-manifest.json).
// --diagnostics: honour a prepared collection's diagnostic knobs (the finish and Glitter boards).
// --skin: the head's tone and type appearance (default 01_ca_pale, the untinted albedo); --eyes: an eye gradient.
import { resolve } from "node:path";
import { buildShowroom } from "../src/showroom/build";
import { EYE_PLATE_PREREQUISITE } from "../src/features/eye-makeup";
import { STUDIO_EXPORTERS } from "../src/compose/exporters";
import { createWolvenKitPackageTools } from "../src/package-build-wolvenkit";
import { createWolvenKitVerifierTools } from "../src/verifier-wolvenkit";

const app = resolve(import.meta.dir, "..");
const project = resolve(app, "..");
const valueOptions = ["--collection", "--plate", "--plate-manifest", "--wolvenkit", "--gamepath", "--skin", "--eyes", "--build-root", "--dist-root"];

function parseArgs(argv: string[]) {
  const values: Record<string, string> = {};
  let diagnostics = false;
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i]!;
    if (name === "--diagnostics") diagnostics = true;
    else if (valueOptions.includes(name) && i + 1 < argv.length) values[name] = argv[++i]!;
    else throw Error(`Unsupported argument: ${name}`);
  }
  for (const required of ["--collection", "--plate"]) if (!values[required]) throw Error(`${required} is required.`);
  return { values, diagnostics };
}

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => controller.abort());
try {
  const { values, diagnostics } = parseArgs(process.argv.slice(2));
  const wolvenkit = values["--wolvenkit"] ?? process.env.XFS_PACKAGE_WOLVENKIT ?? "";
  const gamepath = values["--gamepath"] ?? process.env.XFS_PACKAGE_GAMEPATH ?? "";
  if (!wolvenkit || !gamepath) throw Error("Give --wolvenkit and --gamepath (or XFS_PACKAGE_WOLVENKIT and XFS_PACKAGE_GAMEPATH).");
  const { manifest, package: folder } = await buildShowroom({
    collection: values["--collection"]!, exporters: STUDIO_EXPORTERS, diagnostics,
    prerequisites: { [EYE_PLATE_PREREQUISITE]: { directory: values["--plate"], ...(values["--plate-manifest"] ? { manifest: values["--plate-manifest"] } : {}) } },
    wolvenkit, gamepath, appRoot: app,
    buildRoot: values["--build-root"] ?? resolve(project, "build", "showroom"),
    distRoot: values["--dist-root"] ?? resolve(project, "dist"),
    ...(values["--skin"] ? { skin: values["--skin"] } : {}), ...(values["--eyes"] ? { eyes: values["--eyes"] } : {}),
    signal: controller.signal, log: line => console.log(line),
    tools: (cli, cwd, signal) => createWolvenKitPackageTools(cli, { cwd, signal }),
    verifierTools: createWolvenKitVerifierTools,
  });
  console.log(JSON.stringify({ package: folder, modName: manifest.modName, archive: manifest.archive, sha256: manifest.files[0]!.sha256,
    pieces: manifest.pieces.map(p => p.name), rigs: Object.fromEntries(Object.entries(manifest.rigs).map(([k, v]) => [k, v.lights.length])),
    installed: false, gameRenderingVerified: false }, null, 2));
} catch (error) {
  const detail = typeof (error as { detail?: unknown })?.detail === "string" ? `\nDetail: ${(error as { detail: string }).detail}` : "";
  console.error(`Showroom build failed: ${error instanceof Error ? error.message : String(error)}${detail}\nNothing was installed or promoted.`);
  process.exitCode = 1;
}
