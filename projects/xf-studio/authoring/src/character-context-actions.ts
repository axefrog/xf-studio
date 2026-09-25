/**
 * Application service that owns the character context in the Studio (CORE-58): which V the makeup is shown on (the creator's default
 * V, a loaded save, or a portable preset) and every creator choice a person set on it. DOM-free. It holds only what the person set
 * (portable identities, character-context.ts) and asks the preview host (through `CreatorPort`) for everything derived from the
 * installed catalogue: the panel's options, their choices page by page, and the view of every row's current choice.
 *
 * - **History** (CORE-59): creator changes have their own small Undo history, separate from the makeup look's. Each step is one
 *   whole context state; loading a save or a preset is one step, and so is "hide my V's own makeup". It lives in memory only.
 * - **A new V clears the choices made on the previous one**; `character.keepChanges` puts them back on the new V as one more step
 *   (offered until the next change).
 * - **Persistence**: the choices, the V source and a loaded preset's kept entries go into the workspace's preview state
 *   (`stored()`), only once something was set, so a workspace that never uses these controls keeps its stored bytes.
 *
 * Presentation reads it through `snapshot()` (small, cloned) and the frozen `panel()`, `view()` and `choices(option)` (large, shared
 * read-only objects, never cloned per paint).
 */
import type { CcoPart } from "./cco-model";
import type { BodyGender } from "./cc-catalogue";
import { type CcChoicePage, type CcPanel, type CcPanelChoice, type CcPanelOption, CC_PAGE_SIZE, type CreatorState, type CreatorView } from "./cc-panel";
import { type CcPreset, parseCcPreset, serializeCcPreset } from "./cc-preset";
import { type CharacterChoice, characterChoiceOf, type CharacterContextAction, choicesOfPreset, SAVED_LIMITS, type SavedDescriptors,
  savedDescriptorsOf } from "./character-context";
import { characterRequestOf, DEFAULT_CHARACTER, type CharacterRequest } from "./character-detail-request";
import { refusal, type Capability } from "./platform/api";
import type { SavedV } from "./save-reader";

/** The host side of the context: the installed catalogue's panel, pages, views and presets (cc-catalogue-server.ts). */
export type CreatorPort = {
  panel(gender: BodyGender, signal: AbortSignal): Promise<CreatorState>;
  page(gender: BodyGender, option: string, offset: number, signal: AbortSignal): Promise<CcChoicePage>;
  view(request: CharacterRequest, signal: AbortSignal): Promise<CreatorView>;
  preset(request: CharacterRequest, name: string | null, kept: Record<string, unknown> | undefined): Promise<{ text: string; values: number; leftOut: number; personal: number }>;
  wait(ms: number, signal: AbortSignal): Promise<void>;
};
export type CharacterContextPorts = {
  creator: CreatorPort;
  /** Show a save's V on the head (its facial shape and body), or none for the default V: used when Undo returns to another V. */
  showSave(save: SavedV | null): void;
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
};
/** The workspace's form (preview state `character`): what was set and where the V came from. */
export type StoredCharacter = { origin: "default" | "save" | "preset"; name?: string; bodyGender?: BodyGender; choices: CharacterChoice[];
  kept?: Record<string, unknown> };
export type CharacterChoicesState = { readonly choices: readonly CcPanelChoice[]; readonly total: number; readonly loading: boolean; readonly error: string | null };
export type CharacterContextSnapshot = {
  /** The catalogue: loading, ready, or failed with one plain line. */
  phase: "idle" | "preparing" | "ready" | "failed";
  message: string;
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
  /** Bumps on every change of state, panel, view or pages. */
  revision: number;
};

const HISTORY_LIMIT = 100;
const POLL_MS = 800;
const LOADING = "The creator options are still loading.";
const plainStep = (option: CcPanelOption | undefined, choice: string, label?: string) =>
  label ? label : option ? `Change ${option.label}` : `Change ${choice || "an option"}`;
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
};
const sameChoices = (a: readonly CharacterChoice[], b: readonly CharacterChoice[]) => JSON.stringify(a) === JSON.stringify(b);
/** A save's identity by content (the saved-V service hands out copies). */
const saveKey = (save: SavedV | null | undefined) => save ? JSON.stringify([save.isMale, save.groups]) : "";

