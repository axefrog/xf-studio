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
 *   already exists in the depot is rejected; copies are settled before links);
 * - `localization.onscreens`: Localization/Config.cpp (a map of language code → path or list, whose first language is
 *   the fallback; a bare path or list means English) and Extension.cpp Configure (a unit with `extend` appends its paths
 *   to the named unit, the `.xl` file name, and is dropped).
 * - `factories`: FactoryIndex/Config.cpp and Extension.cpp Configure (a path or list; each existing factory is loaded after the game's own);
 * - `player.bodyTypes`: PuppetState/Config.cpp (a name or list; Configure registers each as the body tag `Body:<name>`, which the player
 *   entity's tags or components carry when that body is installed: `GetBodyType`);
 * - `overrides.tags`: Garment/Config.cpp `GarmentOverrideConfig::LoadYAML` (tag → component name or prefix → `{hide|show: chunks | mask}`,
 *   a chunk list, or a numeric mask) and ChunkMask.hpp (a hide list keeps every other chunk; `hide: 0` hides the whole component).
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
/** One `.xl` file's `localization.onscreens` declaration (ArchiveXL's config unit is named by the file name). */
export interface XlLocalization {
  readonly name: string;
  readonly declaredBy: string;
  /** Language code → onscreens `.json` depot paths, in declaration order. */
  readonly onscreens: ReadonlyMap<string, readonly string[]>;
  /** The first language declared; its texts fill in keys the player's language lacks. */
  readonly fallback: string | null;
}
/** ArchiveXL's known language codes (Localization/Language.cpp `IsKnown`). */
export const XL_LANGUAGES: readonly string[] = ["ar-ar", "cz-cz", "de-de", "en-us", "es-es", "es-mx", "fr-fr", "hu-hu", "it-it",
  "jp-jp", "kr-kr", "pl-pl", "pt-br", "ru-ru", "th-th", "tr-tr", "ua-ua", "zh-cn", "zh-tw"];

/**
 * One `overrides.tags` rule for one component name or prefix: `hide` is ANDed into the component's chunk mask, `show` ORed in
 * (Garment ChunkMask: a hide list becomes the mask of every other chunk; a bare number is a hiding mask as written).
 */
export interface XlTagRule { readonly component: string; readonly hide: bigint | null; readonly show: bigint | null; readonly declaredBy: string }

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
  /** Text declarations in load order, `extend` units already folded into their targets. */
  readonly localization: readonly XlLocalization[];
  /** Item factories (`.csv`) `.xl` files add, in load order (existence is checked by the consumer, as FactoryIndex does). */
  readonly factories: readonly { readonly path: string; readonly declaredBy: string }[];
  /** Visual tag → chunk-mask rules, every file's in load order (ArchiveXL's bundled `VisualTags.xl` among them). */
  readonly tagRules: ReadonlyMap<string, readonly XlTagRule[]>;
  /** Body types body mods declare (`player.bodyTypes`), in load order; the player entity names the one installed (`Body:<name>`). */
  readonly bodyTypes: readonly { readonly name: string; readonly declaredBy: string }[];
  readonly issues: readonly string[];
}

const ALL_CHUNKS = (1n << 64n) - 1n;
/** A chunk list as ArchiveXL's `ChunkMask(set, chunks)` builds it: the chunks' bits, inverted for hiding (`1 << chunk` on a 32-bit int). */
function chunkBits(chunks: readonly number[]): bigint {
  let bits = 0n;
  for (const chunk of chunks) if (Number.isInteger(chunk) && chunk >= 0 && chunk < 32) bits |= 1n << BigInt(chunk);
  return bits;
}
/** Parse one `overrides.tags` component entry into a rule, or null when it is malformed. */
export function tagRuleOf(component: string, value: unknown, declaredBy: string): XlTagRule | null {
  const numbers = (x: unknown) => Array.isArray(x) && x.every(n => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255) ? x as number[] : null;
  const mask = (x: unknown): bigint | null => {
    if (typeof x === "number" && Number.isInteger(x) && x >= 0) return BigInt(x) & ALL_CHUNKS;
    if (typeof x === "string" && /^(0x[0-9a-f]{1,16}|[0-9]{1,20})$/i.test(x.trim())) { const n = BigInt(x.trim()); return n <= ALL_CHUNKS ? n : null; }
    return null;
  };
  if (isMap(value)) {
    for (const op of ["hide", "show"] as const) {
      if (value[op] === undefined) continue;
      const list = numbers(value[op]), bits = list ? chunkBits(list) : mask(value[op]);
      if (bits === null) return null;
      // A hide list keeps every other chunk (an empty list, a zero mask, hides them all, as `ChunkMask::Set` leaves it); a number is the mask as written.
      if (op === "hide") return { component, hide: list ? ~bits & ALL_CHUNKS & (bits ? ALL_CHUNKS : 0n) : bits, show: null, declaredBy };
      return { component, hide: null, show: bits, declaredBy };
    }
    return null;
  }
  const list = numbers(value);
  if (list) { const bits = chunkBits(list); return { component, hide: bits ? ~bits & ALL_CHUNKS : 0n, show: null, declaredBy }; }
  const bits = mask(value);
  return bits === null ? null : { component, hide: bits, show: null, declaredBy };
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
  const localization: { name: string; declaredBy: string; onscreens: Map<string, string[]>; fallback: string | null; extend: string | null }[] = [];
  const factories: { path: string; declaredBy: string }[] = [];
  const tagRules = new Map<string, XlTagRule[]>();
  const bodyTypes: { name: string; declaredBy: string }[] = [];

  for (const { id, document } of documents) {
    if (!isMap(document)) continue;
    if (isMap(document.player)) for (const name of list(document.player.bodyTypes)) bodyTypes.push({ name, declaredBy: id });
    if (isMap(document.localization)) {
      const unit = { name: id.split(/[\\/]/).pop()!, declaredBy: id, onscreens: new Map<string, string[]>(), fallback: null as string | null,
        extend: scalar(document.localization.extend) };
      const node = document.localization.onscreens;
      const add = (language: string, value: unknown) => {
        const paths = list(value);
        if (!paths.length) return;
        unit.onscreens.set(language, paths);
        unit.fallback ??= language;
      };
      if (isMap(node)) for (const [language, value] of Object.entries(node)) {
        if (!XL_LANGUAGES.includes(language)) { issues.push(`${id}: unknown language code "${language}".`); continue; }
        add(language, value);
      } else if (node !== undefined) add("en-us", node);
      if (unit.onscreens.size || unit.extend) localization.push(unit);
    }
    for (const path of list(document.factories)) { known(path); factories.push({ path, declaredBy: id }); }
    const overrides = document.overrides;
    if (isMap(overrides) && overrides.tags !== undefined) {
      if (!isMap(overrides.tags)) issues.push(`${id}: overrides.tags must be a map of tags.`);
      else for (const [tag, components] of Object.entries(overrides.tags)) {
        if (!isMap(components)) { issues.push(`${id}: overrides.tags.${tag} must be a map of components.`); continue; }
        const rules = tagRules.get(tag) ?? [];
        for (const [component, value] of Object.entries(components)) {
          const rule = tagRuleOf(component, value, id);
          if (rule) rules.push(rule); else issues.push(`${id}: overrides.tags.${tag}.${component} is not a chunk rule.`);
        }
        if (rules.length) tagRules.set(tag, rules);
      }
    }
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
  // Localization Configure: an `extend` unit appends its paths to the named unit (by file name) and is removed.
  for (const unit of localization) {
    if (!unit.extend) continue;
    const target = localization.find(other => other.name === unit.extend && !other.extend);
    if (target) for (const [language, extra] of unit.onscreens) target.onscreens.set(language, [...(target.onscreens.get(language) ?? []), ...extra]);
  }
  const texts: XlLocalization[] = localization.filter(unit => !unit.extend && unit.onscreens.size)
    .map(({ name, declaredBy, onscreens, fallback }) => ({ name, declaredBy, onscreens, fallback }));
  return { customizations: { female, male }, scopes, fixes, patches, copies, links, paths, localization: texts, factories, tagRules, bodyTypes, issues };
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
  // ArchiveXL uses std::sort by `order`. Keeping declaration order among equal values assumes an MSVC build,
  // whose std::sort insertion-sorts ranges of up to 32 elements [hypothesis]. Array.prototype.sort is stable.
  for (const list of patchesByTarget.values()) list.sort((a, b) => a.order - b.order);
  return { copies, links, patchesByTarget, patchSources, rejected };
}

/** ResourcePatch PatchInstance::Modifies. */
export const patchModifies = (patch: XlPatch, prop: string, overwrite?: boolean) =>
  overwrite === undefined ? patch.props.size === 0 || patch.props.has(prop) : (!overwrite && patch.props.size === 0) || patch.props.has(prop);
