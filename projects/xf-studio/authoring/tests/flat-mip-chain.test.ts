import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  CONTRIBUTION_CHANNELS, DDS_HEADER_BYTES, destinationContributions, encodeContributions, encodeFlatDds,
  flatMipChain, mipLevelCount, reduceContributions,
} from "../src/flat-mip-chain";

const study = resolve(import.meta.dir, "../../../../experiments/005-preset-collection");
const linear = (b: number) => { const v = b / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
const coverageOf = (alpha: number) => (alpha / 255) ** 2;
/** Contribution of one encoded texel, recomputed in the test with no module code. */
const texel = (rgba: ArrayLike<number>, r: number, m: number) => {
  const c = coverageOf(rgba[3]);
  return [...[0, 1, 2].map(k => Math.sqrt(linear(rgba[k])) * c), r / 255 * c, m / 255 * c, c];
};

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

function randomMaps(size: number, seed: number) {
  const next = seeded(seed), texels = size * size;
  const diffuse = new Uint8Array(texels * 4), roughness = new Uint8Array(texels), metalness = new Uint8Array(texels);
  for (let i = 0; i < texels; i++) {
    for (let k = 0; k < 4; k++) diffuse[i * 4 + k] = Math.floor(next() * 256);
    // Mix fully covered, empty and partial texels, as authored edges do.
    const kind = next();
    if (kind < .2) diffuse[i * 4 + 3] = 0; else if (kind < .5) diffuse[i * 4 + 3] = 255;
    roughness[i] = Math.floor(next() * 256);
    metalness[i] = Math.floor(next() * 256);
  }
  return { diffuse, roughness, metalness };
}

test("checkerboard preserves destination coverage and colour (Python test parity)", () => {
  // Half red matte and half empty. An ordinary box on encoded alpha would yield
  // (.5)^2 = .25 coverage rather than the required .5.
  const diffuse = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 255]);
  const rough = new Uint8Array([224, 0, 0, 224]), metal = new Uint8Array(4);
  const chain = flatMipChain(diffuse, rough, metal, 2);
  expect(chain.diffuse[0]).toEqual(diffuse);
  expect(chain.roughness[0]).toEqual(rough);
  expect(chain.metalness[0]).toEqual(metal);
  const single = chain.diffuse[1];
  expect(coverageOf(single[3])).toBeCloseTo(.5, 2);
  expect([...single.slice(0, 3)]).toEqual([255, 0, 0]);
  expect([...chain.roughness[1]]).toEqual([224]);
  const contribution = texel(single, chain.roughness[1][0], chain.metalness[1][0]);
  expect(Math.abs(contribution[0] - .5)).toBeLessThan(.003);
  expect(Math.abs(contribution[3] - .5 * 224 / 255)).toBeLessThan(.003);
});

test("overlapping colour is averaged in encoded destination space (Python test parity)", () => {
  const diffuse = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
  const chain = flatMipChain(diffuse, new Uint8Array([50, 200, 50, 200]), new Uint8Array([0, 255, 0, 255]), 2);
  const combined = chain.diffuse[1];
  const channels = texel(combined, chain.roughness[1][0], chain.metalness[1][0]);
  expect(combined[3]).toBe(255);
  expect(Math.abs(channels[0] - .5)).toBeLessThan(.004);
  expect(Math.abs(channels[2] - .5)).toBeLessThan(.004);
  expect(Math.abs(channels[3] - 125 / 255)).toBeLessThan(.004);
  expect(Math.abs(channels[4] - .5)).toBeLessThan(.004);
});

test("level 0 is the exact base and every level has the complete power-of-two size", () => {
  const size = 16, maps = randomMaps(size, 7);
  const chain = flatMipChain(maps.diffuse, maps.roughness, maps.metalness, size);
  expect(chain.diffuse[0]).toEqual(maps.diffuse);
  expect(chain.diffuse[0]).not.toBe(maps.diffuse);
  expect(chain.diffuse.map(l => l.length)).toEqual([1024, 256, 64, 16, 4]);
  expect(chain.roughness.map(l => l.length)).toEqual([256, 64, 16, 4, 1]);
  expect(chain.metalness.map(l => l.length)).toEqual([256, 64, 16, 4, 1]);
  expect(mipLevelCount(1)).toBe(1);
  expect(mipLevelCount(1024)).toBe(11);
  const one = flatMipChain(new Uint8Array([1, 2, 3, 4]), new Uint8Array([5]), new Uint8Array([6]), 1);
  expect(one.diffuse).toEqual([new Uint8Array([1, 2, 3, 4])]);
});

