/**
 * Application service that owns the character context in the Studio (CORE-58): which V the makeup is shown on (the creator's default
 * V, a loaded save, or a portable preset) and every creator choice a person set on it. DOM-free. It holds only what the person set
 * (portable identities, character-context.ts) and asks the preview host (through `CreatorPort`) for everything derived from the
 * installed catalogue: the panel's options, their choices page by page, searches, and the view of every row's current choice.
 *
 * - **History** (CORE-59): creator changes have their own small Undo history, separate from the makeup look's. Each step is one
 *   whole context state; loading a save or a preset is one step, and so is "hide my V's own makeup" (`character.hideOwnMakeup`, whose
 *   rule lives here: the host's projection marks the makeup section; CORE-71). It lives in memory only.
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
import { type CcChoicePage, type CcChoiceSearch, type CcPanel, type CcPanelChoice, type CcPanelOption, CC_PAGE_SIZE, type CreatorNext, type CreatorState, type CreatorView,
  makeupOff, searchQuery } from "./cc-panel";
import { type CcPreset, parseCcPreset, serializeCcPreset, serializeCcPresetEntry } from "./cc-preset";
import { carryPreset, type CharacterChange, type CharacterChoice, characterChoiceOf, type CharacterContextAction, type MissingChoice,
  type SavedDescriptors, savedDescriptorsOf, summariseMissing } from "./character-context";
import { characterRequestOf, DEFAULT_CHARACTER, type CharacterRequest } from "./character-detail-request";
import { CREATOR_LIMITS, isPresetName } from "./creator-names";
import { refusal, type Capability } from "./platform/api";
import type { SavedV } from "./save-reader";
import { CLOTHING_AREA_LABELS, CLOTHING_STATE_LABELS, CLOTHING_STATES, type ClothingSetting, clothingSettingOf, type ClothingState, DEFAULT_CLOTHING,
  dressingFor, HEADWEAR_AREAS, UNDERWEAR_AREAS } from "./clothing-dressing";
import { CLOTHING_AREAS, type ClothingArea, wornAreas } from "./save-loadout";

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
  /** Prepare a row's choices ahead (visible ones first; `focus` first of all) and answer their states, one character per position. */
  prefetch?(request: CharacterRequest, option: string, positions: readonly number[], focus: number | null, signal: AbortSignal): Promise<PrefetchReply>;
  /** Stop preparing ahead (the row closed). */
  stopPrefetch?(): Promise<void>;
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
  creator: CreatorPort;
  /** Show a save's V on the head (its facial shape and body), or none for the default V: used when Undo returns to another V. */
  showSave(save: SavedV | null): void;
  /** The shown V's preparation (character-detail-actions.ts): whether it failed, and Try again (PREV-86). */
  details?: { failed(): boolean; retry(): void };
};
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
/** The workspace's form (preview state `character`): what was set and where the V came from, and the Clothing setting when not the default. */
export type StoredCharacter = { origin: "default" | "save" | "preset"; name?: string; bodyGender?: BodyGender; choices: CharacterChoice[];
  kept?: Record<string, unknown>; clothing?: ClothingSetting };
/**
 * The Clothing setting as the presentation reads it: the state, the areas `custom` shows, the areas the save dresses (what can be picked),
 * where the clothes come from, one plain line when there is something to say, and the setting's own Undo and Redo labels.
 */
export type ClothingSnapshot = { state: ClothingState; custom: ClothingArea[]; worn: ClothingArea[];
  /** The areas the current state shows, and the states and areas as the control words them (so the presentation derives nothing). */
  shown: ClothingArea[]; states: { value: ClothingState; label: string }[]; areas: { area: ClothingArea; label: string }[];
  source: "save" | "none" | "unread" | "older"; note: string; undo: string | null; redo: string | null };
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
  /** Bumps on every change of state, panel, view or pages. */
  revision: number;
};

