import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import authoringPackage from "../package.json";
import hutchConfig from "./hutch.config";
import { INNO_SETUP } from "./inno-setup";

// The notices file and project licence ship inside the installed app (served
// to About) and beside each release. These checks keep the notices honest
// against what a build actually contains.

export const repositoryRoot = resolve(import.meta.dir, "../../../..");
export const noticesPath = resolve(import.meta.dir, "../../THIRD_PARTY_NOTICES.md");
export const licencePath = resolve(repositoryRoot, "LICENSE");
/** Published names inside the Studio view folder; About links to both. */
export const packagedNotices = "THIRD_PARTY_NOTICES.md";
export const packagedLicence = "LICENSE.txt";

export type NoticeFacts = Readonly<{
  /** File names under the packaged bundle's `bin/` folder. */
  binaries: readonly string[];
  bunVersion: string;
  electrobunVersion: string;
  threeVersion: string;
  /** The Inno Setup release whose setup runtime wraps the downloadable setup program. */
  innoSetupVersion: string;
}>;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every mismatch between the notices text and the built facts; empty when they agree. */
export function noticeIssues(text: string, facts: NoticeFacts): string[] {
  const issues: string[] = [];
  const row = (name: string, version: string) =>
    new RegExp(`^\\| \\[${escapeRegExp(name)}\\][^|\\n]*\\| ${escapeRegExp(version)} \\|`, "m").test(text);
  if (!row("Bun", facts.bunVersion)) issues.push(`Bun ${facts.bunVersion} is not the version listed.`);
  if (!row("Electrobun", facts.electrobunVersion)) issues.push(`Electrobun ${facts.electrobunVersion} is not the version listed.`);
  if (!row("three.js", facts.threeVersion)) issues.push(`three.js ${facts.threeVersion} is not the version listed.`);
  if (!row("Inno Setup", facts.innoSetupVersion)) issues.push(`Inno Setup ${facts.innoSetupVersion} is not the version listed.`);
  if (!text.includes(`bun-v${facts.bunVersion}`)) issues.push(`Bun's licence link does not point at bun-v${facts.bunVersion}.`);
  for (const name of facts.binaries)
    if (!text.includes(`\`bin/${name}\``)) issues.push(`Shipped program bin/${name} is not named.`);
  if (!text.includes("MicrosoftEdgeWebview2Setup.exe")) issues.push("The packaged WebView2 bootstrapper is not named.");
  for (const heading of ["### Bun (MIT)", "### Electrobun (MIT)", "### three.js (MIT)", "### Inno Setup License",
    "### GNU Lesser General Public License, version 2.1"])
    if (!text.includes(heading)) issues.push(`Missing licence text: ${heading.slice(4)}.`);
  return issues;
}

/** Versions this checkout builds with. The Bun toolchain comes from Hutch's lock written by the build. */
export function builtVersions(lockPath = resolve(import.meta.dir, ".hutch", "dependencies.lock")) {
  if (!existsSync(lockPath)) throw Error(`Cannot confirm the bundled Bun version: ${lockPath} is missing.`);
  const objects: any[] = JSON.parse(readFileSync(lockPath, "utf8")).objects ?? [];
  const bun = objects.find(item => item.type === "toolchain" && item.toolchain === "bun")?.version;
  if (typeof bun !== "string") throw Error("Hutch's dependency lock does not record the Bun toolchain.");
  return { bunVersion: bun, electrobunVersion: hutchConfig.electrobun.version,
    threeVersion: authoringPackage.dependencies.three, innoSetupVersion: INNO_SETUP.version };
}

/** The release refuses to go out without a project licence at the repository root. */
export function requireLicence(path = licencePath): void {
  if (!existsSync(path) || !readFileSync(path, "utf8").trim())
    throw Error("No LICENSE file at the repository root. Add the project licence before tagging or releasing; " +
      "the app, notices and release all refer to it.");
}
