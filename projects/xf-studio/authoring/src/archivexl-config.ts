/**
 * ArchiveXL `.xl` declarations, interpreted the way ArchiveXL configures itself. Pure: the adapter parses
 * YAML (anchors and aliases included) and passes plain objects in ArchiveXL's load order.
 *
 * Sources [source], ArchiveXL 1.27.3 commit 5474e34d:
 * - load order: ExtensionLoader::Configure reads the bundle directory first, then every Mod-scope archive
 *   group's directory recursively (the game's `archive/pc/mod`), in reverse depot-group order;
 * - `customizations`: Customization/Config.cpp (a path or list per body gender, in declaration order);
 * - `resource.scope` / `resource.fix`: ResourceMeta/Config.cpp and Extension.cpp (scopes merge across files
 *   and are flattened transitively; fixes merge `names`, `paths` and `context`, later files overwrite keys);
 * - `resource.patch`: ResourcePatch/Config.cpp and Configure (targets expanded through scopes, excludes
 *   removed, a patch source may not be a target, patches sorted by `order`);
 * - `resource.copy` / `resource.link`: ResourceLink/Config.cpp and Configure (a copy or link whose path
 *   already exists in the depot is rejected; copies are settled before links).
 * The installed ArchiveXL may be older than this source; each rule is still read from the installed files.
 */
import { depotHash } from "./depot-path";

export interface XlDocument {
  /** Private, stable identifier of the file (e.g. its virtual path). */
  readonly id: string;
  /** Parsed YAML. */
  readonly document: unknown;
}

export interface XlCustomization { readonly path: string; readonly hash: string; readonly declaredBy: string }
export interface XlFix {
  readonly names: ReadonlyMap<string, string>;
  /** old path hash → new path hash */
  readonly paths: ReadonlyMap<string, string>;
  readonly context: ReadonlyMap<string, string>;
  readonly declaredBy: readonly string[];
}
export interface XlPatch {
  readonly source: string;
  readonly sourcePath: string;
  readonly targets: ReadonlySet<string>;
  /** Empty means every property. */
  readonly props: ReadonlySet<string>;
  readonly order: number;
  readonly declaredBy: string;
}
export interface ArchiveXlConfig {
  readonly customizations: { readonly female: readonly XlCustomization[]; readonly male: readonly XlCustomization[] };
  /** Flattened scope → leaf members. */
  readonly scopes: ReadonlyMap<string, ReadonlySet<string>>;
  readonly fixes: ReadonlyMap<string, XlFix>;
  readonly patches: readonly XlPatch[];
  /** copy target hash → source hash (declared, before the depot check). */
  readonly copies: ReadonlyMap<string, { source: string; declaredBy: string }>;
  /** link (alias) hash → target hash (declared, before the depot check). */
  readonly links: ReadonlyMap<string, { target: string; declaredBy: string }>;
  /** hash → declared path text, for every path an `.xl` names. */
  readonly paths: ReadonlyMap<string, string>;
  readonly issues: readonly string[];
}

const isMap = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const scalar = (value: unknown): string | null =>
  typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : null;
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(scalar).filter((item): item is string => !!item) : scalar(value) ? [scalar(value)!] : [];

