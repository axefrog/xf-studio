/**
 * The Character panel's view of the creator catalogue (UI-59): a compact projection the host sends to the page instead of the
 * catalogue itself (130,000 choices with provenance, labels and swatches on the reference installation). Pure and shared: the host
 * builds it once per catalogue (cc-catalogue-service.ts), the page reads it with `readCcPanel` and `readChoicePage`.
 *
 * - **First paint** (`panelProjection`): sections, then rows, then every user-facing option of each row with what a row needs to
 *   draw without its choices: label, kind, choice count, the Off and default choice keys, link, the switchers it depends on,
 *   preview coverage (the preview side's projection, cc-render-coverage.ts) and provenance. Mods and coverage notes are tables
 *   referenced by index, so a name or sentence repeated across hundreds of options is sent once.
 * - **Choices** (`choicePage`), paged per option, fetched when a row is opened: key, label, Off flag, swatch colour, provenance.
 *
 * Nothing here names an option, a slot or a mod.
 */
import type { CcoPart } from "./cco-model";
import { type BodyGender, CatalogueIndex, type CcCatalogue, type CcOption, followsLink, userFacing } from "./cc-catalogue";
import type { RenderCoverage, RenderStatus } from "./cc-render-coverage";
import type { CharacterView } from "./character-context";

export const CC_PANEL_SCHEMA = "xfs/cc-panel-1" as const;
export const CC_PAGE_SIZE = 240;

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
export interface CcPanelSection { readonly id: string; readonly label: string; readonly rows: readonly CcPanelRow[] }
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
  readonly label: string;
  readonly off: boolean;
  /** `#rrggbb`, when the choice has a swatch colour. */
  readonly color: string | null;
  /** Index into the panel's `mods`, or -1 for vanilla. */
  readonly mod: number;
}
export interface CcChoicePage {
  readonly option: string;
  readonly offset: number;
  readonly total: number;
  readonly choices: readonly CcPanelChoice[];
}

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
  const sections: CcPanelSection[] = catalogue.sections.map(section => ({ id: section.id, label: section.label.text,
    rows: section.rows.map(row => ({ slot: row.slot, part: row.part,
      options: row.options.flatMap(id => { const option = index.byOptionId(id); return option ? [add(option)] : []; }) })) }));
  const choices = catalogue.options.reduce((n, option) => n + option.choices.length, 0);
  return { mods, panel: { schema: CC_PANEL_SCHEMA, bodyGender: catalogue.bodyGender, identity, language: catalogue.language,
    mods: [...mods.keys()], notes: [...notes.keys()], options, sections,
    counts: { options: options.length, choices, modChoices: catalogue.counts.modChoices } } };
}

/** One page of an option's choices, or null for an option the panel doesn't offer. */
export function choicePage(index: CatalogueIndex, mods: ReadonlyMap<string, number>, optionId: string, offset: number, limit = CC_PAGE_SIZE): CcChoicePage | null {
  const option = index.byOptionId(optionId);
  if (!option || !userFacing(option) || followsLink(option)) return null;
  const start = Math.max(0, Math.min(option.choices.length, Math.floor(offset)));
  const someAdd = option.choices.some(choice => !choice.off);
  return { option: option.id, offset: start, total: option.choices.length,
    choices: option.choices.slice(start, start + Math.max(1, Math.min(CC_PAGE_SIZE, limit))).map(choice => ({ key: choice.key,
      label: choice.label.text, off: choice.off && someAdd, color: hex(choice.swatch?.color), mod: choice.provenance.kind === "mod" ? mods.get(choice.provenance.mod ?? "") ?? -1 : -1 })) };
}

/** The host's catalogue state for the panel (`GET ?gender=`). */
export type CreatorPhase = "preparing" | "ready" | "failed";
export interface CreatorState { readonly phase: CreatorPhase; readonly message: string; readonly panel?: CcPanel }
/** One option's value as the panel shows it: the view's value, with the current and own choices' labels and swatch colours. */
export interface CreatorValue {
  readonly choice: string; readonly own: string; readonly set: boolean; readonly active: boolean;
  readonly label: string; readonly color: string | null; readonly ownLabel: string;
}
export interface CreatorView extends Omit<CharacterView, "values"> {
  readonly identity: string;
  readonly values: Readonly<Record<string, CreatorValue>>;
  /** The head's facial shape (region → target) the V now has, for the preview's head (the third-person group). */
  readonly faceMorphs: readonly { readonly region: string; readonly target: string }[];
}

