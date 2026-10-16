import { evaluateMembership, surfaceBounds } from "./groom";
import { evaluateField } from "./fields";
import { capsuleContact, contactAt, segmentCapsuleContact, segmentContact, type DistanceGrid } from "./contact";
import { add, clamp, dot, lerp, magnitude, mul, normalise, randomAt, smooth, sub, type Capsule, type Groom, type Paths, type Residuals, type Root, type Vec3 } from "./types";

export type CoarseSupport = { grid: DistanceGrid; surface: import("./types").HeadSurface; strategy?: "tangent" | "supported" | "face-frame" };
export function coarsePaths(groom: Groom, roots: Root[], down: Vec3, front: Vec3 = [0, 0, 1], support?: CoarseSupport): Paths {
  const bounds = support ? surfaceBounds(support.surface) : null;
  const membership = evaluateMembership(groom, roots);
  const flow = groom.flow ?? { part: 0, emergenceRadians: Math.PI / 9, foreheadSweep: 1, crownLiftMetres: .0035, rearPreference: 1 };
  return { paths: roots.map(root => {
    const tie = Object.entries(groom.graph.nodes).find(([id, n]) => n.kind === "convergence" && n.tie && membership.at[id]?.includes(root.index))?.[1];
    const hold = tie?.kind === "convergence" ? tie.tie : undefined;
    const tieTarget = hold ? add(hold.position, [Math.cos(root.phase) * hold.radiusMetres * .5, Math.sin(root.phase) * hold.radiusMetres * .5, 0]) : null;
    let holdDistance = -1;
    const length = evaluateField(groom.fields.length, root), waves = evaluateField(groom.fields.waves, root), spread = evaluateField(groom.fields.spread, root);
    if (!(length >= .01 && length <= 1.5) || ![waves, spread].every(Number.isFinite)) throw Error("Length or wave map is outside its range.");
    let start = add(root.position, mul(root.normal, groom.solver.clearanceMetres + .001));
    if (support) for (let pass = 0; pass < 3; pass++) {
      const contact = contactAt(support.grid, start), safe = groom.solver.clearanceMetres + .0008;
      if (contact.distance >= safe) break;
      start = add(start, mul(contact.normal, safe - contact.distance));
    }
    const centre = bounds?.centre ?? [0, 0, 0] as Vec3, side = root.position[0] < centre[0] + (bounds?.size[0] ?? .18) * .5 * flow.part ? -1 : 1;
    const extentX = (bounds?.size[0] ?? .18) * .5, extentY = bounds?.size[1] ?? .24;
    const phase = Math.floor(root.uv[0] * 18) * .75 + Math.floor(root.uv[1] * 4) * .25;
    const rootFront = dot(sub(root.position, centre), front), frontLock = rootFront > .025 && dot(root.normal, front) > .15;
    const strategy = support?.strategy ?? "face-frame";
    const micro: Vec3[] = [start], cumulative = [0];
    let p = start, travelled = 0, previousDirection = [side, 0, 0] as Vec3;
    const microStep = .0025;
    // Trace a supported fibre at a finer spacing than display samples; resample intrinsic arclength afterwards.
    for (let iteration = 0; travelled < length && iteration < 1600; iteration++) {
      const headContact = support ? contactAt(support.grid, p) : { distance: .001, normal: root.normal };
      const n = headContact.normal, local = sub(p, centre), nearHead = headContact.distance < .025 && p[1] > centre[1] - extentY * .32;
      // Support is unilateral. The skull may stop gravity; it cannot pull a falling fibre onto the neck.
      const gathering = !!tieTarget && holdDistance < 0;
      const onSupport = nearHead && !(gathering && magnitude(sub(tieTarget!, p)) < .035) && (gathering || dot(down, n) < -.03 || travelled < .02);
      const crown = smooth(.25, .85, root.normal[1]), part = Math.exp(-(((local[0] - extentX * flow.part) / (extentX * .75)) ** 2));
      const rootFacing = dot(root.normal, front), frontSection = smooth(-.2, .5, rootFacing);
      let preferred = add(down, [side * (nearHead ? part * crown * (.12 + 1.5 * frontSection) : 0), 0, 0]);
      if (nearHead) preferred = add(preferred, mul(front, -crown * (1 - frontSection) * .8));
      // Front roots turn sideways around the forehead instead of following gravity across the face.
      if (!gathering && strategy === "face-frame" && nearHead && dot(local, front) > .005 && Math.abs(local[0]) < extentX * .92)
        preferred = lerp(preferred, flow.foreheadDirection ?? add([side * .8, 2.2, 0], mul(front, -2)), flow.foreheadSweep);
      if (gathering) preferred = add(normalise(sub(tieTarget!, p)), [0, .65 * smooth(.02, .07, tieTarget![1] - p[1]), 0]);
      if (onSupport) {
        let tangent = sub(preferred, mul(n, dot(preferred, n)));
        if (magnitude(tangent) < .001) tangent = sub([side, 0, 0], mul(n, n[0] * side));
        tangent = normalise(tangent);
        const emergence = flow.emergenceRadians * (1 - smooth(.006, .025, travelled));
        preferred = add(mul(tangent, Math.cos(emergence)), mul(n, Math.sin(emergence)));
        if (strategy === "tangent") preferred = add(preferred, mul(n, .12));
      }
      if (support && !gathering && flow.rearPreference > 0 && !frontLock && travelled > .035) {
        // Rear section intent begins on the head, before contact can send it over a shoulder.
        const band = support.surface.capsules.filter(c => c.radii).sort((a, b) => Math.abs((a.a[1] + a.b[1]) / 2 - p[1]) - Math.abs((b.a[1] + b.b[1]) / 2 - p[1]))[0];
        if (band && p[1] < centre[1] - extentY * .05) {
          const rear = (band.a[2] + band.b[2]) / 2 - front[2] * .015;
          const deficit = (rear - p[2]) * -front[2];
          if (deficit > 0) preferred[2] += -front[2] * clamp(deficit / .06, 0, 1.5) * flow.rearPreference;
        }
      }
      const waveGate = gathering ? 0 : smooth(.12, .25, travelled), slope = waves * Math.PI * 2 / .22 * waveGate;
      preferred = add(preferred, [Math.cos(phase + travelled * Math.PI * 2 / .22) * slope, 0, Math.sin(phase + travelled * Math.PI * 2 / .22) * slope * .45]);
      const tipCurl = groom.fields.tipCurl ? evaluateField(groom.fields.tipCurl, { ...root, distance: travelled }) : 0;
      preferred = add(preferred, mul(normalise([centre[0] - p[0], 0, centre[2] - p[2]]), tipCurl * (groom.cut ? 1 - smooth(0, .05, dot(p, groom.cut.normal) - groom.cut.offsetMetres) : smooth(.70, .95, travelled / length))));
      // Contact supplies normal support; tangential transport damps changes without locking rest shape outward.
      const direction = normalise(lerp(previousDirection, normalise(preferred), nearHead ? .9 : .55));
      let next = add(p, mul(direction, microStep));
      if (support) {
        const layer = (gathering ? 0 : spread) * (root.index % 3) / 3 * smooth(.01, .06, travelled);
        const rootLift = (gathering ? 0 : flow.crownLiftMetres) * crown * smooth(0, .012, travelled) * (1 - smooth(.05, .10, travelled));
        const shell = groom.solver.clearanceMetres + .0008 + layer + rootLift;
        const contact = contactAt(support.grid, next);
        const pullToSurface = strategy !== "tangent" && onSupport && travelled > .008 && next[1] > centre[1] - extentY * .25;
        if (contact.distance < shell || pullToSurface && contact.distance < shell + .015)
          next = add(next, mul(contact.normal, shell - contact.distance));
        for (const capsule of support.surface.body ? [] : support.surface.capsules) {
          const collision = capsuleContact(next, capsule);
          if (collision.distance < shell) next = add(next, mul(collision.normal, shell - collision.distance));
        }
      }
      if (gathering && magnitude(sub(next, tieTarget!)) < .004) { next = [...tieTarget!]; holdDistance = travelled + magnitude(sub(next, p)); }
      const edge = magnitude(sub(next, p));
      if (!Number.isFinite(edge) || edge < 1e-7) break;
      travelled += edge; previousDirection = normalise(sub(next, p)); p = next;
      micro.push(p); cumulative.push(travelled);
    }
    if (travelled < length) throw Error("The supported sweep could not trace this fibre.");
    if (hold && holdDistance < 0) throw Error("The convergence hold is unreachable with this length and contact surface.");
    const holdIndex = holdDistance >= 0 ? Math.max(1, Math.min(groom.solver.intervals - 1, Math.round(holdDistance / length * groom.solver.intervals))) : -1;
    const distanceAt = (j: number) => holdIndex < 0 ? length * j / groom.solver.intervals : j <= holdIndex ? holdDistance * j / holdIndex : holdDistance + (length - holdDistance) * (j - holdIndex) / (groom.solver.intervals - holdIndex);
    const segmentMetres = Array.from({ length: groom.solver.intervals }, (_, j) => distanceAt(j + 1) - distanceAt(j));
    const points: Vec3[] = [start]; let at = 1;
    for (let j = 1; j <= groom.solver.intervals; j++) {
      const wanted = distanceAt(j);
      while (at < cumulative.length - 1 && cumulative[at] < wanted) at++;
      points.push(lerp(micro[at - 1], micro[at], (wanted - cumulative[at - 1]) / (cumulative[at] - cumulative[at - 1])));
    }
    const holds = holdIndex >= 0 ? [{ index: holdIndex, position: tieTarget! }] : undefined;
    if (holds) points[holds[0].index] = [...holds[0].position];
    return { root, points, intrinsicMetres: length, segmentMetres, ...(holds ? { holds } : {}) };
  }) };
}

