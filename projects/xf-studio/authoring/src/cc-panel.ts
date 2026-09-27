/**
 * The Character panel's view of the creator catalogue (UI-59): a compact projection the host sends to the page instead of the
 * catalogue itself (130,000 choices with provenance, labels and swatches on the reference installation). Pure and shared: the host
 * builds it once per catalogue (cc-catalogue-service.ts), the page reads it with `readCcPanel` and `readChoicePage`.
 *
 * - **First paint** (`panelProjection`): sections, then rows, then every user-facing option of each row with what a row needs to
 *   draw without its choices: label, kind, choice count, the Off and default choice keys, link, the switchers it depends on,
 *   preview coverage (the preview side's projection, cc-render-coverage.ts) and provenance. Mods and coverage notes are tables
 *   referenced by index, so a name or sentence repeated across hundreds of options is sent once. The makeup section is marked
 *   (`makeup`), so the page's "hide my V's own makeup" needs no category name of its own (CORE-71).
 * - **Choices** (`choicePage`), paged per option, fetched when a row is opened: key, position, label, Off flag, swatch colour,
 *   provenance and, for a switcher, the options the choice activates (its identity across same-named choices, CORE-70). A page can be
 *   limited to the choices matching a search, and `searchChoices` names the options that have one (UI-72). Every page names the
 *   catalogue it came from (`identity`), so the page notices a catalogue that changed under it (PIPE-81).
 * - **Swatches** (`xfs/cc-panel-4`; `CcSwatches`), per colour row, fetched when the row opens and again while the host is still working
 *   them out: each choice's swatch derived from the resource that wins for it (cc-swatch.ts, compact text: one colour or a gradient root
 *   to tip) and its creator icon as a cell of an icon sheet (cc-icons.ts), with the sheets' table. The view's current choices carry their
 *   swatch too (`CreatorValue.swatch`).
 *
 * - **Who made each choice** (`groups`, `modGroups`; cc-controls backlog 4a): each mod's heading, so a row can group its choices by maker.
 *   The base game's choices have a group of their own (always `groups[0]`), and so do the mods XF Studio built (their custom creator
 *   resource is named with the `xfs_` prefix every generated resource carries: projects/xf-studio/data/naming.md); every other mod goes
 *   under its author as its mod manager records it (`ModMaker`, mod-makers.ts), else under its own name. Mods by one author share a
 *   group. Each option says how many groups its choices span (`groups`), so a row with one maker isn't grouped at all.
 *
 * Nothing here names an option, a slot or a mod.
 */
import type { CcoPart } from "./cco-model";
import { type BodyGender, CatalogueIndex, type CcCatalogue, type CcOption, followsLink, userFacing } from "./cc-catalogue";
import type { RenderCoverage, RenderStatus } from "./cc-render-coverage";
import type { CharacterView } from "./character-context";
import { CREATOR_LIMITS, isCreatorName } from "./creator-names";

export const CC_PANEL_SCHEMA = "xfs/cc-panel-5" as const;
export const CC_PAGE_SIZE = 240;
/**
 * The game's creator category (`gamedataCharacterRandomizationCategory`) whose rows are makeup: the section "hide my V's own makeup"
 * turns Off. A category of the game's own data, not an option: every row in it, vanilla or modded, is covered.
 */
export const MAKEUP_CATEGORY = "Makeup";
/** Most options a search names at once (a query matching more is too broad to be useful). */
export const SEARCH_LIMIT = 2000;

