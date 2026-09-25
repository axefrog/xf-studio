import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "./eye-plate-recipe";
import { CharacterDetailError, CHARACTER_DETAIL_STEPS, prepareCharacterDetails, STORE_FILE,
  type CharacterRoute, type PrepareCharacterOptions } from "./character-detail-service";
import type { CharacterRequest } from "./character-detail-request";
import type { GameAssetExporter } from "./game-asset-export";
import { createWolvenKitGameAssetExporter } from "./game-asset-export-wolvenkit";
import type { LaunchRoute } from "./local-settings";

/**
 * Host application service that owns one character-detail preparation at a time for the preview (both
 * hosts share it). It reads the launch route from the host's own settings (never from the browser),
 * runs `prepareCharacterDetails` in the background with cancellation, reports progress as a read-only
 * snapshot keyed by the request, and serves the content-addressed files of finished records. A newer
 * request supersedes (cancels) an older one, so switching between Vs never finishes the previous V.
 */
export const CHARACTER_DETAIL_STATE_SCHEMA = "xfs/character-detail-state-1" as const;
export type CharacterDetailPhase = "preparing" | "ready" | "failed" | "unknown";
export type CharacterDetailState = {
  schema: typeof CHARACTER_DETAIL_STATE_SCHEMA;
  /** Identity of the request this state answers. */
  key: string;
  phase: CharacterDetailPhase;
  /** One plain line for the person using the app. */
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
  log?: (message: string) => void;
};

const NEEDS_SETUP = "Brows, lashes and hair appear once your game folder and WolvenKit are set up.";
const FAILED = "Something went wrong while preparing brows, lashes and hair, so they aren't shown. The head still works.";
export const characterRequestKey = (request: CharacterRequest) => createHash("sha256").update(canonicalJson(request)).digest("hex").slice(0, 32);

export class CharacterDetailHost {
  private running: { key: string; controller: AbortController; promise: Promise<void> } | null = null;
  private readonly states = new Map<string, CharacterDetailState>();
  constructor(private readonly options: CharacterDetailHostOptions) {}

  private get storeRoot() { return join(this.options.cacheRoot, "characters"); }

  private route(): CharacterRoute | null {
    const settings = this.options.settings();
    if (!settings.gameRoot || !settings.wolvenKitCli || !existsSync(settings.wolvenKitCli)) return null;
    return { gameRoot: settings.gameRoot, launchRoute: settings.launchRoute, mo2Root: settings.mo2Root, mo2ProfileId: settings.mo2ProfileId,
      manualModRoot: settings.manualModRoot, wolvenKitCli: settings.wolvenKitCli };
  }

  private set(state: Omit<CharacterDetailState, "schema">): CharacterDetailState {
    const full = { schema: CHARACTER_DETAIL_STATE_SCHEMA, ...state };
    this.states.set(state.key, full);
    // Keep only the recent answers; a page polls one key at a time.
    for (const key of [...this.states.keys()].slice(0, Math.max(0, this.states.size - 8))) this.states.delete(key);
    return full;
  }

  /** Start (or reuse) the preparation for a request; a different running request is cancelled. */
  request(request: CharacterRequest): CharacterDetailState {
    const key = characterRequestKey(request);
    const known = this.states.get(key);
    if (known && (known.phase === "ready" || known.phase === "preparing")) return known;
    if (this.running && this.running.key !== key) this.running.controller.abort();
    const route = this.route();
    if (!route) return this.set({ key, phase: "failed", message: NEEDS_SETUP, progress: null, record: null });
    const controller = new AbortController();
    const settings = this.options.settings();
    const exporter = this.options.exporter?.(settings.wolvenKitCli) ??
      createWolvenKitGameAssetExporter(join(this.options.cacheRoot, "exports"), settings.wolvenKitCli);
    const first = CHARACTER_DETAIL_STEPS[0]!;
    this.set({ key, phase: "preparing", message: "Preparing brows, lashes and hair…", progress: { index: 0, total: CHARACTER_DETAIL_STEPS.length, label: first.label }, record: null });
    const started = Date.now();
    const promise = (this.options.prepare ?? prepareCharacterDetails)({ request, route, storeRoot: this.storeRoot,
      resolverCache: this.options.resolverCache ?? join(this.options.cacheRoot, "resolver"), exporter, signal: controller.signal,
      progress: (_step, index, total, label) => {
        if (!controller.signal.aborted) this.set({ key, phase: "preparing", message: "Preparing brows, lashes and hair…", progress: { index, total, label }, record: null });
      }, log: this.options.log })
      .then(result => {
        this.set({ key, phase: "ready", message: "", progress: null, record: result.recordFile });
        this.options.log?.(`Brows, lashes and hair prepared in ${((Date.now() - started) / 1000).toFixed(1)} s (${request.source} V).`);
      })
      .catch(error => {
        const cancelled = error instanceof CharacterDetailError && error.code === "character_cancelled" || controller.signal.aborted;
        if (cancelled) { this.states.delete(key); return; }
        const message = error instanceof CharacterDetailError ? error.message : FAILED;
        this.options.log?.(`Brows, lashes and hair were not prepared: ${error instanceof CharacterDetailError ? `${error.code} ${error.detail}` : (error as Error)?.stack ?? error}`);
        this.set({ key, phase: "failed", message, progress: null, record: null });
      })
      .finally(() => { if (this.running?.controller === controller) this.running = null; });
    this.running = { key, controller, promise };
    return this.states.get(key)!;
  }

  /** The state for a request key; `unknown` when this host has not seen it (the page asks again). */
  state(key: string): CharacterDetailState {
    return this.states.get(key) ?? { schema: CHARACTER_DETAIL_STATE_SCHEMA, key, phase: "unknown", message: "", progress: null, record: null };
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
