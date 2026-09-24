/**
 * Generic "which archive supplies this depot path" decision for preview inputs
 * that several installed archives provide. Pure: callers pass the candidates a
 * source scan found; nothing here knows about particular mods.
 *
 * Rule status (knowledge/hair-shading.md, research/eye-artistry/brown-liquorice-profile-overlap.md):
 * - explicit override: a user/intake choice, always reported as such;
 * - mod over base: source-supported expectation (WolvenKit's lookup order and
 *   ArchiveXL's insertion of Mod archive groups before base groups), NOT a
 *   runtime-observed REDengine rule;
 * - several mod candidates: unresolved here (mod-vs-mod order needs the
 *   load-order resolver and launch route), so no winner is invented.
 */
export type DepotScope = "mod" | "base";
export type DepotCandidate = { archive: string; scope: DepotScope };
export type DepotResolution<T extends DepotCandidate> =
  | { winner: T; basis: "explicit-override" | "mod-over-base-expectation" | "single-candidate"; note: string }
  | { winner: undefined; basis: "unresolved"; note: string };

export function resolveDepotCandidate<T extends DepotCandidate>(candidates: readonly T[], override?: string): DepotResolution<T> {
  if (override !== undefined) {
    const chosen = candidates.find(c => c.archive === override);
    if (!chosen) return { winner: undefined, basis: "unresolved", note: `Override ${override} is not an installed candidate.` };
    return { winner: chosen, basis: "explicit-override", note: `Explicit override: ${chosen.archive}.` };
  }
  if (candidates.length === 1)
    return { winner: candidates[0]!, basis: "single-candidate", note: `Only candidate: ${candidates[0]!.archive}.` };
  const mods = candidates.filter(c => c.scope === "mod");
  if (mods.length === 1)
    return { winner: mods[0]!, basis: "mod-over-base-expectation",
      note: `${mods[0]!.archive} (mod) over ${candidates.filter(c => c.scope === "base").map(c => c.archive).join(", ") || "no base"}: source-supported expectation, not runtime-proven.` };
  return { winner: undefined, basis: "unresolved",
    note: mods.length ? `${mods.length} mod archives provide this path; mod-to-mod order is not resolved here.` : "No candidate." };
}
