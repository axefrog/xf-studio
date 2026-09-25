/**
 * Host application service for the creator catalogue (UI-59): builds each body gender's catalogue once per installation in the
 * long-lived host (from the registry's shared installation, installation-registry.ts) and keeps it while the mod setup is unchanged,
 * then answers the Character panel from it:
 * - the panel's compact first-paint projection and paged choices (cc-panel.ts), with the preview's coverage (cc-render-coverage.ts);
 * - the character context's view: every row's current choice, the V's own, and what couldn't be honoured (`deriveCharacter`);
 * - the V's descriptors for a preparation with creator choices (`inputFor`, used by character-detail-service.ts);
 * - a portable preset of the choices a person set, checked for personal data before it is written (CORE-56).
 *
 * The installation fingerprint (the route, its stamps, WolvenKit's identity and the registry's generation) decides when a catalogue
 * is stale; a new one is built on the next question. One build runs at a time per body gender; everyone asking waits for it.
 * Read-only towards the game and the mod manager.
 */
import { createHash } from "node:crypto";
import { type BodyGender, CatalogueIndex, userFacing } from "./cc-catalogue";
import { type CatalogueLoad, loadCreatorCatalogue } from "./cc-catalogue-host";
import { choicePage, type CcChoicePage, type CcPanel, type CreatorState, type CreatorValue, type CreatorView, panelProjection } from "./cc-panel";
import { type CcPreset, type CcPresetEntry, writeCcPreset } from "./cc-preset";
import { catalogueCoverage } from "./cc-render-coverage";
import { type CharacterChoice, type CharacterSource, deriveCharacter, presetOfChoices, recoverSave, type SavedDescriptors } from "./character-context";
import { type CharacterRequest, savedOfRequest } from "./character-detail-request";
import type { CharacterInput } from "./character-resolver";
import { personalDataIn } from "./private-data";
import type { Installation, InstallationOptions } from "./resolver-host";

export type CreatorRoute = Omit<InstallationOptions, "cacheDir" | "log">;
export type CreatorHostOptions = {
  /** The launch route and WolvenKit, or null while they aren't set up. */
  route: () => CreatorRoute | null;
  /** The installation fingerprint (character-detail-host.ts `installationFingerprint`). */
  fingerprint: () => string;
  resolverCache: string;
  open?: (options: InstallationOptions) => Installation | Promise<Installation>;
  /** Test seam over the catalogue build. */
  load?: (installation: Installation, route: CreatorRoute, gender: BodyGender) => Promise<CatalogueLoad>;
  log?: (message: string) => void;
};

type Loaded = {
  source: CharacterSource & { index: CatalogueIndex };
  panel: CcPanel;
  mods: Map<string, number>;
  /** `recoverSave` of the last few saves (a save's interpretation is the costliest step of a view). */
  recovered: Map<string, ReturnType<typeof recoverSave>>;
};
type Entry = { fingerprint: string; promise: Promise<Loaded>; loaded: Loaded | null; error: string | null };

const NEEDS_SETUP = "Your game's character-creator options appear once your game folder and WolvenKit are set up.";
const PREPARING = "Reading your game's character-creator options…";
const FAILED = "XF Studio couldn't read your game's character-creator options, so they can't be changed here yet.";
const hex = (rgba: readonly number[] | null | undefined) => rgba
  ? `#${rgba.slice(0, 3).map(channel => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0")).join("")}` : null;
const faceGroup = (morphs: CharacterInput["morphs"]) => {
  const head = morphs.filter(morph => morph.part === "head");
  const group = head.some(morph => morph.group === "TPP") ? "TPP" : "character_customization";
  return head.filter(morph => morph.group === group).map(morph => ({ region: morph.region, target: morph.target }));
};

export class CreatorCatalogueHost {
  private readonly entries = new Map<BodyGender, Entry>();
  constructor(private readonly options: CreatorHostOptions) {}

  /** The catalogue for a body gender on the current installation: built once, rebuilt when the fingerprint changes. */
  ensure(gender: BodyGender): Promise<Loaded> {
    const route = this.options.route();
    if (!route) return Promise.reject(new CreatorSetupError());
    const fingerprint = this.options.fingerprint();
    const known = this.entries.get(gender);
    if (known && known.fingerprint === fingerprint && !known.error) return known.promise;
    const entry: Entry = { fingerprint, promise: null as unknown as Promise<Loaded>, loaded: null, error: null };
    entry.promise = this.build(route, gender, fingerprint).then(loaded => { entry.loaded = loaded; return loaded; },
      error => { entry.error = (error as Error)?.message ?? String(error); this.options.log?.(`Creator options were not read: ${(error as Error)?.stack ?? error}`); throw error; });
    this.entries.set(gender, entry);
    return entry.promise;
  }

  private async build(route: CreatorRoute, gender: BodyGender, fingerprint: string): Promise<Loaded> {
    const started = performance.now();
    const open = this.options.open ?? (await import("./installation-registry")).acquireInstallation;
    const installation = await open({ ...route, cacheDir: this.options.resolverCache, log: this.options.log });
    const load = await (this.options.load ?? ((inst: Installation, r: CreatorRoute, g: BodyGender) => loadCreatorCatalogue({ installation: inst,
      gameRoot: r.gameRoot, wolvenKitCli: r.wolvenKitCli, cacheDir: this.options.resolverCache, log: this.options.log }, g)))(installation, route, gender);
    const index = new CatalogueIndex(load.catalogue);
    const identity = createHash("sha256").update(`${fingerprint}\n${gender}\n${load.catalogue.language}\n${load.catalogue.counts.choices}`).digest("hex").slice(0, 24);
    const { panel, mods } = panelProjection(load.catalogue, catalogueCoverage(load.catalogue), identity);
    this.options.log?.(`Creator options (${gender}) read in ${((performance.now() - started) / 1000).toFixed(1)} s: ${panel.counts.options} options, ` +
      `${panel.counts.choices} choices, ${JSON.stringify(panel).length} bytes to the panel.`);
    return { source: { catalogue: load.catalogue, cco: load.source.cco, index }, panel, mods, recovered: new Map() };
  }

