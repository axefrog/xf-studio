/**
 * Pure interpretation of Vortex deployment manifests (knowledge/vortex.md). No filesystem, registry or process access;
 * the host adapter (vortex-host.ts) reads the files and passes their text here.
 *
 * Vortex deploys each enabled mod of the active profile from its staging folder into the game folder (hard links for
 * Cyberpunk 2077, whose extension declares `compatible: { symlinks: false }`), and records what it deployed in
 * `vortex.deployment.json` in each mod type's target folder: `vortex.deployment.<type>.json` for a named type
 * [source: Vortex v2.7.1 `mod_management/util/activationStore.ts` `saveActivation`]. The Cyberpunk extension registers
 * no mod types, so one manifest in the game folder lists everything [source: cyberpunk2077_ext_redux `src/index.ts`,
 * `registerModType` commented out]. Each entry names the one mod whose file won: mods are deployed in ascending
 * priority and a later mod's entry overwrites an earlier one's, so losers are not listed at all [source:
 * `LinkingDeployment.ts` `addModFiles`]. An empty deployment deletes the manifest instead of writing an empty list.
 *
 * The manifest is Vortex's own fallback record ("core functionality ... is designed to work cleanly even if the manifest
 * is deleted", `activationStore.ts` `getManifest`), so everything here is evidence about the last deployment, not about
 * what Vortex would deploy now or what the game loaded.
 */

export const VORTEX_MANIFEST_PREFIX = "vortex.deployment.";
/** Manifest file name for a mod type ("" is the default type) [source: activationStore.ts `saveActivation`]. */
export const vortexManifestName = (modType = "") => `vortex.deployment.${modType ? `${modType}.` : ""}json`;
/** The mod type a manifest file name belongs to, or null when the name is not a deployment manifest. */
export function vortexManifestModType(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (!lower.startsWith(VORTEX_MANIFEST_PREFIX) || !lower.endsWith(".json")) return null;
  const middle = fileName.slice(VORTEX_MANIFEST_PREFIX.length, -".json".length);
  // `vortex.deployment.<type>.json` (atomic-write leftovers end in `.tmp` and never get here).
  return /[\\/]/.test(middle) || middle.startsWith(".") || middle.endsWith(".") ? null : middle;
}

/** One deployed file [source: Vortex `types/IDeploymentMethod.ts` `IDeployedFile`]. */
export interface VortexDeployedFile {
  /** Path relative to the manifest's folder, as written (backslashes on Windows). */
  readonly relPath: string;
  /** Portable form of `relPath`: forward slashes, as in source discovery's virtual paths. */
  readonly virtualPath: string;
  /** The staging folder name of the mod whose file was deployed (its Vortex mod id). */
  readonly source: string;
  /** Mods merged into this file, when a merge produced it. */
  readonly merged: readonly string[];
  /** Output folder for games that deploy mods separately; empty or absent for Cyberpunk (`mergeMods: true`). */
  readonly target: string | null;
  /** The file's modification time (ms) when it was deployed. */
  readonly time: number;
}
export interface VortexManifest {
  readonly version: number;
  /** Vortex's installation id (`app.instanceId`). A manifest from another instance makes Vortex offer a purge. */
  readonly instance: string;
  /** e.g. `hardlink_activator`, `symlink_activator`, `move_activator`. Absent in manifests from old versions. */
  readonly deploymentMethod: string | null;
  readonly deploymentTime: number | null;
  /** The game's staging folder when the manifest was written (a private path). */
  readonly stagingPath: string | null;
  readonly gameId: string | null;
  /** The folder the manifest describes (a private path). */
  readonly targetPath: string | null;
  readonly files: readonly VortexDeployedFile[];
  /** Entries Vortex itself would drop when reading the file (`repairManifest`), and other oddities. */
  readonly issues: readonly string[];
}

const text = (value: unknown): string | null => typeof value === "string" && value.length > 0 ? value : null;
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
/** Portable path: forward slashes, no leading `./` or slash. Null when it escapes its folder. */
export function portableRelPath(relPath: string): string | null {
  const parts = relPath.replaceAll("\\", "/").split("/").filter(part => part !== "" && part !== ".");
  if (!parts.length || parts.some(part => part === "..") || /^[a-z]:$/i.test(parts[0]!)) return null;
  return parts.join("/");
}

