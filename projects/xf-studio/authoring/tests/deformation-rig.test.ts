import { expect, test } from "bun:test";
import { compileDeformationRig, DeformationRigError, evaluateDeformationRig, identity, multiply, parseDeformationProgram, twistAngle,
  type DeformationProgram, type Mat4 } from "../src/deformation-rig";
import type { JsonObject } from "../src/red-json";
import { animatedComponents } from "../src/deformation-rig-host";

// ---- a tiny rig and graph in the resolver's JSON shape ----
const cn = (value: string) => ({ $type: "CName", $storage: "string", $value: value });
const ti = (name: string) => ({ $type: "animTransformIndex", name: cn(name) });
const qs = (t: [number, number, number] = [0, 0, 0], q: [number, number, number, number] = [0, 0, 0, 1]) => ({ $type: "QsTransform",
  Translation: { $type: "Vector4", X: t[0], Y: t[1], Z: t[2], W: 0 }, Rotation: { $type: "Quaternion", i: q[0], j: q[1], k: q[2], r: q[3] },
  Scale: { $type: "Vector4", X: 1, Y: 1, Z: 1, W: 1 } });
/** Root → A (at x=1) → B (at x=2); H, a helper under Root; the A pose is the reference pose. */
function rig(): JsonObject {
  const local = [qs(), qs([1, 0, 0]), qs([1, 0, 0]), qs([0, 1, 0])];
  const model = [qs(), qs([1, 0, 0]), qs([2, 0, 0]), qs([0, 1, 0])];
  return { $type: "animRig", boneNames: ["Root", "A", "B", "H"].map(cn), boneParentIndexes: [-1, 0, 1, 0], aPoseLS: local, aPoseMS: model, boneTransforms: local } as unknown as JsonObject;
}
/** A graph: the reference pose, into model space, `nodes` in order, back to local space, the output. */
function graph(nodes: object[]): JsonObject {
  let id = 0;
  let link: object = { HandleId: String(id++), Data: { $type: "animAnimNode_ReferencePoseTerminator" } };
  for (const node of [{ $type: "animAnimNode_SharedMetaPose" }, { $type: "animAnimNode_PoseLsToMs" }, ...nodes, { $type: "animAnimNode_PoseMsToLs" }])
    link = { HandleId: String(id++), Data: { ...node, inputLink: { $type: "animPoseLink", node: link } } };
  const output = { HandleId: String(id++), Data: { $type: "animAnimNode_Output", node: { $type: "animPoseLink", node: link } } };
  return { $type: "animAnimGraph", rootNode: { HandleId: String(id++), Data: { $type: "animAnimNode_Root", nodes: [output] } } } as unknown as JsonObject;
}
const sources = (...names: string[]) => names.map(name => ({ HandleId: `s${name}${Math.random()}`, Data: { $type: "animAnimNodeSourceChannel_WeightedVector",
  channel: { HandleId: `c${name}${Math.random()}`, Data: { $type: "animAnimNodeSourceChannel_TransformVector", transformIndex: ti(name) } } } }));
const translation = (x: number, y: number, z: number): Mat4 => { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m; };
const rotationZ = (angle: number, t: [number, number, number] = [0, 0, 0]): Mat4 => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
};
/** Run a program with Root, A and B keyed (`pose` overrides them) and H solved. */
function run(program: DeformationProgram, keyed: Partial<Record<"Root" | "A" | "B", Mat4>> = {}) {
  const pose = program.transforms.map(() => identity());
  pose[0] = keyed.Root ?? identity(); pose[1] = keyed.A ?? translation(1, 0, 0); pose[2] = keyed.B ?? translation(2, 0, 0);
  const tracks = evaluateDeformationRig(program, pose, [true, true, true, false]);
  return { pose, tracks, at: (name: string) => pose[program.transforms.findIndex(t => t.name === name)]! };
}
const compile = (nodes: object[]) => compileDeformationRig(rig(), graph(nodes), { rig: "r.rig", graph: "g.animgraph" });

test("with nothing to solve, a helper follows its rig parent at its reference offset", () => {
  const { at } = run(compile([]), { Root: translation(0, 0, 5) });
  expect(at("H").slice(12, 15)).toEqual([0, 1, 5]);
});

test("a point constraint places the joint at the weighted mean of its sources and keeps its rotation", () => {
  const program = compile([{ $type: "animAnimNode_PointConstraint", transformIndex: ti("H"), inputTransforms: sources("A", "B"), preprocessedWeights: [0.25, 0.75] }]);
  const { at } = run(program);
  expect(at("H").slice(12, 15)).toEqual([1.75, 0, 0]);
});

