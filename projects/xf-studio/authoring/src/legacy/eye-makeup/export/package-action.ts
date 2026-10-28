import type { EyePlateHeadRecord } from "../plate/eye-plate-head-source";
import type { ExportRoute } from "../../../engines/layered-makeup/finish-export";
import type { PresetDiagnostics } from "./export-diagnostics";
import { PACKAGE_BUILD_STAGES, refusalOmissions, type ExportOmission, type PackageBuildStatus, type PackageBuildProgress, type PackageBuildResult, type PackageCheckResult } from "../../../platform/api";

export type PackageAction = "check" | "build";
/**
 * A packaged eye-makeup preset's stable identity and its export route (results from before routes were recorded lack `route`).
 * `diagnostics` appears only on a prepared test candidate's presets that carry diagnostic knobs (export-diagnostics.ts).
 */
export type PackagePresetIdentity = { id: string; revision: number; appearance: string; route?: ExportRoute; diagnostics?: PresetDiagnostics };
/**
 * Which eye plate was packaged: the built-in plate derived from the installed game (with the head resources it
 * was cut from: base game, installed mods or the base-game escape hatch), or a developer override. Eye makeup's
 * feature report records it in its `details.plate`.
 */
export type PackagePlate = { source: "derived"; recipeId: string; recipeRevision: number; sourceRevision: string; cacheKey: string;
  meshSha256: string; morphSha256: string; head?: EyePlateHeadRecord } | { source: "override"; meshSha256: string; morphSha256: string };

export class PackageRequestError extends Error {
  constructor(readonly code: string, message: string, readonly omissions?: readonly ExportOmission[]) { super(message); }
}

/** The running Build's stage, as the host reports it (PIPE-131), or null when none runs or the answer isn't one. */
export async function requestPackageProgress(signal?: AbortSignal): Promise<PackageBuildProgress | null> {
  const response = await packageRequest("/api/package/progress", { cache: "no-store", signal });
  if (!response.ok || !(response.headers.get("Content-Type") ?? "").includes("application/json")) return null;
  const build = (await response.json() as { build?: Partial<PackageBuildProgress> | null }).build;
  return build && (PACKAGE_BUILD_STAGES as readonly unknown[]).includes(build.stage) && Number.isInteger(build.step) && Number.isInteger(build.steps)
    ? { stage: build.stage!, step: build.step!, steps: build.steps!, ...Number.isInteger(build.looks) ? { looks: build.looks! } : {} } : null;
}

/**
 * The progress line for a Build's stage: which step of how many, and what it is doing, in plain words. Each fits the Mod
 * package panel's one line at its narrowest (about 37 characters beside the buttons of a wide panel) for up to 99 looks.
 */
export function packageBuildStageLine(progress: PackageBuildProgress, subject: "looks" | "expressions" = "looks"): string {
  const looks = progress.looks === undefined ? `the ${subject}` : `${progress.looks} ${progress.looks === 1 ? subject.slice(0, -1) : subject}`;
  const doing: Record<PackageBuildProgress["stage"], string> = {
    prepare: "Reading your game files…",
    compose: `${subject === "expressions" ? "Making" : "Painting"} ${looks}…`,
    convert: `Converting ${looks}…`,
    pack: "Packing the mod files…",
    verify: "Checking the mod files…",
  };
  return `Step ${progress.step} of ${progress.steps}: ${doing[progress.stage]}`;
}

/**
 * Presentation-independent request contract: the collection's stored form (with its package plan); the server
 * decides every filesystem and tool path, and answers every product the collection builds.
 */
/** The package routes' one network read. */
const packageRequest = (path: string, init: RequestInit) => fetch(path, init);