export interface CcPanelOption {
  readonly id: string;
  readonly part: CcoPart;
  readonly name: string;
  readonly label: string;
  readonly type: CcOption["type"];
  /** The creator shows a colour grid (`useThumbnails`) rather than a stepper. */
  readonly grid: boolean;
  readonly count: number;
  /** The key of the choice the creator labels Off (catalogue `labelledOff`), when it has one. */
  readonly off: string | null;
  readonly defaultChoice: string | null;
  /** Index into `mods`, or -1 for vanilla. */
  readonly mod: number;
  readonly link: { readonly key: string; readonly controller: boolean } | null;
  /** Labels of the switchers whose choices turn it on (it takes part only through them). */
  readonly dependsOn: readonly string[];
  /** Preview coverage: status and an index into `notes`. */
  readonly coverage: readonly [RenderStatus, number];
  /** How many of the panel's `groups` its offered choices come from (grouped by maker when more than one). */
  readonly groups: number;
}
/** Who a group of choices comes from: the base game, XF Studio, an author as recorded, or a mod with no author recorded (by its name). */
export type CcChoiceGroupKind = "game" | "xf" | "author" | "mod";
export interface CcChoiceGroup { readonly label: string; readonly kind: CcChoiceGroupKind }
export const BASE_GAME_GROUP: CcChoiceGroup = Object.freeze({ label: "Base game", kind: "game" });
export const XF_GROUP: CcChoiceGroup = Object.freeze({ label: "Made with XF Studio", kind: "xf" });
/**
 * What the host knows about who made a mod (mod-makers.ts), by the mod's name in the catalogue: the author its mod manager recorded, and
 * a better name to show for it when there is one (a Vortex mod's own name rather than its staging folder).
 */
export interface ModMaker { readonly author: string | null; readonly name?: string | null }
/** A creator resource XF Studio generated (the `xfs_` prefix of every generated resource name). */
export const isXfResource = (path: string | null | undefined) => !!path && /^xfs_/i.test(path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1));
export interface CcPanelRow {
  readonly slot: string;
  readonly part: CcoPart;
  /** Indices into `options`, in order; the row shows whichever is active. */
  readonly options: readonly number[];
}
export interface CcPanelSection {
  readonly id: string; readonly label: string; readonly rows: readonly CcPanelRow[];
  /** The game's makeup category: the rows "hide my V's own makeup" turns Off. */
  readonly makeup: boolean;
}
export interface CcPanel {
  readonly schema: typeof CC_PANEL_SCHEMA;
  readonly bodyGender: BodyGender;
  /** Changes whenever the catalogue does (another installation, language or build). */
  readonly identity: string;
  readonly language: string | null;
  readonly mods: readonly string[];
  /** The groups choices are shown in by who made them; `groups[0]` is always the base game. */
  readonly groups: readonly CcChoiceGroup[];
  /** Each mod's group, by `mods` index. */
  readonly modGroups: readonly number[];
  readonly notes: readonly string[];
  readonly options: readonly CcPanelOption[];
  readonly sections: readonly CcPanelSection[];
  readonly counts: { readonly options: number; readonly choices: number; readonly modChoices: number };
}
export interface CcPanelChoice {
  readonly key: string;
  /** Its place among the option's choices (tells same-named choices apart). */
  readonly position: number;
  readonly label: string;
  readonly off: boolean;
  /** `#rrggbb`, when the choice has a swatch colour. */
  readonly color: string | null;
  /** Index into the panel's `mods`, or -1 for vanilla. */
  readonly mod: number;
  /** A switcher choice: the options it activates (its identity); absent otherwise. */
  readonly activates?: readonly string[];
}
export interface CcChoicePage {
  /** The catalogue the page came from (the panel's `identity`). */
  readonly identity: string;
  readonly option: string;
  /** The search the page answers ("" for every choice). */
  readonly query: string;
  readonly offset: number;
  /** The option's choices (or, with a query, its matching choices). */
  readonly total: number;
  readonly choices: readonly CcPanelChoice[];
}
/** An icon sheet: `columns` × `rows` cells of `cell` pixels, fetched by its `key` (changes when the sheet does). */
export interface CcIconSheet { readonly id: number; readonly key: string; readonly columns: number; readonly rows: number; readonly cell: number }
/** One colour row's swatches and icons by choice position (`GET ?gender=&swatches=<option>`). */
export interface CcSwatches {
  readonly identity: string;
  readonly option: string;
  /** Some are still being worked out: ask again shortly. */
  readonly pending: boolean;
  /** Compact swatch text (cc-swatch.ts `encodeSwatch`) by position, "" for none. */
  readonly swatches: readonly string[];
  /** `<sheet>:<cell>` by position, "" for none. */
  readonly icons: readonly string[];
  readonly sheets: readonly CcIconSheet[];
}
/** The options with a choice matching a search (`searchChoices`). */
export interface CcChoiceSearch { readonly identity: string; readonly query: string; readonly options: readonly string[]; readonly more: boolean }

