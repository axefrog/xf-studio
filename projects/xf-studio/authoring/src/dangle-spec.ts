/**
 * A dangle component's rig and simulation, read from its own `.rig` and `.animgraph` the way the game reads them (knowledge/hair-physics.md
 * §2): pure, no Three, no host state, and it knows no hairstyle, item or mod.
 *
 * A hairstyle (or a worn item) with physics carries one `entAnimatedComponent` per swinging part: a small rig (a copy of V's upper-body
 * joints plus chains of `dyng_*` joints) and a graph whose one working node, `animAnimNode_Dangle`, holds an
 * `animDangleConstraint_SimulationDyng` [resource]. `compileDangleSpec` turns the two documents into a compact spec: the rig's joints and
 * reference pose, and every simulation parameter with the class defaults WolvenKit writes for a field a file leaves out
 * (`animDyngParticle`: `mass` 1, `damping` 1, `isFree` true, …) [source: WolvenKit `animDyng*.cs`]. `dangle-solver.ts` runs it.
 *
 * Anything the executable read (knowledge §5) doesn't cover is reported and the chain is left rigid (`simulation: null`), never guessed:
 * another simulation class, a graph that isn't the five-node spine, the unread transform flags, JSON collision shapes, box or X/Y-capsule
 * shapes, directed particle projection, cone capsules and zero-radius ellipsoids. The rig alone still gives the rigid chains (P1).
 *
 * Space: the game's model space (Z up), the rig's own frames. Transforms are `[tx, ty, tz, qx, qy, qz, qw]`; scale is taken as 1 (every
 * dangle rig inspected has unit scale; a rig that doesn't is noted).
 */
import { asArray, cname, HandleScope, isObject, type Json, type JsonObject } from "./red-json";

export const DANGLE_SPEC = "xfs/dangle-spec-1";
/** Bounds on what a spec may hold (a graph is data from a mod as much as from the game). */
export const DANGLE_LIMITS = Object.freeze({ joints: 512, particles: 256, constraints: 2048, shapes: 64, notes: 16 });

export type Vec3 = [number, number, number];
/** A rigid transform: translation then rotation quaternion `[x, y, z, w]`. */
export type Transform = [number, number, number, number, number, number, number];
export type ProjectionKind = "disabled" | "shortest" | "directed";
export type DangleParticle = {
  /** Rig joint index. */
  joint: number; free: boolean; mass: number; damping: number; pull: number;
  radius: number; height: number; axis: Vec3; projection: ProjectionKind;
};
export type LinkKind = "fixed" | "variable" | "greater" | "closer";
export type ConeKind = "cone" | "hinge" | "half";
export type DangleConstraint =
  /** `a`, `b`: particle indices (`bone1`, `bone2`). Bounds in percent of the rest length. */
  | { kind: "link"; a: number; b: number; type: LinkKind; lower: number; upper: number; lookAt: Vec3 }
  /** `constrained`, `attachment`: particle indices. `halfAngle` in degrees. */
  | { kind: "cone"; constrained: number; attachment: number; frame: Transform; type: ConeKind; halfAngle: number; projection: ProjectionKind;
    radius: number; height: number }
  | { kind: "ellipsoid"; particle: number; frame: Transform; radius: number; scale1: number; scale2: number };
/** A rounded box on a rig joint: half extents and corner radius (hair uses only Z capsules). */
export type DangleShape = { joint: number; frame: Transform; radius: number; extents: Vec3 };
export type DangleSimulation = {
  substepTime: number; iterations: number; alpha: number; lookAt: boolean;
  /** `gravityWS`: gravity is (0, 0, −gravity) in world space. */
  gravity: number;
  /** `externalForceWS`, and whether `externalForceWsLink` replaces it with a graph input (the preview feeds that input's default, zero). */
  externalForce: Vec3; externalLinked: boolean;
  /** In file order. */
  particles: DangleParticle[];
  /** The Multi's `innerConstraints`, flattened, in file order. */
  constraints: DangleConstraint[];
  shapes: DangleShape[];
};
export type DangleSpec = {
  schema: typeof DANGLE_SPEC;
  /** Depot paths of the rig and graph it was read from. */
  rig: string; graph: string;
  /** The rig's joints: name, parent index (−1 for a root) and reference transform relative to the parent. */
  joints: { name: string; parent: number; local: Transform }[];
  /** Each joint's reference transform in model space (`referencePoseMS`, else the composed `boneTransforms`). */
  reference: Transform[];
  /** Null: the chains follow their rig parents rigidly (the graph isn't one the solver runs; `notes` say why). */
  simulation: DangleSimulation | null;
  /** Plain notes on what isn't simulated, for the record. */
  notes: string[];
};

