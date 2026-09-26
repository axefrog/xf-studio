import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { PREVIEW_CORE_FILES } from "./preview-core-recipe";
import { ensurePreviewCore, PREVIEW_CORE_STEPS, PreviewCoreCache, PreviewCoreError, previewCoreReadiness } from "./preview-core-service";
import type { GameAssetExporter } from "./game-asset-export";
import { createWolvenKitGameAssetExporter } from "./game-asset-export-wolvenkit";
import { hostFailure } from "./diagnostics/host-log";

/**
 * Host application service that owns one derivation of the 3D preview at a time: it reads
 * the host's own settings (never browser-supplied paths), runs `ensurePreviewCore` in the
 * background with cancellation, reports progress as a read-only snapshot, and serves the
 * finished files. Localhost and the desktop app share it.
 */
export const PREVIEW_CORE_STATE_SCHEMA = "xfs/preview-core-state-1" as const;
export type PreviewCorePhase = "ready" | "idle" | "needs-setup" | "preparing" | "failed" | "blocked";
export type PreviewCoreSetupNeed = "game" | "wolvenkit";
export type PreviewCoreState = {
  schema: typeof PREVIEW_CORE_STATE_SCHEMA;
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
  settings: () => PreviewCoreHostSettings;
  /** Game asset exporter for a WolvenKit CLI path; defaults to WolvenKit with a cache under `cacheRoot/exports`. */
  exporter?: (cli: string | null) => GameAssetExporter;
  log?: (message: string) => void;
  now?: () => number;
};

const MESSAGES = {
  ready: "The 3D preview is ready.",
  idle: "XF Studio can build the 3D head preview from your own Cyberpunk 2077 files. It takes about a minute or less and changes nothing in your game.",
  game: "Choose your Cyberpunk 2077 game folder so XF Studio can build the 3D head preview from your own game files.",
  wolvenkit: "XF Studio needs WolvenKit to read your game files, and it isn't ready yet. XF Studio can download it for you. The UV editor, library and Check keep working without it.",
  cancelled: "Preparing the 3D preview was cancelled. You can start it again at any time.",
} as const;

const isFile = (path: string | null) => { try { return !!path && existsSync(path) && statSync(path).isFile(); } catch { return false; } };
const isGame = (path: string | null) => { try { return !!path && existsSync(join(path, "archive", "pc", "content")); } catch { return false; } };

export class PreviewCoreHost {
  private running: { controller: AbortController; promise: Promise<void> } | null = null;
  private progress: PreviewCoreState["progress"] = null;
  private lastFailure: { code: string; message: string; gameRoot: string | null } | null = null;
  private lastDurationSeconds: number | null = null;
  private readinessMemo: { key: string; value: ReturnType<typeof previewCoreReadiness>; at: number } | null = null;
  constructor(private readonly options: PreviewCoreHostOptions) {}

  private readiness(gameRoot: string | null) {
    const now = (this.options.now ?? Date.now)();
    const key = `${gameRoot}`;
    // Verifying the cache hashes ~20 MB; a short memo keeps asset requests cheap.
    if (this.readinessMemo && this.readinessMemo.key === key && now - this.readinessMemo.at < 5_000) return this.readinessMemo.value;
    const value = previewCoreReadiness(this.options.cacheRoot, gameRoot);
    this.readinessMemo = { key, value, at: now };
    return value;
  }
  private forget() { this.readinessMemo = null; }

  snapshot(): PreviewCoreState {
    const settings = this.options.settings();
    const base = { schema: PREVIEW_CORE_STATE_SCHEMA, lastDurationSeconds: this.lastDurationSeconds } as const;
    if (this.running) return { ...base, phase: "preparing", code: null, needs: [], canPrepare: false, canCancel: true,
      message: "Preparing the 3D preview from your Cyberpunk 2077 files…", progress: this.progress };
    const needs: PreviewCoreSetupNeed[] = [];
    if (!isGame(settings.gameRoot)) needs.push("game");
    const readiness = needs.length ? { state: "none" as const } : this.readiness(settings.gameRoot);
    if (readiness.state === "ready") return { ...base, phase: "ready", message: MESSAGES.ready, code: null, needs: [], progress: null, canPrepare: false, canCancel: false };
    if (!isFile(settings.wolvenKitCli)) needs.push("wolvenkit");
    if (needs.length) return { ...base, phase: "needs-setup", code: needs.includes("game") ? "preview_game_missing" : "preview_tool_missing",
      message: needs.includes("game") ? MESSAGES.game : MESSAGES.wolvenkit, needs, progress: null, canPrepare: false, canCancel: false };
    if (readiness.state === "blocked") return { ...base, phase: "blocked", message: readiness.message, code: readiness.code, needs: [], progress: null,
      canPrepare: true, canCancel: false };
    if (this.lastFailure && this.lastFailure.gameRoot === settings.gameRoot)
      return { ...base, phase: "failed", message: this.lastFailure.message, code: this.lastFailure.code, needs: [], progress: null, canPrepare: true, canCancel: false };
    return { ...base, phase: "idle", message: MESSAGES.idle, code: null, needs: [], progress: null, canPrepare: true, canCancel: false };
  }

