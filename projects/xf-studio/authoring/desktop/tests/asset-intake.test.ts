import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createCoreAssetReadiness, importCoreAssets, inspectCoreAssets } from "../asset-intake";

function glbFixture(): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ byteLength: 4 }],
    meshes: ["head", "makeup_plate", "eyes"].map(name => ({ name, primitives: [{ attributes: { POSITION: 0 } }] })) }));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const output = Buffer.alloc(12 + 8 + padded.length + 8 + 4);
  output.write("glTF", 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12); output.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(output, 20);
  output.writeUInt32LE(4, 20 + padded.length); output.writeUInt32LE(0x004e4942, 24 + padded.length);
  return output;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type: string, data: Buffer): Buffer {
  const value = Buffer.alloc(data.length + 12);
  value.writeUInt32BE(data.length, 0); value.write(type, 4); data.copy(value, 8);
  let crc = 0xffffffff;
  for (let index = 4; index < value.length - 4; index++) crc = crcTable[(crc ^ value[index]!) & 255]! ^ (crc >>> 8);
  value.writeUInt32BE((crc ^ 0xffffffff) >>> 0, value.length - 4);
  return value;
}
function pngFixture(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 0;
  const pixels = Buffer.alloc(257 * 256);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
function prepared(folder: string) {
  mkdirSync(folder);
  writeFileSync(resolve(folder, "head.glb"), glbFixture());
  for (const name of ["head-color.png", "eye-color.png", "head-normal.png", "head-roughness.png"])
    writeFileSync(resolve(folder, name), pngFixture());
}

test("a valid prepared set with different hashes opens and imports without overwriting user data", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "xfs-core-intake-"));
  try {
    const source = resolve(root, "prepared"), data = resolve(root, "data");
    prepared(source);
    const check = await inspectCoreAssets(source);
    expect(check).toMatchObject({ ready: true, provenance: "unverified" });
    expect(check.files).toHaveLength(5);
    expect(check.files.every(file => file.status === "ready" && file.matchesKnownOutput === false)).toBe(true);
    const ready = createCoreAssetReadiness(data);
    expect(await ready()).toBe(false);
    const copied = await importCoreAssets(source, data);
    expect(copied.ready).toBe(true);
    expect(await ready()).toBe(true);
    expect(await ready()).toBe(true); // unchanged metadata uses cached structural result
    expect(Buffer.compare(readFileSync(resolve(data, "preview-assets", "head.glb")), glbFixture())).toBe(0);
    await expect(importCoreAssets(source, data)).rejects.toThrow("does not replace");
    writeFileSync(resolve(data, "preview-assets", "head.glb"), "corrupt");
    expect(await ready()).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("corrupt PNG and GLB files are rejected before publication", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "xfs-core-corrupt-"));
  try {
    const source = resolve(root, "prepared"), data = resolve(root, "data");
    prepared(source);
    const broken = readFileSync(resolve(source, "head-color.png"));
    broken[broken.length - 17] ^= 1; // Damage compressed data without updating its chunk CRC.
    writeFileSync(resolve(source, "head-color.png"), broken);
    let report = await inspectCoreAssets(source);
    expect(report.ready).toBe(false);
    expect(report.files.find(file => file.name === "head-color.png")?.status).toBe("invalid");
    expect((await importCoreAssets(source, data)).ready).toBe(false);
    expect(existsSync(resolve(data, "preview-assets"))).toBe(false);
    writeFileSync(resolve(source, "head-color.png"), pngFixture());
    writeFileSync(resolve(source, "head.glb"), Buffer.from("glTFbroken"));
    report = await inspectCoreAssets(source);
    expect(report.files.find(file => file.name === "head.glb")?.status).toBe("invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a linked source file cannot enter the private asset tree", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "xfs-core-link-"));
  try {
    const source = resolve(root, "prepared"), data = resolve(root, "data");
    prepared(source);
    const external = resolve(root, "outside.png");
    writeFileSync(external, pngFixture());
    rmSync(resolve(source, "eye-color.png"));
    symlinkSync(external, resolve(source, "eye-color.png"));
    expect((await inspectCoreAssets(source)).files.find(file => file.name === "eye-color.png")?.status).toBe("invalid");
    expect((await importCoreAssets(source, data)).ready).toBe(false);
    expect(existsSync(resolve(data, "preview-assets"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
