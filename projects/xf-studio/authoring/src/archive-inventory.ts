// Strict generated-resource gate before WolvenKit packs a Studio collection. Pure: no IO.
//
// TypeScript port of experiments/005-preset-collection/archive_inventory.py.
// WolvenKit's ArchiveWriter hashes a sanitized depot path and skips unsupported
// extensions. The generated tree is deliberately narrower: paths must already be
// canonical and must match the collection plan exactly, so sanitization cannot
// silently rename or omit a resource. The filesystem walk lives in
// archive-inventory-fs.ts.

export const GENERATED_EXTENSIONS: readonly string[] = [".app", ".inkcharcustomization", ".mesh", ".morphtarget", ".xbm"];

/** The plan fields this gate reads; a full collection plan satisfies it. */
export interface InventoryPlan {
  readonly mesh: string;
  readonly morph: string;
  readonly app: string;
  readonly customization: string;
  readonly presets: readonly { readonly textures: { readonly diffuse: string; readonly roughness: string; readonly metalness: string } }[];
}

export interface GeneratedFile {
  /** Relative, slash-separated depot path. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface InventoryEntry extends GeneratedFile {
  /** Decimal FNV-1a 64 of the backslash depot path, as recorded by the Python gate. */
  readonly depotPathHash64: string;
}

const SEGMENT = /^[a-z0-9_][a-z0-9_.-]*$/;
const quote = (value: unknown) => JSON.stringify(value) ?? String(value);

function suffix(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/** Validate a canonical generated path and return WolvenKit's backslash form. */
export function depotPath(value: unknown): string {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/"))
    throw new Error(`Noncanonical depot path: ${quote(value)}`);
  const parts = value.split("/");
  if (parts.some(part => part === "." || part === ".." || !SEGMENT.test(part) || part.endsWith(".")))
    throw new Error(`Noncanonical depot path: ${quote(value)}`);
  // ArchiveWriter interprets a leading decimal filename as a literal hash.
  if (/^\d+\./.test(parts[0])) throw new Error(`Archive hash-override filename is not generated: ${quote(value)}`);
  if (!GENERATED_EXTENSIONS.includes(suffix(value))) throw new Error(`Unsupported generated resource extension: ${quote(value)}`);
  return value.replaceAll("/", "\\");
}

const FNV_OFFSET = 14695981039346656037n, FNV_PRIME = 1099511628211n, MASK64 = (1n << 64n) - 1n;

/** FNV-1a 64 of WolvenKit's already-canonical backslash path, UTF-8 bytes. */
export function pathHash(value: string): bigint {
  let hashed = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(depotPath(value))) hashed = ((hashed ^ BigInt(byte)) * FNV_PRIME) & MASK64;
  return hashed;
}

/** The exact 4 + 3N resource paths a collection plan requires. */
export function expectedPaths(plan: InventoryPlan): Set<string> {
  const paths = [plan.mesh, plan.morph, plan.app, plan.customization];
  for (const preset of plan.presets) paths.push(preset.textures.diffuse, preset.textures.roughness, preset.textures.metalness);
  if (paths.length !== new Set(paths).size) throw new Error("Collection plan contains duplicate depot paths.");
  for (const path of paths) depotPath(path);
  return new Set(paths);
}

/** Return hashed generated files, sorted by path, only if the physical tree equals the plan. */
export function inventoryFromFiles(files: readonly GeneratedFile[], plan: InventoryPlan): InventoryEntry[] {
  const expected = expectedPaths(plan);
  const actual = new Map<string, InventoryEntry>(), hashes = new Map<bigint, string>();
  for (const file of files) {
    depotPath(file.path);
    const hashed = pathHash(file.path), prior = hashes.get(hashed);
    if (prior !== undefined) throw new Error(`Archive path hash collision: ${quote(prior)} and ${quote(file.path)}`);
    hashes.set(hashed, file.path);
    actual.set(file.path, { path: file.path, bytes: file.bytes, sha256: file.sha256, depotPathHash64: hashed.toString() });
  }
  const missing = [...expected].filter(path => !actual.has(path)).sort();
  const extra = [...actual.keys()].filter(path => !expected.has(path)).sort();
  if (missing.length || extra.length)
    throw new Error(`Generated archive resources differ from plan; missing=${quote(missing)}, extra=${quote(extra)}`);
  // Python sorts by code point; compare strings the same way rather than by locale.
  return [...actual.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map(path => actual.get(path)!);
}
