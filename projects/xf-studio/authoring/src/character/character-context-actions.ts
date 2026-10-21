/**
 * Application service that owns the character context in the Studio (CORE-58): which V the makeup is shown on (the creator's default
 * V, a loaded save, or a portable preset) and every creator choice a person set on it. DOM-free. It holds only what the person set
 * (portable identities, character-context.ts) and asks the preview host (through `CreatorPort`) for everything derived from the
 * installed catalogue: the panel's options, their choices page by page, searches, and the view of every row's current choice.
 *
 * - **History** (CORE-59): creator changes have their own small Undo history, separate from the makeup look's. Each step is one
 *   whole context state; loading a save or a preset is one step. It lives in memory only.
 * - **The V's own makeup** (`character.setOwnMakeup`, CORE-71): a viewing setting, not a creator choice. Hiding it hides, in the 3D view,
 *   the parts every row of the makeup section brings (the host's projection marks the section; `hiddenOptions`), which are already
 *   prepared, so it applies at once and nothing is prepared again. It joins the panel's one Undo, survives a change of V and is stored
 *   with the workspace while hidden. Reset all leaves it alone.
 * - **One Undo for the Character panel** (UI-81): `character.undo` and `character.redo` step back and forward through every change
 *   made in the panel, creator choices and Clothing alike, in the order they were made (`order`); a new change of either kind clears
 *   what could be redone. `character.undoClothing` and `character.redoClothing` still step the Clothing setting's own steps alone.
 * - **A new V clears the choices made on the previous one**; `character.keepChanges` puts them back on the new V as one more step
 *   (offered until the next change).
 * - **Gating** (CORE-73): every action that changes choices needs the catalogue of the shown V's body (`not_ready` until then); a V
 *   change (default V, a save, a preset) and Undo/Redo don't, so a V is never stuck behind a catalogue that failed. Changes are checked
 *   whole by the shared rule (creator-names.ts) before anything changes.
 * - **Failures are explicit** (PIPE-78, PREV-86): a catalogue that couldn't be read, or a V that couldn't be prepared, stays failed with
 *   its plain line until `character.retry`; nothing retries by itself.
 * - **A catalogue changes under the page** (another mod set, PIPE-81): every page and view names the catalogue it came from; an answer
 *   from another catalogue starts the panel again. A body change (CORE-72) drops every page, search and view still on its way.
 * - **Presets** carry what one V holds (PIPE-79): entries past the limit, or with a name too long for the shared rule, are reported and
 *   never sent; they stay in the kept entries and are written back on export. Once the host has matched the preset's choices, only
 *   the entries it couldn't match are kept (CORE-74).
 * - **Persistence**: the choices, the V source and a loaded preset's kept entries go into the workspace's preview state
 *   (`stored()`), only once something was set, so a workspace that never uses these controls keeps its stored bytes. An earlier build's
 *   tried piercing style (the retired preview fields) becomes the matching Piercings choices once the catalogue is ready, if the context
 *   is untouched and the installation offers that pair (CORE-74).
 *
 * - **Preparing choices ahead** (choice-prefetch.ts): an open row asks the host to prepare its choices in the background, visible ones
 *   first, and reads back each choice's state (not prepared yet, being prepared, ready, failed) per row, polled while the host has work
 *   (`prefetch`); a hover or focus hint moves one choice to the front, and closing the row stops it (`stopPrefetch`). A change to a
 *   choice that wasn't ready is marked first-time (`snapshot().firstTime`), so the status line can say why it takes a moment.
 * - **Prepared game files**: their size on this computer, and `character.clearPreparedFiles` removes them (prepared-files.ts).
 * - **Clothing** (clothing-dressing.ts): which of V's clothes the preview dresses her in, a viewing setting with its own small Undo history
 *   (`character.setClothing`, `character.setClothingArea`, `character.undoClothing`, `character.redoClothing`). It survives a change of V,
 *   is stored with the workspace only when it differs from the default, and goes into every request the context builds.
 *
 * Presentation reads it through `snapshot()` (small, cloned) and the frozen `panel()`, `view()`, `choices(option)` and `search(query)`
 * (large, shared read-only objects, never cloned per paint).
 */
import type { CcoPart } from "./cco-model";
import type { BodyGender } from "./cc-catalogue";
import { type CcChoicePage, type CcChoiceSearch, type CcSwatches, type CcPanel, type CcPanelChoice, type CcPanelOption, CC_PAGE_SIZE, type CreatorNext, type CreatorState, type CreatorView } from "./cc-panel";
import { type CcPreset, parseCcPreset, serializeCcPreset, serializeCcPresetEntry } from "./cc-preset";
import { carryPreset, type CharacterChange, type CharacterChoice, characterChoiceOf, type CharacterContextAction, type MissingChoice,
  type SavedDescriptors, savedDescriptorsOf, summariseMissing } from "./character-context";
import { characterRequestOf, type CharacterRequest } from "./character-detail-request";
import { CREATOR_LIMITS, isPresetName } from "./creator-names";
import type { DisplayedSwatchState } from "./cc-swatch-display";
import { refusal, type Capability } from "../platform/api";
import type { SavedV } from "../saves/save-reader";
import { CLOTHING_AREA_LABELS, CLOTHING_STATE_LABELS, CLOTHING_STATES, type ClothingSetting, clothingSettingOf, type ClothingState, DEFAULT_CLOTHING,
  dressingFor, HEADWEAR_AREAS, UNDERWEAR_AREAS } from "./clothing-dressing";
import { CLOTHING_AREAS, type ClothingArea, wornAreas } from "../saves/save-loadout";
import type { ChoicePreviewPort, ChoicePreviewRow } from "./choice-preview-service";
import { CreatorCatalogue } from "./creator-catalogue";
import { ChoicePreviewOwner } from "./choice-preview-owner";
import { CreatorRequester, type RequesterHost } from "./creator-requester";
import { characterHistory, type CharacterHistoryHome, type CharacterHistoryKey, privateHistory } from "./character-history";
import type { HistoryScope } from "../platform/core/history-service";
export { PRELOAD_DWELL_MS } from "./creator-requester";

/** The host side of the context: the installed catalogue's panel, pages, searches, views and presets (cc-catalogue-server.ts). */
export type CreatorPort = {
  panel(gender: BodyGender, signal: AbortSignal): Promise<CreatorState>;
  page(gender: BodyGender, option: string, offset: number, signal: AbortSignal, query?: string): Promise<CcChoicePage>;
  view(request: CharacterRequest, signal: AbortSignal): Promise<CreatorView>;
  preset(request: CharacterRequest, name: string | null, kept: Record<string, unknown> | undefined): Promise<{ text: string; values: number; leftOut: number; personal: number }>;
  wait(ms: number, signal: AbortSignal): Promise<void>;
  /** The options with a choice matching a search (UI-72). */
  search?(gender: BodyGender, query: string, signal: AbortSignal): Promise<CcChoiceSearch>;
  /** Try the catalogue again after a failed build; answers as `panel`. */
  retry?(gender: BodyGender, signal: AbortSignal): Promise<CreatorState>;
  /** The choices an earlier build's tried piercing style stands for on this installation (CORE-74). */
  legacy?(gender: BodyGender, style: string, definition: string): Promise<CharacterChoice[]>;
  /**
   * Prepare a row's choices ahead (visible ones first; `focus` first of all) and answer their states, one character per position.
   * `requester`: who asks (a character's panel instance); each requester's row is its own job on the host.
   */
  prefetch?(request: CharacterRequest, option: string, positions: readonly number[], focus: number | null, signal: AbortSignal, requester?: string): Promise<PrefetchReply>;
  /** Stop preparing ahead (the row closed): `requester`'s row only, or without one every row. */
  stopPrefetch?(requester?: string): Promise<void>;
  /** A colour row's swatches and icons by position (`pending` while the host is still working them out). */
  swatches?(gender: BodyGender, option: string, signal: AbortSignal): Promise<CcSwatches>;
  /** Where the page fetches an icon sheet. */
  sheetUrl?(gender: BodyGender, id: number, key: string): string;
  /** The prepared game files' size on this computer, and clearing them. */
  preparedFiles?(signal?: AbortSignal): Promise<{ bytes: number }>;
  clearPrepared?(): Promise<{ freed: number }>;
};
/** The host's answer about a row's choices prepared ahead (choice-prefetch.ts `PrefetchAnswer`). */
export type PrefetchReply = { states: string; stopped: "time" | "disk" | "setup" | null; busy: boolean };
/**
 * One choice prepared ahead: `?` not known yet, `n` not prepared (the host stopped preparing ahead), `q` waiting to be prepared,
 * `f` being prepared, `r` ready, `x` couldn't be prepared ahead this time.
 */
