import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "./eye-plate-recipe";
import { CharacterDetailError, CHARACTER_DETAIL_STEPS, CharacterPreparationCache, prepareCharacterDetails, STORE_FILE, warmCharacters,
  type CharacterRoute, type PrepareCharacterOptions, type WarmOptions } from "./character-detail-service";
import { choiceKey, manifestHolds, readChoiceManifest, xlIdentity } from "./choice-manifest";
import { ChoicePrefetcher, type PrefetchAnswer, type PrefetchInput, type PrefetchLimits } from "./choice-prefetch";
import { clearPrepared, evictPrepared, PREPARED_BUDGET_BYTES, preparedSize, type PreparedRoots, type PreparedSize } from "./prepared-files";
import { backgroundExtraction, backgroundPriority, foregroundExtraction, type Installation, type InstallationOptions } from "./resolver-host";
import { CHARACTER_DETAIL_SCHEMA } from "./render-detail";
import type { CharacterRequest } from "./character-detail-request";
import type { GameAssetExporter } from "./game-asset-export";
import { createWolvenKitGameAssetExporter } from "./game-asset-export-wolvenkit";
import { acquireInstallation, installationRouteKey, installations, type InstallationRegistry } from "./installation-registry";
import { CreatorCatalogueHost, structuralInput } from "./cc-catalogue-service";
import type { LaunchRoute } from "./local-settings";
import { routeIdentity, routeStamps } from "./route-fingerprint";
import { wolvenKitIdentity, wolvenKitIdentityKey } from "./wolvenkit-cli";
import type { DiagnosticTrace } from "./diagnostics/model";
import { hostFailure } from "./diagnostics/host-log";

/**
 * Host application service that owns one character-detail preparation at a time for the preview (both
 * hosts share it). It reads the launch route from the host's own settings (never from the browser),
 * runs `prepareCharacterDetails` in the background with cancellation, reports progress as a read-only
 * snapshot keyed by the request, and serves the content-addressed files of finished records. A newer
 * request supersedes (cancels) an older one, so switching between Vs never finishes the previous V.
 *
 * The key covers the request and the installation it is prepared from (launch route, game and mod
 * folders, MO2 profile, WolvenKit identity, the modification stamps of the mod lists and folders, and the
 * route's generation in the installation registry), so a changed profile, a newly installed mod, a file
 * changed inside a mod folder or another WolvenKit prepares again instead of reusing an answer for a
 * different mod set. Preparations read the process's shared, long-lived installation (installation-registry.ts),
 * checked against the mod setup before each use. They share one on-disk cache, so they run one at a time: a
 * new one starts only after a cancelled one has stopped.
 *
 * It also keeps one in-memory `CharacterPreparationCache` per installation fingerprint (which includes the registry's generation;
 * PREV-68): the resolved appearances, templates and exports, and the served components. A changed creator choice on the same V then
 * resolves and exports only what the choice changes. A changed fingerprint (a mod installed, another profile) starts a new cache. Each
 * state names the record schema this host writes, so a page of another version can say so instead of failing silently. A preparation
 * that was degraded by a failure that may not repeat is served, but not kept as the final answer: the next request for it prepares
 * again (PIPE-53).
 *
 * It also owns the installation's creator catalogue (`creator`, cc-catalogue-service.ts), which answers the Character panel. A
 * preparation doesn't wait for that catalogue: it interprets a request's creator choices from the merged creator resource it loads
 * itself (`structuralInput`, PIPE-80), and a V whose choices can't be interpreted is shown without them, with one plain line in the
 * ready state's `message`.
 */
export const CHARACTER_DETAIL_STATE_SCHEMA = "xfs/character-detail-state-1" as const;
export type CharacterDetailPhase = "preparing" | "ready" | "failed" | "unknown";
export type CharacterDetailState = {
  schema: typeof CHARACTER_DETAIL_STATE_SCHEMA;
  /** The character record version this host writes (the page refuses to follow a host of another version). */
  recordSchema: typeof CHARACTER_DETAIL_SCHEMA;
  /** Identity of the request this state answers. */
  key: string;
  phase: CharacterDetailPhase;
  /** One plain line for the person using the app (when ready: what the V is shown without, or empty). */
  message: string;
  progress: { index: number; total: number; label: string } | null;
  /** The record file name (under `/assets/character/`) once ready. */
  record: string | null;
};
export type CharacterDetailSettings = { gameRoot: string | null; launchRoute: LaunchRoute; mo2Root: string | null;
  mo2ProfileId: string | null; manualModRoot: string | null; wolvenKitCli: string | null };
