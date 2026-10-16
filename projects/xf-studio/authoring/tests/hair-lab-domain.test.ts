import { describe, expect, test } from "bun:test";
import { constant, evaluateField, transportSample, validateField } from "../src/features/hair-lab/fields";
import { defaultGroom, evaluateMembership, sampleRoots, validateGroom } from "../src/features/hair-lab/groom";
import { buildDistanceGrid, capsuleContact, contactAt, segmentContact } from "../src/features/hair-lab/contact";
import { coarsePaths, cutPaths, drapePaths, pathResiduals } from "../src/features/hair-lab/solve";
import type { HeadSurface, MaterialSample } from "../src/features/hair-lab/types";

// Synthetic, closed, outward-oriented head; no game resources in fixtures.
export function sphereSurface(): HeadSurface {
  const positions: number[] = [], indices: number[] = [], uv: number[] = [];
  const n = 20, m = 32;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= m; i++) {
    const p = Math.PI * j / n, a = 2 * Math.PI * i / m;
    positions.push(.09 * Math.sin(p) * Math.cos(a), .12 * Math.cos(p), .10 * Math.sin(p) * Math.sin(a));
    uv.push(i / m, j / n);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < m; i++) {
    const a = j * (m + 1) + i, b = a + m + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  return { resource: "synthetic-head", topology: "sphere-20-32", revision: "1", positions, indices, uv,
    down: [0, -1, 0], capsules: [] };
}
const point: MaterialSample = { id: "1:2", index: 2, uv: [.2, .8], cross: [.3, .7], distance: .15, entrance: .1, phase: .9 };

describe("Hair Lab model: transport before composition", () => {
  test("non-identity chart changes inherited coordinates, preserving identity, distance and phase", () => {
    const parent = transportSample(point, { matrix: [2, 0, 0, .5], offset: [.1, .2] });
    expect(parent.uv[0]).toBeCloseTo(.5, 12);
    expect(parent.uv[1]).toBeCloseTo(.6, 12);
    expect([parent.id, parent.distance, parent.phase]).toEqual([point.id, point.distance, point.phase]);
    const ramp = { op: "ramp", unit: "m", chart: "scalp", axis: "u", from: 0, to: 1 } as const;
    expect(evaluateField(ramp, parent)).toBe(.5);
    expect(evaluateField({ op: "blend", unit: "m", chart: "scalp", a: ramp, b: constant(.9, "m"), mask: constant(2, "ratio") }, parent)).toBe(.9);
  });
  test("units, finite values, smooth edges and transforms are validated", () => {
    expect(validateField({ op: "multiply", unit: "m", chart: "scalp", a: constant(1, "m"), b: constant(1, "rad") })).not.toEqual([]);
    expect(validateField(constant(NaN, "m"))).not.toEqual([]);
    expect(() => transportSample(point, { matrix: [0, 0, 0, 0], offset: [0, 0] })).toThrow();
    const threshold = { op: "smoothstep", unit: "ratio", chart: "scalp", input: constant(.5, "ratio"), low: 0, high: 1 } as const;
    expect(evaluateField(threshold, point)).toBe(.5);
    expect(validateField({ ...threshold, high: 0 })).not.toEqual([]);
  });
});

describe("Hair Lab model: population and head binding", () => {
  const head = sphereSurface();
  test("morphing preserves the authored triangle and barycentric attachment", () => {
    const groom = defaultGroom(head), a = sampleRoots(groom, head, 32);
    const b = sampleRoots(groom, { ...head, positions: head.positions.map((v, i) => v * (i % 3 === 0 ? 1.1 : 1.02)) }, 32);
    expect(b.map(r => [r.id, r.triangle, r.barycentric])).toEqual(a.map(r => [r.id, r.triangle, r.barycentric]));
  });
  test("preview budgets are nested and changing selected hair cannot reseed roots", () => {
    const groom = defaultGroom(head);
    const a = sampleRoots(groom, head, 16), b = sampleRoots(groom, head, 64);
    expect(a).toEqual(b.slice(0, 16));
    expect(a.every(root => root.position[1] > -.065)).toBe(true);
    expect(a.some(root => root.position[2] > .06 && root.position[1] < .05)).toBe(false);
    expect(sampleRoots(groom, { ...head, cap: { source: "another-hair", points: [] } }, 16)).toEqual(a);
    expect(() => sampleRoots(groom, { ...head, topology: "different" }, 16)).toThrow(/bind/i);
  });
  test("branches partition, convergence conserves, termination accounts for every identity", () => {
    const groom = defaultGroom(head);
    groom.graph = { root: "roots", nodes: {
      roots: { kind: "root", next: "split" }, split: { kind: "branch", outlets: ["left", "right"], selection: .4 },
      left: { kind: "volume", next: "join", length: "length" }, right: { kind: "volume", next: "join", length: "length" },
      join: { kind: "convergence", next: "end" }, end: { kind: "termination" },
    } };
    const members = evaluateMembership(groom, Array.from({ length: 100 }, (_, i) => i));
    expect(members.ended).toHaveLength(100);
    expect(new Set(members.ended).size).toBe(100);
    expect(members.at.left.length + members.at.right.length).toBe(100);
    expect(members.at.join).toHaveLength(100);
    groom.graph.nodes.end = { kind: "volume", next: "roots", length: "length" };
    expect(validateGroom(groom)).not.toEqual([]);
  });
});