export async function requestPackage(action: PackageAction, collection: unknown, signal?: AbortSignal): Promise<PackageCheckResult | PackageBuildResult> {
  if (action === "build") return requestIdentifiedBuild(collection, signal);
  const response = await packageRequest("/api/package", { method: "POST", headers: { "Content-Type": "application/json" },
    signal, body: JSON.stringify({ action, collection }) });
  if (!(response.headers.get("Content-Type") ?? "").includes("application/json"))
    throw new PackageRequestError("transport", "Restart XF Studio to build mod files.");
  const result = await response.json();
  if (!response.ok) throw new PackageRequestError(result.code ?? "package_failed", result.error ?? "Package request failed.");
  return result;
}

/** Build cancellation is a host command, not a fetch abort. The host's retained receipt is the only terminal authority. */
export function requestIdentifiedBuild(collection: unknown, signal?: AbortSignal, device: {
  send?: (path: string, init: RequestInit) => Promise<Response>; id?: () => string; pause?: () => Promise<void>;
  onProgress?: (progress: PackageBuildProgress) => void;
} = {}): Promise<PackageBuildResult> {
  const send = device.send ?? packageRequest, id = (device.id ?? (() => crypto.randomUUID()))();
  let finished = false, starting = false, stopInFlight = false, stopping = signal?.aborted ?? false;
  let timer: ReturnType<typeof setTimeout> | undefined, wake: (() => void) | undefined;
  const pause = device.pause ?? (() => new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 500); }));
  return new Promise<PackageBuildResult>((resolve, reject) => {
    const finish = (outcome: Extract<PackageBuildStatus, { phase: "finished" }>["outcome"]) => {
      if (finished) return;
      finished = true; signal?.removeEventListener("abort", stop);
      clearTimeout(timer); wake?.();
      if (outcome.ok) resolve(outcome.result);
      else reject(new PackageRequestError(outcome.code, outcome.message, refusalOmissions(outcome.omissions)));
    };
    const observe = (status: PackageBuildStatus | undefined) => {
      if (status?.phase === "finished") finish(status.outcome);
    };
    const post = (body: unknown) => send("/api/package", { method: "POST", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const askStop = async () => {
      if (finished || stopInFlight) return;
      stopInFlight = true;
      try { const response = await post({ action: "stop", buildId: id }); if (response.ok) observe(await response.json()); }
      catch { /* The next status read retries the same idempotent Stop. */ }
      finally { stopInFlight = false; }
    };
    const stop = () => { stopping = true; void askStop(); };
    const start = async () => {
      starting = true;
      try {
        const response = await post({ action: "build", buildId: id, collection });
        const body = await response.json();
        if (response.ok) finish({ ok: true, result: body });
        else if (typeof body.code === "string") finish({ ok: false, code: body.code,
          message: body.error ?? "Package request failed.", status: response.status, omissions: refusalOmissions(body.omissions) });
      } catch { /* Keep busy and reconcile a lost POST or response through the retained Build ID. */ }
      finally { starting = false; }
    };
    signal?.addEventListener("abort", stop, { once: true });
    if (stopping) void askStop(); else void start();
    void (async () => {
      while (!finished) {
        await pause();
        if (finished) break;
        if (stopping) void askStop();
        try {
          const response = await send(`/api/package/progress?buildId=${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
          if (!response.ok) continue;
          const { status, build } = await response.json() as { status?: PackageBuildStatus; build?: PackageBuildProgress | null };
          observe(status);
          if (!finished && !stopping && status?.phase === "running" && build &&
              (PACKAGE_BUILD_STAGES as readonly unknown[]).includes(build.stage) && Number.isInteger(build.step) &&
              build.steps === PACKAGE_BUILD_STAGES.length && build.step === PACKAGE_BUILD_STAGES.indexOf(build.stage) + 1)
            device.onProgress?.(build);
          // If the original POST never arrived, sending it with the same ID is safe. A retained terminal is never rebuilt.
          if (!finished && status?.phase === "unknown" && !starting && !stopping) void start();
        } catch { /* Offline: no terminal claim and no new Build until the host answers. */ }
      }
    })();
  });
}