test("an orient constraint blends its sources' rotations and keeps the joint's position", () => {
  const program = compile([{ $type: "animAnimNode_OrientConstraint", transformIndex: ti("H"), inputTransforms: sources("A", "B"), preprocessedWeights: [0.5] }]);
  const { at } = run(program, { B: rotationZ(Math.PI / 2, [2, 0, 0]) });
  const h = at("H");
  expect(Math.atan2(h[1]!, h[0]!)).toBeCloseTo(Math.PI / 4, 6);
  expect(h.slice(12, 15)).toEqual([0, 1, 0]);
});

test("an aim constraint turns the forward axis at its target, the up axis towards its up object", () => {
  const program = compile([{ $type: "animAnimNode_AimConstraint_ObjectUp", transformIndex: ti("H"), targetTransform: ti("B"), upTransform: ti("Root"),
    forwardAxisLS: { X: 1, Y: 0, Z: 0 }, upAxisLS: { X: 0, Y: 1, Z: 0 } }]);
  const h = run(program).at("H");
  // H at (0,1,0) aiming at B (2,0,0): forward is (2,-1,0)/√5; up points back towards Root (0,0,0).
  expect(h[0]).toBeCloseTo(2 / Math.sqrt(5), 6); expect(h[1]).toBeCloseTo(-1 / Math.sqrt(5), 6);
  expect(h[4]! * 0 + h[5]! * -1).toBeGreaterThan(0);
});

test("a bone transform places the joint at its source times the offset", () => {
  const program = compile([{ $type: "animAnimNode_SetBoneTransform", entries: [{ transformToChange: ti("H"), sourceBone: ti("A"), offsetSpaceBone: ti("A"),
    setMethod: "WholeTransform", offset: qs([0, 0, 0.5]) }] }]);
  expect(run(program, { A: rotationZ(Math.PI / 2, [1, 0, 0]) }).at("H").slice(12, 15).map(x => +x.toFixed(9))).toEqual([1, 0, 0.5]);
});

test("a twist constraint gives each output its share of B's twist relative to A, by sign", () => {
  const program = compile([{ $type: "animAnimNode_TwistConstraint", transformA: ti("A"), transformB: ti("B"), frontAxis: "Z",
    outputs: [{ twistedTransform: ti("H"), twistAxis: "Z", positiveScale: 0.25, negativeScale: 0.5 }] }]);
  const quarter = (m: Mat4) => Math.atan2(m[1]!, m[0]!);
  expect(quarter(run(program, { B: rotationZ(0.8, [2, 0, 0]) }).at("H"))).toBeCloseTo(0.2, 6);
  expect(quarter(run(program, { B: rotationZ(-0.8, [2, 0, 0]) }).at("H"))).toBeCloseTo(-0.4, 6);
  expect(twistAngle([0, 0, Math.sin(0.3), Math.cos(0.3)], 2)).toBeCloseTo(0.6, 9);
});

test("a bounce measures end in start's space and writes offset plus slope times it into its outputs and tracks", () => {
  const program = compile([
    { $type: "animAnimNode_StackTracksExtender", newTracks: [{ name: cn("output"), referenceValue: 0 }] },
    { $type: "animAnimNode_SimpleBounce", startTransform: ti("A"), endTransform: ti("B"), offset: 0.1, multiplier: 2, negativeMultiplier: -3,
      transformOutputs: [{ targetTransform: ti("H"), parentTransform: ti("Root"), targetTransformChannel: "PosX", multiplier: 1,
        channelEntries: [{ transformChannel: "PosY", multiplier: -1 }, { transformChannel: "PosZ", multiplier: 0.5 }] }],
      trackOutputs: [{ targetTrack: cn("output"), multiplier: 100 }] },
  ]);
  // B is 1.5 m along A's x: 0.1 + 2·1.5 = 3.1.
  const { at, tracks } = run(program, { B: translation(2.5, 0, 0) });
  expect(at("H").slice(12, 15).map(x => +x.toFixed(9))).toEqual([0, -3.1, 1.55]);
  expect(tracks[0]).toBeCloseTo(310, 6);
  // Behind A the negative slope applies: 0.1 + (−3)(−1) = 3.1 again, from the other side.
  expect(run(program, { B: translation(0, 0, 0) }).tracks[0]).toBeCloseTo(310, 6);
});

