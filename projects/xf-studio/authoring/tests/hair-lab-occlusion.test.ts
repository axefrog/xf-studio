import { expect, test } from "bun:test";
import { groomOcclusion, bakeOcclusion } from "../src/features/hair-lab/occlusion";
import { deriveVolumes, volumeMesh } from "../src/features/hair-lab/volumes";
import { generateCards } from "../src/features/hair-lab/cards";
import { defaultGroom, sampleRoots } from "../src/features/hair-lab/groom";
import { coarsePaths } from "../src/features/hair-lab/solve";
import { sphereSurface } from "./hair-lab-domain.test";
test("groom-depth occlusion is stronger inside overlapping clumps and absent outside", () => {
  const head = sphereSurface(), groom = defaultGroom(head), all = deriveVolumes(groom, coarsePaths(groom, sampleRoots(groom, head, 24), head.down)), volume = all.volumes[0], source = { ...all, volumes: [volume] };
  const at = volume.frames[3].centre, one = groomOcclusion(source), two = groomOcclusion({ ...source, volumes: [volume, { ...volume, id: "overlap" }] });
  expect(one(at)).toBeGreaterThan(.1); expect(two(at)).toBeGreaterThan(one(at)); expect(one([5, 5, 5])).toBe(0);
  const mesh = volumeMesh(source), cards = generateCards(source), before = JSON.stringify({ mesh, cards }), a = bakeOcclusion(source, mesh, cards), b = bakeOcclusion(source, mesh, cards);
  expect(a).toEqual(b); expect(a.cards.occlusion).toHaveLength(cards.positions.length / 3);
  expect(a.cards.occlusion.every(v => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
  expect(JSON.stringify({ mesh, cards })).toBe(before);
});
