/**
 * Host application service for the creator catalogue (UI-59): builds each body gender's catalogue once per installation in the
 * long-lived host (from the registry's shared installation, installation-registry.ts) and keeps it while the mod setup is unchanged,
 * then answers the Character panel from it:
 * - the panel's compact first-paint projection and paged choices (cc-panel.ts), with the preview's coverage (cc-render-coverage.ts),
 *   and the options whose choices match a search (UI-72);
 * - the character context's view: every row's current choice, the V's own, and what couldn't be honoured (`deriveCharacter`);
 * - a portable preset of the choices a person set, checked for personal data before it is written (CORE-56);
 * - the creator choices an earlier build's tried piercing style stands for (CORE-74).
 *
 * The installation fingerprint (the route, its stamps, WolvenKit's identity and the registry's generation) decides when a catalogue
 * is stale; a new one is built on the next question. One build runs at a time per body gender; everyone asking waits for it.
 *
 * **A failed build is kept** (PIPE-78): its entry stays, per fingerprint, with the plain failure. Reading the state never builds again;
 * a question that needs the catalogue builds again only after a backoff (10 s, doubling, at most 10 minutes), and `retry` (the panel's
 * Try again) builds again at once. A changed fingerprint (a mod installed, the setup fixed) starts afresh.
 *
 * The preparation doesn't wait for this catalogue: it derives a V with choices from a structural catalogue of the merged creator
 * resource it already loads (`structuralInput`: no texts, no TweakDB; PIPE-80).
 * Read-only towards the game and the mod manager.
 */
import { createHash } from "node:crypto";
import { type BodyGender, buildCatalogue, CatalogueIndex, userFacing } from "./cc-catalogue";
import { type CatalogueLoad, loadCreatorCatalogue } from "./cc-catalogue-host";
import { choicePage, type CcChoicePage, type CcChoiceSearch, type CcPanel, type CreatorState, type CreatorValue, type CreatorView, panelProjection,
  searchChoices } from "./cc-panel";
import { type CcPreset, type CcPresetEntry, writeCcPreset } from "./cc-preset";
import { catalogueCoverage } from "./cc-render-coverage";
import { type CharacterChoice, type CharacterSource, deriveCharacter, presetOfChoices, recoverSave, type SavedDescriptors } from "./character-context";
import { type CharacterRequest, savedOfRequest } from "./character-detail-request";
import { type CharacterInput, customLabel, type loadMergedCco } from "./character-resolver";
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
  /** Test seam over the clock (ms). */
  now?: () => number;
  log?: (message: string) => void;
};

type Loaded = {
  source: CharacterSource & { index: CatalogueIndex };
  panel: CcPanel;
  mods: Map<string, number>;
  /** `recoverSave` of the last few saves (a save's interpretation is the costliest step of a view). */
  recovered: Map<string, ReturnType<typeof recoverSave>>;
};
type Entry = { fingerprint: string; promise: Promise<Loaded>; loaded: Loaded | null; error: string | null;
  /** Failed builds in a row for this fingerprint, and when a question may build again. */
  failures: number; retryAt: number };

const NEEDS_SETUP = "Your game's character-creator options appear once your game folder and WolvenKit are set up.";
const PREPARING = "Reading your game's character-creator options…";
const FAILED = "XF Studio couldn't read your game's character-creator options, so they can't be changed here yet.";
const RETRY_MS = 10_000, RETRY_MAX_MS = 10 * 60_000;
const hex = (rgba: readonly number[] | null | undefined) => rgba
  ? `#${rgba.slice(0, 3).map(channel => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0")).join("")}` : null;
