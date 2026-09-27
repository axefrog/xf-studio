import { describe, expect, test } from "bun:test";
import { DANGLE_SPEC, type DangleConstraint, type DangleParticle, type DangleShape, type DangleSpec, type Transform } from "../src/dangle-spec";
import { DangleSolver, POSE_STRIDE, referencePose, rigidChains, settleDangle, SETTLE } from "../src/dangle-solver";

// The knowledge page's test vectors (knowledge/hair-physics.md §5.6), computed in single precision from the decoded rules; a solver in
// doubles agrees to about 1e-6 relative.
const near = (actual: number, expected: number, relative = 2e-6, absolute = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(relative * Math.abs(expected) + absolute);
/** A velocity from `(x − xPrev) / h`: the vectors' single-precision cancellation leaves up to about 1e-6 m/s. */
const nearVelocity = (actual: number, expected: number) => near(actual, expected, 2e-6, 1e-6);

const at = (x: number, y: number, z: number): Transform => [x, y, z, 0, 0, 0, 1];
type JointDef = { name: string; parent: number; at: [number, number, number] };
/** A spec from joints placed in model space (identity rotations) and a simulation. */
function spec(joints: JointDef[], simulation: { particles: Partial<DangleParticle>[]; constraints?: DangleConstraint[]; shapes?: DangleShape[]; gravity?: number;
  iterations?: number; lookAt?: boolean; alpha?: number }): DangleSpec {
  const reference = joints.map(j => at(...j.at));
  return {
    schema: DANGLE_SPEC, rig: "r.rig", graph: "g.animgraph", notes: [],
    joints: joints.map(j => ({ name: j.name, parent: j.parent,
      local: j.parent < 0 ? at(...j.at) : at(j.at[0] - joints[j.parent]!.at[0], j.at[1] - joints[j.parent]!.at[1], j.at[2] - joints[j.parent]!.at[2]) })),
    reference,
    simulation: { substepTime: 0.01, iterations: simulation.iterations ?? 1, alpha: simulation.alpha ?? 1, lookAt: simulation.lookAt ?? true,
      gravity: simulation.gravity ?? 9.81, externalForce: [0, 0, 0], externalLinked: false,
      particles: simulation.particles.map(p => ({ joint: 0, free: true, mass: 1, damping: 1, pull: 0, radius: 0, height: 0, axis: [0.5, 0, 0],
        projection: "shortest", ...p })), constraints: simulation.constraints ?? [], shapes: simulation.shapes ?? [] },
  };
}
const link = (a: number, b: number, lower = 100, upper = 100): DangleConstraint => ({ kind: "link", a, b, type: "fixed", lower, upper, lookAt: [1, 0, 0] });

describe("§5.6 test vectors", () => {
  test("free fall of an hh_033 particle (mass 0.4, damping 1, no pull) from rest", () => {
    const s = spec([{ name: "p", parent: -1, at: [0, 0, 0] }], { particles: [{ joint: 0, mass: 0.4, damping: 1 }] });
    const solver = new DangleSolver(s, { initialSteps: 1 }), pose = referencePose(s);
    solver.frame(pose, 0.01); // the first evaluation resets: on the pose, zero velocity, no integration
    expect(solver.particle(0).x).toEqual([0, 0, 0]);
    const expected = [[-0.00049050, -0.0974869], [-0.00194368, -0.192552], [-0.00433563, -0.285255]];
    for (const [x, v] of expected) {
      solver.frame(pose, 0.01);
      expect(solver.lastSteps).toBe(1);
      near(solver.particle(0).x[2], x!); nearVelocity(solver.particle(0).v[2], v!);
    }
  });

  test("the hh_107 spring (mass 0.6, damping 3, pull 30), no gravity, from 0.1 m off its animated position at rest", () => {
    const s = spec([{ name: "p", parent: -1, at: [0, 0, 0] }], { particles: [{ joint: 0, mass: 0.6, damping: 3, pull: 30 }], gravity: 0 });
    const solver = new DangleSolver(s, { initialSteps: 1 }), pose = referencePose(s);
    solver.frame(pose, 0.01);
    solver.setParticle(0, [0.1, 0, 0]);
    for (const [x, v] of [[0.0997500, -0.0493122], [0.0990198, -0.0959467], [0.0978368, -0.139805]]) {
      solver.frame(pose, 0.01);
      near(solver.particle(0).x[0], x!); nearVelocity(solver.particle(0).v[0], v!);
    }
  });

  test("drag is capped at 50 m/s²", () => {
    const s = spec([{ name: "p", parent: -1, at: [0, 0, 0] }], { particles: [{ joint: 0, mass: 0.1, damping: 1 }], gravity: 0 });
    const solver = new DangleSolver(s, { initialSteps: 1 }), pose = referencePose(s);
    solver.frame(pose, 0.01);
    solver.setParticle(0, [0, 0, 0], [100, 0, 0]);
    solver.frame(pose, 0.01);
    // Two half kicks of −50 × 0.005 each (−1000 m/s² uncapped would leave 90).
    near(solver.particle(0).v[0], 99.5);
    near(solver.particle(0).x[0], 0.9975);
  });

  test("a fixed-distance link splits the correction by the other particle's mass; a fixed end doesn't move", () => {
    const joints: JointDef[] = [{ name: "a", parent: -1, at: [0, 0, 0] }, { name: "b", parent: 0, at: [0, 0, -0.1] }];
    for (const fixed of [false, true]) {
      const s = spec(joints, { particles: [{ joint: 0, mass: 0.4, free: !fixed }, { joint: 1, mass: 0.1 }], constraints: [link(0, 1)], gravity: 0 });
      const solver = new DangleSolver(s, { initialSteps: 1 }), pose = referencePose(s);
      solver.frame(pose, 0.01);
      solver.setParticle(0, [0, 0, 0]); solver.setParticle(1, [0, 0, -0.15]);
      solver.frame(pose, 0.01);
      if (fixed) { expect(solver.particle(0).x).toEqual([0, 0, 0]); near(solver.particle(1).x[2], -0.10); }
      else { near(solver.particle(0).x[2], -0.01); near(solver.particle(1).x[2], -0.11); }
    }
  });

  test("the shoulder capsule (corner radius 0.06, zBoxExtent 0.09) pushes a 0.01 m particle out by 0.02", () => {
    const s = spec([{ name: "shoulder", parent: -1, at: [0, 0, 0] }, { name: "p", parent: 0, at: [0.05, 0, 0.02] }],
      { particles: [{ joint: 1, radius: 0.01, damping: 0 }], shapes: [{ joint: 0, frame: at(0, 0, 0), radius: 0.06, extents: [0, 0, 0.09] }], gravity: 0 });
    const solver = new DangleSolver(s, { initialSteps: 1 }), pose = referencePose(s);
    solver.frame(pose, 0.01);
    const { x } = solver.particle(0);
    near(x[0], 0.07); near(x[1], 0); near(x[2], 0.02);
  });

  test("the substep count: filtered, rounded, at least 1 and at most 3 (§5.1's table)", () => {
    const s = spec([{ name: "p", parent: -1, at: [0, 0, 0] }], { particles: [{ joint: 0, free: false }] });
    const steady = (fps: number, seconds = 20) => {
      const solver = new DangleSolver(s), pose = referencePose(s);
      const counts: number[] = [];
      for (let i = 0; i < fps * seconds; i++) { solver.frame(pose, 1 / fps); counts.push(solver.lastSteps); }
      return counts;
    };
    expect(steady(30).slice(-10)).toEqual(Array(10).fill(3));
    expect(steady(100).slice(-10)).toEqual(Array(10).fill(1));
    expect(steady(144).slice(-10)).toEqual(Array(10).fill(1));
    const sixty = steady(60);
    expect(sixty.slice(-10)).toEqual(Array(10).fill(2));
    // From a filter starting at 0, 60 fps runs one substep a frame for about 2.3 s.
    const first2 = sixty.indexOf(2);
    expect(first2 / 60).toBeGreaterThan(2.1);
    expect(first2 / 60).toBeLessThan(2.5);
  });

  test("no substep runs at a time-dilation ratio of 0.05 or less; the particles stay where they were", () => {
    const s = spec([{ name: "p", parent: -1, at: [0, 0, 0] }], { particles: [{ joint: 0 }] });
    const solver = new DangleSolver(s, { initialSteps: 2 }), pose = referencePose(s);
    solver.frame(pose, 1 / 60);
    solver.frame(pose, 1 / 60, 0.04 / 60);
    expect(solver.lastSteps).toBe(0);
    expect(solver.particle(0).x).toEqual([0, 0, 0]);
  });
});

/** An hh_033-like strand: a fixed root under a head, four free joints 5 cm apart along the head's X, cones on each link. */
function strand(options: { cone?: number; pull?: number } = {}) {
  const joints: JointDef[] = [{ name: "Head", parent: -1, at: [0, 0, 1.6] }, { name: "c0", parent: 0, at: [0.05, 0, 1.6] }];
  for (let i = 1; i <= 4; i++) joints.push({ name: `c${i}`, parent: i, at: [0.05 + 0.05 * i, 0, 1.6] });
  const particles: Partial<DangleParticle>[] = joints.slice(1).map((_, i) => ({ joint: i + 1, free: i > 0, mass: 0.4, damping: 1, pull: options.pull ?? 0 }));
  const constraints: DangleConstraint[] = [];
  for (let i = 1; i < particles.length; i++) {
    constraints.push(link(i - 1, i));
    if (options.cone !== undefined)
      constraints.push({ kind: "cone", constrained: i, attachment: i - 1, frame: at(0, 0, 0), type: "cone", halfAngle: options.cone, projection: "shortest", radius: 0, height: 0 });
  }
  return spec(joints, { particles, constraints });
}

describe("the solver on a strand", () => {
  test("is deterministic: the same frames give the same output, bit for bit", () => {
    const run = () => {
      const s = strand({ cone: 60 }), solver = new DangleSolver(s, { initialSteps: 5 / 3 }), pose = referencePose(s);
      for (let i = 0; i < 240; i++) {
        // The head turns about Z; the chain's root follows it rigidly.
        const angle = 0.6 * Math.sin(i / 20);
        pose.set([0, 0, 1.6, 0, 0, Math.sin(angle / 2), Math.cos(angle / 2)], 0);
        rigidChains(s, pose, [true]);
        solver.frame(pose, 1 / 60);
      }
      return Array.from(solver.out);
    };
    expect(run()).toEqual(run());
  });

  test("without cones a strand falls under gravity; its links stay near their rest length and each joint aims at its child", () => {
    const s = strand(), solver = new DangleSolver(s, { initialSteps: 5 / 3 }), pose = referencePose(s);
    const substeps = settleDangle(solver, pose, 1 / 60);
    expect(substeps).toBeLessThanOrEqual(SETTLE.maxSubsteps + 3);
    const out = solver.out, tip = (j: number) => [out[j * POSE_STRIDE]!, out[j * POSE_STRIDE + 1]!, out[j * POSE_STRIDE + 2]!];
    // The tip hangs below the root.
    expect(tip(5)[2]).toBeLessThan(1.6 - 0.1);
    // One constraint pass per substep, as in the game, leaves the hanging links a little stretched.
    for (let j = 2; j <= 5; j++) near(Math.hypot(...tip(j).map((v, k) => v - tip(j - 1)[k]!)), 0.05, 0.1);
    // The root joint only turns (a fixed particle sits on its input position); its X axis points at its child.
    expect(tip(1)).toEqual([0.05, 0, 1.6]);
    const q = out.slice(POSE_STRIDE + 3, POSE_STRIDE + 7);
    const xAxis = [1 - 2 * (q[1]! ** 2 + q[2]! ** 2), 2 * (q[0]! * q[1]! + q[2]! * q[3]!), 2 * (q[0]! * q[2]! - q[1]! * q[3]!)];
    const toChild = tip(2).map((v, k) => v - tip(1)[k]!), len = Math.hypot(...toChild);
    near(xAxis[0]! * toChild[0]! / len + xAxis[1]! * toChild[1]! / len + xAxis[2]! * toChild[2]! / len, 1, 1e-9);
  });

  test("settled under −Z gravity, a strand with 10° cones hangs within its cones", () => {
    const s = strand({ cone: 10 }), solver = new DangleSolver(s, { initialSteps: 5 / 3 }), pose = referencePose(s);
    settleDangle(solver, pose, 1 / 60);
    const out = solver.out;
    // Each link's direction stays within 10° (plus rounding) of the attachment's animated X axis (here the rest direction +X).
    for (let j = 2; j <= 5; j++) {
      const d = [0, 1, 2].map(k => out[j * POSE_STRIDE + k]! - out[(j - 1) * POSE_STRIDE + k]!), len = Math.hypot(...d);
      expect(Math.acos(Math.min(1, d[0]! / len)) * 180 / Math.PI).toBeLessThan(10.5);
    }
  });

  test("a pull spring holds a strand near its animated pose", () => {
    const loose = strand(), stiff = strand({ pull: 30 });
    const tipDrop = (s: DangleSpec) => { const solver = new DangleSolver(s, { initialSteps: 5 / 3 }), pose = referencePose(s); settleDangle(solver, pose, 1 / 60); return 1.6 - solver.out[5 * POSE_STRIDE + 2]!; };
    expect(tipDrop(stiff)).toBeLessThan(tipDrop(loose) * 0.75);
  });

  test("with alpha 0 the output is the input pose", () => {
    const s = strand(), sim = s.simulation!;
    const zero = { ...s, simulation: { ...sim, alpha: 0 } };
    const solver = new DangleSolver(zero, { initialSteps: 2 }), pose = referencePose(zero);
    for (let i = 0; i < 30; i++) solver.frame(pose, 1 / 60);
    expect(Array.from(solver.out)).toEqual(Array.from(pose));
  });
});
