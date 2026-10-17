import { expect, test } from "bun:test";
import { deriveVolumes, memberPoint, volumeMesh } from "../src/features/hair-lab/volumes";
import { defaultGroom, sampleRoots } from "../src/features/hair-lab/groom";
import { coarsePaths } from "../src/features/hair-lab/solve";
import { sphereSurface } from "./hair-lab-domain.test";
import { regressionGrooms } from "./fixtures/hair-style-regressions";

test("derived clump volumes conserve members and reconstruct their material samples", () => {
  const head = sphereSurface(), groom = defaultGroom(head), paths = coarsePaths(groom, sampleRoots(groom, head, 32), head.down);
  const original = JSON.stringify({ groom, paths }), a = deriveVolumes(groom, paths), b = deriveVolumes(groom, paths);
  expect(a).toEqual(b); expect(a.volumes.reduce((sum, v) => sum + v.members.length, 0)).toBe(32);
  for (const volume of a.volumes) for (const member of volume.members) {
    const path = paths.paths.find(p => p.root.id === member.root.id)!;
    expect(Math.hypot(...memberPoint(volume, member, 0).map((v, k) => v - path.points[0][k]))).toBeLessThan(1e-12);
    expect(Math.hypot(...memberPoint(volume, member, volume.frames.length - 1).map((v, k) => v - path.points.at(-1)![k]))).toBeLessThan(1e-12);
  }
  const mesh = volumeMesh(a);
  expect(mesh.positions.every(Number.isFinite)).toBe(true); expect(mesh.positions.length / 3).toBeLessThan(17000);
  expect(JSON.stringify({ groom, paths })).toBe(original);
});
test("a convergence has separate incoming clumps and one outgoing tail with the same identities", () => {
  const head = sphereSurface(), base = defaultGroom(head), groom = regressionGrooms(head)[3], paths = coarsePaths(base, sampleRoots(base, head, 24), head.down);
  for (const path of paths.paths) { const index = Math.floor(path.points.length / 2); path.holds = [{ index, position: path.points[index] }]; }
  const volumes = deriveVolumes(groom, paths), tail = volumes.volumes.find(v => v.id === "tail")!;
  expect(tail.members).toHaveLength(24);
  expect(volumes.volumes.filter(v => v.id !== "tail").reduce((sum, v) => sum + v.members.length, 0)).toBe(24);
  expect(tail.members.every(m => m.startMetres > 0 && m.endMetres > m.startMetres)).toBe(true);
});