export type CharacterDetailHostOptions = {
  /** Host-owned private preview cache; records and files live in `characters/`, exports in `exports/`. */
  cacheRoot: string;
  /** Resolver JSON cache (defaults to `cacheRoot/resolver`). */
  resolverCache?: string;
  settings: () => CharacterDetailSettings;
  exporter?: (cli: string | null) => GameAssetExporter;
  /** Test seam over the service call. */
  prepare?: (options: PrepareCharacterOptions) => ReturnType<typeof prepareCharacterDetails>;
  /** Test seam over the creator catalogue. */
  creator?: CreatorCatalogueHost;
  /** Test seam over preparing choices ahead (`warmCharacters`). */
  warm?: (options: WarmOptions) => ReturnType<typeof warmCharacters>;
  /** Limits of preparing choices ahead (choice-prefetch.ts `PREFETCH_LIMITS`). */
  prefetchLimits?: PrefetchLimits;
  /** Bytes of exports and extracted JSON kept on disk (prepared-files.ts `PREPARED_BUDGET_BYTES`). */
  preparedBudget?: number;
  log?: (message: string) => void;
  /** The rolling diagnostics window: what each preparation resolved and prepared (docs/diagnostics.md). */
  trace?: DiagnosticTrace;
  /** The native decode worker a packaged host ships (the clothing preset's decode; clothing-host.ts). */
  nativeDecodeWorker?: string;
};
/** How often, at most, the prepared files are checked against their budget. */
const EVICT_INTERVAL_MS = 60_000;
/** `work`'s answer, or a cancellation as soon as `signal` aborts (`work` itself keeps running; its caller tracks it). */
function untilStopped<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stopped = () => reject(new CharacterDetailError("character_cancelled", "Preparing choices ahead was stopped."));
    if (signal.aborted) { stopped(); return; }
    signal.addEventListener("abort", stopped, { once: true });
    work.then(value => { signal.removeEventListener("abort", stopped); resolve(value); },
      error => { signal.removeEventListener("abort", stopped); reject(error); });
  });
}

const NEEDS_SETUP = "Your V's own skin, face details, eyes, brows, lashes, hair, piercings and body appear once your game folder and WolvenKit are set up.";
const PREPARING = "Preparing your V's skin, face details, eyes, brows, lashes, hair, piercings and body…";
const FAILED = "Something went wrong while preparing your V's skin, face details, eyes, brows, lashes, hair, piercings and body, so they aren't shown. The head still works.";
/** Request key: the character and the installation fingerprint it is prepared from (`installationFingerprint`). */
export const characterRequestKey = (request: CharacterRequest, installation = "") =>
  createHash("sha256").update(canonicalJson(request)).update("\n" + installation).digest("hex").slice(0, 32);

/**
 * What the preparation reads besides the request: the launch route's settings, WolvenKit's identity, the shared cheap
 * route stamps (route-fingerprint.ts: the places that change when mods are installed, removed or reordered) and the
 * route's generation in the installation registry, which moves on whenever the registry finds the opened installation
 * out of date (a file added, removed or edited inside a mod folder too). `CharacterDetailHost.refresh` runs that check
 * before a request is answered from an earlier preparation.
 */