test("reductions match an independently written area average of level-0 contributions", () => {
  const size = 8, maps = randomMaps(size, 11);
  const chain = flatMipChain(maps.diffuse, maps.roughness, maps.metalness, size);
  for (let level = 1, side = size / 2; side >= 1; level++, side /= 2) {
    const block = size / side;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const sum = [0, 0, 0, 0, 0, 0];
      for (let v = 0; v < block; v++) for (let u = 0; u < block; u++) {
        const i = (y * block + v) * size + x * block + u;
        texel(maps.diffuse.subarray(i * 4, i * 4 + 4), maps.roughness[i], maps.metalness[i]).forEach((c, k) => sum[k] += c);
      }
      const ideal = sum.map(v => v / (block * block)), i = y * side + x;
      const coverage = ideal[5];
      expect(chain.diffuse[level][i * 4 + 3]).toBe(Math.floor(Math.sqrt(coverage) * 255 + .5));
      if (coverage > 0) {
        expect(chain.roughness[level][i]).toBe(Math.floor(Math.min(1, ideal[3] / coverage) * 255 + .5));
        expect(chain.metalness[level][i]).toBe(Math.floor(Math.min(1, ideal[4] / coverage) * 255 + .5));
      }
    }
  }
});

test("zero coverage encodes to zero bytes and full coverage keeps uniform colour exactly", () => {
  const empty = encodeContributions(new Float64Array(CONTRIBUTION_CHANNELS), 1);
  expect([...empty.diffuse, ...empty.roughness, ...empty.metalness]).toEqual([0, 0, 0, 0, 0, 0]);
  for (let value = 0; value < 256; value++) {
    const size = 4, texels = size * size;
    const diffuse = new Uint8Array(texels * 4).fill(value);
    for (let i = 0; i < texels; i++) diffuse[i * 4 + 3] = 255;
    const chain = flatMipChain(diffuse, new Uint8Array(texels).fill(value), new Uint8Array(texels).fill(255 - value), size);
    expect([...chain.diffuse[2]]).toEqual([value, value, value, 255]);
    expect(chain.roughness[2][0]).toBe(value);
    expect(chain.metalness[2][0]).toBe(255 - value);
  }
});

test("every alpha byte keeps its coverage through a uniform reduction", () => {
  for (let alpha = 0; alpha < 256; alpha++) {
    const diffuse = new Uint8Array(16).fill(0);
    for (let i = 0; i < 4; i++) diffuse.set([200, 100, 50, alpha], i * 4);
    const chain = flatMipChain(diffuse, new Uint8Array(4).fill(128), new Uint8Array(4), 2);
    expect(chain.diffuse[1][3]).toBe(alpha);
    if (alpha) expect(chain.roughness[1][0]).toBe(128);
  }
});

test("malformed inputs are rejected", () => {
  const maps = randomMaps(4, 3);
  expect(() => flatMipChain(maps.diffuse.subarray(1), maps.roughness, maps.metalness, 4)).toThrow("byte length");
  expect(() => flatMipChain(maps.diffuse, maps.roughness.subarray(1), maps.metalness, 4)).toThrow("byte length");
  expect(() => flatMipChain(maps.diffuse, maps.roughness, maps.metalness, 3)).toThrow("power of two");
  for (const size of [0, -2, 6, 2.5, NaN]) expect(() => mipLevelCount(size)).toThrow("power of two");
  expect(() => reduceContributions(new Float64Array(6), 1)).toThrow("1x1");
  expect(() => reduceContributions(new Float64Array(3 * 2 * 6), 3, 2)).toThrow("even");
  expect(() => reduceContributions(new Float64Array(5), 2)).toThrow("length");
  expect(() => destinationContributions(maps.diffuse, maps.roughness, maps.metalness, 5)).toThrow("byte length");
  expect(() => encodeContributions(new Float64Array(5), 1)).toThrow("length");
});

