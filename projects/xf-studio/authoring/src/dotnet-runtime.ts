import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Which .NET runtime a framework-dependent program needs, and whether this computer has it.
 * The rules follow the .NET host's own: the program's `<name>.runtimeconfig.json` names the
 * shared frameworks and roll-forward policy; the apphost looks for them under DOTNET_ROOT_X64 or
 * DOTNET_ROOT (exclusively, when set), else the registered install location, else
 * `%ProgramFiles%\dotnet`. Nothing is installed or changed here.
 * [source: learn.microsoft.com/dotnet/core/versions/selection; dotnet/runtime docs/design/features/host-probing]
 */
export type FrameworkReference = { name: string; version: string };
export type RollForward = "LatestPatch" | "Minor" | "LatestMinor" | "Major" | "LatestMajor" | "Disable";
export type RuntimeRequirement = { frameworks: FrameworkReference[]; rollForward: RollForward };
export type DotNetInstall = {
  /** The folder the apphost would use, or null when none exists. */
  root: string | null;
  source: "DOTNET_ROOT_X64" | "DOTNET_ROOT" | "registry" | "default" | null;
  /** Installed shared framework versions by framework name. */
  frameworks: Record<string, string[]>;
};

const ROLL_FORWARD: readonly RollForward[] = ["LatestPatch", "Minor", "LatestMinor", "Major", "LatestMajor", "Disable"];
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
type Parsed = { major: number; minor: number; patch: number; pre: string | null };
const parse = (value: string): Parsed | null => {
  const match = VERSION.exec(value);
  return match ? { major: +match[1]!, minor: +match[2]!, patch: +match[3]!, pre: match[4] ?? null } : null;
};
const compare = (a: Parsed, b: Parsed) => a.major - b.major || a.minor - b.minor || a.patch - b.patch;

/** Pure: the frameworks and roll-forward policy a `.runtimeconfig.json` declares; null for a self-contained app. */
export function parseRuntimeConfig(text: string): RuntimeRequirement | null {
  const options = (JSON.parse(text.replace(/^\uFEFF/, "")) as { runtimeOptions?: Record<string, unknown> }).runtimeOptions;
  if (!options) return null;
  const list = Array.isArray(options.frameworks) ? options.frameworks : options.framework ? [options.framework] : [];
  const frameworks = list.filter((item): item is FrameworkReference => !!item && typeof (item as FrameworkReference).name === "string" &&
    typeof (item as FrameworkReference).version === "string" && !!parse((item as FrameworkReference).version))
    .map(item => ({ name: item.name, version: item.version }));
  if (!frameworks.length) return null;
  const declared = options.rollForward;
  const rollForward = ROLL_FORWARD.includes(declared as RollForward) ? declared as RollForward : "Minor";
  return { frameworks, rollForward };
}

/** Pure: does one of the installed versions satisfy this reference under the roll-forward policy? */
export function frameworkSatisfied(reference: FrameworkReference, installed: readonly string[], rollForward: RollForward = "Minor"): boolean {
  const wanted = parse(reference.version);
  if (!wanted) return false;
  return installed.some(value => {
    const have = parse(value);
    // A release request never rolls onto a pre-release runtime.
    if (!have || (have.pre && !wanted.pre) || compare(have, wanted) < 0) return false;
    switch (rollForward) {
      case "Disable": return compare(have, wanted) === 0 && have.pre === wanted.pre;
      case "LatestPatch": return have.major === wanted.major && have.minor === wanted.minor;
      case "Minor": case "LatestMinor": return have.major === wanted.major;
      case "Major": case "LatestMajor": return true;
    }
  });
}

