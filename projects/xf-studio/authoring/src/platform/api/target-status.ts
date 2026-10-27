/** Detached owner facts. Missing references are never equivalent to unassigned slots. */
import type { Capability } from "./capability";
import type { DocumentRef } from "./document-commands";

export type TargetState = "present" | "empty" | "removed" | "purged" | "unavailable" | "pending";
export type OwnerTargetStatus = {
  readonly state: TargetState;
  readonly owner: DocumentRef;
  readonly revision?: number;
  readonly label?: string;
  readonly reason?: string;
  readonly pending?: boolean;
  /** A recovering document can still expose its existing recovery/conflict surface. */
  readonly content?: "present" | "removed";
  readonly conflict?: boolean;
  readonly restore?: Capability;
};
/** The panel instance asking about a target is always explicit, including parked/withdrawn panes. */
export type BoundTargetStatus = OwnerTargetStatus & { readonly instance: string };
export const targetPresent = (status: OwnerTargetStatus) => status.state === "present" || status.state === "pending" && status.content === "present";

/** Shared with host cleanup: a retained subject can be restored for thirty days. */
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 3600_000;
