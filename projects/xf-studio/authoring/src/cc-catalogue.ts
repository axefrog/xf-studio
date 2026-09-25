/**
 * The character-creator catalogue: every option the creator offers for one body gender, generated from the effective
 * (merged) `.inkcharcustomization` resource, its texts and TweakDB's presentation data. Pure. Nothing here names an
 * option, a slot or a mod: vanilla options and those installed CCXL packs add come through the same rules.
 *
 * Where each part comes from (knowledge/cc-file-chain.md §2):
 * - **Options and choices**: the merged resource (`loadMergedCco`, rules R2–R4). Choice identity is the definition name
 *   (appearances), the morph target (morphs) or the switcher choice's `localizedName` (ArchiveXL merges on exactly
 *   these); indices are regenerated and never identity.
 * - **Order**: the options' own `index` ("determines order of switchers in Character Creator" [wiki]); the creator lists
 *   head, body and arm options together (`GetUnitedOptions`) and shows each active, editable, uncensored option once
 *   [source: game scripts]. Ties keep the resource order.
 * - **Rows**: options that share a `uiSlot` take turns in one row: the creator replaces a row's option by slot when a
 *   switcher changes its target (`characterCreationBodyMorphMenu.UpdateOption`) [source].
 * - **Sections**: each option's `randomizeCategory`, ordered and titled by TweakDB's creator category list
 *   (cc-presentation.ts). The creator itself shows one list; the categories are the grouping its randomizer uses.
 * - **Labels**: the `localizedName` values through the game's and mods' texts (game-text.ts).
 * - **Swatches**: a choice's `color` and its `icon` record's inkatlas part (cc-presentation.ts); only references here.
 * - **Provenance**: vanilla, or the custom resource and the mod (archive provider) that supplied it. The base resource is
 *   vanilla only when the installed game supplies it; a mod archive replacing it names that mod (PIPE-46).
 *
 * What the preview can draw of each option is not part of the catalogue: the preview side projects it from these options
 * (cc-render-coverage.ts `catalogueCoverage`), so a host-cached catalogue never goes stale when the preview draws more (CORE-60).
 * The catalogue shares nothing with the merged resource it was built from: every list is copied (CORE-62).
 */
import { asArray, cname, HandleScope, isObject, type JsonObject } from "./red-json";
import { CCO_PARTS, type CcoOption, type CcoPart, type CcoResource, readCco } from "./cco-model";
import type { DepotRef } from "./depot-path";
import { displayLabel, type DisplayLabel, type TextTable } from "./game-text";
import { type CreatorPresentation, type IconRef, iconKey } from "./cc-presentation";

export const CC_CATALOGUE_SCHEMA = "xfs/cc-catalogue-1" as const;
export type BodyGender = "female" | "male";
export type Rgba = readonly [number, number, number, number];

// ---------------------------------------------------------------------------------------------------------------
// Presentation fields read beside cco-model's option model (carried through ArchiveXL's merge with their option or choice).

export interface OptionPresentation {
  readonly randomizeCategory: string;
  /** The resource names the category; otherwise it is the enum's default, `Body` (UI-60). */
  readonly categoryExplicit: boolean;
  readonly useThumbnails: boolean;
  readonly censorFlag: string;
  readonly censorFlagAction: string;
}
export interface ChoicePresentation {
  /** The swatch tint, when the resource sets one (all-zero means none). */
  readonly color: Rgba | null;
  /** The icon record (`OptionsIcons.BrownLiquorice`, or `#<id>`), when set. */
  readonly icon: string | null;
}
type Presented = { presentation?: OptionPresentation };
type PresentedChoice = { presentation?: ChoicePresentation };
const OPTION_TYPES = new Set(["gameuiAppearanceInfo", "gameuiMorphInfo", "gameuiSwitcherInfo"]);

