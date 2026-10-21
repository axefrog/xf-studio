import { createHash } from "node:crypto";
import { freemem } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../../legacy/eye-makeup/plate/eye-plate-recipe";
import { CharacterDetailError, CHARACTER_DETAIL_STEPS, CharacterPreparationCache, prepareCharacterDetails, SERVED_TEXTURE_MAX, STORE_FILE, TOOL_MISSING, warmCharacters,
  type CharacterRoute, type PrepareCharacterOptions, type WarmOptions } from "./character-detail-service";
import { choiceKey, manifestProblemSliced, readChoiceManifest, xlIdentity } from "./choice-manifest";
import { ChoicePrefetcher, requestKey, type PrefetchAnswer, type PrefetchInput, type PrefetchLimits } from "../choice-prefetch";
import { exportsSource, filesSource, keptSource, PreparedFiles, type PreparedRoots, type PreparedSize } from "../../host/prepared-files";
import { withArchiveFingerprints, type Installation, type InstallationOptions } from "../../game/host/resolver-host";
import { hostJobs, lowPriorityNow } from "../../host/host-jobs";
import { hostClock, type Clock } from "../../platform/core/clock";
import { DEFAULT_QUIET_MS, lease, type JobContext, type JobScheduler, type JobSpec, type Want } from "../../platform/core/jobs";
import { CHARACTER_DETAIL_SCHEMA } from "../render-detail";
import type { CharacterRequest } from "../character-detail-request";
import type { GameAssetExporter } from "../../game/host/game-asset-export";
import { createWolvenKitGameAssetExporter } from "../../game/host/game-asset-export-wolvenkit";
import { createNativeGeometryExporter, type GeometryDecoder, NATIVE_GEOMETRY_TIMEOUT_MS } from "../../game/host/native-geometry-export";
import { createNativeFirstExporter, NativeDecoders, type TextureDecoder } from "../../game/host/native-texture-export";
import { acquireInstallation, installationRouteKey, installations, type InstallationRegistry } from "../../game/host/installation-registry";
import { CreatorCatalogueHost, structuralInput } from "./cc-catalogue-service";
import type { LaunchRoute } from "../../setup/local-settings";
import { routeIdentity, routeStamps } from "../../game/host/route-fingerprint";
import { wolvenKitIdentity, wolvenKitIdentityKey } from "../../host/wolvenkit-cli";
import type { DiagnosticTrace } from "../../diagnostics/model";
import { hostFailure } from "../../diagnostics/host/host-log";
import { type ChoicePreviewSource, type PreviewKind, previewSourceOf } from "../choice-preview";
import { ChoicePreviewStore, manifestStamp } from "./choice-preview-host";
import { hostCodeIdentity } from "../../host/host-code-identity";
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
 * checked against the mod setup before each use.
 *
 * **When work runs** is the host's job scheduler's (platform/core/jobs.ts, host-jobs.ts): a page's V is a `person` job wanted by
 * `<page>/character` (two pages on the same V share one run), held by a lease each poll renews, so a page that went away stops its V;
 * a preview source being derived is `shown`; the V resolved after a restart (`host/warm-up`), choices prepared ahead (`prefetch`) and
 * the prepared files' budget check are `ahead`. They share one on-disk cache, so one runs at a time, a new one only after a stopped
 * one's run returned; a person's change stops what runs below it unless it is past its threshold.
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
export type CharacterDetailSettings = { baseOnly?: boolean; gameRoot: string | null; launchRoute: LaunchRoute; mo2Root: string | null;
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
  /** The host's job scheduler (host-jobs.ts), shared with the prepared files' owner; default: one of its own. */
  jobs?: JobScheduler;
  /** The host process's prepared files' owner (prepared-files.ts), with its one budget; default: one of its own over this host alone. */
  prepared?: PreparedFiles;
  /**
   * This host's files as one named partition with an optional cap (the baseline references, HAIR-03); default: the `character`, `exports`
   * and `previews` partitions.
   */
  partition?: { name: string; cap?: number };
  /** The clock of the pages' leases (`PAGE_LEASE_MS`); default the host's. */
  clock?: Clock;
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
  return { ...(settings.baseOnly ? { baseOnly: true } : {}), gameRoot: settings.gameRoot, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root, mo2ProfileId: settings.mo2ProfileId,
    manualModRoot: settings.manualModRoot, wolvenKitCli: settings.wolvenKitCli && existsSync(settings.wolvenKitCli) ? settings.wolvenKitCli : null };
}

