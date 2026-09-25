import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "./eye-plate-recipe";
import { CharacterDetailError, CHARACTER_DETAIL_STEPS, prepareCharacterDetails, STORE_FILE,
  type CharacterRoute, type PrepareCharacterOptions } from "./character-detail-service";
import type { CharacterRequest } from "./character-detail-request";
import type { GameAssetExporter } from "./game-asset-export";
import { createWolvenKitGameAssetExporter } from "./game-asset-export-wolvenkit";
import type { LaunchRoute } from "./local-settings";
import { wolvenKitIdentity, wolvenKitIdentityKey } from "./wolvenkit-cli";

/**
 * Host application service that owns one character-detail preparation at a time for the preview (both
 * hosts share it). It reads the launch route from the host's own settings (never from the browser),
 * runs `prepareCharacterDetails` in the background with cancellation, reports progress as a read-only
 * snapshot keyed by the request, and serves the content-addressed files of finished records. A newer
 * request supersedes (cancels) an older one, so switching between Vs never finishes the previous V.
 *
 * The key covers the request and the installation it is prepared from (launch route, game and mod
 * folders, MO2 profile, WolvenKit identity, and the modification stamps of the mod lists and folders),
 * so a changed profile, a newly installed mod or another WolvenKit prepares again instead of reusing an
 * answer for a different mod set. Preparations share one on-disk cache, so they run one at a time: a new
 * one starts only after a cancelled one has stopped.
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

const NEEDS_SETUP = "Your V's own skin, brows, lashes and hair appear once your game folder and WolvenKit are set up.";
const PREPARING = "Preparing your V's skin, brows, lashes and hair…";
const FAILED = "Something went wrong while preparing your V's skin, brows, lashes and hair, so they aren't shown. The head still works.";
/** Request key: the character and the installation fingerprint it is prepared from (`installationFingerprint`). */
export const characterRequestKey = (request: CharacterRequest, installation = "") =>
  createHash("sha256").update(canonicalJson(request)).update("\n" + installation).digest("hex").slice(0, 32);

const stamp = (path: string | null) => {
  if (!path) return "-";
  try { const s = statSync(path); return `${s.size}|${s.mtimeMs}`; } catch { return "missing"; }
};
/**
 * What the preparation reads besides the request: the launch route's settings, WolvenKit's identity and
 * cheap modification stamps of the places that change when mods are installed, removed or reordered
 * (the game's mod folder and load-order list, the MO2 profile's mod list and overwrite folder, and a
 * manual mod folder). Updating files inside an existing MO2 mod's folder in place is not detected; a
 * restart, or any change to the profile's mod list, prepares again.
 */
export function installationFingerprint(settings: CharacterDetailSettings): string {
  const game = settings.gameRoot, mods = game ? join(game, "archive", "pc", "mod") : null;
  const profile = settings.mo2Root && settings.mo2ProfileId ? join(settings.mo2Root, "profiles", settings.mo2ProfileId) : null;
  return canonicalJson({
    route: [settings.gameRoot, settings.launchRoute, settings.mo2Root, settings.mo2ProfileId, settings.manualModRoot, settings.wolvenKitCli],
    wolvenKit: settings.wolvenKitCli ? wolvenKitIdentityKey(wolvenKitIdentity(settings.wolvenKitCli)) : null,
    stamps: [stamp(mods), stamp(mods && join(mods, "modlist.txt")),
      stamp(profile && join(profile, "modlist.txt")), stamp(settings.mo2Root && join(settings.mo2Root, "overwrite")), stamp(settings.manualModRoot)],
  });
}

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

  /**
   * Start (or reuse) the preparation for a request. Another running request is cancelled, and its state
   * is forgotten at once; the new preparation starts once the cancelled one has stopped.
   */
  request(request: CharacterRequest): CharacterDetailState {
    const settings = this.options.settings();
    const key = characterRequestKey(request, installationFingerprint(settings));
    const known = this.states.get(key);
    const active = this.running && !this.running.controller.signal.aborted ? this.running : null;
    if (known?.phase === "ready" || (known?.phase === "preparing" && active?.key === key)) return known;
    // A different (or a stale, cancelled) preparation: stop it and forget its answer now, so a quick
    // V1 -> V2 -> V1 restarts V1 instead of reporting the cancelled run as still preparing.
    if (active) { active.controller.abort(); this.states.delete(active.key); }
    const route = this.route();
    if (!route) return this.set({ key, phase: "failed", message: NEEDS_SETUP, progress: null, record: null });
    const controller = new AbortController();
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
      return (this.options.prepare ?? prepareCharacterDetails)({ request, route, storeRoot: this.storeRoot,
        resolverCache: this.options.resolverCache ?? join(this.options.cacheRoot, "resolver"), exporter, signal: controller.signal,
        progress: (_step, index, total, label) => {
          if (!controller.signal.aborted) this.set({ key, phase: "preparing", message: PREPARING, progress: { index, total, label }, record: null });
        }, log: this.options.log });
    };
    // Start now, or once the cancelled run (still settling on the shared cache) has stopped.
    const begun = this.running ? this.running.promise.then(run) : new Promise<Awaited<ReturnType<typeof run>>>(resolve => resolve(run()));
    const promise = begun
      .then(result => {
        this.set({ key, phase: "ready", message: "", progress: null, record: result.recordFile });
        this.options.log?.(`Skin, brows, lashes and hair prepared in ${((Date.now() - started) / 1000).toFixed(1)} s (${request.source} V).`);
      })
      .catch(error => {
        const cancelled = error instanceof CharacterDetailError && error.code === "character_cancelled" || controller.signal.aborted;
        if (cancelled) { if (owns()) this.states.delete(key); return; }
        const message = error instanceof CharacterDetailError ? error.message : FAILED;
        this.options.log?.(`Skin, brows, lashes and hair were not prepared: ${error instanceof CharacterDetailError ? `${error.code} ${error.detail}` : (error as Error)?.stack ?? error}`);
        if (owns()) this.set({ key, phase: "failed", message, progress: null, record: null });
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