export function readArchiveXlConfig(documents: readonly XlDocument[]): ArchiveXlConfig {
  const female: XlCustomization[] = [], male: XlCustomization[] = [];
  const rawScopes = new Map<string, Set<string>>();
  const fixes = new Map<string, { names: Map<string, string>; paths: Map<string, string>; context: Map<string, string>; declaredBy: string[] }>();
  const rawPatches: { source: string; sourcePath: string; includes: string[]; excludes: string[]; props: Set<string>; order: number; declaredBy: string }[] = [];
  const copies = new Map<string, { source: string; declaredBy: string }>();
  const links = new Map<string, { target: string; declaredBy: string }>();
  const paths = new Map<string, string>();
  const issues: string[] = [];
  const known = (path: string) => { const hash = depotHash(path); if (hash !== "0") paths.set(hash, path); return hash; };

  for (const { id, document } of documents) {
    if (!isMap(document)) continue;
    const custom = document.customizations;
    if (custom !== undefined) {
      if (!isMap(custom)) issues.push(`${id}: customizations must be a map.`);
      else for (const [key, target] of [["female", female], ["male", male]] as [string, XlCustomization[]][])
        for (const path of list(custom[key])) target.push({ path, hash: known(path), declaredBy: id });
    }
    const resource = document.resource;
    if (!isMap(resource)) continue;
    if (isMap(resource.scope)) for (const [scope, members] of Object.entries(resource.scope)) {
      const scopeHash = known(scope);
      const set = rawScopes.get(scopeHash) ?? new Set<string>();
      for (const member of list(members)) { const hash = known(member); if (hash !== "0" && hash !== scopeHash) set.add(hash); }
      rawScopes.set(scopeHash, set);
    }
    if (isMap(resource.fix)) for (const [target, definition] of Object.entries(resource.fix)) {
      if (!isMap(definition)) continue;
      if ([definition.names, definition.paths, definition.context].some(node => node !== undefined && !isMap(node))) continue;
      const hash = known(target);
      const fix = fixes.get(hash) ?? { names: new Map<string, string>(), paths: new Map<string, string>(), context: new Map<string, string>(), declaredBy: [] as string[] };
      if (isMap(definition.names)) for (const [from, to] of Object.entries(definition.names)) if (scalar(to)) fix.names.set(from, scalar(to)!);
      if (isMap(definition.paths)) for (const [from, to] of Object.entries(definition.paths)) if (scalar(to)) fix.paths.set(known(from), known(scalar(to)!));
      if (isMap(definition.context)) for (const [name, value] of Object.entries(definition.context)) if (scalar(value)) fix.context.set(name, scalar(value)!);
      fix.declaredBy.push(id);
      fixes.set(hash, fix);
    }
    const patch = resource.patch;
    if (patch !== undefined) {
      const entries: [string | null, unknown][] = Array.isArray(patch)
        ? patch.map(entry => [isMap(entry) ? scalar(entry.source) : null, entry] as [string | null, unknown])
        : isMap(patch) ? Object.entries(patch) : [];
      if (!Array.isArray(patch) && !isMap(patch)) issues.push(`${id}: patch config must be a map or list.`);
      for (const [source, definition] of entries) {
        if (!source) { issues.push(`${id}: patch definition without a source path.`); continue; }
        const row = { source: known(source), sourcePath: source, includes: [] as string[], excludes: [] as string[],
          props: new Set<string>(), order: 0, declaredBy: id };
        // YAML `!exclude` tags are dropped by the adapter's parser; an explicit `exclude:` list is not ArchiveXL syntax.
        if (scalar(definition) || Array.isArray(definition)) row.includes.push(...list(definition).map(known));
        else if (isMap(definition)) {
          for (const prop of list(definition.props)) row.props.add(prop);
          row.includes.push(...list(definition.targets).map(known));
          const order = Number(scalar(definition.order));
          if (Number.isInteger(order)) row.order = order;
        } else { issues.push(`${id}: patch ${source} must be a map, list or path.`); continue; }
        rawPatches.push(row);
      }
    }
    if (isMap(resource.copy)) for (const [source, targets] of Object.entries(resource.copy))
      for (const target of list(targets)) copies.set(known(target), { source: known(source), declaredBy: id });
    if (isMap(resource.link)) for (const [target, sources] of Object.entries(resource.link)) {
      const targetHash = known(target);
      // Replicates ResourceLink/Config.cpp: the scalar form files the link under the alias key, which
      // Configure then reads with the roles swapped; the list form maps each alias to the target.
      if (!Array.isArray(sources) && scalar(sources)) links.set(targetHash, { target: known(scalar(sources)!), declaredBy: id });
      else for (const alias of list(sources)) links.set(known(alias), { target: targetHash, declaredBy: id });
    }
  }

  // ResourceMeta::Configure: replace any member that is itself a scope by that scope's members.
  const scopes = new Map<string, Set<string>>();
  for (const [scope, members] of rawScopes) {
    const leaves = new Set<string>(), seen = new Set<string>([scope]);
    const walk = (hash: string) => {
      if (seen.has(hash)) return; seen.add(hash);
      const nested = rawScopes.get(hash);
      if (nested) for (const member of nested) walk(member); else leaves.add(hash);
    };
    for (const member of members) walk(member);
    scopes.set(scope, leaves);
  }
  const expand = (hashes: readonly string[]) => new Set(hashes.flatMap(hash => [...(scopes.get(hash) ?? [hash])]));
  const patches: XlPatch[] = rawPatches.map(row => {
    const targets = expand(row.includes);
    for (const excluded of expand(row.excludes)) targets.delete(excluded);
    targets.delete(row.source);
    return { source: row.source, sourcePath: row.sourcePath, targets, props: row.props, order: row.order, declaredBy: row.declaredBy };
  });
  return { customizations: { female, male }, scopes, fixes, patches, copies, links, paths, issues };
}

