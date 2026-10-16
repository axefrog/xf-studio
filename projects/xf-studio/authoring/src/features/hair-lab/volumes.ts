import { evaluateMembership } from "./groom";
import { add, cross, dot, lerp, magnitude, mul, normalise, smooth, sub, type Groom, type HairPath, type Paths, type Root, type Vec3 } from "./types";
import { contactAt, type DistanceGrid } from "./contact";
import { evaluateField } from "./fields";

export type VolumeFrame = { centre: Vec3; tangent: Vec3; width: Vec3; normal: Vec3; radii: readonly [number, number]; covariance: readonly [number, number, number] };
export type VolumeMember = { root: Root; coordinates: Vec3[]; startMetres: number; endMetres: number; intrinsicMetres: number; layerThicknessMetres: number; clumpRatio: number; cut?: boolean };
export type DerivedVolume = { id: string; section: string; next: string; frames: VolumeFrame[]; members: VolumeMember[] };
export type Volumes = { logicalPopulation: number; sampledPopulation: number; volumes: DerivedVolume[] };
export function memberPoint(volume: DerivedVolume, member: VolumeMember, ring: number): Vec3 {
  const f = volume.frames[ring], p = member.coordinates[ring];
  return add(f.centre, add(mul(f.width, p[0]), add(mul(f.normal, p[1]), mul(f.tangent, p[2]))));
}
function sampler(path: HairPath, incoming: boolean, outgoing: boolean) {
  const cumulative = [0]; for (const step of path.segmentMetres ?? Array(path.points.length - 1).fill(path.intrinsicMetres / (path.points.length - 1))) cumulative.push(cumulative.at(-1)! + step);
  const start = incoming && path.holds?.length ? cumulative[path.holds.at(-1)!.index] : 0, end = outgoing && path.holds?.length ? cumulative[path.holds[0].index] : path.intrinsicMetres;
  return { start, end, at(t: number) {
    const distance = start + t * (end - start); let j = 1; while (j < cumulative.length - 1 && cumulative[j] < distance) j++;
    return lerp(path.points[j - 1], path.points[j], (distance - cumulative[j - 1]) / (cumulative[j] - cumulative[j - 1] || 1));
  } };
}
/** Derived material-coordinate volumes. Their display shells never become authored inputs. */
export function deriveVolumes(groom: Groom, source: Paths, rings = 41): Volumes {
  if (!Number.isInteger(rings) || rings < 3 || rings > 65) throw Error("Invalid volume sampling budget.");
  const membership = evaluateMembership(groom, source.paths.map(p => p.root)), upstream = new Map<string, boolean>();
  const walk = (id: string, held: boolean) => { const node = groom.graph.nodes[id]; upstream.set(id, held || upstream.get(id) || false); if (node.kind === "branch") node.outlets.forEach(next => walk(next, held)); else if (node.kind !== "termination") walk(node.next, held || node.kind === "convergence" && !!node.tie); };
  walk(groom.graph.root, false);
  const output: Volumes = { logicalPopulation: groom.population.count, sampledPopulation: source.paths.length, volumes: [] };
  for (const [id, node] of Object.entries(groom.graph.nodes)) {
    if (node.kind !== "volume" || !node.clump) continue;
    const ids = new Set(membership.at[id]), paths = source.paths.filter(p => ids.has(p.root.index)); if (!paths.length) continue;
    let next = node.next, outgoing = false;
    while (groom.graph.nodes[next].kind !== "termination" && groom.graph.nodes[next].kind !== "branch") { const n = groom.graph.nodes[next]; if (n.kind === "convergence" && n.tie) { outgoing = true; break; } next = (n as { next: string }).next; }
    const samples = paths.map(p => sampler(p, upstream.get(id) ?? false, outgoing));
    const ringCount = Math.max(3, Math.ceil((rings - 1) * Math.max(...samples.map((s, i) => (s.end - s.start) / paths[i].intrinsicMetres))) + 1);
    const positions = Array.from({ length: ringCount }, (_, j) => samples.map(s => s.at(j / (ringCount - 1))));
    const centres = positions.map(row => mul(row.reduce((a, b) => add(a, b), [0, 0, 0] as Vec3), 1 / row.length));
    let width = normalise(cross(sub(centres[1], centres[0]), paths[0].root.normal)); if (magnitude(width) < .1) width = [1, 0, 0];
    const frames: VolumeFrame[] = centres.map((centre, j) => {
      const tangent = normalise(sub(centres[Math.min(ringCount - 1, j + 1)], centres[Math.max(0, j - 1)]));
      let projected = sub(width, mul(tangent, dot(width, tangent))); if (magnitude(projected) < .01) projected = cross(tangent, Math.abs(tangent[1]) < .9 ? [0, 1, 0] : [0, 0, 1]);
      projected = normalise(projected); if (dot(projected, width) < 0) projected = mul(projected, -1); width = projected;
      const normal = normalise(cross(width, tangent)); let xx = 0, yy = 0, xy = 0;
      for (const p of positions[j]) { const delta = sub(p, centre), x = dot(delta, width), y = dot(delta, normal); xx += x * x; yy += y * y; xy += x * y; }
      xx /= paths.length; yy /= paths.length; xy /= paths.length;
      return { centre, tangent, width, normal, covariance: [xx, xy, yy], radii: [Math.max(.0015, Math.sqrt(xx) * 2), Math.max(.0015, Math.sqrt(yy) * 2)] };
    });
    const members = paths.map((path, index) => ({ root: path.root, cut: !!path.termination, intrinsicMetres: path.intrinsicMetres, startMetres: samples[index].start, endMetres: samples[index].end, layerThicknessMetres: evaluateField(groom.fields.spread, path.root), clumpRatio: groom.fields.clump ? evaluateField(groom.fields.clump, path.root) : 0,
      coordinates: frames.map((frame, j) => { const delta = sub(positions[j][index], frame.centre); return [dot(delta, frame.width), dot(delta, frame.normal), dot(delta, frame.tangent)] as Vec3; }) }));
    output.volumes.push({ id, section: node.section ?? id, next: node.next, frames, members });
  }
  return output;
}
export function volumeMesh(source: Volumes, grid?: DistanceGrid) {
  const positions: number[] = [], colours: number[] = [], indices: number[] = [], sections = [...new Set(source.volumes.map(v => v.section))];
  const palette = [[.18, .55, .8], [.85, .35, .16], [.4, .7, .25], [.65, .3, .75]];
  for (const [index, volume] of source.volumes.entries()) {
    const start = positions.length / 3, shade = .15 + .85 * ((index * .61803398875) % 1), colour = palette[sections.indexOf(volume.section) % palette.length].map(v => v * shade);
    volume.frames.forEach((f, ring) => { for (let side = 0; side < 12; side++) {
      const angle = side * Math.PI / 6, taper = .5 - .2 * smooth(.35, 1, ring / (volume.frames.length - 1)); let p = add(f.centre, add(mul(f.width, f.radii[0] * taper * Math.cos(angle)), mul(f.normal, f.radii[1] * taper * Math.sin(angle))));
      if (grid) for (let k = 0; k < 4; k++) { const hit = contactAt(grid, p); if (hit.distance >= .001) break; p = add(p, mul(hit.normal, .001 - hit.distance)); }
      positions.push(...p); colours.push(...colour);
      if (ring) { const a = start + (ring - 1) * 12 + side, b = start + (ring - 1) * 12 + (side + 1) % 12; indices.push(a, b, a + 12, b, b + 12, a + 12); }
    } });
  }
  return { positions, colours, indices };
}
