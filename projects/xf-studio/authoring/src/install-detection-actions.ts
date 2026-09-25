/** Read-only application actions that find Cyberpunk 2077 installs and MO2 instances on this host,
 * and check the installed frameworks the eye-makeup mod depends on. They never change settings, files
 * or mod lists: a setup view can offer "We found Cyberpunk 2077 at … [Use this]" and then save the
 * chosen path through the separate local setup actions, or show framework update guidance. */
import type { FrameworkVersionCheck } from "./framework-versions";
import type { GameInstallDetection, Mo2Detection } from "./install-detection";
import { DETECTION_DESCRIPTORS } from "./studio-action-descriptors";

export type InstallDetectionAction = { kind: "detect.gameInstalls" } | { kind: "detect.mo2Instances" } |
  { kind: "detect.frameworkVersions" };
export type InstallDetectionTarget = "games" | "mo2" | "frameworks";
export type InstallDetectionState = {
  busy: InstallDetectionTarget | null;
  games?: GameInstallDetection;
  mo2?: Mo2Detection;
  /** Frameworks for the configured game folder and MO2 profile (host-owned settings, never browser paths). */
  frameworks?: FrameworkVersionCheck;
  error?: string;
};
export type InstallDetectionOutcome = { ok: true } | { ok: false; code: string; message: string };
export type InstallDetectionTransport = (target: InstallDetectionTarget) => Promise<{
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

export class InstallDetectionActions {
  private state: InstallDetectionState = { busy: null };
  private listeners = new Set<() => void>();
  constructor(private transport: InstallDetectionTransport | null) {}
  descriptors() { return structuredClone(DETECTION_DESCRIPTORS); }
  snapshot(): Readonly<InstallDetectionState> { return structuredClone(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(state: InstallDetectionState) { this.state = state; for (const listener of this.listeners) listener(); }
  capability(action: InstallDetectionAction): { available: boolean; reason?: string } {
    if (!(action?.kind in DETECTION_DESCRIPTORS)) return { available: false, reason: "Unknown detection action." };
    if (!this.transport) return { available: false, reason: "Install detection is unavailable on this host." };
    if (this.state.busy) return { available: false, reason: "Detection is already running." };
    return { available: true };
  }
  async dispatch(action: InstallDetectionAction): Promise<InstallDetectionOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: "unavailable", message: allowed.reason! };
    const target = targetOf(action);
    this.publish({ ...this.state, busy: target, error: undefined });
    try {
      const response = await this.transport!(target);
      const data = response.data as { schema?: string; code?: string; error?: string };
      if (!response.ok || data?.schema !== schemaOf[target]) {
        const message = data?.error ?? "Detection returned an unexpected result.";
        this.publish({ ...this.state, busy: null, error: message });
        return { ok: false, code: data?.code ?? "invalid_result", message };
      }
      this.publish({ ...this.state, busy: null, [target]: response.data });
      return { ok: true };
    } catch {
      const message = "Could not reach install detection. Restart the studio server and retry.";
      this.publish({ ...this.state, busy: null, error: message });
      return { ok: false, code: "transport", message };
    }
  }
}
