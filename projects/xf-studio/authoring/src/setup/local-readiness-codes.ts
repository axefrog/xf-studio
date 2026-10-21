/**
 * The readiness codes and records both sides of the local setup read: the host's readiness check (`local-settings-readiness.ts`)
 * sets them, and the page's setup service (`local-setup-actions.ts`) acts on them. A contract of plain values and types, so neither
 * side imports the other.
 */

export type LocalCapability = "author" | "check" | "sourceDiscovery" | "sourceCache" | "previewStorage" | "build" |
  "frameworks" | "install" | "updates";
export type ReadinessIssue = { code: string; reason: string };
export type CapabilityReadiness = { ready: boolean; issues: ReadinessIssue[]; limits: string[] };
export type LocalReadiness = Record<LocalCapability, CapabilityReadiness>;

/** A Build readiness issue that clears by itself once the host's background tool check answers (`HostFeatures.packageBuildPending`). */
export const BUILD_TOOLS_CHECKING = "build_tools_checking";