export function installationFingerprint(settings: CharacterDetailSettings, registry: InstallationRegistry = installations): string {
  const route = settings.gameRoot ? { ...settings, gameRoot: settings.gameRoot } : null;
  return canonicalJson({
    route: route ? [...routeIdentity(route), settings.wolvenKitCli] : [null, settings.launchRoute, settings.mo2Root, settings.mo2ProfileId, settings.manualModRoot, settings.wolvenKitCli],
    wolvenKit: settings.wolvenKitCli ? wolvenKitIdentityKey(wolvenKitIdentity(settings.wolvenKitCli)) : null,
    stamps: route ? routeStamps(route) : [],
    generation: route && settings.wolvenKitCli ? registry.generation({ ...route, wolvenKitCli: settings.wolvenKitCli }) : 0,
  });
}

export class CharacterDetailHost {
  private running: { key: string; controller: AbortController; promise: Promise<void> } | null = null;
  private readonly states = new Map<string, CharacterDetailState>();
  /** What preparations on the current installation share, and the fingerprint it belongs to. */
  private shared: { fingerprint: string; cache: CharacterPreparationCache } | null = null;
  /** Keys whose ready answer was degraded (PIPE-53): served once, prepared again when asked again. */
  private readonly degraded = new Set<string>();
  /** The installation's creator catalogue: the Character panel's options, and the interpreter of a request's creator choices. */
  readonly creator: CreatorCatalogueHost;
  /** Prepares an open Character panel row's choices ahead of a click (choice-prefetch.ts). */
  readonly prefetch: ChoicePrefetcher;
  private evictedAt = 0;
  private evicting: Promise<void> | null = null;
  /**
   * Prefetch batches still settling, each as a promise that never rejects. A stopped batch answers the prefetcher at once, so a
   * person's own change isn't held up by reads already in WolvenKit; the batch itself runs to its end in the background (it no longer
   * forgets cache entries or writes manifests once stopped), and Clear waits for it before removing files (PREV-102).
   */
  private readonly warming = new Set<Promise<void>>();
  constructor(private readonly options: CharacterDetailHostOptions) {
    this.creator = options.creator ?? new CreatorCatalogueHost({ route: () => this.route(), fingerprint: () => installationFingerprint(this.options.settings()),
      resolverCache: options.resolverCache ?? join(options.cacheRoot, "resolver"), log: options.log });
    this.prefetch = new ChoicePrefetcher({
      requestFor: (base, option, position) => this.requestFor(base, option, position),
      readiness: () => this.readiness(),
      warm: (requests, signal) => this.warm(requests, signal),
      foregroundIdle: () => this.foregroundIdle(),
      preparedBytes: async () => (await preparedSize(this.preparedRoots)).bytes,
      afterBatch: () => this.keepWithinBudget(),
      log: options.log,
      failed: error => hostFailure("character", "prefetch_failed", "Some character choices couldn't be prepared ahead; they are read when picked.", error, "warn"),
    }, options.prefetchLimits);
  }

  private get resolverCache() { return this.options.resolverCache ?? join(this.options.cacheRoot, "resolver"); }
  /** Where the prepared game files live (prepared-files.ts). */
  get preparedRoots(): PreparedRoots {
    return { exports: join(this.options.cacheRoot, "exports"), resolver: this.resolverCache, store: this.storeRoot, manifests: join(this.options.cacheRoot, "choices") };
  }
  /** The route's name for manifests: its settings, WolvenKit and WolvenKit's identity (never the process-local generation). */
  private manifests(route: CharacterRoute) {
    const key = installationRouteKey(route);
    return { dir: this.preparedRoots.manifests, key: (request: CharacterRequest) => choiceKey(key, request) };
  }
  private exporterFor(cli: string | null): GameAssetExporter {
    return this.options.exporter?.(cli) ?? createWolvenKitGameAssetExporter(join(this.options.cacheRoot, "exports"), cli);
  }

  private get storeRoot() { return join(this.options.cacheRoot, "characters"); }

  private route(): CharacterRoute | null {
    const settings = this.options.settings();
    if (!settings.gameRoot || !settings.wolvenKitCli || !existsSync(settings.wolvenKitCli)) return null;
    return { gameRoot: settings.gameRoot, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root, mo2ProfileId: settings.mo2ProfileId,
      manualModRoot: settings.manualModRoot, wolvenKitCli: settings.wolvenKitCli };
  }

