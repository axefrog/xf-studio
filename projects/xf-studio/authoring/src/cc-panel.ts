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
 *
 * Nothing here names an option, a slot or a mod.
 */
import type { CcoPart } from "./cco-model";
import { type BodyGender, CatalogueIndex, type CcCatalogue, type CcOption, followsLink, userFacing } from "./cc-catalogue";
import type { RenderCoverage, RenderStatus } from "./cc-render-coverage";
import type { CharacterChange, CharacterView } from "./character-context";
import { CREATOR_LIMITS, isCreatorName } from "./creator-names";

export const CC_PANEL_SCHEMA = "xfs/cc-panel-3" as const;
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
  /** The key of its Off choice (adds nothing where its other choices add something), when it has one. */
  readonly off: string | null;
  readonly defaultChoice: string | null;
  /** Index into `mods`, or -1 for vanilla. */
  readonly mod: number;
  readonly link: { readonly key: string; readonly controller: boolean } | null;
  /** Labels of the switchers whose choices turn it on (it takes part only through them). */
  readonly dependsOn: readonly string[];
  /** Preview coverage: status and an index into `notes`. */
  readonly coverage: readonly [RenderStatus, number];
}
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
/** The options with a choice matching a search (`searchChoices`). */
export interface CcChoiceSearch { readonly identity: string; readonly query: string; readonly options: readonly string[]; readonly more: boolean }

const hex = (rgba: readonly number[] | null | undefined) => rgba
  ? `#${rgba.slice(0, 3).map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}` : null;

/** The panel's first-paint projection of a catalogue, with the preview's coverage of each option. */
export function panelProjection(catalogue: CcCatalogue, coverage: ReadonlyMap<string, RenderCoverage>, identity: string): { panel: CcPanel; mods: Map<string, number> } {
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
  // Every mod any choice names, so a page's choices can refer to the same table.
  for (const option of catalogue.options) {
    if (option.provenance.kind === "mod") modIndex(option.provenance.mod);
    for (const choice of option.choices) if (choice.provenance.kind === "mod") modIndex(choice.provenance.mod);
  }
  const options: CcPanelOption[] = [], at = new Map<string, number>();
  const add = (option: CcOption) => {
    const known = at.get(option.id);
    if (known !== undefined) return known;
    const shown = coverage.get(option.id) ?? { status: "not-rendered" as const, note: "" };
    const entry: CcPanelOption = { id: option.id, part: option.part, name: option.name, label: option.label.text, type: option.type,
      // An Off choice is one that adds nothing while others add something (every choice of a colour-only controller adds nothing itself).
      grid: option.useThumbnails, count: option.choices.length,
      off: option.choices.some(choice => !choice.off) ? option.choices.find(choice => choice.off)?.key ?? null : null,
      defaultChoice: option.defaultChoice, mod: option.provenance.kind === "mod" ? modIndex(option.provenance.mod) : -1,
      link: option.link ? { ...option.link } : null,
      dependsOn: option.controlledBy.map(name => index.option(option.part, name)?.label.text ?? name),
      coverage: [shown.status, noteIndex(shown.note)] };
    at.set(option.id, options.length);
    options.push(entry);
    return options.length - 1;
  };
  const sections: CcPanelSection[] = catalogue.sections.map(section => ({ id: section.id, label: section.label.text, makeup: section.id === MAKEUP_CATEGORY,
    rows: section.rows.map(row => ({ slot: row.slot, part: row.part,
      options: row.options.flatMap(id => { const option = index.byOptionId(id); return option ? [add(option)] : []; }) })) }));
  const choices = catalogue.options.reduce((n, option) => n + option.choices.length, 0);
  return { mods, panel: { schema: CC_PANEL_SCHEMA, bodyGender: catalogue.bodyGender, identity, language: catalogue.language,
    mods: [...mods.keys()], notes: [...notes.keys()], options, sections,
    counts: { options: options.length, choices, modChoices: catalogue.counts.modChoices } } };
}

/** A search as both sides compare it: trimmed, lower-case, bounded. */
export const searchQuery = (text: string) => text.trim().toLowerCase().slice(0, 80);
const matches = (choice: { key: string; label: { text: string } }, query: string) =>
  !query || choice.label.text.toLowerCase().includes(query) || choice.key.toLowerCase().includes(query);
const offered = (option: CcOption | undefined): option is CcOption => !!option && userFacing(option) && !followsLink(option);

/**
 * One page of an option's choices (with `query`, of its choices matching it), or null for an option the panel doesn't offer. A choice
 * whose key or activated options break the shared name rule can't be carried back to the host, so it isn't offered.
 */