export const inScope = (config: ArchiveXlConfig, scopePath: string, hash: string) =>
  config.scopes.get(depotHash(scopePath))?.has(hash) ?? false;

/** The ArchiveXL scope alias whose members get dynamic customization appearances. */
export const CUSTOMIZATION_SCOPE = "player_customization.app";

export interface DepotAdditions {
  /** copy path hash → source hash */
  readonly copies: ReadonlyMap<string, string>;
  /** link path hash → final target hash (chains followed, cycles dropped) */
  readonly links: ReadonlyMap<string, string>;
  /** Patches whose source exists and that do not target another patch source, sorted by order per target. */
  readonly patchesByTarget: ReadonlyMap<string, readonly XlPatch[]>;
  readonly patchSources: ReadonlySet<string>;
  readonly rejected: readonly { hash: string; reason: string }[];
}

/** Settle copies, links and patches against the depot, as ResourceLink/ResourcePatch Configure do. */
export function settleDepotAdditions(config: ArchiveXlConfig, exists: (hash: string) => boolean): DepotAdditions {
  const rejected: { hash: string; reason: string }[] = [];
  const copies = new Map<string, string>();
  for (const [copy, { source }] of config.copies) {
    for (const target of config.scopes.get(copy) ?? [copy]) {
      if (target === source) { rejected.push({ hash: target, reason: "copy points to itself" }); continue; }
      if (exists(target)) { rejected.push({ hash: target, reason: "copy is an existing resource" }); continue; }
      copies.set(target, source);
    }
  }
  const direct = new Map<string, string>();
  for (const [alias, { target }] of config.links) {
    for (const link of config.scopes.get(alias) ?? [alias]) {
      if (link === target) { rejected.push({ hash: link, reason: "link points to itself" }); continue; }
      if (exists(link) || copies.has(link)) { rejected.push({ hash: link, reason: "link is an existing resource" }); continue; }
      direct.set(link, target);
    }
  }
  const links = new Map<string, string>();
  for (const [link, first] of direct) {
    let target = first; const hops = new Set([link, first]); let cyclic = false;
    while (direct.has(target)) { target = direct.get(target)!; if (hops.has(target)) { cyclic = true; break; } hops.add(target); }
    if (cyclic) rejected.push({ hash: link, reason: "cyclic link" }); else links.set(link, target);
  }
  // ResourcePatch::Configure checks existence through the depot, which ArchiveXL's link hooks extend to copies and links.
  const valid = config.patches.filter(patch => {
    if (exists(patch.source) || copies.has(patch.source) || links.has(patch.source)) return true;
    rejected.push({ hash: patch.source, reason: "patch resource does not exist" }); return false;
  });
  const patchSources = new Set(valid.map(patch => patch.source));
  const patchesByTarget = new Map<string, XlPatch[]>();
  for (const patch of valid) for (const target of patch.targets) {
    if (patchSources.has(target)) continue;
    patchesByTarget.set(target, [...(patchesByTarget.get(target) ?? []), patch]);
  }
  // std::sort by `order`; MSVC sorts ranges of up to 32 elements by insertion sort, which keeps declaration
  // order among equal `order` values [source: MSVC STL _ISORT_MAX]. Array.prototype.sort is stable too.
  for (const list of patchesByTarget.values()) list.sort((a, b) => a.order - b.order);
  return { copies, links, patchesByTarget, patchSources, rejected };
}

/** ResourcePatch PatchInstance::Modifies. */
export const patchModifies = (patch: XlPatch, prop: string, overwrite?: boolean) =>
  overwrite === undefined ? patch.props.size === 0 || patch.props.has(prop) : (!overwrite && patch.props.size === 0) || patch.props.has(prop);
