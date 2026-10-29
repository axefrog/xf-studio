import { registeredPreviewPreparation } from "../preview-capabilities";
import type { Registry, AnyOwner } from "../../platform/core/registry";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseCoreAssetName, PREVIEW_CORE_RECIPES, type CoreBody } from "../preview-core-recipe";
import { ensurePreviewCore, PREVIEW_CORE_STEPS, PreviewCoreCache, PreviewCoreError, previewCoreReadiness, previewCoreReadinessAsync, previewCoreGenerationCurrent } from "./preview-core-service";
import type { GameAssetExporter } from "../../game/host/game-asset-export";
import { createWolvenKitGameAssetExporter } from "../../game/host/game-asset-export-wolvenkit";
import { hostFailure } from "../../diagnostics/host/host-log";

/**
 * Host application service that owns one derivation of the 3D preview at a time: it reads
 * the host's own settings (never browser-supplied paths), runs `ensurePreviewCore` in the
 * background with cancellation, reports progress as a read-only snapshot, and serves the
 * finished files. Localhost and the desktop app share it.
 *
 * Each body has its own core (the feminine V's head, and the masculine V's with his own plate cut), prepared separately:
 * the feminine one when the preview is first set up, the masculine one when a masculine V is first shown. One preparation
 * runs at a time; each body's state is its own snapshot (`snapshot(body)`), the feminine one by default.
 */
export const PREVIEW_CORE_STATE_SCHEMA = "xfs/preview-core-state-1" as const;
export type PreviewCorePhase = "ready" | "idle" | "needs-setup" | "preparing" | "failed" | "blocked";
export type PreviewCoreSetupNeed = "game" | "wolvenkit";
export type PreviewCoreState = {
  schema: typeof PREVIEW_CORE_STATE_SCHEMA;
  /** Whose core this state describes. */
  body: CoreBody;
  phase: PreviewCorePhase;
  /** Plain-language status for the person using the app. */
  message: string;
  code: string | null;
  needs: PreviewCoreSetupNeed[];
  progress: { index: number; total: number; label: string } | null;
  /** Seconds the last completed preparation took, when one finished in this session. */
  lastDurationSeconds: number | null;
  canPrepare: boolean;
  canCancel: boolean;
};
export type PreviewCoreHostSettings = { gameRoot: string | null; wolvenKitCli: string | null };
export type PreviewCoreHostOptions = {
  cacheRoot: string;
  registry?: Pick<Registry<AnyOwner>, "owners">;
  settings: () => PreviewCoreHostSettings;
  /** Game asset exporter for a WolvenKit CLI path; defaults to WolvenKit with a cache under `cacheRoot/exports`. */
  exporter?: (cli: string | null) => GameAssetExporter;
  log?: (message: string) => void;
  now?: () => number;
};

const MESSAGES = {
  ready: "The 3D view is ready.",
  idle: "XF Studio can build the 3D view from your own Cyberpunk 2077 files. It takes about a minute or less and changes nothing in your game.",
  game: "Choose your Cyberpunk 2077 game folder so XF Studio can build the 3D view from your own game files.",
  wolvenkit: "XF Studio needs WolvenKit to read your game files, and it isn't ready yet. XF Studio can download it for you. The UV editor, library and Check keep working without it.",
  cancelled: "Preparing the 3D view was cancelled. You can start it again at any time.",
  male: "XF Studio can build the masculine V's head from your own Cyberpunk 2077 files. It takes about a minute or less and changes nothing in your game.",
  preparingMale: "Preparing the masculine V's head from your Cyberpunk 2077 files…",
  busy: "XF Studio is preparing another head from your game files. This one can start when it has finished.",
} as const;

const isFile = (path: string | null) => { try { return !!path && existsSync(path) && statSync(path).isFile(); } catch { return false; } };
const isGame = (path: string | null) => { try { return !!path && existsSync(join(path, "archive", "pc", "content")); } catch { return false; } };

export class PreviewCoreHost {
  private running: { controller: AbortController; promise: Promise<void>; body: CoreBody } | null = null;
  private progress: PreviewCoreState["progress"] = null;
  private lastFailure: Partial<Record<CoreBody, { code: string; message: string; gameRoot: string | null }>> = {};
  private lastDurationSeconds: number | null = null;
  private readinessMemo = new Map<CoreBody, { key: string; value: ReturnType<typeof previewCoreReadiness>; at: number }>();
  private checks = new Map<CoreBody, { key: string; promise: Promise<void>; life: AbortController; wants: number }>();
  constructor(private readonly options: PreviewCoreHostOptions) {}

  private fresh(memo: { key: string; value: ReturnType<typeof previewCoreReadiness>; at: number } | undefined, key: string) {
    return memo?.key === key && (this.options.now ?? Date.now)() - memo.at < 5_000 &&
      (memo.value.state !== "ready" || previewCoreGenerationCurrent(memo.value.generation));
  }