function choicePresentation(data: JsonObject): ChoicePresentation {
  const colour = isObject(data.color) ? data.color : null;
  const channel = (key: string) => { const n = Number(colour?.[key] ?? 0); return Number.isInteger(n) && n >= 0 && n <= 255 ? n : 0; };
  const rgba: Rgba = [channel("Red"), channel("Green"), channel("Blue"), channel("Alpha")];
  const icon = isObject(data.icon) && typeof data.icon.$value === "string"
    ? iconKey({ storage: data.icon.$storage === "string" ? "string" : "uint64", value: data.icon.$value }) : null;
  return { color: rgba.some(value => value > 0) ? rgba : null, icon };
}

/**
 * `readCco` plus the presentation fields the creator's UI uses (category, swatch colour and icon, thumbnails flag,
 * censorship). Pass to `loadMergedCco` so the fields travel through ArchiveXL's merge with their option or choice.
 */
export function readCcoWithPresentation(root: JsonObject, label: string): CcoResource {
  const resource = readCco(root, label);
  const scope = new HandleScope(root);
  const lists: Record<CcoPart, unknown> = { head: root.headCustomizationOptions, body: root.bodyCustomizationOptions, arms: root.armsCustomizationOptions };
  for (const part of CCO_PARTS) {
    const raw = asArray(lists[part]).map(handle => scope.data(handle)).filter((data): data is JsonObject => !!data && OPTION_TYPES.has(String(data.$type)));
    const options = resource.parts[part].options;
    if (raw.length !== options.length) continue;
    options.forEach((option, i) => {
      const data = raw[i]!;
      // A missing category is the enum's default, `Body` (value 0 of `gamedataCharacterRandomizationCategory`) [source].
      const explicit = typeof data.randomizeCategory === "string" && !!data.randomizeCategory;
      (option as Presented).presentation = { randomizeCategory: explicit ? data.randomizeCategory as string : "Body", categoryExplicit: explicit,
        useThumbnails: data.useThumbnails === 1 || data.useThumbnails === true, censorFlag: String(data.censorFlag ?? "0"),
        censorFlagAction: typeof data.censorFlagAction === "string" ? data.censorFlagAction : "" };
      const choices = option.type === "appearance" ? option.definitions : option.type === "morph" ? option.morphNames : option.options;
      const rawChoices = asArray(option.type === "appearance" ? data.definitions : option.type === "morph" ? data.morphNames : data.options).filter(isObject);
      if (rawChoices.length === choices.length) choices.forEach((choice, j) => { (choice as PresentedChoice).presentation = choicePresentation(rawChoices[j]!); });
    });
  }
  return resource;
}

// ---------------------------------------------------------------------------------------------------------------
// The catalogue.

