import { test, expect } from "bun:test";
import { Reader, decodeLz4, readSavedV } from "../src/save-reader";
test("signed string lengths and UTF-16 are decoded without losing characters", () => {
  expect(new Reader(new Uint8Array([0x83, 65, 66, 67])).text()).toBe("ABC");
  expect(new Reader(new Uint8Array([1, 0xa9, 3])).text()).toBe("Ω");
  expect(() => new Reader(new Uint8Array([0x85, 65])).text()).toThrow();
});
test("LZ4 handles overlapping matches and exact output bounds", () => {
  const block = new Uint8Array([0x18, 65, 1, 0, 0x50, 66, 67, 68, 69, 70]);
  expect(new TextDecoder().decode(decodeLz4(block, 18))).toBe(
    "AAAAAAAAAAAAABCDEF",
  );
  expect(() => decodeLz4(block, 17)).toThrow();
  expect(() => decodeLz4(new Uint8Array([0, 0, 0]), 4)).toThrow();
  expect(() => decodeLz4(new Uint8Array([0xf0, 255]), 10)).toThrow();
});
test("rejects wrong files and truncated files", () => {
  expect(() => readSavedV(new Uint8Array(100))).toThrow();
  expect(() => readSavedV(new Uint8Array(1))).toThrow();
});
const capture = new URL(
  "../../../../captures/2026-09-23-save-appearance/sav.dat",
  import.meta.url,
);
test("captured 2.31 save decodes completely, including custom Eye Artistry choices", async () => {
  const f = Bun.file(capture);
  if (!(await f.exists())) return; // Private local integration fixture, never distributed.
  const bytes = await f.bytes(),
    before = new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    v = readSavedV(bytes);
  expect(v.gameVersion).toBe(2310);
  expect(v.presetVersion).toBe(12);
  expect(v.evidence.trailingBytes).toBe(0);
  expect(v.evidence.bytesRead).toBe(v.evidence.nodeBytes);
  expect(v.isMale).toBe(false);
  const g = v.groups.head.find((g) => g.name === "character_customization")!;
  expect(g.morphs.map((m) => m.target + "_" + m.region)).toEqual([
    "h091_eyes",
    "h012_nose",
    "h053_mouth",
    "h054_jaw",
    "h145_ear",
  ]);
  expect(
    g.appearances
      .filter((a) => a.name.startsWith("xfea_"))
      .map((a) => a.definition),
  ).toEqual([
    "xfea_layer1_006_matte",
    "xfea_layer2_006_matte",
    "xfea_layer3_033_matte",
  ]);
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
    before,
  );
  const truncated = bytes.slice(0, bytes.length - 10);
  expect(() => readSavedV(truncated)).toThrow();
});
