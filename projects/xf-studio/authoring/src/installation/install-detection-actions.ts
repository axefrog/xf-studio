/** Read-only application actions that find Cyberpunk 2077 installs and MO2 instances on this host,
 * and check the installed frameworks the eye-makeup mod depends on. They never change settings, files
 * or mod lists: a setup view can offer "We found Cyberpunk 2077 at … [Use this]" and then save the
 * chosen path through the separate local setup actions, or show framework update guidance. */
import type { FrameworkVersionCheck } from "./framework-versions";
import type { GameInstallDetection, Mo2Detection } from "./install-detection";
import { frameworkInputKey, type FrameworkInputFields } from "./framework-check-watch";
import { DETECTION_DESCRIPTORS } from "../app/studio-action-descriptors";

export type InstallDetectionAction = { kind: "detect.gameInstalls" } | { kind: "detect.mo2Instances" } |
  { kind: "detect.frameworkVersions" };
export type InstallDetectionTarget = "games" | "mo2" | "frameworks";
export type InstallDetectionState = {
  busy: InstallDetectionTarget | null;
  games?: GameInstallDetection;
  mo2?: Mo2Detection;
  /** Frameworks for the configured game folder and MO2 profile (host-owned settings, never browser paths). */
  frameworks?: FrameworkVersionCheck;
  /** Input identity captured when the successful request started; unrelated detection never changes it. */
  frameworksInputKey?: string;
  frameworkAttempt?: { inputKey?: string; pending: boolean; error?: string };
  discoveryComplete?: boolean;
  error?: string;
};
export type InstallDetectionOutcome = { ok: true } | { ok: false; code: string; message: string };
export type InstallDetectionTransport = (target: InstallDetectionTarget, signal?: AbortSignal) => Promise<{
  ok: boolean; status: number; data: GameInstallDetection | Mo2Detection | FrameworkVersionCheck | { code: string; error: string };
}>;

/**
 * Detection issues that tell the person what to do when no usable game folder was found, most useful
 * first. The Xbox app copy's own message sits between an unfinished install (about to become usable) and
 * text the registry check couldn't read (choose the folder manually).
 */
const ACTIONABLE_GAME_ISSUES = ["install_incomplete", "store_unsupported", "registry_text_unreadable"] as const;

/** The one plain note for a setup card when detection offered no game folder (PREV-33); null when one was found. */
export function gameDetectionNote(games: Pick<GameInstallDetection, "candidates" | "unsupported" | "issues"> | undefined): string | null {
  if (!games || games.candidates.length) return null;
  for (const code of ACTIONABLE_GAME_ISSUES) {
    if (code === "store_unsupported" && games.unsupported?.[0]) return games.unsupported[0].message;
    const issue = games.issues?.find(item => item.code === code);
    if (issue) return issue.detail;
  }
  return null;
}

const targets = { "detect.gameInstalls": "games", "detect.mo2Instances": "mo2",
  "detect.frameworkVersions": "frameworks" } as const satisfies Record<InstallDetectionAction["kind"], InstallDetectionTarget>;
const targetOf = (action: InstallDetectionAction): InstallDetectionTarget => targets[action.kind];
const schemaOf = { games: "xfs/game-install-detection-1", mo2: "xfs/mo2-instance-detection-1",
  frameworks: "xfs/framework-version-check-1" } as const;

const cancelled = (): InstallDetectionOutcome => ({ ok: false, code: "cancelled", message: "Discovery cancelled." });

/** Await a queued request without keeping an aborted requester attached to it. */
function withCancellation<T>(job: Promise<T>, signal: AbortSignal | undefined, aborted: () => T): Promise<T> {
  if (!signal) return job;
  if (signal.aborted) return Promise.resolve(aborted());
  return new Promise((resolve, reject) => {
    const stop = () => { signal.removeEventListener("abort", abort); };
    const abort = () => { stop(); resolve(aborted()); };
    signal.addEventListener("abort", abort, { once: true });
    job.then(value => { stop(); resolve(value); }, error => { stop(); reject(error); });
  });
}