export interface CcProvenance {
  readonly kind: "vanilla" | "mod";
  /** The mod (its archive's provider, e.g. the MO2 mod name) that supplied it; null for vanilla. */
  readonly mod: string | null;
  /** The custom `.inkcharcustomization` depot path that declared it; null for vanilla. */
  readonly resource: string | null;
}
export interface CcSwatch { readonly color: Rgba | null; readonly icon: IconRef | null; readonly iconRecord: string | null }
export interface CcChoice {
  /** Identity within the option: definition name, morph target or switcher choice name ("" is the `None` choice). */
  readonly key: string;
  readonly position: number;
  readonly label: DisplayLabel;
  /** Choosing it adds nothing: no appearance and no morph (the creator's "Off" or the base shape). */
  readonly off: boolean;
  readonly provenance: CcProvenance;
  readonly swatch: CcSwatch | null;
  /** Switchers: the option names this choice activates (a portable identity across installations). */
  readonly activates: readonly string[];
  readonly tags: readonly string[];
}
export interface CcOption {
  /** `<part>/<name>`. */
  readonly id: string;
  readonly part: CcoPart;
  readonly name: string;
  readonly type: "appearance" | "morph" | "switcher";
  readonly label: DisplayLabel;
  /** The creator's sort key (the resource's option `index`). */
  readonly order: number;
  /** `randomizeCategory`: the section. */
  readonly category: string;
  /** The resource names the category (otherwise it is the default, `Body`). */
  readonly categoryExplicit: boolean;
  readonly uiSlot: string;
  /** Switchers: the slots their choices fill. */
  readonly uiSlots: readonly string[];
  readonly link: { readonly key: string; readonly controller: boolean } | null;
  /** Never gets a row of its own (proxies, FPP twins, colour followers). */
  readonly hidden: boolean;
  /** Active by default when no switcher owns it. */
  readonly enabled: boolean;
  readonly editTags: readonly string[];
  readonly censorFlag: string;
  /** Switchers whose choices name this option: it is active only through them (rule R5). */
  readonly controlledBy: readonly string[];
  /** Consumer groups that list it (`TPP`, `face`, `hairs`, …). */
  readonly groups: readonly string[];
  /** Appearance options: the `.app` their definitions name (after ArchiveXL's path fixes); null for colour-only controllers. */
  readonly app: DepotRef | null;
  readonly useThumbnails: boolean;
  readonly defaultChoice: string | null;
  readonly choices: readonly CcChoice[];
  readonly provenance: CcProvenance;
  /** Switchers: every option name their choices activate (same part). */
  readonly targets: readonly string[];
  /** No choice adds an appearance or a morph (an Off placeholder). */
  readonly emitsNothing: boolean;
}
export interface CcRow {
  /** The slot the row shows (the option's name when it has no slot). */
  readonly slot: string;
  readonly part: CcoPart;
  readonly order: number;
  /** Options that take turns in this row, in order; the active one is shown. */
  readonly options: readonly string[];
}
export interface CcSection {
  readonly id: string;
  readonly label: DisplayLabel;
  readonly order: number;
  /** Where the order and title come from. */
  readonly source: "tweakdb" | "resource";
  readonly rows: readonly CcRow[];
}
export interface CcGap { readonly code: string; readonly subject: string; readonly detail: string }
export interface CcCatalogue {
  readonly schema: typeof CC_CATALOGUE_SCHEMA;
  readonly bodyGender: BodyGender;
  /** The text language labels were resolved in; null when no texts were available. */
  readonly language: string | null;
  readonly options: readonly CcOption[];
  readonly sections: readonly CcSection[];
  readonly counts: {
    readonly options: number; readonly userFacing: number; readonly choices: number;
    readonly modOptions: number; readonly modChoices: number; readonly modChoicesOnVanillaOptions: number;
    readonly perSection: Readonly<Record<string, number>>;
  };
  readonly gaps: readonly CcGap[];
}

export interface CatalogueInputs {
  readonly bodyGender: BodyGender;
  /** The merged resource (`loadMergedCco(…, readCcoWithPresentation).merged.cco`). */
  readonly cco: CcoResource;
  /** Custom resources as `loadMergedCco` lists them, to name each choice's mod. */
  readonly customs: readonly { readonly path: string; readonly label: string; readonly mod: string | null }[];
  /**
   * The base creator resource's winner, when a mod archive supplies it (it replaces the installed game's): its options and
   * choices then name that mod (PIPE-46). Absent or `mod: null` when the game supplies it.
   */
  readonly base?: { readonly path: string; readonly mod: string | null } | null;
  readonly text: TextTable | null;
  readonly presentation: CreatorPresentation | null;
  /** The editing context whose options count as user-facing (the creator's default is a new game). */
  readonly editTag?: string;
}

const choicesOf = (option: CcoOption) => option.type === "appearance" ? option.definitions : option.type === "morph" ? option.morphNames : option.options;
const keyOf = (option: CcoOption, choice: ReturnType<typeof choicesOf>[number]): string =>
  option.type === "appearance" ? (choice as { name: string }).name : option.type === "morph" ? (choice as { morphName: string }).morphName : choice.localizedName;
const PART_RANK: Record<CcoPart, number> = { head: 0, body: 1, arms: 2 };