export function choicePage(index: CatalogueIndex, mods: ReadonlyMap<string, number>, optionId: string, offset: number,
  options: { identity?: string; query?: string; limit?: number } = {}): CcChoicePage | null {
  const option = index.byOptionId(optionId);
  if (!offered(option)) return null;
  const query = searchQuery(options.query ?? "");
  const all = option.choices.filter(choice => isCreatorName(choice.key, true) && choice.activates.length <= CREATOR_LIMITS.activates &&
    choice.activates.every(name => isCreatorName(name)) && matches(choice, query));
  const start = Math.max(0, Math.min(all.length, Math.floor(offset)));
  const someAdd = option.choices.some(choice => !choice.off);
  return { identity: options.identity ?? "", option: option.id, query, offset: start, total: all.length,
    choices: all.slice(start, start + Math.max(1, Math.min(CC_PAGE_SIZE, options.limit ?? CC_PAGE_SIZE))).map(choice => ({ key: choice.key,
      position: choice.position, label: choice.label.text, off: choice.off && someAdd, color: hex(choice.swatch?.color),
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
/** Every makeup row's change to Off: the active options of the marked section that have an Off choice and aren't Off already. */
export function makeupOff(panel: Readonly<CcPanel>, view: Readonly<CreatorView> | null): CharacterChange[] {
  if (!view) return [];
  return panel.sections.filter(entry => entry.makeup).flatMap(entry => entry.rows).flatMap(row => {
    const option = rowOption(panel, row, view), value = option && view.values[option.id];
    return option && value && option.off !== null && value.choice !== option.off ? [{ part: option.part, option: option.name, choice: option.off }] : [];
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The page's readers: the host is the Studio's own, but the page and the host may be built apart, so the shape is checked.

const fail = (what: string): never => { throw Object.assign(Error(`The creator options from the preview host can't be read (${what}).`), { unreadable: true }); };
const str = (value: unknown, what: string, max = 512) => typeof value === "string" && value.length <= max ? value : fail(what);
const int = (value: unknown, what: string, max: number) => Number.isInteger(value) && (value as number) >= -1 && (value as number) <= max ? value as number : fail(what);
const PARTS = new Set(["head", "body", "arms"]), TYPES = new Set(["appearance", "morph", "switcher"]), STATUS = new Set(["rendered", "conditional", "uncensored", "not-rendered"]);
const name = (value: unknown, what: string, allowEmpty = false) => isCreatorName(value, allowEmpty) ? value : fail(what);

export function readCcPanel(value: unknown): CcPanel {
  const panel = value as CcPanel;
  if (!panel || panel.schema !== CC_PANEL_SCHEMA) fail("version");
  if (panel.bodyGender !== "female" && panel.bodyGender !== "male") fail("body");
  const mods = Array.isArray(panel.mods) ? panel.mods.map(entry => str(entry, "mod")) : fail("mods");
  const notes = Array.isArray(panel.notes) ? panel.notes.map(entry => str(entry, "note", 1024)) : fail("notes");
  if (!Array.isArray(panel.options) || panel.options.length > 20_000) fail("options");
  const options = panel.options.map(option => {
    if (!option || !PARTS.has(option.part) || !TYPES.has(option.type) || !Array.isArray(option.coverage) || !STATUS.has(option.coverage[0])) fail("an option");
    return { id: str(option.id, "id"), part: option.part, name: name(option.name, "name"), label: str(option.label, "label"), type: option.type,
      grid: option.grid === true, count: int(option.count, "count", 1_000_000), off: option.off === null ? null : name(option.off, "off", true),
      defaultChoice: option.defaultChoice === null ? null : str(option.defaultChoice, "default"), mod: int(option.mod, "mod", mods.length - 1),
      link: option.link ? { key: str(option.link.key, "link"), controller: option.link.controller === true } : null,
      dependsOn: Array.isArray(option.dependsOn) ? option.dependsOn.slice(0, 16).map(entry => str(entry, "depends")) : [],
      coverage: [option.coverage[0], int(option.coverage[1], "coverage", notes.length - 1)] as const } satisfies CcPanelOption;
  });
  if (!Array.isArray(panel.sections)) fail("sections");
  const sections = panel.sections.map(section => ({ id: str(section?.id, "section"), label: str(section?.label, "section label"), makeup: section.makeup === true,
    rows: Array.isArray(section.rows) ? section.rows.map(row => ({ slot: str(row?.slot, "slot"), part: PARTS.has(row?.part) ? row.part : fail("row part"),
      options: Array.isArray(row.options) ? (row.options as unknown[]).map(i => int(i, "row option", options.length - 1)) : fail("row options") })) : fail("rows") }));
  return { schema: CC_PANEL_SCHEMA, bodyGender: panel.bodyGender, identity: str(panel.identity, "identity"), language: panel.language === null ? null : str(panel.language, "language"),
    mods, notes, options, sections, counts: { options: options.length, choices: Number(panel.counts?.choices) || 0, modChoices: Number(panel.counts?.modChoices) || 0 } };
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

export function readChoiceSearch(value: unknown): CcChoiceSearch {
  const search = value as CcChoiceSearch;
  if (!search || !Array.isArray(search.options) || search.options.length > SEARCH_LIMIT) fail("search");
  return { identity: str(search.identity, "identity"), query: str(search.query, "query", 80), options: search.options.map(id => str(id, "option")),
    more: search.more === true };
}