  /** The panel's state for a body gender, starting its build when needed; never waits. */
  state(gender: BodyGender): CreatorState {
    if (!this.options.route()) return { phase: "failed", message: NEEDS_SETUP };
    const promise = this.ensure(gender);
    promise.catch(() => {});
    const entry = this.entries.get(gender)!;
    if (entry.loaded) return { phase: "ready", message: "", panel: entry.loaded.panel };
    if (entry.error) return { phase: "failed", message: FAILED };
    return { phase: "preparing", message: PREPARING };
  }

  /** One page of an option's choices, or null for an option the panel doesn't offer. */
  async page(gender: BodyGender, option: string, offset: number): Promise<CcChoicePage | null> {
    const loaded = await this.ensure(gender);
    return choicePage(loaded.source.index, loaded.mods, option, offset);
  }

  private recover(loaded: Loaded, saved: SavedDescriptors) {
    const key = createHash("sha256").update(JSON.stringify(saved)).digest("hex");
    let known = loaded.recovered.get(key);
    if (!known) {
      known = recoverSave(loaded.source, saved);
      loaded.recovered.set(key, known);
      for (const old of [...loaded.recovered.keys()].slice(0, Math.max(0, loaded.recovered.size - 4))) loaded.recovered.delete(old);
    }
    return known;
  }
  private derive(loaded: Loaded, request: CharacterRequest) {
    const saved = savedOfRequest(request);
    return deriveCharacter(loaded.source, saved ? { kind: "save", saved } : { kind: "default" }, request.choices ?? [],
      saved ? this.recover(loaded, saved) : undefined);
  }

  /** The character context's view for a request: every active row's current choice, the V's own, and what couldn't be honoured. */
  async view(request: CharacterRequest): Promise<CreatorView> {
    const loaded = await this.ensure(request.bodyGender);
    const { view, request: derived } = this.derive(loaded, request);
    const index = loaded.source.index;
    const values: Record<string, CreatorValue> = {};
    for (const [id, value] of Object.entries(view.values)) {
      const option = index.byOptionId(id)!;
      const current = index.choice(option, value.choice), own = index.choice(option, value.own);
      values[id] = { ...value, label: current?.label.text ?? value.choice, color: hex(current?.swatch?.color), ownLabel: own?.label.text ?? value.own };
    }
    return { ...view, identity: loaded.panel.identity, values, faceMorphs: faceGroup(derived.morphs) };
  }

  /** The head descriptors of a request with creator choices (the preparation resolves and draws the head). */
  async inputFor(request: CharacterRequest): Promise<CharacterInput> {
    const loaded = await this.ensure(request.bodyGender);
    const { request: derived } = this.derive(loaded, request);
    return { bodyGender: request.bodyGender, origin: request.source === "save" ? "save" : "ui-state",
      appearances: derived.appearances.filter(item => item.part === "head"), morphs: derived.morphs.filter(item => item.part === "head") };
  }

  /**
   * A portable preset of a request's choices (only those a person set), named `name`, with a loaded preset's kept entries and fields.
   * Personal data (a user folder or an address) in the name or in kept fields is left out and counted (CORE-56).
   */
  async preset(request: CharacterRequest, name: string | null, kept: { entries?: CcPresetEntry[]; unknownEntries?: CcPreset["unknownEntries"];
    extra?: CcPreset["extra"] } = {}): Promise<{ text: string; values: number; leftOut: number; personal: number }> {
    const loaded = await this.ensure(request.bodyGender);
    const clean = <T>(value: T) => personalDataIn(JSON.stringify(value) ?? "") ? null : value;
    let personal = 0;
    const keptEntries = (kept.entries ?? []).filter(entry => clean(entry) ? true : (personal++, false));
    const unknownEntries = (kept.unknownEntries ?? []).filter(entry => clean(entry) ? true : (personal++, false));
    const extra = Object.fromEntries(Object.entries(kept.extra ?? {}).filter(([key, value]) => clean({ [key]: value }) ? true : (personal++, false)));
    const safeName = name && personalDataIn(name) ? (personal++, null) : name;
    const choices: CharacterChoice[] = request.choices ?? [];
    const { preset, leftOut } = presetOfChoices(loaded.source, choices, { name: safeName, kept: { entries: keptEntries, unknownEntries, extra } });
    const values = preset.values.filter(entry => clean(entry) ? true : (personal++, false));
    const text = writeCcPreset({ ...preset, values });
    if (personalDataIn(text)) throw Error("The preset would name a personal folder or address, so it wasn't written.");
    return { text, values: values.length, leftOut, personal };
  }

  /** Every user-facing option ID of a body gender's catalogue (tests and tools). */
  async userFacing(gender: BodyGender): Promise<string[]> {
    const loaded = await this.ensure(gender);
    return loaded.source.catalogue.options.filter(option => userFacing(option)).map(option => option.id);
  }
}

/** The route isn't set up (no game folder or WolvenKit). */
export class CreatorSetupError extends Error { constructor() { super(NEEDS_SETUP); } }