export type ChoiceFetch = "?" | "n" | "q" | "f" | "r" | "x";
export type CharacterFetchState = { readonly option: string; readonly states: ReadonlyMap<number, ChoiceFetch>; readonly stopped: "time" | "disk" | "setup" | null;
  readonly busy: boolean };
export type CharacterContextPorts = {
  /** The host's creator catalogue, when no shared `catalogue` is given (a fixture, a test): the context keeps a private one over it. */
  creator?: CreatorPort;
  /** The page's shared creator catalogue (creator-catalogue.ts): every character of a body shares its panel, pages and tables. */
  catalogue?: CreatorCatalogue;
  /** This character's requester name with the catalogue (`<character>`; its panel instances are `<character>/<instance>`). */
  requester?: string;
  /** Where the character's Undo history lives (the history service's `character:<id>`); default: a private one. */
  history?: CharacterHistoryHome;
  /**
   * The character's document, when an owner holds it (character-service.ts): whether it changed in another window while this one changed
   * it too (a conflict), and resolving that. Every change the context makes, its source included, reaches the document through the
   * owner's outbox; the context never waits for the library.
   */
  document?: CharacterDocumentPort;
  /** Show a save's V on the head (its facial shape and body), or none for the default V: used when Undo returns to another V. */
  showSave(save: SavedV | null): void;
  /**
   * The shown V's preparation (character-detail-actions.ts): whether it failed, and Try again (PREV-86); `preload` loads a prepared
   * change's parts ahead without showing it (a choice under the pointer, PREV-189).
   */
  details?: { failed(): boolean; retry(): void; preload?(request: CharacterRequest, signal: AbortSignal): Promise<void> };
  /** Choice previews (choice-preview-service.ts): pictures of a shape row's choices, drawn off the main thread. */
  previews?: ChoicePreviewPort;
};
/** The status line's note once another version replaced the V (the owner names where it came from: `replace`'s `note`). */
const ELSEWHERE = "Changed elsewhere. Undo starts here.";
/** A conflict on the character's document (profiles design §2.2), as the Character panel shows it. */
export type CharacterConflict = { readonly message: string; readonly keepBoth: boolean };
export type CharacterDocumentPort = {
  conflict(): CharacterConflict | null;
  /** Keep mine (over theirs), Use theirs, or Keep both (mine becomes a copy of the V). */
  resolve(keep: "mine" | "theirs" | "both"): Capability;
  /** Why the V can't take changes now (a change from the last session is still being restored, style guide t-recovering), or null. */
  restoring?(): string | null;
  /** Whether a save being loaded is the very one the V comes from and can't show yet: loading it then only imports it (`importSave`). */
  namesSave?(value: unknown): boolean;
  /** Import that save (an immutable put, taken while restoring); the context is brought up to the V's document with it. */
  importSave?(value: unknown): void;
};
/** Actions that change the V (refused while a change from the last session is still being restored). */
const CHANGES = new Set<CharacterContextAction["kind"]>(["character.setSource", "character.setOption", "character.setOptions", "character.setOwnMakeup",
  "character.reset", "character.resetAll", "character.useDefault", "character.loadSave", "character.loadPreset", "character.keepChanges",
  "character.undo", "character.redo", "character.setClothing", "character.setClothingArea"]);
export type ContextOrigin = { readonly kind: "default" } | { readonly kind: "save" } | { readonly kind: "preset"; readonly name: string | null };
type State = {
  readonly origin: ContextOrigin;
  readonly bodyGender: BodyGender;
  /** The save the V comes from (origin `save`), with its validated descriptors. */
  readonly save: { readonly value: SavedV; readonly saved: SavedDescriptors } | null;
  readonly choices: readonly CharacterChoice[];
  /** A loaded preset's entries this installation couldn't use, unknown entries and fields: written back on export. */
  readonly kept: CcPreset | null;
  /** A loaded preset's entries the page couldn't carry to the host (PIPE-79): reported, never sent. */
  readonly notCarried: readonly MissingChoice[];
};
/**
 * Where the panel's Undo history lives (the history service's `character:<id>` scope, character-history.ts), carried from one head to the
 * next when the V changes body (each body has its own head, so the head attachment is made again; browser-head-attachment.ts): the next
 * context binds to the same scope. Opaque to everyone but this service.
 */
export type ContextHistory = { readonly kind: "xfs/character-history"; readonly history: unknown };
const isHome = (value: unknown): value is CharacterHistoryHome => {
  const home = value as CharacterHistoryHome | null;
  return !!home && typeof home === "object" && typeof home.id === "string" && typeof home.service?.open === "function";
};
/** The workspace's form (preview state `character`): what was set and where the V came from, and the Clothing setting when not the default. */
export type StoredCharacter = { origin: "default" | "save" | "preset"; name?: string; bodyGender?: BodyGender; choices: CharacterChoice[];
  kept?: Record<string, unknown>; clothing?: ClothingSetting; ownMakeup?: "hidden" };
/**
 * The Clothing setting as the presentation reads it: the state, the areas `custom` shows, the areas the save dresses (what can be picked),
 * where the clothes come from, one plain line when there is something to say, and the setting's own Undo and Redo labels.
 */
export type ClothingSnapshot = { state: ClothingState; custom: ClothingArea[]; worn: ClothingArea[];
  /** The areas the current state shows, and the states and areas as the control words them (so the presentation derives nothing). */
  shown: ClothingArea[]; states: { value: ClothingState; label: string }[]; areas: { area: ClothingArea; label: string }[];
  source: "save" | "none" | "unread" | "older"; note: string; undo: string | null; redo: string | null };
/** An icon sheet as the panel draws from it: its URL and `columns` × `rows` cells. */
export type CharacterIconSheet = { readonly url: string; readonly columns: number; readonly rows: number };
/** A colour row's swatches and icons by choice position ("" for none), as loaded so far. */
export type CharacterSwatchState = { readonly swatches: readonly string[]; readonly icons: readonly string[];
  readonly sheets: ReadonlyMap<number, CharacterIconSheet>; readonly pending: boolean };
export type CharacterChoicesState = { readonly choices: readonly CcPanelChoice[]; readonly total: number; readonly loading: boolean; readonly error: string | null };
export type CharacterSearchState = { readonly query: string; readonly options: ReadonlySet<string> | null; readonly more: boolean; readonly loading: boolean;
  readonly error: string | null };
export type CharacterContextSnapshot = {
  /** The catalogue: loading, ready, or failed with one plain line (when ready: labels it couldn't read, or empty). */
  phase: "idle" | "preparing" | "ready" | "failed";
  message: string;
  /** Ready: the one next step for labels the catalogue couldn't read (NATIVE-46); null when there is none. */
  next: CreatorNext | null;
  origin: ContextOrigin;
  bodyGender: BodyGender;
  /** How many choices a person set. */
  set: number;
  undo: string | null;
  redo: string | null;
  /** The last V change cleared this many choices; `character.keepChanges` puts them back. */
  keepable: number;
  /** The view of the current state is on its way. */
  viewing: boolean;
  viewError: string | null;
  /** Plain lines about a loaded preset's entries that couldn't be carried (the host's own report is the view's `missing`). */
  notes: string[];
  /** `character.retry` would try something again (the catalogue, or the shown V). */
  retry: boolean;
  /** The change being prepared now is a choice that wasn't prepared ahead: it reads the game files, so it takes a moment. */
  firstTime: boolean;
  /** The prepared game files' size in bytes (null until known), and whether they are being cleared. */
  prepared: { bytes: number | null; clearing: boolean; freed: number | null };
  /** Which of V's clothes the preview shows (clothing-dressing.ts). */
  clothing: ClothingSnapshot;
  /** Whether the 3D view shows the V's own makeup (`character.setOwnMakeup`). */
  ownMakeup: boolean;
  /** The V changed in another window while this window changed it too: the panel offers which to keep (`character.resolveConflict`). */
  conflict: CharacterConflict | null;
  /** The V was replaced by another window's version (a change from elsewhere, or Use theirs): its Undo starts here. Until the next change. */
  elsewhere: string | null;
  /** Bumps on every change of state, panel, view or pages. */
  revision: number;
};