/**
 * How many texture decode workers a batch uses (native-texture-export.ts lanes): two while the computer has room for a second one's
 * peak (about 300 MB decoding an 8192² map) with plenty to spare, else one (PREV-190: a cold hairstyle's maps decoded one at a time).
 */
export const textureLanes = (): number => freemem() > TWO_LANES_FREE_BYTES ? 2 : 1;
/** Free memory above which a second texture decode worker is used. */
export const TWO_LANES_FREE_BYTES = 4 * 1024 ** 3;

/** How long the page must have been quiet (no change asked for, no file of its V read) before work prepared ahead goes on. */
export const QUIET_MS = DEFAULT_QUIET_MS;
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
/**
 * How long a page's want of its V holds without the page asking about it (a poll, a request): a page that went away (closed, or a tab
 * the browser stopped) stops its V's preparation. Generous, since a hidden tab may be held to one timer a minute.
 */
export const PAGE_LEASE_MS = 90_000;

export class CharacterDetailHost {
  /** The host's scheduler (host-jobs.ts): a person's V, preview sources, work prepared ahead and the prepared files' upkeep, in their lanes. */
  readonly jobs: JobScheduler;
  /** The prepared files' owner (prepared-files.ts): this host's partitions within the process's one budget. */
  readonly prepared: PreparedFiles;
  private readonly states = new Map<string, CharacterDetailState>();
  /** The run preparing each key now, by key (its want, and the token that owns the key's state; a newer run for the key takes it over). */
  private readonly runs = new Map<string, { want: Want<void>; token: object }>();
  /** Each open page's V (`request`'s `page`): the key it wants and the lease that holds it while the page keeps asking. */
  private readonly pages = new Map<string, { key: string; lease: { readonly signal: AbortSignal; renew(): void }; end: AbortController }>();
  /** What preparations on the current installation share, and the fingerprint it belongs to. */
  private shared: { fingerprint: string; cache: CharacterPreparationCache } | null = null;
  /** Keys whose ready answer was degraded (PIPE-53): served once, prepared again when asked again. */
  private readonly degraded = new Set<string>();
  /** The installation's creator catalogue: the Character panel's options, and the interpreter of a request's creator choices. */
  readonly creator: CreatorCatalogueHost;
  /** Prepares an open Character panel row's choices ahead of a click (choice-prefetch.ts). */
  readonly prefetch: ChoicePrefetcher;
  /** Rendered choice previews and their sources (choice-preview-host.ts). */
  readonly previews: ChoicePreviewStore;
  /** Answers kept across restarts (`keptAnswers`), or null. */
  private readonly answers: PreparedAnswers | null;
  /** This host's prepared files, as the prepared files' owner counts them. */
  private readonly files: { size(): Promise<number> };
  constructor(private readonly options: CharacterDetailHostOptions) {
    // Each job reports its own failures in plain words (the scheduler never leaves one unhandled).
    this.jobs = options.jobs ?? hostJobs();
    this.prepared = options.prepared ?? new PreparedFiles({ scheduler: this.jobs, log: options.log });
    this.answers = options.keptAnswers === false ? null : options.keptAnswers ?? (options.prepare ? null
      : new PreparedAnswers(join(options.cacheRoot, "choices", "answers"), { code: hostCodeIdentity, recordSchema: CHARACTER_DETAIL_SCHEMA,
        recordExists: record => this.filePath(record) !== null }));
    this.previews = new ChoicePreviewStore(options.previewRoot ?? join(options.cacheRoot, "choice-previews"));
    this.creator = options.creator ?? new CreatorCatalogueHost({ route: () => this.route(), fingerprint: () => installationFingerprint(this.options.settings()),
      resolverCache: options.resolverCache ?? join(options.cacheRoot, "resolver"), log: options.log });
    this.prefetch = new ChoicePrefetcher({
      jobs: this.jobs,
      requestFor: (base, option, position) => this.requestFor(base, option, position),
      readiness: context => this.readiness(context),
      warm: (requests, context) => this.warm(requests, context),
      preparedBytes: () => this.files.size(),
      afterBatch: () => this.prepared.keepWithinBudget(),
      needsSetup: () => this.needsSetup(),
      log: options.log,
      failed: error => hostFailure("character", "prefetch_failed", "Some character choices couldn't be prepared ahead; they are read when picked.", error, "warn"),
    }, options.prefetchLimits);
    this.files = this.registerPrepared();
  }