export class DangleSpecError extends Error {}

const num = (value: Json | undefined, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const bool = (value: Json | undefined, fallback: boolean) => typeof value === "boolean" ? value : typeof value === "number" ? value !== 0 : fallback;
const vec3 = (value: Json | undefined, fallback: Vec3): Vec3 => isObject(value) ? [num(value.X, fallback[0]), num(value.Y, fallback[1]), num(value.Z, fallback[2])] : fallback;
/** A `QsTransform` as a rigid transform (scale left out; `scaled` says whether it wasn't 1). */
function transform(value: Json | undefined): { t: Transform; scaled: boolean } {
  const t = isObject(value) && isObject(value.Translation) ? value.Translation : {};
  const r = isObject(value) && isObject(value.Rotation) ? value.Rotation : {};
  const s = isObject(value) && isObject(value.Scale) ? value.Scale : {};
  let q = [num(r.i), num(r.j), num(r.k), num(r.r, 1)];
  const n = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!) || 1;
  q = q.map(x => x / n);
  const scaled = [num(s.X, 1), num(s.Y, 1), num(s.Z, 1)].some(x => Math.abs(x - 1) > 1e-4);
  return { t: [num(t.X), num(t.Y), num(t.Z), q[0]!, q[1]!, q[2]!, q[3]!], scaled };
}
/** An enum stored as its member name or its value. */
function member<T extends string>(value: Json | undefined, names: readonly string[], kinds: readonly T[], fallback: T): T | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number") return kinds[value] ?? null;
  const text = cname(value);
  const index = names.indexOf(text);
  return index >= 0 ? kinds[index]! : null;
}
const PARTICLE_PROJECTION = ["Disabled", "ShortestPath", "Directed"];
const PENDULUM_PROJECTION = ["Disabled", "ShortestPathRotational", "DirectedRotational"];
const PROJECTIONS: readonly ProjectionKind[] = ["disabled", "shortest", "directed"];
const LINK_TYPES = ["KeepFixedDistance", "KeepVariableDistance", "Greater", "Closer"];
const LINK_KINDS: readonly LinkKind[] = ["fixed", "variable", "greater", "closer"];
const CONE_TYPES = ["Cone", "HingePlane", "HalfCone"];
const CONE_KINDS: readonly ConeKind[] = ["cone", "hinge", "half"];

/** The graph nodes the dangle spine may pass besides the one dangle node (knowledge §2.3). */
const SPINE = new Set(["animAnimNode_Output", "animAnimNode_PoseMsToLs", "animAnimNode_PoseLsToMs", "animAnimNode_SharedMetaPose",
  "animAnimNode_ReferencePoseTerminator", "animAnimNode_SkipPerformanceModeBegin", "animAnimNode_SkipPerformanceModeEnd"]);

/** Compose two rigid transforms: `a ∘ b` (b in a's frame). */
export function composeTransforms(a: readonly number[], b: readonly number[]): Transform {
  const [ax, ay, az, aw] = [a[3]!, a[4]!, a[5]!, a[6]!];
  const [bx, by, bz] = [b[0]!, b[1]!, b[2]!];
  // t = a.t + a.q · b.t
  const tx = aw * bx + ay * bz - az * by, ty = aw * by + az * bx - ax * bz, tz = aw * bz + ax * by - ay * bx, tw = -ax * bx - ay * by - az * bz;
  const rx = tx * aw - tw * ax - ty * az + tz * ay, ry = ty * aw - tw * ay - tz * ax + tx * az, rz = tz * aw - tw * az - tx * ay + ty * ax;
  const [qx, qy, qz, qw] = [b[3]!, b[4]!, b[5]!, b[6]!];
  return [a[0]! + rx, a[1]! + ry, a[2]! + rz,
    aw * qx + ax * qw + ay * qz - az * qy, aw * qy - ax * qz + ay * qw + az * qx, aw * qz + ax * qy - ay * qx + az * qw, aw * qw - ax * qx - ay * qy - az * qz];
}

