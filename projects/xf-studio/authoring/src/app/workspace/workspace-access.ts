import { refusal } from "../../platform/api/capability";
import type { DocumentOutbox } from "../../platform/core/document-outbox";
import { leaseSnapshot, type WorkspaceLease } from "./workspace-lease";

export const PAUSED_WORKSPACE = "This window can't save changes, so editing is paused. Try again, or Export this window's copy.";
export const BACKUP_RECOVERY_FAILED = "Your changes still couldn't be backed up. Export this window's copy, or reopen the window.";
const RETRY_REFUSALS = {
  stopped: "This window has stopped saving. Export this window's copy, or reopen the window.",
  "lease-lost": "This window no longer holds the workspace. Export this window's copy, or reopen the window.",
};
export function retryRecoveryRefusal(outbox: DocumentOutbox): string | undefined {
  const code = outbox.retryRefusal();
  return code && RETRY_REFUSALS[code];
}

/** The existing application access gate includes a paused writer, even while its lease is still held. */
export function workspaceAccess(lease?: WorkspaceLease, outbox?: DocumentOutbox) {
  const paused = () => outbox?.status().suspended ?? false;
  const message = () => {
    const reason = outbox && retryRecoveryRefusal(outbox);
    return reason ? `This window is read-only. ${reason}` : PAUSED_WORKSPACE;
  };
  return {
    writable: () => !paused() && (lease?.writable() ?? true),
    refusal: () => lease?.refusal() ?? (paused() ? refusal("unavailable", message()) : undefined),
    snapshot: () => {
      const snapshot = lease?.snapshot() ?? leaseSnapshot({ phase: "holder", generation: null });
      return paused() && snapshot.writable ? { ...snapshot, writable: false, message: message(), refusal: message(),
        canTakeOver: false, canRetry: false, canCancel: false } : snapshot;
    },
    subscribe(listener: () => void) {
      let wasPaused = paused();
      const offLease = lease?.subscribe(listener), offOutbox = outbox?.subscribe(event => {
        if (event.kind !== "status") return;
        const next = paused();
        if (next !== wasPaused) { wasPaused = next; listener(); }
      });
      return () => { offLease?.(); offOutbox?.(); };
    },
  };
}