  private set(state: Omit<CharacterDetailState, "schema" | "recordSchema">): CharacterDetailState {
    const full = { schema: CHARACTER_DETAIL_STATE_SCHEMA, recordSchema: CHARACTER_DETAIL_SCHEMA, ...state };
    this.states.set(state.key, full);
    // Keep only the recent answers; a page polls one key at a time.
    for (const key of [...this.states.keys()].slice(0, Math.max(0, this.states.size - 8))) this.states.delete(key);
    return full;
  }

  /**
   * Start (or reuse) the preparation for a request. Another running request is cancelled, and its state
   * is forgotten at once; the new preparation starts once the cancelled one has stopped.
   */
  request(request: CharacterRequest): CharacterDetailState {
    const settings = this.options.settings();
    const fingerprint = installationFingerprint(settings);
    const key = characterRequestKey(request, fingerprint);
    const known = this.states.get(key);
    const active = this.running && !this.running.controller.signal.aborted ? this.running : null;
    // A degraded answer is served once, then prepared again (PIPE-53).
    if ((known?.phase === "ready" && !this.degraded.has(key)) || (known?.phase === "preparing" && active?.key === key)) return known;
    this.degraded.delete(key);
    // A different (or a stale, cancelled) preparation: stop it and forget its answer now, so a quick
    // V1 -> V2 -> V1 restarts V1 instead of reporting the cancelled run as still preparing.
    if (active) { active.controller.abort(); this.states.delete(active.key); }
    const route = this.route();
    if (!route) return this.set({ key, phase: "failed", message: NEEDS_SETUP, progress: null, record: null });
    const controller = new AbortController();
    if (this.shared?.fingerprint !== fingerprint) this.shared = { fingerprint, cache: new CharacterPreparationCache() };
    const cache = this.shared.cache;
    const exporter = this.exporterFor(settings.wolvenKitCli);
    // A person's own change comes first: a choice being prepared ahead steps aside (choice-prefetch.ts).
    this.prefetch.foreground(request);
    const first = CHARACTER_DETAIL_STEPS[0]!;
    this.set({ key, phase: "preparing", message: PREPARING, progress: { index: 0, total: CHARACTER_DETAIL_STEPS.length, label: first.label }, record: null });
    // Whether this run still owns its key's state (a newer run for the same key takes it over).
    const owns = () => !this.running || this.running.key !== key || this.running.controller === controller;
    let started = 0;
    const run = () => {
      if (controller.signal.aborted) throw new CharacterDetailError("character_cancelled", "Superseded before it started.");
      started = Date.now();
      return foregroundExtraction(this.resolverCache, () => (this.options.prepare ?? prepareCharacterDetails)({ request, route, storeRoot: this.storeRoot, cache,
        derive: request.choices?.length ? structuralInput : undefined, manifests: this.manifests(route),
        resolverCache: this.resolverCache, exporter, signal: controller.signal,
        progress: (_step, index, total, label) => {
          if (!controller.signal.aborted) this.set({ key, phase: "preparing", message: PREPARING, progress: { index, total, label }, record: null });
        }, log: this.options.log, trace: this.options.trace, nativeDecodeWorker: this.options.nativeDecodeWorker }));
    };
    // Start now, or once the cancelled run (still settling on the shared cache) and a stopped prefetch batch have let go (PREV-102).
    const waits: Promise<unknown>[] = [];
    if (this.running) waits.push(this.running.promise);
    if (this.prefetch.preparing) waits.push(this.prefetch.idle());
    const begun = waits.length ? Promise.all(waits).then(run) : new Promise<Awaited<ReturnType<typeof run>>>(resolve => resolve(run()));
    const promise = begun
      .then(result => {
        this.set({ key, phase: "ready", message: result.note ?? "", progress: null, record: result.recordFile });
        if (result.degraded) this.degraded.add(key); else this.degraded.delete(key);
        this.prefetch.prepared(request, !result.degraded);
        void this.keepWithinBudget();
        this.options.log?.(`Skin, face details, eyes, brows, lashes, hair, piercings and body prepared in ${((Date.now() - started) / 1000).toFixed(1)} s (${request.source} V).`);
      })
      .catch(error => {
        const cancelled = error instanceof CharacterDetailError && error.code === "character_cancelled" || controller.signal.aborted;
        this.prefetch.prepared(request, false);
        if (cancelled) { if (owns()) this.states.delete(key); return; }
        const message = error instanceof CharacterDetailError ? error.message : FAILED;
        this.options.log?.(`Skin, face details, eyes, brows, lashes, hair, piercings and body were not prepared: ${error instanceof CharacterDetailError ? `${error.code} ${error.detail}` : (error as Error)?.stack ?? error}`);
        hostFailure("character", error instanceof CharacterDetailError ? error.code : "character_failed", message, error instanceof CharacterDetailError ? { code: error.code, message: error.message, detail: error.detail } : error);
        if (owns()) this.set({ key, phase: "failed", message, progress: null, record: null });
      })
      .finally(() => { if (this.running?.controller === controller) this.running = null; });
    this.running = { key, controller, promise };
    return this.states.get(key)!;
  }