/**
 * Parse a manifest's JSON text (a UTF-8 BOM is tolerated, as Vortex's `deBOM` does). Entries without `relPath`,
 * `source` or `time` are dropped as Vortex's `repairManifest` drops them, and reported. Throws on text that isn't a
 * manifest at all.
 */
export function parseVortexManifest(json: string): VortexManifest {
  const value: unknown = JSON.parse(json.replace(/^﻿/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("A Vortex deployment manifest must be a JSON object.");
  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.files)) throw Error("A Vortex deployment manifest must list its files.");
  const issues: string[] = [];
  const version = finite(root.version) ?? 1;
  if (version !== 1) issues.push(`Manifest version ${version} is newer than the version 1 format this reader knows.`);
  const files: VortexDeployedFile[] = [];
  root.files.forEach((entry, index) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
    const relPath = text(row?.relPath), source = text(row?.source), time = finite(row?.time);
    if (!row || relPath === null || source === null || time === null) {
      issues.push(`Entry ${index} lacks a path, source mod or time; Vortex ignores such entries.`); return;
    }
    const virtualPath = portableRelPath(relPath);
    if (virtualPath === null) { issues.push(`Entry ${index} has a path outside its folder; ignored.`); return; }
    files.push({ relPath, virtualPath, source, time, target: text(row.target),
      merged: Array.isArray(row.merged) ? row.merged.filter((item): item is string => typeof item === "string") : [] });
  });
  return { version, instance: typeof root.instance === "string" ? root.instance : "", deploymentMethod: text(root.deploymentMethod),
    deploymentTime: finite(root.deploymentTime), stagingPath: text(root.stagingPath), gameId: text(root.gameId),
    targetPath: text(root.targetPath), files, issues };
}

/** What Vortex's metadata says about a mod, when its state could be read (vortex-state.ts). */
export interface VortexModIdentity {
  /** The staging folder name, which is the Vortex mod id and the manifest's `source`. */
  readonly id: string;
  readonly name: string | null;
  readonly version: string | null;
  /** Nexus Mods ids, as recorded by Vortex for a download from Nexus. */
  readonly nexus: { readonly gameDomain: string | null; readonly modId: number | null; readonly fileId: number | null } | null;
  readonly source: string | null;
  /** Enabled in the active profile; null when unknown. */
  readonly enabled: boolean | null;
}

/** Where a game-folder file came from, according to Vortex. */
export interface VortexAttribution {
  readonly manager: "vortex";
  /** The Vortex mod id (staging folder name) whose file won the deployment. */
  readonly modId: string;
  /** Display name: the mod's name from Vortex state, else its staging folder name. */
  readonly label: string;
  readonly identity: VortexModIdentity | null;
  readonly merged: readonly string[];
  /** `deployed`: size and time as deployed. `changed`: modified after deployment (Vortex reports it as an external change). */
  readonly state: "deployed" | "changed";
  readonly deployedTimeMs: number;
  readonly manifest: string;
}

/** The files Vortex deployed into one game folder, by lower-cased virtual path. */
export interface VortexDeployment {
  /** Manifest file names read, with their mod types. */
  readonly manifests: readonly { readonly fileName: string; readonly modType: string; readonly manifest: VortexManifest }[];
  readonly byPath: ReadonlyMap<string, { readonly file: VortexDeployedFile; readonly manifest: string }>;
  readonly issues: readonly string[];
}

/**
 * Combine the game folder's manifests. Paths are compared without case, as on Windows. Only manifests whose files live
 * directly under the game folder (`targetPath` equal to it, or unknown) are meaningful to a game-relative lookup; the
 * caller passes only those.
 */
export function combineVortexManifests(manifests: readonly { readonly fileName: string; readonly manifest: VortexManifest }[]): VortexDeployment {
  const byPath = new Map<string, { file: VortexDeployedFile; manifest: string }>();
  const issues: string[] = [];
  const read = manifests.map(({ fileName, manifest }) => ({ fileName, modType: vortexManifestModType(fileName) ?? "", manifest }));
  for (const { fileName, manifest } of read) {
    for (const issue of manifest.issues) issues.push(`${fileName}: ${issue}`);
    for (const file of manifest.files) {
      const key = file.virtualPath.toLowerCase();
      const earlier = byPath.get(key);
      if (earlier) issues.push(`${file.virtualPath} is listed by both ${earlier.manifest} and ${fileName}.`);
      else byPath.set(key, { file, manifest: fileName });
    }
  }
  return { manifests: read, byPath, issues };
}

