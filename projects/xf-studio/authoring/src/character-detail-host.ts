import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "./eye-plate-recipe";
import { CharacterDetailError, CHARACTER_DETAIL_STEPS, CharacterPreparationCache, prepareCharacterDetails, SERVED_TEXTURE_MAX, STORE_FILE, TOOL_MISSING, warmCharacters,
  type CharacterRoute, type PrepareCharacterOptions, type WarmOptions } from "./character-detail-service";
import { choiceKey, manifestProblemSliced, readChoiceManifest, xlIdentity } from "./choice-manifest";
import { timeSlicer } from "./event-loop";
import { ChoicePrefetcher, type PrefetchAnswer, type PrefetchInput, type PrefetchLimits } from "./choice-prefetch";
import { clearPrepared, evictPrepared, PREPARED_BUDGET_BYTES, preparedSize, type PreparedRoots, type PreparedSize } from "./prepared-files";
import { backgroundExtraction, backgroundPriority, foregroundExtraction, withArchiveFingerprints, type Installation, type InstallationOptions } from "./resolver-host";
import { CHARACTER_DETAIL_SCHEMA } from "./render-detail";
import type { CharacterRequest } from "./character-detail-request";
import type { GameAssetExporter } from "./game-asset-export";
import { createWolvenKitGameAssetExporter } from "./game-asset-export-wolvenkit";
import { createNativeGeometryExporter, type GeometryDecoder, NATIVE_GEOMETRY_TIMEOUT_MS } from "./native-geometry-export";
import { createNativeFirstExporter, NativeDecoders, type TextureDecoder } from "./native-texture-export";
import { acquireInstallation, installationRouteKey, installations, type InstallationRegistry } from "./installation-registry";
import { CreatorCatalogueHost, structuralInput } from "./cc-catalogue-service";
import type { LaunchRoute } from "./local-settings";
import { routeIdentity, routeStamps } from "./route-fingerprint";
import { wolvenKitIdentity, wolvenKitIdentityKey } from "./wolvenkit-cli";
import type { DiagnosticTrace } from "./diagnostics/model";
import { hostFailure } from "./diagnostics/host-log";
import { type ChoicePreviewSource, type PreviewKind, previewSourceOf } from "./choice-preview";
import { ChoicePreviewStore, manifestStamp } from "./choice-preview-host";
import { hostCodeIdentity } from "./host-code-identity";
import { PreparedAnswers } from "./prepared-answers";

/**
 * Host application service that owns one character-detail preparation at a time for the preview (both
 * hosts share it). It reads the launch route from the host's own settings (never from the browser),
 * runs `prepareCharacterDetails` in the background with cancellation, reports progress as a read-only
 * snapshot keyed by the request, and serves the content-addressed files of finished records. A page's newer
 * request supersedes (cancels) that page's older one, so switching between Vs never finishes the previous V. Each open page (a
 * window or tab; `X-XFS-Page`, character-detail-server.ts) supersedes only its own: another page's request waits its turn, so two
 * pages following different Vs (the person's own tab and a `?verify=1` tab) each get theirs instead of cancelling each other
 * forever (PIPE-103).
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
  /**
   * Failed: what must be set up first, which the page offers as its one next step (NATIVE-47): `wolvenkit` while WolvenKit isn't set up
   * (or can't run). Absent otherwise.
   */
  need?: "wolvenkit";
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
  /**
   * The game folder's texture decoder (native-texture-export.ts): textures are read by XF Studio's own reader first and by the exporter
   * per texture it refuses. Default: a decode worker per game folder when the host builds its own WolvenKit exporter; with an injected
   * `exporter` (a test seam), none unless given here. `false`: never.
   */
  textureDecoder?: ((gameRoot: string) => Promise<TextureDecoder | null>) | false;
  /**
   * The game folder's mesh decoder (native-geometry-export.ts): meshes and morph targets are read by XF Studio's own reader first and by
   * the exporter per resource it refuses. Defaults as `textureDecoder` (a decode worker of its own per game folder).
   */
  geometryDecoder?: ((gameRoot: string) => Promise<GeometryDecoder | null>) | false;
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
  /** Where choice previews and their sources are kept (choice-preview-host.ts; default `cacheRoot/choice-previews`). */
  previewRoot?: string;
  /**
   * Answers kept across restarts (prepared-answers.ts: a V prepared before is answered at once while nothing it was prepared from
   * changed). Default: kept under `cacheRoot/choices/answers/` unless the preparation is a test seam (`prepare`); `false`: never.
   */
  keptAnswers?: PreparedAnswers | false;
};
/** One question about a row's choice previews (choice-preview-server.ts): the V, the row, the positions to look up, and the one to derive. */
export type PreviewSourcesInput = { base: CharacterRequest; option: string; kind: PreviewKind; positions: readonly number[]; derive: number | null;
  /** The page's request: aborted when it goes away, and a derivation still waiting for the background lane then answers at once. */
  signal?: AbortSignal };
