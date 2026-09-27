/**
 * The game's deformation rig for the body's helper joints (knowledge/body-animation.md): pure, no Three, no host state.
 *
 * The player puppet carries, beside the animated component the body clip plays on (`root`: `woman_base.rig`), secondary animated
 * components whose graphs solve the muscle, twist and corrective joints every body mesh is skinned to (`deformations`:
 * `woman_base_deformations.rig` with `woman_base_deformations.animgraph`) [resource]. A graph of this kind is one linear chain: the
 * shared main pose and the rig's reference pose, into model space, then point, orient and aim constraints, bone offsets, twist
 * distribution, splines, measured "bounce" drivers and translation limits, each writing named transforms, then back to local space.
 * `compileDeformationRig` turns the rig and graph documents into a compact program; `evaluateDeformationRig` runs it on a pose.
 *
 * The node semantics are inferred, not read from engine source [hypothesis]: they reproduce the rig's own A pose (the bind pose every
 * body mesh is skinned in) for 179 of the 181 joints of `woman_base_deformations` within 0.5 mm and 1° when the main joints stand in it,
 * and the other two within 2° (research/animation/deformation-rig-evaluator.md). What only moves away from the reference pose (the twist
 * sign, the bounce slopes, the spline's curve) is checked against the game's intent (twist fractions growing towards the hand), not
 * against captures. Dynamics (`SimpleBounce` delay and smoothing) are left out: a static pose is evaluated at rest.
 */
import { asArray, cname, HandleScope, isObject, type Json, type JsonObject } from "./red-json";

export const DEFORMATION_PROGRAM = "xfs/deformation-program-1";
/** Bounds on what a program may hold (a graph is data from a mod as much as from the game). */
export const DEFORMATION_LIMITS = Object.freeze({ joints: 1024, transforms: 4096, ops: 8192, sources: 16, outputs: 16, tracks: 64 });

/** A 4×4 matrix, column-major (THREE.Matrix4 `elements` order), in the rig's space (the game's: Z up). */
export type Mat4 = number[];
type Vec3 = [number, number, number];
type Axis = 0 | 1 | 2;
/** A transform channel a bounce measures or writes. */
export type Channel = "PosX" | "PosY" | "PosZ" | "RotX" | "RotY" | "RotZ" | "ScaleX" | "ScaleY" | "ScaleZ";

export type DeformationOp =
  /** Transforms the graph adds (`StackTransformsExtender`), placed at their parent times their reference offset. */
  | { op: "extend"; transforms: number[] }
  | { op: "track"; track: number; value: number }
  | { op: "point"; target: number; sources: number[]; weights: number[] }
  | { op: "orient"; target: number; sources: number[]; weights: number[] }
  | { op: "aim"; target: number; aimAt: number; up: number; forward: Vec3; upAxis: Vec3; upVector: Vec3 | null }
  | { op: "set"; target: number; source: number; offset: Mat4 }
  | { op: "twist"; a: number; b: number; axis: Axis; outputs: { target: number; axis: Axis; positive: number; negative: number }[] }
  | { op: "spline"; target: number; start: number; middle: number; end: number; progress: number; track: number | null }
  | { op: "bounce"; start: number; end: number; measure: Channel; offset: number; positive: number; negative: number;
    outputs: { target: number; parent: number; scale: number; channels: { channel: Channel; scale: number }[] }[];
    tracks: { track: number; scale: number }[] }
  | { op: "limit"; target: number; parent: number; min: (number | null)[]; max: (number | null)[] };

export type DeformationProgram = {
  schema: typeof DEFORMATION_PROGRAM;
  /** Depot paths of the rig and the graph it was compiled from. */
  rig: string; graph: string;
  /** Every transform the program addresses: the rig's joints first (in rig order), then the ones the graph adds. */
  transforms: { name: string; parent: number; local: Mat4 }[];
  /** How many of `transforms` are rig joints; each has a bind pose (the rig's A pose, model space). */
  joints: number;
  bind: Mat4[];
  tracks: string[];
  ops: DeformationOp[];
  /** Node types the compiler met and does not evaluate (none on the vanilla rigs), for the record's notes. */
  skipped: string[];
};

