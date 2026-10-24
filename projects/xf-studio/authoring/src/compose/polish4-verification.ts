/** Visual specimens, installed only in the isolated ?verify=1 workspace. Lease behavior is tested with the real adapters. */
import type { PresentationStatus } from "../app/presentation-status";
import { leaseSnapshot } from "../app/workspace/workspace-lease";

export const POLISH4_STATES = ["normal", "older", "taking-over", "waiting", "restore-short", "restore-safe", "restore-unsafe", "unprotected"] as const;
export type Polish4State = typeof POLISH4_STATES[number];
export function polish4Verification(changed: () => void) {
  let state: Polish4State = "normal";
  return {
    state(next: Polish4State) {
      if (!POLISH4_STATES.includes(next)) throw Error("Unknown polish specimen.");
      state = next; changed();
    },
    snapshot(status: PresentationStatus): PresentationStatus {
      if (state === "normal") return status;
      const outbox = { unprotected: state === "unprotected" ? 1 : 0, pending: 1, conflicts: 0, failing: false,
        recovering: { shown: state.startsWith("restore-"), long: state === "restore-safe" || state === "restore-unsafe", safe: state !== "restore-unsafe", missing: 0 } };
      const phase = state === "older" ? "read-only" : state === "taking-over" || state === "waiting" ? state : "holder";
      return { ...status, outbox, lease: { ...leaseSnapshot({ phase, generation: phase === "holder" ? 1 : null }), migrationPending: state === "older" } };
    },
  };
}


/** Two long same-named defaults in one minute and one in another, exercising seconds only where needed. */
export function polish4Defaults(defaults: import("../app/profiles/layout-defaults").LayoutDefaults,
  outbox: import("../platform/core/document-outbox").DocumentOutbox, fragment: import("../platform/api/layout-fragment").LayoutFragment) {
  const name = "Evening lighting and makeup arrangement", base = 1_800_000_000_000;
  for (const seconds of [5, 25, 65]) {
    const result = defaults.dispatch({ kind: "create", name, fragment });
    if (!result.ok || !result.id) throw Error("The capture default couldn’t be saved.");
    const ref = { kind: "layout-default", id: result.id }, value = outbox.document(ref)!.value as Record<string, unknown>;
    outbox.commit("polish4.capture-time", [{ ...ref, value: { ...value, savedAt: base + seconds * 1000 } }]);
  }
}