test("DDS header and payload follow the DX10 layout WolvenKit imports", () => {
  const size = 4, maps = randomMaps(size, 5);
  const chain = flatMipChain(maps.diffuse, maps.roughness, maps.metalness, size);
  for (const [channel, format, stride] of [["diffuse", 29, 4], ["roughness", 61, 1], ["metalness", 61, 1]] as const) {
    const dds = encodeFlatDds(chain[channel], size, channel), view = new DataView(dds.buffer);
    const u32 = (offset: number) => view.getUint32(offset, true);
    expect(new TextDecoder().decode(dds.subarray(0, 4))).toBe("DDS ");
    expect(new TextDecoder().decode(dds.subarray(84, 88))).toBe("DX10");
    expect([u32(4), u32(8), u32(12), u32(16), u32(20), u32(24), u32(28)]).toEqual([124, 0x2100f, size, size, size * stride, 0, 3]);
    expect([u32(76), u32(80), u32(108)]).toEqual([32, 4, 0x401008]);
    expect([u32(128), u32(132), u32(136), u32(140), u32(144)]).toEqual([format, 3, 0, 1, 0]);
    for (const offset of [32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 88, 92, 96, 100, 104, 112, 116, 120, 124]) expect(u32(offset)).toBe(0);
    let offset = DDS_HEADER_BYTES;
    for (const level of chain[channel]) { expect(dds.subarray(offset, offset + level.length)).toEqual(level); offset += level.length; }
    expect(offset).toBe(dds.length);
  }
  expect(() => encodeFlatDds(chain.diffuse.slice(0, -1), size, "diffuse")).toThrow("complete");
  expect(() => encodeFlatDds([chain.diffuse[0].subarray(1), ...chain.diffuse.slice(1)], size, "diffuse")).toThrow("byte length");
  expect(() => encodeFlatDds(chain.roughness, size, "diffuse")).toThrow("byte length");
  expect(() => encodeFlatDds(chain.roughness, size, "normal" as never)).toThrow("channel");
});

// Byte-identity oracle: the unchanged Experiment 005 Python implementation. The
// tests above stand alone; this one needs Python with NumPy and is skipped otherwise.
const python = process.env.XFS_PYTHON || "python";
const oracle = (() => {
  try {
    const probe = Bun.spawnSync([python, "-c", "import numpy"], { cwd: study, stdout: "pipe", stderr: "pipe" });
    return probe.exitCode === 0;
  } catch { return false; }
})();
if (!oracle) console.warn("Skipping the mip_maps.py byte-identity oracle: Python with NumPy is not available.");

test.skipIf(!oracle)("DDS bytes are identical to the Python mip_maps.py oracle", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "xfs-mip-oracle-"));
  try {
    const cases = [{ size: 1, seed: 1 }, { size: 2, seed: 2 }, { size: 64, seed: 3 }, { size: 256, seed: 4 }];
    for (const c of cases) {
      const maps = randomMaps(c.size, c.seed);
      writeFileSync(resolve(dir, `${c.size}.raw`), Buffer.concat([maps.diffuse, maps.roughness, maps.metalness]));
    }
    const run = Bun.spawnSync([python, "-c", `
import json,sys
from pathlib import Path
from mip_maps import mip_levels, dds_bytes
d=Path(sys.argv[1])
for size in json.loads(sys.argv[2]):
    raw=(d/f'{size}.raw').read_bytes();n=size*size
    levels=mip_levels(raw[:4*n],raw[4*n:5*n],raw[5*n:],size)
    for c,l in zip(['diffuse','roughness','metalness'],levels): (d/f'{size}_{c}.dds').write_bytes(dds_bytes(l,size,c))
`, dir, JSON.stringify(cases.map(c => c.size))], { cwd: study, stdout: "pipe", stderr: "pipe" });
    expect(run.stderr.toString()).toBe("");
    for (const c of cases) {
      const maps = randomMaps(c.size, c.seed);
      const chain = flatMipChain(maps.diffuse, maps.roughness, maps.metalness, c.size);
      for (const channel of ["diffuse", "roughness", "metalness"] as const) {
        const expected = new Uint8Array(readFileSync(resolve(dir, `${c.size}_${channel}.dds`)));
        expect(Buffer.compare(encodeFlatDds(chain[channel], c.size, channel), expected)).toBe(0);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);
