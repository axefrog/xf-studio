// Update policy belongs to the trusted host. The view receives detached facts and
// can request only these three operations; it never chooses a URL or archive.
export type UpdateAction = "check" | "download" | "applyAndRestart";
export type UpdatePhase = "unavailable" | "idle" | "checking" | "available" |
  "downloading" | "ready" | "applying" | "error";
export type UpdateSnapshot = Readonly<{
  schema: "xfs/desktop-update-1";
  installed: Readonly<{ version: string; channel: string; buildHash: string }>;
  available: null | Readonly<{ version: string; buildHash: string }>;
  phase: UpdatePhase;
  reason: string | null;
  canCheck: boolean;
  canDownload: boolean;
  canApplyAndRestart: boolean;
}>;

export type NativeUpdateInfo = { version?: string; hash?: string; updateAvailable: boolean;
  updateReady: boolean; error?: string | null };
export type NativeUpdater = {
  checkForUpdate(): Promise<NativeUpdateInfo>;
  downloadUpdate(): Promise<unknown>;
  updateInfo(): NativeUpdateInfo;
  applyUpdate(): Promise<unknown>;
};

export type InstalledUpdateVersion = UpdateSnapshot["installed"];
export type UpdateTrust = Readonly<{ verifiedPrivateFeed: boolean; signedRelease: boolean;
  twoVersionTrialAccepted: boolean }>;
export type UpdateApplyGuard = { prepare(): Promise<void>; finish(): void };

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const HASH = /^[a-z0-9]{1,64}$/;

export class DesktopUpdateService {
  private phase: UpdatePhase;
  private available: UpdateSnapshot["available"] = null;
  private reason: string | null;
  private busy = false;
  private readonly enabled: boolean;

  constructor(private readonly installed: InstalledUpdateVersion,
    private readonly native: NativeUpdater | null, trust: UpdateTrust,
    private readonly applyGuard: UpdateApplyGuard | null = null) {
    this.enabled = !!native && !!applyGuard && installed.channel !== "dev" &&
      VERSION.test(installed.version) && HASH.test(installed.buildHash) &&
      trust.verifiedPrivateFeed && trust.signedRelease && trust.twoVersionTrialAccepted;
    this.phase = this.enabled ? "idle" : "unavailable";
    this.reason = this.enabled ? null :
      "Automatic updates are off for now. Download new versions from the XF Studio releases page on GitHub.";
  }

  snapshot(): UpdateSnapshot {
    return Object.freeze({ schema: "xfs/desktop-update-1", installed: Object.freeze({ ...this.installed }),
      available: this.available && Object.freeze({ ...this.available }), phase: this.phase,
      reason: this.reason, canCheck: this.enabled && !this.busy && this.phase !== "applying",
      canDownload: this.enabled && !this.busy && this.phase === "available",
      canApplyAndRestart: this.enabled && !this.busy && this.phase === "ready" });
  }

  async dispatch(action: UpdateAction): Promise<UpdateSnapshot> {
    // Dispatch is the consent event. No check (including on startup) is implicit.
    if (!this.enabled || !this.native) return this.snapshot();
    if (this.busy) throw Error("An update operation is already running.");
    if (action === "download" && this.phase !== "available" ||
      action === "applyAndRestart" && this.phase !== "ready") throw Error("Update action is unavailable in this state.");
    this.busy = true;
    this.reason = null;
    try {
      if (action === "check") {
        this.phase = "checking";
        this.available = null;
        const info = await this.native.checkForUpdate();
        if (info.error) throw Error("Update check failed.");
        if (!info.updateAvailable) this.phase = "idle";
        else {
          if (!VERSION.test(info.version ?? "") || !HASH.test(info.hash ?? "") ||
            info.hash === this.installed.buildHash) throw Error("Update metadata is invalid.");
          this.available = { version: info.version!, buildHash: info.hash! };
          this.phase = "available";
        }
      } else if (action === "download") {
        this.phase = "downloading";
        await this.native.downloadUpdate();
        const info = this.native.updateInfo();
        if (info.error || !info.updateReady || info.hash !== this.available?.buildHash)
          throw Error("Downloaded update did not match the checked version.");
        this.phase = "ready";
      } else {
        await this.applyGuard!.prepare();
        this.phase = "applying";
        try { await this.native.applyUpdate(); }
        catch (error) { this.applyGuard!.finish(); throw error; }
      }
    } catch (error) {
      this.phase = "error";
      this.available = null;
      this.reason = error instanceof Error ? error.message : "Update failed.";
    } finally { this.busy = false; }
    return this.snapshot();
  }
}