/** Plain name and Microsoft's official download links for a missing framework. */
export function runtimeGuidance(reference: FrameworkReference) {
  const major = parse(reference.version)?.major ?? 0;
  const kind = reference.name === "Microsoft.WindowsDesktop.App" ? { name: `.NET ${major} Desktop Runtime`, file: "windowsdesktop-runtime" }
    : reference.name === "Microsoft.AspNetCore.App" ? { name: `ASP.NET Core ${major} Runtime`, file: "aspnetcore-runtime" }
    : { name: `.NET ${major} Runtime`, file: "dotnet-runtime" };
  return {
    name: kind.name,
    /** Microsoft's evergreen link to the newest x64 installer of that major version (a signed Microsoft installer). */
    installerUrl: `https://aka.ms/dotnet/${major}.0/${kind.file}-win-x64.exe`,
    pageUrl: `https://dotnet.microsoft.com/download/dotnet/${major}.0`,
  };
}

export type DotNetPorts = {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  /** The registered x64 install location (32-bit registry view), or null. */
  registeredLocation(): string | null;
  isDirectory(path: string): boolean;
  list(path: string): string[];
};

const registryLocation = () => {
  try {
    const run = spawnSync("reg", ["query", "HKLM\\SOFTWARE\\dotnet\\Setup\\InstalledVersions\\x64", "/v", "InstallLocation", "/reg:32"],
      { encoding: "utf8", windowsHide: true, timeout: 5000 });
    return /^\s*InstallLocation\s+REG_SZ\s+(.+?)\s*$/m.exec(run.stdout ?? "")?.[1] ?? null;
  } catch { return null; }
};
export const hostDotNetPorts = (): DotNetPorts => ({
  env: process.env, platform: process.platform, registeredLocation: registryLocation,
  isDirectory: path => { try { return statSync(path).isDirectory(); } catch { return false; } },
  list: path => { try { return readdirSync(path); } catch { return []; } },
});

/** Where the x64 apphost would find .NET, and which shared frameworks are installed there. */
export function detectDotNet(ports: DotNetPorts = hostDotNetPorts()): DotNetInstall {
  const none: DotNetInstall = { root: null, source: null, frameworks: {} };
  if (ports.platform !== "win32") return none;
  const fromEnv = ports.env.DOTNET_ROOT_X64 ? ["DOTNET_ROOT_X64", ports.env.DOTNET_ROOT_X64] as const
    : ports.env.DOTNET_ROOT ? ["DOTNET_ROOT", ports.env.DOTNET_ROOT] as const : null;
  let root: string | null, source: DotNetInstall["source"];
  if (fromEnv) [source, root] = fromEnv; // The apphost uses the variable exclusively.
  else {
    const registered = ports.registeredLocation();
    if (registered && ports.isDirectory(registered)) { root = registered; source = "registry"; }
    else { root = join(ports.env.ProgramFiles || "C:\\Program Files", "dotnet"); source = "default"; }
  }
  if (!root || !ports.isDirectory(join(root, "host", "fxr")) || !ports.list(join(root, "host", "fxr")).length)
    return { ...none, root: root && ports.isDirectory(root) ? root : null, source };
  const frameworks: Record<string, string[]> = {};
  for (const name of ports.list(join(root, "shared")))
    frameworks[name] = ports.list(join(root, "shared", name)).filter(version => !!parse(version)).sort();
  return { root, source, frameworks };
}

/** The runtimeconfig beside a program, if it has one (framework-dependent .NET apps do). */
export function runtimeRequirementFor(executable: string): RuntimeRequirement | null {
  const config = join(dirname(executable), basename(executable).replace(/\.(exe|dll)$/i, "") + ".runtimeconfig.json");
  if (!existsSync(config)) return null;
  try { return parseRuntimeConfig(readFileSync(config, "utf8")); } catch { return null; }
}

/** The first framework the program needs that this computer lacks, or null when everything is there (or unknown). */
export function missingFramework(requirement: RuntimeRequirement | null, install: DotNetInstall): FrameworkReference | null {
  if (!requirement) return null;
  return requirement.frameworks.find(reference => !frameworkSatisfied(reference, install.frameworks[reference.name] ?? [], requirement.rollForward)) ?? null;
}
