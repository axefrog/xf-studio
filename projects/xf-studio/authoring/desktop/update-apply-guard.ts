import { randomUUID } from "node:crypto";
import { DesktopWorkActivity } from "./work-activity";

/** A restart is allowed only after the current renderer draft reaches the host. */
export class DesktopUpdateApplyGuard {
  private pending: { nonce: string; resolve(): void; reject(error: Error): void } | null = null;
  private savedNonce: string | null = null;
  private prepared = false;
  private release: (() => void) | null = null;

  constructor(private readonly activity: DesktopWorkActivity,
    private readonly requestFlush: (nonce: string) => void, private readonly timeoutMs = 10_000) {}

  async prepare(): Promise<void> {
    if (this.pending || this.prepared) throw Error("An update restart is already being prepared.");
    const release = this.activity.reserveRestart();
    if (!release) throw Error("Finish active package or install work before restarting for an update.");
    this.release = release;
    const nonce = randomUUID();
    this.savedNonce = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        this.pending = { nonce, resolve, reject };
        timer = setTimeout(() => reject(Error("Workspace save timed out; update restart was cancelled.")), this.timeoutMs);
        try { this.requestFlush(nonce); }
        catch { reject(Error("Workspace save could not start; update restart was cancelled.")); }
      });
      this.prepared = true;
    } catch (error) {
      this.finish();
      throw error;
    } finally {
      clearTimeout(timer);
      this.pending = null;
    }
  }

  acknowledge(nonce: string, status: "saved" | "failed"): boolean {
    if (nonce !== this.pending?.nonce) return false;
    if (status === "saved" && this.savedNonce !== nonce) {
      this.pending.reject(Error("Workspace was not written to the host; update restart was cancelled."));
      return false;
    }
    if (status === "saved") this.pending.resolve();
    else this.pending.reject(Error("Workspace save failed; update restart was cancelled."));
    return true;
  }

  /** Any later workspace write invalidates the prepared snapshot. */
  noteWorkspaceWrite(nonce: string | null): boolean {
    if (!this.pending && !this.prepared) return false;
    this.savedNonce = nonce && nonce === this.pending?.nonce ? nonce : null;
    return this.savedNonce !== null;
  }

  /** Electrobun reads this response synchronously; it does not await a handler. */
  beforeQuit(event: { response?: { allow: boolean } }): void {
    if (this.pending || this.prepared && !this.savedNonce) event.response = { allow: false };
  }

  finish(): void {
    this.prepared = false;
    this.pending = null;
    this.savedNonce = null;
    this.release?.();
    this.release = null;
  }
}
