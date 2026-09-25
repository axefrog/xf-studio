import { randomUUID } from "node:crypto";

/** A native close waits for the renderer's forced capture and the host's write acknowledgement. */
export class DesktopWorkspaceClose {
  private pending: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly port: {
    requestFlush(nonce: string): void;
    close(): void;
    report(message: string): void;
    /** False while no Studio page has loaded a workspace: there is nothing to save, so close at once. */
    rendererReady?(): boolean;
    /** After a failed save: ask whether to close anyway. Resolves true to close without saving. */
    confirmCloseWithoutSaving?(): Promise<boolean>;
  }, private readonly timeoutMs = 10_000) {}

  request(event: { response?: { allow: boolean } }) {
    if (this.port.rendererReady && !this.port.rendererReady()) return;
    event.response = { allow: false };
    if (this.pending) return;
    const nonce = randomUUID();
    this.pending = nonce;
    this.timer = setTimeout(() => this.fail("Workspace save did not finish. Keep the window open and retry closing."), this.timeoutMs);
    try { this.port.requestFlush(nonce); }
    catch { this.fail("Workspace save could not start. Keep the window open and retry closing."); }
  }

  acknowledge(nonce: string, status: "saved" | "failed"): boolean {
    if (!this.pending || nonce !== this.pending) return false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = null;
    if (status === "saved") this.port.close();
    else this.offerClose("Workspace save failed. Keep the window open and retry closing or export the collection.");
    return true;
  }

  private fail(message: string) {
    if (!this.pending) return;
    this.pending = null;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.offerClose(message);
  }

  /** A failed save must never trap the user: report it, then offer Close without saving. */
  private offerClose(message: string) {
    try { this.port.report(message); } catch { /* The page may be gone. */ }
    void this.port.confirmCloseWithoutSaving?.().then(close => { if (close) this.port.close(); }, () => {});
  }
}

/** Passed only to the app's own WebView after native close has been cancelled. */
export function desktopFlushScript(nonce: string, update = false): string {
  return `(async () => {
    let status = "saved";
    try {
      if (typeof window.xfDesktopWorkspaceFlush !== "function") throw Error("Workspace flush is unavailable.");
      await window.xfDesktopWorkspaceFlush(${update ? JSON.stringify(nonce) : ""});
    }
    catch (error) {
      status = "failed";
      window.xfDesktopWorkspaceError?.("Workspace save failed. Keep this window open and export your collection if retrying fails.");
    }
    await fetch("/api/desktop/workspace/close-ack", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: "xfs/desktop-close-ack-1", nonce: ${JSON.stringify(nonce)}, status })
    });
  })()`;
}

/** Update apply requires a fresh host-confirmed write bound to this nonce. */
export const desktopUpdateFlushScript = (nonce: string) => desktopFlushScript(nonce, true);