/** Icon records every choice names, for the host to look up in TweakDB. */
export function iconRecords(cco: CcoResource): string[] {
  const icons = new Set<string>();
  for (const part of CCO_PARTS) for (const option of cco.parts[part].options)
    for (const choice of choicesOf(option)) { const icon = (choice as PresentedChoice).presentation?.icon; if (icon) icons.add(icon); }
  return [...icons];
}

/** Does the option take its choice from a link controller (a follower with the same link key)? */
export const followsLink = (option: Pick<CcOption, "link">) => !!option.link && !option.link.controller;
/**
 * Is an option user-facing in an editing context: it gets a row of its own and that context may change it. Link followers
 * are not, even when not hidden (the neck, the FPP twins): their choice comes from their controller
 * [resource-inferred: none has a label; knowledge/cc-file-chain.md "Links"].
 */
export const userFacing = (option: Pick<CcOption, "hidden" | "editTags" | "link">, editTag = "NewGame") =>
  !option.hidden && !followsLink(option) && option.editTags.includes(editTag);

export function buildCatalogue(inputs: CatalogueInputs): CcCatalogue {
  const { cco, bodyGender, text } = inputs;
  const editTag = inputs.editTag ?? "NewGame";
  const gaps: CcGap[] = [...(inputs.presentation?.gaps ?? [])];
  const byLabel = new Map(inputs.customs.map(custom => [custom.label, custom]));
  const baseProvenance: CcProvenance = inputs.base?.mod ? Object.freeze({ kind: "mod", mod: inputs.base.mod, resource: inputs.base.path })
    : Object.freeze({ kind: "vanilla", mod: null, resource: null });
  const provenance = (label: string): CcProvenance => {
    if (label === "base game") return baseProvenance;
    const custom = byLabel.get(label);
    return { kind: "mod", mod: custom?.mod ?? null, resource: custom?.path ?? null };
  };
  const label = (value: string, fallback: string) => displayLabel(text, value, fallback, bodyGender);

  // Structure per part: who controls whom, group membership, Off switcher choices.
  type Draft = { option: CcoOption; part: CcoPart; position: number };
  const drafts: Draft[] = CCO_PARTS.flatMap(part => cco.parts[part].options.filter(option => option.name)
    .map((option, position) => ({ option, part, position })));
  const lookup = new Map(drafts.map(draft => [`${draft.part}/${draft.option.name}`, draft.option]));
  const controlledBy = new Map<string, string[]>(), groups = new Map<string, string[]>();
  for (const part of CCO_PARTS) {
    for (const option of cco.parts[part].options) if (option.type === "switcher")
      for (const choice of option.options) for (const name of choice.names) {
        const list = controlledBy.get(`${part}/${name}`) ?? [];
        if (!list.includes(option.name)) list.push(option.name);
        controlledBy.set(`${part}/${name}`, list);
      }
    for (const group of cco.parts[part].groups) for (const name of group.options) {
      const list = groups.get(`${part}/${name}`) ?? [];
      if (!list.includes(group.name)) list.push(group.name);
      groups.set(`${part}/${name}`, list);
    }
  }
  const emitsNothing = (part: CcoPart, names: readonly string[], depth = 0): boolean => names.every(name => {
    const target = lookup.get(`${part}/${name}`);
    if (!target) return true;
    if (target.type === "appearance") return !target.resource || target.definitions.every(definition => !definition.name);
    if (target.type === "switcher") return depth < 8 && target.options.every(choice => emitsNothing(part, choice.names, depth + 1));
    return target.morphNames.every(choice => !choice.morphName);
  });

  const options: CcOption[] = drafts.map(({ option, part }) => {
    const id = `${part}/${option.name}`;
    const presentation = (option as Presented).presentation;
    const choices: CcChoice[] = choicesOf(option).map((choice, position) => {
      const key = keyOf(option, choice);
      const shown = (choice as PresentedChoice).presentation;
      const icon = shown?.icon ?? null;
      const activates = option.type === "switcher" ? [...(choice as { names: string[] }).names] : [];
      const off = option.type === "switcher" ? emitsNothing(part, activates) : option.type === "appearance" ? !key || !option.resource : !key;
      // Without a text, a definition reads by its last `__` part (`he_000_pwa__basehead__12_gradient_brown` → `Gradient brown`).
      return { key, position, label: label(choice.localizedName, key.split("__").pop() || choice.localizedName || "none"), off,
        provenance: provenance(choice.providedBy),
        swatch: option.type === "appearance" && (shown?.color || icon)
          ? { color: shown?.color ?? null, iconRecord: icon, icon: icon ? inputs.presentation?.icons.get(icon) ?? null : null } : null,
        activates, tags: option.type === "morph" ? [] : [...((choice as { tags?: string[] }).tags ?? [])] };
    });
    const defaultChoice = choices[option.defaultIndex]?.key ?? choices[0]?.key ?? null;
    return { id, part, name: option.name, type: option.type, label: label(option.localizedName, option.name), order: option.index,
      category: presentation?.randomizeCategory ?? "Body", categoryExplicit: presentation?.categoryExplicit ?? false,
      uiSlot: option.uiSlot, uiSlots: option.type === "switcher" ? [...option.uiSlots] : [],
      link: option.link ? { key: option.link, controller: option.linkController } : null, hidden: option.hidden, enabled: option.enabled,
      editTags: [...option.editTags], censorFlag: presentation?.censorFlag ?? "0", controlledBy: controlledBy.get(id) ?? [],
      groups: groups.get(id) ?? [], app: option.type === "appearance" && option.resource ? { ...option.resource } : null,
      useThumbnails: presentation?.useThumbnails ?? false, defaultChoice, choices, provenance: provenance(option.definedBy),
      targets: option.type === "switcher" ? [...new Set(option.options.flatMap(choice => choice.names))] : [],
      emitsNothing: option.type === "switcher" ? option.options.every(choice => emitsNothing(part, choice.names)) : emitsNothing(part, [option.name]) };
  });
  const position = new Map(drafts.map((draft, i) => [`${draft.part}/${draft.option.name}`, i]));
  options.sort((a, b) => a.order - b.order || PART_RANK[a.part] - PART_RANK[b.part] || position.get(a.id)! - position.get(b.id)!);

  // Rows: user-facing options grouped by slot within their part, placed by their first option and filed under the
  // category most of them name (a slot's Off placeholder may carry the default category).
  // Only categories the resource names vote; a row none of whose options names one is filed beside its neighbours of the
  // same part (a head-only CCXL option without a category would otherwise land under Body, the enum's default; UI-60).
  const rows = new Map<string, { slot: string; part: CcoPart; order: number; options: string[]; category: string; votes: Map<string, number> }>();
  for (const option of options) {
    if (!userFacing(option, editTag)) continue;
    const slot = option.uiSlot || option.name;
    const key = `${option.part}/${slot}`;
    const row = rows.get(key) ?? { slot, part: option.part, order: option.order, options: [] as string[], category: "", votes: new Map<string, number>() };
    row.options.push(option.id);
    if (option.categoryExplicit) row.votes.set(option.category, (row.votes.get(option.category) ?? 0) + 1);
    rows.set(key, row);
  }
  for (const row of rows.values()) if (row.votes.size) row.category = [...row.votes].reduce((a, b) => b[1] > a[1] ? b : a)[0];
  const byOrder = [...rows.values()].sort((a, b) => a.order - b.order);
  for (const row of byOrder) {
    if (row.category) continue;
    const decided = byOrder.filter(other => other.part === row.part && other.votes.size);
    const before = decided.filter(other => other.order <= row.order).at(-1), after = decided.find(other => other.order > row.order);
    row.category = row.part === "body" ? "Body" : before?.category ?? after?.category ?? "Body";
  }
  // The creator uses only the first of two top-level options that share an index [wiki]; say so rather than guess.
  const topLevel = [...rows.values()].map(row => options.find(option => option.id === row.options[0])!).filter(option => !option.controlledBy.length);
  const seen = new Map<number, string>();
  for (const option of topLevel) {
    const other = seen.get(option.order);
    if (other) gaps.push({ code: "duplicate-option-index", subject: option.id,
      detail: `Shares its creator position (${option.order}) with ${other}; the game may show only one of them.` });
    else seen.set(option.order, option.id);
  }

  // Sections: TweakDB's category order and titles, then any category the list lacks, in first-use order.
  const categories = inputs.presentation?.categories ?? [];
  const used = [...new Set([...rows.values()].map(row => row.category))];
  const ordered = [...categories.filter(category => used.includes(category.id)).map(category => ({ id: category.id, key: category.labelKey, source: "tweakdb" as const })),
    ...used.filter(id => !categories.some(category => category.id === id)).map(id => ({ id, key: "", source: "resource" as const }))];
  const sections: CcSection[] = ordered.map((category, order) => ({ id: category.id, label: label(category.key, category.id), order, source: category.source,
    rows: [...rows.values()].filter(row => row.category === category.id).map(({ slot, part, order: rowOrder, options: ids }) => ({ slot, part, order: rowOrder, options: ids })) }));
  if (!text) gaps.push({ code: "texts-unavailable", subject: "labels", detail: "The game's texts couldn't be read, so labels are made from option names." });

  const all = options.flatMap(option => option.choices.map(choice => ({ option, choice })));
  const perSection: Record<string, number> = {};
  for (const section of sections) perSection[section.id] = section.rows.reduce((n, row) => n + row.options.length, 0);
  return { schema: CC_CATALOGUE_SCHEMA, bodyGender, language: text?.language ?? null, options, sections, gaps,
    counts: { options: options.length, userFacing: options.filter(option => userFacing(option, editTag)).length, choices: all.length,
      modOptions: options.filter(option => option.provenance.kind === "mod").length,
      modChoices: all.filter(({ choice }) => choice.provenance.kind === "mod").length,
      modChoicesOnVanillaOptions: all.filter(({ option, choice }) => option.provenance.kind === "vanilla" && choice.provenance.kind === "mod").length,
      perSection } };
}