const HISTORY_LIMIT = 100;
/** Most positions one question about a row's choices names. */
const CHOICE_PREFETCH_POSITIONS = 512;
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
const pageKey = (option: string, query: string) => `${option}\n${query}`;
/** A change as a choice, validated by the shared rule (null when it breaks it). */
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
    ...(clothing && !sameClothing(clothing, DEFAULT_CLOTHING) ? { clothing } : {}) };
}

export class CharacterContextActions {
  private state: State;
  private past: { label: string; state: State }[] = [];
  private future: { label: string; state: State }[] = [];
  /** Choices a V change cleared (for `keepChanges`), until the next change. */
  private cleared: readonly CharacterChoice[] = [];
  private catalogue: { phase: CharacterContextSnapshot["phase"]; message: string; next?: CreatorNext | null; panel: CcPanel | null; gender: BodyGender | null } =
    { phase: "idle", message: "", panel: null, gender: null };
  private byId = new Map<string, CcPanelOption>();
  /** Pages by option and search (`pageKey`). */
  private pages = new Map<string, { choices: CcPanelChoice[]; total: number; loading: boolean; error: string | null }>();
  private searching: (CharacterSearchState & { controller: AbortController | null }) | null = null;
  private currentView: CreatorView | null = null;
  private viewKey: string | null = null;
  private viewing: { key: string; controller: AbortController } | null = null;
  private viewError: string | null = null;
  /**
   * The catalogue follow's session and generation: a new one aborts every page, search and view of the previous one, and an answer
   * that arrives anyway is dropped by its generation (CORE-72). `loading` while the host's catalogue is still on its way.
   */
  private session: AbortController | null = null;
  private loading = false;
  private generation = 0;
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
  /** The Clothing setting and its own Undo history (it is not a creator choice). */
  private clothing: ClothingSetting = DEFAULT_CLOTHING;
  private clothingPast: { label: string; setting: ClothingSetting }[] = [];
  private clothingFuture: { label: string; setting: ClothingSetting }[] = [];
  /** Which history each of the panel's steps is in, oldest first, and the undone ones (newest last): one order for Undo (UI-81). */
  private order: ("v" | "clothing")[] = [];
  private undone: ("v" | "clothing")[] = [];

  constructor(private readonly ports: CharacterContextPorts, initial: { stored?: unknown; save?: SavedV; legacy?: { style: string; definition: string } } = {}) {
    const stored = storedCharacterOf(initial.stored);
    const save = initial.save ? this.saveOf(initial.save) : null;
    const origin: ContextOrigin = stored?.origin === "preset" ? { kind: "preset", name: stored.name ?? null }
      : stored?.origin === "default" || !save ? { kind: "default" } : { kind: "save" };
    let kept: CcPreset | null = null;
    if (stored?.kept) { try { kept = parseCcPreset(stored.kept); } catch { kept = null; } }
    this.state = { origin, bodyGender: origin.kind === "save" ? save!.value.isMale ? "male" : "female" : stored?.bodyGender ?? "female",
      save: origin.kind === "save" ? save : null, choices: stored?.choices ?? [], kept, notCarried: [] };
    this.knownSave = saveKey(initial.save);
    this.legacy = !stored && initial.legacy?.style && initial.legacy.definition ? { ...initial.legacy } : null;
    this.clothing = stored?.clothing ?? DEFAULT_CLOTHING;
  }
  /** The save the saved-V service shows now (its content key), as this service last saw it: a change it didn't make is a new V. */
  private knownSave: string;

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish() { this.revision++; for (const listener of this.listeners) listener(); }

  // -------------------------------------------------------------------------------------------------------------
  // Reads