test("a spline follows a float track a bounce wrote, and added transforms sit at their parent times their offset", () => {
  const program = compile([
    { $type: "animAnimNode_StackTransformsExtender", transformInfos: [{ name: cn("M_GRP"), parentName: cn("A"), referenceTransformLs: qs([0, 1, 0]) }] },
    { $type: "animAnimNode_StackTracksExtender", newTracks: [{ name: cn("output"), referenceValue: 0.5 }] },
    { $type: "animAnimNode_SimpleSpline", constrainedTransform: ti("H"), startTransform: ti("A"), middleTransform: ti("M_GRP"), endTransform: ti("B"),
      defaultProgress: 0.1, progressMode: "FloatTrack", progressTrack: { name: cn("output") } },
  ]);
  expect(program.transforms.at(-1)?.name).toBe("M_GRP");
  // The quadratic Bézier A (1,0) → M (1,1) → B (2,0) at 0.5: (1.25, 0.5).
  expect(run(program).at("H").slice(12, 14)).toEqual([1.25, 0.5]);
});

test("a translation limit clamps the joint in its parent's space", () => {
  const program = compile([{ $type: "animAnimNode_TranslationLimit", constrainedTransform: ti("H"), parentTransform: ti("A"),
    limitOnXAxis: { useMin: 1, min: -0.5, useMax: 0, max: 1 }, limitOnYAxis: { useMin: 0, min: 0, useMax: 1, max: 0.25 } }]);
  expect(run(program).at("H").slice(12, 15)).toEqual([0.5, 0.25, 0]);
});

test("a graph that branches, names an undefined transform or has no output is refused, never guessed", () => {
  const branching = graph([]) as any;
  // Put a switch in place of the reference pose.
  let node = branching.rootNode.Data.nodes[0].Data.node.node;
  while (node.Data.inputLink.node.Data.$type !== "animAnimNode_ReferencePoseTerminator") node = node.Data.inputLink.node;
  node.Data.inputLink.node = { HandleId: "x", Data: { $type: "animAnimNode_StaticSwitch" } };
  expect(() => compileDeformationRig(rig(), branching, { rig: "r", graph: "g" })).toThrow(DeformationRigError);
  expect(() => compile([{ $type: "animAnimNode_PointConstraint", transformIndex: ti("Nope"), inputTransforms: sources("A"), preprocessedWeights: [1] }])).toThrow(DeformationRigError);
  expect(() => compileDeformationRig(rig(), { $type: "animAnimGraph" } as JsonObject, { rig: "r", graph: "g" })).toThrow(DeformationRigError);
  // Unknown node types are listed, not evaluated.
  expect(compile([{ $type: "animAnimNode_Dangle" }]).skipped).toEqual(["Dangle"]);
});

test("a program read back from the host is the same program; one with an index out of range is refused", () => {
  const program = compile([{ $type: "animAnimNode_PointConstraint", transformIndex: ti("H"), inputTransforms: sources("A", "B"), preprocessedWeights: [0.5, 0.5] }]);
  const copy = parseDeformationProgram(JSON.parse(JSON.stringify(program)));
  expect(copy).toEqual(program);
  const broken = JSON.parse(JSON.stringify(program));
  broken.ops[0].sources[0] = 99;
  expect(() => parseDeformationProgram(broken)).toThrow(DeformationRigError);
  expect(() => parseDeformationProgram({ ...program, schema: "other" })).toThrow(DeformationRigError);
  expect(multiply(identity(), translation(1, 2, 3))).toEqual(translation(1, 2, 3));
});

test("the player entity's secondary rigs are the animated components bound to another animated component", () => {
  const ref = (path: string) => ({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: path }, Flags: "Default" });
  const component = (name: string, bind: string | null, rig: string, graphPath: string) => ({ $type: "entAnimatedComponent", name: cn(name), rig: ref(rig), graph: ref(graphPath),
    controlBinding: bind === null ? null : { HandleId: `b${name}`, Data: { $type: "entAnimationControlBinding", bindName: cn(bind) } } });
  const entity = { $type: "entEntityTemplate", components: [component("root", "AnimationControllerComponent", "base\woman_base.rig", "base\paperdoll.animgraph"),
    component("deformations", "root", "base\d.rig", "base\d.animgraph"), component("loose", null, "base\l.rig", "base\l.animgraph")] };
  const found = animatedComponents(entity as never);
  expect(found.map(item => [item.name, item.bindsTo])).toEqual([["root", "AnimationControllerComponent"], ["deformations", "root"], ["loose", ""]]);
  expect(found[1]!.rig).toBe("base\d.rig");
});
