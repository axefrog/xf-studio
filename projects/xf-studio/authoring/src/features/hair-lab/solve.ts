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
    let holdDistance = -1, holdMicroIndex = -1;
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
      if (!gathering && strategy === "face-frame" && nearHead && dot(local, front) > .005 && Math.abs(local[0]) < extentX * .92) {
        const comb = flow.partCombing ?? [2.4, .3, .35];
        preferred = lerp(preferred, flow.foreheadDirection ?? add([side * comb[0], comb[1], 0], mul(front, -comb[2])), flow.foreheadSweep);
      }
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
      const tipCurl = !groom.cut && groom.fields.tipCurl ? evaluateField(groom.fields.tipCurl, { ...root, distance: travelled }) : 0;
      const cutHeight = groom.cut ? dot(p, groom.cut.normal) - groom.cut.offsetMetres : 0;
      const curlGate = groom.cut ? (1 - smooth(0, .05, cutHeight)) * smooth(-.03, 0, cutHeight) : smooth(.70, .95, travelled / length);
      preferred = add(preferred, mul(normalise([centre[0] - p[0], 0, centre[2] - p[2]]), tipCurl * curlGate));
      // Contact supplies normal support; tangential transport damps changes without locking rest shape outward.
      const direction = iteration === 0 ? normalise(preferred) : normalise(lerp(previousDirection, normalise(preferred), nearHead ? .9 : .55));
      let next = add(p, mul(direction, microStep));
      if (support) {
        const rootLift = (gathering ? 0 : flow.crownLiftMetres) * crown * smooth(0, .012, travelled) * (1 - smooth(.05, .10, travelled));
        const shell = groom.solver.clearanceMetres + .0008 + rootLift;
        const contact = contactAt(support.grid, next);
        const pullToSurface = strategy !== "tangent" && onSupport && travelled > .008 && next[1] > centre[1] - extentY * .25;
        if (contact.distance < shell || pullToSurface && contact.distance < shell + .015)
          next = add(next, mul(contact.normal, shell - contact.distance));
        for (const capsule of support.surface.body ? [] : support.surface.capsules) {
          const collision = capsuleContact(next, capsule);
          if (collision.distance < shell) next = add(next, mul(collision.normal, shell - collision.distance));
        }
      }
      if (gathering && magnitude(sub(next, tieTarget!)) < .004) { next = [...tieTarget!]; holdDistance = travelled + magnitude(sub(next, p)); holdMicroIndex = micro.length; }
      const edge = magnitude(sub(next, p));
      if (!Number.isFinite(edge) || edge < 1e-7) break;
      travelled += edge; previousDirection = normalise(sub(next, p)); p = next;
      micro.push(p); cumulative.push(travelled);
    }
    if (travelled < length) throw Error("The supported sweep could not trace this fibre.");
    if (hold && holdDistance < 0) throw Error("The convergence hold is unreachable with this length and contact surface.");
    const segmentMetres = cumulative.slice(1).map((v, i) => v - cumulative[i]);
    const holds = holdMicroIndex >= 0 ? [{ index: holdMicroIndex, position: tieTarget! }] : undefined;
    return styledPath({ root, points: micro, intrinsicMetres: length, segmentMetres, ...(holds ? { holds } : {}) }, waves, spread, phase, support?.grid, groom.solver.clearanceMetres, groom.solver.intervals);
  }) };
}