  /**
   * This host's partitions of the prepared files: the character's (resolver JSON, store, manifests), its exports and its choice previews;
   * or, named (the baseline references), all of them as one partition with its cap.
   */
  private registerPrepared(): { size(): Promise<number> } {
    const roots = this.preparedRoots, previews = roots.previews!;
    const json = filesSource(join(roots.resolver, "json"), ".json", name => name.endsWith(".failed"));
    const kept = [keptSource(roots.store), keptSource(roots.manifests), keptSource(join(roots.resolver, "native"))];
    const exports = exportsSource(roots.exports);
    const shown = [filesSource(join(previews, "images"), ".webp"), filesSource(join(previews, "sources"), ".json")];
    const hooks = { stop: () => this.stopAll(), forget: () => this.forget(),
      // An owner on a scheduler of its own (the reference host) settles its work itself; on the shared one, Clear runs alone anyway.
      ...this.jobs === this.prepared.scheduler ? {} : { settle: () => this.jobs.idle() } };
    const named = this.options.partition;
    if (named) {
      const own = this.prepared.partition({ name: named.name, ...named.cap !== undefined ? { cap: named.cap } : {}, evictable: [exports, json, ...shown], kept, ...hooks });
      return { size: own.size };
    }
    const parts = [this.prepared.partition({ name: "character", evictable: [json], kept, ...hooks }),
      this.prepared.partition({ name: "exports", evictable: [exports] }),
      this.prepared.partition({ name: "previews", evictable: shown })];
    return { size: async () => (await Promise.all(parts.map(part => part.size()))).reduce((sum, bytes) => sum + bytes, 0) };
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
      : this.options.textureDecoder ? ((gameRoot: string, lane: number) => lane ? Promise.resolve(null) : (this.options.textureDecoder as (root: string) => Promise<TextureDecoder | null>)(gameRoot))
      : this.options.exporter ? null : (gameRoot: string, lane: number) => (lane ? this.textureDecodersExtra : this.textureDecoders).get(gameRoot);
    // Textures and layer masks natively first, textures served from their largest mip within the preview's size, WolvenKit per resource
    // the reader refuses (PIPE-104, PREV-190); two workers side by side while memory allows (`textureLanes`).
    const textured = decoder ? createNativeFirstExporter(inner, { cacheRoot: exports, maxSide: SERVED_TEXTURE_MAX, decoder, lanes: textureLanes }) : inner;
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
  /** A second texture decode worker per game folder, for a batch's second lane (`textureLanes`). */
  private decodersExtra: NativeDecoders | null = null;
  private get textureDecodersExtra(): NativeDecoders {
    return this.decodersExtra ??= new NativeDecoders({ script: this.options.nativeDecodeWorker, log: this.options.log });
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
  /** The preparation cache shared on the current installation (a new one once its fingerprint changed). */
  private sharedCache(fingerprint = installationFingerprint(this.options.settings())): CharacterPreparationCache {
    if (this.shared?.fingerprint !== fingerprint) this.shared = { fingerprint, cache: new CharacterPreparationCache() };
    return this.shared.cache;
  }

  private set(state: Omit<CharacterDetailState, "schema" | "recordSchema">): CharacterDetailState {
    const full = { schema: CHARACTER_DETAIL_STATE_SCHEMA, recordSchema: CHARACTER_DETAIL_SCHEMA, ...state };
    this.states.set(state.key, full);
    // Keep only the recent answers; a page polls one key at a time.
    for (const key of [...this.states.keys()].slice(0, Math.max(0, this.states.size - 8))) this.states.delete(key);
    return full;
  }

  /**
   * The page moved on from the V it wanted (to `key`, or to nothing): its want is released, and a preparation nobody wants any more is
   * stopped and its state forgotten at once, so a quick V1 -> V2 -> V1 restarts V1 instead of reporting the stopped run as preparing.
   */
  private leave(page: string, key: string | null): void {
    const held = this.pages.get(page);
    if (!held || held.key === key) return;
    this.pages.delete(page);
    held.end.abort();
    this.jobs.release(`${page}/character`);
    this.forgetStopped(held.key);
  }
  private forgetStopped(key: string): void {
    const run = this.runs.get(key);
    if (run && run.want.state().phase === "stopped") { this.runs.delete(key); this.states.delete(key); }
  }

  /**
   * Start (or reuse) the preparation for a request from one open page (`page`: its name, empty for a caller that gives none). That
   * page's earlier V is let go (stopped, and its state forgotten, unless another page wants it too); another page's is left to finish
   * (PIPE-103). Preparations run one at a time, in the order asked (the scheduler's person lane), each once the run before it returned.
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
    // A degraded answer is served once, then prepared again (PIPE-53).
    if (known?.phase === "ready" && !this.degraded.has(key)) { this.leave(page, null); return known; }
    const route = this.route();
    if (!route) { this.leave(page, null); return this.set({ key, phase: "failed", message: NEEDS_SETUP, progress: null, record: null }); }
    // Without WolvenKit nothing can be exported for the 3D view: say so at once, as a need rather than a failure, without resolving the V
    // (NATIVE-48). Setting it up changes the fingerprint, so the page's next request prepares the V.
    if (!route.wolvenKitCli) {
      this.leave(page, null);
      if (known?.phase !== "failed" || known.need !== "wolvenkit") this.options.log?.("Your V's details wait for WolvenKit to be set up.");
      return this.set({ key, phase: "failed", message: TOOL_MISSING, progress: null, record: null, need: "wolvenkit" });
    }
    const running = this.runs.get(key);
    const live = running && (running.want.state().phase === "waiting" || running.want.state().phase === "running");
    // A V another page is having prepared (or this page asked again) is shared, not restarted.
    if (!live) this.degraded.delete(key);
    this.leave(page, key);
    const end = new AbortController();
    const held = this.pages.get(page) ?? { key, lease: lease(this.options.clock ?? hostClock(), PAGE_LEASE_MS, end.signal), end };
    held.lease.renew();
    this.pages.set(page, held);
    const token = {};
    const spec = live ? { key, lane: "person" as const, run: async () => {} } : this.preparation(request, key, route, fingerprint, token);
    // The run is known by its key before it is wanted: a person's job may start within `want`.
    const entry = { want: null as unknown as Want<void>, token };
    if (!live) this.runs.set(key, entry);
    const want = this.jobs.want(`${page}/character`, spec, held.lease.signal);
    if (!live) {
      entry.want = want;
      void want.settled.then(outcome => {
        if (this.runs.get(key)?.token !== token) return;
        this.runs.delete(key);
        // Stopped, perhaps before it ever started (its page's lease ran out while it waited): the key isn't being prepared any more, so a
        // page that comes back is told `unknown` and asks again, never `preparing` with nothing running.
        if (outcome.status === "superseded" && this.states.get(key)?.phase === "preparing") this.states.delete(key);
      });
    }
    // The page's lease ends with the run it holds.
    void want.settled.then(() => { if (this.pages.get(page) === held) { this.pages.delete(page); held.end.abort(); } });
    if (!live) this.prefetch.foreground(request);
    return this.states.get(key) ?? this.set({ key, phase: "preparing", message: PREPARING, progress: { index: 0, total: CHARACTER_DETAIL_STEPS.length, label: CHARACTER_DETAIL_STEPS[0]!.label }, record: null });
  }

  /** A preparation of `request` as a person's job: its state is set as it goes, and kept when it ends. */
  private preparation(request: CharacterRequest, key: string, route: CharacterRoute, fingerprint: string, token: object): JobSpec<void> {
    // Whether this run still owns its key's state (a newer run for the same key takes it over).
    const owns = () => this.runs.get(key)?.token === token;
    const first = CHARACTER_DETAIL_STEPS[0]!;
    this.set({ key, phase: "preparing", message: PREPARING, progress: { index: 0, total: CHARACTER_DETAIL_STEPS.length, label: first.label }, record: null });
    // The whole wait is logged, not only the preparation: queued (behind another page's run or a stopped batch), started, done.
    const asked = Date.now();
    const spec: JobSpec<void> = { key, lane: "person", run: async context => {
      const { signal } = context;
      if (signal.aborted) return;
      const started = Date.now();
      // The installation the preparation read: its watch list is what a kept answer names (prepared-answers.ts).
      let opened: Installation | null = null;
      const open = async (options: InstallationOptions) => (opened = await acquireInstallation(options));
      try {
        const cache = this.sharedCache(fingerprint);
        const result = await (this.options.prepare ?? prepareCharacterDetails)({ request, route, storeRoot: this.storeRoot, cache, open,
          derive: request.choices?.length ? structuralInput : undefined, manifests: this.manifests(route),
          resolverCache: this.resolverCache, exporter: this.exporterFor(route.wolvenKitCli), signal,
          progress: (_step, index, total, label) => {
            if (!signal.aborted && owns()) this.set({ key, phase: "preparing", message: PREPARING, progress: { index, total, label }, record: null });
          }, log: this.options.log, trace: this.options.trace, nativeDecodeWorker: this.options.nativeDecodeWorker });
        if (owns()) this.set({ key, phase: "ready", message: result.note ?? "", progress: null, record: result.recordFile });
        if (result.degraded) this.degraded.add(key); else this.degraded.delete(key);
        // A complete answer is kept for the next start, named by the installation it was prepared from (prepared-answers.ts).
        const watch = (opened as Installation | null)?.watch;
        if (!result.degraded && watch?.length) void this.answers?.remember(installationRouteKey(route), request, { record: result.recordFile, message: result.note ?? "" }, watch);
        this.prefetch.prepared(request, !result.degraded);
        void this.prepared.keepWithinBudget();
        const done = Date.now(), seconds = (ms: number) => (ms / 1000).toFixed(1);
        this.options.log?.(`Skin, face details, eyes, brows, lashes, hair, piercings and body prepared in ${seconds(done - started)} s (${request.source} V; ` +
          `waited ${seconds(started - asked)} s before starting, ${seconds(done - asked)} s in all).`);
      } catch (error) {
        const cancelled = error instanceof CharacterDetailError && error.code === "character_cancelled" || signal.aborted;
        this.prefetch.prepared(request, false);
        if (cancelled) { if (owns()) this.states.delete(key); return; }
        const message = error instanceof CharacterDetailError ? error.message : FAILED;
        this.options.log?.(`Skin, face details, eyes, brows, lashes, hair, piercings and body were not prepared: ${error instanceof CharacterDetailError ? `${error.code} ${error.detail}` : (error as Error)?.stack ?? error}`);
        // WolvenKit gone or unable to run (its .NET runtime) is a need with a next step, not a failure to report (NATIVE-47, NATIVE-48).
        const need = error instanceof CharacterDetailError && error.code === "character_tool_missing";
        if (!need) hostFailure("character", error instanceof CharacterDetailError ? error.code : "character_failed", message, error instanceof CharacterDetailError ? { code: error.code, message: error.message, detail: error.detail } : error);
        if (owns()) this.set({ key, phase: "failed", message, progress: null, record: null, ...(need ? { need: "wolvenkit" as const } : {}) });
      }
    } };
    return spec;
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
    const keyNow = () => characterRequestKey(request, installationFingerprint(this.options.settings()));
    // A V this process answered before (a page reloaded): the installation is checked first, as a person's request is, so a mod changed
    // since doesn't warm the old record (PREV-199); the check vouches for the page's own request that follows (`KEPT_VOUCH_MS`).
    if (this.states.get(keyNow())?.phase === "ready") {
      await this.refresh();
      const key = keyNow(), known = this.states.get(key);
      if (known?.phase === "ready" && !this.degraded.has(key)) { this.vouch(key); return known; }
    }
    return await this.kept(request, page) ?? this.state(keyNow());
  }
  /** Keys answered from a kept answer whose V hasn't been resolved into the shared cache yet (`warmUp`). */
  private readonly unwarmed = new Set<string>();
  /** When a kept answer (or a ready V's installation) was checked, by key: it vouches for that V's next request within `KEPT_VOUCH_MS` (`answer`). */
  private readonly keptAt = new Map<string, number>();
  private vouch(key: string): void { this.keptAt.set(key, Date.now()); }
  /** A kept answer for `request` as this host's ready state, or null (none, not current, or this process already knows the key). */
  private async kept(request: CharacterRequest, page: string): Promise<CharacterDetailState | null> {
    const route = this.route();
    if (!this.answers || !route?.wolvenKitCli) return null;
    const keyNow = () => characterRequestKey(request, installationFingerprint(this.options.settings()));
    if (this.states.has(keyNow())) return null;
    const started = performance.now();
    // A person's request is being answered: work below the person lane waits for it.
    const release = this.jobs.hold();
    let found;
    try { found = await this.answers.find(installationRouteKey(route), request); }
    catch { found = null; }
    finally { release(); }
    // Asked, prepared or answered meanwhile (another page, the same page again), or the route changed: the usual path decides.
    const key = keyNow(), now = this.route();
    if (!found || this.states.has(key) || !now || installationRouteKey(now) !== installationRouteKey(route)) return null;
    this.noteAsk();
    this.prefetch.pause();
    this.leave(page, null);
    const state = this.set({ key, phase: "ready", message: found.message, progress: null, record: found.record });
    this.prefetch.prepared(request, true);
    this.options.log?.(`Your V was shown as prepared before (nothing it was prepared from changed; checked in ${Math.round(performance.now() - started)} ms).`);
    this.unwarmed.add(key);
    this.vouch(key);
    return state;
  }
  /**
   * Resolve a V answered from a kept answer into the shared cache, as work done ahead once the page has been quiet for `WARM_UP_QUIET_MS`
   * (it reads the V's files and starts everything else first), so the person's first change after a restart only resolves and exports
   * what it changes. Nothing is written to the store. A person's change stops it (the scheduler's rule).
   */
  private warmUp(request: CharacterRequest): void {
    this.jobs.want("host/warm-up", { key: `warm-up:${requestKey(request)}`, lane: "ahead", quietMs: WARM_UP_QUIET_MS, run: async context => {
      const started = Date.now();
      try {
        const [outcome] = await this.warm([request], context);
        if (!context.signal.aborted) this.options.log?.(`Your V was resolved in the background in ${((Date.now() - started) / 1000).toFixed(1)} s${outcome?.ready ? "" : " (not complete)"}, so changes to it start from there.`);
      } catch { /* Stopped by a person's change, or failed: the change prepares what it needs. */ }
    } });
  }

  /**
   * Check the current route's opened installation (installation-registry.ts) before a request is answered: when the mod
   * setup changed since it was opened, the route's generation moves on, so the request key changes and the V is
   * prepared again from the new setup instead of reusing an answer for the old one. Cheap: one `lstat` per watched path.
   */
  async refresh(): Promise<void> {
    const route = this.route();
    if (!route) return;
    // A person's request: work below the person lane steps aside until it is answered.
    const release = this.jobs.hold();
    try { await installations.revalidate(route); }
    catch { /* The preparation checks again, and reports what it cannot read. */ }
    finally { release(); }
  }

  /** The state for a request key; `unknown` when this host has not seen it (the page asks again). A page's poll holds its want. */
  state(key: string): CharacterDetailState {
    for (const held of this.pages.values()) if (held.key === key) held.lease.renew();
    return this.states.get(key) ?? { schema: CHARACTER_DETAIL_STATE_SCHEMA, recordSchema: CHARACTER_DETAIL_SCHEMA, key, phase: "unknown", message: "", progress: null, record: null };
  }

  /** Stop every page's preparation and preparing ahead. */
  cancel(): void { for (const page of [...this.pages.keys()]) this.leave(page, null); this.prefetch.cancel(); }

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
   * A check of whether requests are ready on the installation as it is now (their manifests hold), a few entries at a time with the job's
   * turn between them, so the host keeps answering requests while a row's choices are checked (choice-manifest.ts `manifestProblemSliced`).
   */
  private async readiness(context: JobContext): Promise<(request: CharacterRequest) => Promise<boolean>> {
    const route = this.route();
    if (!route) return async () => false;
    // Opening the installation can take a second after a start: a person's change doesn't wait for it (it goes on as the job's tail, and
    // the change's own open joins it).
    const opening = this.backgroundInstallation({ ...route, cacheDir: this.resolverCache, log: this.options.log });
    context.afterwards(opening);
    const installation = await untilStopped(opening, context.signal);
    const exporter = this.exporterFor(route.wolvenKitCli), manifests = this.manifests(route);
    const check = { graph: installation.graph, fetcher: installation.fetcher, exporter, gameRoot: route.gameRoot, tool: installation.fetcher.tool,
      xl: xlIdentity(installation) };
    return async request => {
      const manifest = readChoiceManifest(manifests.dir, manifests.key(request));
      if (!manifest) return false;
      const memo = new Map<string, string>();
      return await manifestProblemSliced(manifest, check, () => context.turn(), run => withArchiveFingerprints(run, memo)) === null;
    };
  }
  /** Whether preparing waits for setup (no game folder, or no WolvenKit): preparing ahead then stops early (NATIVE-48). */
  private needsSetup(): boolean { return !this.route()?.wolvenKitCli; }
  /**
   * Prepare requests ahead as part of a job below the person lane, sharing the preparations' cache. A stopped job answers at once; its
   * reads already in WolvenKit finish for everyone in the background (the job's `afterwards`, PREV-102), asking for nothing further.
   */
  private async warm(requests: readonly CharacterRequest[], context: JobContext) {
    const route = this.route();
    if (!route?.wolvenKitCli || !requests.length) return requests.map(() => ({ ready: false }));
    const cache = this.sharedCache();
    // Each launch decides its priority as it starts: below normal only while no person's job runs (PIPE-96).
    const work = (this.options.warm ?? warmCharacters)({ requests, route, storeRoot: this.storeRoot, cache,
      open: options => this.backgroundInstallation(options),
      derive: structuralInput, resolverCache: this.resolverCache, exporter: this.exporterFor(route.wolvenKitCli), signal: context.signal,
      lowPriority: lowPriorityNow, manifests: this.manifests(route), log: this.options.log, nativeDecodeWorker: this.options.nativeDecodeWorker });
    context.afterwards(work);
    return untilStopped(work, context.signal);
  }
  /** The opened installation for background work, without the check a person's request makes (opened when it isn't yet). */
  private async backgroundInstallation(options: InstallationOptions): Promise<Installation> {
    return installations.peek(options) ?? acquireInstallation(options);
  }
  /** The page asked for its V or read one of its files: a person is waiting on the host, so work below the person lane waits a moment. */
  noteAsk(): void { this.jobs.touch(); }

  // ---- Choice previews (choice-previews-design.md §6.2) ----

  /**
   * A row's preview sources: each position's indexed source, and for `derive` (a choice prepared ahead and ready), its source derived now
   * from the prepared record, in the `shown` lane: after a person's change and the quiet moment after it, before the next batch prepared
   * ahead (never stopping a running one), one at a time. Never prepares a choice that isn't ready (that is preparing ahead's work).
   */
  async previewSources(input: PreviewSourcesInput): Promise<PreviewSourceItem[]> {
    const route = this.route();
    if (!route) return input.positions.map(position => ({ position, state: "unprepared" as const }));
    const manifests = this.manifests(route), items: PreviewSourceItem[] = [];
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
   * Plan and write a ready choice's record from the caches and keep its source (undefined: degraded or failed this time; `busy`: it didn't
   * start within `PREVIEW_DERIVE_WAIT_MS`, the page went away while it waited, or a person's change stopped it before it was writing).
   * Once started, a derivation finishes and is kept even if the page goes away (its source serves the next question); once writing, a
   * person's change waits for it (it commits).
   */
  private async derivePreview(request: CharacterRequest, kind: PreviewKind, route: CharacterRoute, key: string, stamp: string,
    signal?: AbortSignal): Promise<ChoicePreviewSource | null | undefined | "busy"> {
    if (signal?.aborted) return "busy";
    const requester = `preview-source:${key}`;
    const want = this.jobs.want(requester, { key: `preview-source:${key}:${stamp}:${kind}`, lane: "shown", run: async context => {
      const started = Date.now();
      const result = await (this.options.prepare ?? prepareCharacterDetails)({ request, route, storeRoot: this.storeRoot, cache: this.sharedCache(),
        // No manifest is written: the choice's own (from preparing ahead) stays the authority, and this source is kept under its stamp.
        derive: request.choices?.length ? structuralInput : undefined, resolverCache: this.resolverCache,
        exporter: this.exporterFor(route.wolvenKitCli), signal: context.signal, log: this.options.log, nativeDecodeWorker: this.options.nativeDecodeWorker,
        skipDangles: true, progress: step => { if (step === "writing") context.commit(); } });
      if (result.degraded) return undefined;
      const source = previewSourceOf(result.record.components, kind);
      // Kept only if the choice's manifest is still the one it was derived under (preparing ahead may have renewed it meanwhile).
      if (manifestStamp(this.manifests(route).dir, key) === stamp) this.previews.setSource(key, stamp, source);
      this.options.log?.(`Choice preview source derived in ${((Date.now() - started) / 1000).toFixed(2)} s (${source ? `${source.parts.length} part(s)` : "nothing drawn"}).`);
      return source;
    } });
    // It waits for its lane at most `PREVIEW_DERIVE_WAIT_MS`, and not once the page went away; once it runs, it is held to its end.
    const giveUp = () => { if (want.state().phase === "waiting") this.jobs.release(requester); };
    const timer = setTimeout(giveUp, PREVIEW_DERIVE_WAIT_MS);
    signal?.addEventListener("abort", giveUp, { once: true });
    let outcome;
    try { outcome = await want.settled; }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", giveUp); }
    // Stopped for a person's change (PREV-162), or never started: the lane was taken, not a failed try; the page asks again shortly.
    if (outcome.status === "superseded") return "busy";
    if (outcome.status === "failed") {
      this.options.log?.(`A choice preview's source couldn't be derived: ${(outcome.error as Error)?.message ?? outcome.error}`);
      return undefined;
    }
    return outcome.result;
  }

  // ---- Prepared game files (prepared-files.ts) ----

  /** The prepared files' size on disk: every partition's, this process's other hosts' too. */
  async preparedFiles(): Promise<PreparedSize> { return this.prepared.size(); }
  /** Keep the prepared files within their budget (at most once a minute; never what this session used). */
  keepWithinBudget(): Promise<void> { return this.prepared.keepWithinBudget(); }
  /**
   * "Clear prepared game files": stop preparing ahead and every page's preparation, wait until no other job runs and their work let go,
   * remove every prepared file, and forget what was derived from them, so the next preparation reads the game files again. The V on screen
   * stays as it is until it is prepared again.
   */
  clearPreparedFiles(): Promise<{ freed: number }> { return this.prepared.clear(); }
  /** Clear begins: stop this host's work that writes into its prepared files. */
  private stopAll(): void {
    this.cancel();
    this.jobs.release("host/warm-up");
  }
  /** Clear removed the files: forget what was derived from them. */
  private forget(): void {
    this.shared = null;
    this.states.clear();
    this.degraded.clear();
    this.previews.forget();
    // The files are gone, so preparing ahead may fill the budget again this session (PREV-104).
    this.prefetch.resetBudget();
  }
  /** Resolves once no person's job (any page's preparation, Clear) waits or runs. */
  async settled(): Promise<void> { await this.jobs.idle("person"); }

  /** Absolute path of a served record or file, or null. Names are content-addressed, never paths. */
  filePath(name: string): string | null {
    if (!STORE_FILE.test(name)) return null;
    const path = join(this.storeRoot, name.endsWith(".json") ? "records" : "files", name);
    return existsSync(path) ? path : null;
  }
}