/** A stored context, validated (anything else is dropped). */
export function storedCharacterOf(value: unknown): StoredCharacter | null {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== "object" || Array.isArray(v) || !["default", "save", "preset"].includes(v.origin as string)) return null;
  if (!Array.isArray(v.choices) || v.choices.length > SAVED_LIMITS.choices) return null;
  const choices = v.choices.flatMap(item => { const choice = characterChoiceOf(item); return choice ? [choice] : []; });
  let kept: Record<string, unknown> | undefined;
  if (v.kept !== undefined) { try { kept = serializeCcPreset(parseCcPreset(v.kept)); } catch { kept = undefined; } }
  return { origin: v.origin as StoredCharacter["origin"], ...(typeof v.name === "string" && v.name.length <= 120 && !/[\u0000-\u001f]/.test(v.name) ? { name: v.name } : {}),
    ...(v.bodyGender === "female" || v.bodyGender === "male" ? { bodyGender: v.bodyGender } : {}), choices, ...(kept ? { kept } : {}) };
}

export class CharacterContextActions {
  private state: State;
  private past: { label: string; state: State }[] = [];
  private future: { label: string; state: State }[] = [];
  /** Choices a V change cleared (for `keepChanges`), until the next change. */
  private cleared: readonly CharacterChoice[] = [];
  private catalogue: { phase: CharacterContextSnapshot["phase"]; message: string; panel: CcPanel | null; gender: BodyGender | null } =
    { phase: "idle", message: "", panel: null, gender: null };
  private byId = new Map<string, CcPanelOption>();
  private pages = new Map<string, { choices: CcPanelChoice[]; total: number; loading: boolean; error: string | null }>();
  private currentView: CreatorView | null = null;
  private viewing: { key: string; controller: AbortController } | null = null;
  private viewError: string | null = null;
  private loading: AbortController | null = null;
  private presets = new WeakMap<object, CcPreset | Error>();
  private revision = 0;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(private readonly ports: CharacterContextPorts, initial: { stored?: unknown; save?: SavedV } = {}) {
    const stored = storedCharacterOf(initial.stored);
    const save = initial.save ? this.saveOf(initial.save) : null;
    const origin: ContextOrigin = stored?.origin === "preset" ? { kind: "preset", name: stored.name ?? null }
      : stored?.origin === "default" || !save ? { kind: "default" } : { kind: "save" };
    let kept: CcPreset | null = null;
    if (stored?.kept) { try { kept = parseCcPreset(stored.kept); } catch { kept = null; } }
    this.state = { origin, bodyGender: origin.kind === "save" ? save!.value.isMale ? "male" : "female" : stored?.bodyGender ?? "female",
      save: origin.kind === "save" ? save : null, choices: stored?.choices ?? [], kept };
    this.knownSave = saveKey(initial.save);
  }
  /** The save the saved-V service shows now (its content key), as this service last saw it: a change it didn't make is a new V. */
  private knownSave: string;

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish() { this.revision++; for (const listener of this.listeners) listener(); }

  // -------------------------------------------------------------------------------------------------------------
  // Reads

  snapshot(): CharacterContextSnapshot {
    return structuredClone({ phase: this.catalogue.phase, message: this.catalogue.message, origin: this.state.origin, bodyGender: this.state.bodyGender,
      set: this.state.choices.length, undo: this.past.at(-1)?.label ?? null, redo: this.future.at(-1)?.label ?? null,
      keepable: this.cleared.length, viewing: !!this.viewing, viewError: this.viewError, revision: this.revision });
  }
  /** The panel's options for the shown V's body (frozen; shared, never copied). */
  panel(): Readonly<CcPanel> | null { return this.catalogue.gender === this.state.bodyGender ? this.catalogue.panel : null; }
  /** Every active row's current choice, the V's own and what couldn't be honoured (frozen), for the current state once it arrives. */
  view(): Readonly<CreatorView> | null { return this.currentView; }
  /** An option's choices loaded so far; asking starts loading the next page. */
  choices(option: string, want = CC_PAGE_SIZE): CharacterChoicesState {
    const page = this.pages.get(option);
    if (!page || (!page.loading && !page.error && page.choices.length < Math.min(want, page.total))) void this.loadPage(option);
    const now = this.pages.get(option);
    return now ?? { choices: [], total: this.byId.get(option)?.count ?? 0, loading: true, error: null };
  }
  /** The request the preview prepares: the head of the shown V with the choices set on it (a masculine V shows the default V). */
  detailRequest(): CharacterRequest {
    if (this.state.bodyGender === "male") return DEFAULT_CHARACTER;
    return characterRequestOf({ bodyGender: this.state.bodyGender, saved: this.state.save?.saved ?? null }, this.state.choices, ["head"]);
  }
  /** The whole state as the host interprets it (every part). */
  request(): CharacterRequest {
    return characterRequestOf({ bodyGender: this.state.bodyGender, saved: this.state.save?.saved ?? null }, this.state.choices);
  }
  /** The workspace's form; undefined when nothing needs storing (the V as loaded, nothing set). */
  stored(): StoredCharacter | undefined {
    const { origin, choices, kept } = this.state;
    if (!choices.length && origin.kind !== "preset" && !(origin.kind === "default" && this.knownSave)) return undefined;
    return { origin: origin.kind, ...(origin.kind === "preset" && origin.name ? { name: origin.name } : {}),
      ...(origin.kind !== "save" ? { bodyGender: this.state.bodyGender } : {}), choices: choices.map(choice => ({ ...choice })),
      ...(kept ? { kept: serializeCcPreset(kept) } : {}) };
  }

