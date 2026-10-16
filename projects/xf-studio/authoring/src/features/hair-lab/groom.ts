import { constrainDensity, projectCapDensity } from "./scalp";
import { constant, evaluateField, transportSample, validateField } from "./fields";
import { add, cross, dot, magnitude, mul, normalise, randomAt, smooth, sub, vertex, type Field, type Groom, type HeadSurface, type Root, type Vec3 } from "./types";

/** Spatial sections and clumps are ordinary partitions and volumes, never solver style branches. */
export function sectionGraph(): Groom["graph"] {
  const nodes: Groom["graph"]["nodes"] = { roots: { kind: "root", next: "partition" }, end: { kind: "termination" } };
  const threshold = (at: number): Field => ({ op: "blend", chart: "scalp", unit: "ratio", a: constant(1, "ratio"), b: constant(0, "ratio"),
    mask: { op: "smoothstep", chart: "scalp", unit: "ratio", low: at - .00001, high: at + .00001, input: { op: "ramp", chart: "scalp", unit: "ratio", axis: "u", from: 0, to: 1 } } });
  nodes.partition = { kind: "branch", outlets: ["section-left", "section-right"], selection: threshold(.5) };
  for (let side = 0; side < 2; side++) {
    const section = side ? "right" : "left", split = `split-${section}`;
    nodes[`section-${section}`] = { kind: "volume", length: "length", section, next: split };
    nodes[split] = { kind: "branch", outlets: [`${split}-0`, `${split}-1`], selection: threshold(side * .5 + .25) };
    for (let half = 0; half < 2; half++) {
      nodes[`${split}-${half}`] = { kind: "branch", outlets: [`clump-${side * 4 + half * 2}`, `clump-${side * 4 + half * 2 + 1}`], selection: threshold(side * .5 + half * .25 + .125) };
      for (let leaf = 0; leaf < 2; leaf++) { const id = `clump-${side * 4 + half * 2 + leaf}`; nodes[id] = { kind: "volume", length: "length", section, clump: id, next: "end" }; }
    }
  }
  return { root: "roots", nodes };
}

