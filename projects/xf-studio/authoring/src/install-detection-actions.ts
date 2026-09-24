/** Read-only application actions that find Cyberpunk 2077 installs and MO2 instances on this host.
 * They never change settings: a setup view can offer "We found Cyberpunk 2077 at … [Use this]" and
 * then save the chosen path through the separate local setup actions. */
import type { GameInstallDetection, Mo2Detection } from "./install-detection";
import { DETECTION_DESCRIPTORS } from "./studio-action-descriptors";

export type InstallDetectionAction = { kind: "detect.gameInstalls" } | { kind: "detect.mo2Instances" };
export type InstallDetectionTarget = "games" | "mo2";
export type InstallDetectionState = {
  busy: InstallDetectionTarget | null;
  games?: GameInstallDetection;
  mo2?: Mo2Detection;
  error?: string;
};
export type InstallDetectionOutcome = { ok: true } | { ok: false; code: string; message: string };
export type InstallDetectionTransport = (target: InstallDetectionTarget) => Promise<{
  ok: boolean; status: number; data: GameInstallDetection | Mo2Detection | { code: string; error: string };
}>;

const targetOf = (action: InstallDetectionAction): InstallDetectionTarget =>
  action.kind === "detect.gameInstalls" ? "games" : "mo2";
const schemaOf = { games: "xfs/game-install-detection-1", mo2: "xfs/mo2-instance-detection-1" } as const;

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
