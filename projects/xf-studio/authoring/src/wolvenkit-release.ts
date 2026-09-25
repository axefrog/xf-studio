import type { FrameworkReference } from "./dotnet-runtime";

/**
 * The WolvenKit CLI release XF Studio downloads for users who don't have one: pinned to one
 * official GitHub release asset by size and SHA-256, never redistributed by XF Studio. Pure data
 * and checks; the host service does the work.
 *
 * Why 9.0.1: it is the newest stable WolvenKit release (7 September 2026), the eye-plate, preview
 * and package pipelines are verified against it (a four-preset Build reproduced every archive
 * member of the 8.17.4 build byte for byte), and it runs on .NET 10, Microsoft's current
 * long-term-support runtime (supported until November 2028). 8.17.4 needs .NET 8, whose support
 * ends in November 2026.
 */
export type ManagedToolRelease = {
  id: string;
  name: string;
  version: string;
  /** Official release asset and page. */
  asset: string; url: string; releasePage: string;
  archiveBytes: number; archiveSha256: string;
  /** What a correct extraction contains. */
  files: number; installedBytes: number;
  executable: string; executableSha256: string;
  /** The managed entry point beside the launcher. */
  entryDll: string; entryDllSha256: string;
  publisher: string;
  licence: { spdx: string; name: string; url: string };
  /** The shared .NET framework the release's runtimeconfig names. */
  runtime: FrameworkReference;
  platform: NodeJS.Platform;
};

export const WOLVENKIT_RELEASE: ManagedToolRelease = {
  id: "wolvenkit-cli",
  name: "WolvenKit CLI",
  version: "9.0.1",
  asset: "WolvenKit.Console-9.0.1.zip",
  url: "https://github.com/WolvenKit/WolvenKit/releases/download/9.0.1/WolvenKit.Console-9.0.1.zip",
  releasePage: "https://github.com/WolvenKit/WolvenKit/releases/tag/9.0.1",
  archiveBytes: 45_266_234,
  archiveSha256: "364427384c0f4ebb6b157fa9abd01595258af1b7993c7b3a7edd2920f2016e92",
  files: 99,
  installedBytes: 93_614_085,
  executable: "WolvenKit.CLI.exe",
  executableSha256: "7ae9c308da2fe003220b55ce4ca9c122b51f0701a67db1618cca3ff4f7ff6738",
  entryDll: "WolvenKit.CLI.dll",
  entryDllSha256: "5be65c014812d82ec2a3dfc0340f91efe138b04b98fff80fabd8c92985c201bb",
  publisher: "the WolvenKit team",
  licence: { spdx: "GPL-3.0", name: "GNU General Public License v3.0", url: "https://github.com/WolvenKit/WolvenKit/blob/9.0.1/LICENSE" },
  runtime: { name: "Microsoft.NETCore.App", version: "10.0.0" },
  platform: "win32",
};

export const MANAGED_INSTALL_SCHEMA = "xfs/managed-tool-install-1" as const;
export type ManagedInstallFile = { name: string; bytes: number; sha256: string };
/** Written beside (not inside) the extracted folder, last, so its presence means a finished, verified install. */
export type ManagedInstallManifest = {
  schema: typeof MANAGED_INSTALL_SCHEMA;
  tool: string; version: string; archiveSha256: string; source: string;
  installedAt: string;
  executable: string;
  files: ManagedInstallFile[];
};

/** Pure: does an extraction match the pinned release? Returns a reason when it does not. */
export function extractionIssue(entries: readonly ManagedInstallFile[], release: ManagedToolRelease): string | null {
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (entries.length !== release.files) return `expected ${release.files} files, found ${entries.length}`;
  if (total !== release.installedBytes) return `expected ${release.installedBytes} bytes, found ${total}`;
  const hash = (name: string) => entries.find(entry => entry.name.toLowerCase() === name.toLowerCase())?.sha256;
  if (hash(release.executable) !== release.executableSha256) return `${release.executable} does not match the release`;
  if (hash(release.entryDll) !== release.entryDllSha256) return `${release.entryDll} does not match the release`;
  return null;
}

/** Pure, strict: a manifest for exactly this release, or null. */
export function parseInstallManifest(value: unknown, release: ManagedToolRelease): ManagedInstallManifest | null {
  const doc = value as ManagedInstallManifest;
  if (!doc || doc.schema !== MANAGED_INSTALL_SCHEMA || doc.tool !== release.id || doc.version !== release.version ||
      doc.archiveSha256 !== release.archiveSha256 || doc.executable !== release.executable || !Array.isArray(doc.files)) return null;
  const files = doc.files.filter(file => file && typeof file.name === "string" && Number.isSafeInteger(file.bytes) &&
    typeof file.sha256 === "string" && /^[0-9a-f]{64}$/.test(file.sha256) && !file.name.split("/").includes(".."));
  if (files.length !== doc.files.length || extractionIssue(files, release)) return null;
  return { ...doc, files };
}

/** "43.2 MB" style sizes for people (decimal megabytes, as download pages show them). */
export const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`;