/**
 * Read a dangle component's rig and graph (resolver-shaped JSON documents' root chunks). Throws `DangleSpecError` only when the rig
 * itself can't be read (no joints, bad parents, past the bounds); a graph the solver doesn't run gives `simulation: null` with notes.
 */
export function compileDangleSpec(rig: JsonObject, graph: JsonObject | null, paths: { rig: string; graph: string }): DangleSpec {
  const names = asArray(rig.boneNames).map(cname);
  const parents = asArray(rig.boneParentIndexes).map(value => num(value, -1));
  if (!names.length || names.length > DANGLE_LIMITS.joints || parents.length !== names.length)
    throw new DangleSpecError(`The rig lists ${names.length} bones and ${parents.length} parents.`);
  const locals = asArray(rig.boneTransforms);
  if (locals.length !== names.length) throw new DangleSpecError("The rig has no reference pose for its bones.");
  const notes: string[] = [];
  let scaled = false;
  const joints = names.map((name, i) => {
    const parent = parents[i]!;
    if (!(parent >= -1 && parent < i)) throw new DangleSpecError(`The rig's bone ${name} names parent ${parent}.`);
    const local = transform(locals[i]);
    scaled ||= local.scaled;
    return { name, parent, local: local.t };
  });
  const composed: Transform[] = [];
  for (const joint of joints) composed.push(joint.parent < 0 ? joint.local.slice() as Transform : composeTransforms(composed[joint.parent]!, joint.local));
  const stored = asArray(rig.referencePoseMS);
  const reference = stored.length === names.length ? stored.map(value => transform(value).t) : composed;
  if (scaled) notes.push("The rig scales some of its joints; the preview simulates them unscaled.");
  const spec: DangleSpec = { schema: DANGLE_SPEC, rig: paths.rig, graph: paths.graph, joints, reference, simulation: null, notes };
  if (!graph) { notes.push("Its animation graph couldn't be read, so it hangs still."); return spec; }
  try { spec.simulation = readSimulation(graph, names); }
  catch (error) {
    if (!(error instanceof Unsupported)) throw error;
    notes.push(error.message);
  }
  return spec;
}

/** Why a graph is left rigid (a plain line). */
class Unsupported extends Error {}

