/** Host-owned exclusion between package/install work and a prepared app restart. */
export class DesktopWorkActivity {
  private active = 0;
  private restarting = false;

  begin(_kind: "package" | "install"): (() => void) | null {
    if (this.restarting) return null;
    this.active++;
    let ended = false;
    return () => { if (!ended) { ended = true; this.active--; } };
  }

  reserveRestart(): (() => void) | null {
    if (this.restarting || this.active !== 0) return null;
    this.restarting = true;
    let released = false;
    return () => { if (!released) { released = true; this.restarting = false; } };
  }
}