/** The Clothing setting's steps in the character's history (its own Undo is retired: `undoClothing` steps only a Clothing step on top). */
const CLOTHING_STEPS = new Set(["character.setClothing", "character.setClothingArea"]);
/** Polling the catalogue's build: while the panel is being looked at, and otherwise (PIPE-78). */
const POLL_MS = 800, POLL_IDLE_MS = 4000, WATCHED_MS = 3000;
const LOADING = "The creator options are still loading.";
const plainStep = (option: CcPanelOption | undefined, choice: string, label?: string) =>
  label ? label : option ? `Change ${option.label}` : `Change ${choice || "an option"}`;
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
};
const sameChoices = (a: readonly CharacterChoice[], b: readonly CharacterChoice[]) => JSON.stringify(a) === JSON.stringify(b);
const sameClothing = (a: ClothingSetting, b: ClothingSetting) => a.state === b.state && a.custom.join() === b.custom.join();
const sameSet = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  (a?.length ?? 0) === (b?.length ?? 0) && [...a ?? []].sort().join("\u0000") === [...b ?? []].sort().join("\u0000");
/** A save's identity by content (the saved-V service hands out copies). */
const saveKey = (save: SavedV | null | undefined) => save ? JSON.stringify([save.isMale, save.groups]) : "";
/** A change as a choice, validated by the shared rule (null when it breaks it). */
/**
 * A preset as a V carries it: its choices, the entries kept for writing back (the ones this installation can't use, and those past what
 * one V carries, verbatim; PIPE-79) and the plain reports of what wasn't carried.
 */
export function presetLoad(preset: CcPreset): { choices: CharacterChoice[]; kept: CcPreset; notCarried: MissingChoice[] } {
  const { choices, carried, notCarried } = carryPreset(preset);
  const left = preset.values.filter(entry => !carried.includes(entry)), at = preset.values.length + preset.unknownEntries.length;
  const kept: CcPreset = { ...preset, values: carried,
    unknownEntries: [...preset.unknownEntries, ...left.map((entry, i) => ({ at: at + i, entry: serializeCcPresetEntry(entry) }))] };
  return { choices, kept, notCarried };
}
/** `character.setSource`'s source as the action it stands for (null when it isn't one). */
function sourceAction(source: unknown): Extract<CharacterContextAction, { kind: "character.useDefault" | "character.loadSave" | "character.loadPreset" }> | null {
  const s = source as { kind?: unknown; bodyGender?: unknown; value?: unknown } | null;
  if (!s || typeof s !== "object") return null;
  if (s.kind === "default") return s.bodyGender === "female" || s.bodyGender === "male" ? { kind: "character.useDefault", bodyGender: s.bodyGender } : null;
  if (s.kind === "save") return { kind: "character.loadSave", value: s.value };
  if (s.kind === "preset") return { kind: "character.loadPreset", value: s.value };
  return null;
}
const changeOf = (change: unknown): CharacterChoice | null => {
  const c = change as CharacterChange | null;
  if (!c || typeof c !== "object") return null;
  return characterChoiceOf({ part: c.part, option: c.option, choice: c.choice, ...(c.activates?.length ? { activates: c.activates } : {}) });
};

/** A stored context, validated (anything else is dropped; choices past the limit are left out). */
export function storedCharacterOf(value: unknown): StoredCharacter | null {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== "object" || Array.isArray(v) || !["default", "save", "preset"].includes(v.origin as string)) return null;
  if (!Array.isArray(v.choices)) return null;
  const choices = v.choices.slice(0, CREATOR_LIMITS.choices).flatMap(item => { const choice = characterChoiceOf(item); return choice ? [choice] : []; });
  let kept: Record<string, unknown> | undefined;
  if (v.kept !== undefined) { try { kept = serializeCcPreset(parseCcPreset(v.kept)); } catch { kept = undefined; } }
  const clothing = v.clothing === undefined ? undefined : clothingSettingOf(v.clothing);
  return { origin: v.origin as StoredCharacter["origin"], ...(isPresetName(v.name) ? { name: v.name } : {}),
    ...(v.bodyGender === "female" || v.bodyGender === "male" ? { bodyGender: v.bodyGender } : {}), choices, ...(kept ? { kept } : {}),
    ...(clothing && !sameClothing(clothing, DEFAULT_CLOTHING) ? { clothing } : {}), ...(v.ownMakeup === "hidden" ? { ownMakeup: "hidden" as const } : {}) };
}

/** Where a context starts: the stored origin, else the shown save, else the default V. */
function originOf(stored: StoredCharacter | null, hasSave: boolean): ContextOrigin {
  return stored?.origin === "preset" ? { kind: "preset", name: stored.name ?? null }
    : stored?.origin === "default" || !hasSave ? { kind: "default" } : { kind: "save" };
}
/**
 * The body a context starts with, from the stored context and the shown save (as the constructor decides it): the head
 * attachment loads that body's core head before the context exists (browser-head-attachment.ts).
 */
export function initialBodyGender(stored: unknown, save: SavedV | undefined): BodyGender {
  const context = storedCharacterOf(stored);
  return originOf(context, !!save).kind === "save" ? save!.isMale ? "male" : "female" : context?.bodyGender ?? "female";
}

export class CharacterContextActions {
  private state: State;
  /** Choices a V change cleared (for `keepChanges`), until the next change. */
  private cleared: readonly CharacterChoice[] = [];
  private catalogue: { phase: CharacterContextSnapshot["phase"]; message: string; next?: CreatorNext | null; panel: CcPanel | null; gender: BodyGender | null } =
    { phase: "idle", message: "", panel: null, gender: null };
  private byId = new Map<string, CcPanelOption>();
  private currentView: CreatorView | null = null;
  private viewKey: string | null = null;
  /** The host's last view with the current state's choices shown on it while the host's view of that state is on its way (`view`). */
  private shownView: { key: string; from: CreatorView; view: CreatorView } | null = null;
  private viewing: { key: string; controller: AbortController } | null = null;
  private viewError: string | null = null;
  /**
   * The catalogue follow's session and generation: a new one aborts every page, search and view of the previous one, and an answer
   * that arrives anyway is dropped by its generation (CORE-72). `loading` while the host's catalogue is still on its way.
   */
  private session: AbortController | null = null;
  private loading = false;
  private generation = 0;
  /** The shared catalogue, and this character's own port onto it (its requester's interest). */
  private readonly shared: CreatorCatalogue;
  private readonly creator: CreatorPort;
  private readonly requesterName: string;
  /** What each panel instance of this character asks of the catalogue (creator-requester.ts); `main` is the Character panel's. */
  private readonly requesters = new Map<string, CreatorRequester>();
  private readonly main: CreatorRequester;
  /** The one owner of the character's choice-preview device; each requester draws through its own lease. */
  private readonly previewOwner: ChoicePreviewOwner | null;
  /** The character's Undo history: the history service's `character:<id>` scope (character-history.ts). */
  private readonly home: CharacterHistoryHome;
  private readonly scope: HistoryScope;
  private readonly unbind: () => void;
  private presets = new WeakMap<object, CcPreset | Error>();
  private revision = 0;
  private listeners = new Set<() => void>();
  private disposed = false;
  private watchedAt = 0;
  /** An earlier build's tried piercing style, migrated once the catalogue is ready (CORE-74). */
  private legacy: { style: string; definition: string } | null;
  /** The row being prepared ahead: its V and option, the positions asked about, and their states (`prefetch`). */
  private fetch: { key: string; option: string; positions: number[]; focus: number | null; sent: string; states: Map<number, ChoiceFetch>;
    stopped: "time" | "disk" | "setup" | null; busy: boolean; asking: AbortController | null; again: boolean; view: CharacterFetchState } | null = null;
  private firstTime = false;
  private prepared: { bytes: number | null; clearing: boolean; freed: number | null; asking: boolean } = { bytes: null, clearing: false, freed: null, asking: false };
  /** The Clothing setting (it is not a creator choice); its steps join the character's one history. */
  private clothing: ClothingSetting = DEFAULT_CLOTHING;
  /** Whether the V's own makeup shows (a viewing setting like Clothing; its steps join the character's one history). */
  private ownMakeup = true;