function readSimulation(graph: JsonObject, names: readonly string[]): DangleSimulation {
  const scope = new HandleScope(graph);
  const root = scope.data(graph.rootNode);
  const output = asArray(root?.nodes).map(item => scope.data(item)).find(node => node?.$type === "animAnimNode_Output");
  if (!output) throw new Unsupported("Its animation graph has no output, so it hangs still.");
  const dangles: JsonObject[] = [];
  const seen = new Set<JsonObject>();
  let node: JsonObject | null = output;
  while (node) {
    if (seen.has(node) || seen.size > 64) throw new Unsupported("Its animation graph loops, so it hangs still.");
    seen.add(node);
    const type: string = String(node.$type ?? "");
    if (type === "animAnimNode_Dangle") dangles.push(node);
    else if (!SPINE.has(type)) throw new Unsupported(`Its animation graph uses ${type.replace(/^animAnimNode_/, "") || "a node"} XF Studio doesn't run yet, so it hangs still.`);
    for (const key of ["inputLinks", "inputs", "poseLinks"]) if (asArray(node[key]).length) throw new Unsupported("Its animation graph blends poses, which XF Studio doesn't run yet, so it hangs still.");
    const link: Json | undefined = type === "animAnimNode_Output" ? node.node : node.inputLink;
    node = isObject(link) ? scope.data(link.node) : null;
  }
  if (dangles.length !== 1) throw new Unsupported(dangles.length ? "Its animation graph chains several simulations, which XF Studio doesn't run yet, so it hangs still."
    : "Its animation graph has no simulation, so it hangs still.");
  const simulation = scope.data(dangles[0]!.dangleConstraint);
  const kind = String(simulation?.$type ?? "");
  if (!simulation || kind !== "animDangleConstraint_SimulationDyng")
    throw new Unsupported(`It uses a ${kind.replace(/^animDangleConstraint_Simulation/, "").toLowerCase() || "different"} simulation XF Studio doesn't run yet, so it hangs still.`);
  // Branches of the solver the executable read didn't cover (knowledge §5.5, §5.7): left rigid rather than guessed.
  for (const flag of ["dangleAltersTransformsOfItsChildren", "parentRotationAltersTransformsOfDangleAndItsChildren",
    "parentRotationAltersTransformsOfNonDanglesAndItsChildren", "HACK_checkDangleTeleport"])
    if (bool(simulation[flag], false)) throw new Unsupported(`Its simulation sets ${flag}, which XF Studio doesn't run yet, so it hangs still.`);
  const json = simulation.jsonCollisionShapes;
  if (isObject(json) && cname(isObject(json.DepotPath) ? json.DepotPath : json) && cname(isObject(json.DepotPath) ? json.DepotPath : json) !== "0")
    throw new Unsupported("Its collision shapes are in a separate file XF Studio doesn't read yet, so it hangs still.");

  const index = new Map<string, number>();
  names.forEach((name, i) => { if (!index.has(name)) index.set(name, i); });
  const jointOf = (value: Json | undefined, what: string) => {
    const name = cname(isObject(value) && "name" in value ? value.name : value);
    const found = index.get(name);
    if (found === undefined) throw new Unsupported(`Its simulation's ${what} names ${name || "no joint"}, which its rig doesn't have, so it hangs still.`);
    return found;
  };
  const container = isObject(simulation.particlesContainer) ? simulation.particlesContainer : {};
  const rawParticles = asArray(container.particles).map(item => scope.data(item) ?? (isObject(item) ? item : null));
  if (!rawParticles.length) throw new Unsupported("Its simulation has no particles, so it hangs still.");
  if (rawParticles.length > DANGLE_LIMITS.particles) throw new Unsupported("Its simulation has more particles than the preview runs, so it hangs still.");
  const particles: DangleParticle[] = rawParticles.map(item => {
    if (!item) throw new Unsupported("Its simulation has a particle XF Studio can't read, so it hangs still.");
    const projection = member(item.projectionType, PARTICLE_PROJECTION, PROJECTIONS, "shortest");
    if (projection === null) throw new Unsupported("Its simulation names a particle projection XF Studio doesn't know, so it hangs still.");
    if (projection === "directed") throw new Unsupported("Its simulation collides particles as directed capsules, which XF Studio doesn't run yet, so it hangs still.");
    const mass = num(item.mass, 1);
    if (!(mass > 0)) throw new Unsupported("Its simulation gives a particle no mass, so it hangs still.");
    return { joint: jointOf(item.bone, "particle"), free: bool(item.isFree, true), mass, damping: num(item.damping, 1), pull: num(item.pullForceFactor),
      radius: num(item.collisionCapsuleRadius), height: num(item.collisionCapsuleHeightExtent), axis: vec3(item.collisionCapsuleAxisLS, [0.5, 0, 0]), projection };
  });
  const particleOf = new Map<number, number>();
  particles.forEach((particle, i) => {
    if (particleOf.has(particle.joint)) throw new Unsupported("Its simulation puts two particles on one joint, so it hangs still.");
    particleOf.set(particle.joint, i);
  });
  const particleAt = (value: Json | undefined, what: string) => {
    const joint = jointOf(value, what), found = particleOf.get(joint);
    if (found === undefined) throw new Unsupported(`Its simulation's ${what} names ${names[joint]}, which has no particle, so it hangs still.`);
    return found;
  };

  const constraints: DangleConstraint[] = [];
  const visit = (value: Json | undefined, depth: number) => {
    const constraint = scope.data(value) ?? (isObject(value) && typeof value.$type === "string" ? value : null);
    if (!constraint) return;
    if (depth > 8) throw new Unsupported("Its simulation nests its constraints too deeply, so it hangs still.");
    const type = String(constraint.$type ?? "");
    if (type === "animDyngConstraintMulti") { for (const inner of asArray(constraint.innerConstraints)) visit(inner, depth + 1); return; }
    if (constraints.length >= DANGLE_LIMITS.constraints) throw new Unsupported("Its simulation has more constraints than the preview runs, so it hangs still.");
    if (type === "animDyngConstraintLink") {
      const kind = member(constraint.linkType, LINK_TYPES, LINK_KINDS, "fixed");
      if (kind === null) throw new Unsupported("Its simulation names a link type XF Studio doesn't know, so it hangs still.");
      const a = particleAt(constraint.bone1, "link"), b = particleAt(constraint.bone2, "link");
      if (a === b) return;
      constraints.push({ kind: "link", a, b, type: kind, lower: num(constraint.lengthLowerBoundRatioPercentage, 100),
        upper: num(constraint.lengthUpperBoundRatioPercentage, 100), lookAt: vec3(constraint.lookAtAxis, [1, 0, 0]) });
    } else if (type === "animDyngConstraintCone") {
      const kind = member(constraint.constraintType, CONE_TYPES, CONE_KINDS, "cone");
      const projection = member(constraint.projectionType, PENDULUM_PROJECTION, PROJECTIONS, "shortest");
      if (kind === null || projection === null) throw new Unsupported("Its simulation names a cone type XF Studio doesn't know, so it hangs still.");
      const radius = num(constraint.collisionCapsuleRadius), height = num(constraint.collisionCapsuleHeightExtent);
      // A cone's own capsule is tested against the shapes with a rotation solve the executable read didn't decode (knowledge §5.4).
      if (projection !== "disabled" && (radius > 0 || height > 0) && asArray(simulation.collisionRoundedShapes).length)
        throw new Unsupported("Its simulation collides cone capsules, which XF Studio doesn't run yet, so it hangs still.");
      constraints.push({ kind: "cone", constrained: particleAt(constraint.constrainedBone, "cone"), attachment: particleAt(constraint.coneAttachmentBone, "cone"),
        frame: transform(constraint.coneTransformLS).t, type: kind, halfAngle: num(constraint.halfOfMaxApertureAngle, 45), projection, radius, height });
    } else if (type === "animDyngConstraintEllipsoid") {
      const radius = num(constraint.constraintRadius, 1);
      if (!(radius > 0)) throw new Unsupported("Its simulation has an ellipsoid of no size, which XF Studio doesn't run yet, so it hangs still.");
      constraints.push({ kind: "ellipsoid", particle: particleAt(constraint.bone, "ellipsoid"), frame: transform(constraint.ellipsoidTransformLS).t, radius,
        scale1: num(constraint.constraintScale1, 1), scale2: num(constraint.constraintScale2, 1) });
    } else throw new Unsupported(`Its simulation uses a ${type.replace(/^animDyngConstraint/, "").toLowerCase() || "different"} constraint XF Studio doesn't run yet, so it hangs still.`);
  };
  visit(simulation.dyngConstraint, 0);

  const rawShapes = asArray(simulation.collisionRoundedShapes).map(item => scope.data(item) ?? (isObject(item) ? item : null));
  if (rawShapes.length > DANGLE_LIMITS.shapes) throw new Unsupported("Its simulation has more collision shapes than the preview runs, so it hangs still.");
  const shapes: DangleShape[] = rawShapes.map(shape => {
    if (!shape) throw new Unsupported("Its simulation has a collision shape XF Studio can't read, so it hangs still.");
    const extents: Vec3 = [num(shape.xBoxExtent), num(shape.yBoxExtent), num(shape.zBoxExtent)];
    // Only spheres and Z capsules were read in the executable (knowledge §5.4).
    if (extents[0] !== 0 || extents[1] !== 0) throw new Unsupported("Its simulation collides with boxes, which XF Studio doesn't run yet, so it hangs still.");
    return { joint: jointOf(shape.bone, "collision shape"), frame: transform(shape.transformLS).t, radius: num(shape.roundedCornerRadius), extents };
  });
  const substepTime = num(simulation.substepTime, 0.01);
  if (!(substepTime > 1e-4 && substepTime <= 1)) throw new Unsupported("Its simulation's substep is out of range, so it hangs still.");
  const link = isObject(container.externalForceWsLink) ? container.externalForceWsLink : null;
  return {
    substepTime, iterations: Math.max(0, Math.min(16, Math.round(num(simulation.solverIterations, 1)))), alpha: Math.max(0, Math.min(1, num(simulation.alpha, 1))),
    lookAt: bool(simulation.rotateParentToLookAtDangle, true), gravity: num(container.gravityWS, 9.81),
    externalForce: vec3(container.externalForceWS, [0, 0, 0]), externalLinked: !!(link && scope.data(link.node)),
    particles, constraints, shapes,
  };
}