export function defaultGroom(surface: HeadSurface): Groom {
  return { schema: "xfs/hair-groom-part-1", name: "Loose waves", population: { seed: 1, count: 60000 },
    scalp: { resource: surface.resource, topology: surface.topology, densitySeed: { method: surface.cap?.points.length ? "cap-projected" : "head-estimated",
      source: surface.cap?.points.length ? surface.cap.source : surface.resource, revision: surface.revision },
      density: surface.cap?.points.length ? seedDensity(surface) : seedAnatomicalDensity(surface), binding: samplingBinding(surface) },
    graph: sectionGraph(),
    flow: { part: 0, emergenceRadians: Math.PI / 9, foreheadSweep: 1, crownLiftMetres: .0035, rearPreference: 1 },
    fields: { length: constant(.55, "m"), waves: constant(.012, "m"), spread: constant(.018, "m"), stiffness: constant(.4, "ratio"),
      density: constant(1, "ratio") },
    solver: { samples: 256, intervals: 48, steps: 12, iterations: 8, stepSeconds: 1 / 60, clearanceMetres: .0005 } };
}
export function surfaceBounds(head: HeadSurface) {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < head.positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], head.positions[i + k]); max[k] = Math.max(max[k], head.positions[i + k]); }
  return { min, max, centre: mul(add(min, max), .5), size: sub(max, min) };
}
/** A soft scalp-space seed: temple recession, central peak, irregular fine edge and lower occipital/nape coverage. */
export function anatomicalDensityAt(position: Vec3, bounds: ReturnType<typeof surfaceBounds>, front: Vec3): number {
  const local = sub(position, bounds.centre), height = (position[1] - bounds.min[1]) / bounds.size[1];
  const facing = dot(local, front) / (bounds.size[2] * .5), side = Math.abs(local[0]) / (bounds.size[0] * .5);
  const forehead = smooth(-.25, .6, facing), temple = .70 + .08 * smooth(.2, .8, side);
  const earEdge = .58 * smooth(.65, .95, side), angle = Math.atan2(local[0], -dot(local, front));
  const irregular = .008 * Math.sin(angle * 13) + .004 * Math.sin(angle * 29);
  const edge = Math.max(.28 * (1 - forehead) + temple * forehead, earEdge) + irregular;
  return smooth(edge, edge + .045, height);
}
export function seedAnatomicalDensity(head: HeadSurface): number[] {
  const bounds = surfaceBounds(head), density: number[] = [];
  for (let i = 0; i < head.positions.length / 3; i++) density.push(anatomicalDensityAt(vertex(head.positions, i), bounds, head.front ?? [0, 0, 1]));
  return constrainDensity(head, density);
}
/** The population's sampling chart is authored once, so morphing cannot change triangle selection. */
function samplingBinding(head: HeadSurface) {
  const bounds = surfaceBounds(head), triangles: number[] = [], cumulativeAreas: number[] = [];
  let area = 0;
  for (let t = 0; t < head.indices.length; t += 3) {
    const a = vertex(head.positions, head.indices[t]), b = vertex(head.positions, head.indices[t + 1]), c = vertex(head.positions, head.indices[t + 2]);
    const size = magnitude(cross(sub(b, a), sub(c, a))) / 2, centre = mul(add(add(a, b), c), 1 / 3);
    if (size < 1e-12 || centre[1] < bounds.min[1] + bounds.size[1] * .24) continue;
    area += size; triangles.push(t); cumulativeAreas.push(area);
  }
  return { triangles, cumulativeAreas };
}
/** An authored scalar seed per head vertex; the cap never becomes the domain. */
function seedDensity(head: HeadSurface): number[] {
  const projected = projectCapDensity(head); if (projected) return projected;
  const points = head.cap!.points, values: number[] = [];
  for (let i = 0; i < head.positions.length; i += 3) {
    let distance = Infinity;
    for (let j = 0; j < points.length; j += 3) {
      const d = (head.positions[i] - points[j]) ** 2 + (head.positions[i + 1] - points[j + 1]) ** 2 + (head.positions[i + 2] - points[j + 2]) ** 2;
      if (d < distance) distance = d;
    }
    values.push(1 - smooth(.006, .023, Math.sqrt(distance)));
  }
  return constrainDensity(head, values);
}
export function validateGroom(groom: Groom): string[] {
  const issues: string[] = [];
  if (groom.schema !== "xfs/hair-groom-part-1") issues.push("Unknown groom version.");
  if (!Number.isInteger(groom.population.count) || groom.population.count < 1 || groom.population.count > 120000 || !Number.isInteger(groom.population.seed)) issues.push("Invalid population budget.");
  for (const [name, field] of Object.entries(groom.fields)) {
    issues.push(...validateField(field));
    if (["length", "waves", "spread"].includes(name) && (field.unit !== "m" || (field.op === "constant" && (field.value < 0 || field.value > 1.5)))) issues.push(`Invalid ${name} map.`);
  }
  if (groom.flow && (!Object.values(groom.flow).flat().every(Number.isFinite) || Math.abs(groom.flow.part) > 1 || groom.flow.emergenceRadians < 0 || groom.flow.emergenceRadians > Math.PI / 3 || groom.flow.foreheadSweep < 0 || groom.flow.foreheadSweep > 1)) issues.push("Invalid growth field.");
  const s = groom.solver;
  for (const [value, lo, hi] of [[s.samples, 1, 1024], [s.intervals, 8, 64], [s.steps, 1, 32], [s.iterations, 1, 16]])
    if (!Number.isInteger(value) || value < lo || value > hi) issues.push("Invalid solver budget.");
  if (!(s.stepSeconds >= .001 && s.stepSeconds <= .05) || !(s.clearanceMetres >= .0001 && s.clearanceMetres <= .01)) issues.push("Invalid solve units.");
  const visiting = new Set<string>(), seen = new Set<string>();
  const walk = (id: string) => {
    if (visiting.has(id)) { issues.push("Volume graph contains a cycle."); return; }
    if (seen.has(id)) return;
    const node = groom.graph.nodes[id];
    if (!node) { issues.push(`Missing volume ${id}.`); return; }
    visiting.add(id);
    if (node.kind === "branch") {
      if (node.outlets.length !== 2 || new Set(node.outlets).size !== 2 || (typeof node.selection === "number" ? !Number.isFinite(node.selection) || node.selection < 0 || node.selection > 1 : validateField(node.selection).length > 0 || node.selection.unit !== "ratio")) issues.push("Invalid partition.");
      node.outlets.forEach(walk);
    } else if (node.kind !== "termination") {
      if (node.kind === "convergence" && node.tie && (!node.tie.position.every(Number.isFinite) || !(node.tie.radiusMetres > 0 && node.tie.radiusMetres <= .10))) issues.push("Invalid convergence hold.");
      if (node.kind === "volume") {
        if (!groom.fields[node.length] || groom.fields[node.length].unit !== "m") issues.push("Missing length map.");
        if (node.mapping) try { transportSample({ id: "0", index: 0, uv: [0, 0], cross: [0, 0], distance: 0, entrance: 0, phase: 0 }, node.mapping); } catch { issues.push("Invalid chart binding."); }
      }
      walk(node.next);
    }
    visiting.delete(id); seen.add(id);
  };
  walk(groom.graph.root);
  if (groom.graph.nodes[groom.graph.root]?.kind !== "root") issues.push("Graph needs a root population.");
  return issues;
}
/** Every split partitions identities; disjoint arrivals are joined only after topological ordering. */
export function evaluateMembership(groom: Groom, input: (number | Root)[]): { at: Record<string, number[]>; ended: number[] } {
  const issues = validateGroom(groom); if (issues.length) throw Error(issues.join(" "));
  const ids = input.map(i => typeof i === "number" ? i : i.index), samples = new Map(input.filter(i => typeof i !== "number").map(i => [(i as Root).index, i as Root]));
  if (new Set(ids).size !== ids.length) throw Error("Duplicate follicle identities.");
  const order: string[] = [], visited = new Set<string>();
  const walk = (id: string) => { if (visited.has(id)) return; visited.add(id); const n = groom.graph.nodes[id]; if (n.kind === "branch") n.outlets.forEach(walk); else if (n.kind !== "termination") walk(n.next); order.unshift(id); };
  walk(groom.graph.root);
  const at: Record<string, number[]> = { [groom.graph.root]: [...ids] }, ended: number[] = [];
  const send = (id: string, ids: number[]) => { const incoming = at[id] ??= []; const known = new Set(incoming); if (ids.some(i => known.has(i))) throw Error("Overlapping convergence."); incoming.push(...ids); };
  for (const id of order) {
    const n = groom.graph.nodes[id], ids = at[id] ??= [];
    if (n.kind === "termination") ended.push(...ids);
    else if (n.kind === "branch") {
      const selection = (i: number) => { if (typeof n.selection === "number") return n.selection; const sample = samples.get(i); if (!sample) throw Error("A field partition requires material samples."); return evaluateField(n.selection, sample); };
      send(n.outlets[0], ids.filter(i => randomAt(groom.population.seed, i) < selection(i))); send(n.outlets[1], ids.filter(i => randomAt(groom.population.seed, i) >= selection(i)));
    }
    else send(n.next, ids);
  }
  return { at, ended };
}
/** Stable area-weighted rejection sampling. Attempts belong to each logical follicle, never to preview density. */
export function sampleRoots(groom: Groom, head: HeadSurface, budget: number): Root[] {
  const issues = validateGroom(groom); if (issues.length) throw Error(issues.join(" "));
  if (groom.scalp.topology !== head.topology || groom.scalp.resource !== head.resource) throw Error("Head topology changed; rebind this groom.");
  const bounds = surfaceBounds(head), triangles: { t: number; area: number; normal: Vec3 }[] = [];
  const binding = groom.scalp.binding ?? samplingBinding(head);
  let area = 0;
  for (let i = 0; i < binding.triangles.length; i++) {
    const t = binding.triangles[i], a = vertex(head.positions, head.indices[t]), b = vertex(head.positions, head.indices[t + 1]), c = vertex(head.positions, head.indices[t + 2]);
    area = binding.cumulativeAreas[i]; triangles.push({ t, area, normal: normalise(cross(sub(b, a), sub(c, a))) });
  }
  if (!triangles.length || !Number.isFinite(area)) throw Error("No usable scalp surface.");
  const roots: Root[] = [];
  for (let index = 0; index < Math.min(budget, groom.population.count); index++) {
    let root: Root | undefined;
    for (let attempt = 0; attempt < 512; attempt++) {
      const key = index * 8192 + attempt * 7, target = randomAt(groom.population.seed, key) * area;
      let lo = 0, hi = triangles.length - 1;
      while (lo < hi) { const mid = lo + hi >>> 1; if (triangles[mid].area < target) lo = mid + 1; else hi = mid; }
      const tri = triangles[lo], a = Math.sqrt(randomAt(groom.population.seed, key + 1)), b = randomAt(groom.population.seed, key + 2);
      const barycentric: Vec3 = [1 - a, a * (1 - b), a * b], ids = head.indices.slice(tri.t, tri.t + 3);
      const position = ids.reduce((p, id, k) => add(p, mul(vertex(head.positions, id), barycentric[k])), [0, 0, 0] as Vec3);
      const local = sub(position, bounds.centre), v = (position[1] - bounds.min[1]) / bounds.size[1];
      const u = (Math.atan2(local[0], -local[2]) + Math.PI) / (2 * Math.PI);
      // Conservative authored anatomical seed: lower at the back, high forehead, no face/ear/neck roots.
      const density = groom.scalp.density ? ids.reduce((sum, id, k) => sum + (groom.scalp.density![id] ?? 0) * barycentric[k], 0) : anatomicalDensityAt(position, bounds, head.front ?? [0, 0, 1]);
      root = { id: `${groom.population.seed}:${index}`, index, uv: [u, v], cross: [u, v], distance: 0, entrance: 0,
        phase: randomAt(groom.population.seed, index + 92711) * Math.PI * 2, triangle: tri.t / 3, barycentric, position, normal: tri.normal, density };
      if (density * evaluateField(groom.fields.density, root) > randomAt(groom.population.seed, key + 3)) break;
      root = undefined;
    }
    if (!root) throw Error("The scalp density map has no usable coverage.");
    roots.push(root);
  }
  return roots;
}