/** Apply continuous fields at solver resolution; do not integrate contact-gradient noise into arclength. */
function styledPath(path: import("./types").HairPath, waves: number, spread: number, phase: number, grid: DistanceGrid | undefined, clearance: number, intervals: number): import("./types").HairPath {
  const hold = path.holds?.[0], cumulative = [0], points: Vec3[] = [[...path.points[0]]]; let distance = 0;
  const holdDistance = hold ? path.segmentMetres!.slice(0, hold.index).reduce((sum, v) => sum + v, 0) : -1;
  for (let j = 1; j < path.points.length; j++) {
    distance += path.segmentMetres![j - 1];
    const base = path.points[j], tail = hold ? distance - holdDistance : distance;
    const gate = hold ? smooth(.025, .12, tail) : smooth(.12, .25, distance), angle = phase + tail * Math.PI * 2 / .22;
    let p = add(base, [waves * gate * Math.sin(angle), 0, waves * gate * Math.cos(angle) * .45]);
    if (grid) {
      const contact = contactAt(grid, base);
      const layer = hold ? 0 : spread * (path.root.index % 3) / 3 * smooth(.01, .06, distance) * (1 - smooth(.02, .04, contact.distance));
      p = add(p, mul(contact.normal, layer));
      for (let pass = 0; pass < 3; pass++) { const hit = contactAt(grid, p); if (hit.distance >= clearance + .0008) break; p = add(p, mul(hit.normal, clearance + .0008 - hit.distance)); }
    }
    if (j === hold?.index) p = [...hold.position];
    points.push(p); cumulative.push(cumulative[j - 1] + magnitude(sub(p, points[j - 1])));
  }
  const length = path.intrinsicMetres, holdAt = hold ? cumulative[hold.index] : -1;
  if (hold && holdAt >= length) throw Error("The styled convergence hold exceeds the intrinsic length.");
  if (cumulative.at(-1)! < length) {
    const last = points.at(-1)!; points.push(add(last, mul(normalise(sub(last, points.at(-2)!)), length - cumulative.at(-1)!))); cumulative.push(length);
  }
  const sampleAt = (wanted: number) => {
    let lo = 0, hi = cumulative.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (cumulative[mid] < wanted) lo = mid; else hi = mid; }
    return lerp(points[lo], points[hi], (wanted - cumulative[lo]) / (cumulative[hi] - cumulative[lo]));
  };
  const segment = (a: number, b: number) => {
    const pa = sampleAt(a), pb = sampleAt(b), edge = sub(pb, pa), squared = dot(edge, edge);
    let deviation = 0, split = (a + b) / 2;
    for (let j = 1; j < cumulative.length - 1; j++) if (cumulative[j] > a && cumulative[j] < b) {
      const t = clamp(dot(sub(points[j], pa), edge) / (squared || 1)), d = magnitude(sub(points[j], add(pa, mul(edge, t))));
      if (d > deviation) { deviation = d; split = cumulative[j]; }
    }
    let score = Math.max(deviation / .00075, (b - a) / .022);
    if (deviation / .00075 < (b - a) / .022) split = (a + b) / 2;
    if (grid) { const hit = segmentContact(grid, pa, pb); if (hit.distance < clearance + .0003) score = 100 + (clearance + .0003 - hit.distance) / .0005; }
    return { a, b, score, split: b - a >= .004 ? clamp(split, a + .002, b - .002) : (a + b) / 2 };
  };
  const breaks = hold ? [0, holdAt, length] : [0, length], segments = breaks.slice(1).map((b, i) => segment(breaks[i], b));
  while (segments.length < intervals) {
    segments.sort((a, b) => b.score - a.score || a.a - b.a);
    const worst = segments[0]; if (worst.score <= 1) break;
    if (worst.b - worst.a < .004) { worst.score = 0; continue; }
    segments.splice(0, 1, segment(worst.a, worst.split), segment(worst.split, worst.b));
  }
  segments.sort((a, b) => a.a - b.a);
  const distances = [...segments.map(s => s.a), length], styled = distances.map(sampleAt);
  const holdIndex = hold ? distances.indexOf(holdAt) : -1;
  if (hold) styled[holdIndex] = [...hold.position];
  return { ...path, points: styled, segmentMetres: distances.slice(1).map((v, i) => v - distances[i]), ...(hold ? { holds: [{ ...hold, index: holdIndex }] } : {}) };
}