/**
 * A spec as the browser reads it back from the host: every index in range, every number finite, within the bounds. Throws
 * `DangleSpecError` on anything else.
 */
export function parseDangleSpec(value: unknown): DangleSpec {
  const fail = (why: string): never => { throw new DangleSpecError(`The dangle spec is invalid: ${why}.`); };
  const s = value as DangleSpec;
  if (!s || s.schema !== DANGLE_SPEC || typeof s.rig !== "string" || typeof s.graph !== "string" || s.rig.length > 512 || s.graph.length > 512) fail("not a spec");
  if (!Array.isArray(s.joints) || !s.joints.length || s.joints.length > DANGLE_LIMITS.joints) fail("joint count");
  const n = s.joints.length;
  const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x) ? x : fail("a number");
  const vector = (v: unknown) => Array.isArray(v) && v.length === 3 ? v.map(finite) as Vec3 : fail("a vector");
  const rigid = (v: unknown) => Array.isArray(v) && v.length === 7 ? v.map(finite) as Transform : fail("a transform");
  const list = <T>(items: unknown, max: number, read: (item: any, i: number) => T) => Array.isArray(items) && items.length <= max ? items.map(read) : fail("a list");
  const joints = s.joints.map((j, i) => ({ name: typeof j?.name === "string" && j.name.length <= 256 ? j.name : fail("a name"),
    parent: j?.parent === -1 || (Number.isInteger(j?.parent) && j.parent >= 0 && j.parent < i) ? j.parent : fail("a parent"), local: rigid(j?.local) }));
  const reference = list(s.reference, n, rigid);
  if (reference.length !== n) fail("reference pose");
  const notes = list(s.notes, DANGLE_LIMITS.notes, note => typeof note === "string" && note.length <= 300 ? note : fail("a note"));
  let simulation: DangleSimulation | null = null;
  if (s.simulation !== null) {
    const m = s.simulation;
    if (!m || typeof m !== "object") fail("simulation");
    const joint = (i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < n ? i as number : fail("a joint index");
    const projection = (p: unknown) => PROJECTIONS.includes(p as ProjectionKind) ? p as ProjectionKind : fail("a projection");
    const particles = list(m.particles, DANGLE_LIMITS.particles, p => ({ joint: joint(p?.joint), free: typeof p?.free === "boolean" ? p.free : fail("a flag"),
      mass: finite(p?.mass) > 0 ? p.mass : fail("a mass"), damping: finite(p?.damping), pull: finite(p?.pull), radius: finite(p?.radius), height: finite(p?.height),
      axis: vector(p?.axis), projection: projection(p?.projection) }));
    if (!particles.length || new Set(particles.map(p => p.joint)).size !== particles.length) fail("particles");
    const particle = (i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < particles.length ? i as number : fail("a particle index");
    const constraints = list(m.constraints, DANGLE_LIMITS.constraints, (c): DangleConstraint => {
      switch (c?.kind) {
        case "link": return { kind: "link", a: particle(c.a), b: particle(c.b), type: LINK_KINDS.includes(c.type) ? c.type : fail("a link type"),
          lower: finite(c.lower), upper: finite(c.upper), lookAt: vector(c.lookAt) };
        case "cone": return { kind: "cone", constrained: particle(c.constrained), attachment: particle(c.attachment), frame: rigid(c.frame),
          type: CONE_KINDS.includes(c.type) ? c.type : fail("a cone type"), halfAngle: finite(c.halfAngle), projection: projection(c.projection),
          radius: finite(c.radius), height: finite(c.height) };
        case "ellipsoid": return { kind: "ellipsoid", particle: particle(c.particle), frame: rigid(c.frame), radius: finite(c.radius) > 0 ? c.radius : fail("a radius"),
          scale1: finite(c.scale1), scale2: finite(c.scale2) };
        default: return fail("a constraint");
      }
    });
    const shapes = list(m.shapes, DANGLE_LIMITS.shapes, sh => ({ joint: joint(sh?.joint), frame: rigid(sh?.frame), radius: finite(sh?.radius), extents: vector(sh?.extents) }));
    const substepTime = finite(m.substepTime);
    if (!(substepTime > 1e-4 && substepTime <= 1)) fail("substep");
    const iterations = Number.isInteger(m.iterations) && m.iterations >= 0 && m.iterations <= 16 ? m.iterations : fail("iterations");
    simulation = { substepTime, iterations, alpha: Math.max(0, Math.min(1, finite(m.alpha))), lookAt: typeof m.lookAt === "boolean" ? m.lookAt : fail("a flag"),
      gravity: finite(m.gravity), externalForce: vector(m.externalForce), externalLinked: typeof m.externalLinked === "boolean" ? m.externalLinked : fail("a flag"),
      particles, constraints, shapes };
  }
  return { schema: DANGLE_SPEC, rig: s.rig, graph: s.graph, joints, reference, simulation, notes };
}
