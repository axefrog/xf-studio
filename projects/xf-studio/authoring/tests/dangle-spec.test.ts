import { describe, expect, test } from "bun:test";
import { compileDangleSpec, DangleSpecError, parseDangleSpec } from "../src/dangle-spec";
import type { JsonObject } from "../src/red-json";
import { readComponents } from "../src/resource-graph";
import { HandleScope } from "../src/red-json";

// A dangle rig and graph in the resolver's JSON shape (WolvenKit's serialization: handles, CNames, QsTransforms, enums as names).
const cn = (value: string) => ({ $type: "CName", $storage: "string", $value: value });
const ti = (name: string) => ({ $type: "animTransformIndex", name: cn(name) });
const qs = (t: [number, number, number] = [0, 0, 0], q: [number, number, number, number] = [0, 0, 0, 1]) => ({ $type: "QsTransform",
  Translation: { $type: "Vector4", X: t[0], Y: t[1], Z: t[2], W: 0 }, Rotation: { $type: "Quaternion", i: q[0], j: q[1], k: q[2], r: q[3] },
  Scale: { $type: "Vector4", X: 1, Y: 1, Z: 1, W: 1 } });
/** Root → Head (1.6 m up) → c1 → c2, chain joints 5 cm apart along X. */
function rig(): JsonObject {
  return { $type: "animRig", boneNames: ["Root", "Head", "c1", "c2"].map(cn), boneParentIndexes: [-1, 0, 1, 2],
    boneTransforms: [qs(), qs([0, 0, 1.6]), qs([0.05, 0, 0]), qs([0.05, 0, 0])] } as unknown as JsonObject;
}
let handle = 0;
const H = (data: object) => ({ HandleId: String(handle++), Data: data });
/** The five-node spine around one dangle node (`nodes` replaces the spine's middle when given). */
function graph(simulation: object, middle?: object[]): JsonObject {
  let link: object = H({ $type: "animAnimNode_ReferencePoseTerminator" });
  const nodes = middle ?? [{ $type: "animAnimNode_SharedMetaPose" }, { $type: "animAnimNode_PoseLsToMs" }, { $type: "animAnimNode_Dangle", dangleConstraint: H(simulation) },
    { $type: "animAnimNode_PoseMsToLs" }];
  for (const node of nodes) link = H({ ...node, inputLink: { $type: "animPoseLink", node: link } });
  const output = H({ $type: "animAnimNode_Output", node: { $type: "animPoseLink", node: link } });
  return { $type: "animAnimGraph", rootNode: H({ $type: "animAnimNode_Root", nodes: [output] }) } as unknown as JsonObject;
}
const particle = (bone: string, fields: object = {}) => ({ $type: "animDyngParticle", bone: ti(bone), ...fields });
function simulation(fields: object = {}, container: object = {}) {
  return { $type: "animDangleConstraint_SimulationDyng",
    particlesContainer: { $type: "animDyngParticlesContainer", particles: [particle("c1", { isFree: 0, mass: 0.4 }), particle("c2", { mass: 0.4, damping: 2.5 })], ...container },
    dyngConstraint: H({ $type: "animDyngConstraintMulti", innerConstraints: [
      H({ $type: "animDyngConstraintLink", bone1: ti("c1"), bone2: ti("c2") }),
      H({ $type: "animDyngConstraintCone", constrainedBone: ti("c2"), coneAttachmentBone: ti("c1"), constraintType: "HalfCone", halfOfMaxApertureAngle: 10,
        coneTransformLS: qs([0, 0, 0], [Math.SQRT1_2, 0, 0, Math.SQRT1_2]) }),
    ] }),
    collisionRoundedShapes: [{ $type: "animCollisionRoundedShape", bone: ti("Head"), transformLS: qs(), roundedCornerRadius: 0.06, zBoxExtent: 0.09 }],
    ...fields };
}
const compile = (g: JsonObject | null) => compileDangleSpec(rig(), g, { rig: "r.rig", graph: "g.animgraph" });