  snapshot(): CharacterContextSnapshot {
    const notes = summariseMissing(this.state.notCarried).summary.map(item => item.message);
    return structuredClone({ phase: this.catalogue.phase, message: this.catalogue.message, next: this.catalogue.next ?? null, origin: this.state.origin, bodyGender: this.state.bodyGender,
      set: this.state.choices.length, undo: this.stepLabel(this.order, this.past, this.clothingPast), redo: this.stepLabel(this.undone, this.future, this.clothingFuture),
      keepable: this.cleared.length, viewing: !!this.viewing, viewError: this.viewError, notes,
      retry: this.capability({ kind: "character.retry" }).available, firstTime: this.firstTime,
      prepared: { bytes: this.prepared.bytes, clearing: this.prepared.clearing, freed: this.prepared.freed }, clothing: this.clothingSnapshot(),
      revision: this.revision });
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
      undo: this.clothingPast.at(-1)?.label ?? null, redo: this.clothingFuture.at(-1)?.label ?? null };
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
  view(): Readonly<CreatorView> | null { return this.currentView; }
  /** Whether `view()` answers the current state (not an earlier one still shown while the new view is on its way). */
  viewCurrent(): boolean { return !!this.currentView && this.viewKey === JSON.stringify(this.request()); }
  /** An option's choices loaded so far (with `query`, its choices matching it); asking starts loading the next page. */
  choices(option: string, want = CC_PAGE_SIZE, query = ""): CharacterChoicesState {
    const wanted = searchQuery(query), key = pageKey(option, wanted);
    const page = this.pages.get(key);
    if (!page || (!page.loading && !page.error && page.choices.length < Math.min(want, page.total))) void this.loadPage(option, wanted);
    return this.pages.get(key) ?? { choices: [], total: this.byId.get(option)?.count ?? 0, loading: true, error: null };
  }
  /** The options with a choice matching `query` (the host searches every choice, not only those loaded; UI-72). */
  search(query: string): CharacterSearchState {
    const wanted = searchQuery(query);
    if (!wanted) return { query: "", options: null, more: false, loading: false, error: null };
    if (this.searching?.query !== wanted) this.startSearch(wanted);
    const found = this.searching!;
    return { query: found.query, options: found.options, more: found.more, loading: found.loading, error: found.error };
  }
  /**
   * A row's choices prepared ahead: asks the host to prepare `positions` (visible ones first) in the background and returns their
   * states so far (frozen; a new object when they change). `focus` (a hovered or focused choice) goes to the front. Null when the host
   * can't prepare ahead, the catalogue isn't ready, or the shown V is one the preview doesn't draw (a masculine V shows the default V).
   */
  prefetch(option: string, positions: readonly number[], focus: number | null = null): CharacterFetchState | null {
    if (!this.ports.creator.prefetch || !this.ready() || this.state.bodyGender !== "female" || !positions.length) return null;
    // Keyed by the V without the row's own choice, so choosing in the row keeps the states it has.
    const request = this.detailRequest();
    const key = JSON.stringify([{ ...request, choices: (request.choices ?? []).filter(choice => `${choice.part}/${choice.option}` !== option) }, option]);
    if (this.fetch?.key !== key) {
      this.fetch?.asking?.abort();
      this.fetch = { key, option, positions: [], focus: null, sent: "", states: new Map(), stopped: null, busy: true, asking: null, again: false,
        view: Object.freeze({ option, states: new Map(), stopped: null, busy: true }) };
    }
    // A hint stays until the next one (the next paint asks without one).
    const fetch = this.fetch, wanted = positions.slice(0, CHOICE_PREFETCH_POSITIONS), hint = focus ?? fetch.focus;
    const sent = JSON.stringify([wanted, hint]);
    if (sent !== fetch.sent) { fetch.sent = sent; fetch.positions = wanted; fetch.focus = hint; this.askPrefetch(fetch); }
    return fetch.view;
  }
  /** The row closed: stop preparing its choices ahead. */
  stopPrefetch(option: string): void {
    if (this.fetch?.option !== option) return;
    this.fetch.asking?.abort();
    this.fetch = null;
    void this.ports.creator.stopPrefetch?.().catch(() => {});
  }
  private askPrefetch(fetch: NonNullable<CharacterContextActions["fetch"]>) {
    if (fetch.asking) { fetch.again = true; return; }
    const controller = new AbortController();
    fetch.asking = controller;
    const current = () => this.fetch === fetch && !this.disposed;
    this.ports.creator.prefetch!(this.detailRequest(), fetch.option, fetch.positions, fetch.focus, controller.signal).then(reply => {
      if (!current()) return;
      let changed = reply.stopped !== fetch.stopped || reply.busy !== fetch.busy;
      fetch.positions.forEach((position, index) => {
        const state = (reply.states[index] ?? "?") as ChoiceFetch;
        if (fetch.states.get(position) !== state) { fetch.states.set(position, state); changed = true; }
      });
      const wasBusy = fetch.busy;
      fetch.stopped = reply.stopped; fetch.busy = reply.busy;
      if (changed) {
        fetch.view = Object.freeze({ option: fetch.option, states: new Map(fetch.states), stopped: fetch.stopped, busy: fetch.busy });
        this.publish();
      }
      // The prepared files grew: their size is read again once the row settles.
      if (wasBusy && !reply.busy) this.refreshPrepared();
    }, () => { /* The host is unreachable or the page is older: the states stay as they were. */ }).finally(() => {
      if (fetch.asking === controller) fetch.asking = null;
      if (!current()) return;
      if (fetch.again) { fetch.again = false; this.askPrefetch(fetch); return; }
      // While the host has work, ask again: quickly while the panel is looked at, slowly otherwise.
      if (fetch.busy) void this.ports.creator.wait(Date.now() - this.watchedAt < WATCHED_MS ? POLL_MS : POLL_IDLE_MS, controller.signal)
        .then(() => { if (current() && !fetch.asking) this.askPrefetch(fetch); });
    });
  }
  /** Read the prepared game files' size again (once at a time). */
  refreshPrepared(): void {
    if (!this.ports.creator.preparedFiles || this.prepared.asking || this.prepared.clearing) return;
    this.prepared.asking = true;
    this.ports.creator.preparedFiles().then(size => { this.prepared.bytes = size.bytes; this.publish(); }, () => {})
      .finally(() => { this.prepared.asking = false; });
  }
  /** Where a choice sits among its option's loaded choices (null when it isn't loaded). */
  private positionOf(change: CharacterChoice): number | null {
    const option = this.option(change.part, change.option);
    const page = option ? this.pages.get(pageKey(option.id, "")) : undefined;
    return page?.choices.find(item => item.key === change.choice && (!change.activates || sameSet(item.activates, change.activates)))?.position ?? null;
  }

