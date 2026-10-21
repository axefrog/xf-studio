/**
 * The readiness codes both sides of the local setup read: the host's readiness check (`local-settings-readiness.ts`) sets
 * them, and the page's setup service (`local-setup-actions.ts`) acts on them. A contract of plain values, so neither side
 * imports the other.
 */

/** A Build readiness issue that clears by itself once the host's background tool check answers (`HostFeatures.packageBuildPending`). */
export const BUILD_TOOLS_CHECKING = "build_tools_checking";