  private readiness(gameRoot: string | null, body: CoreBody) {
    const now = (this.options.now ?? Date.now)();
    const key = `${gameRoot}`, memo = this.readinessMemo.get(body);
    // Verifying the cache hashes ~20 MB; a short memo keeps asset requests cheap.
    if (this.fresh(memo, key)) return memo!.value;
    const { recipe } = PREVIEW_CORE_RECIPES[body];
    const plate = registeredPreviewPreparation(this.options.registry, body);
    const value = previewCoreReadiness(this.options.cacheRoot, gameRoot, recipe, plate);
    this.readinessMemo.set(body, { key, value, at: now });
    return value;
  }
  private forget() {
    this.readinessMemo.clear();
    for (const check of this.checks.values()) check.life.abort();
    this.checks.clear();
  }

  /** Shared HTTP validation; an obsolete completion cannot publish after a rebuild/settings change. */
  async readSnapshot(body: CoreBody = "female", signal?: AbortSignal): Promise<PreviewCoreState> {
    signal?.throwIfAborted();
    const settings = this.options.settings(), key = `${settings.gameRoot}`, memo = this.readinessMemo.get(body);
    if (this.running?.body !== body && isGame(settings.gameRoot) && !this.fresh(memo, key)) {
      let check = this.checks.get(body);
      if (!check || check.key !== key) {
        const { recipe } = PREVIEW_CORE_RECIPES[body], plate = registeredPreviewPreparation(this.options.registry, body);
        const made = { key, promise: Promise.resolve(), life: new AbortController(), wants: 0 };
        made.promise = previewCoreReadinessAsync(this.options.cacheRoot, settings.gameRoot, recipe, plate, made.life.signal).then(value => {
          if (this.checks.get(body) === made && `${this.options.settings().gameRoot}` === key)
            this.readinessMemo.set(body, { key, value: value.state === "ready" && !previewCoreGenerationCurrent(value.generation)
              ? { state: "none" } : value, at: (this.options.now ?? Date.now)() });
        }).finally(() => { if (this.checks.get(body) === made) this.checks.delete(body); });
        this.checks.set(body, made); check = made;
      }
      const owned = check;
      owned.wants++;
      try {
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(signal!.reason);
          if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
          owned.promise.then(() => { signal?.removeEventListener("abort", abort); signal?.aborted ? reject(signal.reason) : resolve(); },
            error => { signal?.removeEventListener("abort", abort); reject(error); });
        });
      } finally {
        if (--owned.wants === 0) {
          if (this.checks.get(body) === owned) this.checks.delete(body);
          owned.life.abort();
        }
      }
    }
    return this.snapshot(body);
  }

  snapshot(body: CoreBody = "female"): PreviewCoreState {
    const settings = this.options.settings();
    const base = { schema: PREVIEW_CORE_STATE_SCHEMA, body, lastDurationSeconds: this.lastDurationSeconds } as const;
    if (this.running?.body === body) return { ...base, phase: "preparing", code: null, needs: [], canPrepare: false, canCancel: true,
      message: body === "male" ? MESSAGES.preparingMale : "Preparing the 3D view from your Cyberpunk 2077 files…", progress: this.progress };
    const state = this.restingSnapshot(settings, base, body);
    // Another body's preparation is running: this one waits for it.
    return this.running && state.canPrepare ? { ...state, canPrepare: false, message: state.phase === "idle" ? MESSAGES.busy : state.message } : state;
  }

  private restingSnapshot(settings: PreviewCoreHostSettings, base: Pick<PreviewCoreState, "schema" | "body" | "lastDurationSeconds">,
    body: CoreBody): PreviewCoreState {
    const needs: PreviewCoreSetupNeed[] = [];
    if (!isGame(settings.gameRoot)) needs.push("game");
    const readiness = needs.length ? { state: "none" as const } : this.readiness(settings.gameRoot, body);
    if (readiness.state === "ready") return { ...base, phase: "ready", message: MESSAGES.ready, code: null, needs: [], progress: null, canPrepare: false, canCancel: false };
    if (!isFile(settings.wolvenKitCli)) needs.push("wolvenkit");
    if (needs.length) return { ...base, phase: "needs-setup", code: needs.includes("game") ? "preview_game_missing" : "preview_tool_missing",
      message: needs.includes("game") ? MESSAGES.game : MESSAGES.wolvenkit, needs, progress: null, canPrepare: false, canCancel: false };
    if (readiness.state === "blocked") return { ...base, phase: "blocked", message: readiness.message, code: readiness.code, needs: [], progress: null,
      canPrepare: true, canCancel: false };
    const failure = this.lastFailure[body];
    if (failure && failure.gameRoot === settings.gameRoot)
      return { ...base, phase: "failed", message: failure.message, code: failure.code, needs: [], progress: null, canPrepare: true, canCancel: false };
    return { ...base, phase: "idle", message: body === "male" ? MESSAGES.male : MESSAGES.idle, code: null, needs: [], progress: null,
      canPrepare: true, canCancel: false };
  }

  /**
   * Start preparing in the background; returns the snapshot. Refused (unchanged snapshot) unless `canPrepare`. One job at a time: a page
   * asking for the body already being prepared joins it (its snapshot says so). Once started, a job runs to completion unless Cancel stops
   * it: its result is cached and reused, and a page that no longer wants it only stops waiting (experiment 043 decision D1).
   */
  prepare(body: CoreBody = "female"): PreviewCoreState {
    const state = this.snapshot(body);
    if (!state.canPrepare) return state;
    const settings = this.options.settings();
    const controller = new AbortController();
    const started = (this.options.now ?? Date.now)();
    const exporter = this.options.exporter?.(settings.wolvenKitCli) ??
      createWolvenKitGameAssetExporter(join(this.options.cacheRoot, "exports"), settings.wolvenKitCli);
    this.progress = { index: 0, total: PREVIEW_CORE_STEPS.length, label: PREVIEW_CORE_STEPS[0]!.label };
    delete this.lastFailure[body];
    const promise = ensurePreviewCore({ gameRoot: settings.gameRoot!, cacheRoot: this.options.cacheRoot, exporter, signal: controller.signal, body, plateRecipe: registeredPreviewPreparation(this.options.registry, body),
      progress: (_step, index, total, label) => { this.progress = { index, total, label }; } })
      .then(result => {
        this.lastDurationSeconds = Math.round(((this.options.now ?? Date.now)() - started) / 100) / 10;
        this.options.log?.(`3D preview ${result.reused ? "reused" : "prepared"} in ${this.lastDurationSeconds}s (${result.manifest.source.label}).`);
      })
      .catch(error => {
        const code = error instanceof PreviewCoreError ? error.code : "preview_tool_failed";
        const message = code === "preview_cancelled" ? MESSAGES.cancelled : (error as Error).message;
        this.lastFailure[body] = { code, message, gameRoot: settings.gameRoot };
        this.options.log?.(`3D preview preparation stopped: ${code}. ${(error as PreviewCoreError).detail ?? ""}`.trim());
        if (code !== "preview_cancelled") hostFailure("preview", code, message, error);
      })
      .finally(() => { this.running = null; this.progress = null; this.forget(); });
    this.running = { controller, promise, body };
    return this.snapshot(body);
  }

  /**
   * Prepare again from the game files: the renderer reports the prepared files are damaged (they
   * would not load). The ready entry is set aside first so nothing of it is reused; a running
   * preparation or missing setup leaves everything unchanged.
   */
  rebuild(body: CoreBody = "female"): PreviewCoreState {
    if (this.running) return this.snapshot(body);
    const settings = this.options.settings();
    if (isGame(settings.gameRoot) && isFile(settings.wolvenKitCli)) {
      this.forget();
      const { recipe } = PREVIEW_CORE_RECIPES[body];
      const plate = registeredPreviewPreparation(this.options.registry, body);
      const readiness = previewCoreReadiness(this.options.cacheRoot, settings.gameRoot, recipe, plate);
      if (readiness.state === "ready") {
        try { new PreviewCoreCache(this.options.cacheRoot, recipe, !!plate).remove(dirname(readiness.directory)); }
        catch (error) { this.options.log?.(`The damaged 3D preview could not be removed: ${(error as Error).message}`); }
      }
      this.forget();
    }
    return this.prepare(body);
  }

  /** Cancel that body's running preparation (any running one without a body, e.g. at shutdown). */
  cancel(body?: CoreBody): PreviewCoreState {
    if (!body || this.running?.body === body) this.running?.controller.abort();
    return this.snapshot(body);
  }

  /** Wait for a running preparation (tests and shutdown). */
  async settled(): Promise<void> { await this.running?.promise; }

  /**
   * Absolute path of one derived core file when that body's core is ready, else null. Served names are the body's prefix and
   * the file (`head.glb` for the feminine core, `pma/head.glb` for the masculine one; `coreAssetName`).
   */
  assetPath(name: string): string | null {
    const asset = parseCoreAssetName(name);
    if (!asset || this.running?.body === asset.body) return null;
    const settings = this.options.settings();
    if (!isGame(settings.gameRoot)) return null;
    const readiness = this.readiness(settings.gameRoot, asset.body);
    return readiness.state === "ready" ? join(readiness.directory, asset.file) : null;
  }
  /** A validated derived asset and its content identity, for conditional HTTP reads. No asset bytes are retained by the host. */
  async asset(name: string, signal?: AbortSignal): Promise<{ path: string; etag: string; current(): boolean } | null> {
    const asset = parseCoreAssetName(name);
    if (!asset || (await this.readSnapshot(asset.body, signal)).phase !== "ready") return null;
    const readiness = this.readinessMemo.get(asset.body)?.value, gameRoot = this.options.settings().gameRoot;
    const file = readiness?.state === "ready" ? readiness.manifest.files.find(file => file.name === asset.file) : undefined;
    return readiness?.state === "ready" && file ? { path: join(readiness.directory, asset.file), etag: `"${file.sha256}"`,
      current: () => this.running?.body !== asset.body && this.options.settings().gameRoot === gameRoot && previewCoreGenerationCurrent(readiness.generation) } : null;
  }
  ready(body: CoreBody = "female"): boolean { return this.snapshot(body).phase === "ready"; }
}