  // -------------------------------------------------------------------------------------------------------------
  // The catalogue and its pages

  /** Follow the host's catalogue for the shown V's body until it is ready (or fails), then fetch the view. */
  start(): void {
    if (this.disposed) return;
    const gender = this.state.bodyGender;
    if (this.catalogue.gender === gender && (this.catalogue.phase === "ready" || this.loading)) { this.refreshView(); return; }
    this.loading?.abort();
    const controller = new AbortController();
    this.loading = controller;
    this.catalogue = { phase: "preparing", message: "", panel: null, gender };
    this.byId.clear(); this.pages.clear();
    this.publish();
    void (async () => {
      try {
        let state = await this.ports.creator.panel(gender, controller.signal);
        while (state.phase === "preparing" && !controller.signal.aborted) {
          this.catalogue = { ...this.catalogue, message: state.message };
          await this.ports.creator.wait(POLL_MS, controller.signal);
          if (controller.signal.aborted) return;
          state = await this.ports.creator.panel(gender, controller.signal);
        }
        if (controller.signal.aborted) return;
        if (state.phase !== "ready" || !state.panel) {
          this.catalogue = { phase: "failed", message: state.message, panel: null, gender };
          this.publish();
          return;
        }
        const panel = deepFreeze(state.panel);
        this.byId = new Map(panel.options.map(option => [option.id, option]));
        this.catalogue = { phase: "ready", message: "", panel, gender };
        this.publish();
        this.refreshView();
      } catch (error) {
        if (controller.signal.aborted) return;
        this.catalogue = { phase: "failed", message: (error as Error)?.message || "The creator options couldn't be read.", panel: null, gender };
        this.publish();
      } finally { if (this.loading === controller) this.loading = null; }
    })();
  }

  private async loadPage(option: string) {
    const current = this.pages.get(option);
    if (current?.loading || this.catalogue.phase !== "ready") return;
    const offset = current?.choices.length ?? 0;
    this.pages.set(option, { choices: current?.choices ?? [], total: current?.total ?? this.byId.get(option)?.count ?? 0, loading: true, error: null });
    try {
      const page = await this.ports.creator.page(this.state.bodyGender, option, offset, new AbortController().signal);
      const before = this.pages.get(option)?.choices ?? [];
      this.pages.set(option, { choices: deepFreeze([...before, ...page.choices]), total: page.total, loading: false, error: null });
    } catch (error) {
      this.pages.set(option, { choices: current?.choices ?? [], total: current?.total ?? 0, loading: false,
        error: (error as Error)?.message || "The choices couldn't be read." });
    }
    this.publish();
  }

  /** Ask the host for the view of the current state (the previous question is dropped). */
  private refreshView() {
    if (this.catalogue.phase !== "ready" || this.disposed) return;
    const request = this.request(), key = JSON.stringify(request);
    if (this.viewing?.key === key) return;
    if (!this.viewing && this.currentView && this.viewKey === key) return;
    this.viewing?.controller.abort();
    const controller = new AbortController();
    this.viewing = { key, controller };
    this.publish();
    this.ports.creator.view(request, controller.signal).then(view => {
      if (controller.signal.aborted) return;
      this.currentView = deepFreeze(view); this.viewKey = key; this.viewError = null;
    }, error => {
      if (controller.signal.aborted) return;
      this.viewError = (error as Error)?.message || "Your V's current choices couldn't be read.";
    }).finally(() => {
      if (this.viewing?.controller !== controller) return;
      this.viewing = null;
      this.publish();
    });
  }
  private viewKey: string | null = null;

  // -------------------------------------------------------------------------------------------------------------
  // Actions