const hex = (rgba: readonly number[] | null | undefined) => rgba
  ? `#${rgba.slice(0, 3).map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}` : null;

/** The panel's first-paint projection of a catalogue, with the preview's coverage of each option. */
export function panelProjection(catalogue: CcCatalogue, coverage: ReadonlyMap<string, RenderCoverage>, identity: string,
  makers: ReadonlyMap<string, ModMaker> = new Map()): { panel: CcPanel; mods: Map<string, number> } {
  const index = new CatalogueIndex(catalogue);
  const mods = new Map<string, number>(), notes = new Map<string, number>();
  const modIndex = (name: string | null) => {
    if (!name) return -1;
    let at = mods.get(name);
    if (at === undefined) { at = mods.size; mods.set(name, at); }
    return at;
  };
  const noteIndex = (text: string) => {
    let at = notes.get(text);
    if (at === undefined) { at = notes.size; notes.set(text, at); }
    return at;
  };
  // Every mod any choice names, so a page's choices can refer to the same table; a mod whose creator resource XF Studio generated is XF's.
  const xf = new Set<number>();
  for (const option of catalogue.options) for (const { provenance } of [option, ...option.choices]) if (provenance.kind === "mod") {
    const at = modIndex(provenance.mod);
    if (at >= 0 && isXfResource(provenance.resource)) xf.add(at);
  }
  const groups: CcChoiceGroup[] = [BASE_GAME_GROUP], groupAt = new Map<string, number>();
  const groupIndex = (group: CcChoiceGroup) => {
    // Mods by one author (or two mods of one name) share a group, whatever the case of the name.
    const key = group.kind === "xf" ? "\u0000xf" : group.label.toLocaleLowerCase();
    let at = groupAt.get(key);
    if (at === undefined) { at = groups.length; groupAt.set(key, at); groups.push(group); }
    return at;
  };
  const modGroups = [...mods.keys()].map((name, at) => {
    if (xf.has(at)) return groupIndex(XF_GROUP);
    const maker = makers.get(name);
    return maker?.author ? groupIndex({ label: maker.author, kind: "author" }) : groupIndex({ label: maker?.name || name, kind: "mod" });
  });
  const groupOf = (provenance: CcOption["provenance"]) => provenance.kind === "mod" ? modGroups[mods.get(provenance.mod ?? "") ?? -1] ?? 0 : 0;
  const options: CcPanelOption[] = [], at = new Map<string, number>();
  const add = (option: CcOption) => {
    const known = at.get(option.id);
    if (known !== undefined) return known;
    const shown = coverage.get(option.id) ?? { status: "not-rendered" as const, note: "" };
    const entry: CcPanelOption = { id: option.id, part: option.part, name: option.name, label: option.label.text, type: option.type,
      // Off is the choice the creator labels Off (the game's own text), never one inferred from adding nothing (the base face shape and the
      // skin's own nipples add nothing and are not Off).
      grid: option.useThumbnails, count: option.choices.length,
      off: option.choices.find(choice => choice.labelledOff)?.key ?? null,
      defaultChoice: option.defaultChoice, mod: option.provenance.kind === "mod" ? modIndex(option.provenance.mod) : -1,
      link: option.link ? { ...option.link } : null,
      dependsOn: option.controlledBy.map(name => index.option(option.part, name)?.label.text ?? name),
      coverage: [shown.status, noteIndex(shown.note)], groups: new Set(option.choices.filter(offeredChoice).map(choice => groupOf(choice.provenance))).size };
    at.set(option.id, options.length);
    options.push(entry);
    return options.length - 1;
  };
  const sections: CcPanelSection[] = catalogue.sections.map(section => ({ id: section.id, label: section.label.text, makeup: section.id === MAKEUP_CATEGORY,
    rows: section.rows.map(row => ({ slot: row.slot, part: row.part,
      options: row.options.flatMap(id => { const option = index.byOptionId(id); return option ? [add(option)] : []; }) })) }));
  const choices = catalogue.options.reduce((n, option) => n + option.choices.length, 0);
  return { mods, panel: { schema: CC_PANEL_SCHEMA, bodyGender: catalogue.bodyGender, identity, language: catalogue.language,
    mods: [...mods.keys()], groups, modGroups, notes: [...notes.keys()], options, sections,
    counts: { options: options.length, choices, modChoices: catalogue.counts.modChoices } } };
}

