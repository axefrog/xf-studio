import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "./eye-plate-recipe";
import { CharacterDetailError, CHARACTER_DETAIL_STEPS, CharacterPreparationCache, prepareCharacterDetails, STORE_FILE,
  type CharacterRoute, type PrepareCharacterOptions } from "./character-detail-service";
import { CHARACTER_DETAIL_SCHEMA } from "./render-detail";
import type { CharacterRequest } from "./character-detail-request";
import type { GameAssetExporter } from "./game-asset-export";
import { createWolvenKitGameAssetExporter } from "./game-asset-export-wolvenkit";
import { installations, type InstallationRegistry } from "./installation-registry";
import { CreatorCatalogueHost, structuralInput } from "./cc-catalogue-service";
import type { LaunchRoute } from "./local-settings";
import { routeIdentity, routeStamps } from "./route-fingerprint";
import { wolvenKitIdentity, wolvenKitIdentityKey } from "./wolvenkit-cli";

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
  log?: (message: string) => void;
};

const NEEDS_SETUP = "Your V's own skin, face details, eyes, brows, lashes, hair and piercings appear once your game folder and WolvenKit are set up.";
const PREPARING = "Preparing your V's skin, face details, eyes, brows, lashes, hair and piercings…";
const FAILED = "Something went wrong while preparing your V's skin, face details, eyes, brows, lashes, hair and piercings, so they aren't shown. The head still works.";
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
  constructor(private readonly options: CharacterDetailHostOptions) {
    this.creator = options.creator ?? new CreatorCatalogueHost({ route: () => this.route(), fingerprint: () => installationFingerprint(this.options.settings()),
      resolverCache: options.resolverCache ?? join(options.cacheRoot, "resolver"), log: options.log });
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
    const exporter = this.options.exporter?.(settings.wolvenKitCli) ??
      createWolvenKitGameAssetExporter(join(this.options.cacheRoot, "exports"), settings.wolvenKitCli);
    const first = CHARACTER_DETAIL_STEPS[0]!;
    this.set({ key, phase: "preparing", message: PREPARING, progress: { index: 0, total: CHARACTER_DETAIL_STEPS.length, label: first.label }, record: null });
    // Whether this run still owns its key's state (a newer run for the same key takes it over).
    const owns = () => !this.running || this.running.key !== key || this.running.controller === controller;
    let started = 0;
    const run = () => {
      if (controller.signal.aborted) throw new CharacterDetailError("character_cancelled", "Superseded before it started.");
      started = Date.now();
      return (this.options.prepare ?? prepareCharacterDetails)({ request, route, storeRoot: this.storeRoot, cache,
        derive: request.choices?.length ? structuralInput : undefined,
        resolverCache: this.options.resolverCache ?? join(this.options.cacheRoot, "resolver"), exporter, signal: controller.signal,
        progress: (_step, index, total, label) => {
          if (!controller.signal.aborted) this.set({ key, phase: "preparing", message: PREPARING, progress: { index, total, label }, record: null });
        }, log: this.options.log });
    };
    // Start now, or once the cancelled run (still settling on the shared cache) has stopped.
    const begun = this.running ? this.running.promise.then(run) : new Promise<Awaited<ReturnType<typeof run>>>(resolve => resolve(run()));
    const promise = begun
      .then(result => {
        this.set({ key, phase: "ready", message: result.note ?? "", progress: null, record: result.recordFile });
        if (result.degraded) this.degraded.add(key); else this.degraded.delete(key);
        this.options.log?.(`Skin, face details, eyes, brows, lashes, hair and piercings prepared in ${((Date.now() - started) / 1000).toFixed(1)} s (${request.source} V).`);
      })
      .catch(error => {
        const cancelled = error instanceof CharacterDetailError && error.code === "character_cancelled" || controller.signal.aborted;
        if (cancelled) { if (owns()) this.states.delete(key); return; }
        const message = error instanceof CharacterDetailError ? error.message : FAILED;
        this.options.log?.(`Skin, face details, eyes, brows, lashes, hair and piercings were not prepared: ${error instanceof CharacterDetailError ? `${error.code} ${error.detail}` : (error as Error)?.stack ?? error}`);
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

  cancel(): void { this.running?.controller.abort(); }
  async settled(): Promise<void> { await this.running?.promise; }

  /** Absolute path of a served record or file, or null. Names are content-addressed, never paths. */
  filePath(name: string): string | null {
    if (!STORE_FILE.test(name)) return null;
    const path = join(this.storeRoot, name.endsWith(".json") ? "records" : "files", name);
    return existsSync(path) ? path : null;
  }
}