/** Tolerance for comparing a file's modification time with the manifest's (ms). Vortex's walker reports seconds. */
const TIME_TOLERANCE_MS = 2_000;

/** Attribute one game-folder file (by its portable path relative to the game folder) to the Vortex mod that deployed it. */
export function attributeVortexFile(deployment: VortexDeployment, virtualPath: string, modifiedMs: number,
  identities: ReadonlyMap<string, VortexModIdentity> = new Map()): VortexAttribution | null {
  const hit = deployment.byPath.get(virtualPath.replaceAll("\\", "/").toLowerCase());
  if (!hit) return null;
  const identity = identities.get(hit.file.source) ?? null;
  return { manager: "vortex", modId: hit.file.source, label: identity?.name ?? hit.file.source, identity, merged: hit.file.merged,
    state: Math.abs(modifiedMs - hit.file.time) <= TIME_TOLERANCE_MS ? "deployed" : "changed",
    deployedTimeMs: hit.file.time, manifest: hit.manifest };
}

/** A game-folder file as the direct route sees it. */
export interface GameFolderFile { readonly virtualPath: string; readonly modifiedMs: number }

/** How a direct-route scan relates to Vortex's last deployment. */
export interface VortexDeploymentReport {
  /** Files Vortex deployed and that are still present, by the mod that won them. */
  readonly attributed: readonly { readonly virtualPath: string; readonly attribution: VortexAttribution }[];
  /** Manifest entries (within the scanned areas) with no file on disk: deleted outside Vortex, or a failed deployment. */
  readonly missing: readonly { readonly virtualPath: string; readonly modId: string }[];
  /** Scanned files Vortex did not deploy: installed by hand, by another tool, or shipped with the game. */
  readonly unmanaged: readonly string[];
  /** Mods whose deployed files changed after deployment. */
  readonly changed: readonly string[];
  /** Deployed mods that Vortex state says are now disabled, or unknown to it: the deployment is out of date. */
  readonly stale: readonly { readonly modId: string; readonly reason: "disabled" | "not-installed" }[];
}

/**
 * Compare a scan of the game folder with the deployment. `scannedPrefixes` bounds the comparison to the folders the scan
 * walked (e.g. `archive/pc/`), so a manifest entry elsewhere is not reported missing. `identities` (from Vortex state)
 * adds names, Nexus ids and the stale-deployment check; without it, attribution uses staging folder names only.
 */
export function compareWithDeployment(deployment: VortexDeployment, files: readonly GameFolderFile[],
  scannedPrefixes: readonly string[], identities: ReadonlyMap<string, VortexModIdentity> | null = null): VortexDeploymentReport {
  const inScope = (path: string) => scannedPrefixes.some(prefix => path.toLowerCase().startsWith(prefix.toLowerCase()));
  const present = new Set<string>();
  const attributed: VortexDeploymentReport["attributed"][number][] = [];
  const unmanaged: string[] = [];
  for (const file of files) {
    present.add(file.virtualPath.toLowerCase());
    const attribution = attributeVortexFile(deployment, file.virtualPath, file.modifiedMs, identities ?? undefined);
    if (attribution) attributed.push({ virtualPath: file.virtualPath, attribution });
    else unmanaged.push(file.virtualPath);
  }
  const missing = [...deployment.byPath.values()].filter(({ file }) => inScope(file.virtualPath) && !present.has(file.virtualPath.toLowerCase()))
    .map(({ file }) => ({ virtualPath: file.virtualPath, modId: file.source }));
  const changed = [...new Set(attributed.filter(row => row.attribution.state === "changed").map(row => row.attribution.modId))].sort();
  const stale: VortexDeploymentReport["stale"][number][] = [];
  if (identities) for (const modId of new Set([...deployment.byPath.values()].map(({ file }) => file.source))) {
    const identity = identities.get(modId);
    if (!identity) stale.push({ modId, reason: "not-installed" });
    else if (identity.enabled === false) stale.push({ modId, reason: "disabled" });
  }
  return { attributed, missing, unmanaged: unmanaged.sort(), changed, stale: stale.sort((a, b) => a.modId.localeCompare(b.modId)) };
}