  /** Start preparing in the background; returns the snapshot. Refused (unchanged snapshot) unless `canPrepare`. */
  prepare(): PreviewCoreState {
    const state = this.snapshot();
    if (!state.canPrepare) return state;
    const settings = this.options.settings();
    const controller = new AbortController();
    const started = (this.options.now ?? Date.now)();
    const exporter = this.options.exporter?.(settings.wolvenKitCli) ??
      createWolvenKitGameAssetExporter(join(this.options.cacheRoot, "exports"), settings.wolvenKitCli);
    this.progress = { index: 0, total: PREVIEW_CORE_STEPS.length, label: PREVIEW_CORE_STEPS[0]!.label };
    this.lastFailure = null;
    const promise = ensurePreviewCore({ gameRoot: settings.gameRoot!, cacheRoot: this.options.cacheRoot, exporter, signal: controller.signal,
      progress: (_step, index, total, label) => { this.progress = { index, total, label }; } })
      .then(result => {
        this.lastDurationSeconds = Math.round(((this.options.now ?? Date.now)() - started) / 100) / 10;
        this.options.log?.(`3D preview ${result.reused ? "reused" : "prepared"} in ${this.lastDurationSeconds}s (${result.manifest.source.label}).`);
      })
      .catch(error => {
        const code = error instanceof PreviewCoreError ? error.code : "preview_tool_failed";
        const message = code === "preview_cancelled" ? MESSAGES.cancelled : (error as Error).message;
        this.lastFailure = { code, message, gameRoot: settings.gameRoot };
        this.options.log?.(`3D preview preparation stopped: ${code}. ${(error as PreviewCoreError).detail ?? ""}`.trim());
        if (code !== "preview_cancelled") hostFailure("preview", code, message, error);
      })
      .finally(() => { this.running = null; this.progress = null; this.forget(); });
    this.running = { controller, promise };
    return this.snapshot();
  }

  /**
   * Prepare again from the game files: the renderer reports the prepared files are damaged (they
   * would not load). The ready entry is set aside first so nothing of it is reused; a running
   * preparation or missing setup leaves everything unchanged.
   */
  rebuild(): PreviewCoreState {
    if (this.running) return this.snapshot();
    const settings = this.options.settings();
    if (isGame(settings.gameRoot) && isFile(settings.wolvenKitCli)) {
      this.forget();
      const readiness = previewCoreReadiness(this.options.cacheRoot, settings.gameRoot);
      if (readiness.state === "ready") {
        try { new PreviewCoreCache(this.options.cacheRoot).remove(dirname(readiness.directory)); }
        catch (error) { this.options.log?.(`The damaged 3D preview could not be removed: ${(error as Error).message}`); }
      }
      this.forget();
    }
    return this.prepare();
  }

  cancel(): PreviewCoreState {
    this.running?.controller.abort();
    return this.snapshot();
  }

  /** Wait for a running preparation (tests and shutdown). */
  async settled(): Promise<void> { await this.running?.promise; }

  /** Absolute path of one derived core file when the preview is ready, else null. */
  assetPath(name: string): string | null {
    if (!(PREVIEW_CORE_FILES as readonly string[]).includes(name) || this.running) return null;
    const settings = this.options.settings();
    if (!isGame(settings.gameRoot)) return null;
    const readiness = this.readiness(settings.gameRoot);
    return readiness.state === "ready" ? join(readiness.directory, name) : null;
  }
  ready(): boolean { return this.snapshot().phase === "ready"; }
}