  /**
   * Check the current route's opened installation (installation-registry.ts) before a request is answered: when the mod
   * setup changed since it was opened, the route's generation moves on, so the request key changes and the V is
   * prepared again from the new setup instead of reusing an answer for the old one. Cheap: one `lstat` per watched path.
   */
  async refresh(): Promise<void> {
    const settings = this.options.settings();
    if (!settings.gameRoot || !settings.wolvenKitCli) return;
    try { await installations.revalidate({ ...settings, gameRoot: settings.gameRoot, wolvenKitCli: settings.wolvenKitCli }); }
    catch { /* The preparation checks again, and reports what it cannot read. */ }
  }

  /** The state for a request key; `unknown` when this host has not seen it (the page asks again). */
  state(key: string): CharacterDetailState {
    return this.states.get(key) ?? { schema: CHARACTER_DETAIL_STATE_SCHEMA, recordSchema: CHARACTER_DETAIL_SCHEMA, key, phase: "unknown", message: "", progress: null, record: null };
  }

  cancel(): void { this.running?.controller.abort(); this.prefetch.cancel(); }

  // ---- Preparing choices ahead (choice-prefetch.ts) ----

  /** Start or update preparing a row's choices ahead, and answer their states. */
  prefetchRow(input: PrefetchInput): PrefetchAnswer { return this.prefetch.update(input); }
  /** The row closed: stop preparing its choices ahead. */
  stopPrefetch(): void { this.prefetch.cancel(); }

