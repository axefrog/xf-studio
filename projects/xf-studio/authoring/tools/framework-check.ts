/** Read-only framework version check and eye-makeup mod MO2 placement preview. Writes nothing.
 *
 * bun tools/framework-check.ts --game-root <absolute> [--mo2-root <absolute> --profile <name> [--profile <name> ...]]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkFrameworkVersions, frameworkModNames } from "../src/framework-versions";
import { createWindowsDetectionHost, readConfiguredMo2Instance } from "../src/install-detection-host";
import { planMo2Placement } from "../src/mo2-placement";
import { EYE_MAKEUP_MOD, eyeMakeupRelatedEntries } from "../src/mod-branding";

function usage(): never {
  throw Error("Usage: bun tools/framework-check.ts --game-root <absolute> [--mo2-root <absolute> --profile <name> ...]");
}
const args = process.argv.slice(2);
let gameRoot: string | null = null, mo2Root: string | null = null;
const profiles: string[] = [];
for (let i = 0; i < args.length; i += 2) {
  const value = args[i + 1];
  if (!value || value.startsWith("--")) usage();
  if (args[i] === "--game-root" && !gameRoot) gameRoot = value;
  else if (args[i] === "--mo2-root" && !mo2Root) mo2Root = value;
  else if (args[i] === "--profile") profiles.push(value);
  else usage();
}
if (!gameRoot || (!!mo2Root !== profiles.length > 0)) usage();

const port = createWindowsDetectionHost();
const summary = (route: ReturnType<typeof checkFrameworkVersions>["routes"][number]) => ({
  route: route.label, available: route.available, problem: route.problem, ready: route.ready,
  installed: Object.fromEntries(route.frameworks.map(row => [row.name, row.installed ? {
    version: row.version, source: row.versionSource, fileVersion: row.fileVersion, modManagerVersion: row.modManagerVersion,
    provider: row.provider?.name, ...(row.hiddenCopies.length ? { hiddenCopies: row.hiddenCopies } : {}),
    ...(row.notes.length ? { notes: row.notes } : {}) } : null])),
  guidance: route.verdicts.map(row => row.message ?? `${row.name}: OK (${row.installed} >= ${row.minimum})`),
});
const direct = checkFrameworkVersions(port, { gameRoot, launchRoute: "direct", mo2Root: null, mo2ProfileId: null });
const output: Record<string, unknown> = { direct: summary(direct.routes[0]!), profiles: {} };
for (const profile of profiles) {
  const route = checkFrameworkVersions(port, { gameRoot, launchRoute: "mo2", mo2Root, mo2ProfileId: profile })
    .routes.find(row => row.route === "mo2")!;
  const text = readFileSync(join(readConfiguredMo2Instance(mo2Root!).paths.profiles, profile, "modlist.txt"), "utf8");
  const options = { related: eyeMakeupRelatedEntries, frameworkMods: frameworkModNames(route) };
  // Also show where the rule would put the mod if the profile did not list it yet.
  const unlisted = text.split(/\r?\n/).filter(line => line.slice(1).trim().toLowerCase() !== EYE_MAKEUP_MOD.modName.toLowerCase())
    .join("\r\n");
  (output.profiles as Record<string, unknown>)[profile] = { ...summary(route),
    placement: planMo2Placement(text, EYE_MAKEUP_MOD.modName, options),
    placementIfUnlisted: planMo2Placement(unlisted, EYE_MAKEUP_MOD.modName, options) };
}
console.log(JSON.stringify(output, null, 2));