/** Explicit continuation state preserves physical routing; identical complete inputs remain deterministic. */
export function retargetContinuation(previous: { groom: Groom; paths: Paths }, groom: Groom, roots: Root[]): Paths | null {
  if (previous.groom.scalp.resource !== groom.scalp.resource || previous.groom.scalp.topology !== groom.scalp.topology || previous.groom.population.seed !== groom.population.seed || JSON.stringify(previous.groom.graph) !== JSON.stringify(groom.graph) || JSON.stringify(previous.groom.flow) !== JSON.stringify(groom.flow) || JSON.stringify(previous.groom.cut) !== JSON.stringify(groom.cut)) return null;
  const old = new Map(previous.paths.paths.map(path => [path.root.id, path]));
  for (const root of roots) { const source = old.get(root.id); if (!source || source.root.triangle !== root.triangle || magnitude(sub(source.root.barycentric, root.barycentric)) > 1e-9) return null; }
  const paths: import("./types").HairPath[] = [];
  for (const root of roots) {
    const source = old.get(root.id)!, desiredLength = evaluateField(groom.fields.length, root), length = source.termination && groom.cut ? Math.min(desiredLength, source.intrinsicMetres) : desiredLength, cumulative = [0];
    for (const step of source.segmentMetres ?? Array(source.points.length - 1).fill(source.intrinsicMetres / (source.points.length - 1))) cumulative.push(cumulative.at(-1)! + step);
    const holdDistances = (source.holds ?? []).map(h => ({ ...h, distance: cumulative[h.index] }));
    if (holdDistances.some(h => h.distance >= length)) return null;
    const sample = (distance: number) => {
      let at = 1; while (at < cumulative.length - 1 && cumulative[at] < distance) at++;
      if (distance > cumulative.at(-1)!) return add(source.points.at(-1)!, mul(normalise(sub(source.points.at(-1)!, source.points.at(-2)!)), distance - cumulative.at(-1)!));
      return lerp(source.points[at - 1], source.points[at], (distance - cumulative[at - 1]) / (cumulative[at] - cumulative[at - 1]));
    };
    const distances = cumulative.filter(d => d < length);
    for (let d = cumulative.at(-1)! + .018; d < length; d += .018) distances.push(d);
    distances.push(length); const points = distances.map(sample);
    while (distances.length > groom.solver.intervals + 1) {
      let best = Infinity, remove = -1;
      for (let i = 1; i < distances.length - 1; i++) {
        if (holdDistances.some(h => h.distance === distances[i])) continue;
        const edge = sub(points[i + 1], points[i - 1]), t = clamp(dot(sub(points[i], points[i - 1]), edge) / (dot(edge, edge) || 1));
        const cost = magnitude(sub(points[i], add(points[i - 1], mul(edge, t)))) + (distances[i] < .32 ? .01 : 0);
        if (cost < best) { best = cost; remove = i; }
      }
      if (remove < 0) return null;
      distances.splice(remove, 1); points.splice(remove, 1);
    }
    const result = { ...source, root, points, intrinsicMetres: length, segmentMetres: distances.slice(1).map((d, i) => d - distances[i]), holds: holdDistances.map(h => ({ index: distances.indexOf(h.distance), position: h.position })) };
    if (length < source.intrinsicMetres - 1e-9) delete result.termination;
    paths.push(result);
  }
  return { paths };
}

export function continuePaths(previous: { groom: Groom; paths: Paths }, groom: Groom, target: Paths, grid: DistanceGrid): Paths | null {
  if (previous.groom.scalp.resource !== groom.scalp.resource || previous.groom.scalp.topology !== groom.scalp.topology || previous.groom.population.seed !== groom.population.seed || JSON.stringify(previous.groom.graph) !== JSON.stringify(groom.graph)) return null;
  const old = new Map(previous.paths.paths.map(path => [path.root.id, path]));
  for (const path of target.paths) {
    const source = old.get(path.root.id);
    if (!source || source.root.triangle !== path.root.triangle || magnitude(sub(source.root.barycentric, path.root.barycentric)) > 1e-9) return null;
  }
  return { paths: target.paths.map(path => {
    const source = old.get(path.root.id)!, cumulative = [0];
    const steps = source.segmentMetres ?? Array(source.points.length - 1).fill(source.intrinsicMetres / (source.points.length - 1));
    for (const step of steps) cumulative.push(cumulative.at(-1)! + step);
    const waveDelta = evaluateField(groom.fields.waves, path.root) - evaluateField(previous.groom.fields.waves, path.root);
    const spreadDelta = evaluateField(groom.fields.spread, path.root) - evaluateField(previous.groom.fields.spread, path.root);
    const phase = Math.floor(path.root.uv[0] * 18) * .75 + Math.floor(path.root.uv[1] * 4) * .25;
    const hold = path.holds?.[0], holdDistance = hold ? path.segmentMetres!.slice(0, hold.index).reduce((sum, v) => sum + v, 0) : -1;
    let distance = 0, at = 1;
    const points = path.points.map((point, j) => {
      if (!j) return [...point] as Vec3;
      distance += path.segmentMetres![j - 1];
      while (at < cumulative.length - 1 && cumulative[at] < distance) at++;
      let p: Vec3;
      if (distance > cumulative.at(-1)!) p = add(source.points.at(-1)!, mul(normalise(sub(source.points.at(-1)!, source.points.at(-2)!)), distance - cumulative.at(-1)!));
      else p = lerp(source.points[at - 1], source.points[at], (distance - cumulative[at - 1]) / (cumulative[at] - cumulative[at - 1]));
      const tail = hold ? distance - holdDistance : distance, gate = hold ? smooth(.025, .12, tail) : smooth(.12, .25, distance), angle = phase + tail * Math.PI * 2 / .22;
      p = add(p, [waveDelta * gate * Math.sin(angle), 0, waveDelta * gate * Math.cos(angle) * .45]);
      const contact = contactAt(grid, p), layer = hold ? 0 : spreadDelta * (path.root.index % 3) / 3 * smooth(.01, .06, distance) * (1 - smooth(.02, .04, contact.distance));
      p = add(p, mul(contact.normal, layer));
      for (let pass = 0; pass < 3; pass++) { const hit = contactAt(grid, p); if (hit.distance >= groom.solver.clearanceMetres + .0005) break; p = add(p, mul(hit.normal, groom.solver.clearanceMetres + .0005 - hit.distance)); }
      if (path.termination && j === path.points.length - 1) { const height = dot(p, path.termination.normal) - path.termination.offsetMetres; p = sub(p, mul(path.termination.normal, height)); }
      return j === hold?.index ? [...hold.position] as Vec3 : p;
    });
    return { ...path, points };
  }) };
}