/** Index a catalogue by option ID and by `(part, name)`. */
export class CatalogueIndex {
  private readonly byId: ReadonlyMap<string, CcOption>;
  private readonly keys = new WeakMap<CcOption, Map<string, CcChoice>>();
  private readonly families = new Map<string, CcOption[]>();
  constructor(readonly catalogue: CcCatalogue) {
    this.byId = new Map(catalogue.options.map(option => [option.id, option]));
    for (const option of catalogue.options) if (option.link) {
      const members = this.families.get(option.link.key) ?? [];
      members.push(option);
      this.families.set(option.link.key, members);
    }
  }
  option(part: CcoPart, name: string): CcOption | undefined { return this.byId.get(`${part}/${name}`); }
  byOptionId(id: string): CcOption | undefined { return this.byId.get(id); }
  choice(option: CcOption, key: string): CcChoice | undefined {
    let keys = this.keys.get(option);
    if (!keys) {
      keys = new Map();
      // The first choice with a key wins, as a lookup by name finds it; for a switcher, the first that turns an option on
      // (cco-model.ts `switcherChoiceNamed`, PIPE-65).
      for (const choice of option.choices) {
        const known = keys.get(choice.key);
        if (!known || (option.type === "switcher" && !known.activates.length && choice.activates.length)) keys.set(choice.key, choice);
      }
      this.keys.set(option, keys);
    }
    return keys.get(key);
  }
  /** Every option sharing a link key (controllers and followers, any part), in catalogue order. */
  family(key: string): readonly CcOption[] { return this.families.get(key) ?? []; }
}
