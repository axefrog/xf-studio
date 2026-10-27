/** Plain data for U1/U2. The session owns bindings; PanelActions owns commands and captured-choice lifetime. */
import type { Capability } from "../../platform/api/capability";
import type { OwnerTargetStatus } from "../../platform/api/target-status";
import type { PanelBinding } from "./profile-session";
import type { PanelTarget } from "./profile-sessions";
import type { BindingRuleResult, Resolution, Target } from "./bindings";
import type { PanelAction } from "./panel-actions";

export type BindingTargetOption = { readonly binding: Extract<PanelBinding, { policy: "pinned" }>;
  readonly name: string; readonly parent?: string; readonly tabs?: readonly { readonly id: string; readonly name: string }[] };
export type BindingCandidate = BindingTargetOption & {
  readonly target: Target; readonly status: OwnerTargetStatus;
  readonly statuses: Readonly<Partial<Record<"view" | "scene" | "subject" | "look", OwnerTargetStatus>>>;
  readonly outsideTab: boolean; readonly shownInTab: boolean; readonly current: boolean; readonly rules: readonly BindingRuleResult[];
  readonly capability: Capability; readonly action?: Extract<PanelAction, { kind: "panels.setBinding" }>;
};
export type PanelBindingSnapshot = {
  readonly instance: string; readonly destination?: PanelTarget; readonly capability: Capability;
  readonly current: { readonly binding: PanelBinding; readonly name: string; readonly named: boolean; readonly resolution: Resolution; readonly target: Target };
  readonly follow: { readonly capability: Capability; readonly action?: Extract<PanelAction, { kind: "panels.setBinding" }> };
  readonly candidates: readonly BindingCandidate[];
  /** U2 renders this reason when no candidate can be selected; it never picks a replacement. */
  readonly noCandidate?: Capability;
};
export type PanelBindingsPort = {
  snapshot(instance: string): PanelBindingSnapshot;
  /** Take once when a chooser opens. Returned actions retain that origin and candidate until abort; reads remain detached. */
  capture(instance: string, signal: AbortSignal): PanelBindingSnapshot;
};