/** One deterministic compliant-constraint batch; the process adapter yields between steps. */
export function drapeStep(groom: Groom, result: Paths, rest: Paths, grid: DistanceGrid, capsules: Capsule[], down: Vec3, active?: readonly number[]): void {
  const dt2 = groom.solver.stepSeconds ** 2, clearance = groom.solver.clearanceMetres + .0005;
  for (let p = 0; p < result.paths.length; p++) {
    const path = result.paths[p], target = rest.paths[p], n = path.points.length - 1, step = path.intrinsicMetres / n;
    if (active && !active.includes(path.root.index)) continue;
    const stiffness = clamp(evaluateField(groom.fields.stiffness, path.root));
    const segmentLengths = target.segmentMetres ?? Array(n).fill(step) as number[];
    const distances = [0]; for (const length of segmentLengths) distances.push(distances.at(-1)! + length);
    const holds = new Map((target.holds ?? []).map(h => [h.index, h.position]));
    const pinned = new Set([0, ...holds.keys()]);
    const pin = () => {
      path.points[0] = [...target.points[0]]; for (const [index, position] of holds) path.points[index] = [...position];
      if (path.termination) { const height = dot(path.points[n], path.termination.normal) - path.termination.offsetMetres; path.points[n] = sub(path.points[n], mul(path.termination.normal, height)); }
    };
    const lambdas = new Float64Array(n), bend = Array.from({ length: n }, () => [0, 0, 0] as Vec3);
    for (let j = 1; j <= n; j++) if (!holds.has(j)) path.points[j] = add(path.points[j], mul(down, 9.81 * dt2 * .15));
    pin();
    for (let iteration = 0; iteration < groom.solver.iterations; iteration++) {
      for (let j = 1; j <= n; j++) {
        // Vector rest-edge bending, scaled compliance and accumulated multiplier, pinned root inverse mass zero.
        const a = path.points[j - 1], b = path.points[j], restEdge = sub(target.points[j], target.points[j - 1]);
        const error = sub(sub(b, a), restEdge), wa = j === 1 || holds.has(j - 1) ? 0 : 1, wb = holds.has(j) ? 0 : 1, alpha = ((1 - stiffness) * .00003 + smooth(.01, .03, distances[j]) * .015) / dt2;
        const dl = mul(add(error, mul(bend[j - 1], alpha)), -1 / (wa + wb + alpha));
        bend[j - 1] = add(bend[j - 1], dl);
        if (!holds.has(j)) path.points[j] = add(b, dl); if (wa) path.points[j - 1] = sub(a, dl);
      }
      for (let j = 1; j <= n; j++) {
        const delta = sub(path.points[j], path.points[j - 1]), length = magnitude(delta), wa = j === 1 || holds.has(j - 1) ? 0 : 1, wb = holds.has(j) ? 0 : 1, alpha = 1e-9 / dt2;
        const direction = mul(delta, 1 / (length || 1)), tipGradient = path.termination && j === n ? sub(direction, mul(path.termination.normal, dot(direction, path.termination.normal))) : direction;
        const dl = (-(length - segmentLengths[j - 1]) - alpha * lambdas[j - 1]) / (wa + wb * dot(tipGradient, tipGradient) + alpha);
        lambdas[j - 1] += dl; if (wb) path.points[j] = add(path.points[j], mul(tipGradient, dl));
        if (wa) path.points[j - 1] = sub(path.points[j - 1], mul(direction, dl));
      }
      projectContact(path.points, grid, capsules, clearance, pinned);
      pin();
      if (iteration >= 1 && pathSettled(path.points, segmentLengths, grid, capsules, groom.solver.clearanceMetres)) break;
    }
    // Root-to-tip sweep preserves intrinsic lengths after contact. Repeated projection resolves coupled constraints.
    for (let pass = 0; pass < 16; pass++) {
      for (let j = 1; j <= n; j++) if (!holds.has(j)) {
        const a = path.points[j - 1];
        if (path.termination && j === n) {
          const normal = path.termination.normal, height = dot(a, normal) - path.termination.offsetMetres, centre = sub(a, mul(normal, height));
          let direction = sub(sub(path.points[j], a), mul(normal, dot(sub(path.points[j], a), normal)));
          if (magnitude(direction) < 1e-9) direction = Math.abs(normal[0]) < .9 ? sub([1, 0, 0], mul(normal, normal[0])) : sub([0, 0, 1], mul(normal, normal[2]));
          path.points[j] = add(centre, mul(normalise(direction), Math.sqrt(Math.max(0, segmentLengths[j - 1] ** 2 - height ** 2))));
        } else path.points[j] = add(a, mul(normalise(sub(path.points[j], a)), segmentLengths[j - 1]));
      }
      pin();
      for (let j = n; j > 1; j--) if (!holds.has(j - 1)) path.points[j - 1] = add(path.points[j], mul(normalise(sub(path.points[j - 1], path.points[j])), segmentLengths[j - 1]));
      projectContact(path.points, grid, capsules, clearance, pinned);
      pin();
      if (pathSettled(path.points, segmentLengths, grid, capsules, groom.solver.clearanceMetres)) break;
    }
  }
  // Small deterministic bundle repulsion: no random topology changes and no root displacement.
  for (let p = 1; p < result.paths.length; p++) {
    const a = result.paths[p - 1], b = result.paths[p];
    if (active && !active.includes(b.root.index)) continue;
    if (b.holds?.length) continue;
    for (let j = 2; j < Math.min(a.points.length, b.points.length); j++) {
      const delta = sub(b.points[j], a.points[j]), d = magnitude(delta);
      if (d > 1e-8 && d < .0002) b.points[j] = add(b.points[j], mul(delta, (.0002 - d) / d));
    }
  }
}
function pathSettled(points: Vec3[], steps: number[], grid: DistanceGrid, capsules: Capsule[], clearance: number, lengthRatio = .008) {
  for (let j = 1; j < points.length; j++) {
    if (Math.abs(magnitude(sub(points[j], points[j - 1])) / steps[j - 1] - 1) > lengthRatio) return false;
    if (segmentContact(grid, points[j - 1], points[j]).distance < clearance) return false;
    for (const capsule of capsules) if (segmentCapsuleContact(points[j - 1], points[j], capsule).distance < clearance) return false;
  }
  return true;
}
export function unsettledPaths(result: Paths, rest: Paths, grid: DistanceGrid, clearance: number, capsules: Capsule[]): number[] {
  return result.paths.filter((path, i) => !pathSettled(path.points, rest.paths[i].segmentMetres ?? Array(path.points.length - 1).fill(path.intrinsicMetres / (path.points.length - 1)), grid, capsules, clearance, .02)).map(path => path.root.index);
}
function projectContact(points: Vec3[], grid: DistanceGrid, capsules: Capsule[], clearance: number, pinned: Set<number>) {
  for (let j = 1; j < points.length; j++) {
    const contact = contactAt(grid, points[j]);
    if (!pinned.has(j) && contact.distance < clearance) points[j] = add(points[j], mul(contact.normal, clearance - contact.distance));
    for (const capsule of capsules) { const c = capsuleContact(points[j], capsule); if (!pinned.has(j) && c.distance < clearance) points[j] = add(points[j], mul(c.normal, clearance - c.distance)); }
    const segment = segmentContact(grid, points[j - 1], points[j]);
    if (segment.distance < clearance) {
      const wa = pinned.has(j - 1) ? 0 : 1, wb = pinned.has(j) ? 0 : 1, a = 1 - segment.t, b = segment.t, denominator = wa * a * a + wb * b * b;
      if (denominator > 1e-9) {
        const delta = mul(segment.normal, (clearance - segment.distance) / denominator);
        if (wa) points[j - 1] = add(points[j - 1], mul(delta, a));
        if (wb) points[j] = add(points[j], mul(delta, b));
      }
    }
    for (const capsule of capsules) {
      const c = segmentCapsuleContact(points[j - 1], points[j], capsule);
      if (c.distance >= clearance) continue;
      const wa = pinned.has(j - 1) ? 0 : 1, wb = pinned.has(j) ? 0 : 1, a = 1 - c.t, b = c.t, denominator = wa * a * a + wb * b * b;
      if (denominator < 1e-9) continue;
      const correction = mul(c.normal, (clearance - c.distance) / denominator);
      if (wa) points[j - 1] = add(points[j - 1], mul(correction, a));
      if (wb) points[j] = add(points[j], mul(correction, b));
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
export function cutPaths(groom: Groom, source: Paths, grid?: DistanceGrid): Paths {
  if (!groom.cut) return source;
  const { normal, offsetMetres } = groom.cut;
  return { paths: source.paths.map(path => {
    if (path.termination && path.termination.offsetMetres === offsetMetres && path.termination.normal.every((v, k) => v === normal[k])) return path;
    const points: Vec3[] = [[...path.points[0]]], segmentMetres: number[] = [];
    let trimmed = false;
    const step = path.intrinsicMetres / (path.points.length - 1);
    for (let j = 1; j < path.points.length; j++) {
      const a = path.points[j - 1], b = path.points[j], da = dot(a, normal) - offsetMetres, db = dot(b, normal) - offsetMetres;
      const expected = path.segmentMetres?.[j - 1] ?? step;
      if (da > 0 && db <= 0) { const t = da / (da - db); points.push(lerp(a, b, t)); segmentMetres.push(expected * t); trimmed = true; break; }
      points.push([...b]); segmentMetres.push(expected);
    }
    if (trimmed && points.length > 2 && segmentMetres.at(-1)! < groom.solver.clearanceMetres * 2) {
      const tail = segmentMetres.pop()!; segmentMetres[segmentMetres.length - 1] += tail; points.splice(points.length - 2, 1);
    }
    let length = segmentMetres.reduce((a, b) => a + b, 0);
    if (length < .005) throw Error("The cut surface removes this fibre's entire styled length.");
    if (trimmed && groom.fields.tipCurl) {
      const original = points.map(p => [...p] as Vec3), originalSteps = [...segmentMetres], originalLength = length;
      const curl = evaluateField(groom.fields.tipCurl, { ...path.root, distance: length }), angle = path.root.uv[0] * Math.PI * 2 - Math.PI;
      const inward: Vec3 = [-Math.sin(angle), 0, Math.cos(angle)], direction = normalise(sub(inward, mul(normal, dot(inward, normal))));
      const band = Math.min(.04, length * .25); let distance = 0;
      for (let j = 1; j < points.length; j++) {
        distance += originalSteps[j - 1]; const gate = smooth(originalLength - band, originalLength, distance), delta = mul(direction, .012 * Math.sin(curl) * gate * gate);
        let weight = 1;
        if (grid && contactAt(grid, add(original[j], delta)).distance < groom.solver.clearanceMetres + .0003) {
          let lo = 0, hi = 1;
          for (let pass = 0; pass < 8; pass++) { const mid = (lo + hi) / 2; if (contactAt(grid, add(original[j], mul(delta, mid))).distance >= groom.solver.clearanceMetres + .0003) lo = mid; else hi = mid; }
          weight = lo;
        }
        points[j] = add(original[j], mul(delta, weight));
      }
      for (let j = 1; j < points.length; j++) segmentMetres[j - 1] = magnitude(sub(points[j], points[j - 1]));
      length = segmentMetres.reduce((a, b) => a + b, 0);
      if (length > path.intrinsicMetres) { points.splice(0, points.length, ...original); segmentMetres.splice(0, segmentMetres.length, ...originalSteps); length = originalLength; }
    }
    const holds = path.holds?.filter(h => h.index < points.length);
    return { ...path, points, segmentMetres, intrinsicMetres: length, ...(holds ? { holds } : {}), ...(trimmed ? { termination: { normal, offsetMetres } } : {}) };
  }) };
}