const STRUCTURAL = new Set(["animAnimNode_Output", "animAnimNode_PoseMsToLs", "animAnimNode_PoseLsToMs", "animAnimNode_SharedMetaPose",
  "animAnimNode_ReferencePoseTerminator", "animAnimNode_ConditionalSegmentBegin", "animAnimNode_ConditionalSegmentEnd",
  "animAnimNode_SkipPerformanceModeBegin", "animAnimNode_SkipPerformanceModeEnd", "animAnimNode_StackTransformsShrinker",
  "animAnimNode_StackTracksShrinker"]);
const AXES: Record<string, Axis> = { X: 0, Y: 1, Z: 2 };
const CHANNELS = new Set<Channel>(["PosX", "PosY", "PosZ", "RotX", "RotY", "RotZ", "ScaleX", "ScaleY", "ScaleZ"]);

const num = (value: Json | undefined, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const vec3 = (value: Json | undefined, fallback: Vec3): Vec3 => isObject(value) ? [num(value.X, fallback[0]), num(value.Y, fallback[1]), num(value.Z, fallback[2])] : fallback;

/** A `QsTransform` as a matrix. */
export function qsMatrix(value: Json | undefined): Mat4 {
  const t = isObject(value) && isObject(value.Translation) ? value.Translation : {};
  const r = isObject(value) && isObject(value.Rotation) ? value.Rotation : {};
  const s = isObject(value) && isObject(value.Scale) ? value.Scale : {};
  return compose([num(t.X), num(t.Y), num(t.Z)], normalize4([num(r.i), num(r.j), num(r.k), num(r.r, 1)]), [num(s.X, 1), num(s.Y, 1), num(s.Z, 1)]);
}

export class DeformationRigError extends Error {}

/**
 * Compile a rig and its deformation graph (resolver-shaped JSON documents' root chunks) into a program. Refuses (throws
 * `DeformationRigError`) a graph that isn't one chain from its output, names a transform the rig and graph don't define, or passes the
 * bounds; node types it doesn't know are skipped and listed.
 */
export function compileDeformationRig(rig: JsonObject, graph: JsonObject, paths: { rig: string; graph: string }): DeformationProgram {
  const names = asArray(rig.boneNames).map(cname);
  const parents = asArray(rig.boneParentIndexes).map(value => num(value, -1));
  if (!names.length || names.length > DEFORMATION_LIMITS.joints || parents.length !== names.length)
    throw new DeformationRigError(`The rig lists ${names.length} bones and ${parents.length} parents.`);
  const localPose = asArray(rig.aPoseLS).length === names.length ? asArray(rig.aPoseLS) : asArray(rig.boneTransforms);
  if (localPose.length !== names.length) throw new DeformationRigError("The rig has no reference pose for its bones.");
  const transforms = names.map((name, i) => {
    const parent = parents[i]!;
    if (!(parent >= -1 && parent < i)) throw new DeformationRigError(`The rig's bone ${name} names parent ${parent}.`);
    return { name, parent, local: qsMatrix(localPose[i]) };
  });
  const bind: Mat4[] = [];
  const modelPose = asArray(rig.aPoseMS);
  for (let i = 0; i < names.length; i++)
    bind.push(modelPose.length === names.length ? qsMatrix(modelPose[i]) : transforms[i]!.parent < 0 ? transforms[i]!.local : multiply(bind[transforms[i]!.parent]!, transforms[i]!.local));
  const index = new Map<string, number>();
  names.forEach((name, i) => { if (!index.has(name)) index.set(name, i); });
  const tracks: string[] = [];
  const trackIndex = (name: string) => {
    let i = tracks.indexOf(name);
    if (i < 0) { if (tracks.length >= DEFORMATION_LIMITS.tracks) throw new DeformationRigError("The graph adds too many float tracks."); i = tracks.length; tracks.push(name); }
    return i;
  };
  /** A transform named by an `animTransformIndex` (`{name}`) or a bare CName. */
  const nameOf = (value: Json | undefined) => cname(isObject(value) && "name" in value ? value.name : value);
  const at = (value: Json | undefined, what: string): number => {
    const name = nameOf(value);
    const found = index.get(name);
    if (found === undefined) throw new DeformationRigError(`${what} names ${name || "no transform"}, which neither the rig nor the graph defines.`);
    return found;
  };
  const optionalAt = (value: Json | undefined): number | null => {
    const name = nameOf(value);
    return name ? index.get(name) ?? null : null;
  };

  const scope = new HandleScope(graph);
  const chain = graphChain(graph, scope);
  const ops: DeformationOp[] = [], skipped = new Set<string>();
  const sources = (node: JsonObject, what: string): number[] => {
    const list = asArray(node.inputTransforms).map(item => scope.data(item)).map(channel => scope.data(channel?.channel)).map(channel => at(channel?.transformIndex, what));
    if (!list.length || list.length > DEFORMATION_LIMITS.sources) throw new DeformationRigError(`${what} has ${list.length} sources.`);
    return list;
  };
  for (const node of chain) {
    const type = typeof node.$type === "string" ? node.$type : "";
    if (STRUCTURAL.has(type)) continue;
    const kind = type.replace(/^animAnimNode_/, "");
    if (["PointConstraint", "OrientConstraint", "AimConstraint_ObjectUp", "AimConstraint_ObjectRotationUp"].includes(kind) &&
      (node.weightMode !== undefined && node.weightMode !== "Static" || num(node.weight, 1) !== 1)) skipped.add(`${kind} (weighted)`);
    switch (kind) {
      case "StackTransformsExtender": {
        const added: number[] = [];
        for (const info of asArray(node.transformInfos)) {
          if (!isObject(info)) continue;
          const name = cname(info.name), parent = at(info.parentName, `An added transform ${name}`);
          if (transforms.length >= DEFORMATION_LIMITS.transforms) throw new DeformationRigError("The graph adds too many transforms.");
          index.set(name, transforms.length);
          added.push(transforms.length);
          transforms.push({ name, parent, local: qsMatrix(info.referenceTransformLs) });
        }
        if (added.length) ops.push({ op: "extend", transforms: added });
        break;
      }
      case "StackTracksExtender":
        for (const track of asArray(node.newTracks)) if (isObject(track)) ops.push({ op: "track", track: trackIndex(cname(track.name)), value: num(track.referenceValue) });
        break;
      case "PointConstraint": case "OrientConstraint": {
        const list = sources(node, kind), weights = asArray(node.preprocessedWeights).map(value => num(value));
        const expected = kind === "PointConstraint" ? list.length : list.length - 1;
        if (weights.length !== expected) throw new DeformationRigError(`${kind} has ${weights.length} weights for ${list.length} sources.`);
        ops.push({ op: kind === "PointConstraint" ? "point" : "orient", target: at(node.transformIndex, kind), sources: list, weights });
        break;
      }
      case "AimConstraint_ObjectUp": case "AimConstraint_ObjectRotationUp":
        ops.push({ op: "aim", target: at(node.transformIndex, kind), aimAt: at(node.targetTransform, kind), up: at(node.upTransform, kind),
          forward: vec3(node.forwardAxisLS, [1, 0, 0]), upAxis: vec3(node.upAxisLS, [0, 1, 0]),
          upVector: kind === "AimConstraint_ObjectRotationUp" ? vec3(node.upTransformVector, [0, 1, 0]) : null });
        break;
      case "SetBoneTransform":
        for (const entry of asArray(node.entries)) {
          if (!isObject(entry)) continue;
          const source = at(entry.sourceBone, kind), space = optionalAt(entry.offsetSpaceBone);
          if ((entry.setMethod !== undefined && entry.setMethod !== "WholeTransform") || (space !== null && space !== source) ||
            num(entry.offsetToReference) || num(entry.snapToReference)) { skipped.add(`${kind} (${String(entry.setMethod ?? "offset space")})`); continue; }
          ops.push({ op: "set", target: at(entry.transformToChange, kind), source, offset: qsMatrix(entry.offset) });
        }
        break;
      case "TwistConstraint": {
        const outputs = asArray(node.outputs).filter(isObject).map(output => ({ target: at(output.twistedTransform, kind),
          axis: AXES[String(output.twistAxis ?? "X")] ?? 0, positive: num(output.positiveScale, 1), negative: num(output.negativeScale, 1) }));
        if (outputs.length > DEFORMATION_LIMITS.outputs) throw new DeformationRigError(`${kind} has ${outputs.length} outputs.`);
        ops.push({ op: "twist", a: at(node.transformA, kind), b: at(node.transformB, kind), axis: AXES[String(node.frontAxis ?? "X")] ?? 0, outputs });
        break;
      }
      case "SimpleSpline": {
        const track = node.progressMode === "FloatTrack" ? trackIndex(nameOf(node.progressTrack)) : null;
        ops.push({ op: "spline", target: at(node.constrainedTransform, kind), start: at(node.startTransform, kind), middle: at(node.middleTransform, kind),
          end: at(node.endTransform, kind), progress: num(node.defaultProgress, 0.5), track });
        break;
      }
      case "SimpleBounce": {
        const channel = (value: Json | undefined): Channel => { const c = String(value ?? "PosX") as Channel; if (!CHANNELS.has(c)) throw new DeformationRigError(`${kind} names the channel ${c}.`); return c; };
        const outputs = asArray(node.transformOutputs).filter(isObject).map(output => ({ target: at(output.targetTransform, kind), parent: at(output.parentTransform, kind),
          scale: num(output.multiplier, 1), channels: asArray(output.channelEntries).filter(isObject).map(entry => ({ channel: channel(entry.transformChannel), scale: num(entry.multiplier, 1) })) }));
        const measures = new Set(asArray(node.transformOutputs).filter(isObject).map(output => channel(output.targetTransformChannel)));
        if (measures.size > 1) throw new DeformationRigError(`${kind} measures more than one channel.`);
        const trackOutputs = asArray(node.trackOutputs).filter(isObject).map(output => ({ track: trackIndex(nameOf(output.targetTrack)),
          scale: num(output.multiplier, 1) }));
        if (outputs.length > DEFORMATION_LIMITS.outputs || trackOutputs.length > DEFORMATION_LIMITS.outputs) throw new DeformationRigError(`${kind} has too many outputs.`);
        ops.push({ op: "bounce", start: at(node.startTransform, kind), end: at(node.endTransform, kind), measure: [...measures][0] ?? "PosX",
          offset: num(node.offset), positive: num(node.multiplier, 1), negative: num(node.negativeMultiplier, 1), outputs, tracks: trackOutputs });
        break;
      }
      case "TranslationLimit": {
        const target = at(node.constrainedTransform, kind);
        const clamp = (value: Json | undefined, bound: "min" | "max") => isObject(value) && num(bound === "min" ? value.useMin : value.useMax) ? num(value[bound]) : null;
        const axes = [node.limitOnXAxis, node.limitOnYAxis, node.limitOnZAxis];
        ops.push({ op: "limit", target, parent: optionalAt(node.parentTransform) ?? transforms[target]!.parent,
          min: axes.map(axis => clamp(axis, "min")), max: axes.map(axis => clamp(axis, "max")) });
        break;
      }
      default: skipped.add(kind);
    }
    if (ops.length > DEFORMATION_LIMITS.ops) throw new DeformationRigError("The graph has too many nodes.");
  }
  return { schema: DEFORMATION_PROGRAM, rig: paths.rig, graph: paths.graph, transforms, joints: names.length, bind, tracks, ops, skipped: [...skipped].sort() };
}

/** The graph's nodes in evaluation order: from its output back along each node's single pose input, then reversed. */
function graphChain(graph: JsonObject, scope: HandleScope): JsonObject[] {
  const root = scope.data(graph.rootNode);
  const output = asArray(root?.nodes).map(item => scope.data(item)).find(node => node?.$type === "animAnimNode_Output");
  if (!output) throw new DeformationRigError("The graph has no output.");
  const chain: JsonObject[] = [];
  const seen = new Set<JsonObject>();
  let node: JsonObject | null = output;
  while (node) {
    if (seen.has(node) || chain.length > DEFORMATION_LIMITS.ops) throw new DeformationRigError("The graph loops or is too long.");
    seen.add(node); chain.push(node);
    const link: Json | undefined = node.$type === "animAnimNode_Output" ? node.node : node.inputLink;
    node = isObject(link) ? scope.data(link.node) : null;
    if (node && node.$type === "animAnimNode_Output") throw new DeformationRigError("The graph's chain passes an output.");
  }
  // Only the linear chain this rig kind is made of is understood: a node with another pose input (a blend) is refused.
  for (const item of chain) for (const key of ["inputLinks", "inputs", "poseLinks"]) if (asArray(item[key]).length)
    throw new DeformationRigError(`The graph blends poses (${String(item.$type)}), which isn't evaluated.`);
  // It starts at the reference pose; a chain that stops anywhere else ran into a node with other inputs (a switch, a blend, a simulation).
  const first = chain[chain.length - 1]!;
  if (first.$type !== "animAnimNode_ReferencePoseTerminator")
    throw new DeformationRigError(`the graph branches at ${String(first.$type).replace(/^animAnimNode_/, "")}, which isn't a constraint chain`);
  return chain.reverse();
}

/**
 * Run a program. `pose` holds one model-space matrix per program transform (`program.transforms.length`); `driven[i]` says whether rig
 * joint `i` already holds the animated pose (the joints the body clip keys). Every other rig joint is placed at its parent times its
 * reference offset first, as the graph's reference pose does; then the ops write their transforms. Returns the float tracks.
 */
export function evaluateDeformationRig(program: DeformationProgram, pose: Mat4[], driven: readonly boolean[]): number[] {
  const { transforms } = program;
  for (let i = 0; i < program.joints; i++) {
    if (driven[i]) continue;
    const parent = transforms[i]!.parent;
    pose[i] = parent < 0 ? transforms[i]!.local.slice() : multiply(pose[parent]!, transforms[i]!.local);
  }
  const tracks = program.tracks.map(() => 0);
  for (const op of program.ops) {
    switch (op.op) {
      case "extend": for (const i of op.transforms) pose[i] = multiply(pose[transforms[i]!.parent]!, transforms[i]!.local); break;
      case "track": tracks[op.track] = op.value; break;
      case "point": {
        const p: Vec3 = [0, 0, 0];
        op.sources.forEach((source, k) => { const m = pose[source]!, w = op.weights[k]!; p[0] += w * m[12]!; p[1] += w * m[13]!; p[2] += w * m[14]!; });
        const m = pose[op.target]!.slice(); m[12] = p[0]; m[13] = p[1]; m[14] = p[2]; pose[op.target] = m;
        break;
      }
      case "orient": {
        let q = rotationOf(pose[op.sources[0]!]!);
        op.weights.forEach((w, k) => { q = slerp(q, rotationOf(pose[op.sources[k + 1]!]!), w); });
        const m = pose[op.target]!, t: Vec3 = [m[12]!, m[13]!, m[14]!];
        pose[op.target] = compose(t, q, scaleOf(m));
        break;
      }
      case "aim": {
        const m = pose[op.target]!, a = pose[op.aimAt]!, u = pose[op.up]!;
        const forward: Vec3 = [a[12]! - m[12]!, a[13]! - m[13]!, a[14]! - m[14]!];
        const up: Vec3 = op.upVector ? transformDirection(u, op.upVector) : [u[12]! - m[12]!, u[13]! - m[13]!, u[14]! - m[14]!];
        const rotation = look(op.forward, op.upAxis, forward, up);
        if (rotation) pose[op.target] = compose([m[12]!, m[13]!, m[14]!], rotation, scaleOf(m));
        break;
      }
      case "set": pose[op.target] = multiply(pose[op.source]!, op.offset); break;
      case "twist": {
        const angle = twistAngle(multiplyQ(conjugate(rotationOf(pose[op.a]!)), rotationOf(pose[op.b]!)), op.axis);
        for (const output of op.outputs) {
          const axis: Vec3 = [0, 0, 0]; axis[output.axis] = 1;
          pose[output.target] = multiply(pose[output.target]!, compose([0, 0, 0], axisAngle(axis, (angle >= 0 ? output.positive : output.negative) * angle), [1, 1, 1]));
        }
        break;
      }
      case "spline": {
        const u = op.track === null ? op.progress : tracks[op.track]!;
        const p0 = pose[op.start]!, p1 = pose[op.middle]!, p2 = pose[op.end]!, m = pose[op.target]!.slice();
        for (let k = 0; k < 3; k++) m[12 + k] = (1 - u) * (1 - u) * p0[12 + k]! + 2 * (1 - u) * u * p1[12 + k]! + u * u * p2[12 + k]!;
        pose[op.target] = m;
        break;
      }
      case "bounce": {
        const relative = multiply(invert(pose[op.start]!), pose[op.end]!);
        const x = channelOf(relative, op.measure), value = op.offset + (x >= 0 ? op.positive : op.negative) * x;
        for (const output of op.outputs) {
          const parent = pose[output.parent]!;
          let local = multiply(invert(parent), pose[output.target]!);
          for (const entry of output.channels) local = withChannel(local, entry.channel, value * output.scale * entry.scale);
          pose[output.target] = multiply(parent, local);
        }
        for (const output of op.tracks) tracks[output.track] = value * output.scale;
        break;
      }
      case "limit": {
        const parent = op.parent < 0 ? identity() : pose[op.parent]!;
        const local = multiply(invert(parent), pose[op.target]!);
        for (let k = 0; k < 3; k++) {
          if (op.min[k] !== null) local[12 + k] = Math.max(local[12 + k]!, op.min[k]!);
          if (op.max[k] !== null) local[12 + k] = Math.min(local[12 + k]!, op.max[k]!);
        }
        pose[op.target] = multiply(parent, local);
        break;
      }
    }
  }
  return tracks;
}

// ---- small matrix and quaternion helpers (column-major 4×4; quaternions [x, y, z, w]) ----
type Quat = [number, number, number, number];
export const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
  return out;
}
/** Inverse of an affine matrix. */
export function invert(m: Mat4): Mat4 {
  const [a, b, c, , d, e, f, , g, h, i] = m as [number, number, number, number, number, number, number, number, number, number, number];
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return identity();
  const inv = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det,
    (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
  const t = [m[12]!, m[13]!, m[14]!];
  return [inv[0]!, inv[1]!, inv[2]!, 0, inv[3]!, inv[4]!, inv[5]!, 0, inv[6]!, inv[7]!, inv[8]!, 0,
    -(inv[0]! * t[0]! + inv[3]! * t[1]! + inv[6]! * t[2]!), -(inv[1]! * t[0]! + inv[4]! * t[1]! + inv[7]! * t[2]!), -(inv[2]! * t[0]! + inv[5]! * t[1]! + inv[8]! * t[2]!), 1];
}
function normalize4(q: Quat): Quat { const n = Math.hypot(...q) || 1; return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; }
export function compose(t: Vec3, q: Quat, s: Vec3): Mat4 {
  const [x, y, z, w] = q;
  return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, t[0], t[1], t[2], 1];
}
function scaleOf(m: Mat4): Vec3 { return [Math.hypot(m[0]!, m[1]!, m[2]!), Math.hypot(m[4]!, m[5]!, m[6]!), Math.hypot(m[8]!, m[9]!, m[10]!)]; }
function rotationOf(m: Mat4): Quat {
  const s = scaleOf(m);
  const r = (row: number, col: number) => m[col * 4 + row]! / (s[col] || 1);
  const trace = r(0, 0) + r(1, 1) + r(2, 2);
  let q: Quat;
  if (trace > 0) { const k = Math.sqrt(trace + 1) * 2; q = [(r(2, 1) - r(1, 2)) / k, (r(0, 2) - r(2, 0)) / k, (r(1, 0) - r(0, 1)) / k, k / 4]; }
  else if (r(0, 0) > r(1, 1) && r(0, 0) > r(2, 2)) { const k = Math.sqrt(1 + r(0, 0) - r(1, 1) - r(2, 2)) * 2; q = [k / 4, (r(0, 1) + r(1, 0)) / k, (r(0, 2) + r(2, 0)) / k, (r(2, 1) - r(1, 2)) / k]; }
  else if (r(1, 1) > r(2, 2)) { const k = Math.sqrt(1 + r(1, 1) - r(0, 0) - r(2, 2)) * 2; q = [(r(0, 1) + r(1, 0)) / k, k / 4, (r(1, 2) + r(2, 1)) / k, (r(0, 2) - r(2, 0)) / k]; }
  else { const k = Math.sqrt(1 + r(2, 2) - r(0, 0) - r(1, 1)) * 2; q = [(r(0, 2) + r(2, 0)) / k, (r(1, 2) + r(2, 1)) / k, k / 4, (r(1, 0) - r(0, 1)) / k]; }
  return normalize4(q);
}
function conjugate(q: Quat): Quat { return [-q[0], -q[1], -q[2], q[3]]; }
function multiplyQ(a: Quat, b: Quat): Quat {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let c = b;
  if (d < 0) { d = -d; c = [-b[0], -b[1], -b[2], -b[3]]; }
  if (d > 0.9995) return normalize4([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t, a[3] + (c[3] - a[3]) * t]);
  const theta = Math.acos(Math.min(1, d)), s = Math.sin(theta), wa = Math.sin((1 - t) * theta) / s, wb = Math.sin(t * theta) / s;
  return [a[0] * wa + c[0] * wb, a[1] * wa + c[1] * wb, a[2] * wa + c[2] * wb, a[3] * wa + c[3] * wb];
}
function axisAngle(axis: Vec3, angle: number): Quat {
  const n = Math.hypot(...axis) || 1, s = Math.sin(angle / 2);
  return [axis[0] / n * s, axis[1] / n * s, axis[2] / n * s, Math.cos(angle / 2)];
}
/** The twist of a rotation about one of its frame's axes, in radians (−π, π] (swing-twist split). */
export function twistAngle(q: Quat, axis: Axis): number {
  const w = q[3], v = q[axis];
  if (Math.hypot(v, w) < 1e-9) return 0;
  const angle = 2 * Math.atan2(v, w);
  return angle > Math.PI ? angle - 2 * Math.PI : angle <= -Math.PI ? angle + 2 * Math.PI : angle;
}
function transformDirection(m: Mat4, v: Vec3): Vec3 {
  return [m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2], m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2], m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2]];
}
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function unit(v: Vec3): Vec3 | null { const n = Math.hypot(...v); return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : null; }
/** The rotation taking `forwardLocal` onto `forward` with `upLocal` as near `up` as it can go (null when degenerate). */
function look(forwardLocal: Vec3, upLocal: Vec3, forward: Vec3, up: Vec3): Quat | null {
  const f = unit(forward), fl = unit(forwardLocal);
  if (!f || !fl) return null;
  const u = unit([up[0] - dot(up, f) * f[0], up[1] - dot(up, f) * f[1], up[2] - dot(up, f) * f[2]]);
  const ul = unit([upLocal[0] - dot(upLocal, fl) * fl[0], upLocal[1] - dot(upLocal, fl) * fl[1], upLocal[2] - dot(upLocal, fl) * fl[2]]);
  if (!u || !ul) return null;
  const s = cross(f, u), sl = cross(fl, ul);
  // R = [f u s] · [fl ul sl]ᵀ, as a column-major matrix.
  const m = identity();
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++)
    m[col * 4 + row] = f[row]! * fl[col]! + u[row]! * ul[col]! + s[row]! * sl[col]!;
  return rotationOf(m);
}
/** XYZ Euler angles (x applied first: R = Rz·Ry·Rx) of a rotation matrix's upper 3×3. */
function euler(m: Mat4): Vec3 {
  const s = scaleOf(m), r = (row: number, col: number) => m[col * 4 + row]! / (s[col] || 1);
  return [Math.atan2(r(2, 1), r(2, 2)), Math.asin(-Math.max(-1, Math.min(1, r(2, 0)))), Math.atan2(r(1, 0), r(0, 0))];
}
function fromEuler(e: Vec3): Quat {
  const [x, y, z] = e.map(angle => angle / 2) as Vec3;
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return [sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
}
function channelOf(m: Mat4, channel: Channel): number {
  const axis = AXES[channel[channel.length - 1]!]!;
  if (channel.startsWith("Pos")) return m[12 + axis]!;
  if (channel.startsWith("Scale")) return scaleOf(m)[axis];
  return euler(m)[axis];
}
function withChannel(m: Mat4, channel: Channel, value: number): Mat4 {
  const axis = AXES[channel[channel.length - 1]!]!;
  if (channel.startsWith("Pos")) { const out = m.slice(); out[12 + axis] = value; return out; }
  const t: Vec3 = [m[12]!, m[13]!, m[14]!], s = scaleOf(m);
  if (channel.startsWith("Scale")) { s[axis] = value; return compose(t, rotationOf(m), s); }
  const e = euler(m); e[axis] = value;
  return compose(t, fromEuler(e), s);
}

/**
 * A program as the browser reads it back from the host: every index in range, every matrix sixteen finite numbers, within the bounds.
 * Throws `DeformationRigError` on anything else.
 */
export function parseDeformationProgram(value: unknown): DeformationProgram {
  const fail = (why: string): never => { throw new DeformationRigError(`The deformation rig is invalid: ${why}.`); };
  const p = value as DeformationProgram;
  if (!p || p.schema !== DEFORMATION_PROGRAM || typeof p.rig !== "string" || typeof p.graph !== "string") fail("not a program");
  if (!Array.isArray(p.transforms) || p.transforms.length > DEFORMATION_LIMITS.transforms || !Number.isInteger(p.joints) || p.joints < 1 ||
    p.joints > Math.min(p.transforms.length, DEFORMATION_LIMITS.joints)) fail("transform counts");
  const n = p.transforms.length;
  const matrix = (m: unknown) => Array.isArray(m) && m.length === 16 && m.every(x => typeof x === "number" && Number.isFinite(x)) ? m as Mat4 : fail("a matrix");
  const index = (i: unknown, allowNone = false) => Number.isInteger(i) && (i as number) < n && ((i as number) >= 0 || (allowNone && i === -1)) ? i as number : fail("an index");
  const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x) ? x : fail("a number");
  const vector = (v: unknown) => Array.isArray(v) && v.length === 3 ? v.map(finite) as Vec3 : fail("a vector");
  const axis = (a: unknown) => a === 0 || a === 1 || a === 2 ? a as Axis : fail("an axis");
  const channel = (c: unknown) => CHANNELS.has(c as Channel) ? c as Channel : fail("a channel");
  const list = <T>(items: unknown, max: number, read: (item: any) => T) => Array.isArray(items) && items.length <= max ? items.map(read) : fail("a list");
  const transforms = p.transforms.map((t, i) => ({ name: typeof t?.name === "string" && t.name.length <= 256 ? t.name : fail("a name"),
    parent: i < p.joints ? (t.parent === -1 || (Number.isInteger(t.parent) && t.parent >= 0 && t.parent < i) ? t.parent : fail("a parent")) : index(t.parent),
    local: matrix(t.local) }));
  const bind = list(p.bind, p.joints, matrix);
  if (bind.length !== p.joints) fail("bind poses");
  const tracks = list(p.tracks, DEFORMATION_LIMITS.tracks, t => typeof t === "string" ? t : fail("a track"));
  const track = (i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < tracks.length ? i as number : fail("a track index");
  const S = DEFORMATION_LIMITS.sources, O = DEFORMATION_LIMITS.outputs;
  const ops = list(p.ops, DEFORMATION_LIMITS.ops, (op): DeformationOp => {
    switch (op?.op) {
      case "extend": return { op: "extend", transforms: list(op.transforms, n, i => { const k = index(i); return k >= p.joints ? k : fail("an added transform"); }) };
      case "track": return { op: "track", track: track(op.track), value: finite(op.value) };
      case "point": case "orient": {
        const sources = list(op.sources, S, i => index(i)), weights = list(op.weights, S, finite);
        if (!sources.length || weights.length !== (op.op === "point" ? sources.length : sources.length - 1)) fail("constraint weights");
        return { op: op.op, target: index(op.target), sources, weights };
      }
      case "aim": return { op: "aim", target: index(op.target), aimAt: index(op.aimAt), up: index(op.up), forward: vector(op.forward), upAxis: vector(op.upAxis),
        upVector: op.upVector === null ? null : vector(op.upVector) };
      case "set": return { op: "set", target: index(op.target), source: index(op.source), offset: matrix(op.offset) };
      case "twist": return { op: "twist", a: index(op.a), b: index(op.b), axis: axis(op.axis),
        outputs: list(op.outputs, O, o => ({ target: index(o?.target), axis: axis(o?.axis), positive: finite(o?.positive), negative: finite(o?.negative) })) };
      case "spline": return { op: "spline", target: index(op.target), start: index(op.start), middle: index(op.middle), end: index(op.end),
        progress: finite(op.progress), track: op.track === null ? null : track(op.track) };
      case "bounce": return { op: "bounce", start: index(op.start), end: index(op.end), measure: channel(op.measure), offset: finite(op.offset),
        positive: finite(op.positive), negative: finite(op.negative),
        outputs: list(op.outputs, O, o => ({ target: index(o?.target), parent: index(o?.parent), scale: finite(o?.scale),
          channels: list(o?.channels, 9, c => ({ channel: channel(c?.channel), scale: finite(c?.scale) })) })),
        tracks: list(op.tracks, O, t => ({ track: track(t?.track), scale: finite(t?.scale) })) };
      case "limit": {
        const bound = (v: unknown) => Array.isArray(v) && v.length === 3 ? v.map(x => x === null ? null : finite(x)) : fail("limits");
        return { op: "limit", target: index(op.target), parent: index(op.parent, true), min: bound(op.min), max: bound(op.max) };
      }
      default: return fail("an operation");
    }
  });
  const skipped = list(p.skipped, 64, s => typeof s === "string" ? s : fail("a note"));
  return { schema: DEFORMATION_PROGRAM, rig: p.rig, graph: p.graph, transforms, joints: p.joints, bind, tracks, ops, skipped };
}
