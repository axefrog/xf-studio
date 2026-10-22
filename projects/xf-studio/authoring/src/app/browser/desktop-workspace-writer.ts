/**
 * The desktop page's workspace writes to the host file (`desktop/bootstrap.js`): at most one write in flight, the newest draft last.
 * It remembers the latest draft it was given, so a write that failed can be sent again; the workspace lease's release waits on
 * `settle`, which resends that draft when its last write failed and refuses the release (`ReleaseUnsaved`) while it still can't land.
 */
import { ReleaseUnsaved } from "../workspace/workspace-lease";

export const DESKTOP_SAVE_FAILED = "Your latest changes could not be saved. Keep this window open and export your collection from the Library panel.";

export function desktopWorkspaceWriter(post: (text: string) => Promise<void>, onResult: (failed: boolean) => void = () => {}) {
  let pending: string | null = null, latest: string | null = null, inFlight: Promise<void> | null = null, failed = false;
  const save = (text: string) => {
    latest = text; pending = text;
    if (!inFlight) inFlight = (async () => {
      while (pending !== null) {
        const next = pending; pending = null;
        try { await post(next); failed = false; } catch { failed = true; }
        onResult(failed);
      }
      inFlight = null;
    })();
    return inFlight;
  };
  const idle = async () => { while (inFlight) await inFlight; };
  return {
    save,
    idle,
    /** Whether the last write failed (nothing newer has been stored since). */
    failed: () => failed,
    /** The latest draft this page gave the host, stored or not. */
    latest: () => latest,
    /** Resolves once the latest draft is stored, sending it again if its last write failed; rejects with `ReleaseUnsaved` otherwise. */
    async settle() {
      await idle();
      if (failed && latest !== null) { await save(latest); await idle(); }
      if (failed) throw new ReleaseUnsaved(DESKTOP_SAVE_FAILED);
    },
  };
}