describe("Hair Lab model: static contact solve", () => {
  const head = sphereSurface(), grid = buildDistanceGrid(head, 32);
  test("a convergence hold gathers against gravity and retains a free tail through drape", () => {
    const groom = defaultGroom(head); groom.solver.samples = 12;
    groom.fields.length = constant(.70, "m");
    groom.graph.nodes.roots = { kind: "root", next: "volume" };
    groom.graph.nodes.volume = { kind: "volume", length: "length", next: "tie" };
    groom.graph.nodes.tie = { kind: "convergence", next: "end", tie: { position: [0, .105, -.065], radiusMetres: .008 } };
    const coarse = coarsePaths(groom, sampleRoots(groom, head, 12), head.down, head.front, { grid, surface: head });
    expect(coarse.paths.every(p => p.holds?.length === 1)).toBe(true);
    for (const path of coarse.paths) {
      const hold = path.holds![0];
      expect(Math.hypot(...hold.position.map((v, k) => v - [0, .105, -.065][k]))).toBeLessThan(.015);
      expect(path.points.at(-1)![1]).toBeLessThan(hold.position[1] - .15);
    }
    const solved = drapePaths(groom, coarse, grid, [], head.down);
    for (const path of solved.paths) expect(path.points[path.holds![0].index]).toEqual(path.holds![0].position);
  });
  test("a tip plane gives roots at different heights the same cut line", () => {
    const groom = defaultGroom(head); groom.cut = { normal: [0, 1, 0], offsetMetres: -.14 };
    const paths = coarsePaths(groom, sampleRoots(groom, head, 24), head.down, head.front, { grid, surface: head });
    const trimmed = cutPaths(groom, paths);
    expect(new Set(trimmed.paths.map(p => Math.round(p.intrinsicMetres * 1000))).size).toBeGreaterThan(10);
    for (const p of trimmed.paths) expect(p.points.at(-1)![1]).toBeCloseTo(-.14, 8);
    expect(trimmed.paths.every(p => p.intrinsicMetres < .55)).toBe(true);
  });
  test("sections and clumps are a spatial graph partition with conserved identities", () => {
    const groom = defaultGroom(head), roots = sampleRoots(groom, head, 64), membership = evaluateMembership(groom, roots);
    const clumps = Object.entries(groom.graph.nodes).filter(([, n]) => n.kind === "volume" && n.clump).flatMap(([id]) => membership.at[id]);
    expect(clumps.length).toBe(64); expect(new Set(clumps).size).toBe(64);
    expect(membership.at["section-left"].length + membership.at["section-right"].length).toBe(64);
  });
  test("small map edits preserve attachments and change the supported sweep continuously", () => {
    const groom = defaultGroom(head), roots = sampleRoots(groom, head, 24);
    for (const field of ["length", "waves", "spread"] as const) {
      let previous = coarsePaths(groom, roots, head.down, head.front, { grid, surface: head });
      for (let edit = 1; edit <= 4; edit++) {
        const next = structuredClone(groom), initial = next.fields[field];
        if (initial.op !== "constant") throw Error("Fixture needs a constant map.");
        next.fields[field] = constant(initial.value + edit * .0005, "m");
        const paths = coarsePaths(next, roots, head.down, head.front, { grid, surface: head });
        let maximum = 0;
        for (let p = 0; p < paths.paths.length; p++) for (let j = 0; j < paths.paths[p].points.length; j++) maximum = Math.max(maximum, Math.hypot(...paths.paths[p].points[j].map((v, k) => v - previous.paths[p].points[j][k])));
        expect(maximum).toBeLessThan(.015);
        expect(paths.paths.map(p => p.root)).toEqual(previous.paths.map(p => p.root));
        previous = paths;
      }
    }
  });
  test("signed distance and segment interiors detect a crossing with safe endpoints", () => {
    expect(contactAt(grid, [0, 0, 0]).distance).toBeLessThan(0);
    expect(contactAt(grid, [.2, 0, 0]).distance).toBeGreaterThan(0);
    expect(segmentContact(grid, [-.2, 0, 0], [.2, 0, 0]).distance).toBeLessThan(-.07);
    expect(segmentContact(grid, [grid.max[0] + .00001, 0, 0], [grid.max[0] + .002, -.02, 0]).distance).toBeGreaterThan(.03);
  });
  test("determinism, root pinning, length and penetration residuals", () => {
    const groom = defaultGroom(head);
    groom.solver.samples = 16;
    const roots = sampleRoots(groom, head, 16), coarse = coarsePaths(groom, roots, head.down);
    const solve = () => drapePaths(groom, coarse, grid, head.capsules);
    const a = solve(), b = solve();
    expect(a).toEqual(b);
    const residuals = pathResiduals(a, coarse, grid, groom.solver.clearanceMetres, head.capsules);
    expect(residuals.rootMetres).toBeLessThan(1e-6);
    expect(residuals.lengthRatio).toBeLessThan(.02);
    expect(residuals.penetrationMetres).toBeLessThan(.001);
    expect(a.paths.every(path => path.points.every(p => p.every(Number.isFinite)))).toBe(true);
  });
  test("invalid maps and degenerate surfaces fail before generating", () => {
    const groom = defaultGroom(head);
    groom.fields.length = constant(-1, "m");
    expect(validateGroom(groom)).not.toEqual([]);
    expect(() => sampleRoots(defaultGroom(head), { ...head, indices: [] }, 16)).toThrow();
  });
  test("coarse hair follows scalp support before falling, with shallow emergence and no cage", () => {
    const groom = defaultGroom(head); groom.solver.samples = 32; groom.solver.intervals = 48;
    const roots = sampleRoots(groom, head, 32);
    const paths = coarsePaths(groom, roots, head.down, head.front, { grid, surface: head, strategy: "face-frame" });
    let nearScalp = 0, measured = 0;
    for (const path of paths.paths) {
      const first = path.points[0], next = path.points[1], n = path.root.normal;
      const d = next.map((v, k) => v - first[k]), length = Math.hypot(...d);
      expect(Math.abs(d.reduce((sum, v, k) => sum + v * n[k], 0) / length)).toBeLessThan(.65);
      for (const p of path.points.slice(1)) if (p[1] > .025) { measured++; if (contactAt(grid, p).distance < .035) nearScalp++; }
    }
    expect(nearScalp / measured).toBeGreaterThan(.9);
  });
  test("torso contact and residuals include the upper back and chest", () => {
    const torso = { a: [0, -.17, 0], b: [0, -.48, 0], radius: 1, radii: [.14, .025, .10] } as const;
    const capsule = { ...torso, a: [...torso.a], b: [...torso.b], radii: [...torso.radii] } as import("../src/features/hair-lab/types").Capsule;
    expect(capsuleContact([0, -.3, 0], capsule).distance).toBeLessThan(0);
    const groom = defaultGroom(head); groom.solver.samples = 16;
    const paths = coarsePaths(groom, sampleRoots(groom, head, 16), head.down, head.front, { grid, surface: { ...head, capsules: [capsule] }, strategy: "face-frame" });
    const solved = drapePaths(groom, paths, grid, [capsule], head.down), residuals = pathResiduals(solved, paths, grid, .0005, [capsule]);
    expect(residuals.penetrationMetres).toBeLessThan(.001);
    const broken = structuredClone(solved); broken.paths[0].points[10] = [0, -.3, 0];
    expect(pathResiduals(broken, paths, grid, .0005, [capsule]).penetrationMetres).toBeGreaterThan(.05);
  });
  test("the body distance field catches a torso crossing outside the head grid", () => {
    const body = sphereSurface();
    body.positions = body.positions.map((value, i) => i % 3 === 0 ? value * 1.7 : i % 3 === 1 ? value * 1.8 - .30 : value);
    const combined = { ...grid, others: [buildDistanceGrid(body, 32)] };
    expect(contactAt(grid, [0, -.30, 0]).distance).toBeGreaterThan(0);
    expect(contactAt(combined, [0, -.30, 0]).distance).toBeLessThan(-.08);
    expect(segmentContact(combined, [-.25, -.30, 0], [.25, -.30, 0]).distance).toBeLessThan(-.08);
  });
});
