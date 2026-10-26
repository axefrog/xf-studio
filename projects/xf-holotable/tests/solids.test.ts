import { expect, test } from "bun:test";
import { join } from "node:path";
import { createService } from "../src/service.ts";
import { emptySolids, solidCacheKey } from "../src/solid-source.ts";
import { distanceToPath, nearestSolids, pathDistance, WORLD_SOLID_CAP, worldPose } from "../src/solids.ts";
import type { Solid, Vec3 } from "../src/model.ts";
import { writeFixture } from "./fixture.ts";

const solid = (id: string, center: Vec3): Solid => ({ id, center, kind: "box", axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], size: [1, 2, 3] });

test("cache identities include every source's path, size and precise modification time, and the reader version", () => {
  const a = { path: "game/archive.archive", size: 100, mtimeMs: 123.4 }, path: Vec3[] = [[0, 0, 0], [10, 0, 0]];
  const key = solidCacheKey([a], path, 250);
  expect(solidCacheKey([{ ...a }], path, 250)).toBe(key);
  for (const change of [{ size: 101 }, { mtimeMs: 123.5 }, { path: "other/archive.archive" }]) expect(solidCacheKey([{ ...a, ...change }], path, 250)).not.toBe(key);
  expect(solidCacheKey([a], path, 250, 7)).not.toBe(key);
  expect(solidCacheKey([a, a], path, 250)).not.toBe(key);
  expect(solidCacheKey([a], path, 251)).not.toBe(key);
});

test("a local shape pose composes with the actor's world pose and scale exactly once", () => {
  const q = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const pose = worldPose({ position: [10, 20, 30], orientation: q, scale: [2, 1, 1] }, { position: [1, 0, 0], rotation: q });
  pose.center.forEach((x, i) => expect(x).toBeCloseTo([10, 22, 30][i], 10));
  pose.axes[0].forEach((x, i) => expect(x).toBeCloseTo([-1, 0, 0][i], 10));
  pose.axes[1].forEach((x, i) => expect(x).toBeCloseTo([0, -2, 0][i], 10));
});

test("the exact path index agrees with an independent linear scan, including zero-length segments", () => {
  const path: Vec3[] = Array.from({ length: 200 }, (_, i) => [Math.sin(i / 7) * 30, i % 4 ? i : i - 1, i % 13]);
  path.splice(30, 0, path[29], path[29]);
  const fast = pathDistance(path);
  for (let i = 0; i < 120; i++) { const p: Vec3 = [i - 60, Math.cos(i) * 100, i % 31]; expect(fast(p)).toBeCloseTo(distanceToPath(p, path), 8); }
  expect(pathDistance([[1, 2, 3]])([1, 2, 4])).toBe(1);
  expect(pathDistance([])([1, 2, 3])).toBe(Infinity);
});

test("world.around returns solids nearest the path, caps them and reports the cut", async () => {
  const fixture = writeFixture();
  try {
    const { handlers } = createService({ recordingsRoot: fixture.root, worldPackPath: join(fixture.root, "absent.json"),
      solidSource: { async around(path) {
        const data = emptySolids(), solids = Array.from({ length: WORLD_SOLID_CAP + 5 }, (_, i) => solid(String(i), [0, WORLD_SOLID_CAP - i, 10]));
        const chosen = nearestSolids(solids, path); return { solids: chosen.solids, solidInfo: { ...data.solidInfo, available: true, cut: chosen.cut } };
      } } });
    const result = await handlers["world.around"]({ dir: fixture.dir }, new AbortController().signal) as any;
    expect(result.solids.length).toBe(WORLD_SOLID_CAP); expect(result.solidInfo.cut).toBe(5);
    expect(result.solids[0].center).toEqual([0, 0, 10]);
    for (let i = 1; i < result.solids.length; i++) expect(Math.abs(result.solids[i - 1].center[1])).toBeLessThanOrEqual(Math.abs(result.solids[i].center[1]));
    await expect(handlers["world.around"]({ dir: fixture.dir, margin: Infinity }, new AbortController().signal)).rejects.toThrow(/Margin/);
  } finally { fixture.dispose(); }
});