export class InstallDetectionActions {
  private state: InstallDetectionState = { busy: null };
  private listeners = new Set<() => void>();
  private discoveryTail: Promise<unknown> = Promise.resolve();
  constructor(private transport: InstallDetectionTransport | null, private frameworkInputs?: () => FrameworkInputFields | undefined) {}
  descriptors() { return structuredClone(DETECTION_DESCRIPTORS); }
  snapshot(): Readonly<InstallDetectionState> { return structuredClone(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(state: InstallDetectionState) { this.state = state; for (const listener of this.listeners) listener(); }
  capability(action: InstallDetectionAction): { available: boolean; reason?: string } {
    if (!(action?.kind in DETECTION_DESCRIPTORS)) return { available: false, reason: "Unknown detection action." };
    if (!this.transport) return { available: false, reason: "Looking for your game isn't available here." };
    if (this.state.busy) return { available: false, reason: "Detection is already running." };
    return { available: true };
  }

  /** One owner queues discovery behind any check, and remembers completion only after both reads succeeded.
   * Cancelling a queued caller removes its interest immediately; cancelling a running read reaches the device via AbortSignal.
   */
  discover(options: { signal?: AbortSignal; force?: boolean } = {}): Promise<InstallDetectionOutcome> {
    const { signal, force } = options;
    const job = this.discoveryTail.then(async (): Promise<InstallDetectionOutcome> => {
      if (signal?.aborted) return cancelled();
      if (this.state.discoveryComplete && !force) return { ok: true };
      if (force) this.publish({ ...this.state, discoveryComplete: false });
      for (const kind of ["detect.gameInstalls", "detect.mo2Instances"] as const) {
        let result: InstallDetectionOutcome;
        do {
          if (!await this.idle(signal)) return cancelled();
          result = await this.dispatch({ kind }, { signal });
        } while (!result.ok && result.code === "unavailable" && this.state.busy);
        if (!result.ok) return result;
      }
      if (signal?.aborted) return cancelled();
      this.publish({ ...this.state, discoveryComplete: true });
      return { ok: true };
    });
    // An aborted queued caller cannot let a later job overtake the still-running batch.
    this.discoveryTail = job.catch(() => {});
    return withCancellation(job, signal, cancelled);
  }

  private idle(signal?: AbortSignal): Promise<boolean> {
    return new Promise(resolve => {
      let stop = () => {};
      const finish = (ready: boolean) => { stop(); signal?.removeEventListener("abort", abort); resolve(ready); };
      const abort = () => finish(false);
      const changed = () => { if (signal?.aborted) finish(false); else if (!this.state.busy) finish(true); };
      stop = this.subscribe(changed);
      signal?.addEventListener("abort", abort, { once: true });
      changed();
    });
  }

  async dispatch(action: InstallDetectionAction, options: { signal?: AbortSignal } = {}): Promise<InstallDetectionOutcome> {
    const { signal } = options;
    if (signal?.aborted) return cancelled();
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: "unavailable", message: allowed.reason! };
    const target = targetOf(action), fields = target === "frameworks" ? this.frameworkInputs?.() : undefined;
    const inputKey = fields ? frameworkInputKey(fields) : undefined;
    const attempt = target === "frameworks" ? { frameworkAttempt: { inputKey, pending: true } } : {};
    this.publish({ ...this.state, ...attempt, busy: target, error: undefined });
    const stopped = (): InstallDetectionOutcome => {
      this.publish({ ...this.state, busy: null, ...(target === "frameworks" ? { frameworkAttempt: { inputKey, pending: false } } : {}) });
      return cancelled();
    };
    const failed = (message: string, code: string): InstallDetectionOutcome => {
      this.publish({ ...this.state, busy: null, error: message,
        ...(target === "frameworks" ? { frameworkAttempt: { inputKey, pending: false, error: message } } : {}) });
      return { ok: false, code, message };
    };
    try {
      const response = await this.transport!(target, signal);
      if (signal?.aborted) return stopped();
      const data = response.data as { schema?: string; code?: string; error?: string };
      if (!response.ok || data?.schema !== schemaOf[target]) return failed(data?.error ?? "Detection returned an unexpected result.", data?.code ?? "invalid_result");
      this.publish({ ...this.state, busy: null, [target]: response.data,
        ...(target === "frameworks" ? { frameworksInputKey: inputKey, frameworkAttempt: { inputKey, pending: false } } : {}) });
      return { ok: true };
    } catch {
      if (signal?.aborted) return stopped();
      return failed(target === "frameworks" ? "XF Studio couldn't check your frameworks. Choose Check again to try once more."
        : "XF Studio couldn't look for your game. Restart XF Studio and try again.", "transport");
    }
  }
}