/** A search as both sides compare it: trimmed, lower-case, bounded. */
export const searchQuery = (text: string) => text.trim().toLowerCase().slice(0, 80);
const matches = (choice: { key: string; label: { text: string } }, query: string) =>
  !query || choice.label.text.toLowerCase().includes(query) || choice.key.toLowerCase().includes(query);
const offered = (option: CcOption | undefined): option is CcOption => !!option && userFacing(option) && !followsLink(option);
/** A choice the panel can offer: its key and activated options can be carried back to the host. */
function offeredChoice(choice: CcOption["choices"][number]) {
  return isCreatorName(choice.key, true) && choice.activates.length <= CREATOR_LIMITS.activates && choice.activates.every(name => isCreatorName(name));
}
/** A choice's group (the panel's `groups`): the base game's, or its mod's. */
export const choiceGroup = (choice: Pick<CcPanelChoice, "mod">, panel: Pick<CcPanel, "modGroups">) => choice.mod >= 0 ? panel.modGroups[choice.mod] ?? 0 : 0;
const KIND_ORDER: Record<CcChoiceGroupKind, number> = { game: 0, xf: 1, author: 2, mod: 2 };
/** The order groups are shown in: the base game, then XF Studio, then every other maker by name. */
export function compareGroups(groups: readonly CcChoiceGroup[]) {
  return (a: number, b: number) => {
    const x = groups[a], y = groups[b];
    if (!x || !y) return a - b;
    return KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || x.label.localeCompare(y.label, undefined, { sensitivity: "base" }) || a - b;
  };
}

/**
 * One page of an option's choices (with `query`, of its choices matching it), or null for an option the panel doesn't offer. A choice
 * whose key or activated options break the shared name rule can't be carried back to the host, so it isn't offered.
 */
export function choicePage(index: CatalogueIndex, mods: ReadonlyMap<string, number>, optionId: string, offset: number,
  options: { identity?: string; query?: string; limit?: number } = {}): CcChoicePage | null {
  const option = index.byOptionId(optionId);
  if (!offered(option)) return null;
  const query = searchQuery(options.query ?? "");
  const all = option.choices.filter(choice => offeredChoice(choice) && matches(choice, query));
  const start = Math.max(0, Math.min(all.length, Math.floor(offset)));
  return { identity: options.identity ?? "", option: option.id, query, offset: start, total: all.length,
    choices: all.slice(start, start + Math.max(1, Math.min(CC_PAGE_SIZE, options.limit ?? CC_PAGE_SIZE))).map(choice => ({ key: choice.key,
      position: choice.position, label: choice.label.text, off: choice.labelledOff, color: hex(choice.swatch?.color),
      mod: choice.provenance.kind === "mod" ? mods.get(choice.provenance.mod ?? "") ?? -1 : -1,
      ...(option.type === "switcher" ? { activates: [...choice.activates] } : {}) })) };
}

/** The offered options with a choice matching `query` (by label or key), in catalogue order (UI-72). */
export function searchChoices(index: CatalogueIndex, query: string, identity = ""): CcChoiceSearch {
  const wanted = searchQuery(query), found: string[] = [];
  let more = false;
  if (wanted) for (const option of index.catalogue.options) {
    if (!offered(option) || !option.choices.some(choice => matches(choice, wanted))) continue;
    if (found.length >= SEARCH_LIMIT) { more = true; break; }
    found.push(option.id);
  }
  return { identity, query: wanted, options: found, more };
}

/** The host's catalogue state for the panel (`GET ?gender=`). */
export type CreatorPhase = "preparing" | "ready" | "failed";
/**
 * `next` (ready only): the one next step for labels the catalogue couldn't read, which `message` explains (NATIVE-46): `retry` (Try again)
 * or `wolvenkit` (set WolvenKit up).
 */