// ---------------------------------------------------------------------------------------------------------------
// The page's readers: the host is the Studio's own, but the page and the host may be built apart, so the shape is checked.

const fail = (what: string): never => { throw Error(`The creator options from the preview host can't be read (${what}).`); };
const str = (value: unknown, what: string, max = 512) => typeof value === "string" && value.length <= max ? value : fail(what);
const int = (value: unknown, what: string, max: number) => Number.isInteger(value) && (value as number) >= -1 && (value as number) <= max ? value as number : fail(what);
const PARTS = new Set(["head", "body", "arms"]), TYPES = new Set(["appearance", "morph", "switcher"]), STATUS = new Set(["rendered", "conditional", "not-rendered"]);

export function readCcPanel(value: unknown): CcPanel {
  const panel = value as CcPanel;
  if (!panel || panel.schema !== CC_PANEL_SCHEMA) fail("version");
  if (panel.bodyGender !== "female" && panel.bodyGender !== "male") fail("body");
  const mods = Array.isArray(panel.mods) ? panel.mods.map(name => str(name, "mod")) : fail("mods");
  const notes = Array.isArray(panel.notes) ? panel.notes.map(note => str(note, "note", 1024)) : fail("notes");
  if (!Array.isArray(panel.options) || panel.options.length > 20_000) fail("options");
  const options = panel.options.map(option => {
    if (!option || !PARTS.has(option.part) || !TYPES.has(option.type) || !Array.isArray(option.coverage) || !STATUS.has(option.coverage[0])) fail("an option");
    return { id: str(option.id, "id"), part: option.part, name: str(option.name, "name"), label: str(option.label, "label"), type: option.type,
      grid: option.grid === true, count: int(option.count, "count", 1_000_000), off: option.off === null ? null : str(option.off, "off"),
      defaultChoice: option.defaultChoice === null ? null : str(option.defaultChoice, "default"), mod: int(option.mod, "mod", mods.length - 1),
      link: option.link ? { key: str(option.link.key, "link"), controller: option.link.controller === true } : null,
      dependsOn: Array.isArray(option.dependsOn) ? option.dependsOn.slice(0, 16).map(name => str(name, "depends")) : [],
      coverage: [option.coverage[0], int(option.coverage[1], "coverage", notes.length - 1)] as const } satisfies CcPanelOption;
  });
  if (!Array.isArray(panel.sections)) fail("sections");
  const sections = panel.sections.map(section => ({ id: str(section?.id, "section"), label: str(section?.label, "section label"),
    rows: Array.isArray(section.rows) ? section.rows.map(row => ({ slot: str(row?.slot, "slot"), part: PARTS.has(row?.part) ? row.part : fail("row part"),
      options: Array.isArray(row.options) ? (row.options as unknown[]).map(i => int(i, "row option", options.length - 1)) : fail("row options") })) : fail("rows") }));
  return { schema: CC_PANEL_SCHEMA, bodyGender: panel.bodyGender, identity: str(panel.identity, "identity"), language: panel.language === null ? null : str(panel.language, "language"),
    mods, notes, options, sections, counts: { options: options.length, choices: Number(panel.counts?.choices) || 0, modChoices: Number(panel.counts?.modChoices) || 0 } };
}

export function readChoicePage(value: unknown, mods: number): CcChoicePage {
  const page = value as CcChoicePage;
  if (!page || !Array.isArray(page.choices) || page.choices.length > CC_PAGE_SIZE) fail("choices");
  return { option: str(page.option, "option"), offset: int(page.offset, "offset", 1_000_000), total: int(page.total, "total", 1_000_000),
    choices: page.choices.map(choice => ({ key: str(choice?.key, "key"), label: str(choice?.label, "label"), off: choice.off === true,
      color: choice.color === null ? null : /^#[0-9a-f]{6}$/.test(String(choice.color)) ? String(choice.color) : fail("colour"),
      mod: int(choice.mod, "mod", mods - 1) })) };
}