  constructor(private readonly ports: CharacterContextPorts, initial: { stored?: unknown; save?: SavedV; legacy?: { style: string; definition: string };
    history?: ContextHistory } = {}) {
    const stored = storedCharacterOf(initial.stored);
    const save = initial.save ? this.saveOf(initial.save) : null;
    const origin = originOf(stored, !!save);
    let kept: CcPreset | null = null;
    if (stored?.kept) { try { kept = parseCcPreset(stored.kept); } catch { kept = null; } }
    this.state = { origin, bodyGender: initialBodyGender(initial.stored, initial.save),
      save: origin.kind === "save" ? save : null, choices: stored?.choices ?? [], kept, notCarried: [] };
    this.knownSave = saveKey(initial.save);
    this.legacy = !stored && initial.legacy?.style && initial.legacy.definition ? { ...initial.legacy } : null;
    this.clothing = stored?.clothing ?? DEFAULT_CLOTHING;
    this.ownMakeup = stored?.ownMakeup !== "hidden";
    if (!ports.catalogue && !ports.creator) throw Error("A character context needs the creator catalogue.");
    this.shared = ports.catalogue ?? new CreatorCatalogue(ports.creator!);
    this.requesterName = ports.requester ?? "character";
    this.creator = this.shared.port(this.requesterName);
    this.previewOwner = ports.previews ? new ChoicePreviewOwner(ports.previews) : null;
    this.main = this.requester("panel");
    // The history carried from the previous head of this V, else the character's own home, else a private one.
    const carried = initial.history?.kind === "xfs/character-history" && isHome(initial.history.history) ? initial.history.history : null;
    this.home = carried ?? ports.history ?? privateHistory();
    const history = characterHistory(this.home);
    this.scope = history.scope;
    this.unbind = history.bind({ read: key => this.historyRead(key), apply: values => this.historyApply(values) });
  }
  /** Where the panel's Undo history lives, for the head made next when the V changes body (`initial.history`). */
  history(): ContextHistory { return { kind: "xfs/character-history", history: this.home }; }
  /**
   * What one panel instance of this character asks of the catalogue (its open rows, search, choices prepared ahead and previews), made
   * the first time it is named. The Character panel's is `panel`.
   */
  requester(instance: string): CreatorRequester {
    let requester = this.requesters.get(instance);
    if (!requester) {
      const name = `${this.requesterName}/${instance}`;
      requester = new CreatorRequester(name, this.shared, this.shared.port(name), this.requesterHost());
      this.requesters.set(instance, requester);
    }
    return requester;
  }
  /** A panel instance closed: its questions are let go (the Character panel's own stays). */
  releaseRequester(instance: string): void {
    const requester = this.requesters.get(instance);
    if (!requester || requester === this.main) return;
    requester.dispose();
    this.requesters.delete(instance);
  }
  private requesterHost(): RequesterHost {
    const details = this.ports.details;
    return { phase: () => this.catalogue.phase, gender: () => this.state.bodyGender, panel: () => this.catalogue.panel,
      option: id => this.byId.get(id), ready: () => this.ready(),
      session: () => this.session ? { signal: this.session.signal, generation: this.generation } : null,
      generation: () => this.generation, disposed: () => this.disposed, stale: identity => this.stale(identity), publish: () => this.publish(),
      detailRequest: () => this.detailRequest(), aheadRequest: change => this.aheadRequest(change),
      ...(details?.preload ? { preload: (request: CharacterRequest, signal: AbortSignal) => details.preload!(request, signal) } : {}),
      ...(this.previewOwner ? { previews: () => this.previewOwner!.lease() } : {}),
      viewing: () => this.viewing !== null, refreshPrepared: () => this.refreshPrepared(), watchedAt: () => this.watchedAt };
  }
  /** A row's choices loaded so far for the shown V's body and catalogue (shared by every requester). */
  private rowOf(option: string) { return this.shared.rowOf(this.state.bodyGender, this.catalogue.panel?.identity ?? "", option, ""); }

  // The character's history scope reads and restores these values (character-history.ts).
  private historyRead(key: string): unknown {
    return key === "v" ? this.state : key === "clothing" ? this.clothing : key === "makeup" ? this.ownMakeup : undefined;
  }
  private historyApply(values: Readonly<Record<string, unknown>>): boolean {
    if ("clothing" in values) this.clothing = values.clothing as ClothingSetting;
    if ("makeup" in values) this.ownMakeup = values.makeup as boolean;
    if (!("v" in values)) { this.publish(); return true; }
    const previous = this.state, next = values.v as State;
    this.cleared = [];
    this.apply(next);
    if (saveKey(previous.save?.value) !== saveKey(next.save?.value)) this.showSave(next.save?.value ?? null);
    return true;
  }
  /** Record one step of the character's history before `key` changes. */
  private record(key: CharacterHistoryKey, label: string, actionKind: string) {
    this.elsewhere = null;
    this.scope.checkpoint([key], { label, actionKind }, { distinct: true });
  }
  /** The save the saved-V service shows now (its content key), as this service last saw it: a change it didn't make is a new V. */
  private knownSave: string;

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** The decoded save the V comes from (a V from a save), else null. */
  shownSave(): SavedV | null { return this.state.origin.kind === "save" ? this.state.save?.value ?? null : null; }
  /** The shown V's body (a cheap read of what `snapshot().bodyGender` says): the head shows that body's core. */
  shownBody(): BodyGender { return this.state.bodyGender; }
  private publish() { this.revision++; for (const listener of this.listeners) listener(); }

  // -------------------------------------------------------------------------------------------------------------
  // Reads