  /**
   * The request the preview prepares: the shown V (head, body and arms) with the choices set on it (a masculine V shows the default V).
   * The host keeps the body parts its third-person consumers read (character-detail-plan.ts `previewInput`).
   */
  detailRequest(): CharacterRequest {
    if (this.state.bodyGender === "male") return DEFAULT_CHARACTER;
    return characterRequestOf({ bodyGender: this.state.bodyGender, saved: this.state.save?.saved ?? null }, this.state.choices, undefined, this.dressing(),
      this.bodyShown);
  }
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
  /** The whole state as the host interprets it (every part). */
  request(): CharacterRequest {
    return characterRequestOf({ bodyGender: this.state.bodyGender, saved: this.state.save?.saved ?? null }, this.state.choices);
  }
  /** The workspace's form; undefined when nothing needs storing (the V as loaded, nothing set). */
  stored(): StoredCharacter | undefined {
    const { origin, choices, kept } = this.state;
    const clothing = sameClothing(this.clothing, DEFAULT_CLOTHING) ? null : this.clothing;
    if (!choices.length && !clothing && origin.kind !== "preset" && !(origin.kind === "default" && this.knownSave)) return undefined;
    return { origin: origin.kind, ...(origin.kind === "preset" && origin.name ? { name: origin.name } : {}),
      ...(origin.kind !== "save" ? { bodyGender: this.state.bodyGender } : {}), choices: choices.map(choice => ({ ...choice })),
      ...(kept ? { kept: serializeCcPreset(kept) } : {}), ...(clothing ? { clothing: { state: clothing.state, custom: [...clothing.custom] } } : {}) };
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
    this.follow(gender, signal => this.ports.creator.panel(gender, signal));
  }
  private follow(gender: BodyGender, first: (signal: AbortSignal) => Promise<CreatorState>) {
    this.session?.abort();
    this.viewing?.controller.abort();
    this.viewing = null;
    this.searching?.controller?.abort();
    this.searching = null;
    const controller = new AbortController(), generation = ++this.generation;
    this.session = controller;
    this.loading = true;
    this.catalogue = { phase: "preparing", message: "", panel: null, gender };
    this.byId.clear(); this.pages.clear();
    this.publish();
    const live = () => !controller.signal.aborted && generation === this.generation && !this.disposed;
    void (async () => {
      try {
        let state = await first(controller.signal);
        while (state.phase === "preparing" && live()) {
          this.catalogue = { ...this.catalogue, message: state.message };
          // Polled quickly while the panel is looked at, slowly otherwise; the host's state is a cheap read that never builds again.
          await this.ports.creator.wait(Date.now() - this.watchedAt < WATCHED_MS ? POLL_MS : POLL_IDLE_MS, controller.signal);
          if (!live()) return;
          state = await this.ports.creator.panel(gender, controller.signal);
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

  private async loadPage(option: string, query: string) {
    const key = pageKey(option, query), current = this.pages.get(key);
    if (current?.loading || this.catalogue.phase !== "ready" || !this.session) return;
    const generation = this.generation, gender = this.state.bodyGender, signal = this.session.signal;
    const offset = current?.choices.length ?? 0;
    this.pages.set(key, { choices: current?.choices ?? [], total: current?.total ?? this.byId.get(option)?.count ?? 0, loading: true, error: null });
    try {
      const page = await this.ports.creator.page(gender, option, offset, signal, query || undefined);
      if (generation !== this.generation || this.disposed || this.stale(page.identity)) return;
      const before = this.pages.get(key)?.choices ?? [];
      this.pages.set(key, { choices: deepFreeze([...before, ...page.choices]), total: page.total, loading: false, error: null });
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.pages.set(key, { choices: current?.choices ?? [], total: current?.total ?? 0, loading: false,
        error: (error as Error)?.message || "The choices couldn't be read." });
    }
    this.publish();
  }
  private startSearch(query: string) {
    this.searching?.controller?.abort();
    if (!this.ports.creator.search || this.catalogue.phase !== "ready") {
      this.searching = { query, options: null, more: false, loading: false, error: null, controller: null };
      return;
    }
    const controller = new AbortController(), generation = this.generation;
    this.searching = { query, options: null, more: false, loading: true, error: null, controller };
    this.ports.creator.search(this.state.bodyGender, query, controller.signal).then(found => {
      if (controller.signal.aborted || generation !== this.generation || this.stale(found.identity)) return;
      this.searching = { query, options: new Set(found.options), more: found.more, loading: false, error: null, controller: null };
      this.publish();
    }, error => {
      if (controller.signal.aborted || generation !== this.generation) return;
      this.searching = { query, options: null, more: false, loading: false, error: (error as Error)?.message || "The search couldn't be run.", controller: null };
      this.publish();
    });
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
    this.ports.creator.view(request, controller.signal).then(view => {
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
    if (!legacy || !this.ports.creator.legacy || this.state.choices.length || this.past.length || this.state.bodyGender !== "female") return;
    const before = this.state, generation = this.generation;
    this.ports.creator.legacy(before.bodyGender, legacy.style, legacy.definition).then(choices => {
      if (this.disposed || generation !== this.generation || this.state !== before || this.past.length) return;
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
    const page = this.pages.get(pageKey(option.id, ""));
    // A choice is checked against the option's choices once they are all here; the host checks it again either way.
    if (page && !page.loading && page.choices.length >= page.total &&
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
  private hideChanges(): CharacterChoice[] {
    const panel = this.panel();
    return panel ? makeupOff(panel, this.viewCurrent() ? this.currentView : null) : [];
  }

  capability(action: CharacterContextAction): Capability {
    switch (action.kind) {
      case "character.setOption":
        if (!this.ready()) return this.notReady();
        return this.changesCheck([{ part: action.part, option: action.option, choice: action.choice, ...(action.activates ? { activates: action.activates } : {}) }]).capability;
      case "character.setOptions":
        if (!this.ready()) return this.notReady();
        return this.changesCheck(action.changes).capability;
      case "character.hideOwnMakeup": {
        if (!this.ready()) return this.notReady();
        if (!this.viewCurrent()) return refusal("not_ready", "Your V's current choices are still loading.");
        const changes = this.hideChanges();
        return changes.length ? this.changesCheck(changes).capability : refusal("invalid_value", "Every makeup row on your V is already Off.");
      }
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
        if (!this.ports.creator.clearPrepared) return refusal("unavailable", "This version of XF Studio can't clear its prepared game files.");
        if (this.prepared.clearing) return refusal("busy", "The prepared game files are being cleared.");
        return this.prepared.bytes === 0 ? refusal("invalid_value", "There are no prepared game files to clear.") : { available: true };
      case "character.undo":
        return this.order.length ? { available: true } : refusal("invalid_value", "There is no character change to undo.");
      case "character.redo":
        return this.undone.length ? { available: true } : refusal("invalid_value", "There is no undone character change to redo.");
      case "character.setClothing":
        if (this.clothing.state === action.state) return refusal("invalid_value", `${CLOTHING_STATE_LABELS[action.state]} is already shown.`);
        return this.offeredStates().includes(action.state) ? { available: true }
          : refusal("invalid_value", `${CLOTHING_STATE_LABELS[action.state]} wouldn't change what your V wears.`);
      case "character.setClothingArea": {
        const shown = this.shownAreas().includes(action.area);
        return shown === action.shown ? refusal("invalid_value", action.shown ? "That area is already shown." : "That area is already hidden.") : { available: true };
      }
      case "character.undoClothing":
        return this.clothingPast.length ? { available: true } : refusal("invalid_value", "There is no clothing change to undo.");
      case "character.redoClothing":
        return this.clothingFuture.length ? { available: true } : refusal("invalid_value", "There is no undone clothing change to redo.");
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
  private clothingStep(label: string, setting: ClothingSetting) {
    if (sameClothing(setting, this.clothing)) return;
    this.clothingPast.push({ label, setting: this.clothing });
    this.ordered("clothing", this.clothingPast);
    this.clothing = setting;
    this.publish();
  }
  /** A new step of one kind: it joins the panel's order, the oldest step past the limit goes, and nothing can be redone any more. */
  private ordered(kind: "v" | "clothing", past: unknown[]) {
    this.order.push(kind);
    if (past.length > HISTORY_LIMIT) { past.shift(); this.order.splice(this.order.indexOf(kind), 1); }
    this.future = []; this.clothingFuture = []; this.undone = [];
  }
  /** The label of the step the panel's Undo (or Redo) would take next. */
  private stepLabel(order: ("v" | "clothing")[], choices: { label: string }[], clothing: { label: string }[]) {
    const kind = order.at(-1);
    return (kind === "v" ? choices.at(-1)?.label : kind === "clothing" ? clothing.at(-1)?.label : undefined) ?? null;
  }
  /** Move the newest step of `kind` from one order to the other (the Clothing setting's own Undo and Redo). */
  private reorder(kind: "v" | "clothing", from: ("v" | "clothing")[], to: ("v" | "clothing")[]) {
    const at = from.lastIndexOf(kind);
    if (at >= 0) from.splice(at, 1);
    to.push(kind);
  }
  private clothingTravel(from: { label: string; setting: ClothingSetting }[], to: { label: string; setting: ClothingSetting }[]) {
    const entry = from.pop()!;
    to.push({ label: entry.label, setting: this.clothing });
    this.clothing = entry.setting;
    this.publish();
  }

  /** Apply an action; throws the refusal's reason when the capability refuses. */
  dispatch(action: CharacterContextAction): Record<string, never> {
    const allowed = this.capability(action);
    if (!allowed.available) throw Error(allowed.reason);
    if (action.kind !== "character.setOption" && action.kind !== "character.clearPreparedFiles") this.firstTime = false;
    switch (action.kind) {
      case "character.setOption": {
        const { choices } = this.changesCheck([{ part: action.part, option: action.option, choice: action.choice, ...(action.activates ? { activates: action.activates } : {}) }]);
        // A choice not prepared ahead reads the game files now (the status line says so); one prepared ahead is instant.
        const position = choices[0] ? this.positionOf(choices[0]) : null, option = this.option(action.part, action.option);
        this.firstTime = !(this.fetch && option && this.fetch.option === option.id && position !== null && this.fetch.states.get(position) === "r");
        this.step(plainStep(this.option(action.part, action.option), action.choice), this.withChoices(choices));
        break;
      }
      case "character.setOptions": {
        const { choices } = this.changesCheck(action.changes);
        this.step(action.label || `Change ${choices.length} options`, this.withChoices(choices));
        break;
      }
      case "character.hideOwnMakeup":
        this.step("Hide my V's own makeup", this.withChoices(this.hideChanges()));
        break;
      case "character.reset": {
        const family = this.option(action.part, action.option)?.link?.key;
        this.step(`Reset ${this.option(action.part, action.option)?.label ?? action.option}`, { ...this.state,
          choices: this.state.choices.filter(choice => !(choice.part === action.part && choice.option === action.option) &&
            !(family && this.option(choice.part, choice.option)?.link?.key === family)) });
        break;
      }
      case "character.resetAll": this.step("Reset every change", { ...this.state, choices: [] }); break;
      case "character.useDefault":
        this.changeV("Show the default V", { origin: { kind: "default" }, bodyGender: action.bodyGender, save: null, choices: [], kept: null, notCarried: [] });
        break;
      case "character.loadSave": {
        const save = this.saveOf(action.value as SavedV);
        this.knownSave = saveKey(action.value as SavedV);
        this.changeV("Load a save", { origin: { kind: "save" }, bodyGender: save.value.isMale ? "male" : "female", save, choices: [], kept: null, notCarried: [] }, false);
        break;
      }
      case "character.loadPreset": {
        const preset = this.preset(action.value) as CcPreset;
        // What can't be carried is reported and kept verbatim, so saving the preset writes it back (PIPE-79).
        const { choices, carried, notCarried } = carryPreset(preset);
        const left = preset.values.filter(entry => !carried.includes(entry)), at = preset.values.length + preset.unknownEntries.length;
        const kept: CcPreset = { ...preset, values: carried,
          unknownEntries: [...preset.unknownEntries, ...left.map((entry, i) => ({ at: at + i, entry: serializeCcPresetEntry(entry) }))] };
        this.changeV(`Load ${preset.name ? `“${preset.name}”` : "a character preset"}`, { origin: { kind: "preset", name: preset.name },
          bodyGender: preset.bodyGender, save: null, choices, kept, notCarried });
        break;
      }
      case "character.keepChanges": {
        const choices = this.cleared;
        this.cleared = [];
        this.step("Keep my changes", this.withChoices(choices));
        break;
      }
      case "character.retry":
        if (this.catalogue.phase === "failed" || this.retryableLabels()) {
          const gender = this.state.bodyGender, creator = this.ports.creator;
          this.follow(gender, signal => creator.retry ? creator.retry(gender, signal) : creator.panel(gender, signal));
        }
        if (this.ports.details?.failed()) this.ports.details.retry();
        this.publish();
        break;
      case "character.clearPreparedFiles": {
        this.prepared = { ...this.prepared, clearing: true, freed: null };
        this.fetch?.asking?.abort();
        this.fetch = null;
        this.publish();
        this.ports.creator.clearPrepared!().then(result => { this.prepared = { ...this.prepared, clearing: false, freed: result.freed }; },
          () => { this.prepared = { ...this.prepared, clearing: false }; })
          .finally(() => { this.publish(); this.refreshPrepared(); });
        break;
      }
      // The panel's one Undo (UI-81): the newest change, creator choice or Clothing.
      case "character.undo": {
        const kind = this.order.pop()!;
        this.undone.push(kind);
        if (kind === "v") this.travel(this.past, this.future); else this.clothingTravel(this.clothingPast, this.clothingFuture);
        break;
      }
      case "character.redo": {
        const kind = this.undone.pop()!;
        this.order.push(kind);
        if (kind === "v") this.travel(this.future, this.past); else this.clothingTravel(this.clothingFuture, this.clothingPast);
        break;
      }
      case "character.setClothing":
        this.clothingStep(`Clothing: ${CLOTHING_STATE_LABELS[action.state]}`, { state: action.state,
          custom: action.state === "custom" ? this.shownAreas() : this.clothing.custom });
        break;
      case "character.setClothingArea": {
        const shown = new Set(this.shownAreas());
        if (action.shown) shown.add(action.area); else shown.delete(action.area);
        this.clothingStep(`${action.shown ? "Show" : "Hide"} ${CLOTHING_AREA_LABELS[action.area].toLowerCase()}`,
          { state: "custom", custom: CLOTHING_AREAS.filter(area => shown.has(area)) });
        break;
      }
      case "character.undoClothing": this.reorder("clothing", this.order, this.undone); this.clothingTravel(this.clothingPast, this.clothingFuture); break;
      case "character.redoClothing": this.reorder("clothing", this.undone, this.order); this.clothingTravel(this.clothingFuture, this.clothingPast); break;
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

  private step(label: string, next: State, clearKeep = true) {
    if (next === this.state || (sameChoices(next.choices, this.state.choices) && next.origin === this.state.origin && next.save === this.state.save)) return;
    this.past.push({ label, state: this.state });
    this.ordered("v", this.past);
    if (clearKeep) this.cleared = [];
    this.apply(next);
  }
  /** Another V: one step, and the choices made on the previous V can be kept (`keepChanges`). */
  private changeV(label: string, next: State, showSave = true) {
    const previous = this.state;
    this.cleared = next.choices.length ? [] : previous.choices;
    this.step(label, next, false);
    if (showSave && saveKey(previous.save?.value) !== saveKey(next.save?.value)) this.showSave(next.save?.value ?? null);
  }
  private travel(from: { label: string; state: State }[], to: { label: string; state: State }[]) {
    const entry = from.pop()!;
    to.push({ label: entry.label, state: this.state });
    this.cleared = [];
    const previous = this.state;
    this.apply(entry.state);
    if (saveKey(previous.save?.value) !== saveKey(entry.state.save?.value)) this.showSave(entry.state.save?.value ?? null);
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
    this.changeV("Load a save", { origin: { kind: "save" }, bodyGender: save.isMale ? "male" : "female", save: parsed, choices: [], kept: null, notCarried: [] }, false);
  }

  /** A portable preset of the choices set on this V (the host names each choice as this installation offers it). */
  exportPreset(name: string | null): Promise<{ text: string; values: number; leftOut: number; personal: number }> {
    return this.ports.creator.preset(this.request(), name, this.state.kept ? serializeCcPreset(this.state.kept) : undefined);
  }

  dispose() {
    this.disposed = true;
    this.fetch?.asking?.abort();
    this.session?.abort();
    this.viewing?.controller.abort();
    this.searching?.controller?.abort();
    this.listeners.clear();
  }
}