export type CreatorNext = "retry" | "wolvenkit";
export interface CreatorState { readonly phase: CreatorPhase; readonly message: string; readonly next?: CreatorNext; readonly panel?: CcPanel }
/** One option's value as the panel shows it: the view's value, with the current and own choices' labels and swatch colours. */
export interface CreatorValue {
  readonly choice: string; readonly own: string; readonly set: boolean; readonly active: boolean;
  /** The current choice's position among the option's choices (the checked choice, CORE-70). */
  readonly position: number;
  readonly label: string; readonly color: string | null; readonly ownLabel: string;
  /** The current choice's swatch derived from what wins for it (cc-swatch.ts), when the host has worked it out. */
  readonly swatch?: string | null;
}
export interface CreatorView extends Omit<CharacterView, "values"> {
  readonly identity: string;
  readonly values: Readonly<Record<string, CreatorValue>>;
  /** The head's facial shape (region → target) the V now has, for the preview's head (the third-person group). */
  readonly faceMorphs: readonly { readonly region: string; readonly target: string }[];
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the projection: pure helpers the page's application service and the panel share.

/** The option a row shows: its active one (from the view), else its first while the view is on its way; null when none is part of the V. */
export function rowOption(panel: Readonly<CcPanel>, row: Readonly<CcPanelRow>, view: Readonly<CreatorView> | null): CcPanelOption | null {
  const options = row.options.map(index => panel.options[index]!);
  if (!view) return options[0] ?? null;
  return options.find(option => view.values[option.id]?.active) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// The page's readers: the host is the Studio's own, but the page and the host may be built apart, so the shape is checked.

const fail = (what: string): never => { throw Object.assign(Error(`The creator options from the preview host can't be read (${what}).`), { unreadable: true }); };
const str = (value: unknown, what: string, max = 512) => typeof value === "string" && value.length <= max ? value : fail(what);
const int = (value: unknown, what: string, max: number) => Number.isInteger(value) && (value as number) >= -1 && (value as number) <= max ? value as number : fail(what);
const GROUP_KINDS = new Set<unknown>(["game", "xf", "author", "mod"]);
const PARTS = new Set(["head", "body", "arms"]), TYPES = new Set(["appearance", "morph", "switcher"]), STATUS = new Set(["rendered", "conditional", "uncensored", "not-rendered"]);
const name = (value: unknown, what: string, allowEmpty = false) => isCreatorName(value, allowEmpty) ? value : fail(what);

export function readCcPanel(value: unknown): CcPanel {
  const panel = value as CcPanel;
  if (!panel || panel.schema !== CC_PANEL_SCHEMA) fail("version");
  if (panel.bodyGender !== "female" && panel.bodyGender !== "male") fail("body");
  const mods = Array.isArray(panel.mods) ? panel.mods.map(entry => str(entry, "mod")) : fail("mods");
  const notes = Array.isArray(panel.notes) ? panel.notes.map(entry => str(entry, "note", 1024)) : fail("notes");
  if (!Array.isArray(panel.groups) || !panel.groups.length || panel.groups.length > mods.length + 1 || panel.groups[0]?.kind !== "game") fail("groups");
  const groups = panel.groups.map(group => ({ label: str(group?.label, "group"), kind: GROUP_KINDS.has(group?.kind) ? group.kind : fail("group kind") }));
  if (!Array.isArray(panel.modGroups) || panel.modGroups.length !== mods.length) fail("mod groups");
  const modGroups = panel.modGroups.map(at => int(at, "mod group", groups.length - 1) < 0 ? fail("mod group") : at);
  if (!Array.isArray(panel.options) || panel.options.length > 20_000) fail("options");
  const options = panel.options.map(option => {
    if (!option || !PARTS.has(option.part) || !TYPES.has(option.type) || !Array.isArray(option.coverage) || !STATUS.has(option.coverage[0])) fail("an option");
    return { id: str(option.id, "id"), part: option.part, name: name(option.name, "name"), label: str(option.label, "label"), type: option.type,
      grid: option.grid === true, count: int(option.count, "count", 1_000_000), off: option.off === null ? null : name(option.off, "off", true),
      defaultChoice: option.defaultChoice === null ? null : str(option.defaultChoice, "default"), mod: int(option.mod, "mod", mods.length - 1),
      link: option.link ? { key: str(option.link.key, "link"), controller: option.link.controller === true } : null,
      dependsOn: Array.isArray(option.dependsOn) ? option.dependsOn.slice(0, 16).map(entry => str(entry, "depends")) : [],
      coverage: [option.coverage[0], int(option.coverage[1], "coverage", notes.length - 1)] as const,
      groups: Math.max(0, int(option.groups, "groups", groups.length)) } satisfies CcPanelOption;
  });
  if (!Array.isArray(panel.sections)) fail("sections");
  const sections = panel.sections.map(section => ({ id: str(section?.id, "section"), label: str(section?.label, "section label"), makeup: section.makeup === true,
    rows: Array.isArray(section.rows) ? section.rows.map(row => ({ slot: str(row?.slot, "slot"), part: PARTS.has(row?.part) ? row.part : fail("row part"),
      options: Array.isArray(row.options) ? (row.options as unknown[]).map(i => int(i, "row option", options.length - 1)) : fail("row options") })) : fail("rows") }));
  return { schema: CC_PANEL_SCHEMA, bodyGender: panel.bodyGender, identity: str(panel.identity, "identity"), language: panel.language === null ? null : str(panel.language, "language"),
    mods, groups, modGroups, notes, options, sections, counts: { options: options.length, choices: Number(panel.counts?.choices) || 0, modChoices: Number(panel.counts?.modChoices) || 0 } };
}

export function readChoicePage(value: unknown, mods: number): CcChoicePage {
  const page = value as CcChoicePage;
  if (!page || !Array.isArray(page.choices) || page.choices.length > CC_PAGE_SIZE) fail("choices");
  return { identity: str(page.identity, "identity"), option: str(page.option, "option"), query: str(page.query ?? "", "query", 80),
    offset: int(page.offset, "offset", 1_000_000), total: int(page.total, "total", 1_000_000),
    choices: page.choices.map(choice => ({ key: name(choice?.key, "key", true), position: int(choice.position, "position", 1_000_000), label: str(choice?.label, "label"),
      off: choice.off === true, color: choice.color === null ? null : /^#[0-9a-f]{6}$/.test(String(choice.color)) ? String(choice.color) : fail("colour"),
      mod: int(choice.mod, "mod", mods - 1),
      ...(choice.activates === undefined ? {} : { activates: Array.isArray(choice.activates) && choice.activates.length <= CREATOR_LIMITS.activates
        ? choice.activates.map(entry => name(entry, "activated option")) : fail("activated options") }) })) };
}

const SWATCH_TEXT = /^!?#[0-9a-f]{6}(?:>#[0-9a-f]{6}){0,7}$/, ICON_TEXT = /^\d{1,3}:\d{1,6}$/;
/** Most positions a swatch answer lists (the largest colour rows have a few hundred choices). */
export const SWATCH_POSITIONS_MAX = 100_000;
export function readSwatches(value: unknown): CcSwatches {
  const answer = value as CcSwatches;
  if (!answer || !Array.isArray(answer.swatches) || !Array.isArray(answer.icons) || !Array.isArray(answer.sheets) ||
    answer.swatches.length > SWATCH_POSITIONS_MAX || answer.icons.length > SWATCH_POSITIONS_MAX || answer.sheets.length > 256) fail("swatches");
  return { identity: str(answer.identity, "identity"), option: str(answer.option, "option"), pending: answer.pending === true,
    swatches: answer.swatches.map(text => text === "" || SWATCH_TEXT.test(String(text)) ? String(text) : fail("swatch")),
    icons: answer.icons.map(text => text === "" || ICON_TEXT.test(String(text)) ? String(text) : fail("icon")),
    sheets: answer.sheets.map(sheet => ({ id: int(sheet?.id, "sheet", 255), key: /^[a-f0-9]{8,64}$/.test(String(sheet?.key)) ? String(sheet.key) : fail("sheet key"),
      columns: int(sheet.columns, "sheet", 4096), rows: int(sheet.rows, "sheet", 4096), cell: int(sheet.cell, "sheet", 512) })) };
}

export function readChoiceSearch(value: unknown): CcChoiceSearch {
  const search = value as CcChoiceSearch;
  if (!search || !Array.isArray(search.options) || search.options.length > SEARCH_LIMIT) fail("search");
  return { identity: str(search.identity, "identity"), query: str(search.query, "query", 80), options: search.options.map(id => str(id, "option")),
    more: search.more === true };
}