  private saveOf(value: SavedV) { return { value, saved: savedDescriptorsOf(value) }; }
  private option(part: CcoPart, name: string) { return this.byId.get(`${part}/${name}`); }
  private choiceCheck(part: CcoPart, name: string, choice: string): Capability {
    const option = this.option(part, name);
    if (!option) return refusal("missing_target", "That creator option isn't offered by the installed game and mods.");
    const page = this.pages.get(option.id);
    // A choice is checked against the option's choices once they are all here; the host checks it again either way.
    if (page && !page.loading && page.choices.length >= page.total && !page.choices.some(item => item.key === choice))
      return refusal("invalid_value", `“${choice || "None"}” isn't one of ${option.label}'s choices.`);
    return { available: true };
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
    const ready = this.catalogue.phase === "ready" && this.catalogue.gender === this.state.bodyGender;
    switch (action.kind) {
      case "character.setOption":
        if (!ready) return refusal("not_ready", this.catalogue.phase === "failed" ? this.catalogue.message || LOADING : LOADING);
        return this.choiceCheck(action.part, action.option, action.choice);
      case "character.setOptions": {
        if (!ready) return refusal("not_ready", LOADING);
        if (!Array.isArray(action.changes) || !action.changes.length || action.changes.length > 512) return refusal("invalid_value", "There is nothing to change.");
        for (const change of action.changes) {
          const allowed = this.choiceCheck(change?.part, change?.option, change?.choice);
          if (!allowed.available) return allowed;
        }
        return { available: true };
      }
      case "character.reset": {
        const option = this.option(action.part, action.option);
        const family = option?.link?.key;
        const set = this.state.choices.some(choice => choice.part === action.part && choice.option === action.option ||
          (!!family && this.option(choice.part, choice.option)?.link?.key === family));
        return set ? { available: true } : refusal("invalid_value", "That option already shows your V's own choice.");
      }
      case "character.resetAll":
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
        return this.cleared.length ? { available: true } : refusal("invalid_value", "There are no earlier changes to keep.");
      case "character.undo":
        return this.past.length ? { available: true } : refusal("invalid_value", "There is no character change to undo.");
      case "character.redo":
        return this.future.length ? { available: true } : refusal("invalid_value", "There is no undone character change to redo.");
    }
  }

  /** Apply an action; throws the refusal's reason when the capability refuses. */
  dispatch(action: CharacterContextAction): Record<string, never> {
    const allowed = this.capability(action);
    if (!allowed.available) throw Error(allowed.reason);
    switch (action.kind) {
      case "character.setOption":
        this.step(plainStep(this.option(action.part, action.option), action.choice), this.withChoices([{ part: action.part, option: action.option, choice: action.choice }]));
        break;
      case "character.setOptions":
        this.step(action.label || `Change ${action.changes.length} options`, this.withChoices(action.changes.map(change =>
          ({ part: change.part, option: change.option, choice: change.choice }))));
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
        this.changeV("Show the default V", { origin: { kind: "default" }, bodyGender: action.bodyGender, save: null, choices: [], kept: null });
        break;
      case "character.loadSave": {
        const save = this.saveOf(action.value as SavedV);
        this.knownSave = saveKey(action.value as SavedV);
        this.changeV("Load a save", { origin: { kind: "save" }, bodyGender: save.value.isMale ? "male" : "female", save, choices: [], kept: null }, false);
        break;
      }
      case "character.loadPreset": {
        const preset = this.preset(action.value) as CcPreset;
        const kept: CcPreset = { ...preset, values: [] };
        this.changeV(`Load ${preset.name ? `“${preset.name}”` : "a character preset"}`, { origin: { kind: "preset", name: preset.name },
          bodyGender: preset.bodyGender, save: null, choices: choicesOfPreset(preset), kept: { ...kept, values: [...preset.values] } });
        break;
      }
      case "character.keepChanges": {
        const choices = this.cleared;
        this.cleared = [];
        this.step("Keep my changes", { ...this.state, choices: [...this.state.choices, ...choices] });
        break;
      }
      case "character.undo": this.travel(this.past, this.future); break;
      case "character.redo": this.travel(this.future, this.past); break;
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
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
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
    this.changeV("Load a save", { origin: { kind: "save" }, bodyGender: save.isMale ? "male" : "female", save: parsed, choices: [], kept: null }, false);
  }

  /** A portable preset of the choices set on this V (the host names each choice as this installation offers it). */
  exportPreset(name: string | null): Promise<{ text: string; values: number; leftOut: number; personal: number }> {
    return this.ports.creator.preset(this.request(), name, this.state.kept ? serializeCcPreset(this.state.kept) : undefined);
  }

  dispose() {
    this.disposed = true;
    this.loading?.abort();
    this.viewing?.controller.abort();
    this.listeners.clear();
  }
}