  snapshot(): CharacterContextSnapshot {
    const notes = summariseMissing(this.state.notCarried).summary.map(item => item.message);
    return structuredClone({ phase: this.catalogue.phase, message: this.catalogue.message, next: this.catalogue.next ?? null, origin: this.state.origin, bodyGender: this.state.bodyGender,
      set: this.state.choices.length, undo: this.scope.state().undo?.label ?? null, redo: this.scope.state().redo?.label ?? null,
      keepable: this.cleared.length, viewing: !!this.viewing, viewError: this.viewError, notes,
      retry: this.capability({ kind: "character.retry" }).available, firstTime: this.firstTime,
      prepared: { bytes: this.prepared.bytes, clearing: this.prepared.clearing, freed: this.prepared.freed }, clothing: this.clothingSnapshot(),
      ownMakeup: this.ownMakeup, conflict: this.ports.document?.conflict() ?? null, elsewhere: this.elsewhere, revision: this.revision });
  }
  /**
   * The head's creator options whose parts the 3D view hides: every option of the makeup section's rows while the V's own makeup is hidden
   * (the host's projection marks the section, so no name is written here), else none. Same array while nothing changed.
   */
  hiddenOptions(): readonly string[] {
    const panel = this.panel();
    const key = this.ownMakeup || !panel ? "" : panel.identity;
    if (key !== this.hiddenKey) {
      this.hiddenKey = key;
      this.hidden = key ? Object.freeze([...new Set(panel!.sections.filter(section => section.makeup)
        .flatMap(section => section.rows.filter(row => row.part === "head").flatMap(row => row.options.map(at => panel!.options[at]!.name))))]) : Object.freeze([]);
    }
    return this.hidden;
  }
  /** The Clothing setting's read (see `ClothingSnapshot`). */
  private clothingSnapshot(): ClothingSnapshot {
    const save = this.state.save?.value;
    const loadout = save?.loadout;
    const worn = loadout ? [...new Set(wornAreas(loadout).map(entry => entry.area))] : [];
    const source = !save ? "none" : loadout === undefined ? "older" : loadout === null ? "unread" : "save";
    const note = source === "none" ? "The default V wears nothing of her own; Underwear only dresses her in the game's basic underwear."
      : source === "older" ? "This save was loaded before XF Studio read clothes. Load it again to see what your V wears."
      : source === "unread" ? "XF Studio couldn't read what your V wears from this save, so her clothes aren't shown."
      : !worn.length ? "Your V wears nothing in this save." : "";
    return { state: this.clothing.state, custom: [...this.clothing.custom], worn, shown: this.shownAreas(),
      states: this.offeredStates().map(value => ({ value, label: CLOTHING_STATE_LABELS[value] })),
      areas: worn.map(area => ({ area, label: CLOTHING_AREA_LABELS[area] })), source, note,
      ...this.clothingSteps() };
  }
  /** The Clothing step next in the character's history, either way (the setting's Undo and Redo labels). */
  private clothingSteps(): { undo: string | null; redo: string | null } {
    const { undo, redo } = this.scope.state();
    return { undo: undo && CLOTHING_STEPS.has(undo.actionKind) ? undo.label : null, redo: redo && CLOTHING_STEPS.has(redo.actionKind) ? redo.label : null };
  }
  /** What the Clothing setting dresses the shown V in, for a request (null: nothing worn). */
  private dressing(setting: ClothingSetting = this.clothing) {
    const save = this.state.save?.value;
    return dressingFor(setting, save?.loadout, this.state.bodyGender, save?.tags ?? []);
  }
  /**
   * The Clothing states that apply to the shown V (UI-79): the current one, and each other one that dresses V differently from every state
   * offered before it (the default V, or a save without head or face items, has fewer). "Choose areas" is offered only while the save
   * dresses an area to choose.
   */
  private offeredStates(): ClothingState[] {
    const save = this.state.save?.value, worn = save?.loadout ? wornAreas(save.loadout).length : 0;
    // What a state dresses V in: the worn items and which of their areas show (an area shown with nothing in it changes nothing).
    const key = (state: ClothingState) => {
      const dressed = this.dressing({ state, custom: state === "custom" ? this.shownAreas() : this.clothing.custom });
      return dressed ? JSON.stringify([dressed.worn, dressed.shown.filter(area => dressed.worn.some(entry => entry.area === area))]) : "";
    };
    const offered: ClothingState[] = [], seen = new Set<string>([key(this.clothing.state)]);
    for (const state of CLOTHING_STATES) {
      if (state === this.clothing.state || (state === "custom" && worn)) { offered.push(state); continue; }
      if (state === "custom") continue;
      const dressed = key(state);
      if (!seen.has(dressed)) offered.push(state);
      seen.add(dressed);
    }
    return offered;
  }
  /** The panel's options for the shown V's body (frozen; shared, never copied). Reading it marks the panel as looked at. */
  panel(): Readonly<CcPanel> | null {
    this.watchedAt = Date.now();
    return this.catalogue.gender === this.state.bodyGender ? this.catalogue.panel : null;
  }
  /** Every active row's current choice, the V's own and what couldn't be honoured (frozen), for the current state once it arrives. */
  view(): Readonly<CreatorView> | null {
    const view = this.currentView;
    if (!view || this.viewCurrent()) return view;
    const key = JSON.stringify(this.request());
    if (this.shownView?.key !== key || this.shownView.from !== view) this.shownView = { key, from: view, view: deepFreeze(this.optimistic(view)) };
    return this.shownView.view;
  }
  /**
   * Every interaction shows its effect at once: until the host's view of the current state arrives, each row the last view shows takes
   * the current state's choice (or the V's own, where the choice was reset), as the loaded choices name it. The host's view replaces it
   * when it arrives, so a choice the host couldn't honour is shown as the host says. A row the change newly activates waits for the host.
   */
  private optimistic(view: CreatorView): CreatorView {
    const chosen = new Map(this.state.choices.map(choice => [`${choice.part}/${choice.option}`, choice]));
    let values: Record<string, CreatorView["values"][string]> | null = null;
    for (const [id, value] of Object.entries(view.values)) {
      const option = this.byId.get(id);
      if (!option) continue;
      const choice = chosen.get(`${option.part}/${option.name}`) ?? null;
      const page = this.rowOf(option.id);
      const item = choice ? page?.choices.find(entry => entry.position === this.positionOf(choice))
        : value.set ? page?.choices.find(entry => entry.key === value.own) : undefined;
      if (!item || (item.position === value.position && !!choice === value.set)) continue;
      values ??= { ...view.values };
      values[id] = { ...value, choice: item.key, position: item.position, set: !!choice, label: item.label, color: item.color };
    }
    return values ? { ...view, values } : view;
  }
  /** Whether `view()` answers the current state (not an earlier one still shown while the new view is on its way). */
  viewCurrent(): boolean { return !!this.currentView && this.viewKey === JSON.stringify(this.request()); }
  /** The Character panel's requester (`requester("panel")`): an option's choices loaded so far; asking loads the next page. */
  choices(option: string, want = CC_PAGE_SIZE, query = ""): CharacterChoicesState { return this.main.choices(option, want, query); }
  /** A colour row's swatches and icons, as the Character panel's requester has them (creator-requester.ts). */
  swatches(option: string): DisplayedSwatchState | null { return this.main.swatches(option); }
  /** The options with a choice matching `query` (UI-72), as the Character panel's requester searched. */
  search(query: string): CharacterSearchState { return this.main.search(query); }
  /** A row's choices prepared ahead for the Character panel (creator-requester.ts `prefetch`). */
  prefetch(option: string, positions: readonly number[], focus: number | null = null): CharacterFetchState | null { return this.main.prefetch(option, positions, focus); }
  /** A shape row's choice pictures for the Character panel (creator-requester.ts `previews`). */
  previews(option: string, positions: readonly number[], selected: number | null, focus: number | null = null, spin: number | null = null): ChoicePreviewRow | null {
    return this.main.previews(option, positions, selected, focus, spin);
  }
  /** What choice previews have cost so far (measurement and diagnostics). */
  previewStats() { return this.main.previewStats(); }
  /** The row closed: stop preparing its choices ahead. */
  stopPrefetch(option: string): void { this.main.stopPrefetch(option); }
  /** The request with one more change set (a choice under the pointer loaded ahead), or null when it changes nothing or is refused. */
  private aheadRequest(change: CharacterChoice): CharacterRequest | null {
    if (!this.choiceCheck(change).available) return null;
    const next = this.withChoices([change]);
    if (next.choices.length > CREATOR_LIMITS.choices || sameChoices(next.choices, this.state.choices)) return null;
    return characterRequestOf({ bodyGender: next.bodyGender, saved: next.save?.saved ?? null }, next.choices, undefined, this.dressing(),
      this.bodyShown, this.uncensored, this.creatorPuppet, this.armsCyberware());
  }
  /** Read the prepared game files' size again (once at a time). */
  refreshPrepared(): void {
    if (!this.creator.preparedFiles || this.prepared.asking || this.prepared.clearing) return;
    this.prepared.asking = true;
    this.creator.preparedFiles().then(size => { this.prepared.bytes = size.bytes; this.publish(); }, () => {})
      .finally(() => { this.prepared.asking = false; });
  }
  /** Where a choice sits among its option's loaded choices (null when it isn't loaded). */
  private positionOf(change: CharacterChoice): number | null {
    const option = this.option(change.part, change.option);
    const page = option ? this.rowOf(option.id) : undefined;
    return page?.choices.find(item => item.key === change.choice && (!change.activates || sameSet(item.activates, change.activates)))?.position ?? null;
  }

  /**
   * The request the preview prepares: the shown V (head, body and arms, either body) with the choices set on it. The host keeps the
   * body parts its third-person consumers read (character-detail-plan.ts `previewInput`).
   */
  detailRequest(): CharacterRequest {
    return characterRequestOf({ bodyGender: this.state.bodyGender, saved: this.state.save?.saved ?? null }, this.state.choices, undefined, this.dressing(),
      this.bodyShown, this.uncensored, this.creatorPuppet, this.armsCyberware());
  }
  /**
   * The arm cyberware the loaded save equips (its `ArmsCW` item), whose holster state the arms draw (arm-cyberware.ts); none for the default
   * V, a save without it, or one read before XF Studio read the area.
   */
  private armsCyberware(): string | null { return this.state.save?.value?.loadout?.arms ?? null; }
  /**
   * Whether the viewer shows V's body (the preview's Body switch): with it off, the request asks for the head alone, so the host neither
   * dresses nor prepares the body and the scene releases what it drew (PREV-108). A composition root keeps it in step with the switch.
   */
  setBodyShown(shown: boolean): void {
    if (shown === this.bodyShown) return;
    this.bodyShown = shown;
    this.publish();
  }
  private bodyShown = true;
  /**
   * Whether the viewer chose to see V as the game draws it with nudity allowed (the Character panel's uncensored setting): the request
   * says so and the host plans the body without the censorship underwear (knowledge/body-rendering.md §3). A composition root keeps it in
   * step with the setting; off (the default) is the game's censored look.
   */
  setUncensored(uncensored: boolean): void {
    if (uncensored === this.uncensored) return;
    this.uncensored = uncensored;
    this.publish();
  }
  private uncensored = false;
  /**
   * Whether V stands as the character creator's puppet (the body source is one of the creator's idles, which are authored for the
   * creator's lifted feet; knowledge/body-animation.md §4): the request says so and the host draws her bare feet that way. A composition
   * root keeps it in step with the motion; off, the feet follow her footwear (flat when barefoot).
   */
  setCreatorPuppet(creator: boolean): void {
    if (creator === this.creatorPuppet) return;
    this.creatorPuppet = creator;
    this.publish();
  }
  private creatorPuppet = false;
  private hiddenKey = "";
  private hidden: readonly string[] = Object.freeze([]);
  /** The whole state as the host interprets it (every part). */
  request(): CharacterRequest {
    return characterRequestOf({ bodyGender: this.state.bodyGender, saved: this.state.save?.saved ?? null }, this.state.choices);
  }
  /**
   * The workspace's form; undefined when nothing needs storing (the V as loaded, nothing set). The masculine default V is always
   * stored: without it a reload would show the feminine one.
   */
  stored(): StoredCharacter | undefined {
    const { origin, choices } = this.state;
    const clothing = sameClothing(this.clothing, DEFAULT_CLOTHING) ? null : this.clothing;
    if (!choices.length && !clothing && this.ownMakeup && origin.kind !== "preset" &&
      !(origin.kind === "default" && (this.knownSave || this.state.bodyGender !== "female"))) return undefined;
    return this.form();
  }
  /** What the context holds, always (the character document's form, character-document.ts; `stored` leaves out a V as loaded). */
  form(): StoredCharacter {
    const { origin, choices, kept } = this.state;
    const clothing = sameClothing(this.clothing, DEFAULT_CLOTHING) ? null : this.clothing;
    return { origin: origin.kind, ...(origin.kind === "preset" && origin.name ? { name: origin.name } : {}),
      ...(origin.kind !== "save" ? { bodyGender: this.state.bodyGender } : {}), choices: choices.map(choice => ({ ...choice })),
      ...(kept ? { kept: serializeCcPreset(kept) } : {}), ...(clothing ? { clothing: { state: clothing.state, custom: [...clothing.custom] } } : {}),
      ...(this.ownMakeup ? {} : { ownMakeup: "hidden" as const }) };
  }