const faceGroup = (morphs: CharacterInput["morphs"]) => {
  const head = morphs.filter(morph => morph.part === "head");
  const group = head.some(morph => morph.group === "TPP") ? "TPP" : "character_customization";
  return head.filter(morph => morph.group === group).map(morph => ({ region: morph.region, target: morph.target }));
};
/** A save's interpretation, memoised per catalogue (the last few saves). */
function recovered(cache: Map<string, ReturnType<typeof recoverSave>>, source: CharacterSource, saved: SavedDescriptors) {
  const key = createHash("sha256").update(JSON.stringify(saved)).digest("hex");
  let known = cache.get(key);
  if (!known) {
    known = recoverSave(source, saved);
    cache.set(key, known);
    for (const old of [...cache.keys()].slice(0, Math.max(0, cache.size - 4))) cache.delete(old);
  }
  return known;
}
function derive(source: CharacterSource, cache: Map<string, ReturnType<typeof recoverSave>>, request: CharacterRequest) {
  const saved = savedOfRequest(request);
  return deriveCharacter(source, saved ? { kind: "save", saved } : { kind: "default" }, request.choices ?? [], saved ? recovered(cache, source, saved) : undefined);
}
/** The V's descriptors of every part (the preparation keeps what the preview draws: character-detail-plan.ts `previewInput`). */
const characterInput = (request: CharacterRequest, derived: ReturnType<typeof deriveCharacter>["request"]): CharacterInput => ({ bodyGender: request.bodyGender,
  origin: request.source === "save" ? "save" : "ui-state", appearances: [...derived.appearances], morphs: [...derived.morphs] });

type MergedCreator = Pick<Awaited<ReturnType<typeof loadMergedCco>>, "merged" | "customs">;
const structural = new WeakMap<object, { source: CharacterSource & { index: CatalogueIndex }; recovered: Map<string, ReturnType<typeof recoverSave>> }>();
/**
 * The descriptors of a request with creator choices, derived from the merged creator resource the preparation already loaded
 * (PIPE-80): a structural catalogue (options, choices, links, activation; no texts, no TweakDB, memoised per merged resource) is all
 * `deriveCharacter` reads. Throws when the choices can't be interpreted; the preparation then shows the V without them.
 */
export function structuralInput(request: CharacterRequest, loaded: MergedCreator): CharacterInput {
  let known = structural.get(loaded.merged);
  if (!known) {
    const catalogue = buildCatalogue({ bodyGender: request.bodyGender, cco: loaded.merged.cco, text: null, presentation: null,
      customs: loaded.customs.map(custom => ({ path: custom.path, label: customLabel(custom.path, custom.provenance), mod: custom.provenance.provider })) });
    known = { source: { catalogue, cco: loaded.merged.cco, index: new CatalogueIndex(catalogue) }, recovered: new Map() };
    structural.set(loaded.merged, known);
  }
  return characterInput(request, derive(known.source, known.recovered, request).request);
}

export class CreatorCatalogueHost {
  private readonly entries = new Map<BodyGender, Entry>();
  constructor(private readonly options: CreatorHostOptions) {}
  private now() { return this.options.now?.() ?? Date.now(); }

  /**
   * The catalogue for a body gender on the current installation: built once, rebuilt when the fingerprint changes. A failed build is
   * built again only after its backoff, or at once with `force` (PIPE-78).
   */
  ensure(gender: BodyGender, force = false): Promise<Loaded> {
    const route = this.options.route();
    if (!route) return Promise.reject(new CreatorSetupError());
    const fingerprint = this.options.fingerprint();
    const known = this.entries.get(gender);
    const same = known?.fingerprint === fingerprint;
    if (known && same && !known.error) return known.promise;
    if (known && same && !force && this.now() < known.retryAt) return Promise.reject(new CreatorFailedError());
    const entry: Entry = { fingerprint, promise: null as unknown as Promise<Loaded>, loaded: null, error: null, failures: same ? known!.failures : 0, retryAt: 0 };
    entry.promise = this.build(route, gender, fingerprint).then(loaded => { entry.loaded = loaded; entry.failures = 0; return loaded; },
      error => {
        entry.error = (error as Error)?.message ?? String(error);
        entry.failures++;
        entry.retryAt = this.now() + Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (entry.failures - 1));
        this.options.log?.(`Creator options were not read (attempt ${entry.failures}): ${(error as Error)?.stack ?? error}`);
        throw new CreatorFailedError();
      });
    entry.promise.catch(() => {});
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

