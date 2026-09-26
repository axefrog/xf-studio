/**
 * Character-creator option resources (`.inkcharcustomization`): typed reading, ArchiveXL's merge of custom
 * resources (rule R4) and the step from a UI option state to appearance descriptors (rule R5). Pure.
 *
 * The merge replicates ArchiveXL 1.27.3 `Customization/Extension.cpp` [source]:
 * `FixCustomizationOptions` (lines 744–777) remaps base option `.app` paths and registers app overrides for
 * every definition; `MergeCustomEntries` (254–332) then, per custom resource in declaration order, appends
 * to same-named groups, expands unnamed appearance options, merges named options; a second pass merges
 * anonymous `uiSlot`/`link` overlays; finally indices are regenerated. Choice identity is the definition
 * `name` (appearances) or `localizedName` (morphs, switchers) — never an index.
 */
import { depotRef, cname, asArray, isObject, HandleScope, type JsonObject } from "./red-json";
import { type DepotRef } from "./depot-path";
import { type XlFix } from "./archivexl-config";
import { type Ambiguity, type RuleNote, note } from "./resolution-evidence";

export type CcoPart = "head" | "body" | "arms";
export const CCO_PARTS: readonly CcoPart[] = ["head", "body", "arms"];

interface OptionBase {
  name: string;
  uiSlot: string;
  link: string;
  linkController: boolean;
  hidden: boolean;
  enabled: boolean;
  index: number;
  defaultIndex: number;
  localizedName: string;
  editTags: string[];
  /** Label of the resource that defined the option (the base CCO or a custom resource). */
  definedBy: string;
}
export interface AppearanceChoice { name: string; index: number; localizedName: string; tags: string[]; providedBy: string }
export interface MorphChoice { morphName: string; index: number; localizedName: string; providedBy: string }
export interface SwitcherChoice { names: string[]; index: number; localizedName: string; providedBy: string }
export type CcoOption =
  | (OptionBase & { type: "appearance"; resource: DepotRef | null; definitions: AppearanceChoice[] })
  | (OptionBase & { type: "morph"; morphNames: MorphChoice[] })
  | (OptionBase & { type: "switcher"; uiSlots: string[]; options: SwitcherChoice[] });
export interface CcoGroup { name: string; options: string[] }
export interface CcoResource {
  label: string;
  parts: Record<CcoPart, { options: CcoOption[]; groups: CcoGroup[] }>;
  version: number | null;
}

const bool = (value: unknown) => value === 1 || value === true || value === "1";
const num = (value: unknown, fallback = 0) => typeof value === "number" ? value : Number(value ?? fallback) || fallback;
const tags = (value: unknown) => isObject(value) ? asArray(value.tags).map(cname).filter(Boolean) : [];

function readOption(data: JsonObject, label: string): CcoOption | null {
  const base: OptionBase = {
    name: cname(data.name), uiSlot: cname(data.uiSlot), link: cname(data.link), linkController: bool(data.linkController),
    hidden: bool(data.hidden), enabled: bool(data.enabled), index: num(data.index), defaultIndex: num(data.defaultIndex),
    localizedName: typeof data.localizedName === "string" ? data.localizedName : "",
    editTags: asArray(data.editTags).filter((tag): tag is string => typeof tag === "string"), definedBy: label,
  };
  switch (data.$type) {
    case "gameuiAppearanceInfo": return { ...base, type: "appearance", resource: depotRef(data.resource),
      definitions: asArray(data.definitions).filter(isObject).map(definition => ({ name: cname(definition.name),
        index: num(definition.index), localizedName: typeof definition.localizedName === "string" ? definition.localizedName : "",
        tags: tags(definition.tags), providedBy: label })) };
    case "gameuiMorphInfo": return { ...base, type: "morph", morphNames: asArray(data.morphNames).filter(isObject).map(choice => ({
      morphName: cname(choice.morphName), index: num(choice.index), localizedName: String(choice.localizedName ?? ""), providedBy: label })) };
    case "gameuiSwitcherInfo": return { ...base, type: "switcher", uiSlots: asArray(data.uiSlots).map(cname).filter(Boolean),
      options: asArray(data.options).filter(isObject).map(choice => ({ names: asArray(choice.names).map(cname).filter(Boolean),
        index: num(choice.index), localizedName: String(choice.localizedName ?? ""), providedBy: label })) };
    default: return null;
  }
}