/**
 * Per position: `ready` with its source, `none` (the choice draws nothing for this detail), or `unprepared` (not prepared yet, or its
 * derivation failed this time). `busy`: the derivation didn't get the background lane within `PREVIEW_DERIVE_WAIT_MS` (a person's
 * change, a batch prepared ahead or another derivation held it) or a person's change stopped it (PREV-162), so the page asks again later
 * without counting a try.
 */
export type PreviewSourceItem = { position: number; state: "ready" | "none" | "unprepared"; source?: ChoicePreviewSource; busy?: true };
/**
 * The longest a derivation waits for the background lane before answering `busy` (PREV-153): the HTTP request is never held for
 * minutes, and the page's lookups and pictures go on meanwhile.
 */
export const PREVIEW_DERIVE_WAIT_MS = 3000;
/**
 * While the page is asking for preview sources (within this long of its last question), a batch prepared ahead doesn't start: deriving a
 * ready choice's source takes a fraction of a second and shows at once, while a batch takes a minute. A batch already running finishes
 * first (work past its threshold is never thrown away), and preparing ahead goes on once the page stops asking.
 */
const PREVIEW_HOLD_MS = 800;
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

const NEEDS_SETUP = "Your V's own skin, face details, eyes, brows, lashes, hair, piercings and body appear once your game folder is set up.";
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
  const route = characterRoute(settings);
  return canonicalJson({
    route: route ? [...routeIdentity(route), route.wolvenKitCli] : [null, settings.launchRoute, settings.mo2Root, settings.mo2ProfileId, settings.manualModRoot, settings.wolvenKitCli],
    wolvenKit: route?.wolvenKitCli ? wolvenKitIdentityKey(wolvenKitIdentity(route.wolvenKitCli)) : null,
    stamps: route ? routeStamps(route) : [],
    // With or without WolvenKit: a route read by XF Studio's own reader alone still moves on when the mod setup changes.
    generation: route ? registry.generation(route) : 0,
  });
}

/**
 * The launch route, once the game folder is set up. WolvenKit is optional: XF Studio reads the game files itself, so resolving the V and
 * the creator's options need no WolvenKit; without it (or when its path no longer exists) the route has none, and only exports (and the
 * rare resource only WolvenKit reads) ask for it, in plain words.
 */
export function characterRoute(settings: CharacterDetailSettings): CharacterRoute | null {
  if (!settings.gameRoot) return null;
  return { gameRoot: settings.gameRoot, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root, mo2ProfileId: settings.mo2ProfileId,
    manualModRoot: settings.manualModRoot, wolvenKitCli: settings.wolvenKitCli && existsSync(settings.wolvenKitCli) ? settings.wolvenKitCli : null };
}

/** How long the page must have been quiet (no change asked for, no file of its V read) before work prepared ahead goes on. */
export const QUIET_MS = 400;
/**
 * How long the page must have been quiet before a V answered from a kept answer is resolved in the background after a restart: the page
 * is still starting (its motion, face data, poses and the creator's options come from the host right after the V).
 */
export const WARM_UP_QUIET_MS = 2000;
/**
 * How long a kept answer's check (every stamp it depends on read again) vouches for the same V's next request, which then skips the
 * installation check: the page's own request follows its warm start's (character-warm-start.ts) by a second or two, while the host is at
 * its busiest starting up, and a check then took 0.5–0.6 s of the V's wait. A mod changed within that moment is noticed by the next
 * request's check, as ever.
 */
export const KEPT_VOUCH_MS = 5000;