  // -------------------------------------------------------------------------------------------------------------
  // The catalogue and its pages

  /**
   * Follow the host's catalogue for the shown V's body until it is ready (or fails), then fetch the view. A new follow (another body,
   * a catalogue that changed, Try again) drops every page, search and view of the previous one (CORE-72).
   */
  start(restart = false): void {
    if (this.disposed) return;
    const gender = this.state.bodyGender;
    if (!restart && this.catalogue.gender === gender && (this.catalogue.phase === "ready" || this.loading)) { this.refreshView(); return; }
    // Starting again means the catalogue may have changed: nothing the page kept for this body stands.
    if (restart) this.shared.forget(gender);
    this.follow(gender, signal => this.creator.panel(gender, signal));
  }
  private follow(gender: BodyGender, first: (signal: AbortSignal) => Promise<CreatorState>) {
    this.session?.abort();
    this.viewing?.controller.abort();
    this.viewing = null;
    const controller = new AbortController(), generation = ++this.generation;
    this.session = controller;
    this.loading = true;
    this.catalogue = { phase: "preparing", message: "", panel: null, gender };
    this.byId.clear();
    for (const requester of this.requesters.values()) requester.reset();
    this.publish();
    const live = () => !controller.signal.aborted && generation === this.generation && !this.disposed;
    void (async () => {
      try {
        let state = await first(controller.signal);
        while (state.phase === "preparing" && live()) {
          this.catalogue = { ...this.catalogue, message: state.message };
          // Polled quickly while the panel is looked at, slowly otherwise; the host's state is a cheap read that never builds again.
          await this.creator.wait(Date.now() - this.watchedAt < WATCHED_MS ? POLL_MS : POLL_IDLE_MS, controller.signal);
          if (!live()) return;
          state = await this.creator.panel(gender, controller.signal);
        }
        if (!live()) return;
        if (state.phase !== "ready" || !state.panel) {
          this.catalogue = { phase: "failed", message: state.message || "The creator options couldn't be read.", panel: null, gender };
          this.publish();
          return;
        }
        const panel = deepFreeze(state.panel);
        this.byId = new Map(panel.options.map(option => [option.id, option]));
        // Labels it couldn't read are said, with their next step (NATIVE-46).
        this.catalogue = { phase: "ready", message: state.next ? state.message : "", next: state.next ?? null, panel, gender };
        this.publish();
        this.refreshView();
        this.refreshPrepared();
        this.migrateLegacy();
      } catch (error) {
        if (!live()) return;
        this.catalogue = { phase: "failed", message: (error as Error)?.message || "The creator options couldn't be read.", panel: null, gender };
        this.publish();
      } finally { if (this.session === controller) this.loading = false; }
    })();
  }
  /** An answer from a catalogue other than the panel's: the installation changed, so the panel starts again (PIPE-81). */
  private stale(identity: string) {
    const current = this.catalogue.panel?.identity;
    if (!identity || !current || identity === current) return false;
    this.start(true);
    return true;
  }

  /** Ask the host for the view of the current state (the previous question is dropped). */
  private refreshView() {
    if (this.catalogue.phase !== "ready" || this.disposed) return;
    const request = this.request(), key = JSON.stringify(request);
    if (this.viewing?.key === key) return;
    if (!this.viewing && this.currentView && this.viewKey === key) return;
    this.viewing?.controller.abort();
    const controller = new AbortController(), generation = this.generation;
    this.viewing = { key, controller };
    this.publish();
    this.creator.view(request, controller.signal).then(view => {
      if (controller.signal.aborted || generation !== this.generation) return;
      if (this.stale(view.identity)) return;
      this.currentView = deepFreeze(view); this.viewKey = key; this.viewError = null;
      this.keepUnmatched(view);
    }, error => {
      if (controller.signal.aborted || generation !== this.generation) return;
      this.viewError = (error as Error)?.message || "Your V's current choices couldn't be read.";
    }).finally(() => {
      if (this.viewing?.controller !== controller) return;
      this.viewing = null;
      this.publish();
    });
  }
  /** Once the host has matched a loaded preset's choices, keep only the entries it couldn't match or that weren't carried (CORE-74). */
  private keepUnmatched(view: CreatorView) {
    const kept = this.state.kept;
    if (!kept?.values.length) return;
    const missing = new Set(view.missing.entries.filter(entry => entry.from === "choice").map(entry => `${entry.part}/${entry.option}`));
    const sent = new Set(this.state.choices.map(choice => `${choice.part}/${choice.option}`));
    const values = kept.values.filter(entry => missing.has(`${entry.part}/${entry.option}`) || !sent.has(`${entry.part}/${entry.option}`));
    if (values.length !== kept.values.length) this.state = { ...this.state, kept: { ...kept, values } };
  }
  /** An earlier build's tried piercing style becomes the matching creator choices on an untouched context (CORE-74). */
  private migrateLegacy() {
    const legacy = this.legacy;
    this.legacy = null;
    if (!legacy || !this.creator.legacy || this.state.choices.length || this.scope.canUndo() || this.state.bodyGender !== "female") return;
    const before = this.state, generation = this.generation;
    this.creator.legacy!(before.bodyGender, legacy.style, legacy.definition).then(choices => {
      if (this.disposed || generation !== this.generation || this.state !== before || this.scope.canUndo()) return;
      const carried = choices.flatMap(choice => { const valid = characterChoiceOf(choice); return valid ? [valid] : []; });
      if (!carried.length) return;
      this.state = { ...before, choices: carried };
      this.publish();
      this.refreshView();
    }, error => console.error(error));
  }

  // -------------------------------------------------------------------------------------------------------------
  // Actions

  private saveOf(value: SavedV) { return { value, saved: savedDescriptorsOf(value) }; }
  private option(part: CcoPart, name: string) { return this.byId.get(`${part}/${name}`); }
  private ready() { return this.catalogue.phase === "ready" && this.catalogue.gender === this.state.bodyGender; }
  /** The ready catalogue's labels may read if built again (NATIVE-46). */
  private retryableLabels() { return this.ready() && this.catalogue.next === "retry"; }
  private notReady(): Capability {
    return refusal("not_ready", this.catalogue.phase === "failed" && this.catalogue.gender === this.state.bodyGender ? this.catalogue.message || LOADING : LOADING);
  }
  private choiceCheck(change: CharacterChoice): Capability {
    const option = this.option(change.part, change.option);
    if (!option) return refusal("missing_target", "That creator option isn't offered by the installed game and mods.");
    const page = this.rowOf(option.id);
    // A choice is checked against the option's choices once they are all here; the host checks it again either way.
    if (page && page.choices.length >= page.total &&
      !page.choices.some(item => item.key === change.choice && (!change.activates || sameSet(item.activates, change.activates))))
      return refusal("invalid_value", `“${change.choice || "None"}” isn't one of ${option.label}'s choices.`);
    return { available: true };
  }
  /** Changes checked whole: each by the shared rule and against the catalogue, and the V's limit (CORE-73). */
  private changesCheck(changes: unknown): { capability: Capability; choices: CharacterChoice[] } {
    if (!Array.isArray(changes) || !changes.length || changes.length > CREATOR_LIMITS.choices)
      return { capability: refusal("invalid_value", "There is nothing to change."), choices: [] };
    const choices: CharacterChoice[] = [];
    for (const change of changes) {
      const choice = changeOf(change);
      if (!choice) return { capability: refusal("invalid_value", "That change isn't a creator choice XF Studio can use."), choices: [] };
      const allowed = this.choiceCheck(choice);
      if (!allowed.available) return { capability: allowed, choices: [] };
      choices.push(choice);
    }
    if (this.withChoices(choices).choices.length > CREATOR_LIMITS.choices)
      return { capability: refusal("limit", "That's more changes than one V can hold. Reset some first."), choices: [] };
    return { capability: { available: true }, choices };
  }
  private preset(value: unknown): CcPreset | Error {
    if (!value || typeof value !== "object") return Error("This character preset can't be read: it is not a preset file.");
    const known = this.presets.get(value);
    if (known) return known;
    let parsed: CcPreset | Error;
    try { parsed = parseCcPreset(value); } catch (error) { parsed = error as Error; }
    this.presets.set(value, parsed);
    return parsed;
  }

