/**
 * Host adapter: what one prepared character depends on, kept on disk, so a later session can tell that a creator choice is ready
 * (every file its preparation needs is still in the caches, read from the same archive bytes) without preparing it again. The Character
 * panel's per-choice states come from here (choice-prefetch.ts).
 *
 * A manifest names, for one request on one launch route: every resource the preparation read (its depot hash, the archive entry it was
 * read from after ArchiveXL copies and links, and that archive), every export it served (kind, depot path, archive), the WolvenKit
 * identity and the identity of the route's ArchiveXL files. It **holds** when, on the installation opened now:
 * - WolvenKit and every `.xl` file are the same;
 * - each read still resolves to the same entry in the same archive, and the resolver's cache has it for that archive's current path,
 *   size and modification time (a changed archive has another cache key, so a mod updated in place is not ready);
 * - each export's archive still wins its path, and the exporter's cache has it for that archive's current identity.
 * Anything else (a mod installed, updated, removed or reordered so another archive wins; a cache file evicted or cleared) makes the
 * choice "not prepared" again, and preparing it reads only what changed. The caches themselves stay the authority: a manifest only
 * says whether a preparation would need WolvenKit.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MountedArchive } from "./archive-precedence";
import type { CharacterRequest } from "./character-detail-request";
import { isDecimalHash, refFromHash, refFromPath } from "./depot-path";
import { writeFileAtomic } from "./derived-cache";
import { canonicalJson } from "./eye-plate-recipe";
import { archiveExportSource, type ExportKind, type GameAssetExporter } from "./game-asset-export";
import type { Installation } from "./resolver-host";
import type { ResourceGraph } from "./resource-graph";

export const CHOICE_MANIFEST_SCHEMA = "xfs/choice-manifest-1" as const;
export type ChoiceManifest = {
  schema: typeof CHOICE_MANIFEST_SCHEMA;
  /** WolvenKit's identity (`wolvenKitIdentityKey`). */
  tool: string;
  /** The route's ArchiveXL files (`xlIdentity`). */
  xl: string;
  /** [depot hash read, archive entry hash, archive id or null when no archive provided it]. */
  reads: [string, string, string | null][];
  /** [kind, depot path, archive id]. */
  exports: [ExportKind, string, string][];
};

/** The manifest name of a request on a route (`route`: the route's identity and WolvenKit's). */
export const choiceKey = (route: string, request: CharacterRequest) =>
  createHash("sha256").update(route).update("\n").update(canonicalJson(request)).digest("hex").slice(0, 40);

/** The identity of a route's ArchiveXL files: each one's path and stamp as the installation read them. */
export function xlIdentity(installation: Pick<Installation, "watch">): string {
  const files = (installation.watch ?? []).filter(item => /\.xl$/i.test(item.path)).map(item => `${item.path.toLowerCase()}|${item.stamp}`).sort();
  return createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 32);
}

const EXPORT_KINDS = new Set<string>(["geometry", "textures", "masks"]);
const text = (value: unknown, max = 4096): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
/**
 * A manifest as written by `writeChoiceManifest`, or null: every entry is checked on read (PREV-101), so a damaged or hand-edited file
 * makes its choice "not prepared" instead of throwing later in `manifestProblem` (`refFromHash`, `refFromPath`).
 */
export function parseChoiceManifest(value: unknown): ChoiceManifest | null {
  const manifest = value as Partial<ChoiceManifest> | null;
  if (!manifest || typeof manifest !== "object" || manifest.schema !== CHOICE_MANIFEST_SCHEMA || !text(manifest.tool) || !text(manifest.xl)
    || !Array.isArray(manifest.reads) || !Array.isArray(manifest.exports)) return null;
  for (const read of manifest.reads as unknown[]) {
    if (!Array.isArray(read) || read.length !== 3) return null;
    const [hash, entry, archive] = read as unknown[];
    if (typeof hash !== "string" || !isDecimalHash(hash) || typeof entry !== "string" || !isDecimalHash(entry)) return null;
    if (archive !== null && !text(archive)) return null;
  }
  for (const item of manifest.exports as unknown[]) {
    if (!Array.isArray(item) || item.length !== 3) return null;
    const [kind, path, archive] = item as unknown[];
    if (typeof kind !== "string" || !EXPORT_KINDS.has(kind) || !text(path, 1024) || !text(archive)) return null;
  }
  return manifest as ChoiceManifest;
}
export function readChoiceManifest(dir: string, key: string): ChoiceManifest | null {
  const file = join(dir, `${key}.json`);
  if (!existsSync(file)) return null;
  try { return parseChoiceManifest(JSON.parse(readFileSync(file, "utf8"))); } catch { return null; }
}
export function writeChoiceManifest(dir: string, key: string, manifest: ChoiceManifest): void {
  try { mkdirSync(dir, { recursive: true }); writeFileAtomic(join(dir, `${key}.json`), JSON.stringify(manifest)); }
  catch { /* Advisory: the choice is checked by preparing it next time. */ }
}

/** A manifest of what a preparation read and exported, on the installation it used. */
export function manifestOf(graph: ResourceGraph, reads: Iterable<string>, exports: Iterable<[ExportKind, string, string]>, tool: string, xl: string): ChoiceManifest {
  const entries: ChoiceManifest["reads"] = [];
  for (const hash of new Set(reads)) {
    const { entry, lookup } = graph.locate(refFromHash(hash));
    entries.push([hash, entry.hash, lookup.winner?.id ?? null]);
  }
  const seen = new Set<string>(), unique: ChoiceManifest["exports"] = [];
  for (const [kind, path, archive] of exports) {
    const key = `${kind}|${path.toLowerCase()}|${archive}`;
    if (!seen.has(key)) { seen.add(key); unique.push([kind, path, archive]); }
  }
  return { schema: CHOICE_MANIFEST_SCHEMA, tool, xl, reads: entries, exports: unique };
}

export type ManifestCheck = {
  graph: ResourceGraph;
  fetcher: { isCached(archive: MountedArchive, hash: string): boolean };
  exporter: GameAssetExporter;
  gameRoot: string;
  tool: string;
  xl: string;
};
/** Why a manifest doesn't hold on the installation opened now (see the module comment), or null when it does. Reads no resource. */
export function manifestProblem(manifest: ChoiceManifest, check: ManifestCheck): string | null {
  if (manifest.tool !== check.tool) return "another WolvenKit";
  if (manifest.xl !== check.xl) return "the ArchiveXL files changed";
  if (!check.exporter.has) return "the exporter can't be asked";
  for (const [hash, entryHash, archive] of manifest.reads) {
    const { entry, lookup } = check.graph.locate(refFromHash(hash));
    if ((lookup.winner?.id ?? null) !== archive || entry.hash !== entryHash) return `another archive provides ${hash}`;
    if (lookup.winner && !check.fetcher.isCached(lookup.winner, entry.hash)) return `${hash} isn't in the resolver's cache for ${lookup.winner.name}`;
  }
  for (const [kind, path, archive] of manifest.exports) {
    const winner = check.graph.locate(refFromPath(path)).lookup.winner;
    if (winner?.id !== archive) return `another archive provides ${path}`;
    if (!check.exporter.has(kind, path, archiveExportSource(archive, check.gameRoot))) return `${path} isn't in the export cache for ${winner.name}`;
  }
  return null;
}
/** Whether a manifest holds on the installation opened now. */
export const manifestHolds = (manifest: ChoiceManifest, check: ManifestCheck): boolean => manifestProblem(manifest, check) === null;
