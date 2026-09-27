// The creator's choice icons (cc-icons.ts) on a synthetic atlas: which texture and parts are read, and a sheet cut from known rectangles.
import { describe, expect, test } from "bun:test";
import { buildSheet, iconTarget, readAtlas } from "../src/cc-icons";

const res = (hash: string) => ({ DepotPath: { $type: "ResourcePath", $storage: "uint64", $value: hash }, Flags: "Soft" });
const part = (name: string, left: number, top: number, right: number, bottom: number) => ({ $type: "inkTextureAtlasMapper", partName: { $type: "CName", $storage: "string", $value: name },
  clippingRectInUVCoords: { $type: "RectF", Left: left, Top: top, Right: right, Bottom: bottom } });

describe("an inkatlas", () => {
  test("slot 0's texture and parts when it has a texture, else the top-level ones, else the first slot that has one", () => {
    const slot0 = readAtlas({ $type: "inkTextureAtlas", texture: res("0"), parts: [], slots: { Elements: [{ texture: res("11"), parts: [part("a", 0, 0, 0.5, 0.5), part("bad", 0.5, 0.5, 0.5, 0.6)] }] } });
    expect(slot0.from).toBe("slot0");
    expect(slot0.texture?.hash).toBe("11");
    expect([...slot0.parts.keys()]).toEqual(["a"]);
    const top = readAtlas({ $type: "inkTextureAtlas", texture: res("22"), parts: [part("b", 0, 0, 1, 1)], slots: { Elements: [{ texture: res("0"), parts: [] }] } });
    expect([top.from, top.texture?.hash, top.parts.has("b")]).toEqual(["top", "22", true]);
    const later = readAtlas({ $type: "inkTextureAtlas", texture: res("0"), slots: { Elements: [{ texture: res("0") }, { texture: res("33"), parts: [part("c", 0, 0, 1, 1)] }] } });
    expect([later.from, later.texture?.hash]).toEqual(["slot1", "33"]);
    expect(readAtlas({ $type: "CMesh" }).from).toBe("none");
  });

  test("a choice's icon target needs an atlas and a part", () => {
    expect(iconTarget({ atlas: { hash: "5", path: null }, part: "p" })).toEqual({ atlas: { hash: "5", path: null }, part: "p" });
    expect(iconTarget({ atlas: null, part: "p" })).toBeNull();
    expect(iconTarget(null)).toBeNull();
  });
});

describe("an icon sheet", () => {
  test("each part fills its own cell, scaled and centred; rows are read top-down unless flipped", () => {
    // A 4×2 texture: the left half red, the right half blue, the bottom row green.
    const data = new Uint8Array(4 * 2 * 4);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) {
      const at = (y * 4 + x) * 4, colour = y === 1 ? [0, 255, 0] : x < 2 ? [255, 0, 0] : [0, 0, 255];
      data.set([...colour, 255], at);
    }
    const texture = { width: 4, height: 2, data };
    const sheet = buildSheet(texture, [{ left: 0, top: 0, right: 0.5, bottom: 0.5 }, { left: 0.5, top: 0, right: 1, bottom: 0.5 }], { cell: 4, columns: 2 });
    expect([sheet.width, sheet.height]).toEqual([8, 4]);
    const pixel = (x: number, y: number) => [...sheet.data.slice((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4)];
    expect(pixel(1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(5, 2)).toEqual([0, 0, 255, 255]);
    const flipped = buildSheet(texture, [{ left: 0, top: 0, right: 0.5, bottom: 0.5 }], { cell: 4, flipped: true });
    // The 2×1-texel part is centred in its 4×4 cell (rows 1–2); flipped, it reads the texture's bottom row.
    expect([...flipped.data.slice((1 * 4 + 0) * 4, (1 * 4 + 0) * 4 + 4)]).toEqual([0, 255, 0, 255]);
    expect(flipped.data[3]).toBe(0);
  });
});