export class CharacterDetailHost {
  /** Each open page's latest preparation (`request`'s `page`); they run one at a time, in the order they were asked for (PIPE-103). */
  private readonly running = new Map<string, { key: string; controller: AbortController; promise: Promise<void> }>();
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
   * forgets cache entries or writes manifests once stopped), and Clear waits for it before removing files (PREV-102). The batch is given
   * the stop, so it asks for nothing further down its resource chains, and the next batch starts only once it settled (PREV-120).
   */
  private readonly warming = new Set<Promise<void>>();
  /** Resolves once every prefetch batch has settled (`warming`). */
  private async warmingSettled(): Promise<void> { while (this.warming.size) await Promise.all([...this.warming]); }
  /** A person's requests being answered now (the installation check before a preparation starts): background work waits for them. */
  private asking = 0;
  /** When the page last asked for its V or read one of its files (`noteAsk`): background work waits until the page has been quiet a moment. */
  private askedAt = 0;
  /** Rendered choice previews and their sources (choice-preview-host.ts). */
  readonly previews: ChoicePreviewStore;
  /**
   * The preview source being derived now (a prepared choice's record, planned and written from the caches): one at a time, never beside
   * a person's change or a batch prepared ahead. `passed`: it reached its last step, so a person's change waits for it instead of stopping
   * it (the scheduling rule: work past its threshold is never thrown away).
   */
  private previewing: { controller: AbortController; promise: Promise<unknown>; passed: boolean } | null = null;
  /** When the page last asked for a preview source to be derived (`PREVIEW_HOLD_MS`). */
  private previewAskedAt = 0;
  /** Answers kept across restarts (`keptAnswers`), or null. */
  private readonly answers: PreparedAnswers | null;
  /**
   * The V answered from a kept answer, being resolved into the shared cache in the background once the page is quiet, so the person's
   * first change after a restart only resolves what it changes. A person's own request stops it.
   */
  private warmingUp: { controller: AbortController; promise: Promise<void> } | null = null;
  constructor(private readonly options: CharacterDetailHostOptions) {
    this.answers = options.keptAnswers === false ? null : options.keptAnswers ?? (options.prepare ? null
      : new PreparedAnswers(join(options.cacheRoot, "choices", "answers"), { code: hostCodeIdentity, recordSchema: CHARACTER_DETAIL_SCHEMA,
        recordExists: record => this.filePath(record) !== null }));
    this.previews = new ChoicePreviewStore(options.previewRoot ?? join(options.cacheRoot, "choice-previews"));
    this.creator = options.creator ?? new CreatorCatalogueHost({ route: () => this.route(), fingerprint: () => installationFingerprint(this.options.settings()),
      resolverCache: options.resolverCache ?? join(options.cacheRoot, "resolver"), log: options.log });
    this.prefetch = new ChoicePrefetcher({
      requestFor: (base, option, position) => this.requestFor(base, option, position),
      readiness: () => this.readiness(),
      warm: (requests, signal) => this.warm(requests, signal),
      foregroundIdle: () => this.foregroundIdle(),
      settled: () => this.warmingSettled(),
      preparedBytes: async () => (await preparedSize(this.preparedRoots)).bytes,
      afterBatch: () => this.keepWithinBudget(),
      needsSetup: () => this.needsSetup(),
      slicer: () => this.backgroundSlicer(),
      log: options.log,
      failed: error => hostFailure("character", "prefetch_failed", "Some character choices couldn't be prepared ahead; they are read when picked.", error, "warn"),
    }, options.prefetchLimits);
  }

  private get resolverCache() { return this.options.resolverCache ?? join(this.options.cacheRoot, "resolver"); }
  /** Where the prepared game files live (prepared-files.ts). */
  get preparedRoots(): PreparedRoots {
    return { exports: join(this.options.cacheRoot, "exports"), resolver: this.resolverCache, store: this.storeRoot, manifests: join(this.options.cacheRoot, "choices"),
      previews: this.previews.root };
  }
  /** The route's name for manifests: its settings, WolvenKit and WolvenKit's identity (never the process-local generation). */
  private manifests(route: CharacterRoute) {
    const key = installationRouteKey(route);
    return { dir: this.preparedRoots.manifests, key: (request: CharacterRequest) => choiceKey(key, request) };
  }
  private exporterFor(cli: string | null): GameAssetExporter {
    const exports = join(this.options.cacheRoot, "exports");
    const inner = this.options.exporter?.(cli) ?? createWolvenKitGameAssetExporter(exports, cli);
    const decoder = this.options.textureDecoder === false ? null
      : this.options.textureDecoder ?? (this.options.exporter ? null : (gameRoot: string) => this.textureDecoders.get(gameRoot));
    // Textures natively first, served from their largest mip within the preview's size, WolvenKit per texture it refuses (PIPE-104).
    const textured = decoder ? createNativeFirstExporter(inner, { cacheRoot: exports, maxSide: SERVED_TEXTURE_MAX, decoder }) : inner;
    const geometryDecoder = this.options.geometryDecoder === false ? null
      : this.options.geometryDecoder ?? (this.options.exporter ? null : (gameRoot: string) => this.geometryDecoders.get(gameRoot));
    // Meshes and morph targets natively first, WolvenKit per resource the reader refuses (native reader phase 4).
    return geometryDecoder ? createNativeGeometryExporter(textured, { cacheRoot: exports, decoder: geometryDecoder }) : textured;
  }
  /** One texture decode worker per game folder, opened when first asked for (native-texture-export.ts). */
  private decoders: NativeDecoders | null = null;
  private get textureDecoders(): NativeDecoders {
    return this.decoders ??= new NativeDecoders({ script: this.options.nativeDecodeWorker, log: this.options.log });
  }
  /** One mesh decode worker per game folder, beside the texture one, so meshes and textures decode side by side. */
  private meshDecoders: NativeDecoders | null = null;
  private get geometryDecoders(): NativeDecoders {
    return this.meshDecoders ??= new NativeDecoders({ script: this.options.nativeDecodeWorker, log: this.options.log, timeoutMs: NATIVE_GEOMETRY_TIMEOUT_MS,
      label: { reader: "mesh reader", what: "meshes" }, offSwitch: "XFS_NATIVE_MESHES" });
  }

  private get storeRoot() { return join(this.options.cacheRoot, "characters"); }

  /** The launch route (`characterRoute`: WolvenKit optional). */
  private route(): CharacterRoute | null { return characterRoute(this.options.settings()); }

  private set(state: Omit<CharacterDetailState, "schema" | "recordSchema">): CharacterDetailState {
    const full = { schema: CHARACTER_DETAIL_STATE_SCHEMA, recordSchema: CHARACTER_DETAIL_SCHEMA, ...state };
    this.states.set(state.key, full);
    // Keep only the recent answers; a page polls one key at a time.
    for (const key of [...this.states.keys()].slice(0, Math.max(0, this.states.size - 8))) this.states.delete(key);
    return full;
  }

  /**
   * Start (or reuse) the preparation for a request from one open page (`page`: its name, empty for a caller that gives none). That
   * page's other running request is cancelled, and its state is forgotten at once; another page's is left to finish (PIPE-103). The
   * new preparation starts once every earlier one (a cancelled one too) has stopped.
   */
  request(request: CharacterRequest, page = ""): CharacterDetailState {
    // A person's change pre-empts preparing ahead at once, even when its answer is ready: the batch stops (its choices are queued again,
    // reads already started finish and are kept), so the page reads its record and files without sharing the host with it.
    this.noteAsk();
    this.prefetch.pause();
    const settings = this.options.settings();
    const fingerprint = installationFingerprint(settings);
    const key = characterRequestKey(request, fingerprint);
    const known = this.states.get(key);
    const live = <T extends { controller: AbortController }>(run: T | undefined) => run && !run.controller.signal.aborted ? run : null;
    const active = live(this.running.get(page));
    // A degraded answer is served once, then prepared again (PIPE-53). A V another page is having prepared is shared, not restarted.
    if ((known?.phase === "ready" && !this.degraded.has(key))
      || (known?.phase === "preparing" && [...this.running.values()].some(run => live(run) && run.key === key))) return known;
    this.degraded.delete(key);
    // A different (or a stale, cancelled) preparation: stop it and forget its answer now, so a quick
    // V1 -> V2 -> V1 restarts V1 instead of reporting the cancelled run as still preparing.
    if (active) { active.controller.abort(); this.states.delete(active.key); }
    // The V resolved in the background after a restart steps aside; what it resolved so far stays in the shared cache.
    const warmingUp = this.warmingUp;
    warmingUp?.controller.abort();
    const route = this.route();
    if (!route) return this.set({ key, phase: "failed", message: NEEDS_SETUP, progress: null, record: null });
    // Without WolvenKit nothing can be exported for the 3D view: say so at once, as a need rather than a failure, without resolving the V
    // (NATIVE-48). Setting it up changes the fingerprint, so the page's next request prepares the V.
    if (!route.wolvenKitCli) {
      if (known?.phase !== "failed" || known.need !== "wolvenkit") this.options.log?.("Your V's details wait for WolvenKit to be set up.");
      return this.set({ key, phase: "failed", message: TOOL_MISSING, progress: null, record: null, need: "wolvenkit" });
    }
    const controller = new AbortController();
    if (this.shared?.fingerprint !== fingerprint) this.shared = { fingerprint, cache: new CharacterPreparationCache() };
    const cache = this.shared.cache;
    const exporter = this.exporterFor(route.wolvenKitCli);
    // A person's own change comes first: a choice being prepared ahead steps aside (choice-prefetch.ts).
    this.prefetch.foreground(request);
    const first = CHARACTER_DETAIL_STEPS[0]!;
    this.set({ key, phase: "preparing", message: PREPARING, progress: { index: 0, total: CHARACTER_DETAIL_STEPS.length, label: first.label }, record: null });
    // Whether this run still owns its key's state (a newer run for the same key takes it over).
    const owns = () => ![...this.running.values()].some(run => run.key === key && run.controller !== controller);
    // The whole wait is logged, not only the preparation: queued (behind another page's run or a stopped batch), started, done.
    const asked = Date.now();
    let started = 0;
    // The installation the preparation read: its watch list is what a kept answer names (prepared-answers.ts).
    let opened: Installation | null = null;
    const open = async (options: InstallationOptions) => (opened = await acquireInstallation(options));
    const run = () => {
      if (controller.signal.aborted) throw new CharacterDetailError("character_cancelled", "Superseded before it started.");
      started = Date.now();
      return foregroundExtraction(this.resolverCache, () => (this.options.prepare ?? prepareCharacterDetails)({ request, route, storeRoot: this.storeRoot, cache, open,
        derive: request.choices?.length ? structuralInput : undefined, manifests: this.manifests(route),
        resolverCache: this.resolverCache, exporter, signal: controller.signal,
        progress: (_step, index, total, label) => {
          if (!controller.signal.aborted) this.set({ key, phase: "preparing", message: PREPARING, progress: { index, total, label }, record: null });
        }, log: this.options.log, trace: this.options.trace, nativeDecodeWorker: this.options.nativeDecodeWorker }));
    };
    // Start now, or once the earlier runs (a cancelled one still settling on the shared cache, another page's) and a stopped prefetch
    // batch have let go (PREV-102, PIPE-103).
    const waits: Promise<unknown>[] = [...this.running.values()].map(run => run.promise);
    if (warmingUp) waits.push(warmingUp.promise);
    if (this.prefetch.preparing) waits.push(this.prefetch.idle());
    // A preview source being derived is stopped, unless it is already writing (then it finishes: it takes a moment and is kept).
    if (this.previewing) {
      if (!this.previewing.passed) this.previewing.controller.abort();
      waits.push(this.previewing.promise.catch(() => { /* Settled. */ }));
    }
    const begun = waits.length ? Promise.all(waits).then(run) : new Promise<Awaited<ReturnType<typeof run>>>(resolve => resolve(run()));
    const promise = begun
      .then(result => {
        this.set({ key, phase: "ready", message: result.note ?? "", progress: null, record: result.recordFile });
        if (result.degraded) this.degraded.add(key); else this.degraded.delete(key);
        // A complete answer is kept for the next start, named by the installation it was prepared from (prepared-answers.ts).
        const watch = (opened as Installation | null)?.watch;
        if (!result.degraded && watch?.length) void this.answers?.remember(installationRouteKey(route), request, { record: result.recordFile, message: result.note ?? "" }, watch);
        this.prefetch.prepared(request, !result.degraded);
        void this.keepWithinBudget();
        const done = Date.now(), seconds = (ms: number) => (ms / 1000).toFixed(1);
        this.options.log?.(`Skin, face details, eyes, brows, lashes, hair, piercings and body prepared in ${seconds(done - started)} s (${request.source} V; ` +
          `waited ${seconds(started - asked)} s before starting, ${seconds(done - asked)} s in all).`);
      })
      .catch(error => {
        const cancelled = error instanceof CharacterDetailError && error.code === "character_cancelled" || controller.signal.aborted;
        this.prefetch.prepared(request, false);
        if (cancelled) { if (owns()) this.states.delete(key); return; }
        const message = error instanceof CharacterDetailError ? error.message : FAILED;
        this.options.log?.(`Skin, face details, eyes, brows, lashes, hair, piercings and body were not prepared: ${error instanceof CharacterDetailError ? `${error.code} ${error.detail}` : (error as Error)?.stack ?? error}`);
        // WolvenKit gone or unable to run (its .NET runtime) is a need with a next step, not a failure to report (NATIVE-47, NATIVE-48).
        const need = error instanceof CharacterDetailError && error.code === "character_tool_missing";
        if (!need) hostFailure("character", error instanceof CharacterDetailError ? error.code : "character_failed", message, error instanceof CharacterDetailError ? { code: error.code, message: error.message, detail: error.detail } : error);
        if (owns()) this.set({ key, phase: "failed", message, progress: null, record: null, ...(need ? { need: "wolvenkit" as const } : {}) });
      })
      .finally(() => { if (this.running.get(page)?.controller === controller) this.running.delete(page); });
    this.running.set(page, { key, controller, promise });
    return this.states.get(key)!;
  }

  /**
   * A person's request, answered (character-detail-server.ts): a V this process hasn't answered yet is answered from a kept answer when
   * nothing it was prepared from changed (prepared-answers.ts; the restart case); otherwise the installation is checked (`refresh`) and
   * the request goes on as `request` does.
   */
  async answer(request: CharacterRequest, page = ""): Promise<CharacterDetailState> {
    // A kept answer checks every stamp it depends on itself, so it needs no installation check of its own; nor does the same V's request
    // moments after a kept answer was checked for the page's warm start (`KEPT_VOUCH_MS`).
    const key = characterRequestKey(request, installationFingerprint(this.options.settings()));
    const vouched = this.keptAt.get(key), fresh = vouched !== undefined && Date.now() - vouched < KEPT_VOUCH_MS && this.states.get(key)?.phase === "ready";
    this.keptAt.delete(key);
    const state = await this.kept(request, page) ?? (fresh ? this.request(request, page) : (await this.refresh(), this.request(request, page)));
    // The page shows a V answered from a kept answer (now, or for its warm start a moment ago): resolve it in the background later.
    if (state.phase === "ready" && this.unwarmed.delete(state.key)) this.warmUp(request);
    return state;
  }
  /**
   * What the host already has for `request` (a page's warm start, character-warm-start.ts): its known state when it is ready, else a kept
   * answer when nothing it was prepared from changed, else `unknown`. Never starts a preparation.
   */
  async known(request: CharacterRequest, page = ""): Promise<CharacterDetailState> {
    const key = characterRequestKey(request, installationFingerprint(this.options.settings()));
    const known = this.states.get(key);
    if (known?.phase === "ready" && !this.degraded.has(key)) return known;
    return await this.kept(request, page) ?? this.state(key);
  }
  /** Keys answered from a kept answer whose V hasn't been resolved into the shared cache yet (`warmUp`). */
  private readonly unwarmed = new Set<string>();
  /** When a kept answer was checked, by key: it vouches for that V's next request within `KEPT_VOUCH_MS` (`answer`). */
  private readonly keptAt = new Map<string, number>();
  /** A kept answer for `request` as this host's ready state, or null (none, not current, or this process already knows the key). */
  private async kept(request: CharacterRequest, page: string): Promise<CharacterDetailState | null> {
    const route = this.route();
    if (!this.answers || !route?.wolvenKitCli) return null;
    const keyNow = () => characterRequestKey(request, installationFingerprint(this.options.settings()));
    if (this.states.has(keyNow())) return null;
    const started = performance.now();
    this.asking++;
    let found;
    try { found = await this.answers.find(installationRouteKey(route), request); }
    catch { found = null; }
    finally { this.asking--; }
    // Asked, prepared or answered meanwhile (another page, the same page again), or the route changed: the usual path decides.
    const key = keyNow(), now = this.route();
    if (!found || this.states.has(key) || !now || installationRouteKey(now) !== installationRouteKey(route)) return null;
    this.noteAsk();
    this.prefetch.pause();
    const active = this.running.get(page);
    if (active && !active.controller.signal.aborted && active.key !== key) { active.controller.abort(); this.states.delete(active.key); }
    const state = this.set({ key, phase: "ready", message: found.message, progress: null, record: found.record });
    this.prefetch.prepared(request, true);
    this.options.log?.(`Your V was shown as prepared before (nothing it was prepared from changed; checked in ${Math.round(performance.now() - started)} ms).`);
    this.unwarmed.add(key);
    this.keptAt.set(key, Date.now());
    return state;
  }
  /**
   * Resolve a V answered from a kept answer into the shared cache, in the background once the page has been quiet for `WARM_UP_QUIET_MS`
   * (it reads the V's files and starts everything else first), so the person's first change after a restart only resolves and exports
   * what it changes. Nothing is written to the store. A person's request stops it (`request`).
   */
  private warmUp(request: CharacterRequest): void {
    this.warmingUp?.controller.abort();
    const controller = new AbortController();
    const promise = (async () => {
      for (;;) {
        await this.foregroundIdle();
        const quiet = WARM_UP_QUIET_MS - (Date.now() - this.askedAt);
        if (quiet <= 0 || controller.signal.aborted) break;
        await new Promise(done => setTimeout(done, quiet));
      }
      if (controller.signal.aborted || this.running.size) return;
      const started = Date.now();
      const [outcome] = await this.warm([request], controller.signal);
      if (!controller.signal.aborted) this.options.log?.(`Your V was resolved in the background in ${((Date.now() - started) / 1000).toFixed(1)} s${outcome?.ready ? "" : " (not complete)"}, so changes to it start from there.`);
    })().catch(() => { /* Stopped by a person's change, or failed: the change prepares what it needs. */ })
      .finally(() => { if (this.warmingUp?.controller === controller) this.warmingUp = null; });
    this.warmingUp = { controller, promise };
  }

  /**
   * Check the current route's opened installation (installation-registry.ts) before a request is answered: when the mod
   * setup changed since it was opened, the route's generation moves on, so the request key changes and the V is
   * prepared again from the new setup instead of reusing an answer for the old one. Cheap: one `lstat` per watched path.
   */
  async refresh(): Promise<void> {
    const route = this.route();
    if (!route) return;
    // A person's request: background work steps aside until it is answered (`backgroundSlicer`).
    this.asking++;
    try { await installations.revalidate(route); }
    catch { /* The preparation checks again, and reports what it cannot read. */ }
    finally { this.asking--; }
  }
  /**
   * The turn background work takes between its units (research/backlog/performance.md, scheduling rule): it lets the event loop answer
   * what is waiting once its slice is used (event-loop.ts), and waits while a person's own request is being answered or prepared, so the
   * person's change never shares the host's one thread with checks made ahead of time.
   */
  private backgroundSlicer(): () => Promise<void> {
    const slice = timeSlicer();
    return async () => {
      await slice();
      if (this.running.size || this.asking || Date.now() - this.askedAt < QUIET_MS) await this.foregroundIdle();
    };
  }

  /** The state for a request key; `unknown` when this host has not seen it (the page asks again). */
  state(key: string): CharacterDetailState {
    return this.states.get(key) ?? { schema: CHARACTER_DETAIL_STATE_SCHEMA, recordSchema: CHARACTER_DETAIL_SCHEMA, key, phase: "unknown", message: "", progress: null, record: null };
  }

  cancel(): void { for (const run of this.running.values()) run.controller.abort(); this.prefetch.cancel(); }

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
  /**
   * A check of whether requests are ready on the installation as it is now (their manifests hold), a few entries at a time so the host
   * keeps answering requests while a row's choices are checked (choice-manifest.ts `manifestProblemSliced`).
   */
  private async readiness(): Promise<(request: CharacterRequest) => Promise<boolean>> {
    const route = this.route();
    if (!route) return async () => false;
    const installation = await this.backgroundInstallation({ ...route, cacheDir: this.resolverCache, log: this.options.log });
    const exporter = this.exporterFor(route.wolvenKitCli), manifests = this.manifests(route);
    const check = { graph: installation.graph, fetcher: installation.fetcher, exporter, gameRoot: route.gameRoot, tool: installation.fetcher.tool,
      xl: xlIdentity(installation) };
    const slice = this.backgroundSlicer();
    return async request => {
      const manifest = readChoiceManifest(manifests.dir, manifests.key(request));
      if (!manifest) return false;
      const memo = new Map<string, string>();
      return await manifestProblemSliced(manifest, check, slice, run => withArchiveFingerprints(run, memo)) === null;
    };
  }
  /** Whether preparing waits for setup (no game folder, or no WolvenKit): preparing ahead then stops early (NATIVE-48). */
  private needsSetup(): boolean { return !this.route()?.wolvenKitCli; }
  /** Prepare requests ahead, in the background, sharing the preparations' cache. */
  private async warm(requests: readonly CharacterRequest[], signal: AbortSignal) {
    const route = this.route();
    if (!route?.wolvenKitCli || !requests.length) return requests.map(() => ({ ready: false }));
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
  /**
   * Resolves once no person's own change is being prepared or answered and the page has been quiet for `QUIET_MS` (it reads a new
   * record's files right after the answer): the next batch of choices prepared ahead starts only then.
   */
  private async foregroundIdle(): Promise<void> {
    for (;;) {
      if (this.running.size) await Promise.all([...this.running.values()].map(run => run.promise.catch(() => { /* Settled. */ })));
      if (this.previewing) await this.previewing.promise.catch(() => { /* Settled. */ });
      const quiet = QUIET_MS - (Date.now() - this.askedAt);
      const held = PREVIEW_HOLD_MS - (Date.now() - this.previewAskedAt);
      if (!this.running.size && !this.asking && !this.previewing && quiet <= 0 && held <= 0) return;
      await new Promise(done => setTimeout(done, Math.max(5, Math.min(Math.max(quiet, held), QUIET_MS))));
    }
  }
  /** The page asked for its V or read one of its files: a person is waiting on the host. */
  noteAsk(): void { this.askedAt = Date.now(); }

  // ---- Choice previews (choice-previews-design.md §6.2) ----

  /**
   * A row's preview sources: each position's indexed source, and for `derive` (a choice prepared ahead and ready), its source derived now
   * from the prepared record, in the background lane: after a person's change, a batch prepared ahead and the quiet moment after a
   * person's request, one at a time. Never prepares a choice that isn't ready (that is preparing ahead's work).
   */
  async previewSources(input: PreviewSourcesInput): Promise<PreviewSourceItem[]> {
    const route = this.route();
    if (!route) return input.positions.map(position => ({ position, state: "unprepared" as const }));
    const manifests = this.manifests(route), items: PreviewSourceItem[] = [];
    if (input.derive !== null) this.previewAskedAt = Date.now();
    for (const position of input.positions) {
      const request = await this.requestFor(input.base, input.option, position);
      if (!request) { items.push({ position, state: "none" }); continue; }
      const key = manifests.key(request), stamp = manifestStamp(manifests.dir, key);
      let source = stamp ? this.previews.source(key, stamp) : undefined;
      if (source === undefined && position === input.derive && stamp && this.prefetch.stateOf(input.base, input.option, position) === "r") {
        const derived = await this.derivePreview(request, input.kind, route, key, stamp, input.signal);
        if (derived === "busy") { items.push({ position, state: "unprepared", busy: true }); continue; }
        source = derived;
      }
      items.push(source === undefined ? { position, state: "unprepared" } : source === null ? { position, state: "none" } : { position, state: "ready", source });
    }
    return items;
  }
  /**
   * Plan and write a ready choice's record from the caches and keep its source (undefined: degraded or failed this time; `busy`: the
   * background lane wasn't free within `PREVIEW_DERIVE_WAIT_MS`, the page went away while waiting, or a person's change stopped it). Once started, a
   * derivation finishes and is kept even if the page goes away (its source serves the next question).
   */
  private async derivePreview(request: CharacterRequest, kind: PreviewKind, route: CharacterRoute, key: string, stamp: string,
    signal?: AbortSignal): Promise<ChoicePreviewSource | null | undefined | "busy"> {
    // Wait for the background lane: no person's change, no batch prepared ahead, no other derivation, and the page quiet a moment.
    for (const began = Date.now(); ;) {
      if (signal?.aborted) return "busy";
      this.previewAskedAt = Date.now();
      const busy = this.running.size || this.asking || this.previewing || this.prefetch.preparing || this.warming.size || Date.now() - this.askedAt < QUIET_MS;
      if (!busy) break;
      if (Date.now() - began >= PREVIEW_DERIVE_WAIT_MS) return "busy";
      await new Promise(done => setTimeout(done, 100));
    }
    const settings = this.options.settings(), fingerprint = installationFingerprint(settings);
    if (this.shared?.fingerprint !== fingerprint) this.shared = { fingerprint, cache: new CharacterPreparationCache() };
    const cache = this.shared.cache, controller = new AbortController();
    const entry: { controller: AbortController; promise: Promise<unknown>; passed: boolean } = { controller, promise: Promise.resolve(), passed: false };
    const started = Date.now();
    const work = backgroundExtraction(this.resolverCache, () => (this.options.prepare ?? prepareCharacterDetails)({ request, route, storeRoot: this.storeRoot, cache,
      // No manifest is written: the choice's own (from preparing ahead) stays the authority, and this source is kept under its stamp.
      derive: request.choices?.length ? structuralInput : undefined, resolverCache: this.resolverCache,
      exporter: this.exporterFor(route.wolvenKitCli), signal: controller.signal, log: this.options.log, nativeDecodeWorker: this.options.nativeDecodeWorker,
      skipDangles: true, progress: step => { if (step === "writing") entry.passed = true; } }));
    entry.promise = work;
    this.previewing = entry;
    try {
      const result = await work;
      // Stopped for a person's change (PREV-162): the lane was taken, not a failed try; the page asks again shortly.
      if (result.degraded) return controller.signal.aborted ? "busy" : undefined;
      const source = previewSourceOf(result.record.components, kind);
      // Kept only if the choice's manifest is still the one it was derived under (preparing ahead may have renewed it meanwhile).
      if (manifestStamp(this.manifests(route).dir, key) === stamp) this.previews.setSource(key, stamp, source);
      this.options.log?.(`Choice preview source derived in ${((Date.now() - started) / 1000).toFixed(2)} s (${source ? `${source.parts.length} part(s)` : "nothing drawn"}).`);
      return source;
    } catch (error) {
      if (controller.signal.aborted) return "busy";
      this.options.log?.(`A choice preview's source couldn't be derived: ${(error as Error)?.message ?? error}`);
      return undefined;
    } finally {
      if (this.previewing === entry) this.previewing = null;
    }
  }

  // ---- Prepared game files (prepared-files.ts) ----

  /** Other hosts' prepared game files that "Prepared game files" counts and Clear removes (the facial host's cache, CORE-102). */
  private readonly otherPrepared: { bytes(): Promise<number>; clear(): Promise<{ freed: number }> }[] = [];
  /** Count another host's prepared game files with these, and clear them with these. */
  attachPrepared(source: { bytes(): Promise<number>; clear(): Promise<{ freed: number }> }): void { this.otherPrepared.push(source); }
  /** The prepared files' size on disk (other hosts' included in `bytes` and `others`). */
  async preparedFiles(): Promise<PreparedSize & { others: number }> {
    const [own, ...others] = await Promise.all([preparedSize(this.preparedRoots), ...this.otherPrepared.map(source => source.bytes().catch(() => 0))]);
    const extra = others.reduce((sum, bytes) => sum + bytes, 0) + this.previews.bytes();
    return { ...own, bytes: own.bytes + extra, others: extra };
  }
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
    for (const run of this.running.values()) run.controller.abort();
    await this.settled().catch(() => {});
    // A stopped prefetch batch lets go of the cache and finishes its reads before anything is removed (PREV-102).
    await this.prefetch.idle();
    await this.warmingSettled();
    await this.evicting;
    this.previewing?.controller.abort();
    await this.previewing?.promise.catch(() => {});
    const result = await clearPrepared(this.preparedRoots);
    try { result.freed += this.previews.clear().freed; }
    catch (error) { this.options.log?.(`Some choice previews couldn't be cleared: ${(error as Error)?.message ?? error}`); }
    for (const source of this.otherPrepared) {
      try { result.freed += (await source.clear()).freed; }
      catch (error) { this.options.log?.(`Some prepared game files couldn't be cleared: ${(error as Error)?.message ?? error}`); }
    }
    this.shared = null;
    this.states.clear();
    this.degraded.clear();
    // The files are gone, so preparing ahead may fill the budget again this session (PREV-104).
    this.prefetch.resetBudget();
    return result;
  }
  /** Resolves once no preparation is running (every page's). */
  async settled(): Promise<void> { while (this.running.size) await Promise.all([...this.running.values()].map(run => run.promise)); }

  /** Absolute path of a served record or file, or null. Names are content-addressed, never paths. */
  filePath(name: string): string | null {
    if (!STORE_FILE.test(name)) return null;
    const path = join(this.storeRoot, name.endsWith(".json") ? "records" : "files", name);
    return existsSync(path) ? path : null;
  }
}