  capability(action: CharacterContextAction): Capability {
    // Loading the very save the V comes from, while it can't be shown, only imports it: taken even while the V is being restored.
    if (this.importsOwnSave(action)) return { available: true };
    const restoring = CHANGES.has(action.kind) ? this.ports.document?.restoring?.() ?? null : null;
    if (restoring) return refusal("not_ready", restoring);
    switch (action.kind) {
      case "character.setSource": {
        const source = sourceAction(action.source);
        if (!source) return refusal("invalid_value", "That isn't somewhere a V can come from.");
        // The save already shown is shown again on this scene, and nothing else changes.
        if (source.kind === "character.loadSave" && this.sameSave(source.value)) return { available: true };
        return this.capability(source);
      }
      case "character.setOption":
        if (!this.ready()) return this.notReady();
        return this.changesCheck([{ part: action.part, option: action.option, choice: action.choice, ...(action.activates ? { activates: action.activates } : {}) }]).capability;
      case "character.setOptions":
        if (!this.ready()) return this.notReady();
        return this.changesCheck(action.changes).capability;
      case "character.setOwnMakeup":
        if (this.ownMakeup === action.shown) return refusal("invalid_value", action.shown ? "Your V's own makeup is already shown." : "Your V's own makeup is already hidden.");
        // Showing it again never waits; hiding it needs the creator options, which say which rows are makeup.
        return action.shown || this.ready() ? { available: true } : this.notReady();
      case "character.reset": {
        if (!this.ready()) return this.notReady();
        const option = this.option(action.part, action.option);
        const family = option?.link?.key;
        const set = this.state.choices.some(choice => choice.part === action.part && choice.option === action.option ||
          (!!family && this.option(choice.part, choice.option)?.link?.key === family));
        return set ? { available: true } : refusal("invalid_value", "That option already shows your V's own choice.");
      }
      case "character.resetAll":
        if (!this.ready()) return this.notReady();
        return this.state.choices.length ? { available: true } : refusal("invalid_value", "Nothing has been changed on this V.");
      case "character.useDefault":
        return this.state.origin.kind === "default" && this.state.bodyGender === action.bodyGender && !this.state.choices.length
          ? refusal("invalid_value", "The default V is already shown.") : { available: true };
      case "character.loadSave":
        try { savedDescriptorsOf(action.value); } catch (error) { return refusal("invalid_value", (error as Error).message); }
        return { available: true };
      case "character.loadPreset": {
        const preset = this.preset(action.value);
        return preset instanceof Error ? refusal("invalid_value", preset.message) : { available: true };
      }
      case "character.keepChanges":
        if (!this.cleared.length) return refusal("invalid_value", "There are no earlier changes to keep.");
        if (!this.ready()) return this.notReady();
        return this.withChoices(this.cleared).choices.length > CREATOR_LIMITS.choices
          ? refusal("limit", "That's more changes than one V can hold.") : { available: true };
      case "character.retry":
        return this.catalogue.phase === "failed" || this.retryableLabels() || this.ports.details?.failed() ? { available: true }
          : refusal("invalid_value", "Nothing failed, so there is nothing to try again.");
      case "character.clearPreparedFiles":
        if (!this.creator.clearPrepared) return refusal("unavailable", "This version of XF Studio can't clear its prepared game files.");
        if (this.prepared.clearing) return refusal("busy", "The prepared game files are being cleared.");
        return this.prepared.bytes === 0 ? refusal("invalid_value", "There are no prepared game files to clear.") : { available: true };
      case "character.resolveConflict": {
        const conflict = this.ports.document?.conflict();
        if (!conflict) return refusal("invalid_value", "There is no other version of this V to choose from.");
        if (action.keep === "both" && !conflict.keepBoth) return refusal("unavailable", "This V can't be copied right now.");
        return action.keep === "mine" || action.keep === "theirs" || action.keep === "both" ? { available: true } : refusal("invalid_value", "Choose which V to keep.");
      }
      case "character.undo":
        return this.scope.canUndo() ? { available: true } : refusal("invalid_value", "There is no character change to undo.");
      case "character.redo":
        return this.scope.canRedo() ? { available: true } : refusal("invalid_value", "There is no undone character change to redo.");
      case "character.setClothing":
        if (this.clothing.state === action.state) return refusal("invalid_value", `${CLOTHING_STATE_LABELS[action.state]} is already shown.`);
        return this.offeredStates().includes(action.state) ? { available: true }
          : refusal("invalid_value", `${CLOTHING_STATE_LABELS[action.state]} wouldn't change what your V wears.`);
      case "character.setClothingArea": {
        const shown = this.shownAreas().includes(action.area);
        return shown === action.shown ? refusal("invalid_value", action.shown ? "That area is already shown." : "That area is already hidden.") : { available: true };
      }
      // The Clothing setting's own Undo is retired (profiles design §3.7): these step the character's history while a Clothing step is next.
      case "character.undoClothing":
        return this.scope.canUndo() && this.clothingSteps().undo !== null ? { available: true } : refusal("invalid_value", "There is no clothing change to undo.");
      case "character.redoClothing":
        return this.scope.canRedo() && this.clothingSteps().redo !== null ? { available: true } : refusal("invalid_value", "There is no undone clothing change to redo.");
    }
  }
  /** The clothing areas the current setting shows (`custom` starts from them when an area is picked in another state). */
  private shownAreas(): ClothingArea[] {
    switch (this.clothing.state) {
      case "custom": return [...this.clothing.custom];
      case "underwear": return [...UNDERWEAR_AREAS];
      case "no-headwear": return CLOTHING_AREAS.filter(area => !HEADWEAR_AREAS.includes(area));
      case "saved": return [...CLOTHING_AREAS];
    }
  }
  private clothingStep(label: string, setting: ClothingSetting, kind: string) {
    if (sameClothing(setting, this.clothing)) return;
    this.record("clothing", label, kind);
    this.clothing = setting;
    this.publish();
  }

