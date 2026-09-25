/**
 * Whether two exports of the head describe the same drawn surface: vertex positions, UVs, triangles and
 * every facial morph target (by name, with its position deltas). The preview's core head carries the eye
 * plate cut and the idle binding; when the launch route's resolved head is the same surface, its skin is
 * drawn on the core head, and otherwise the resolved head is drawn itself. Pure.
 */
export type HeadSurface = {
  positions: ArrayLike<number>;
  uvs: ArrayLike<number> | null;
  index: ArrayLike<number> | null;
  /** Morph target names in influence order, and each target's position deltas. */
  morphNames: readonly string[];
  morphPositions: readonly ArrayLike<number>[];
};
export type SurfaceComparison = { same: boolean; reason: string };

const TOLERANCE = 1e-5;
function arraysMatch(a: ArrayLike<number> | null, b: ArrayLike<number> | null, tolerance: number): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > tolerance) return false;
  return true;
}

export function compareHeadSurfaces(core: HeadSurface, resolved: HeadSurface, tolerance = TOLERANCE): SurfaceComparison {
  if (core.positions.length !== resolved.positions.length) return { same: false, reason: "vertex count differs" };
  if (!arraysMatch(core.positions, resolved.positions, tolerance)) return { same: false, reason: "vertex positions differ" };
  if (!arraysMatch(core.uvs, resolved.uvs, 1e-6)) return { same: false, reason: "UVs differ" };
  if (!arraysMatch(core.index, resolved.index, 0)) return { same: false, reason: "triangles differ" };
  const byName = new Map(resolved.morphNames.map((name, index) => [name, resolved.morphPositions[index]]));
  if (core.morphNames.length !== resolved.morphNames.length || core.morphNames.some(name => !byName.has(name)))
    return { same: false, reason: "facial morph targets differ" };
  for (let i = 0; i < core.morphNames.length; i++)
    if (!arraysMatch(core.morphPositions[i] ?? null, byName.get(core.morphNames[i]!) ?? null, tolerance))
      return { same: false, reason: `facial morph ${core.morphNames[i]} differs` };
  return { same: true, reason: "same surface" };
}