  /** The V with one choice of an option set: the V's choices without that option's, then the choice (as the panel sets one). */
  private async requestFor(base: CharacterRequest, option: string, position: number): Promise<CharacterRequest | null> {
    let loaded;
    try { loaded = await this.creator.ensure(base.bodyGender); } catch { return null; }
    const entry = loaded.source.index.byOptionId(option), choice = entry?.choices[position];
    if (!entry || !choice) return null;
    const choices = (base.choices ?? []).filter(item => !(item.part === entry.part && item.option === entry.name));
    choices.push({ part: entry.part, option: entry.name, choice: choice.key, ...(choice.activates?.length ? { activates: [...choice.activates] } : {}) });
    return { ...base, choices };
  }
  /** A check of whether requests are ready on the installation as it is now (their manifests hold). */
  private async readiness(): Promise<(request: CharacterRequest) => boolean> {
    const route = this.route();
    if (!route) return () => false;
    const installation = await this.backgroundInstallation({ ...route, cacheDir: this.resolverCache, log: this.options.log });
    const exporter = this.exporterFor(route.wolvenKitCli), manifests = this.manifests(route);
    const check = { graph: installation.graph, fetcher: installation.fetcher, exporter, gameRoot: route.gameRoot, tool: installation.fetcher.tool,
      xl: xlIdentity(installation) };
    return request => {
      const manifest = readChoiceManifest(manifests.dir, manifests.key(request));
      return !!manifest && manifestHolds(manifest, check);
    };
  }
  /** Prepare requests ahead, in the background, sharing the preparations' cache. */
  private async warm(requests: readonly CharacterRequest[], signal: AbortSignal) {
    const route = this.route();
    if (!route || !requests.length) return requests.map(() => ({ ready: false }));
    const settings = this.options.settings();
    const fingerprint = installationFingerprint(settings);
    if (this.shared?.fingerprint !== fingerprint) this.shared = { fingerprint, cache: new CharacterPreparationCache() };
    const cache = this.shared.cache;
    // Each launch decides its priority as it starts: below normal only while no person's own change is being prepared (PIPE-96).
    const work = backgroundExtraction(this.resolverCache, () => (this.options.warm ?? warmCharacters)({ requests, route, storeRoot: this.storeRoot, cache,
      open: options => this.backgroundInstallation(options),
      derive: structuralInput, resolverCache: this.resolverCache, exporter: this.exporterFor(route.wolvenKitCli), signal,
      lowPriority: backgroundPriority(this.resolverCache), manifests: this.manifests(route), log: this.options.log, nativeDecodeWorker: this.options.nativeDecodeWorker }));
    const settled: Promise<void> = work.then(() => {}, () => {}).finally(() => { this.warming.delete(settled); });
    this.warming.add(settled);
    return untilStopped(work, signal);
  }
  /** The opened installation for background work, without the check a person's request makes (opened when it isn't yet). */
  private async backgroundInstallation(options: InstallationOptions): Promise<Installation> {
    return installations.peek(options) ?? acquireInstallation(options);
  }
  /** Resolves once no person's own change is being prepared. */
  private async foregroundIdle(): Promise<void> {
    while (this.running) { try { await this.running.promise; } catch { /* Settled. */ } }
  }

  // ---- Prepared game files (prepared-files.ts) ----

  /** The prepared files' size on disk. */
  preparedFiles(): Promise<PreparedSize> { return preparedSize(this.preparedRoots); }
  /** Keep exports and extracted JSON within their budget (at most once a minute; never what this session used). */
  keepWithinBudget(): Promise<void> {
    if (this.evicting || Date.now() - this.evictedAt < EVICT_INTERVAL_MS) return this.evicting ?? Promise.resolve();
    this.evictedAt = Date.now();
    this.evicting = evictPrepared(this.preparedRoots, this.options.preparedBudget ?? PREPARED_BUDGET_BYTES)
      .then(result => { if (result.removed) this.options.log?.(`Prepared game files: removed ${result.removed} least recently used (${(result.freed / 1024 ** 2).toFixed(0)} MB).`); })
      .catch(error => {
        this.options.log?.(`Prepared game files could not be checked against their budget: ${(error as Error)?.message ?? error}`);
        hostFailure("character", "prepared_budget_failed", "The prepared game files couldn't be checked against their space limit.", error, "warn");
      })
      .finally(() => { this.evicting = null; });
    return this.evicting;
  }
  /**
   * "Clear prepared game files": stop preparing ahead, wait for a running preparation to stop, remove every prepared file, and forget
   * what was derived from them, so the next preparation reads the game files again. The V on screen stays as it is until it is prepared
   * again.
   */
  async clearPreparedFiles(): Promise<{ freed: number }> {
    this.prefetch.cancel();
    this.running?.controller.abort();
    await this.settled().catch(() => {});
    // A stopped prefetch batch lets go of the cache and finishes its reads before anything is removed (PREV-102).
    await this.prefetch.idle();
    while (this.warming.size) await Promise.all([...this.warming]);
    await this.evicting;
    const result = await clearPrepared(this.preparedRoots);
    this.shared = null;
    this.states.clear();
    this.degraded.clear();
    // The files are gone, so preparing ahead may fill the budget again this session (PREV-104).
    this.prefetch.resetBudget();
    return result;
  }
  async settled(): Promise<void> { await this.running?.promise; }

  /** Absolute path of a served record or file, or null. Names are content-addressed, never paths. */
  filePath(name: string): string | null {
    if (!STORE_FILE.test(name)) return null;
    const path = join(this.storeRoot, name.endsWith(".json") ? "records" : "files", name);
    return existsSync(path) ? path : null;
  }
}