  /** Whether `value` is the save the V already comes from. */
  private importsOwnSave(action: CharacterContextAction): boolean {
    const value = action.kind === "character.loadSave" ? action.value
      : action.kind === "character.setSource" && (action.source as { kind?: string } | null)?.kind === "save" ? (action.source as { value: unknown }).value : undefined;
    return value !== undefined && !!this.ports.document?.namesSave?.(value);
  }
  private sameSave(value: unknown): boolean {
    return this.state.origin.kind === "save" && !!this.state.save && saveKey(this.state.save.value) === saveKey(value as SavedV);
  }
  /** Apply an action; throws the refusal's reason when the capability refuses. */
  dispatch(action: CharacterContextAction): Record<string, never> {
    const allowed = this.capability(action);
    if (!allowed.available) throw Error(allowed.reason);
    if (this.importsOwnSave(action)) {
      this.ports.document!.importSave!(action.kind === "character.loadSave" ? action.value : (action as { source: { value: unknown } }).source.value);
      return {};
    }
    if (action.kind === "character.resolveConflict") {
      const done = this.ports.document!.resolve(action.keep);
      if (!done.available) throw Error(done.reason);
      this.publish();
      return {};
    }
    if (action.kind !== "character.setOption" && action.kind !== "character.clearPreparedFiles") this.firstTime = false;
    // A change of the person's own: nothing more is loaded ahead for the V it replaces (a load in progress is stopped by the change's own).
    for (const requester of this.requesters.values()) requester.cancelWaitingAhead();
    switch (action.kind) {
      case "character.setSource": {
        // Where the V comes from (absorbs `savedV.*`, profiles design §7): a save is applied on this scene as well.
        const source = sourceAction(action.source)!;
        if (source.kind === "character.loadSave") {
          const value = source.value as SavedV;
          if (this.sameSave(value)) { this.ports.showSave(value); break; }
          const save = this.saveOf(value);
          this.knownSave = saveKey(value);
          this.changeV("Load a save", { origin: { kind: "save" }, bodyGender: save.value.isMale ? "male" : "female", save, choices: [], kept: null, notCarried: [] }, action.kind, false);
          this.ports.showSave(value);
          break;
        }
        return this.dispatch(source);
      }
      case "character.setOption": {
        const { choices } = this.changesCheck([{ part: action.part, option: action.option, choice: action.choice, ...(action.activates ? { activates: action.activates } : {}) }]);
        // A choice not prepared ahead reads the game files now (the status line says so); one prepared ahead is instant.
        const position = choices[0] ? this.positionOf(choices[0]) : null, option = this.option(action.part, action.option);
        this.firstTime = !(option && [...this.requesters.values()].some(requester => requester.prepared(option.id, position)));
        this.step(plainStep(this.option(action.part, action.option), action.choice), this.withChoices(choices), action.kind);
        break;
      }
      case "character.setOptions": {
        const { choices } = this.changesCheck(action.changes);
        this.step(action.label || `Change ${choices.length} options`, this.withChoices(choices), action.kind);
        break;
      }
      case "character.setOwnMakeup":
        this.record("makeup", action.shown ? "Show my V's own makeup" : "Hide my V's own makeup", action.kind);
        this.ownMakeup = action.shown;
        this.publish();
        break;
      case "character.reset": {
        const family = this.option(action.part, action.option)?.link?.key;
        this.step(`Reset ${this.option(action.part, action.option)?.label ?? action.option}`, { ...this.state,
          choices: this.state.choices.filter(choice => !(choice.part === action.part && choice.option === action.option) &&
            !(family && this.option(choice.part, choice.option)?.link?.key === family)) }, action.kind);
        break;
      }
      case "character.resetAll": this.step("Reset every change", { ...this.state, choices: [] }, action.kind); break;
      case "character.useDefault":
        this.changeV("Show the default V", { origin: { kind: "default" }, bodyGender: action.bodyGender, save: null, choices: [], kept: null, notCarried: [] }, action.kind);
        break;
      case "character.loadSave": {
        const save = this.saveOf(action.value as SavedV);
        this.knownSave = saveKey(action.value as SavedV);
        this.changeV("Load a save", { origin: { kind: "save" }, bodyGender: save.value.isMale ? "male" : "female", save, choices: [], kept: null, notCarried: [] }, action.kind, false);
        break;
      }
      case "character.loadPreset": {
        const preset = this.preset(action.value) as CcPreset;
        const { choices, kept, notCarried } = presetLoad(preset);
        this.changeV(`Load ${preset.name ? `“${preset.name}”` : "a character preset"}`, { origin: { kind: "preset", name: preset.name },
          bodyGender: preset.bodyGender, save: null, choices, kept, notCarried }, action.kind);
        break;
      }
      case "character.keepChanges": {
        const choices = this.cleared;
        this.cleared = [];
        this.step("Keep my changes", this.withChoices(choices), action.kind);
        break;
      }
      case "character.retry":
        if (this.catalogue.phase === "failed" || this.retryableLabels()) {
          const gender = this.state.bodyGender, creator = this.creator;
          this.follow(gender, signal => creator.retry ? creator.retry(gender, signal) : creator.panel(gender, signal));
        }
        if (this.ports.details?.failed()) this.ports.details.retry();
        this.publish();
        break;
      case "character.clearPreparedFiles": {
        this.prepared = { ...this.prepared, clearing: true, freed: null };
        for (const requester of this.requesters.values()) requester.dropPrefetch();
        this.publish();
        this.creator.clearPrepared!().then(result => { this.prepared = { ...this.prepared, clearing: false, freed: result.freed }; },
          () => { this.prepared = { ...this.prepared, clearing: false }; })
          .finally(() => { this.publish(); this.refreshPrepared(); });
        break;
      }
      // The panel's one Undo (UI-81): the newest change, creator choice or Clothing, in the character's history (`character:<id>`).
      case "character.undo": case "character.undoClothing": this.scope.undo(); break;
      case "character.redo": case "character.redoClothing": this.scope.redo(); break;
      case "character.setClothing":
        this.clothingStep(`Clothing: ${CLOTHING_STATE_LABELS[action.state]}`, { state: action.state,
          custom: action.state === "custom" ? this.shownAreas() : this.clothing.custom }, action.kind);
        break;
      case "character.setClothingArea": {
        const shown = new Set(this.shownAreas());
        if (action.shown) shown.add(action.area); else shown.delete(action.area);
        this.clothingStep(`${action.shown ? "Show" : "Hide"} ${CLOTHING_AREA_LABELS[action.area].toLowerCase()}`,
          { state: "custom", custom: CLOTHING_AREAS.filter(area => shown.has(area)) }, action.kind);
        break;
      }
    }
    return {};
  }

  /** The state with `changes` set: later choices win, and one choice per link family is kept (CORE-51). */
  private withChoices(changes: readonly CharacterChoice[]): State {
    let choices = [...this.state.choices];
    for (const change of changes) {
      const family = this.option(change.part, change.option)?.link?.key;
      choices = choices.filter(choice => !(choice.part === change.part && choice.option === change.option) &&
        !(family && this.option(choice.part, choice.option)?.link?.key === family));
      choices.push(change);
    }
    return { ...this.state, choices };
  }

  private step(label: string, next: State, kind: string, clearKeep = true) {
    if (next === this.state || (sameChoices(next.choices, this.state.choices) && next.origin === this.state.origin && next.save === this.state.save)) return;
    this.record("v", label, kind);
    if (clearKeep) this.cleared = [];
    this.apply(next);
  }
  /** Another V: one step, and the choices made on the previous V can be kept (`keepChanges`). */
  private changeV(label: string, next: State, kind: string, showSave = true) {
    const previous = this.state;
    this.cleared = next.choices.length ? [] : previous.choices;
    this.step(label, next, kind, false);
    if (showSave && saveKey(previous.save?.value) !== saveKey(next.save?.value)) this.showSave(next.save?.value ?? null);
  }
  private showSave(save: SavedV | null) {
    this.knownSave = saveKey(save);
    this.ports.showSave(save);
  }
  private apply(next: State) {
    const genderChanged = next.bodyGender !== this.state.bodyGender;
    this.state = next;
    this.publish();
    if (genderChanged) this.start(); else this.refreshView();
  }

  /**
   * The saved-V service now shows `save` (a save was loaded or restored): when it isn't the V this context already shows, that V
   * becomes the base as one step, clearing the choices made on the previous V (`keepChanges` brings them back).
   */
  followSave(save: SavedV | undefined): void {
    const key = saveKey(save);
    if (key === this.knownSave) return;
    this.knownSave = key;
    if (!save) return;
    let parsed: { value: SavedV; saved: SavedDescriptors };
    try { parsed = this.saveOf(save); } catch (error) { console.error(error); return; }
    this.changeV("Load a save", { origin: { kind: "save" }, bodyGender: save.isMale ? "male" : "female", save: parsed, choices: [], kept: null, notCarried: [] }, "character.loadSave", false);
  }

  /**
   * Another window's version of the V replaced this one's (a change made elsewhere, or Use theirs, profiles design §2.2): the context
   * shows `stored` (with `save`, its decoded save), and its Undo starts here, since the steps before it were of the version replaced.
   */
  replace(stored: unknown, save?: SavedV, note = ELSEWHERE): void {
    const form = storedCharacterOf(stored), parsed = save ? this.saveOf(save) : null;
    const origin = originOf(form, !!parsed);
    let kept: CcPreset | null = null;
    if (form?.kept) { try { kept = parseCcPreset(form.kept); } catch { kept = null; } }
    const previous = this.state;
    this.cleared = [];
    this.clothing = form?.clothing ?? DEFAULT_CLOTHING;
    this.ownMakeup = form?.ownMakeup !== "hidden";
    this.scope.clear();
    this.elsewhere = note;
    this.apply({ origin, bodyGender: initialBodyGender(stored, save), save: origin.kind === "save" ? parsed : null, choices: form?.choices ?? [], kept, notCarried: [] });
    if (saveKey(previous.save?.value) !== saveKey(this.state.save?.value)) this.showSave(this.state.save?.value ?? null);
  }
  private elsewhere: string | null = null;
  /** The owner's document changed in a way the snapshot shows (a conflict came or went). */
  documentChanged(): void { this.publish(); }

  /** A portable preset of the choices set on this V (the host names each choice as this installation offers it). */
  exportPreset(name: string | null): Promise<{ text: string; values: number; leftOut: number; personal: number }> {
    return this.creator.preset(this.request(), name, this.state.kept ? serializeCcPreset(this.state.kept) : undefined);
  }

  dispose() {
    this.disposed = true;
    for (const requester of this.requesters.values()) requester.dispose();
    this.previewOwner?.dispose();
    this.shared.release(this.requesterName);
    this.session?.abort();
    this.viewing?.controller.abort();
    this.unbind();
    this.listeners.clear();
  }
}
