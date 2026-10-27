import type { OwnerTargetStatus, TargetState } from "../../src/platform/api/target-status";

export const targetStatus = (present: boolean, kind = "fixture", id = "target"): OwnerTargetStatus =>
  ({ state: present ? "present" : "purged", owner: { kind, id } });
export const statusWorld = (state: TargetState = "present") => ({ subject: () => ({ state, owner: { kind: "subject", id: "fixture" } }),
  look: () => ({ state, owner: { kind: "look", id: "fixture" } }) });