describe("dangle spec", () => {
  test("reads the rig, the particles, the constraints in file order and the shapes, with the class defaults for fields left out", () => {
    const spec = compile(graph(simulation()));
    expect(spec.notes).toEqual([]);
    expect(spec.joints.map(j => j.parent)).toEqual([-1, 0, 1, 2]);
    expect(spec.reference[3]!.slice(0, 3).map(v => Number(v.toFixed(9)))).toEqual([0.1, 0, 1.6]);
    const sim = spec.simulation!;
    // animDangleConstraint_SimulationDyng defaults: substep 0.01, one iteration, alpha 1, look-at on; gravity 9.81.
    expect([sim.substepTime, sim.iterations, sim.alpha, sim.lookAt, sim.gravity, sim.externalLinked]).toEqual([0.01, 1, 1, true, 9.81, false]);
    // animDyngParticle defaults: mass 1, damping 1, free, capsule axis (0.5, 0, 0), ShortestPath.
    expect(sim.particles).toEqual([
      { joint: 2, free: false, mass: 0.4, damping: 1, pull: 0, radius: 0, height: 0, axis: [0.5, 0, 0], projection: "shortest" },
      { joint: 3, free: true, mass: 0.4, damping: 2.5, pull: 0, radius: 0, height: 0, axis: [0.5, 0, 0], projection: "shortest" }]);
    expect(sim.constraints.map(c => c.kind)).toEqual(["link", "cone"]);
    expect(sim.constraints[0]).toEqual({ kind: "link", a: 0, b: 1, type: "fixed", lower: 100, upper: 100, lookAt: [1, 0, 0] });
    expect(sim.constraints[1]).toMatchObject({ kind: "cone", constrained: 1, attachment: 0, type: "half", halfAngle: 10, projection: "shortest" });
    expect(sim.shapes).toEqual([{ joint: 1, frame: [0, 0, 0, 0, 0, 0, 1], radius: 0.06, extents: [0, 0, 0.09] }]);
    // What the browser reads back is the same spec.
    expect(parseDangleSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
  });

  test("a linked external force is noted as linked (the preview feeds that input's default, zero)", () => {
    const spec = compile(graph(simulation({}, { externalForceWsLink: { $type: "animVectorLink", node: H({ $type: "animAnimNode_VectorInput" }) } })));
    expect(spec.simulation!.externalLinked).toBe(true);
  });

  test("anything the executable read doesn't cover leaves the chain rigid with a plain note, never guessed", () => {
    const cases: [string, JsonObject][] = [
      ["another simulation class", graph({ $type: "animDangleConstraint_SimulationPendulum" })],
      ["an unread transform flag", graph(simulation({ dangleAltersTransformsOfItsChildren: 1 }))],
      ["box collision", graph(simulation({ collisionRoundedShapes: [{ $type: "animCollisionRoundedShape", bone: ti("Head"), xBoxExtent: 0.1 }] }))],
      ["directed particles", graph(simulation({}, { particles: [particle("c1", { isFree: 0 }), particle("c2", { projectionType: "Directed" })] }))],
      ["a node other than the spine", graph(simulation(), [{ $type: "animAnimNode_SharedMetaPose" }, { $type: "animAnimNode_BlendAdditive" }])],
      ["a joint the rig doesn't have", graph(simulation({}, { particles: [particle("c9")] }))],
    ];
    for (const [what, g] of cases) {
      const spec = compile(g);
      expect(spec.simulation, what).toBeNull();
      expect(spec.notes.length, what).toBe(1);
      expect(spec.notes[0], what).toMatch(/hangs still\.$/);
      // The rig alone still gives the rigid chains.
      expect(spec.joints.length).toBe(4);
    }
    expect(compile(null).notes).toEqual(["Its animation graph couldn't be read, so it hangs still."]);
  });

  test("a rig that can't be read throws; a malformed served spec is refused", () => {
    expect(() => compileDangleSpec({ $type: "animRig", boneNames: [cn("a")], boneParentIndexes: [3], boneTransforms: [qs()] } as unknown as JsonObject, null, { rig: "", graph: "" }))
      .toThrow(DangleSpecError);
    const spec = JSON.parse(JSON.stringify(compile(graph(simulation()))));
    spec.simulation.constraints[0].b = 7;
    expect(() => parseDangleSpec(spec)).toThrow(DangleSpecError);
  });
});

describe("the resolver keeps the bindings a dangle needs", () => {
  test("a skinned mesh's skeleton and an animated component's rig, graph and bindings", () => {
    const entity = { $type: "entEntityTemplate", compiledData: { BufferId: "0", Flags: 0, Type: "WolvenKit.RED4.Archive.Buffer.RedPackage, WolvenKit.RED4",
      Data: { Version: 4, Sections: 6, CruidIndex: -1, CruidDict: {}, Chunks: [
        { $type: "entSkinnedMeshComponent", name: cn("hh_033_wa__player"), mesh: { DepotPath: { $type: "ResourcePath", $storage: "string", $value: "hair.mesh" } },
          skinning: { HandleId: "0", Data: { $type: "entSkinningBinding", bindName: cn("hair_dangle") } } },
        { $type: "entAnimatedComponent", name: cn("hair_dangle"), rig: { DepotPath: { $type: "ResourcePath", $storage: "string", $value: "hair_dangle.rig" } },
          graph: { DepotPath: { $type: "ResourcePath", $storage: "string", $value: "hair_dangle.animgraph" } },
          controlBinding: { HandleId: "1", Data: { $type: "entAnimatedComponentBinding", bindName: cn("root") } },
          parentTransform: { HandleId: "2", Data: { $type: "entHardTransformBinding", bindName: cn("root") } } },
      ] } } } as unknown as JsonObject;
    const { components } = readComponents(entity, new HandleScope(entity));
    expect(components[0]!.skinning).toBe("hair_dangle");
    expect(components[1]!.animated).toMatchObject({ controlBinding: "root", parentTransform: "root" });
    expect(components[1]!.animated!.rig!.path).toBe("hair_dangle.rig");
  });
});
