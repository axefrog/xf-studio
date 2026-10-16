import { expect, test } from "bun:test";
import { atlasRegions, generateCards } from "../src/features/hair-lab/cards";
import { defaultGroom, sampleRoots } from "../src/features/hair-lab/groom";
import { coarsePaths } from "../src/features/hair-lab/solve";
import { sphereSurface } from "./hair-lab-domain.test";
import { deriveVolumes } from "../src/features/hair-lab/volumes";

test("Hair Lab cards: alpha valleys define strips, coverage orders layer choices", () => {
  const alpha = new Uint8Array(64 * 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (x % 16 > 1 && x % 16 < 14) alpha[y * 64 + x] = 240 - Math.floor(x / 16) * 50;
  const regions = atlasRegions(alpha, 64, 32);
  expect(regions).toHaveLength(4);
  expect(regions[0].density).toBeGreaterThan(regions[3].density);
  expect(regions.every(region => region.u0 >= 0 && region.u1 <= 1 && region.u0 < region.u1)).toBe(true);
});
test("Hair Lab cards: stable layering, finite frames, root anchoring and intrinsic UV", () => {
  const head = sphereSurface(), groom = defaultGroom(head), roots = sampleRoots(groom, head, 16), paths = coarsePaths(groom, roots, head.down);
  const regions = [{ u0: 0, u1: .25, v0: 0, v1: 1, density: .8 }, { u0: .25, u1: .5, v0: 0, v1: 1, density: .4 }, { u0: .5, u1: 1, v0: 0, v1: 1, density: .1 }];
  const volumes = deriveVolumes(groom, paths), a = generateCards(volumes, regions), b = generateCards(volumes, regions);
  expect(a).toEqual(b);
  expect(a.positions.every(Number.isFinite)).toBe(true);
  expect(a.uv.every(Number.isFinite)).toBe(true);
  expect(a.cards.some(card => card.layer === "inner")).toBe(true);
  expect(a.cards.some(card => card.layer === "outer")).toBe(true);
  expect(a.cards.every(card => volumes.volumes.some(v => v.id === card.volume))).toBe(true);
  expect(new Set(a.cards.map(card => card.id)).size).toBe(a.cards.length);
  expect(a.rootTip[0]).toBe(0);
  expect(a.rootTip.some(t => t === 1)).toBe(true);
  expect(a.positions.length / 3).toBeLessThan(10000);
});
test("atlas regions never cross separate long-strip and short-tuft banks", () => {
  const alpha = new Uint8Array(64 * 64);
  for (let y = 1; y < 42; y++) for (let x = 3; x < 29; x++) alpha[y * 64 + x] = 230;
  for (let y = 48; y < 63; y++) for (let x = 5; x < 31; x++) alpha[y * 64 + x] = 180;
  const regions = atlasRegions(alpha, 64, 64);
  expect(regions).toHaveLength(2);
  expect(regions.every(r => r.v1 < .72 || r.v0 > .72)).toBe(true);
});