/** One deterministic compliant-constraint batch; the process adapter yields between steps. */
export function drapeStep(groom: Groom, result: Paths, rest: Paths, grid: DistanceGrid, capsules: Capsule[], down: Vec3): void {
  const dt2 = groom.solver.stepSeconds ** 2, clearance = groom.solver.clearanceMetres + .0005;
  for (let p = 0; p < result.paths.length; p++) {
    const path = result.paths[p], target = rest.paths[p], n = path.points.length - 1, step = path.intrinsicMetres / n;
    const stiffness = clamp(evaluateField(groom.fields.stiffness, path.root));
    const segmentLengths = target.segmentMetres ?? Array(n).fill(step) as number[];
    const holds = new Map((target.holds ?? []).map(h => [h.index, h.position]));
    const pin = () => { path.points[0] = [...target.points[0]]; for (const [index, position] of holds) path.points[index] = [...position]; };
    const lambdas = new Float64Array(n), bend = Array.from({ length: n }, () => [0, 0, 0] as Vec3);
    for (let j = 1; j <= n; j++) if (!holds.has(j)) path.points[j] = add(path.points[j], mul(down, 9.81 * dt2 * .15));
    for (let iteration = 0; iteration < groom.solver.iterations; iteration++) {
      for (let j = 1; j <= n; j++) {
        // Vector rest-edge bending, scaled compliance and accumulated multiplier, pinned root inverse mass zero.
        const a = path.points[j - 1], b = path.points[j], restEdge = sub(target.points[j], target.points[j - 1]);
        const error = sub(sub(b, a), restEdge), wa = j === 1 || holds.has(j - 1) ? 0 : 1, wb = holds.has(j) ? 0 : 1, alpha = ((1 - stiffness) * .00003 + smooth(.01, .03, j * step) * .015) / dt2;
        const dl = mul(add(error, mul(bend[j - 1], alpha)), -1 / (wa + wb + alpha));
        bend[j - 1] = add(bend[j - 1], dl);
        if (!holds.has(j)) path.points[j] = add(b, dl); if (wa) path.points[j - 1] = sub(a, dl);
      }
      for (let j = 1; j <= n; j++) {
        const delta = sub(path.points[j], path.points[j - 1]), length = magnitude(delta), wa = j === 1 || holds.has(j - 1) ? 0 : 1, wb = holds.has(j) ? 0 : 1, alpha = 1e-9 / dt2;
        const dl = (-(length - segmentLengths[j - 1]) - alpha * lambdas[j - 1]) / (wa + wb + alpha), correction = mul(delta, dl / (length || 1));
        lambdas[j - 1] += dl; if (!holds.has(j)) path.points[j] = add(path.points[j], correction);
        if (wa) path.points[j - 1] = sub(path.points[j - 1], correction);
      }
      projectContact(path.points, grid, capsules, clearance);
      pin();
      if (iteration >= 1 && pathSettled(path.points, segmentLengths, grid, capsules, groom.solver.clearanceMetres)) break;
    }
    // Root-to-tip sweep preserves intrinsic lengths after contact. Repeated projection resolves coupled constraints.
    for (let pass = 0; pass < 16; pass++) {
      for (let j = 1; j <= n; j++) if (!holds.has(j)) path.points[j] = add(path.points[j - 1], mul(normalise(sub(path.points[j], path.points[j - 1])), segmentLengths[j - 1]));
      for (let j = n; j > 1; j--) if (!holds.has(j - 1)) path.points[j - 1] = add(path.points[j], mul(normalise(sub(path.points[j - 1], path.points[j])), segmentLengths[j - 1]));
      projectContact(path.points, grid, capsules, clearance);
      pin();
      if (pathSettled(path.points, segmentLengths, grid, capsules, groom.solver.clearanceMetres)) break;
    }
  }
  // Small deterministic bundle repulsion: no random topology changes and no root displacement.
  for (let p = 1; p < result.paths.length; p++) {
    const a = result.paths[p - 1], b = result.paths[p];
    if (b.holds?.length) continue;
    for (let j = 2; j < a.points.length; j++) {
      const delta = sub(b.points[j], a.points[j]), d = magnitude(delta);
      if (d > 1e-8 && d < .0002) b.points[j] = add(b.points[j], mul(delta, (.0002 - d) / d));
    }
  }
}
function pathSettled(points: Vec3[], steps: number[], grid: DistanceGrid, capsules: Capsule[], clearance: number) {
  for (let j = 1; j < points.length; j++) {
    if (Math.abs(magnitude(sub(points[j], points[j - 1])) / steps[j - 1] - 1) > .008) return false;
    if (segmentContact(grid, points[j - 1], points[j]).distance < clearance) return false;
    for (const capsule of capsules) if (segmentCapsuleContact(points[j - 1], points[j], capsule).distance < clearance) return false;
  }
  return true;
}
function projectContact(points: Vec3[], grid: DistanceGrid, capsules: Capsule[], clearance: number) {
  for (let j = 1; j < points.length; j++) {
    const contact = contactAt(grid, points[j]);
    if (contact.distance < clearance) points[j] = add(points[j], mul(contact.normal, clearance - contact.distance));
    for (const capsule of capsules) { const c = capsuleContact(points[j], capsule); if (c.distance < clearance) points[j] = add(points[j], mul(c.normal, clearance - c.distance)); }
    const segment = segmentContact(grid, points[j - 1], points[j]);
    if (segment.distance < clearance && segment.t > .05) {
      const delta = mul(segment.normal, (clearance - segment.distance) / Math.max(.25, segment.t));
      points[j] = add(points[j], delta);
    }
    for (const capsule of capsules) {
      const c = segmentCapsuleContact(points[j - 1], points[j], capsule);
      if (c.distance >= clearance) continue;
      const wa = j === 1 ? 0 : 1, a = 1 - c.t, b = c.t, denominator = wa * a * a + b * b;
      if (denominator < 1e-9) continue;
      const correction = mul(c.normal, (clearance - c.distance) / denominator);
      if (wa) points[j - 1] = add(points[j - 1], mul(correction, a));
      points[j] = add(points[j], mul(correction, b));
    }
  }
}
export function drapePaths(groom: Groom, coarse: Paths, grid: DistanceGrid, capsules: Capsule[], down: Vec3 = [0, -1, 0]): Paths {
  const result = structuredClone(coarse);
  for (let i = 0; i < groom.solver.steps; i++) drapeStep(groom, result, coarse, grid, capsules, down);
  return result;
}
export function pathResiduals(result: Paths, rest: Paths, grid: DistanceGrid, clearance: number, capsules: Capsule[]): Residuals {
  let rootMetres = 0, lengthRatio = 0, penetrationMetres = 0, minimumClearanceMetres = Infinity, visibleExtentMetres = 0;
  for (let p = 0; p < result.paths.length; p++) {
    const { points, intrinsicMetres } = result.paths[p], step = intrinsicMetres / (points.length - 1);
    rootMetres = Math.max(rootMetres, magnitude(sub(points[0], rest.paths[p].points[0])));
    for (let i = 1; i < points.length; i++) {
      lengthRatio = Math.max(lengthRatio, Math.abs(magnitude(sub(points[i], points[i - 1])) / (result.paths[p].segmentMetres?.[i - 1] ?? step) - 1));
      let d = segmentContact(grid, points[i - 1], points[i]).distance;
      for (const capsule of capsules) d = Math.min(d, segmentCapsuleContact(points[i - 1], points[i], capsule).distance);
      minimumClearanceMetres = Math.min(minimumClearanceMetres, d); penetrationMetres = Math.max(penetrationMetres, clearance - d);
      visibleExtentMetres = Math.max(visibleExtentMetres, points[0][1] - points[i][1]);
    }
  }
  const colliders = [grid, ...(grid.others ?? [])].map((field, index) => {
    let minimum = Infinity; const own = { ...field, others: undefined };
    for (const path of result.paths) for (let j = 1; j < path.points.length; j++) minimum = Math.min(minimum, segmentContact(own, path.points[j - 1], path.points[j]).distance);
    return { name: index ? `body-${index}` : "head-and-ears", minimumClearanceMetres: minimum, penetrationMetres: Math.max(0, clearance - minimum) };
  });
  return { rootMetres, lengthRatio, penetrationMetres, minimumClearanceMetres, visibleExtentMetres, colliders };
}

/** Hairdresser semantics: settle first, then trim to a head-bound cut surface. */
export function cutPaths(groom: Groom, source: Paths): Paths {
  if (!groom.cut) return source;
  const { normal, offsetMetres } = groom.cut;
  return { paths: source.paths.map(path => {
    const points: Vec3[] = [[...path.points[0]]], segmentMetres: number[] = [];
    const step = path.intrinsicMetres / (path.points.length - 1);
    for (let j = 1; j < path.points.length; j++) {
      const a = path.points[j - 1], b = path.points[j], da = dot(a, normal) - offsetMetres, db = dot(b, normal) - offsetMetres;
      const expected = path.segmentMetres?.[j - 1] ?? step;
      if (da > 0 && db <= 0) { const t = da / (da - db); points.push(lerp(a, b, t)); segmentMetres.push(expected * t); break; }
      points.push([...b]); segmentMetres.push(expected);
    }
    const length = segmentMetres.reduce((a, b) => a + b, 0);
    if (length < .005) throw Error("The cut surface removes this fibre's entire styled length.");
    const holds = path.holds?.filter(h => h.index < points.length);
    return { ...path, points, segmentMetres, intrinsicMetres: length, ...(holds ? { holds } : {}) };
  }) };
}