/** Read a serialized `gameuiCharacterCustomizationInfoResource` root. */
export function readCco(root: JsonObject, label: string): CcoResource {
  const scope = new HandleScope(root);
  const part = (options: unknown, groups: unknown) => ({
    options: asArray(options).map(handle => scope.data(handle)).filter((data): data is JsonObject => !!data)
      .map(data => readOption(data, label)).filter((option): option is CcoOption => !!option),
    groups: asArray(groups).filter(isObject).map(group => ({ name: cname(group.name), options: asArray(group.options).map(cname).filter(Boolean) })),
  });
  return { label, version: typeof root.version === "number" ? root.version : null, parts: {
    head: part(root.headCustomizationOptions, root.headGroups),
    body: part(root.bodyCustomizationOptions, root.bodyGroups),
    arms: part(root.armsCustomizationOptions, root.armsGroups),
  } };
}

/** `(app hash, definition)` → the app hash ArchiveXL rewrites the descriptor to. */
export type AppOverrides = Map<string, { app: string; registeredBy: string }>;
export const overrideKey = (appHash: string, definition: string) => `${appHash}|${definition}`;

export interface MergedCco {
  cco: CcoResource;
  appOverrides: AppOverrides;
  hairColorTags: string[];
  rules: RuleNote[];
  ambiguities: Ambiguity[];
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Merge custom resources into the base CCO as ArchiveXL does. `aliasesOf(hash)` returns ArchiveXL link
 * aliases of a remapped app (they also receive app overrides).
 */
export function mergeCustomizations(base: CcoResource, fix: XlFix | undefined, customs: readonly CcoResource[],
  aliasesOf: (hash: string) => readonly string[] = () => []): MergedCco {
  const cco = clone(base);
  const appOverrides: AppOverrides = new Map();
  const hair = new Set<string>();
  const ambiguities: Ambiguity[] = [];
  const register = (from: string, to: string, definition: string, by: string) => appOverrides.set(overrideKey(from, definition), { app: to, registeredBy: by });

  if (fix?.paths.size) for (const part of CCO_PARTS) for (const option of cco.parts[part].options) {
    if (option.type !== "appearance" || !option.resource) continue;
    const mapped = fix.paths.get(option.resource.hash);
    if (!mapped || mapped === option.resource.hash) continue;
    const original = option.resource.hash;
    option.resource = { hash: mapped, path: null };
    for (const definition of option.definitions) {
      register(original, mapped, definition.name, "resource.fix paths");
      for (const alias of aliasesOf(mapped)) register(alias, mapped, definition.name, "resource.fix paths (link alias)");
    }
  }

  const mergeOptions = (targets: CcoOption[], sources: CcoOption[], slotsAndLinks: boolean) => {
    for (const original of sources) {
      let source = original;
      if (slotsAndLinks ? (source.name || (!source.uiSlot && !source.link)) : !source.name) continue;
      let slot = source.uiSlot, link = source.link;
      const wildcardSlot = slotsAndLinks && slot.endsWith("*");
      if (wildcardSlot) slot = slot.slice(0, -1);
      // ArchiveXL computes the link wildcard flag from the *slot* string (Extension.cpp:379); replicated.
      const wildcardLink = slotsAndLinks && slot.endsWith("*") ;
      if (wildcardLink) link = link.slice(0, -1);
      let existing = false;
      for (const target of targets) {
        if (slotsAndLinks) {
          if (source.uiSlot && (wildcardSlot ? !target.uiSlot.startsWith(slot) : target.uiSlot !== source.uiSlot)) continue;
          if (source.link && (wildcardLink ? !target.link.startsWith(link) : target.link !== source.link)) continue;
        } else {
          if (target.name !== source.name) continue;
          if (source.link) {
            const linked = sources.find(option => option.name === source.link);
            if (!linked) continue;
            source = linked;
          }
        }
        existing = true;
        if (target.type !== source.type) {
          ambiguities.push({ code: "cco-merge-type-mismatch", subject: target.name, grade: "source",
            detail: `${source.definedBy} option cannot merge into ${target.type} option (ArchiveXL logs and skips).` });
          continue;
        }
        if (target.type === "appearance" && source.type === "appearance") {
          if ((wildcardSlot || wildcardLink) && (!target.resource || !target.definitions.length)) continue;
          for (const choice of source.definitions) {
            const found = target.definitions.findIndex(definition => definition.name === choice.name);
            if (found >= 0) { target.definitions[found] = clone(choice); }
            else {
              target.definitions.push(clone(choice));
              if (source.resource && target.resource?.hash !== source.resource.hash && target.resource)
                register(target.resource.hash, source.resource.hash, choice.name, source.definedBy);
            }
            if (target.uiSlot === "hair_color") for (const tag of choice.tags) hair.add(tag);
          }
        } else if (target.type === "morph" && source.type === "morph") {
          for (const choice of source.morphNames) {
            const found = target.morphNames.findIndex(item => item.localizedName === choice.localizedName);
            if (found >= 0) target.morphNames[found] = clone(choice); else target.morphNames.push(clone(choice));
          }
        } else if (target.type === "switcher" && source.type === "switcher") {
          for (const choice of source.options) {
            const found = target.options.findIndex(item => item.localizedName === choice.localizedName);
            if (found >= 0) target.options[found] = clone(choice); else target.options.push(clone(choice));
          }
        }
      }
      if (!existing && !slotsAndLinks && source.name) targets.push(clone(source));
    }
  };
  const expand = (options: CcoOption[]) => {
    let previous: Extract<CcoOption, { type: "appearance" }> | null = null;
    for (const option of options) {
      if (option.type !== "appearance" || option.name) continue;
      if (option.definitions.length) { previous = option; continue; }
      if (!previous) continue;
      option.definitions = clone(previous.definitions);
      if (!option.resource && previous.resource) option.resource = previous.resource;
    }
  };

  const prepared = customs.map(custom => clone(custom));
  for (const custom of prepared) {
    for (const part of ["arms", "body", "head"] as const) {
      for (const group of custom.parts[part].groups)
        for (const target of cco.parts[part].groups) if (target.name === group.name) target.options.push(...group.options);
      expand(custom.parts[part].options);
      mergeOptions(cco.parts[part].options, custom.parts[part].options, false);
    }
  }
  for (const custom of prepared) for (const part of ["arms", "body", "head"] as const)
    mergeOptions(cco.parts[part].options, custom.parts[part].options, true);
  for (const part of CCO_PARTS) for (const option of cco.parts[part].options) {
    if (option.type === "appearance") option.definitions.forEach((choice, index) => { choice.index = index; });
    else if (option.type === "morph") option.morphNames.forEach((choice, index) => { choice.index = index; });
    else option.options.forEach((choice, index) => { choice.index = index; });
  }
  return { cco, appOverrides, hairColorTags: [...hair], ambiguities, rules: [
    note("R4-cco-merge", "source", "ArchiveXL 1.27.3 Customization/Extension.cpp MergeCustomEntries, FixCustomizationOptions and RegenerateIndexes replicated."),
  ] };
}

/** One saved or derived appearance choice, as the game hands it to an entity (`AppearanceDescriptor`). */
export interface AppearanceDescriptor {
  readonly part: CcoPart;
  readonly group: string;
  readonly option: string;
  readonly app: DepotRef;
  readonly definition: string;
}
export interface MorphDescriptor { readonly part: CcoPart; readonly group: string; readonly region: string; readonly target: string }

/** Option state keyed by option name: definition name, morph name or switcher choice `localizedName`. */
export type UiOptionState = Readonly<Record<string, string>>;
/**
 * Switcher choices by position, keyed by option name, for a choice its name alone doesn't pick: the creator chooses by position, so two
 * mods' same-named choices are different choices there (CORE-70). A position overrides the name in `UiOptionState`.
 */
export type SwitcherPicks = Readonly<Record<string, number>>;

/**
 * Rule R5, UI option state → descriptors:
 * - **Switcher targets** [resource]: an option that any switcher choice names is active only while an active
 *   switcher's current choice names it. Its own `enabled` flag (true for the default target, e.g.
 *   `skin_type_01`) does not keep it active beside another choice. All six vanilla UI presets agree.
 * - **Roots** [resource]: an option that no switcher names is active when `enabled`.
 * - **Off choices** [resource]: a definition whose `name` is the empty CName (`None`) names no `.app`
 *   appearance, so the option emits no descriptor (the creator's "Off", e.g. `scars` at index 0).
 * - **Links** [hypothesis]: a link follower takes its appearance controller's choice index.
 * Each group then lists its active options.
 */
export function descriptorsFromUiState(cco: CcoResource, state: UiOptionState, picks?: SwitcherPicks): {
  appearances: AppearanceDescriptor[]; morphs: MorphDescriptor[]; ambiguities: Ambiguity[]; rules: RuleNote[];
} {
  const appearances: AppearanceDescriptor[] = [], morphs: MorphDescriptor[] = [], ambiguities: Ambiguity[] = [];
  for (const part of CCO_PARTS) {
    const found = partDescriptors(cco, part, state, r5Roots(cco, part), picks);
    appearances.push(...found.appearances); morphs.push(...found.morphs); ambiguities.push(...found.ambiguities);
  }
  return { appearances, morphs, ambiguities, rules: R5_RULES() };
}

const R5_RULES = () => [
  note("R5-switcher-targets", "resource", "Only the targets named by an active switcher's current choice are active, whatever their enabled flag; options no switcher names follow enabled. Matches every switcher in the six vanilla UI presets; native state code unread."),
  note("R5-off-choice", "resource", "A definition with an empty (None) name selects no appearance and emits no descriptor; vanilla Off choices have that shape and the reference save stores no such entry."),
  note("R5-links", "hypothesis", "Link-index propagation from appearance controllers to followers and group listing inferred from vanilla CCO resources and UI presets."),
];

/** Every option name a switcher can activate, through any of its choices and nested switchers (the switcher's own reach). */
export function switcherReach(cco: CcoResource, part: CcoPart, switcher: string): Set<string> {
  const byName = new Map(cco.parts[part].options.filter(option => option.name).map(option => [option.name, option]));
  const reach = new Set<string>();
  const walk = (name: string, depth: number) => {
    const option = byName.get(name);
    if (!option || option.type !== "switcher" || depth > 16) return;
    for (const choice of option.options) for (const target of choice.names) {
      if (reach.has(target)) continue;
      reach.add(target);
      walk(target, depth + 1);
    }
  };
  walk(switcher, 0);
  return reach;
}

/**
 * A switcher's choice by its name (`localizedName`, the creator's choice identity): of several choices with that name, the first that
 * turns an option on, else the first (PIPE-65: a same-named choice that drives nothing must not hide the one that does). The one rule
 * R5 and the catalogue share.
 */
export function switcherChoiceNamed<C extends { localizedName: string; names: readonly string[] }>(option: { options: readonly C[] }, name: string | undefined): C | undefined {
  if (name === undefined) return undefined;
  let first: C | undefined;
  for (const choice of option.options) if (choice.localizedName === name) {
    if (choice.names.length) return choice;
    first ??= choice;
  }
  return first;
}

/** The options of one part that no switcher names: R5's roots, active when `enabled`. */
export function r5Roots(cco: CcoResource, part: CcoPart): CcoOption[] {
  const { options } = cco.parts[part];
  // Every name a switcher choice can activate. These options take their activation from switchers alone.
  const switcherTargets = new Set<string>();
  for (const option of options) if (option.type === "switcher")
    for (const choice of option.options) for (const name of choice.names) switcherTargets.add(name);
  return options.filter(option => option.name && option.enabled && !switcherTargets.has(option.name));
}

/**
 * The activation half of rule R5 for one part: the names of the options that take part in the V for `state`, from `roots` (default:
 * the part's R5 roots) through each active switcher's current choice. The one implementation: `descriptorsFromUiState` and the
 * character context (which shows each row's active option) both use it (CORE-57).
 */
export function activeOptionNames(cco: CcoResource, part: CcoPart, state: UiOptionState, roots: readonly CcoOption[] = r5Roots(cco, part),
  picks?: SwitcherPicks): Set<string> {
  const byName = new Map(cco.parts[part].options.filter(o => o.name).map(option => [option.name, option]));
  const active = new Set<string>();
  const activate = (option: CcoOption, depth = 0) => {
    if (depth > 16 || active.has(option.name)) return;
    active.add(option.name);
    if (option.type !== "switcher") return;
    const wanted = state[option.name], pick = picks?.[option.name];
    const choice = (pick !== undefined ? option.options[pick] : undefined) ?? switcherChoiceNamed(option, wanted) ?? option.options[option.defaultIndex] ?? option.options[0];
    for (const name of choice?.names ?? []) { const target = byName.get(name); if (target) activate(target, depth + 1); }
  };
  for (const option of roots) activate(option);
  return active;
}

/** R5 for one part from the given roots: activation through switchers, link indices, definitions, then each group's listing. */
function partDescriptors(cco: CcoResource, part: CcoPart, state: UiOptionState, roots: readonly CcoOption[], picks?: SwitcherPicks) {
  const appearances: AppearanceDescriptor[] = [], morphs: MorphDescriptor[] = [], ambiguities: Ambiguity[] = [];
  {
    const { options, groups } = cco.parts[part];
    const byName = new Map(options.filter(o => o.name).map(option => [option.name, option]));
    const active = activeOptionNames(cco, part, state, roots, picks);
    const linkIndex = new Map<string, number>();
    for (const option of options) {
      if (option.type !== "appearance" || !option.linkController || !option.link || !active.has(option.name)) continue;
      const wanted = state[option.name];
      const index = option.definitions.findIndex(definition => definition.name === wanted);
      linkIndex.set(option.link, index >= 0 ? index : option.defaultIndex);
    }
    const chosen = new Map<string, { definition: string } | { morph: string }>();
    for (const option of options) {
      if (!active.has(option.name)) continue;
      if (option.type === "appearance") {
        const wanted = state[option.name];
        let definition = option.definitions.find(item => item.name === wanted);
        if (!definition && option.link && !option.linkController && linkIndex.has(option.link)) {
          const index = linkIndex.get(option.link)!;
          definition = option.definitions[index];
          if (!definition) ambiguities.push({ code: "link-index-out-of-range", subject: option.name, grade: "hypothesis",
            detail: `Linked index ${index} exceeds this follower's ${option.definitions.length} choices.` });
        }
        definition ??= option.definitions[option.defaultIndex] ?? option.definitions[0];
        // An empty (`None`) definition name is the "Off" choice: it names no appearance, so nothing is emitted.
        if (definition?.name && option.resource) chosen.set(option.name, { definition: definition.name });
      } else if (option.type === "morph") {
        const wanted = state[option.name];
        const choice = option.morphNames.find(item => item.morphName === wanted || item.localizedName === wanted)
          ?? option.morphNames[option.defaultIndex];
        if (choice?.morphName) chosen.set(option.name, { morph: choice.morphName });
      }
    }
    for (const group of groups) for (const name of group.options) {
      const pick = chosen.get(name), option = byName.get(name);
      if (!pick || !option) continue;
      if ("definition" in pick && option.type === "appearance" && option.resource)
        appearances.push({ part, group: group.name, option: name, app: option.resource, definition: pick.definition });
      else if ("morph" in pick) morphs.push({ part, group: group.name, region: name, target: pick.morph });
    }
  }
  return { appearances, morphs, ambiguities };
}