  /** The panel's state for a body gender, starting the first build for this installation when needed; never builds again, never waits. */
  state(gender: BodyGender): CreatorState {
    if (!this.options.route()) return { phase: "failed", message: NEEDS_SETUP };
    const known = this.entries.get(gender);
    if (!known || known.fingerprint !== this.options.fingerprint()) this.ensure(gender).catch(() => {});
    const entry = this.entries.get(gender);
    if (entry?.loaded) return { phase: "ready", message: "", panel: entry.loaded.panel };
    if (entry?.error) return { phase: "failed", message: FAILED };
    return { phase: "preparing", message: PREPARING };
  }
  /** Try again now (the panel's Try again): a failed build starts again at once; anything else answers as `state`. */
  retry(gender: BodyGender): CreatorState {
    if (this.options.route() && this.entries.get(gender)?.error) this.ensure(gender, true).catch(() => {});
    return this.state(gender);
  }

  /** One page of an option's choices (with `query`, of the matching ones), or null for an option the panel doesn't offer. */
  async page(gender: BodyGender, option: string, offset: number, query = ""): Promise<CcChoicePage | null> {
    const loaded = await this.ensure(gender);
    return choicePage(loaded.source.index, loaded.mods, option, offset, { identity: loaded.panel.identity, query });
  }
  /** The options with a choice matching a search. */
  async search(gender: BodyGender, query: string): Promise<CcChoiceSearch> {
    const loaded = await this.ensure(gender);
    return searchChoices(loaded.source.index, query, loaded.panel.identity);
  }

  /** The character context's view for a request: every active row's current choice, the V's own, and what couldn't be honoured. */
  async view(request: CharacterRequest): Promise<CreatorView> {
    const loaded = await this.ensure(request.bodyGender);
    const { view, request: derived } = derive(loaded.source, loaded.recovered, request);
    const index = loaded.source.index;
    const values: Record<string, CreatorValue> = {};
    for (const [id, value] of Object.entries(view.values)) {
      const option = index.byOptionId(id)!;
      const current = option.choices[value.position] ?? index.choice(option, value.choice), own = index.choice(option, value.own);
      values[id] = { ...value, label: current?.label.text ?? value.choice, color: hex(current?.swatch?.color), ownLabel: own?.label.text ?? value.own };
    }
    return { ...view, identity: loaded.panel.identity, values, faceMorphs: faceGroup(derived.morphs) };
  }

  /** The descriptors of a request with creator choices, from the full catalogue (tests and tools; the preparation uses `structuralInput`). */
  async inputFor(request: CharacterRequest): Promise<CharacterInput> {
    const loaded = await this.ensure(request.bodyGender);
    return characterInput(request, derive(loaded.source, loaded.recovered, request).request);
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

  /**
   * The creator choices an earlier build's tried piercing style stands for (CORE-74): the offered head switcher choice named `style` that
   * activates an option offering the definition `definition`, and that definition. Empty when this installation offers no such pair.
   * Found from the catalogue's data alone (no option is named).
   */
  async legacyChoices(gender: BodyGender, style: string, definition: string): Promise<CharacterChoice[]> {
    const loaded = await this.ensure(gender);
    const index = loaded.source.index;
    for (const option of loaded.source.catalogue.options) {
      if (option.part !== "head" || option.type !== "switcher" || !userFacing(option)) continue;
      for (const choice of option.choices) {
        if (choice.key !== style) continue;
        for (const name of choice.activates) {
          const target = index.option(option.part, name);
          if (target?.type !== "appearance" || !index.choice(target, definition)) continue;
          return [{ part: option.part, option: option.name, choice: choice.key, activates: [...choice.activates] },
            { part: target.part, option: target.name, choice: definition }];
        }
      }
    }
    return [];
  }

  /** Every user-facing option ID of a body gender's catalogue (tests and tools). */
  async userFacing(gender: BodyGender): Promise<string[]> {
    const loaded = await this.ensure(gender);
    return loaded.source.catalogue.options.filter(option => userFacing(option)).map(option => option.id);
  }
}

/** The route isn't set up (no game folder or WolvenKit). */
export class CreatorSetupError extends Error { constructor() { super(NEEDS_SETUP); } }
/** The catalogue couldn't be built (kept until its backoff ends or Try again). */
export class CreatorFailedError extends Error { constructor() { super(FAILED); } }
